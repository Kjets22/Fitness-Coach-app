/* ============================================================
   targets-engine.js — pure functions (NO DOM, NO storage) that
   turn a goal + the user's records into daily targets, and run
   the adaptive "learns you" loop.

   Goal record (storage type "goal", single active record):
     { date (start, YYYY-MM-DD), type, targetAmountKg (positive
       magnitude or null), targetDate|null, heightCm|null,
       age|null, sex "m"|"f"|null, activity key|null }

   Adjustment record (storage type "adjustments"):
     { date, kind: "calories"|"reset", delta, from, to, reason }

   All weights/water METRIC (kg / ml); display converts elsewhere.

   Formulas (decided for Iteration 6):
     maintenance = Mifflin-St Jeor BMR x activity factor when the
       profile (height+age) is set, else 33 kcal/kg fallback.
     calories    = maintenance + goal surplus + cumulative
       adaptation adjustments. Surplus: lean-bulk +250, cut -500
       (deficit capped so weekly loss <= 0.7% BW), others 0.
       Floor 1200 kcal.
     protein     = g/kg by goal (2.0 / 2.2 / 2.0 / 1.6 / 1.8)
     fat         = 0.8 g/kg;  carbs = remaining calories / 4
     water       = 35 ml/kg + 500 ml per hour of exercise today
     steps       = 10000 on a cut, else 8000;  sleep = 7.5 h
     weekly weight-change target = +0.25% BW (lean bulk),
       -0.5% BW (cut), 0 otherwise.

   Adaptation (computeAdaptation): with >= 14 food-logged days and
   >= 4 weigh-ins spanning >= 14 days in the last 28 days, observed
   maintenance = avg intake - 7700 * weight slope (kg/day), blended
   with the formula estimate by data quantity. If the observed
   weekly change is off the goal's target rate by > 40% (or > 0.15
   kg/wk when the target is ~0), propose a +-100/125/150 kcal step
   (max one per 7 days, cumulative cap +-600).
   ============================================================ */

window.OF = window.OF || {};

OF.targets = (function () {
  "use strict";
  var U = OF.util;

  var KCAL_PER_KG = 7700;
  var ADJ_STEP_DAYS = 7;      // at most one adjustment per week
  var ADJ_CAP = 600;          // |cumulative calorie adjustment| cap
  var MUSCLE_MAX_KG_WK = 0.23;   // ~0.5 lb/wk — optimistic natural ceiling
  var MUSCLE_TYPICAL_KG_WK = 0.16; // ~0.35 lb/wk — realistic beginner rate

  var GOAL_TYPES = {
    "lean-bulk": { label: "Gain muscle & stay lean", surplus: 250, proteinGkg: 2.0, weeklyPctBW: 0.25, steps: 8000, metric: "muscle", dir: 1 },
    "cut": { label: "Lose weight & get lean", surplus: -500, proteinGkg: 2.2, weeklyPctBW: -0.5, steps: 10000, metric: "weight", dir: -1 },
    "recomp": { label: "Body recomposition", surplus: 0, proteinGkg: 2.0, weeklyPctBW: 0, steps: 8000, metric: "muscle", dir: 0 },
    "maintain": { label: "Maintain / general health", surplus: 0, proteinGkg: 1.6, weeklyPctBW: 0, steps: 8000, metric: "weight", dir: 0 },
    "performance": { label: "Train & perform better", surplus: 0, proteinGkg: 1.8, weeklyPctBW: 0, steps: 8000, metric: "weight", dir: 0 }
  };

  var ACTIVITY = {
    "sedentary": { label: "Sedentary (desk job, little exercise)", mult: 1.2 },
    "light": { label: "Lightly active (1-3 workouts/wk)", mult: 1.375 },
    "moderate": { label: "Moderately active (3-5 workouts/wk)", mult: 1.55 },
    "active": { label: "Very active (6-7 workouts/wk)", mult: 1.725 },
    "very-active": { label: "Extremely active (physical job + training)", mult: 1.9 }
  };

  /* ---------------- date + math helpers ---------------- */

  function parseISO(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    // Anchor at 12:00 UTC (not local midnight) so the instant never straddles a
    // UTC date boundary in far-east/far-west zones (UTC+13/+14, UTC-12).
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)) : null;
  }
  function dayNum(iso) {
    var d = parseISO(iso);
    // floor(noon-UTC / dayMs) is the exact epoch-day and the true inverse of
    // isoFromDayNum's (dn + 0.5) reconstruction — timezone-safe both ways.
    return d ? Math.floor(d.getTime() / 86400000) : null;
  }
  /** Inverse of dayNum — UTC-noon trick, timezone-safe. */
  function isoFromDayNum(dn) {
    var d = new Date((dn + 0.5) * 86400000);
    return d.getUTCFullYear() + "-" +
      String(d.getUTCMonth() + 1).padStart(2, "0") + "-" +
      String(d.getUTCDate()).padStart(2, "0");
  }
  function slope(points) {
    if (!points || points.length < 2) return null;
    var mx = 0, my = 0, i;
    for (i = 0; i < points.length; i++) { mx += points[i].x; my += points[i].y; }
    mx /= points.length; my /= points.length;
    var sxy = 0, sxx = 0;
    for (i = 0; i < points.length; i++) {
      sxy += (points[i].x - mx) * (points[i].y - my);
      sxx += (points[i].x - mx) * (points[i].x - mx);
    }
    return sxx === 0 ? null : sxy / sxx;
  }
  function round2(v) { return v == null ? null : Math.round(v * 100) / 100; }
  function num(v) {
    if (v == null || v === "") return null; // Number(null) is 0 — never treat missing as 0
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  /**
   * effectiveBodyFat(body, physique) -> null or { pct, source, date }.
   * A MEASURED body-fat % (from a Body record) always wins; only when no
   * body record carries a body-fat % do we fall back to the most recent
   * physique-photo estimate (bodyFatMidpoint). Never double-counts — the
   * two sources are mutually exclusive by design. `source` is "measured"
   * or "photo" so callers can label it "(estimated from your photo)".
   */
  function effectiveBodyFat(body, physique) {
    var m = null;
    (body || []).forEach(function (r) {
      if (num(r.bodyFatPct) == null) return;
      if (!m || (r.date || "") > (m.date || "")) m = r;
    });
    if (m) return { pct: num(m.bodyFatPct), source: "measured", date: m.date };
    var p = null;
    (physique || []).forEach(function (r) {
      if (num(r.bodyFatMidpoint) == null) return;
      if (!p || (r.date || "") > (p.date || "")) p = r;
    });
    if (p) return { pct: num(p.bodyFatMidpoint), source: "photo", date: p.date };
    return null;
  }

  /** Latest weight (kg) from body records, or null. */
  function latestWeightKg(body) {
    var best = null;
    (body || []).forEach(function (r) {
      if (num(r.weightKg) == null) return;
      // tie-break same-day entries by creation moment (mirrors U.byNewest) —
      // without it a same-day re-weigh never updated calorie/water targets
      if (!best || (r.date || "") > (best.date || "") ||
          ((r.date || "") === (best.date || "") && (r.createdAt || "") > (best.createdAt || ""))) best = r;
    });
    return best ? num(best.weightKg) : null;
  }

  /* ---------------- maintenance estimate ---------------- */

  function mifflin(kg, cm, age, sex) {
    var base = 10 * kg + 6.25 * cm - 5 * age;
    // Unknown sex: midpoint of the +5 / -161 constants.
    return base + (sex === "m" ? 5 : sex === "f" ? -161 : -78);
  }

  /** { kcal, method: "mifflin"|"perkg", bmr|null } or null without weight. */
  function maintenanceEstimate(goal, weightKg) {
    if (weightKg == null) return null;
    var g = goal || {};
    if (num(g.heightCm) != null && num(g.age) != null) {
      var bmr = mifflin(weightKg, num(g.heightCm), num(g.age), g.sex);
      var act = ACTIVITY[g.activity];
      return { kcal: bmr * (act ? act.mult : 1.4), method: "mifflin", bmr: Math.round(bmr) };
    }
    return { kcal: 33 * weightKg, method: "perkg", bmr: null };
  }

  /* ---------------- daily targets ---------------- */

  /**
   * computeTargets(goal, opts) — opts: { weightKg, exerciseMinToday, adjTotal }
   * Returns null (no/unknown goal) or {status:"no-weight"...} or the target set.
   */
  function computeTargets(goal, opts) {
    if (!goal || !GOAL_TYPES[goal.type]) return null;
    var t = GOAL_TYPES[goal.type];
    opts = opts || {};
    var kg = num(opts.weightKg);
    if (kg == null) {
      return {
        status: "no-weight", goalType: goal.type, label: t.label,
        message: "Log your weight on the Body tab first — every daily target is computed from it."
      };
    }
    var maint = maintenanceEstimate(goal, kg);
    var surplus = t.surplus;
    if (goal.type === "cut") {
      // Weekly-loss cap 0.7% BW -> max daily deficit = 0.007*kg*7700/7.
      var maxDeficit = Math.round(0.007 * kg * KCAL_PER_KG / 7);
      if (-surplus > maxDeficit) surplus = -maxDeficit;
    }
    var adjTotal = num(opts.adjTotal) || 0;
    var calories = Math.max(1200, Math.round(maint.kcal + surplus + adjTotal));
    var proteinG = Math.round(t.proteinGkg * kg);
    var fatG = Math.round(0.8 * kg);
    var carbsG = Math.max(0, Math.round((calories - proteinG * 4 - fatG * 9) / 4));
    var exH = (num(opts.exerciseMinToday) || 0) / 60;
    // Body-fat % (measured wins; else estimated from a physique photo). It
    // does not change the calorie/protein/carb numbers above — it is echoed
    // here, clearly sourced, so the goal card, coach context and insights can
    // reference it ("~18%, estimated from your photo") without recomputing.
    var bf = num(opts.bodyFatPct);
    return {
      status: "ok",
      goalType: goal.type,
      label: t.label,
      weightKg: kg,
      bodyFatPct: bf,
      bodyFatSource: bf != null ? (opts.bodyFatSource || "measured") : null,
      leanMassKg: bf != null ? round2(kg * (1 - bf / 100)) : null,
      maintenanceKcal: Math.round(maint.kcal),
      maintenanceMethod: maint.method,
      bmr: maint.bmr,
      surplus: surplus,
      adjTotal: adjTotal,
      calories: calories,
      proteinG: proteinG,
      fatG: fatG,
      carbsG: carbsG,
      waterMl: Math.round(35 * kg + 500 * exH),
      steps: t.steps,
      sleepH: 7.5,
      weeklyTargetKg: round2(t.weeklyPctBW / 100 * kg),
      weeklyTargetPct: t.weeklyPctBW
    };
  }

  /* ---------------- adaptation ---------------- */

  /**
   * computeAdaptation(food, body, goal, asOfIso, adjTotal)
   * Looks at the 28 days ending asOfIso. Returns:
   *   { ready:false, message, foodDays, weightPts }              — not enough data
   *   { ready:true, fire:false, ...diagnostics }                 — on pace / capped
   *   { ready:true, fire:true, deltaCal, ...diagnostics }        — adjust calories
   * Diagnostics: obsWeeklyKg, targetWeeklyKg, obsMaintenance,
   * blendedMaintenance, avgKcal, foodDays, weightPts.
   */
  function computeAdaptation(food, body, goal, asOfIso, adjTotal) {
    var t = goal && GOAL_TYPES[goal.type];
    if (!t) return { ready: false, message: "No goal set." };
    var asOf = dayNum(asOfIso || U.todayISO());
    var winStart = asOf - 27;

    // Daily calorie totals in the window.
    var byDay = {};
    (food || []).forEach(function (f) {
      var dn = dayNum(f.date), k = num(f.calories);
      if (dn == null || k == null || k <= 0) return;
      if (dn < winStart || dn > asOf) return;
      byDay[dn] = (byDay[dn] || 0) + k;
    });
    var days = Object.keys(byDay);
    var foodDays = days.length;
    var avgKcal = foodDays
      ? days.reduce(function (a, d) { return a + byDay[d]; }, 0) / foodDays : null;

    // Weight points in the window.
    var pts = [];
    (body || []).forEach(function (r) {
      var dn = dayNum(r.date), w = num(r.weightKg);
      if (dn == null || w == null) return;
      if (dn < winStart || dn > asOf) return;
      pts.push({ x: dn, y: w });
    });
    pts.sort(function (a, b) { return a.x - b.x; });
    var span = pts.length ? pts[pts.length - 1].x - pts[0].x : 0;

    if (foodDays < 14 || avgKcal == null || avgKcal < 1000 || pts.length < 4 || span < 14) {
      // name the condition that actually failed — the generic count message
      // contradicted itself when the counts were fine but avg intake was
      // implausibly low (incomplete food days)
      var why =
        foodDays < 14 ? foodDays + " of 14 needed food-logging days" :
        (avgKcal == null || avgKcal < 1000) ? "logged intake averages under 1,000 kcal/day — log complete days so the math is trustworthy" :
        pts.length < 4 ? pts.length + " of 4 needed weigh-ins" :
        "weigh-ins need to span 2+ weeks";
      return {
        ready: false, foodDays: foodDays, weightPts: pts.length,
        message: "The adaptive coach isn't ready yet: " + why + " (within the last 4 weeks)."
      };
    }

    var sl = slope(pts); // kg per day
    if (sl == null) sl = 0;
    var obsWeeklyKg = sl * 7;
    var curKg = pts[pts.length - 1].y;
    var obsMaint = avgKcal - KCAL_PER_KG * sl;
    var formula = maintenanceEstimate(goal, curKg).kcal;
    // Blend weight grows with logging density; never fully trust either side.
    var w = Math.min(0.85, foodDays / 28);
    var blended = Math.round(w * obsMaint + (1 - w) * formula);

    var targetWeeklyKg = t.weeklyPctBW / 100 * curKg;
    var diff = targetWeeklyKg - obsWeeklyKg; // + => moving too slow upward => eat more
    var off = Math.abs(targetWeeklyKg) >= 0.05
      ? Math.abs(diff) > 0.4 * Math.abs(targetWeeklyKg)
      : Math.abs(obsWeeklyKg) > 0.15;

    var out = {
      ready: true, fire: false,
      obsWeeklyKg: round2(obsWeeklyKg),
      targetWeeklyKg: round2(targetWeeklyKg),
      obsMaintenance: Math.round(obsMaint),
      blendedMaintenance: blended,
      avgKcal: Math.round(avgKcal),
      foodDays: foodDays,
      weightPts: pts.length
    };
    if (!off) return out;

    var mag = Math.abs(diff);
    var step = mag >= 0.25 ? 150 : mag >= 0.12 ? 125 : 100;
    var delta = diff > 0 ? step : -step;
    if (Math.abs((num(adjTotal) || 0) + delta) > ADJ_CAP) {
      out.capped = true; // would exceed the safety cap — hold steady
      return out;
    }
    out.fire = true;
    out.deltaCal = delta;
    return out;
  }

  /* ---------------- goal progress ---------------- */

  /**
   * goalProgress(goal, body) -> null | {status:"no-data"} | {
   *   status:"ok", metric "muscle"|"weight", usedFallback,
   *   baseDate, baseKg, curDate, curKg, deltaKg, ratePerWeekKg,
   *   [targetKg, achievedKg, remainingKg, pct, projectedDate, onTrack] }
   */
  function goalProgress(goal, body) {
    var t = goal && GOAL_TYPES[goal.type];
    if (!t) return null;
    var startDn = dayNum(goal.date);
    if (startDn == null) startDn = dayNum(U.todayISO());

    function collect(metric) {
      var pts = [];
      (body || []).forEach(function (r) {
        var dn = dayNum(r.date);
        if (dn == null) return;
        var v = null;
        if (metric === "muscle") {
          v = U.muscleKg(r);   // kg of muscle (new kg records + legacy % records)
        } else {
          v = num(r.weightKg);
        }
        if (v != null) pts.push({ x: dn, y: v, date: r.date });
      });
      pts.sort(function (a, b) { return a.x - b.x; });
      return pts;
    }

    var metric = t.metric;
    var usedFallback = false;
    var pts = collect(metric);
    if (metric === "muscle" && pts.length < 2) {
      metric = "weight";
      usedFallback = true;
      pts = collect("weight");
    }
    if (!pts.length) return { status: "no-data", metric: metric, usedFallback: usedFallback };

    // Baseline: last point at/before the goal start, else the first point after.
    var base = null;
    pts.forEach(function (p) { if (p.x <= startDn) base = p; });
    if (!base) base = pts[0];
    var cur = pts[pts.length - 1];
    var deltaKg = cur.y - base.y;

    var recent = pts.filter(function (p) { return p.x >= cur.x - 28; });
    var sl = recent.length >= 2 ? slope(recent) : null;
    var rate = sl == null ? null : sl * 7;

    var out = {
      status: "ok", metric: metric, usedFallback: usedFallback,
      baseDate: base.date, baseKg: round2(base.y),
      curDate: cur.date, curKg: round2(cur.y),
      deltaKg: round2(deltaKg), ratePerWeekKg: round2(rate)
    };

    var amount = num(goal.targetAmountKg);
    if (amount != null && amount > 0 && t.dir !== 0) {
      var achieved = t.dir * deltaKg; // positive = moving the right way
      var remaining = Math.max(0, amount - Math.max(0, achieved));
      out.targetKg = amount;
      out.achievedKg = round2(achieved);
      out.remainingKg = round2(remaining);
      out.pct = Math.max(0, Math.min(1, achieved / amount));
      if (rate != null && t.dir * rate > 0.01 && remaining > 0) {
        var weeks = remaining / (t.dir * rate);
        // anchor from TODAY, not the last weigh-in — with stale data the
        // projection otherwise lands in the past
        var anchor = Math.max(cur.x, dayNum(U.todayISO()));
        if (weeks < 260) out.projectedDate = isoFromDayNum(anchor + Math.round(weeks * 7));
      }
      if (remaining <= 0) out.reached = true;
      if (goal.targetDate && dayNum(goal.targetDate) != null) {
        var endDn = dayNum(goal.targetDate);
        var slack = Math.max(14, Math.round((endDn - startDn) * 0.15));
        out.onTrack = out.reached === true ||
          (out.projectedDate != null && dayNum(out.projectedDate) <= endDn + slack);
      } else if (rate != null) {
        var wantRate = metric === "muscle"
          ? MUSCLE_TYPICAL_KG_WK
          : Math.abs(t.weeklyPctBW) / 100 * cur.y;
        out.onTrack = wantRate > 0 ? (t.dir * rate >= 0.4 * wantRate) : null;
      }
    }
    return out;
  }

  /* ---------------- honesty / reality check ---------------- */

  /**
   * realityCheck(goal, progress) -> null (fine / not applicable) or
   * { unrealistic:true, neededKgWk, maxKgWk, realisticDate, kind }.
   * Kind: "muscle" (natural muscle-gain ceiling) or "loss" (weekly BW% cap).
   */
  function realityCheck(goal, progress) {
    var t = goal && GOAL_TYPES[goal.type];
    if (!t || t.dir === 0) return null;
    var amount = num(goal.targetAmountKg);
    if (amount == null || amount <= 0 || !goal.targetDate) return null;
    var today = dayNum(U.todayISO());
    var endDn = dayNum(goal.targetDate);
    if (endDn == null) return null;

    var achieved = progress && progress.status === "ok" && progress.achievedKg != null
      ? Math.max(0, progress.achievedKg) : 0;
    var remaining = Math.max(0, amount - achieved);
    if (remaining <= 0) return null;

    var curKg = progress && progress.status === "ok" && progress.metric === "weight"
      ? progress.curKg : null;
    var maxKgWk, typicalKgWk, kind;
    if (t.metric === "muscle") {
      kind = "muscle";
      maxKgWk = MUSCLE_MAX_KG_WK;         // ~0.5 lb/wk (beginner best case)
      typicalKgWk = MUSCLE_TYPICAL_KG_WK; // ~0.35 lb/wk
    } else {
      kind = "loss";
      // Floor bw so a 0 / missing latest weight can't zero maxKgWk/typicalKgWk
      // and send an Infinity into isoFromDayNum ("NaN-NaN-NaN" in the goal card).
      var bw = Math.max(30, curKg != null ? curKg : 80);
      maxKgWk = 0.01 * bw;   // 1% BW/wk — aggressive ceiling
      typicalKgWk = 0.006 * bw; // ~0.6% BW/wk — sustainable
    }

    var weeksLeft = (endDn - today) / 7;
    var neededKgWk = weeksLeft > 0 ? remaining / weeksLeft : Infinity;
    if (neededKgWk <= maxKgWk) return null;

    return {
      unrealistic: true,
      kind: kind,
      neededKgWk: round2(neededKgWk === Infinity ? null : neededKgWk),
      maxKgWk: round2(maxKgWk),
      typicalKgWk: round2(typicalKgWk),
      remainingKg: round2(remaining),
      realisticDate: isoFromDayNum(today + Math.round(remaining / typicalKgWk * 7))
    };
  }

  /* ---------------- intake stats (food vs targets) ---------------- */

  /** Averages per LOGGED day over the last `days` days. */
  function intakeStats(food, days) {
    days = days || 14;
    var today = dayNum(U.todayISO());
    var byDay = {};
    (food || []).forEach(function (f) {
      var dn = dayNum(f.date);
      if (dn == null || today - dn >= days || today - dn < 0) return;
      var d = byDay[dn] || (byDay[dn] = { kcal: 0, protein: 0, carbs: 0, fat: 0 });
      var k = num(f.calories), p = num(f.protein), c = num(f.carbs), ft = num(f.fat);
      if (k != null) d.kcal += k;
      if (p != null) d.protein += p;
      if (c != null) d.carbs += c;
      if (ft != null) d.fat += ft;
    });
    var keys = Object.keys(byDay).filter(function (k) { return byDay[k].kcal > 0; });
    if (!keys.length) return { days: 0, kcal: null, protein: null, carbs: null, fat: null };
    function avgOf(f) {
      return Math.round(keys.reduce(function (a, k) { return a + byDay[k][f]; }, 0) / keys.length);
    }
    return { days: keys.length, kcal: avgOf("kcal"), protein: avgOf("protein"), carbs: avgOf("carbs"), fat: avgOf("fat") };
  }

  return {
    GOAL_TYPES: GOAL_TYPES,
    ACTIVITY: ACTIVITY,
    ADJ_STEP_DAYS: ADJ_STEP_DAYS,
    dayNum: dayNum,
    isoFromDayNum: isoFromDayNum,
    latestWeightKg: latestWeightKg,
    effectiveBodyFat: effectiveBodyFat,
    maintenanceEstimate: maintenanceEstimate,
    computeTargets: computeTargets,
    computeAdaptation: computeAdaptation,
    goalProgress: goalProgress,
    realityCheck: realityCheck,
    intakeStats: intakeStats
  };
})();

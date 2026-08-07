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
    if (!goal) return null;
    if (!GOAL_TYPES[goal.type]) {
      // A goal record with an unrecognised type can only arrive from a
      // restored backup or cloud sync (the UI can't make one). Returning a
      // bare null blanked the goal card AND every daily target with no
      // message at all — say what happened instead.
      return { status: "unknown-type",
        message: "This goal's type (\u201c" + String(goal.type || "missing") +
          "\u201d) isn't one this version knows. Edit your goal to pick a current one." };
    }
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
        // onTrack must stay NULL when we simply can't tell — callers treat
        // false as "behind pace" (amber ring, "tighten your calories"), and
        // an empty 28-day rate window is not evidence of being behind. A
        // user 50% done in 33% of the timeline was being told off for it.
        out.onTrack = out.reached === true ? true
          : (out.projectedDate != null
              ? dayNum(out.projectedDate) <= endDn + slack
              : null);
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

  /* ----------------------------------------------------------
     suggestGoal — the coach picks the goal FOR the user from
     their own data (one tap, instant, works offline).

     data: { body:[], exercise:[], physique:[], profile:{sex,
       heightCm, age}|null, today:"YYYY-MM-DD" }
     -> { rec: goal-record fields ready to save, why: [string],
          confidence: "low"|"medium"|"high" }  (never null — with
          zero data it still recommends an honest starting point)

     The decision mirrors what a veteran coach does on day one:
     body-fat level (measured > photo estimate) decides cut vs
     lean-bulk vs recomp; training frequency and physique
     muscularity break ties; the amount + date come from the
     evidence-based healthy rates already used by realityCheck
     (cut ~0.75% BW/week, muscle ~0.25% BW/week). */
  function suggestGoal(data) {
    data = data || {};
    var body = data.body || [], exercise = data.exercise || [];
    var physique = (data.physique || []).slice().sort(function (a, b) {
      return String(b.date || "").localeCompare(String(a.date || ""));
    });
    var prof = data.profile || {};
    var today = data.today || U.todayISO();
    var why = [];

    var weight = latestWeightKg(body);
    var bf = effectiveBodyFat(body, physique);
    var musc = physique.length ? physique[0].muscularity : null;
    var sex = prof.sex === "m" || prof.sex === "f" ? prof.sex : null;

    // training frequency: distinct workout days in the last 28 days
    var t0 = dayNum(today), days = {};
    exercise.forEach(function (r) {
      var d = dayNum(r && r.date);
      if (d != null && t0 - d >= 0 && t0 - d < 28) days[r.date] = 1;
    });
    var sessionsWk = Math.round(Object.keys(days).length / 4 * 10) / 10;

    // thresholds by sex (unknown sex -> midpoints, said out loud in `why`)
    var cutTh = sex === "m" ? 20 : sex === "f" ? 30 : 25;
    var leanTh = sex === "m" ? 15 : sex === "f" ? 23 : 19;
    var bulkTh = sex === "m" ? 13 : sex === "f" ? 21 : 17;

    var type, targetAmountKg = null, targetDate = null;
    var bfTxt = bf ? "~" + Math.round(bf.pct) + "% body fat (" +
      (bf.source === "photo" ? "from your physique photo" : "your logged measurement") + ")" : null;

    if (bf && weight && bf.pct >= cutTh) {
      type = "cut";
      // lose down to the healthy-lean midpoint, at ~0.75% BW/week (the
      // evidence-backed 0.5-1% band), capped at 12% of body weight per goal
      var loseKg = Math.min(weight * (bf.pct - leanTh) / 100, weight * 0.12);
      targetAmountKg = Math.max(1, Math.round(loseKg * 2) / 2);
      var wkRate = weight * 0.0075;
      var weeks = Math.min(30, Math.max(8, Math.ceil(targetAmountKg / wkRate)));
      targetDate = isoFromDayNum(t0 + weeks * 7);
      why.push("You're at " + bfTxt + " — trimming to ~" + leanTh +
        "% frees up strength, energy and definition.");
      why.push("The pace is the healthy one: ~0.75% of body weight per week, so muscle stays.");
    } else if (bf && weight && bf.pct <= bulkTh) {
      type = "lean-bulk";
      targetAmountKg = Math.max(1, Math.round(weight * 0.0025 * 16 * 2) / 2);
      targetDate = isoFromDayNum(t0 + 16 * 7);
      why.push("You're already lean at " + bfTxt + " — building muscle is the biggest win from here.");
      why.push("~0.25% of body weight per week over 16 weeks adds muscle without meaningful fat.");
    } else if (bf && weight) {
      // mid body-fat: physique development decides
      if ((musc === "low" || musc === "below-average") && bf.pct < cutTh - 3) {
        type = "lean-bulk";
        targetAmountKg = Math.max(1, Math.round(weight * 0.0025 * 16 * 2) / 2);
        targetDate = isoFromDayNum(t0 + 16 * 7);
        why.push("At " + bfTxt + " with room to grow muscle, a lean gaining phase beats cutting.");
      } else {
        type = "recomp";
        why.push("At " + bfTxt + " you're in the sweet spot for recomposition — " +
          "build muscle and drop fat at the same weight.");
      }
      if (musc) why.push("Your physique analysis rates muscular development “" + musc + "”.");
    } else if (sessionsWk >= 3) {
      type = "performance";
      why.push("You've trained " + sessionsWk + "×/week for the last month — " +
        "without a body-fat reading, sharpening performance is the safest optimal pick.");
      why.push("Log a weight + body-fat (or a physique photo) and I can re-pick with precision.");
    } else if (weight || exercise.length) {
      type = "recomp";
      why.push("With limited data so far, recomposition is the no-regrets start: " +
        "build muscle, lose fat, and every workout you log sharpens the plan.");
    } else {
      type = "maintain";
      why.push("No logged data yet — start at maintenance while your first week of " +
        "logging teaches the coach how your body responds, then re-pick.");
    }
    if (!sex && bf) why.push("Thresholds used unisex midpoints — set your sex on the goal for sharper cutoffs.");
    if (sessionsWk >= 1 && (type === "cut" || type === "lean-bulk" || type === "recomp")) {
      why.push("Training " + sessionsWk + "×/week supports this goal well.");
    }

    var activity = sessionsWk >= 5 ? "active" : sessionsWk >= 3 ? "moderate" :
      sessionsWk >= 1 ? "light" : null;

    var haveCount = (weight != null ? 1 : 0) + (bf ? 1 : 0) + (sessionsWk > 0 ? 1 : 0);
    return {
      rec: {
        type: type,
        targetAmountKg: targetAmountKg,
        targetDate: targetDate,
        heightCm: num(prof.heightCm),
        age: num(prof.age) != null ? Math.round(num(prof.age)) : null,
        sex: sex,
        activity: prof.activity || activity
      },
      why: why,
      confidence: haveCount >= 3 ? "high" : haveCount === 2 ? "medium" : "low"
    };
  }

  /* ----------------------------------------------------------
     goalMilestones — the INTERMEDIATE tier between daily targets
     and the long-term goal. Zero user input: derived entirely
     from the goal + body records.

     Amount goals (cut / lean-bulk): quarter checkpoints of the
     target amount, each with a projected date interpolated
     between the goal start and target date (or the healthy-rate
     finish when no date is set).
     No-amount goals (recomp / maintain / performance): weeks-on-
     plan checkpoints (2 / 4 / 8 / 12 weeks).

     Returns { mode: "amount"|"weeks", items: [{ label, sub,
       state: "done"|"current"|"upcoming" }] } or null without a
     goal. Exactly one item is "current" unless all are done. */
  function goalMilestones(goal, body, todayIso) {
    if (!goal) return null;
    var today = todayIso || U.todayISO();
    var t0 = dayNum(goal.date), tNow = dayNum(today);
    if (t0 == null || tNow == null) return null;
    var items = [];

    var t = GOAL_TYPES[goal.type] || GOAL_TYPES.maintain;
    var progress = goalProgress(goal, body);
    var targetKg = progress && progress.status === "ok" ? progress.targetKg : null;

    if (targetKg != null && targetKg > 0) {
      var achieved = Math.max(0, progress.achievedKg || 0);
      // finish line: the explicit target date, else the healthy-rate finish
      var tEnd = goal.targetDate ? dayNum(goal.targetDate) : null;
      if (tEnd == null || tEnd <= t0) {
        var weightNow = latestWeightKg(body) || 80;
        var rate = Math.max(0.1, weightNow * (goal.type === "cut" ? 0.0075 : 0.0025));
        tEnd = t0 + Math.ceil(targetKg / rate) * 7;
      }
      [0.25, 0.5, 0.75, 1].forEach(function (q) {
        var kg = Math.round(targetKg * q * 10) / 10;
        items.push({
          kg: kg,
          dir: t.dir,
          whenIso: isoFromDayNum(Math.round(t0 + (tEnd - t0) * q)),
          state: achieved >= kg - 0.05 ? "done" : "upcoming"
        });
      });
    } else {
      [2, 4, 8, 12].forEach(function (wk) {
        items.push({
          weeks: wk,
          state: tNow - t0 >= wk * 7 ? "done" : "upcoming"
        });
      });
    }
    for (var i = 0; i < items.length; i++) {
      if (items[i].state !== "done") { items[i].state = "current"; break; }
    }
    return { mode: targetKg != null && targetKg > 0 ? "amount" : "weeks", items: items };
  }

  /* ----------------------------------------------------------
     weeklyStatus — the WEEKLY goal tier. Training is a frequency
     behavior, not a daily one: a "train today" tile reads as a
     failure on every planned rest day (the classic broken-streak
     demotivator). Weekly frequency = the Fitbit/Hevy model.

     { exercise, body, today, daysPerWeek } ->
     { workouts: { done, target, dots: [7 x {done,isToday,future}] },
       weighIns: { done, target } }
     Week = calendar week starting Monday. */
  function weeklyStatus(data) {
    data = data || {};
    var today = data.today || U.todayISO();
    var tNow = dayNum(today);
    if (tNow == null) return null;
    // dayNum(1970-01-01)=0 was a Thursday -> Monday offset (dn+3)%7
    var monday = tNow - ((tNow + 3) % 7);
    var target = num(data.daysPerWeek);
    if (target == null || target < 1 || target > 7) target = 3;

    var trained = {};
    (data.exercise || []).forEach(function (r) {
      var d = dayNum(r && r.date);
      if (d != null && d >= monday && d < monday + 7) trained[d] = 1;
    });
    var dots = [];
    for (var i = 0; i < 7; i++) {
      dots.push({
        done: !!trained[monday + i],
        isToday: monday + i === tNow,
        future: monday + i > tNow
      });
    }
    var weighDays = {};
    (data.body || []).forEach(function (r) {
      var d = dayNum(r && r.date);
      if (d != null && d >= monday && d < monday + 7 && num(r.weightKg) != null) weighDays[d] = 1;
    });
    return {
      workouts: { done: Object.keys(trained).length, target: Math.round(target), dots: dots },
      weighIns: { done: Object.keys(weighDays).length, target: 2 }
    };
  }

  /* ---- how much power the engine has ----
     The adaptive loop can retune calories on its own. How far it may go
     without asking is the USER'S call, not ours:
       "ask"      – never change anything silently; every retune is a
                    proposal the user applies or declines
       "balanced" – (default) apply small corrections automatically and
                    tell the user afterwards; propose the big ones
       "full"     – apply everything, always explain after the fact
     Pure decision rule so the UI and the tests agree on one definition. */
  var AUTONOMY_LEVELS = ["ask", "balanced", "full"];
  var BALANCED_AUTO_KCAL = 150;   // |delta| at or under this is "small"

  function adaptationDecision(deltaCal, autonomy) {
    var d = Math.abs(Number(deltaCal) || 0);
    if (d === 0) return "none";
    if (AUTONOMY_LEVELS.indexOf(autonomy) < 0) autonomy = "balanced";
    if (autonomy === "full") return "apply";
    if (autonomy === "ask") return "propose";
    return d <= BALANCED_AUTO_KCAL ? "apply" : "propose";
  }

  return {
    AUTONOMY_LEVELS: AUTONOMY_LEVELS,
    BALANCED_AUTO_KCAL: BALANCED_AUTO_KCAL,
    adaptationDecision: adaptationDecision,
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
    intakeStats: intakeStats,
    suggestGoal: suggestGoal,
    goalMilestones: goalMilestones,
    weeklyStatus: weeklyStatus
  };
})();

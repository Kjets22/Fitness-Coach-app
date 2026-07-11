/* ============================================================
   insights-engine.js — pure analysis functions (NO DOM).

   Input arrays use the app's stored record shapes:
     sleep    { date(wake), bedTime, wakeTime, quality 1-5, durationMin }
     food     { date, time, mealType, foodName, calories, protein, carbs, fat }
     exercise { date, startTime, type, durationMin, intensity, performance 1-5 }
     body     { date, weightKg, bodyFatPct, muscleMassKg (legacy: muscleMassPct) }

   Every insight returns { status: "ok" | "insufficient", ... }.
   "insufficient" always carries a human `message` saying how much
   more data is needed. No NaN ever leaks out: values are either
   finite numbers or null.

   Entry point: OF.engine.analyzeAll({ sleep, food, exercise, body })
   ============================================================ */

window.OF = window.OF || {};

OF.engine = (function () {
  "use strict";
  var U = OF.util;

  var DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  /* ---------------- small math/date helpers ---------------- */

  function parseISO(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function dayNum(iso) {
    var d = parseISO(iso);
    return d ? Math.round(d.getTime() / 86400000) : null;
  }
  function weekdayOf(iso) {
    var d = parseISO(iso);
    return d ? d.getDay() : null;
  }
  function num(v) {
    if (v == null || v === "") return null; // Number(null) is 0 — missing is not zero
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function mean(arr) {
    if (!arr || !arr.length) return null;
    var s = 0, n = 0;
    for (var i = 0; i < arr.length; i++) {
      if (isFinite(arr[i])) { s += arr[i]; n++; }
    }
    return n ? s / n : null;
  }
  function round1(v) { return v == null ? null : Math.round(v * 10) / 10; }
  function round2(v) { return v == null ? null : Math.round(v * 100) / 100; }

  /** Pearson r for paired arrays. null when undefined (n<3 or zero variance). */
  function pearson(xs, ys) {
    var n = Math.min(xs.length, ys.length);
    if (n < 3) return null;
    var mx = mean(xs), my = mean(ys);
    if (mx == null || my == null) return null;
    var sxy = 0, sxx = 0, syy = 0;
    for (var i = 0; i < n; i++) {
      var dx = xs[i] - mx, dy = ys[i] - my;
      sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
    }
    if (sxx === 0 || syy === 0) return null;
    return sxy / Math.sqrt(sxx * syy);
  }

  /** Least-squares slope (y per unit x). null if <2 points or zero x-variance. */
  function slope(points) {
    if (!points || points.length < 2) return null;
    var xs = points.map(function (p) { return p.x; });
    var ys = points.map(function (p) { return p.y; });
    var mx = mean(xs), my = mean(ys);
    var sxy = 0, sxx = 0;
    for (var i = 0; i < points.length; i++) {
      sxy += (xs[i] - mx) * (ys[i] - my);
      sxx += (xs[i] - mx) * (xs[i] - mx);
    }
    return sxx === 0 ? null : sxy / sxx;
  }

  /** Confidence from sample size: < med -> low, < high -> medium, else high. */
  function conf(n, med, high) {
    return n >= high ? "high" : n >= med ? "medium" : "low";
  }

  /** Valid performance value from a workout record, or null. */
  function perfOf(r) {
    var p = num(r && r.performance);
    return p != null && p >= 1 && p <= 5 ? p : null;
  }

  function plural(n, word) { return n + " " + word + (n === 1 ? "" : "s"); }

  /**
   * Sleep-adjusted performance. Last night's sleep has a big effect on
   * performance, and by chance it can correlate with time-of-day, weekday
   * or training-streak groups and mask their real patterns. When enough
   * sleep+workout pairs exist (>= 8) we fit perf ~ sleepHours and subtract
   * the sleep effect, so group comparisons rank on the residual.
   * adjust(record) -> adjusted perf (falls back to raw perf when inactive
   * or when the workout's day has no sleep entry); null if perf invalid.
   */
  function buildSleepAdjuster(sleep, exercise) {
    var byDate = {};
    (sleep || []).forEach(function (s) {
      if (s && s.date && num(s.durationMin) != null) byDate[s.date] = num(s.durationMin) / 60;
    });
    var pts = [];
    (exercise || []).forEach(function (r) {
      var p = perfOf(r), h = byDate[r.date];
      if (p == null || h == null) return;
      pts.push({ x: h, y: p });
    });
    var active = false, sl = null, mx = null;
    if (pts.length >= 8) {
      sl = slope(pts);
      mx = mean(pts.map(function (p) { return p.x; }));
      if (sl != null && isFinite(sl) && mx != null) active = true;
    }
    return {
      active: active,
      adjust: function (r) {
        var p = perfOf(r);
        if (p == null) return null;
        if (!active) return p;
        var h = byDate[r.date];
        return h == null ? p : p - sl * (h - mx);
      }
    };
  }

  function identityAdjuster() {
    return { active: false, adjust: perfOf };
  }

  /* ============================================================
     1. OPTIMAL GYM TIME OF DAY
     ============================================================ */

  var BUCKETS = [
    { key: "morning", label: "Morning", range: "05–11", from: 5, to: 11 },
    { key: "midday", label: "Midday", range: "11–15", from: 11, to: 15 },
    { key: "afternoon", label: "Afternoon", range: "15–19", from: 15, to: 19 },
    { key: "evening", label: "Evening", range: "19–24", from: 19, to: 24 }
  ];
  var MIN_BUCKET = 3;

  function bucketIndexFor(startTime) {
    var min = U.timeToMinutes(startTime);
    if (min == null) return null;
    var h = min / 60;
    if (h < 5) return 3; // small hours count as (late) evening
    for (var i = 0; i < BUCKETS.length; i++) {
      if (h >= BUCKETS[i].from && h < BUCKETS[i].to) return i;
    }
    return 3;
  }

  function timeOfDay(exercise, adj) {
    adj = adj || identityAdjuster();
    var stats = BUCKETS.map(function (b) {
      return { key: b.key, label: b.label, range: b.range, count: 0, sum: 0, sumAdj: 0, avgPerf: null, avgAdj: null };
    });
    var total = 0;
    (exercise || []).forEach(function (r) {
      var p = perfOf(r);
      var bi = bucketIndexFor(r.startTime);
      if (p == null || bi == null) return;
      stats[bi].count++;
      stats[bi].sum += p;
      stats[bi].sumAdj += adj.adjust(r);
      total++;
    });
    stats.forEach(function (s) {
      s.avgPerf = s.count ? round1(s.sum / s.count) : null;
      s.avgAdj = s.count ? round2(s.sumAdj / s.count) : null;
    });

    var eligible = stats.filter(function (s) { return s.count >= MIN_BUCKET; });
    if (!eligible.length) {
      var most = stats.reduce(function (a, b) { return b.count > a.count ? b : a; }, stats[0]);
      var need = MIN_BUCKET - most.count;
      return {
        status: "insufficient", buckets: stats, total: total,
        message: total === 0
          ? "Log at least " + MIN_BUCKET + " workouts (with start times) to unlock this insight."
          : "Log " + plural(need, "more workout") + " in your most-used time slot — a recommendation needs " + MIN_BUCKET + "+ sessions in one slot."
      };
    }
    // Rank on sleep-adjusted performance so a lucky-sleep bucket can't win.
    eligible.sort(function (a, b) { return b.avgAdj - a.avgAdj || b.count - a.count; });
    var best = eligible[0];
    // Pick the weakest bucket on the SAME adjusted metric the winner was
    // chosen by — mixing raw and adjusted made the headline contradict
    // itself whenever the sleep adjuster flipped the ranking.
    var worst = null;
    eligible.forEach(function (s) {
      if (s === best) return;
      if (!worst || s.avgAdj < worst.avgAdj) worst = s;
    });
    return {
      status: "ok",
      buckets: stats,
      total: total,
      best: best,
      worstEligible: worst,
      adjustedForSleep: adj.active,
      confidence: conf(best.count, 5, 10)
    };
  }

  /* ============================================================
     2. OPTIMAL TRAINING DAYS (weekday analysis)
     ============================================================ */

  var MIN_PER_DAY = 2;

  function weekdays(exercise, adj) {
    adj = adj || identityAdjuster();
    var stats = [];
    for (var d = 0; d < 7; d++) {
      stats.push({ day: d, name: DAY_NAMES[d], abbr: DAY_ABBR[d], count: 0, sum: 0, sumAdj: 0, avgPerf: null, avgAdj: null });
    }
    var total = 0;
    (exercise || []).forEach(function (r) {
      var p = perfOf(r), wd = weekdayOf(r.date);
      if (p == null || wd == null) return;
      stats[wd].count++;
      stats[wd].sum += p;
      stats[wd].sumAdj += adj.adjust(r);
      total++;
    });
    stats.forEach(function (s) {
      s.avgPerf = s.count ? round1(s.sum / s.count) : null;
      s.avgAdj = s.count ? round2(s.sumAdj / s.count) : null;
    });

    var eligible = stats.filter(function (s) { return s.count >= MIN_PER_DAY; });
    if (eligible.length < 2) {
      return {
        status: "insufficient", stats: stats, total: total,
        message: total === 0
          ? "Log workouts on a few different weekdays (at least " + MIN_PER_DAY + " sessions on 2+ days) to unlock this insight."
          : "Need at least " + MIN_PER_DAY + " sessions on 2 or more different weekdays — keep logging for another week or two."
      };
    }
    var ranked = eligible.slice().sort(function (a, b) { return b.avgAdj - a.avgAdj || b.count - a.count; });
    var top = ranked.filter(function (s) { return s.avgAdj >= ranked[0].avgAdj - 0.3; }).slice(0, 4);
    if (!top.length) top = [ranked[0]];
    var worst = ranked.length > top.length ? ranked.slice(-Math.min(2, ranked.length - top.length)) : [];
    return {
      status: "ok",
      stats: stats,
      ranked: ranked,
      top: top,
      worst: worst,
      total: total,
      adjustedForSleep: adj.active,
      confidence: conf(total, 10, 20)
    };
  }

  /* ============================================================
     3. SLEEP -> PERFORMANCE
     ============================================================ */

  var MIN_SLEEP_PAIRS = 6;
  var GOOD_SLEEP_MIN = 7 * 60; // 7h

  function sleepPerformance(sleep, exercise) {
    // Map wake-date -> sleep record (last one wins if duplicates)
    var byDate = {};
    (sleep || []).forEach(function (s) {
      if (s && s.date && num(s.durationMin) != null) byDate[s.date] = s;
    });

    var pairs = [];
    (exercise || []).forEach(function (r) {
      var p = perfOf(r);
      var s = p != null && byDate[r.date];
      if (!s) return;
      pairs.push({ dur: num(s.durationMin), quality: num(s.quality), perf: p });
    });

    if (pairs.length < MIN_SLEEP_PAIRS) {
      var needP = MIN_SLEEP_PAIRS - pairs.length;
      return {
        status: "insufficient", n: pairs.length,
        message: "Need " + plural(needP, "more day") + " that have BOTH a sleep entry and a workout (have " +
          pairs.length + ", need " + MIN_SLEEP_PAIRS + ")."
      };
    }

    var durs = pairs.map(function (p) { return p.dur; });
    var perfs = pairs.map(function (p) { return p.perf; });
    var quals = pairs.filter(function (p) { return p.quality != null; });

    var rDur = pearson(durs, perfs);
    var rQual = quals.length >= 3
      ? pearson(quals.map(function (p) { return p.quality; }), quals.map(function (p) { return p.perf; }))
      : null;

    var good = pairs.filter(function (p) { return p.dur >= GOOD_SLEEP_MIN; });
    var short_ = pairs.filter(function (p) { return p.dur < GOOD_SLEEP_MIN; });
    var groupOk = good.length >= 3 && short_.length >= 3;
    var avgGood = good.length ? round1(mean(good.map(function (p) { return p.perf; }))) : null;
    var avgShort = short_.length ? round1(mean(short_.map(function (p) { return p.perf; }))) : null;

    // Sleep target: average sleep before strong (4+) sessions, else a sane default.
    var strongDurs = pairs.filter(function (p) { return p.perf >= 4; }).map(function (p) { return p.dur; });
    var targetH;
    if (strongDurs.length >= 3) {
      targetH = Math.round((mean(strongDurs) / 60) * 2) / 2; // nearest half hour
      targetH = Math.min(9, Math.max(7, targetH));
    } else {
      targetH = 7.5;
    }

    return {
      status: "ok",
      n: pairs.length,
      rDur: round2(rDur),
      rQual: round2(rQual),
      nGood: good.length, nShort: short_.length,
      avgPerfGood: avgGood, avgPerfShort: avgShort,
      groupComparisonOk: groupOk,
      targetH: targetH,
      confidence: conf(pairs.length, 10, 20)
    };
  }

  /* ============================================================
     4. REST-DAY RECOMMENDATION + READINESS
     ============================================================ */

  function consecutiveGroups(exercise, adj) {
    adj = adj || identityAdjuster();
    // streak length of each training DAY (1st, 2nd, 3rd+ consecutive day)
    var trainSet = {};
    (exercise || []).forEach(function (r) {
      var dn = dayNum(r.date);
      if (dn != null) trainSet[dn] = true;
    });
    var streakOf = {};
    Object.keys(trainSet).map(Number).sort(function (a, b) { return a - b; }).forEach(function (dn) {
      streakOf[dn] = trainSet[dn - 1] ? (streakOf[dn - 1] || 1) + 1 : 1;
    });
    var groups = [
      { key: 1, label: "1st day on", count: 0, sum: 0, sumAdj: 0, avgPerf: null, avgAdj: null },
      { key: 2, label: "2nd day in a row", count: 0, sum: 0, sumAdj: 0, avgPerf: null, avgAdj: null },
      { key: 3, label: "3rd+ day in a row", count: 0, sum: 0, sumAdj: 0, avgPerf: null, avgAdj: null }
    ];
    (exercise || []).forEach(function (r) {
      var p = perfOf(r), dn = dayNum(r.date);
      if (p == null || dn == null) return;
      var st = Math.min(streakOf[dn] || 1, 3);
      var g = groups[st - 1];
      g.count++; g.sum += p; g.sumAdj += adj.adjust(r);
    });
    groups.forEach(function (g) {
      g.avgPerf = g.count ? round1(g.sum / g.count) : null;
      g.avgAdj = g.count ? round2(g.sumAdj / g.count) : null;
    });
    return { groups: groups, trainSet: trainSet, streakOf: streakOf };
  }

  function restDays(exercise, weekdayResult, adj) {
    adj = adj || identityAdjuster();
    var cg = consecutiveGroups(exercise, adj);
    var g1 = cg.groups[0], g2 = cg.groups[1], g3 = cg.groups[2];

    if (g1.count < 3 || g2.count + g3.count < 3) {
      return {
        status: "insufficient", groups: cg.groups,
        message: "Need at least 3 workouts that were a 1st training day and 3 that were back-to-back days. Keep training (including some consecutive days) and this will unlock."
      };
    }

    // Detect the drop on sleep-adjusted numbers (raw ones are easily
    // confounded by how you happened to sleep on streak days).
    var DROP = 0.25;
    var dropAt2 = g2.count >= 3 && g1.avgAdj - g2.avgAdj >= DROP;
    // Baseline for the 3rd-day check: weighted mean of day-1 and day-2.
    var base12 = (g1.avgAdj * g1.count + g2.avgAdj * g2.count) / (g1.count + g2.count);
    var dropAt3 = g3.count >= 3 && base12 - g3.avgAdj >= DROP;

    var maxConsecutive, fatigueDetected;
    if (dropAt2) { maxConsecutive = 1; fatigueDetected = true; }
    else if (dropAt3) { maxConsecutive = 2; fatigueDetected = true; }
    else if (g3.count >= 3) { maxConsecutive = 3; fatigueDetected = false; }
    else { maxConsecutive = 2; fatigueDetected = false; }

    // Which weekday(s) to rest: lowest-performance weekdays from the weekday analysis.
    var restDayNames = [];
    if (weekdayResult && weekdayResult.status === "ok" && weekdayResult.worst.length) {
      restDayNames = weekdayResult.worst.map(function (s) { return s.name; });
    }

    return {
      status: "ok",
      groups: cg.groups,
      dropAt2: dropAt2, dropAt3: dropAt3,
      fatigueDetected: fatigueDetected,
      maxConsecutive: maxConsecutive,
      restDayNames: restDayNames,
      adjustedForSleep: adj.active,
      confidence: conf(Math.min(g1.count, g2.count + g3.count), 5, 10)
    };
  }

  function readiness(sleep, exercise, maxConsecutive) {
    var hasSleep = (sleep || []).length > 0;
    var hasEx = (exercise || []).length > 0;
    if (!hasSleep && !hasEx) {
      return {
        status: "insufficient",
        message: "Log a few nights of sleep and a few workouts to get a daily readiness check."
      };
    }
    maxConsecutive = maxConsecutive || 3;
    var today = U.todayISO();
    var todayNum = dayNum(today);
    var score = 70;
    var factors = [];

    // --- last night's sleep vs personal average ---
    var durations = (sleep || []).map(function (s) { return num(s.durationMin); })
      .filter(function (v) { return v != null; });
    var avgDur = mean(durations);
    var lastNight = null;
    (sleep || []).forEach(function (s) {
      if (s.date === today && num(s.durationMin) != null) lastNight = s;
    });
    if (lastNight && avgDur != null && durations.length >= 3) {
      var diff = num(lastNight.durationMin) - avgDur;
      if (diff >= 20) { score += 10; factors.push({ good: true, text: "Slept " + U.fmtDuration(num(lastNight.durationMin)) + " — above your " + U.fmtDuration(Math.round(avgDur)) + " average" }); }
      else if (diff <= -60) { score -= 20; factors.push({ good: false, text: "Slept only " + U.fmtDuration(num(lastNight.durationMin)) + " — well under your " + U.fmtDuration(Math.round(avgDur)) + " average" }); }
      else { factors.push({ good: true, text: "Sleep near your average (" + U.fmtDuration(num(lastNight.durationMin)) + ")" }); }
      var q = num(lastNight.quality);
      if (q != null && q >= 4) { score += 5; factors.push({ good: true, text: "Sleep quality " + q + "/5" }); }
      else if (q != null && q <= 2) { score -= 10; factors.push({ good: false, text: "Sleep quality only " + q + "/5" }); }
    } else if (lastNight) {
      factors.push({ good: null, text: "Slept " + U.fmtDuration(num(lastNight.durationMin)) + " — a few more logged nights and this gets compared to your average" });
    } else {
      factors.push({ good: null, text: "No sleep logged for last night — log it for a sharper readiness score" });
    }

    // --- consecutive training days ---
    var trainSet = {};
    (exercise || []).forEach(function (r) {
      var dn = dayNum(r.date);
      if (dn != null) trainSet[dn] = true;
    });
    var streak = 0;
    var d = trainSet[todayNum] ? todayNum : todayNum - 1;
    while (trainSet[d]) { streak++; d--; }
    if (streak >= maxConsecutive) {
      score -= 25;
      factors.push({ good: false, text: "Trained " + plural(streak, "day") + " in a row (your data suggests max " + maxConsecutive + ")" });
    } else if (streak > 0 && streak === maxConsecutive - 1) {
      score -= 10;
      factors.push({ good: false, text: "Trained " + plural(streak, "day") + " in a row — one more is fine, then rest" });
    } else if (streak === 0 && hasEx) {
      score += 10;
      factors.push({ good: true, text: "Rested yesterday — legs should be fresh" });
    } else if (streak > 0) {
      factors.push({ good: true, text: "Trained " + plural(streak, "day") + " in a row — within your limit" });
    }

    // --- hours since last workout ---
    var lastEnd = null;
    (exercise || []).forEach(function (r) {
      var dn = dayNum(r.date), st = U.timeToMinutes(r.startTime);
      if (dn == null || st == null) return;
      var end = dn * 1440 + st + (num(r.durationMin) || 60);
      if (lastEnd == null || end > lastEnd) lastEnd = end;
    });
    if (lastEnd != null) {
      var nowMin = todayNum * 1440 + (new Date().getHours() * 60 + new Date().getMinutes());
      var hoursSince = (nowMin - lastEnd) / 60;
      if (hoursSince >= 0 && hoursSince < 8) {
        score -= 15;
        factors.push({ good: false, text: "Last workout ended only " + Math.max(0, Math.round(hoursSince)) + "h ago" });
      } else if (hoursSince >= 48) {
        score += 5;
        factors.push({ good: true, text: Math.round(hoursSince / 24) + "+ days since your last workout" });
      }
    }

    score = Math.max(0, Math.min(100, Math.round(score)));
    var level = score >= 75 ? "high" : score >= 50 ? "medium" : "low";
    var verdict = level === "high" ? "Good to train hard today"
      : level === "medium" ? "OK to train — keep intensity moderate"
      : "Consider a rest day or light session today";

    return { status: "ok", score: score, level: level, verdict: verdict, factors: factors };
  }

  /* ============================================================
     5. OPTIMAL FOOD
     ============================================================ */

  var PRE_WINDOW_MIN = 180; // meal within 3h before session
  var HIGH_CARB_G = 40;
  var PROTEIN_TARGET = 1.6; // g per kg bodyweight

  function foodInsights(food, exercise, body) {
    var byDate = {};
    (food || []).forEach(function (f) {
      if (!f || !f.date) return;
      (byDate[f.date] = byDate[f.date] || []).push(f);
    });

    /* --- pre-workout meal vs none --- */
    function prevDateISO(iso) {
      var pm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
      if (!pm) return null;
      var pd = new Date(Date.UTC(+pm[1], +pm[2] - 1, +pm[3] - 1, 12));
      return pd.getUTCFullYear() + "-" + String(pd.getUTCMonth() + 1).padStart(2, "0") +
        "-" + String(pd.getUTCDate()).padStart(2, "0");
    }
    var withPre = [], withoutPre = [];
    (exercise || []).forEach(function (w) {
      var p = perfOf(w), start = U.timeToMinutes(w.startTime);
      if (p == null || start == null) return;
      var pre = null, preT = -Infinity;
      (byDate[w.date] || []).forEach(function (m) {
        var t = U.timeToMinutes(m.time);
        if (t == null || t >= start || t < start - PRE_WINDOW_MIN) return;
        if (t > preT) { preT = t; pre = m; }
      });
      // A session just after midnight: a meal late the PREVIOUS evening is
      // still a pre-workout meal — the window crosses the calendar boundary.
      if (start < PRE_WINDOW_MIN) {
        var pd = prevDateISO(w.date);
        (byDate[pd] || []).forEach(function (m) {
          var t = U.timeToMinutes(m.time);
          if (t == null) return;
          var tt = t - 1440;   // relative to the workout's day
          if (tt >= start || tt < start - PRE_WINDOW_MIN) return;
          if (tt > preT) { preT = tt; pre = m; }
        });
      }
      if (pre) withPre.push({ perf: p, carbs: num(pre.carbs) });
      else withoutPre.push({ perf: p });
    });

    var pre;
    if (withPre.length >= 3 && withoutPre.length >= 3) {
      pre = {
        status: "ok",
        nWith: withPre.length, nWithout: withoutPre.length,
        avgWith: round1(mean(withPre.map(function (x) { return x.perf; }))),
        avgWithout: round1(mean(withoutPre.map(function (x) { return x.perf; }))),
        confidence: conf(Math.min(withPre.length, withoutPre.length), 5, 10)
      };
      pre.better = pre.avgWith - pre.avgWithout >= 0.2 ? "with" :
        pre.avgWithout - pre.avgWith >= 0.2 ? "without" : "even";
    } else {
      pre = {
        status: "insufficient",
        nWith: withPre.length, nWithout: withoutPre.length,
        message: "Need 3+ workouts WITH a meal in the 3h before and 3+ without (have " +
          withPre.length + " / " + withoutPre.length + ")."
      };
    }

    /* --- high-carb vs low-carb pre-workout meals --- */
    var withCarbData = withPre.filter(function (x) { return x.carbs != null; });
    var hi = withCarbData.filter(function (x) { return x.carbs >= HIGH_CARB_G; });
    var lo = withCarbData.filter(function (x) { return x.carbs < HIGH_CARB_G; });
    var carbs;
    if (hi.length >= 3 && lo.length >= 3) {
      carbs = {
        status: "ok",
        nHigh: hi.length, nLow: lo.length,
        avgHigh: round1(mean(hi.map(function (x) { return x.perf; }))),
        avgLow: round1(mean(lo.map(function (x) { return x.perf; }))),
        confidence: conf(Math.min(hi.length, lo.length), 5, 8)
      };
      carbs.better = carbs.avgHigh - carbs.avgLow >= 0.2 ? "high" :
        carbs.avgLow - carbs.avgHigh >= 0.2 ? "low" : "even";
    } else {
      carbs = {
        status: "insufficient",
        nHigh: hi.length, nLow: lo.length,
        avgCarbsPre: withCarbData.length ? Math.round(mean(withCarbData.map(function (x) { return x.carbs; }))) : null,
        message: "Need 3+ high-carb (≥" + HIGH_CARB_G + "g) and 3+ lower-carb pre-workout meals to compare (have " +
          hi.length + " / " + lo.length + ")."
      };
    }

    /* --- daily protein vs bodyweight target --- */
    var todayNum = dayNum(U.todayISO());
    var dailyProtein = {};
    (food || []).forEach(function (f) {
      var dn = dayNum(f.date), pr = num(f.protein);
      if (dn == null || pr == null) return;
      if (todayNum - dn > 14 || todayNum - dn < 0) return; // last 14 days
      dailyProtein[dn] = (dailyProtein[dn] || 0) + pr;
    });
    var proteinDays = Object.keys(dailyProtein).map(function (k) { return dailyProtein[k]; });
    var latestWeight = null;
    (body || []).slice().sort(function (a, b) { return (a.date || "") < (b.date || "") ? -1 : 1; })
      .forEach(function (r) { if (num(r.weightKg) != null) latestWeight = num(r.weightKg); });

    var protein;
    if (proteinDays.length >= 3 && latestWeight) {
      var avgP = mean(proteinDays);
      var gPerKg = avgP / latestWeight;
      protein = {
        status: "ok",
        nDays: proteinDays.length,
        avgProteinG: Math.round(avgP),
        weightKg: latestWeight,
        gPerKg: round2(gPerKg),
        targetGPerKg: PROTEIN_TARGET,
        targetG: Math.round(PROTEIN_TARGET * latestWeight),
        meetsTarget: gPerKg >= PROTEIN_TARGET,
        confidence: conf(proteinDays.length, 7, 12)
      };
    } else {
      protein = {
        status: "insufficient",
        message: !latestWeight
          ? "Log a body-weight measurement so protein intake can be compared to the " + PROTEIN_TARGET + " g/kg target."
          : "Log meals (with protein grams) on " + plural(3 - proteinDays.length, "more day") + " in the last 2 weeks."
      };
    }

    var anyOk = pre.status === "ok" || carbs.status === "ok" || protein.status === "ok";
    return {
      status: anyOk ? "ok" : "insufficient",
      pre: pre, carbs: carbs, protein: protein,
      message: anyOk ? null : "Not enough food + workout data yet. " + pre.message
    };
  }

  /* ============================================================
     6. TREND SUMMARY (30-day linear trends for body metrics)
     ============================================================ */

  var TREND_WINDOW_DAYS = 30;
  var TREND_MIN_POINTS = 3;
  var TREND_MIN_SPAN = 10; // days between first and last point

  function bodyTrends(body) {
    var todayNum = dayNum(U.todayISO());
    var defs = [
      { key: "weightKg", label: "Weight", unit: "kg", stableBelow: 0.5, goodDir: null },
      { key: "bodyFatPct", label: "Body fat", unit: "%", stableBelow: 0.5, goodDir: "down" },
      // muscle mass is a weight (kg canonical; legacy % records convert via U.muscleKg)
      { key: "muscleMassKg", get: U.muscleKg, label: "Muscle mass", unit: "kg", stableBelow: 0.5, goodDir: "up" }
    ];
    var metrics = {};
    var anyOk = false;

    defs.forEach(function (def) {
      var pts = [];
      (body || []).forEach(function (r) {
        var dn = dayNum(r.date), v = num(def.get ? def.get(r) : r[def.key]);
        if (dn == null || v == null) return;
        if (todayNum - dn > TREND_WINDOW_DAYS || todayNum - dn < 0) return;
        pts.push({ x: dn, y: v });
      });
      pts.sort(function (a, b) { return a.x - b.x; });
      var span = pts.length ? pts[pts.length - 1].x - pts[0].x : 0;

      if (pts.length < TREND_MIN_POINTS || span < TREND_MIN_SPAN) {
        metrics[def.key] = {
          status: "insufficient", label: def.label, unit: def.unit,
          message: pts.length < TREND_MIN_POINTS
            ? "Need " + plural(TREND_MIN_POINTS - pts.length, "more measurement") + " in the last " + TREND_WINDOW_DAYS + " days."
            : "Measurements need to span at least " + TREND_MIN_SPAN + " days."
        };
        return;
      }
      var sl = slope(pts);
      var delta30 = sl == null ? null : sl * TREND_WINDOW_DAYS;
      var dir = delta30 == null || Math.abs(delta30) < def.stableBelow ? "stable"
        : delta30 > 0 ? "up" : "down";
      var verdict = dir === "stable" ? "stable"
        : def.goodDir == null ? dir // weight: direction depends on the user's goal
        : dir === def.goodDir ? "improving" : "declining";
      metrics[def.key] = {
        status: "ok", label: def.label, unit: def.unit,
        n: pts.length,
        latest: pts[pts.length - 1].y,
        delta30: round1(delta30),
        direction: dir,
        verdict: verdict,
        confidence: conf(pts.length, 5, 8)
      };
      anyOk = true;
    });

    return {
      status: anyOk ? "ok" : "insufficient",
      metrics: metrics,
      message: anyOk ? null : "Log body measurements (2–3 per week) for " + TREND_MIN_SPAN + "+ days to see trends."
    };
  }

  /* ============================================================
     7. WEEKLY PLAN (synthesis of everything above)
     ============================================================ */

  function weeklyPlan(r) {
    if (r.weekdays.status !== "ok" || r.timeOfDay.status !== "ok") {
      return {
        status: "insufficient",
        message: "The weekly plan unlocks once the time-of-day and weekday insights have enough data — keep logging workouts."
      };
    }
    var maxConsec = r.rest.status === "ok" ? r.rest.maxConsecutive : 2;

    // Candidate training days: best-performing weekdays; fall back to most-trained.
    var candidates = r.weekdays.ranked.slice(0, Math.min(5, r.weekdays.ranked.length));
    // Don't schedule training on a day the rest card simultaneously names as a
    // best day to rest — the two cards would contradict each other on the same
    // screen. Only when enough other candidates exist.
    if (r.rest.status === "ok" && Array.isArray(r.rest.restDayNames) && r.rest.restDayNames.length) {
      var nonRest = candidates.filter(function (s) {
        return !s.name || r.rest.restDayNames.indexOf(s.name) === -1;
      });
      if (nonRest.length >= 2) candidates = nonRest;
    }
    var chosen = {};
    candidates.slice(0, 4).forEach(function (s) { chosen[s.day] = s; });

    // Enforce the max-consecutive-days constraint on the CIRCULAR week (a
    // Sat/Sun/Mon/Tue run wraps the Sun->Mon boundary — a single Mon..Sun
    // pass never saw it): walk two concatenated weeks; when a run gets too
    // long, drop the weakest day in the run.
    var weekOrder = [1, 2, 3, 4, 5, 6, 0]; // Mon..Sun
    var walk = weekOrder.concat(weekOrder);
    var changed = true;
    while (changed) {
      changed = false;
      var run = [];
      for (var i = 0; i < walk.length; i++) {
        var day = walk[i];
        if (chosen[day]) {
          if (run.indexOf(day) !== -1) break;   // came full circle (every chosen day in one run)
          run.push(day);
          if (run.length > maxConsec) {
            var weakest = run.reduce(function (a, b) {
              return (chosen[a].avgPerf <= chosen[b].avgPerf) ? a : b;
            });
            delete chosen[weakest];
            changed = true;
            break;
          }
        } else {
          run = [];
        }
      }
    }

    var trainDays = weekOrder.filter(function (d) { return chosen[d]; });
    var restDays_ = weekOrder.filter(function (d) { return !chosen[d]; });
    if (!trainDays.length) {
      return { status: "insufficient", message: "Not enough weekday data to build a plan yet." };
    }

    var parts = [];
    parts.push("Train " + trainDays.map(function (d) { return DAY_ABBR[d]; }).join("/") +
      " in the " + r.timeOfDay.best.label.toLowerCase() +
      " (" + r.timeOfDay.best.range + "h)");
    parts.push("rest " + restDays_.map(function (d) { return DAY_ABBR[d]; }).join("/"));
    if (r.food.pre.status === "ok" && r.food.pre.better === "with") {
      parts.push("eat a meal 1–3h before training" +
        (r.food.carbs.status === "ok" && r.food.carbs.better === "high" ? " (carb-rich works best for you)" :
          r.food.carbs.status === "insufficient" && r.food.carbs.avgCarbsPre != null ? " (~" + r.food.carbs.avgCarbsPre + "g carbs has worked)" : ""));
    } else if (r.food.carbs.status === "ok" && r.food.carbs.better === "high") {
      parts.push("make your pre-workout meal carb-rich (≥" + HIGH_CARB_G + "g carbs, ~2h before)");
    }
    if (r.sleep.status === "ok") {
      parts.push("aim for " + r.sleep.targetH + "h sleep");
    }
    if (r.food.protein.status === "ok" && !r.food.protein.meetsTarget) {
      parts.push("bump protein toward " + r.food.protein.targetG + "g/day");
    }

    var confs = [r.timeOfDay.confidence, r.weekdays.confidence];
    if (r.rest.status === "ok") confs.push(r.rest.confidence);
    var confidence = confs.indexOf("low") !== -1 ? "low" : confs.indexOf("medium") !== -1 ? "medium" : "high";

    return {
      status: "ok",
      trainDays: trainDays,
      restDays: restDays_,
      maxConsecutive: maxConsec,
      text: "Suggested week: " + parts.join("; ") + ".",
      confidence: confidence
    };
  }

  /* ============================================================
     Entry point
     ============================================================ */

  function analyzeAll(data) {
    data = data || {};
    var sleep = data.sleep || [], food = data.food || [];
    var exercise = data.exercise || [], body = data.body || [];

    var adj = buildSleepAdjuster(sleep, exercise);
    var r = {};
    r.sleepAdjusted = adj.active;
    r.timeOfDay = timeOfDay(exercise, adj);
    r.weekdays = weekdays(exercise, adj);
    r.sleep = sleepPerformance(sleep, exercise);
    r.rest = restDays(exercise, r.weekdays, adj);
    r.readiness = readiness(sleep, exercise, r.rest.status === "ok" ? r.rest.maxConsecutive : 3);
    r.food = foodInsights(food, exercise, body);
    r.trends = bodyTrends(body);
    r.plan = weeklyPlan(r);
    return r;
  }

  return {
    analyzeAll: analyzeAll,
    buildSleepAdjuster: buildSleepAdjuster,
    timeOfDay: timeOfDay,
    weekdays: weekdays,
    sleepPerformance: sleepPerformance,
    restDays: restDays,
    readiness: readiness,
    foodInsights: foodInsights,
    bodyTrends: bodyTrends,
    weeklyPlan: weeklyPlan,
    DAY_NAMES: DAY_NAMES,
    DAY_ABBR: DAY_ABBR
  };
})();

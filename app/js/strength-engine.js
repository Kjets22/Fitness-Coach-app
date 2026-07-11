/* ============================================================
   strength-engine.js — training-effectiveness analysis for
   per-exercise set logging (NO DOM, no storage writes).

   Input: exercise records that may carry
     exercises: [{ name, sets: [{ weightKg: number|null, reps }] }]
   (weightKg null = bodyweight movement) plus sleep/food/body
   records and the active goal, all in the app's stored shapes.

   Everything returns { status: "ok" | "insufficient" } with a
   human message saying exactly what to log when insufficient.
   No NaN ever leaks: values are finite numbers or null.
   All weights are kg internally; human-readable MESSAGE strings
   use U.fmtWeight (display units) because they go straight to
   the UI/coach — structured numbers stay metric.

   Key formulas / thresholds:
     est 1RM        Epley: w × (1 + reps/30), best set per session
     trend          least-squares slope of session e1RM over the
                    last 84 days (12 wk), expressed as %/week
     verdict        improving ≥ +0.3 %/wk · stalling = no new e1RM
                    (>0.5% over prior best) for ≥14 days across ≥2
                    sessions, last session within 21 days ·
                    inactive = not trained in 28+ days · else flat
     PR             all-time best e1RM (and best set by weight);
                    "recent" = within the last 7 days
     weekly volume  Σ weight×reps over rolling 7-day blocks (8)
     rep-range fit  sets in the last 56 days vs the goal's band:
                    performance 3–6 · bulk/recomp/cut 6–12 ·
                    maintain/none = any
     stall check    prior-night sleep avg on stalled vs progressing
                    session days (flag diff ≥ 0.4 h) → protein vs
                    target (flag < 90%) → consecutive-training-day
                    share (flag +0.25) → generic programming advice

   Entry: OF.strength.analyze({exercise, sleep, food, body,
                               goalType, proteinTargetG})
          OF.strength.coachSummary(result)  — compact block for
          the AI-coach context (≤ ~1 KB).
   ============================================================ */

window.OF = window.OF || {};

OF.strength = (function () {
  "use strict";
  var U = OF.util;

  var DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  var MIN_SESSIONS = 3;        // sessions before an exercise is reported
  var TREND_WINDOW_DAYS = 84;  // 12 weeks
  var IMPROVE_EPS = 1.005;     // e1RM must beat the prior best by >0.5%
  var EPLEY_MAX_REPS = 12;     // Epley e1RM only valid to ~12 reps; higher-rep sets are ignored for e1RM/PR/trend (still counted for volume + rep-range)
  var STALL_MIN_DAYS = 14;     // no improvement for 2+ weeks ...
  var STALL_MIN_SESSIONS = 2;  // ... across 2+ sessions = stalled
  var STALL_ACTIVE_DAYS = 21;  // must still be training it to call it a stall
  var INACTIVE_DAYS = 28;      // untrained this long = "inactive", not stalled
  var PR_RECENT_DAYS = 7;
  var REP_WINDOW_DAYS = 56;    // 8 weeks of sets for the rep-range picture
  var VOL_WEEKS = 8;
  var SLEEP_DIFF_H = 0.4;      // sleep gap worth calling out (hours)
  var PROTEIN_LOW_FRAC = 0.9;  // < 90% of target = flagged in stall check
  var STREAK_DIFF = 0.25;      // back-to-back-day share gap worth calling out

  /* Rep band per goal type (null = any range is fine). */
  var GOAL_BANDS = {
    "performance": { lo: 3, hi: 6, label: "3–6" },
    "lean-bulk": { lo: 6, hi: 12, label: "6–12" },
    "recomp": { lo: 6, hi: 12, label: "6–12" },
    "cut": { lo: 6, hi: 12, label: "6–12" }
  };

  /* ---------------- small helpers (match insights-engine style) ---------------- */

  function parseISO(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function dayNum(iso) {
    // UTC-noon form — identical to targets-engine/dashboard so receipt day
    // numbers agree in every timezone (local-midnight was a day off in UTC+13/14)
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    if (!m) return null;
    return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], 12) / 86400000);
  }
  function num(v) {
    if (v == null || v === "") return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function mean(arr) {
    if (!arr || !arr.length) return null;
    var s = 0, n = 0;
    for (var i = 0; i < arr.length; i++) if (isFinite(arr[i])) { s += arr[i]; n++; }
    return n ? s / n : null;
  }
  function round1(v) { return v == null ? null : Math.round(v * 10) / 10; }
  function round2(v) { return v == null ? null : Math.round(v * 100) / 100; }
  function slope(points) {
    if (!points || points.length < 2) return null;
    var mx = mean(points.map(function (p) { return p.x; }));
    var my = mean(points.map(function (p) { return p.y; }));
    var sxy = 0, sxx = 0;
    for (var i = 0; i < points.length; i++) {
      sxy += (points[i].x - mx) * (points[i].y - my);
      sxx += (points[i].x - mx) * (points[i].x - mx);
    }
    return sxx === 0 ? null : sxy / sxx;
  }
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
  function conf(n, med, high) { return n >= high ? "high" : n >= med ? "medium" : "low"; }
  function plural(n, w) { return n + " " + w + (n === 1 ? "" : "s"); }

  /** Epley estimated 1RM. reps 1 -> the weight itself. */
  function epley(w, reps) { return w * (1 + reps / 30); }

  /** kg for messages, in the user's display unit. */
  function fmtW(kg) { return U.fmtWeight ? U.fmtWeight(kg, 1) : (round1(kg) + " kg"); }

  /** A set is usable when reps is 1..100; weightKg may be null (bodyweight). */
  function validSet(s) {
    if (!s || typeof s !== "object") return null;
    var reps = num(s.reps);
    if (reps == null) return null;
    reps = Math.round(reps);
    if (reps < 1 || reps > 100) return null;
    var w = num(s.weightKg);
    if (w != null && (w < 0 || w > 500)) return null;
    return { weightKg: w, reps: reps };
  }

  /* ---------------- session collection ---------------- */

  /**
   * Group logged sets per exercise name per DAY.
   * Returns { byName: { key: { name, days: {dayNum: session} } }, totalSets }
   * where session = { date, day, sets, volumeKg, best, e1RM }.
   */
  function collect(exercise) {
    var byName = {}, totalSets = 0;
    (exercise || []).forEach(function (rec) {
      if (!rec || !Array.isArray(rec.exercises)) return;
      var dn = dayNum(rec.date);
      if (dn == null) return;
      rec.exercises.forEach(function (ex) {
        if (!ex || typeof ex.name !== "string" || !Array.isArray(ex.sets)) return;
        var name = ex.name.trim().slice(0, 80);
        if (!name) return;
        var key = name.toLowerCase();
        var sets = [];
        ex.sets.forEach(function (s) {
          var v = validSet(s);
          if (v) sets.push(v);
        });
        if (!sets.length) return;
        totalSets += sets.length;
        var e = byName[key] || (byName[key] = { name: name, days: {} });
        e.name = name; // latest spelling wins for display
        var sess = e.days[dn] || (e.days[dn] = { date: rec.date, day: dn, sets: [] });
        sess.sets = sess.sets.concat(sets);
      });
    });
    // finish each session: volume, best weighted set, e1RM
    Object.keys(byName).forEach(function (k) {
      var days = byName[k].days;
      Object.keys(days).forEach(function (dn) {
        var s = days[dn];
        var vol = 0, best = null, bestE = null;
        s.sets.forEach(function (set) {
          if (set.weightKg != null) {
            vol += set.weightKg * set.reps;                 // volume: every weighted set
            if (set.reps <= EPLEY_MAX_REPS) {               // e1RM/best: only reps where Epley is valid
              var e = epley(set.weightKg, set.reps);
              if (bestE == null || e > bestE) { bestE = e; best = set; }
            }
          }
        });
        s.volumeKg = round1(vol);
        s.best = best;                       // null when all sets bodyweight
        s.e1RM = bestE == null ? null : round1(bestE);
      });
    });
    return { byName: byName, totalSets: totalSets };
  }

  /* ---------------- per-exercise analysis ---------------- */

  function analyzeExercise(name, sessions, todayNum) {
    sessions.sort(function (a, b) { return a.day - b.day; });
    var n = sessions.length;
    var weighted = sessions.filter(function (s) { return s.e1RM != null; });
    var last = sessions[n - 1];

    // All-time bests + last-improvement walk (on weighted sessions).
    var bestE1RM = null, bestE1RMDate = null, bestE1RMDay = null;
    var bestSet = null, bestSetDate = null;
    var lastImproveDay = weighted.length ? weighted[0].day : null;
    var lastImproveDate = weighted.length ? weighted[0].date : null;
    var rollingMax = null;
    weighted.forEach(function (s) {
      if (rollingMax == null || s.e1RM > rollingMax * IMPROVE_EPS) {
        rollingMax = s.e1RM;
        lastImproveDay = s.day; lastImproveDate = s.date;
      }
      if (bestE1RM == null || s.e1RM > bestE1RM) {
        bestE1RM = s.e1RM; bestE1RMDate = s.date; bestE1RMDay = s.day;
      }
      var b = s.best;
      if (b && (!bestSet || b.weightKg > bestSet.weightKg ||
        (b.weightKg === bestSet.weightKg && b.reps > bestSet.reps))) {
        bestSet = b; bestSetDate = s.date;
      }
    });

    // Trend: e1RM %/week over the last 84 days.
    var trendPts = weighted
      .filter(function (s) { return todayNum - s.day <= TREND_WINDOW_DAYS; })
      .map(function (s) { return { x: s.day, y: s.e1RM }; });
    var trendPctWk = null;
    if (trendPts.length >= 3) {
      var sl = slope(trendPts);
      var m = mean(trendPts.map(function (p) { return p.y; }));
      if (sl != null && m) trendPctWk = round1(sl * 7 / m * 100);
    }

    // Stall: no new e1RM for 14+ days across 2+ sessions, still being trained.
    var stalledSessions = weighted.filter(function (s) { return s.day > lastImproveDay; });
    var stalled = weighted.length >= MIN_SESSIONS &&
      lastImproveDay != null &&
      stalledSessions.length >= STALL_MIN_SESSIONS &&
      (todayNum - lastImproveDay) >= STALL_MIN_DAYS &&
      (todayNum - last.day) <= STALL_ACTIVE_DAYS;

    var verdict;
    if (todayNum - last.day > INACTIVE_DAYS) verdict = "inactive";
    else if (stalled) verdict = "stalling";
    else if (trendPctWk != null && trendPctWk >= 0.3) verdict = "improving";
    else verdict = "flat";

    // A "recent PR" must clear the same IMPROVE_EPS bar as lastImproveDay, so an
    // exercise can't be BOTH stalling and recentPR (a sub-0.5% new absolute max is
    // not a real PR). PR_RECENT_DAYS (7) < STALL_MIN_DAYS (14) keeps them exclusive.
    var recentPR = lastImproveDay != null && (todayNum - lastImproveDay) <= PR_RECENT_DAYS;

    // Weekday frequency (for "keep doing X" callouts): days with 2+ sessions.
    var wdCount = [0, 0, 0, 0, 0, 0, 0];
    sessions.forEach(function (s) {
      var d = parseISO(s.date);
      if (d) wdCount[d.getDay()]++;
    });
    var freqDays = [];
    wdCount.forEach(function (c, i) { if (c >= 2) freqDays.push(DAY_ABBR[i]); });

    return {
      name: name,
      sessions: n,
      lastDate: last.date,
      daysSinceLast: todayNum - last.day,
      latestE1RMKg: weighted.length ? weighted[weighted.length - 1].e1RM : null,
      bestE1RM: bestE1RM != null ? { kg: bestE1RM, date: bestE1RMDate } : null,
      bestSet: bestSet ? { weightKg: bestSet.weightKg, reps: bestSet.reps, date: bestSetDate } : null,
      recentPR: recentPR,
      trendPctWk: trendPctWk,
      verdict: verdict,
      confidence: conf(n, 5, 8),
      series: weighted.slice(-14).map(function (s) { return { x: s.day, y: s.e1RM }; }),
      freqDays: freqDays,
      stall: stalled ? {
        sinceDate: lastImproveDate,
        weeks: Math.max(1, Math.round((todayNum - lastImproveDay) / 7)),
        bestE1RMKg: round1(rollingMax),   // plateau value AT lastImproveDay (epsilon-gated), not the epsilon-free absolute max
        stalledDates: stalledSessions.map(function (s) { return s.date; }),
        progressDates: weighted.filter(function (s) { return s.day <= lastImproveDay; })
          .map(function (s) { return s.date; }),
        stalledBestE1RMKg: round1(Math.max.apply(null,
          stalledSessions.map(function (s) { return s.e1RM; })))
      } : null,
      _sessions: sessions // internal (volume aggregation); stripped from coach summary
    };
  }

  /* ---------------- overall pictures ---------------- */

  function weeklyVolume(exList, todayNum) {
    var weeks = [];
    for (var w = VOL_WEEKS - 1; w >= 0; w--) {
      var end = todayNum - 7 * w, start = end - 6;
      var vol = 0, nSets = 0;
      exList.forEach(function (ex) {
        ex._sessions.forEach(function (s) {
          if (s.day >= start && s.day <= end) {
            vol += s.volumeKg || 0;
            nSets += s.sets.length;
          }
        });
      });
      var iso = U.todayISO(-(7 * w));                    // block end date
      var m = /^\d{4}-(\d{2})-(\d{2})$/.exec(iso);
      weeks.push({
        label: m ? (+m[1]) + "/" + (+m[2]) : iso,
        endISO: iso,
        volumeKg: round1(vol),
        sets: nSets
      });
    }
    var latest = weeks[weeks.length - 1];
    var nonzero = weeks.filter(function (x) { return x.volumeKg > 0; });
    if (nonzero.length < 2) {
      return {
        status: "insufficient", weeks: weeks,
        message: "Log sets (weight × reps) in at least 2 different weeks to see your volume trend."
      };
    }
    // Fit the trend only up to the last week with volume — trailing zero-volume weeks
    // (user just hasn't logged lately) otherwise drag the slope hugely negative.
    var lastLogged = 0;
    for (var li = weeks.length - 1; li >= 0; li--) {
      if (weeks[li].volumeKg > 0) { lastLogged = li; break; }
    }
    var trendWeeks = weeks.slice(0, lastLogged + 1);
    return {
      status: "ok",
      weeks: weeks,
      latestKg: latest.volumeKg,
      avgKg: round1(mean(nonzero.map(function (x) { return x.volumeKg; }))),
      trendKgPerWeek: round1(slope(trendWeeks.map(function (x, i) { return { x: i, y: x.volumeKg }; })))
    };
  }

  function repRange(exList, todayNum, goalType) {
    var buckets = { low: 0, mid: 0, high: 0 };  // 1–5 / 6–12 / 13+
    var total = 0, inBand = 0;
    var band = goalType && GOAL_BANDS[goalType] ? GOAL_BANDS[goalType] : null;
    exList.forEach(function (ex) {
      ex._sessions.forEach(function (s) {
        if (todayNum - s.day > REP_WINDOW_DAYS) return;
        s.sets.forEach(function (set) {
          total++;
          if (set.reps <= 5) buckets.low++;
          else if (set.reps <= 12) buckets.mid++;
          else buckets.high++;
          if (band && set.reps >= band.lo && set.reps <= band.hi) inBand++;
        });
      });
    });
    if (total < 10) {
      return {
        status: "insufficient", total: total, buckets: buckets,
        message: "Log " + plural(10 - total, "more set") + " (have " + total +
          ", need 10 in the last 8 weeks) to judge your rep ranges."
      };
    }
    var pctInBand = band ? Math.round(inBand / total * 100) : null;
    var advice;
    if (!goalType) {
      advice = "Set a goal on this tab and this judges whether your rep ranges match it.";
    } else if (goalType === "maintain") {
      advice = "For maintenance any rep range works — your mix (" +
        Math.round(buckets.mid / total * 100) + "% in 6–12) is fine as long as you keep showing up.";
    } else if (goalType === "performance") {
      advice = pctInBand >= 50
        ? pctInBand + "% of your sets sit in the 3–6 strength range — right where a performance goal wants them."
        : "Only " + pctInBand + "% of your sets are in the 3–6 strength range. For strength/performance, work up to heavier sets of 3–6 on your main lifts and save higher reps for accessories.";
    } else if (goalType === "cut") {
      advice = pctInBand >= 60
        ? pctInBand + "% of your sets are in 6–12 — good. On a cut, keep the loads heavy in that range so the deficit burns fat, not muscle; don't chase extra volume on low calories."
        : "Only " + pctInBand + "% of your sets are in 6–12. On a cut, heavy 6–12 work tells your body to keep its muscle — trim the very high-rep sets and keep weights up while calories are down.";
    } else { // lean-bulk / recomp — hypertrophy
      advice = pctInBand >= 60
        ? pctInBand + "% of your sets land in the 6–12 hypertrophy range — exactly what building muscle wants. Keep adding small amounts of weight inside that range."
        : "Only " + pctInBand + "% of your sets are in the 6–12 hypertrophy range. To build muscle, shift most hard sets to 6–12 reps" +
          (buckets.low / total > 0.4 ? " — your heavy 1–5s build strength but less size" :
            buckets.high / total > 0.4 ? " — your 13+ rep sets are more endurance than growth" : "") + ".";
    }
    return {
      status: "ok", total: total, buckets: buckets,
      band: band ? band.label : null, pctInBand: pctInBand,
      goalType: goalType || null, advice: advice
    };
  }

  function volumeMuscle(vol, body, todayNum) {
    // Weekly volume vs muscle mass (kg) in the same rolling blocks.
    if (vol.status !== "ok") {
      return { status: "insufficient", message: "Needs the weekly-volume trend first." };
    }
    var pairs = [];
    vol.weeks.forEach(function (w, i) {
      var end = todayNum - 7 * (VOL_WEEKS - 1 - i), start = end - 6;
      var vals = [];
      (body || []).forEach(function (r) {
        var dn = dayNum(r.date), wt = num(r.weightKg), mm = num(r.muscleMassPct);
        if (dn == null || wt == null || mm == null) return;
        if (dn >= start && dn <= end) vals.push(wt * mm / 100);
      });
      var m = mean(vals);
      if (m != null && w.volumeKg > 0) pairs.push({ vol: w.volumeKg, muscle: m });
    });
    if (pairs.length < 5) {
      return {
        status: "insufficient", n: pairs.length,
        message: "Needs 5+ weeks that have BOTH logged sets and a body measurement with muscle % (have " +
          pairs.length + ") — log body comp weekly and this fills in."
      };
    }
    var r = pearson(pairs.map(function (p) { return p.vol; }), pairs.map(function (p) { return p.muscle; }));
    var msg;
    if (r == null) msg = "No measurable relationship yet (values barely vary).";
    else if (r >= 0.3) msg = "Weeks where you lift more line up with higher muscle mass (r=" + round2(r) + " over " + pairs.length + " weeks). Honest caveat: " + pairs.length + " weeks is a small sample — treat this as a hint, not proof.";
    else if (r <= -0.3) msg = "More volume has NOT lined up with more muscle so far (r=" + round2(r) + " over " + pairs.length + " weeks, small sample) — recovery (sleep, food) may be the limiter, not effort.";
    else msg = "No clear volume ↔ muscle-mass relationship yet (r=" + round2(r) + " over " + pairs.length + " weeks — a small sample).";
    return { status: "ok", r: round2(r), n: pairs.length, message: msg };
  }

  /* ---------------- stall diagnosis + what's-working ---------------- */

  function buildDayMaps(sleep, food, exercise) {
    var sleepH = {};   // date -> hours (night ending that morning)
    (sleep || []).forEach(function (s) {
      var d = num(s && s.durationMin);
      if (s && s.date && d != null) sleepH[s.date] = d / 60;
    });
    var proteinByDay = {}; // dayNum -> g
    (food || []).forEach(function (f) {
      var dn = dayNum(f && f.date), p = num(f && f.protein);
      if (dn == null || p == null) return;
      proteinByDay[dn] = (proteinByDay[dn] || 0) + p;
    });
    // consecutive-training-day streaks (any workout counts)
    var trainSet = {};
    (exercise || []).forEach(function (r) {
      var dn = dayNum(r && r.date);
      if (dn != null) trainSet[dn] = true;
    });
    var streakOf = {};
    Object.keys(trainSet).map(Number).sort(function (a, b) { return a - b; }).forEach(function (dn) {
      streakOf[dn] = trainSet[dn - 1] ? (streakOf[dn - 1] || 1) + 1 : 1;
    });
    return { sleepH: sleepH, proteinByDay: proteinByDay, streakOf: streakOf };
  }

  function diagnoseStall(ex, maps, proteinTargetG, todayNum) {
    var st = ex.stall;
    var head = ex.name + " has stalled for ~" + plural(st.weeks, "week") +
      " (best e1RM " + fmtW(st.bestE1RMKg) + " on " + U.fmtDate(st.sinceDate) +
      "; since then topping out at " + fmtW(st.stalledBestE1RMKg) + ").";

    function sleepAvg(dates) {
      var vals = dates.map(function (d) { return maps.sleepH[d]; })
        .filter(function (v) { return v != null; });
      return vals.length >= 2 ? mean(vals) : null;
    }
    var sStall = sleepAvg(st.stalledDates);
    var sProg = sleepAvg(st.progressDates);
    if (sStall != null && sProg != null && sProg - sStall >= SLEEP_DIFF_H) {
      return {
        name: ex.name, kind: "sleep",
        message: head + " Your sleep before the stalled sessions averaged " + round1(sStall) +
          "h vs " + round1(sProg) + "h while it was progressing — fix sleep before adding weight."
      };
    }

    if (proteinTargetG) {
      var sinceDay = dayNum(st.sinceDate);
      var days = [], dn;
      for (dn = sinceDay; dn <= todayNum; dn++) {
        if (maps.proteinByDay[dn] != null) days.push(maps.proteinByDay[dn]);
      }
      var avgP = days.length >= 5 ? mean(days) : null;
      if (avgP != null && avgP < PROTEIN_LOW_FRAC * proteinTargetG) {
        return {
          name: ex.name, kind: "protein",
          message: head + " Over the stalled stretch you averaged " + Math.round(avgP) +
            "g protein/day vs your " + proteinTargetG + "g target — close that gap before blaming the program."
        };
      }
    }

    function streakShare(dates) {
      var n = 0, hit = 0;
      dates.forEach(function (d) {
        var dn = dayNum(d);
        if (dn == null || maps.streakOf[dn] == null) return;
        n++;
        if (maps.streakOf[dn] >= 2) hit++;
      });
      return n >= 2 ? hit / n : null;
    }
    var stStreak = streakShare(st.stalledDates);
    var prStreak = streakShare(st.progressDates);
    if (stStreak != null && prStreak != null && stStreak - prStreak >= STREAK_DIFF) {
      return {
        name: ex.name, kind: "recovery",
        message: head + " " + Math.round(stStreak * 100) + "% of the stalled sessions were on back-to-back " +
          "training days (vs " + Math.round(prStreak * 100) + "% while progressing) — put a rest day before " +
          ex.name + " sessions."
      };
    }

    return {
      name: ex.name, kind: "programming",
      message: head + " Sleep and protein look similar to when it was progressing, so change the stimulus: " +
        "take a light deload week, then add weight in smaller jumps or add one rep per session instead."
    };
  }

  function workingCallout(ex) {
    var freq = ex.freqDays.length ? ex.freqDays.slice(0, 3).join("/") : null;
    return {
      name: ex.name,
      message: ex.name + " +" + ex.trendPctWk + "%/week over " + plural(ex.sessions, "session") +
        (freq ? " — your " + freq + " frequency is working; keep it." : " — whatever you're doing, keep it up.") +
        (ex.recentPR ? " New all-time best this week." : "")
    };
  }

  /* ---------------- muscle-group balance ----------------
     Rolls the per-exercise picture up to muscle GROUPS (chest, back,
     triceps, …) so we can spot a body part that's under-trained or
     lagging relative to the others, and prescribe a fix. Grouping is a
     PRIMARY-mover heuristic (exercise-library.muscleGroupFor) — a guide,
     not an anatomical measurement. */
  var BALANCE_WINDOW = 28;                       // 4 weeks of recent work
  var MAJOR_GROUPS = ["Chest", "Back", "Legs", "Shoulders", "Biceps", "Triceps"];
  var LAG_SET_FRAC = 0.5;                        // < 50% of the best group's weekly sets = under-worked
  var MISSING_REF_SETS = 6;                      // only flag a 0-set group as "missing" if you train 6+/wk elsewhere

  function muscleBalance(col, qualified, todayNum) {
    var lib = OF.exerciseLibrary;
    if (!lib || !lib.muscleGroupFor) {
      return { status: "insufficient", message: "Muscle-group analysis needs the exercise library." };
    }
    var weeks = BALANCE_WINDOW / 7;
    var groups = {};
    function bucket(name) {
      var g = lib.muscleGroupFor(name);
      return groups[g] || (groups[g] = { group: g, volumeKg: 0, sets: 0, exLower: {}, trendSum: 0, trendW: 0 });
    }
    // recent volume + set counts per group — only create a group from sessions
    // INSIDE the 28-day window, so a body part you stopped training weeks ago
    // doesn't leak a stale "0/wk (+x%/wk)" row or skew improving-elsewhere.
    Object.keys(col.byName).forEach(function (k) {
      var e = col.byName[k];
      Object.keys(e.days).forEach(function (dn) {
        var s = e.days[dn];
        if (todayNum - s.day > BALANCE_WINDOW) return;
        var gg = bucket(e.name);
        gg.volumeKg += s.volumeKg || 0;
        gg.sets += s.sets.length;
        gg.exLower[e.name.toLowerCase()] = true;
      });
    });
    // progression per group from the qualified exercises' e1RM trend
    qualified.forEach(function (ex) {
      if (ex.trendPctWk == null) return;
      var gg = groups[lib.muscleGroupFor(ex.name)];
      if (!gg) return;
      gg.trendSum += ex.trendPctWk * ex.sessions;
      gg.trendW += ex.sessions;
    });

    var list = Object.keys(groups).map(function (gn) {
      var gg = groups[gn];
      return {
        group: gn,
        weeklySets: round1(gg.sets / weeks),
        weeklyVolumeKg: round1(gg.volumeKg / weeks),
        trendPctWk: gg.trendW ? round1(gg.trendSum / gg.trendW) : null,
        exLower: gg.exLower
      };
    });

    var trainedMajor = list.filter(function (x) { return MAJOR_GROUPS.indexOf(x.group) !== -1 && x.weeklySets > 0; });
    if (trainedMajor.length < 2) {
      return { status: "insufficient",
        message: "Log a few weeks of workouts across different exercises and this compares how each body part is progressing and which is lagging." };
    }
    var refSets = Math.max.apply(null, trainedMajor.map(function (x) { return x.weeklySets; }));
    var improvingElsewhere = list.some(function (x) { return x.trendPctWk != null && x.trendPctWk >= 0.3; });
    list.sort(function (a, b) { return b.weeklySets - a.weeklySets; });

    var lagging = [];
    MAJOR_GROUPS.forEach(function (gn) {
      var x = null;
      for (var i = 0; i < list.length; i++) if (list[i].group === gn) { x = list[i]; break; }
      var weeklySets = x ? x.weeklySets : 0;
      var trend = x ? x.trendPctWk : null;
      var reasons = [], severity = 0;
      if (weeklySets === 0) {
        if (refSets < MISSING_REF_SETS) return;   // you're not training much anywhere — don't nag
        reasons.push("no direct sets in the last 4 weeks"); severity = 3;
      } else {
        if (weeklySets < LAG_SET_FRAC * refSets) {
          reasons.push("only " + weeklySets + " weekly sets vs " + round1(refSets) + " for your most-trained group");
          severity += 2;
        }
        if (trend != null && trend <= 0 && improvingElsewhere) {
          reasons.push("flat or declining while your other lifts are improving"); severity += 2;
        }
      }
      if (!reasons.length) return;
      var target = Math.max(8, Math.round(refSets * 0.7));
      var addSets = Math.max(2, Math.round(target - weeklySets));
      var suggest = lib.suggestionsFor(gn, x ? x.exLower : {}).slice(0, 2);
      lagging.push({
        group: gn, weeklySets: weeklySets, trendPctWk: trend, severity: severity,
        reason: reasons.join("; "),
        prescription: "Add ~" + addSets + " weekly sets of " + gn + " work" +
          (suggest.length ? " — try " + suggest.join(" or ") + " (not in your rotation yet)." : ".") +
          (weeklySets === 0 ? " Right now you train it directly 0×/week." : "")
      });
    });
    lagging.sort(function (a, b) { return b.severity - a.severity; });

    return {
      status: "ok",
      refWeeklySets: round1(refSets),
      groups: list.map(function (x) {
        return { group: x.group, weeklySets: x.weeklySets, weeklyVolumeKg: x.weeklyVolumeKg, trendPctWk: x.trendPctWk };
      }),
      lagging: lagging
    };
  }

  /* ---------------- entry point ---------------- */

  function analyze(data) {
    data = data || {};
    var exercise = data.exercise || [];
    var todayNum = dayNum(U.todayISO());

    var col = collect(exercise);
    var keys = Object.keys(col.byName);
    if (!col.totalSets) {
      return {
        status: "insufficient",
        message: exercise.length
          ? "Log sets with your workouts (exercise name + weight × reps on the Exercise tab) and this fills in."
          : "Log workouts with exercises and sets (weight × reps) and this section shows what's actually making you stronger."
      };
    }

    var qualified = [], pending = [];
    keys.forEach(function (k) {
      var e = col.byName[k];
      var sessions = Object.keys(e.days).map(function (dn) { return e.days[dn]; });
      if (sessions.length >= MIN_SESSIONS) {
        qualified.push(analyzeExercise(e.name, sessions, todayNum));
      } else {
        pending.push({ name: e.name, sessions: sessions.length, need: MIN_SESSIONS - sessions.length });
      }
    });
    qualified.sort(function (a, b) { return b.sessions - a.sessions || (a.name < b.name ? -1 : 1); });

    if (!qualified.length) {
      var p0 = pending.slice().sort(function (a, b) { return b.sessions - a.sessions; })[0];
      return {
        status: "insufficient",
        message: "Sets logged for " + plural(pending.length, "exercise") + ", but each needs " +
          MIN_SESSIONS + "+ sessions for a trend — " + p0.name + " unlocks after " +
          plural(p0.need, "more session") + "."
      };
    }

    var vol = weeklyVolume(qualified, todayNum);
    var reps = repRange(qualified, todayNum, data.goalType || null);
    var vm = volumeMuscle(vol, data.body || [], todayNum);

    var maps = buildDayMaps(data.sleep, data.food, exercise);
    var stalls = [], working = [];
    qualified.forEach(function (ex) {
      if (ex.stall) stalls.push(diagnoseStall(ex, maps, data.proteinTargetG || null, todayNum));
      else if (ex.verdict === "improving" && ex.trendPctWk != null && ex.sessions >= 4) {
        working.push(workingCallout(ex));
      }
    });

    return {
      status: "ok",
      totalSets: col.totalSets,
      exercises: qualified,
      pending: pending,
      weeklyVolume: vol,
      repRange: reps,
      volumeMuscle: vm,
      stalls: stalls,
      working: working,
      muscleBalance: muscleBalance(col, qualified, todayNum)
    };
  }

  /** Compact block for the AI-coach context (≤ ~1 KB). */
  function coachSummary(res) {
    if (!res) return null;
    if (res.status !== "ok") return { note: res.message };
    var out = {
      topExercises: res.exercises.slice(0, 3).map(function (e) {
        return {
          name: e.name,
          sessions: e.sessions,
          e1RMKg: e.latestE1RMKg,
          bestSet: e.bestSet ? round1(e.bestSet.weightKg) + "kg x " + e.bestSet.reps +
            " (" + e.bestSet.date + ")" : null,
          trendPctPerWeek: e.trendPctWk,
          verdict: e.verdict,
          recentPR: e.recentPR
        };
      })
    };
    if (res.weeklyVolume.status === "ok") {
      out.weeklyVolumeKg = res.weeklyVolume.weeks.map(function (w) { return Math.round(w.volumeKg); });
      out.weeklyVolumeTrendKgPerWeek = res.weeklyVolume.trendKgPerWeek;
    }
    if (res.repRange.status === "ok") {
      out.repRangeFit = "sets last 8wk: " + res.repRange.buckets.low + " in 1-5, " +
        res.repRange.buckets.mid + " in 6-12, " + res.repRange.buckets.high + " in 13+" +
        (res.repRange.band ? "; goal band " + res.repRange.band + " = " + res.repRange.pctInBand + "%" : "");
    }
    if (res.stalls.length) out.stalls = res.stalls.slice(0, 2).map(function (s) { return s.message; });
    if (res.working.length) out.working = res.working.slice(0, 2).map(function (s) { return s.message; });
    if (res.volumeMuscle.status === "ok") out.volumeVsMuscle = res.volumeMuscle.message;
    if (res.muscleBalance && res.muscleBalance.status === "ok") {
      out.muscleGroupWeeklySets = res.muscleBalance.groups.map(function (g) {
        return g.group + ": " + g.weeklySets + "/wk" + (g.trendPctWk != null ? " (" + (g.trendPctWk >= 0 ? "+" : "") + g.trendPctWk + "%/wk)" : "");
      });
      if (res.muscleBalance.lagging.length) {
        out.laggingMuscleGroups = res.muscleBalance.lagging.slice(0, 3).map(function (l) {
          return l.group + " — " + l.reason + ". Fix: " + l.prescription;
        });
      }
    }
    return out;
  }

  return {
    analyze: analyze,
    coachSummary: coachSummary,
    epley: epley,
    collect: collect
  };
})();

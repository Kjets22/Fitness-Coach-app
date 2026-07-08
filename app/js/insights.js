/* ============================================================
   insights.js — renders the recommendation cards from
   OF.engine.analyzeAll(). Card order:
     Weekly plan, Readiness today, Best gym time, Best days,
     Rest recommendation, Sleep target, Food, Body trends.
   Every card degrades to a "need more data" state — no NaN.
   ============================================================ */

window.OF = window.OF || {};

OF.insights = (function () {
  "use strict";
  var U = OF.util, S = OF.storage;
  var container = null;

  function init() {
    container = document.getElementById("insights-cards");
    refresh();
  }

  /* ---------- tiny render helpers ---------- */

  function confTag(level) {
    var lbl = { high: "high confidence", medium: "medium confidence", low: "low confidence" }[level] || level;
    return '<span class="conf conf-' + U.esc(level) + '">' + U.esc(lbl) + '</span>';
  }
  function needTag() {
    return '<span class="conf conf-need">need more data</span>';
  }

  function card(title, tagHtml, headline, subHtml, extraClass, icon) {
    return '<div class="card insight-card' + (extraClass ? " " + extraClass : "") + '">' +
      '<div class="insight-head"><div class="ih-l">' +
      (icon ? OF.icons.badge(icon) : "") +
      '<h2>' + U.esc(title) + '</h2></div>' + (tagHtml || "") + '</div>' +
      '<p class="insight-headline">' + headline + '</p>' +
      (subHtml ? '<div class="insight-sub muted">' + subHtml + '</div>' : "") +
      '</div>';
  }

  function needCard(title, message, extraClass, icon) {
    return card(title, needTag(), U.esc(message), null, extraClass, icon);
  }

  function e(s) { return U.esc(s); }

  /* ---------- individual cards ---------- */

  function planCard(r, gi) {
    var targetsLine = "";
    var hasTargets = gi && gi.targets && gi.targets.status === "ok";
    if (hasTargets) {
      var t = gi.targets;
      targetsLine = "<br>" + e("Daily targets for your goal (" + t.label.toLowerCase() + "): " +
        t.calories + " kcal · " + t.proteinG + "g protein · " + U.fmtWater(t.waterMl) +
        " water · " + t.steps.toLocaleString() + " steps · " + t.sleepH + "h sleep.");
    }
    if (r.plan.status !== "ok") {
      return card("Weekly plan", needTag(), e(r.plan.message),
        targetsLine ? targetsLine.slice(4) : null, "plan-card", "target");
    }
    var planText = r.plan.text;
    // The engine's generic 1.6 g/kg protein nudge is superseded by the
    // personal goal target — keep the plan and the targets line consistent.
    if (hasTargets) {
      planText = planText.replace(/bump protein toward \d+g\/day/,
        "bump protein toward " + gi.targets.proteinG + "g/day");
    }
    return card("Weekly plan", confTag(r.plan.confidence),
      e(planText),
      e("Built from your best days, best time of day, fatigue pattern and food/sleep data below. Max " +
        r.plan.maxConsecutive + " training day" + (r.plan.maxConsecutive === 1 ? "" : "s") + " in a row.") +
      targetsLine,
      "plan-card", "target");
  }

  function readinessCard(r) {
    var d = r.readiness;
    if (d.status !== "ok") return needCard("Readiness today", d.message, null, "gauge");
    var factors = (d.factors || []).map(function (f) {
      var mark = f.good === true ? '<span class="f-good">+</span>' :
        f.good === false ? '<span class="f-bad">&minus;</span>' : '<span class="f-neutral">&bull;</span>';
      return '<li>' + mark + ' ' + e(f.text) + '</li>';
    }).join("");
    return card("Readiness today", '<span class="conf conf-' + e(d.level) + '">score ' + d.score + '/100</span>',
      e(d.verdict),
      '<ul class="factor-list">' + factors + '</ul>', null, "gauge");
  }

  function gymTimeCard(r) {
    var d = r.timeOfDay;
    if (d.status !== "ok") return needCard("Best gym time", d.message, null, "clock");
    var head = "Your best workouts happen in the " + d.best.label.toLowerCase() +
      " (" + d.best.range + "h) — avg " + d.best.avgPerf + "/5";
    if (d.worstEligible) head += " vs " + d.worstEligible.avgPerf + "/5 in the " + d.worstEligible.label.toLowerCase();
    head += ".";
    var rows = d.buckets.map(function (b) {
      return '<span class="mini-stat">' + e(b.label) + ": " +
        (b.avgPerf != null ? b.avgPerf + "/5 (" + b.count + ")" : "no sessions") + '</span>';
    }).join("");
    if (d.adjustedForSleep) {
      rows += '<span class="mini-stat">ranking adjusted for prior-night sleep</span>';
    }
    return card("Best gym time", confTag(d.confidence), e(head), rows, null, "clock");
  }

  function bestDaysCard(r) {
    var d = r.weekdays;
    if (d.status !== "ok") return needCard("Best training days", d.message, null, "calendar");
    var top = d.top.map(function (s) { return s.name; }).join(", ");
    var head = "You perform best on " + top + " — avg " + d.top[0].avgPerf + "/5 on " + d.top[0].name + ".";
    var rows = d.ranked.map(function (s) {
      return '<span class="mini-stat">' + e(s.abbr) + ": " + s.avgPerf + "/5 (" + s.count + ")" + '</span>';
    }).join("");
    if (d.adjustedForSleep) {
      rows += '<span class="mini-stat">ranking adjusted for prior-night sleep</span>';
    }
    return card("Best training days", confTag(d.confidence), e(head), rows, null, "calendar");
  }

  function restCard(r) {
    var d = r.rest;
    if (d.status !== "ok") return needCard("Rest days", d.message, null, "pause");
    var head;
    if (d.fatigueDetected) {
      head = "Performance drops after " + d.maxConsecutive + " consecutive training day" +
        (d.maxConsecutive === 1 ? "" : "s") +
        (d.adjustedForSleep ? " (once sleep is accounted for)" : "") +
        " — take a rest day after " +
        (d.maxConsecutive === 1 ? "each session" : d.maxConsecutive + " days on") + ".";
    } else {
      head = "No clear fatigue pattern up to " + d.maxConsecutive +
        " days in a row — capping at " + d.maxConsecutive + " is still a safe bet.";
    }
    if (d.restDayNames.length) {
      head += " Best days to rest: " + d.restDayNames.join(" and ") + " (your weakest training days).";
    }
    var rows = d.groups.map(function (g) {
      var val = g.avgPerf == null ? "no data"
        : d.adjustedForSleep && g.avgAdj != null
          ? g.avgPerf + "/5 raw · " + (Math.round(g.avgAdj * 10) / 10) + "/5 sleep-adj (" + g.count + ")"
          : g.avgPerf + "/5 (" + g.count + ")";
      return '<span class="mini-stat">' + e(g.label) + ": " + val + '</span>';
    }).join("");
    return card("Rest days", confTag(d.confidence), e(head), rows, null, "pause");
  }

  function sleepCard(r) {
    var d = r.sleep;
    if (d.status !== "ok") return needCard("Sleep target", d.message, null, "moon");
    var head = "Aim for about " + d.targetH + "h of sleep before training days.";
    if (d.groupComparisonOk && d.avgPerfGood != null && d.avgPerfShort != null) {
      var better = d.avgPerfGood > d.avgPerfShort;
      head = "After 7h+ sleep you average " + d.avgPerfGood + "/5 vs " + d.avgPerfShort +
        "/5 on short sleep" + (better ? "" : " (surprisingly, more sleep isn't helping yet") +
        (better ? " — aim for about " + d.targetH + "h." : ").");
    }
    var sub = [];
    if (d.rDur != null) sub.push('<span class="mini-stat">duration &harr; performance r = ' + d.rDur + '</span>');
    if (d.rQual != null) sub.push('<span class="mini-stat">quality &harr; performance r = ' + d.rQual + '</span>');
    sub.push('<span class="mini-stat">' + d.n + ' sleep+workout days</span>');
    return card("Sleep target", confTag(d.confidence), e(head), sub.join(""), null, "moon");
  }

  function foodCard(r, gi, intake) {
    var d = r.food;
    var t = gi && gi.targets && gi.targets.status === "ok" ? gi.targets : null;
    var lines = [];

    // Goal-aware intake-vs-target lines (surplus is GOOD on a bulk, bad on a cut).
    if (t && intake && intake.days >= 3) {
      var pct = intake.kcal / t.calories;
      var diff = intake.kcal - t.calories;
      var diffTxt = (diff >= 0 ? "+" : "") + Math.round(diff);
      var kcalLine = "Calories: averaging " + intake.kcal + " kcal/day vs your " +
        t.calories + " kcal target (" + diffTxt + "). ";
      if (t.goalType === "lean-bulk") {
        kcalLine += pct < 0.92
          ? "That's under target — you can't build muscle in a deficit; add ~" +
            Math.round(t.calories - intake.kcal) + " kcal/day."
          : pct > 1.15
            ? "That's well over the lean-bulk surplus — extra will mostly become fat; ease back toward the target."
            : "Right in the lean-bulk zone — keep it there.";
      } else if (t.goalType === "cut") {
        kcalLine += pct <= 1.02
          ? (pct < 0.75
            ? "You're well under even the cut target — too aggressive; eat closer to " + t.calories + " to protect muscle."
            : "Nice — you're holding the deficit.")
          : "That's over your cut target, which erases the deficit; trim ~" +
            Math.round(intake.kcal - t.calories) + " kcal/day.";
      } else {
        kcalLine += pct >= 0.9 && pct <= 1.1
          ? "Right around maintenance — exactly what this goal wants."
          : (pct > 1.1 ? "A bit over" : "A bit under") + " maintenance — aim closer to " + t.calories + " kcal.";
      }
      lines.push(kcalLine);
      if (intake.protein != null) {
        lines.push("Protein: " + intake.protein + "g/day vs your " + t.proteinG + "g target — " +
          (intake.protein >= t.proteinG ? "target met, keep it up."
            : "add ~" + Math.round(t.proteinG - intake.protein) + "g/day (protein protects/builds muscle on any goal)."));
      }
      if (intake.carbs != null && intake.fat != null) {
        lines.push("Carbs " + intake.carbs + "g vs ~" + t.carbsG + "g · fat " + intake.fat +
          "g vs ~" + t.fatG + "g targets.");
      }
    } else if (t && intake) {
      lines.push("Log meals (with calories) on " + (3 - intake.days) +
        " more day" + (3 - intake.days === 1 ? "" : "s") + " to compare intake against your personal targets.");
    }

    if (d.status !== "ok" && !lines.length) return needCard("Food & fuelling", d.message, null, "apple");

    if (d.pre.status === "ok") {
      if (d.pre.better === "with") {
        lines.push("Eating within 3h before training helps: avg " + d.pre.avgWith +
          "/5 with a pre-workout meal vs " + d.pre.avgWithout + "/5 without.");
      } else if (d.pre.better === "without") {
        lines.push("You actually perform better without a meal in the 3h before training (" +
          d.pre.avgWithout + "/5 vs " + d.pre.avgWith + "/5).");
      } else {
        lines.push("Pre-workout meals make little difference so far (" + d.pre.avgWith +
          "/5 with vs " + d.pre.avgWithout + "/5 without).");
      }
    } else {
      lines.push("Pre-workout meal effect: " + d.pre.message);
    }

    if (d.carbs.status === "ok") {
      if (d.carbs.better === "high") {
        lines.push("Carb-rich pre-workout meals (&ge;40g) work best: " + d.carbs.avgHigh +
          "/5 vs " + d.carbs.avgLow + "/5 for lower-carb meals.");
      } else if (d.carbs.better === "low") {
        lines.push("Lighter pre-workout meals suit you: " + d.carbs.avgLow +
          "/5 vs " + d.carbs.avgHigh + "/5 for carb-heavy ones.");
      } else {
        lines.push("High- vs low-carb pre-workout meals: no clear difference yet.");
      }
    } else if (d.carbs.avgCarbsPre != null) {
      lines.push("Your pre-workout meals average ~" + d.carbs.avgCarbsPre + "g carbs. " + d.carbs.message);
    }

    // Generic 1.6 g/kg protein line only when there is no personal target above.
    if (!(t && intake && intake.days >= 3 && intake.protein != null)) {
      if (d.protein.status === "ok") {
        lines.push("Protein: " + d.protein.avgProteinG + "g/day (" + d.protein.gPerKg +
          " g/kg at " + U.fmtWeight(d.protein.weightKg) + ") — " +
          (d.protein.meetsTarget
            ? "meets the " + d.protein.targetGPerKg + " g/kg target. Keep it up."
            : "below the " + d.protein.targetGPerKg + " g/kg target; aim for ~" + d.protein.targetG + "g/day."));
      } else {
        lines.push("Protein target: " + d.protein.message);
      }
    }

    var confLevels = [d.pre, d.carbs, d.protein]
      .filter(function (x) { return x.status === "ok"; })
      .map(function (x) { return x.confidence; });
    var level = confLevels.indexOf("low") !== -1 ? "low" :
      confLevels.indexOf("medium") !== -1 ? "medium" : (confLevels.length ? "high" : "low");

    return card("Food & fuelling", confTag(level),
      lines.map(function (l) { return "&bull; " + l; }).join("<br>"), null, null, "apple");
  }

  function trendsCard(r, gi) {
    var d = r.trends;
    if (d.status !== "ok") return needCard("Body trends (30 days)", d.message, null, "trend");
    var goalType = gi && gi.goal ? gi.goal.type : null;
    var lines = [], keys = ["weightKg", "bodyFatPct", "muscleMassPct"];
    keys.forEach(function (k) {
      var m = d.metrics[k];
      if (!m) return;
      if (m.status !== "ok") {
        lines.push(e(m.label) + ": " + e(m.message));
        return;
      }
      var arrow = m.direction === "up" ? "&uarr;" : m.direction === "down" ? "&darr;" : "&rarr;";
      var isWeight = k === "weightKg";
      var delta = isWeight ? U.toDisplayWeight(m.delta30) : m.delta30;
      var latest = isWeight ? U.toDisplayWeight(m.latest) : m.latest;
      var unit = isWeight ? U.weightUnit() : m.unit;
      var change = m.direction === "stable"
        ? "stable"
        : (delta > 0 ? "+" : "") + delta + " " + unit + " / 30 days";
      var verdict = m.verdict === "improving" ? " (improving)" :
        m.verdict === "declining" ? " (heading the wrong way)" : "";
      // Weight direction is only good/bad relative to the GOAL.
      if (isWeight && goalType && m.direction !== "stable") {
        var wantDir = goalType === "cut" ? "down" : goalType === "lean-bulk" ? "up" : "stable";
        if (wantDir === "stable") verdict = " (goal wants steady weight — keep an eye on this)";
        else if (m.direction === wantDir) verdict = " (on track for your goal)";
        else verdict = " (opposite of your goal — see the goal card above)";
      } else if (isWeight && goalType && m.direction === "stable") {
        verdict = goalType === "cut" || goalType === "lean-bulk"
          ? " (steady — your goal wants it moving; see the goal card)"
          : " (steady — exactly what your goal wants)";
      }
      lines.push(arrow + " " + e(m.label) + ": " + e(change) + e(verdict) +
        " &mdash; latest " + e(String(latest)) + " " + e(unit));
    });
    var confs = keys.map(function (k) { return d.metrics[k]; })
      .filter(function (m) { return m && m.status === "ok"; })
      .map(function (m) { return m.confidence; });
    var level = confs.indexOf("low") !== -1 ? "low" : confs.indexOf("medium") !== -1 ? "medium" : "high";
    return card("Body trends (30 days)", confTag(level), lines.join("<br>"), null, null, "trend");
  }

  /* ---------- strength & lifting cards (OF.strength) ---------- */

  /** Tiny e1RM sparkline (pure numbers -> polyline; no user text inside). */
  function sparkline(series, color) {
    if (!series || series.length < 2) return "";
    var W = 96, H = 28, P = 3;
    var xs = series.map(function (p) { return p.x; });
    var ys = series.map(function (p) { return p.y; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    if (x1 === x0) x1 = x0 + 1;
    if (y1 === y0) { y1 += 1; y0 -= 1; }
    var pts = series.map(function (p) {
      var x = P + (p.x - x0) / (x1 - x0) * (W - 2 * P);
      var y = P + (1 - (p.y - y0) / (y1 - y0)) * (H - 2 * P);
      return x.toFixed(1) + "," + y.toFixed(1);
    }).join(" ");
    return '<svg class="spark" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H +
      '" aria-hidden="true"><polyline points="' + pts + '" fill="none" style="stroke:' + color +
      '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function verdictChip(ex) {
    var cls = { improving: "conf-high", stalling: "conf-bad", flat: "conf-low", inactive: "conf-need" }[ex.verdict] || "conf-low";
    var txt = ex.verdict;
    if (ex.trendPctWk != null && (ex.verdict === "improving" || ex.verdict === "flat")) {
      txt = (ex.trendPctWk > 0 ? "+" : "") + ex.trendPctWk + "%/wk " + ex.verdict;
    }
    return '<span class="conf ' + cls + '">' + e(txt) + '</span>';
  }

  function strengthVolumeCard(st) {
    var v = st.weeklyVolume;
    if (v.status !== "ok") return needCard("Weekly lifting volume", v.message, null, "dumbbell");
    var unit = U.weightUnit();
    var bars = v.weeks.map(function (w) {
      var disp = U.toDisplayWeight(w.volumeKg, 0) || 0;
      return {
        label: w.label,
        value: disp,
        color: "var(--accent)",
        valueLabel: disp >= 1000 ? (Math.round(disp / 100) / 10) + "k" : String(disp)
      };
    });
    var latest = U.toDisplayWeight(v.latestKg, 0) || 0;
    var avgV = U.toDisplayWeight(v.avgKg, 0) || 0;
    var head = "This week: " + latest.toLocaleString() + " " + unit + " total (weight × reps)" +
      (avgV ? " vs your " + avgV.toLocaleString() + " " + unit + " weekly average." : ".");
    return card("Weekly lifting volume", confTag(conf3(v.weeks.filter(function (w) { return w.volumeKg > 0; }).length, 4, 6)),
      e(head),
      OF.charts.barChart({ bars: bars, height: 170, yFmt: function (x) { return x >= 1000 ? Math.round(x / 1000) + "k" : String(x); } }),
      null, "dumbbell");
  }

  function conf3(n, med, high) { return n >= high ? "high" : n >= med ? "medium" : "low"; }

  function liftRowsCard(st) {
    var rows = st.exercises.slice(0, 5).map(function (ex) {
      var colors = { improving: "var(--accent-2)", stalling: "var(--danger)", flat: "var(--text-dim)", inactive: "var(--text-dim)" };
      var sub = ex.sessions + " sessions";
      if (ex.bestSet) sub += " · best " + U.fmtWeight(ex.bestSet.weightKg, 1) + " × " + ex.bestSet.reps;
      if (ex.latestE1RMKg != null) sub += " · e1RM " + U.fmtWeight(ex.latestE1RMKg, 1);
      return '<div class="lift-row">' +
        '<div class="lift-main"><div class="lift-name">' + e(ex.name) +
        (ex.recentPR ? ' <span class="pr-badge">PR</span>' : '') + '</div>' +
        '<div class="lift-sub">' + e(sub) + '</div></div>' +
        sparkline(ex.series, colors[ex.verdict] || "var(--accent)") +
        verdictChip(ex) +
        '</div>';
    }).join("");
    var pendingNote = "";
    if (st.pending.length) {
      var p = st.pending.slice(0, 3).map(function (x) {
        return x.name + " (" + x.sessions + "/3 sessions)";
      }).join(", ");
      pendingNote = '<p class="lift-pending muted">Building a trend for: ' + e(p) +
        (st.pending.length > 3 ? " + " + (st.pending.length - 3) + " more" : "") + '</p>';
    }
    var level = st.exercises[0] ? st.exercises[0].confidence : "low";
    return card("Lift progression (est. 1RM)", confTag(level),
      e("Estimated 1RM per lift (Epley: weight × (1 + reps/30)) from your best set each session."),
      '<div class="lift-rows">' + rows + '</div>' + pendingNote, null, "trend");
  }

  function repRangeCard(st) {
    var rr = st.repRange;
    if (rr.status !== "ok") return needCard("Rep ranges vs your goal", rr.message, null, "target");
    var stats =
      '<span class="mini-stat">1–5 reps: ' + rr.buckets.low + ' sets</span>' +
      '<span class="mini-stat">6–12 reps: ' + rr.buckets.mid + ' sets</span>' +
      '<span class="mini-stat">13+ reps: ' + rr.buckets.high + ' sets</span>' +
      '<span class="mini-stat">' + rr.total + ' sets in 8 weeks</span>' +
      (rr.band ? '<span class="mini-stat">goal band ' + e(rr.band) + ': ' + rr.pctInBand + '%</span>' : '');
    return card("Rep ranges vs your goal", confTag(conf3(rr.total, 20, 40)),
      e(rr.advice), stats, null, "target");
  }

  function strengthCalloutsCard(st) {
    if (!st.stalls.length && !st.working.length) return "";
    var lines = [];
    st.working.forEach(function (w) {
      lines.push('<li><span class="f-good">+</span> ' + e(w.message) + '</li>');
    });
    st.stalls.forEach(function (s) {
      lines.push('<li><span class="f-bad">&minus;</span> ' + e(s.message) + '</li>');
    });
    var vm = st.volumeMuscle;
    if (vm.status === "ok") {
      lines.push('<li><span class="f-neutral">&bull;</span> ' + e(vm.message) + '</li>');
    } else if (vm.n != null || vm.message) {
      lines.push('<li><span class="f-neutral">&bull;</span> ' + e("Volume ↔ muscle-mass link: " + vm.message) + '</li>');
    }
    var head = st.stalls.length
      ? plural(st.stalls.length, "lift") + " stalled — with the most likely fix from your own data."
      : "What's working in your training right now.";
    return card("What's working / what's stalled",
      st.stalls.length ? '<span class="conf conf-bad">action needed</span>' : confTag("medium"),
      e(head), '<ul class="factor-list">' + lines.join("") + '</ul>', null, "gauge");
  }

  function plural(n, w) { return n + " " + w + (n === 1 ? "" : "s"); }

  function strengthCards(data, gi) {
    if (!OF.strength) return "";
    var goalType = gi && gi.goal ? gi.goal.type : null;
    var proteinTargetG = gi && gi.targets && gi.targets.status === "ok" ? gi.targets.proteinG : null;
    var st;
    try {
      st = OF.strength.analyze({
        exercise: data.exercise, sleep: data.sleep, food: data.food, body: data.body,
        goalType: goalType, proteinTargetG: proteinTargetG
      });
    } catch (err) {
      return ""; // never let a strength-engine bug take down the insights tab
    }
    var heading = '<h2 class="list-heading">Strength &amp; lifting</h2>';
    if (st.status !== "ok") {
      return heading + needCard("Strength & lifting", st.message, null, "dumbbell");
    }
    return heading +
      strengthVolumeCard(st) +
      liftRowsCard(st) +
      repRangeCard(st) +
      strengthCalloutsCard(st);
  }

  /* ---------- refresh ---------- */

  function refresh() {
    if (!container) return;
    // The goal area (setup card / "Your goal" card) sits above the insight
    // cards and also runs the adaptive loop before anything reads targets.
    if (OF.goals) OF.goals.refresh();

    var data = {
      sleep: S.getAll("sleep"),
      food: S.getAll("food"),
      exercise: S.getAll("exercise"),
      body: S.getAll("body")
    };
    var total = data.sleep.length + data.food.length + data.exercise.length + data.body.length;

    if (total === 0) {
      container.innerHTML =
        '<div class="card placeholder-card"><h2>No data yet</h2>' +
        '<div class="empty-state">' + OF.icons.badge("sparkles") +
        '<p>Log sleep, meals, workouts and body metrics — or load demo data — and this tab ' +
        'tells you when to train, when to rest, what to eat and how much to sleep.</p>' +
        '<a class="btn primary" href="#settings">Load demo data</a></div></div>';
      return;
    }

    var gi = OF.goals ? OF.goals.info() : null;
    var intake = OF.targets ? OF.targets.intakeStats(data.food, 14) : null;
    var r = OF.engine.analyzeAll(data);

    // Water + steps adherence feeds the readiness card when targets exist.
    if (gi && gi.targets && gi.targets.status === "ok" && r.readiness.status === "ok" && OF.daily) {
      var t = gi.targets;
      var wMl = OF.daily.waterTodayMl();
      var sRec = OF.daily.stepsRecordFor(U.todayISO());
      var steps = sRec && isFinite(Number(sRec.count)) ? Number(sRec.count) : null;
      r.readiness.factors.push({
        good: wMl >= t.waterMl ? true : wMl >= 0.5 * t.waterMl ? null : false,
        text: "Water today: " + U.fmtWater(wMl) + " of " + U.fmtWater(t.waterMl) + " target"
      });
      r.readiness.factors.push({
        good: steps == null ? null : steps >= t.steps,
        text: steps == null
          ? "No steps logged today — log them on the Daily tab"
          : "Steps today: " + steps.toLocaleString() + " of " + t.steps.toLocaleString() + " target"
      });
    }

    container.innerHTML =
      planCard(r, gi) +
      readinessCard(r) +
      gymTimeCard(r) +
      bestDaysCard(r) +
      restCard(r) +
      sleepCard(r) +
      foodCard(r, gi, intake) +
      trendsCard(r, gi) +
      strengthCards(data, gi);
  }

  return { init: init, refresh: refresh };
})();

/* ============================================================
   dashboard.js — hero header (time-aware greeting + readiness
   ring), stat cards (value + delta-vs-last-week chip + trend
   sparkline), the today-vs-targets ring strip, and the trend
   charts:
     - body metrics 90-day trend lines (weight / fat % / muscle %)
     - sleep duration last 14 days (bars colored by quality)
     - workout performance by time of day (from OF.engine)
     - weekly calories / protein averages (last 4 weeks)
   Charts are hand-rolled SVG via OF.charts and degrade to a
   friendly empty state when there's no data.
   ============================================================ */

window.OF = window.OF || {};

OF.dashboard = (function () {
  "use strict";
  var U = OF.util, S = OF.storage;
  var grid = null, chartsEl = null, targetsEl = null, heroEl = null;

  function init() {
    grid = document.getElementById("dash-stats");
    chartsEl = document.getElementById("dash-charts");
    targetsEl = document.getElementById("dash-targets");
    heroEl = document.getElementById("dash-hero");
    refresh();
  }

  /* ---------------- date helpers ---------------- */

  function parseISO(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function dayNum(iso) {
    var d = parseISO(iso);
    return d ? Math.round(d.getTime() / 86400000) : null;
  }
  function shortDate(iso) {
    var d = parseISO(iso);
    return d ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
  }
  /** Inverse of dayNum. Uses UTC noon so it's correct in every timezone. */
  function dateFromDayNum(dn) {
    return new Date((dn + 0.5) * 86400000); // read via getUTC* only
  }
  function isoFromDayNum(dn) {
    var d = dateFromDayNum(dn);
    return d.getUTCFullYear() + "-" +
      String(d.getUTCMonth() + 1).padStart(2, "0") + "-" +
      String(d.getUTCDate()).padStart(2, "0");
  }

  /** Start of the current week (Monday) as YYYY-MM-DD. */
  function weekStartISO() {
    var d = new Date();
    var day = (d.getDay() + 6) % 7; // Mon=0 ... Sun=6
    d.setDate(d.getDate() - day);
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  /* ---------------- hero (greeting + readiness ring) ---------------- */

  function greeting() {
    var h = new Date().getHours();
    return h < 5 ? "Good night" : h < 12 ? "Good morning" :
      h < 18 ? "Good afternoon" : "Good evening";
  }

  function renderHero(readiness) {
    if (!heroEl) return;
    var dateTxt = new Date().toLocaleDateString(undefined,
      { weekday: "long", month: "long", day: "numeric" });
    var ringHtml;
    if (readiness && readiness.status === "ok") {
      var color = readiness.level === "high" ? "var(--accent-2)" :
        readiness.level === "medium" ? "var(--warn)" :
        readiness.level === "low" ? "var(--danger)" : "grad";
      ringHtml = U.progressRing(readiness.score / 100,
        { size: 76, color: color, value: String(readiness.score), sub: "/100" });
    } else {
      ringHtml = U.progressRing(0, { size: 76, color: "grad", value: "—" });
    }
    heroEl.innerHTML =
      '<header class="hero">' +
      '<div><h1 class="hero-greet">' + U.esc(greeting()) + '</h1>' +
      '<p class="hero-date">' + U.esc(dateTxt) + '</p></div>' +
      '<div class="hero-ring" title="' +
      U.esc(readiness && readiness.status === "ok" ? readiness.verdict : "Log a few nights of sleep to unlock your readiness score") +
      '">' + ringHtml + '<span class="hero-ring-label">Readiness</span></div>' +
      '</header>';
  }

  /* ---------------- stat cards ---------------- */

  /** Tiny sparkline (values may contain nulls; needs >=2 numbers). */
  var sparkSeq = 0;
  function sparkline(values, color) {
    var pts = [];
    values.forEach(function (v, i) {
      if (v != null && isFinite(v)) pts.push({ i: i, v: v });
    });
    if (pts.length < 2) return "";
    var W = 100, H = 30, pad = 2;
    var min = Infinity, max = -Infinity;
    pts.forEach(function (p) { if (p.v < min) min = p.v; if (p.v > max) max = p.v; });
    if (max === min) { max += 1; min -= 1; }
    var n = values.length - 1 || 1;
    function X(i) { return pad + (i / n) * (W - pad * 2); }
    function Y(v) { return pad + (1 - (v - min) / (max - min)) * (H - pad * 2); }
    var d = pts.map(function (p, k) {
      return (k ? "L" : "M") + X(p.i).toFixed(1) + " " + Y(p.v).toFixed(1);
    }).join(" ");
    var gid = "ofsp" + (++sparkSeq);
    var area = d + " L" + X(pts[pts.length - 1].i).toFixed(1) + " " + H +
      " L" + X(pts[0].i).toFixed(1) + " " + H + " Z";
    return '<div class="stat-spark"><svg viewBox="0 0 ' + W + " " + H +
      '" preserveAspectRatio="none" aria-hidden="true">' +
      '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + color + '" stop-opacity="0.32"/>' +
      '<stop offset="1" stop-color="' + color + '" stop-opacity="0"/>' +
      '</linearGradient></defs>' +
      '<path d="' + area + '" fill="url(#' + gid + ')"/>' +
      '<path d="' + d + '" fill="none" stroke="' + color +
      '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg></div>';
  }

  /**
   * Delta chip vs last week. goodWhenUp: true (more is better),
   * false (less is better), null (neutral — no judgment color).
   */
  function deltaChip(delta, fmtTxt, goodWhenUp) {
    if (delta == null || !isFinite(delta)) return "";
    var eps = 1e-9;
    var cls = "chip-flat", arrow = "→";
    if (delta > eps) arrow = "↑";
    else if (delta < -eps) arrow = "↓";
    if (goodWhenUp != null && Math.abs(delta) > eps) {
      var good = goodWhenUp ? delta > 0 : delta < 0;
      cls = good ? "chip-up" : "chip-down";
    }
    return '<span class="chip ' + cls + '" title="vs last week">' + arrow + " " +
      U.esc(fmtTxt) + '</span>';
  }

  function card(label, valueHtml, sub, extras) {
    extras = extras || {};
    return '<div class="stat-card">' +
      '<div class="stat-head"><div class="stat-label">' + U.esc(label) + '</div>' +
      (extras.chip || "") + '</div>' +
      '<div class="stat-value">' + valueHtml + '</div>' +
      (sub ? '<div class="stat-sub">' + U.esc(sub) + '</div>' : '') +
      (extras.spark || "") +
    '</div>';
  }

  /** Daily series (ISO-date keyed sums) for the last `days` days. */
  function dailySeries(records, valueOf, days) {
    var todayN = dayNum(U.todayISO());
    var by = {};
    records.forEach(function (r) {
      var dn = dayNum(r.date);
      if (dn == null || todayN - dn >= days || todayN - dn < 0) return;
      var v = valueOf(r);
      if (v == null || !isFinite(v)) return;
      by[dn] = (by[dn] || 0) + v;
    });
    var out = [];
    for (var dn = todayN - days + 1; dn <= todayN; dn++) out.push(by[dn] != null ? by[dn] : null);
    return out;
  }

  function avgNums(arr) {
    var s = 0, n = 0;
    arr.forEach(function (v) { if (v != null && isFinite(v)) { s += v; n++; } });
    return n ? s / n : null;
  }

  function renderStats() {
    var todayN = dayNum(U.todayISO());

    // ---- Latest weight (display unit; stored metric) + 14d spark + Δ vs ~1wk ago
    var body = S.getAll("body").slice().sort(U.byNewest);
    var weightHtml = body.length
      ? U.esc(U.toDisplayWeight(body[0].weightKg)) + ' <span class="unit">' + U.esc(U.weightUnit()) + '</span>'
      : '<span class="unit">&mdash;</span>';
    var weightSub = body.length ? U.fmtDate(body[0].date) : "no data yet";
    var wChip = "", wSpark = "";
    if (body.length) {
      var latestN = dayNum(body[0].date);
      var prev = null;
      for (var i = 1; i < body.length; i++) {
        var dn = dayNum(body[i].date);
        if (dn != null && latestN != null && latestN - dn >= 5) { prev = body[i]; break; }
      }
      if (prev && isFinite(Number(prev.weightKg)) && isFinite(Number(body[0].weightKg))) {
        var dKg = Number(body[0].weightKg) - Number(prev.weightKg);
        wChip = deltaChip(dKg, U.fmtWeightDelta(dKg), null);
      }
      var wVals = [];
      var byDay = {};
      body.forEach(function (r) {
        var dn2 = dayNum(r.date), v = Number(r.weightKg);
        if (dn2 != null && isFinite(v) && todayN - dn2 < 30 && todayN - dn2 >= 0) byDay[dn2] = v;
      });
      for (var d2 = todayN - 29; d2 <= todayN; d2++) wVals.push(byDay[d2] != null ? byDay[d2] : null);
      wSpark = sparkline(wVals, "var(--accent)");
    }

    // ---- Last sleep + 14d spark + Δ avg this week vs previous week
    var sleep = S.getAll("sleep").slice().sort(U.byNewest);
    var sleepHtml = sleep.length
      ? U.esc(U.fmtDuration(sleep[0].durationMin))
      : '<span class="unit">&mdash;</span>';
    var sleepSub = sleep.length
      ? U.fmtDate(sleep[0].date) + " · quality " + sleep[0].quality + "/5"
      : "no data yet";
    var sChip = "", sSpark = "";
    if (sleep.length) {
      var sVals = dailySeries(sleep, function (r) { return Number(r.durationMin) / 60; }, 14);
      sSpark = sparkline(sVals, "var(--g2)");
      var thisWk = avgNums(sVals.slice(7)), lastWk = avgNums(sVals.slice(0, 7));
      if (thisWk != null && lastWk != null) {
        var dH = thisWk - lastWk;
        sChip = deltaChip(dH, (dH > 0 ? "+" : "") + (Math.round(dH * 10) / 10) + "h", true);
      }
    }

    // ---- Workouts this week (Mon..today) + Δ vs previous 7 days
    var ws = weekStartISO();
    var exercise = S.getAll("exercise");
    var workouts = exercise.filter(function (r) { return r.date >= ws; });
    var wSub2 = workouts.length
      ? workouts.reduce(function (n, r) { return n + (r.durationMin || 0); }, 0) + " min total"
      : "since Monday";
    var exSeries = dailySeries(exercise, function () { return 1; }, 14);
    var exThis = exSeries.slice(7).reduce(function (n, v) { return n + (v || 0); }, 0);
    var exLast = exSeries.slice(0, 7).reduce(function (n, v) { return n + (v || 0); }, 0);
    var exChip = exercise.length
      ? deltaChip(exThis - exLast, (exThis - exLast > 0 ? "+" : "") + (exThis - exLast), true)
      : "";

    // ---- Calories today + 7d spark + Δ vs 7-day average
    var today = U.todayISO();
    var food = S.getAll("food");
    var kcal = food
      .filter(function (r) { return r.date === today; })
      .reduce(function (n, r) { return n + (r.calories || 0); }, 0);
    var t = OF.goals ? OF.goals.currentTargets() : null;
    var kcalSub = kcal
      ? (t && t.status === "ok" ? "target " + t.calories + " kcal" : "")
      : "nothing logged today";
    var kSeries = dailySeries(food, function (r) {
      var v = Number(r.calories); return isFinite(v) && v > 0 ? v : null;
    }, 14);
    var kSpark = sparkline(kSeries, "var(--warn)");
    var kAvg = avgNums(kSeries.slice(7, 13)); // this week excl. today
    var kChip = kcal && kAvg
      ? deltaChip(kcal - kAvg, (kcal - kAvg > 0 ? "+" : "") + Math.round(kcal - kAvg), null)
      : "";

    // ---- Goal progress mini-card
    var goalHtml = '<span class="unit">&mdash;</span>', goalSub = "set one on Insights";
    var gi = OF.goals ? OF.goals.info() : { goal: null };
    if (gi.goal) {
      var gp = gi.progress;
      if (gp && gp.status === "ok" && gp.targetKg != null) {
        goalHtml = Math.round((gp.pct || 0) * 100) + '<span class="unit">%</span>';
        goalSub = U.fmtWeightDelta((OF.targets.GOAL_TYPES[gi.goal.type].dir || 1) * Math.max(0, gp.achievedKg)) +
          " of " + U.fmtWeightDelta((OF.targets.GOAL_TYPES[gi.goal.type].dir || 1) * gp.targetKg) +
          (gp.metric === "muscle" ? " muscle" : "");
      } else {
        goalHtml = '<span class="unit">set</span>';
        goalSub = OF.targets.GOAL_TYPES[gi.goal.type].label;
      }
    }

    grid.innerHTML =
      card("Latest weight", weightHtml, weightSub, { chip: wChip, spark: wSpark }) +
      card("Last sleep", sleepHtml, sleepSub, { chip: sChip, spark: sSpark }) +
      card("Workouts this week", String(workouts.length), wSub2, { chip: exChip }) +
      card("Calories today",
        kcal ? String(Math.round(kcal)) + ' <span class="unit">kcal</span>' : '<span class="unit">&mdash;</span>',
        kcalSub, { chip: kChip, spark: kSpark }) +
      card("Goal progress", goalHtml, goalSub);
  }

  /* ---------------- "today vs targets" ring strip ---------------- */

  function targetCell(label, valueTxt, frac, color) {
    var pct = Math.round(Math.max(0, Math.min(1.5, isFinite(frac) ? frac : 0)) * 100);
    return '<div class="target-cell">' +
      U.progressRing(frac, { size: 68, color: color, value: pct + "%" }) +
      '<div class="target-cell-label">' + U.esc(label) + '</div>' +
      '<div class="target-cell-val">' + U.esc(valueTxt) + '</div>' +
      '</div>';
  }

  function renderTargets() {
    if (!targetsEl) return;
    var gi = OF.goals ? OF.goals.info() : { goal: null, targets: null };
    if (!gi.goal) {
      targetsEl.innerHTML =
        '<div class="card placeholder-card"><h2>Today vs targets</h2>' +
        '<div class="empty-state">' + OF.icons.badge("target") +
        '<p>Set a goal and this becomes daily calorie, protein, water and step rings that adapt to you.</p>' +
        '<a class="btn primary" href="#insights">Set a goal</a></div></div>';
      return;
    }
    var t = gi.targets;
    if (!t || t.status !== "ok") {
      targetsEl.innerHTML =
        '<div class="card placeholder-card"><h2>Today vs targets</h2>' +
        '<p class="muted">' + U.esc(t && t.message ? t.message : "Targets unavailable.") + '</p></div>';
      return;
    }

    var today = U.todayISO();
    var kcal = 0, prot = 0;
    S.getAll("food").forEach(function (r) {
      if (r.date !== today) return;
      if (isFinite(Number(r.calories))) kcal += Number(r.calories);
      if (isFinite(Number(r.protein))) prot += Number(r.protein);
    });
    var waterMl = OF.daily ? OF.daily.waterTodayMl() : 0;
    var stepsRec = OF.daily ? OF.daily.stepsRecordFor(today) : null;
    var steps = stepsRec && isFinite(Number(stepsRec.count)) ? Number(stepsRec.count) : 0;

    // Calorie ring color depends on the goal: overshooting matters on a cut,
    // undershooting matters on a bulk.
    var kcalFrac = kcal / t.calories;
    var kcalColor = "var(--accent)";
    if (kcalFrac >= 0.9 && kcalFrac <= 1.1) kcalColor = "var(--accent-2)";
    else if (t.goalType === "cut" && kcalFrac > 1.1) kcalColor = "var(--danger)";
    else if (t.goalType === "lean-bulk" && kcalFrac > 1.25) kcalColor = "var(--warn)";

    targetsEl.innerHTML =
      '<div class="card"><h2>Today vs targets</h2><div class="target-grid">' +
      targetCell("Calories", Math.round(kcal) + " / " + t.calories + " kcal", kcalFrac, kcalColor) +
      targetCell("Protein", Math.round(prot) + " / " + t.proteinG + " g",
        prot / t.proteinG, prot >= t.proteinG ? "var(--accent-2)" : "var(--accent)") +
      targetCell("Water", U.toDisplayWater(waterMl) + " / " + U.fmtWater(t.waterMl),
        waterMl / t.waterMl, waterMl >= t.waterMl ? "var(--accent-2)" : "var(--accent)") +
      targetCell("Steps", steps.toLocaleString() + " / " + t.steps.toLocaleString(),
        steps / t.steps, steps >= t.steps ? "var(--accent-2)" : "var(--accent)") +
      '</div></div>';
  }

  /* ---------------- charts ---------------- */

  function chartCard(title, innerHtml) {
    return '<div class="card chart-card"><h2>' + U.esc(title) + '</h2>' + innerHtml + '</div>';
  }

  /** Points {x: dayNum, y} for a body metric over the last `days` days. */
  function metricPoints(body, key, days) {
    var todayN = dayNum(U.todayISO());
    var pts = [];
    body.forEach(function (r) {
      var dn = dayNum(r.date), v = Number(r[key]);
      if (dn == null || !isFinite(v)) return;
      if (todayN - dn > days || todayN - dn < 0) return;
      pts.push({ x: dn, y: v });
    });
    pts.sort(function (a, b) { return a.x - b.x; });
    return pts;
  }

  function xTicksFor(pts) {
    if (pts.length < 2) return [];
    var first = pts[0].x, last = pts[pts.length - 1].x;
    var mid = Math.round((first + last) / 2);
    var ticks = [
      { x: first, label: shortDate(isoFromDayNum(first)) },
      { x: last, label: shortDate(isoFromDayNum(last)) }
    ];
    if (last - first > 20) ticks.splice(1, 0, { x: mid, label: shortDate(isoFromDayNum(mid)) });
    return ticks;
  }

  function bodyTrendCharts(body) {
    var defs = [
      { key: "weightKg", label: "Weight (" + U.weightUnit() + ")", color: "var(--accent)", convert: true },
      { key: "bodyFatPct", label: "Body fat (%)", color: "var(--warn)" },
      { key: "muscleMassPct", label: "Muscle mass (%)", color: "var(--accent-2)" }
    ];
    var anyData = false;
    var html = defs.map(function (def) {
      var pts = metricPoints(body, def.key, 90);
      if (def.convert) {
        pts = pts.map(function (p) { return { x: p.x, y: U.toDisplayWeight(p.y) }; });
      }
      if (pts.length >= 2) anyData = true;
      return '<div class="chart-mini-label">' + U.esc(def.label) + '</div>' +
        OF.charts.lineChart({
          height: 120,
          series: [{ label: def.label, color: def.color, points: pts }],
          xTicks: xTicksFor(pts),
          emptyMsg: "Not enough " + def.label.toLowerCase() + " measurements in the last 90 days."
        });
    }).join("");
    if (!anyData) {
      html = OF.charts.empty("No body measurements in the last 90 days — log weight, body fat % and muscle mass % on the Body tab.");
    }
    return chartCard("Body trends — last 90 days", html);
  }

  function sleepChart(sleep) {
    var todayN = dayNum(U.todayISO());
    var byDay = {};
    sleep.forEach(function (r) {
      var dn = dayNum(r.date), v = Number(r.durationMin);
      if (dn == null || !isFinite(v)) return;
      if (todayN - dn > 13 || todayN - dn < 0) return;
      byDay[dn] = r; // last one wins
    });
    var bars = [], hasAny = false;
    for (var dn = todayN - 13; dn <= todayN; dn++) {
      var r = byDay[dn];
      var label = String(dateFromDayNum(dn).getUTCDate());
      if (!r) { bars.push({ label: label, value: null }); continue; }
      hasAny = true;
      var q = Number(r.quality);
      var color = q >= 4 ? "var(--accent-2)" : q === 3 ? "var(--warn)" : "var(--danger)";
      var hours = Math.round((r.durationMin / 60) * 10) / 10;
      bars.push({ label: label, value: hours, color: color, valueLabel: String(hours) });
    }
    var inner = hasAny
      ? OF.charts.barChart({ bars: bars, yMax: 10, yFmt: function (v) { return v + "h"; } }) +
        '<div class="chart-legend">' +
        '<span class="legend-item"><span class="legend-swatch" style="background:var(--accent-2)"></span>quality 4&ndash;5</span>' +
        '<span class="legend-item"><span class="legend-swatch" style="background:var(--warn)"></span>quality 3</span>' +
        '<span class="legend-item"><span class="legend-swatch" style="background:var(--danger)"></span>quality 1&ndash;2</span>' +
        '</div>'
      : OF.charts.empty("No sleep logged in the last 14 days.");
    return chartCard("Sleep — last 14 days (h)", inner);
  }

  function perfByTimeChart(exercise, sleep) {
    // Same sleep adjustment as the Insights tab, so the highlighted
    // "best" bucket matches the recommendation there.
    var res = OF.engine.timeOfDay(exercise, OF.engine.buildSleepAdjuster(sleep, exercise));
    var withData = res.buckets.filter(function (b) { return b.count > 0; });
    if (!withData.length) {
      return chartCard("Performance by time of day",
        OF.charts.empty("No workouts logged yet — performance by time of day appears here."));
    }
    var bestKey = res.status === "ok" ? res.best.key : null;
    var bars = res.buckets.map(function (b) {
      return {
        label: b.label + (b.count ? " (" + b.count + ")" : ""),
        value: b.avgPerf,
        color: b.key === bestKey ? "var(--accent-2)" : "var(--accent)",
        valueLabel: b.avgPerf != null ? b.avgPerf + "/5" : ""
      };
    });
    return chartCard("Performance by time of day",
      OF.charts.barChart({ bars: bars, yMax: 5 }));
  }

  function nutritionChart(food) {
    var todayN = dayNum(U.todayISO());
    // Four rolling 7-day blocks ending today.
    var weeks = [];
    for (var w = 3; w >= 0; w--) {
      var end = todayN - w * 7, start = end - 6;
      weeks.push({ start: start, end: end, kcal: {}, prot: {} });
    }
    food.forEach(function (r) {
      var dn = dayNum(r.date);
      if (dn == null) return;
      weeks.forEach(function (wk) {
        if (dn < wk.start || dn > wk.end) return;
        var k = Number(r.calories), p = Number(r.protein);
        if (isFinite(k) && k > 0) wk.kcal[dn] = (wk.kcal[dn] || 0) + k;
        if (isFinite(p) && p > 0) wk.prot[dn] = (wk.prot[dn] || 0) + p;
      });
    });
    function avgOf(map) {
      var keys = Object.keys(map);
      if (!keys.length) return null;
      var sum = keys.reduce(function (n, k) { return n + map[k]; }, 0);
      return sum / keys.length;
    }
    var hasAny = false;
    var kcalBars = weeks.map(function (wk) {
      var v = avgOf(wk.kcal);
      if (v != null) hasAny = true;
      return {
        label: "wk of " + shortDate(isoFromDayNum(wk.start)),
        value: v != null ? Math.round(v) : null,
        color: "var(--accent)",
        valueLabel: v != null ? String(Math.round(v)) : ""
      };
    });
    var protBars = weeks.map(function (wk) {
      var v = avgOf(wk.prot);
      return {
        label: "wk of " + shortDate(isoFromDayNum(wk.start)),
        value: v != null ? Math.round(v) : null,
        color: "var(--accent-2)",
        valueLabel: v != null ? Math.round(v) + "g" : ""
      };
    });
    var inner = hasAny
      ? '<div class="chart-mini-label">Avg daily calories (kcal)</div>' +
        OF.charts.barChart({ bars: kcalBars, height: 160 }) +
        '<div class="chart-mini-label">Avg daily protein (g)</div>' +
        OF.charts.barChart({ bars: protBars, height: 160 })
      : OF.charts.empty("No meals logged in the last 4 weeks.");
    return chartCard("Nutrition — weekly averages (4 weeks)", inner);
  }

  function renderCharts(sleep, food, exercise, body) {
    if (!chartsEl) return;

    if (!sleep.length && !food.length && !exercise.length && !body.length) {
      chartsEl.innerHTML =
        '<div class="card placeholder-card"><h2>Trend charts</h2>' +
        '<div class="empty-state">' + OF.icons.badge("trend") +
        '<p>Charts appear here once you have some data. Log entries on the tracker tabs ' +
        '&mdash; or load demo data to see everything in action.</p>' +
        '<a class="btn primary" href="#settings">Open Settings</a></div></div>';
      return;
    }

    chartsEl.innerHTML =
      bodyTrendCharts(body) +
      sleepChart(sleep) +
      perfByTimeChart(exercise, sleep) +
      nutritionChart(food);
  }

  function refresh() {
    if (!grid) return;
    var sleep = S.getAll("sleep");
    var food = S.getAll("food");
    var exercise = S.getAll("exercise");
    var body = S.getAll("body");

    // Readiness for the hero ring (same engine result as Insights).
    var readiness = null;
    try {
      readiness = OF.engine.analyzeAll(
        { sleep: sleep, food: food, exercise: exercise, body: body }).readiness;
    } catch (e) { /* hero degrades to the empty ring */ }

    renderHero(readiness);
    renderStats();
    renderTargets();
    renderCharts(sleep, food, exercise, body);
  }

  return { init: init, refresh: refresh };
})();

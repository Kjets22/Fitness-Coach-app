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

  /** Trial countdown + accumulated-trainer-value strip → makes the invisible
      on-device value legible exactly when the trial clock matters. */
  function renderTrainerValue() {
    var el = document.getElementById("dash-value");
    if (!el) return;
    var trialDays = null;
    try { trialDays = OF.entitlements && OF.entitlements.trialDaysLeft ? OF.entitlements.trialDaysLeft() : null; } catch (e) {}
    var st = {}; try { st = OF.trainer ? OF.trainer.getStats() : {}; } catch (e) {}
    var bits = [];
    if (st.bumps) bits.push("added weight <strong>" + st.bumps + "×</strong>");
    if (st.prs) bits.push("celebrated <strong>" + st.prs + "</strong> PR" + (st.prs > 1 ? "s" : ""));
    var streakN = 0; try { streakN = OF.streak ? OF.streak.compute().current : 0; } catch (e) {}
    if (streakN >= 3) bits.push("kept a <strong>" + streakN + "-day</strong> streak");
    if (trialDays != null) {
      var val = bits.length ? "So far I've " + bits.slice(0, 2).join(" and ") + "." : "Your AI trainer, coach and photo tools are unlocked.";
      el.innerHTML = '<div class="card value-strip">' +
        '<div class="value-strip-head">✨ Premium trial — ' + trialDays + ' day' + (trialDays === 1 ? "" : "s") + ' left</div>' +
        '<p class="value-strip-body">' + val + ' Keep your always-on trainer, the AI coach and photo tools — for less than one session with a human PT a month.</p></div>';
      el.hidden = false;
    } else if (bits.length >= 2) {
      el.innerHTML = '<div class="card value-strip value-strip-soft"><p class="value-strip-body">💪 Your trainer so far: ' + bits.join(" · ") + '.</p></div>';
      el.hidden = false;
    } else { el.hidden = true; el.innerHTML = ""; }
  }

  function init() {
    grid = document.getElementById("dash-stats");
    chartsEl = document.getElementById("dash-charts");
    targetsEl = document.getElementById("dash-targets");
    heroEl = document.getElementById("dash-hero");
    if (grid) {
      grid.addEventListener("click", onStatClick);
      grid.addEventListener("keydown", function (e) {
        if ((e.key === "Enter" || e.key === " ") && e.target.closest("[data-metric]")) {
          e.preventDefault(); onStatClick(e);
        }
      });
    }
    refresh();
  }

  /* ---------------- date helpers ---------------- */

  function parseISO(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function dayNum(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    // Anchor at 12:00 UTC (not local midnight) so the epoch-day is the exact
    // inverse of dateFromDayNum's (dn + 0.5) reconstruction. Local midnight
    // straddles the UTC date boundary in UTC+13/+14, shifting chart/sleep-bar
    // date labels off by one day there.
    return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], 12) / 86400000) : null;
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

  /** Today's protein / steps / water shortfall vs target → the biggest gap, or "". */
  function biggestGapToday() {
    var t = OF.goals ? OF.goals.currentTargets() : null;
    if (!t || t.status !== "ok") return "";
    var today = U.todayISO();
    var prot = 0, kcal = 0;
    S.getAll("food").forEach(function (r) {
      if (r.date === today) { prot += Number(r.protein) || 0; kcal += Number(r.calories) || 0; }
    });
    var steps = 0; try { var sr = OF.daily && OF.daily.stepsRecordFor(today); steps = sr ? Number(sr.count) || 0 : 0; } catch (e) {}
    var cands = [];
    if (t.proteinG && kcal > 0 && prot < t.proteinG * 0.7) cands.push({ frac: prot / t.proteinG, txt: Math.round(t.proteinG - prot) + "g short on protein" });
    if (t.steps && steps > 0 && steps < t.steps * 0.7) cands.push({ frac: steps / t.steps, txt: (Math.round((t.steps - steps) / 100) * 100) + " steps to go" });
    cands.sort(function (a, b) { return a.frac - b.frac; });
    return cands.length ? cands[0].txt : "";
  }

  /** One coached sentence for the hero. */
  function dailyBrief(readiness) {
    var parts = [];
    var ns = null; try { ns = OF.trainer && OF.trainer.nextSession ? OF.trainer.nextSession() : null; } catch (e) {}
    if (ns) parts.push(ns.name + " day");
    if (readiness && readiness.status === "ok") parts.push("readiness " + readiness.score);
    var gap = biggestGapToday();
    if (gap) parts.push(gap);
    try {
      var s = OF.streak ? OF.streak.compute() : null;
      if (s && s.current >= 2) {
        var next = [3, 7, 14, 30, 50, 100, 200, 365].filter(function (m) { return m > s.current; })[0];
        if (next && next - s.current <= 2 && !s.loggedToday) parts.push((next - s.current) + " day" + (next - s.current === 1 ? "" : "s") + " from a " + next + "-day streak");
      }
    } catch (e) {}
    return parts.slice(0, 3).join(" · ");
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
    var streakChip = "";
    try { streakChip = OF.streak ? OF.streak.chipHtml() : ""; } catch (e) {}
    var brief = dailyBrief(readiness);
    heroEl.innerHTML =
      '<header class="hero">' +
      '<div class="hero-main"><div class="hero-greet-row"><h1 class="hero-greet">' + U.esc(greeting()) + '</h1>' + streakChip + '</div>' +
      '<p class="hero-date">' + U.esc(dateTxt) + '</p>' +
      (brief ? '<p class="hero-brief">' + U.esc(brief) + '</p>' : '') + '</div>' +
      '<div class="hero-ring" title="' +
      U.esc(readiness && readiness.status === "ok" ? readiness.verdict : "Log a few nights of sleep to unlock your readiness score") +
      '">' + ringHtml + '<span class="hero-ring-label">Readiness</span></div>' +
      '</header>';
    // celebrate a new streak milestone (once)
    try {
      var ms = OF.streak && OF.streak.newMilestone ? OF.streak.newMilestone() : 0;
      if (ms && U.toast) U.toast("🔥 " + ms + "-day streak! Keep it going.");
    } catch (e) {}
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
    var tap = extras.metric
      ? ' stat-card-tap" data-metric="' + extras.metric + '" role="button" tabindex="0" aria-label="' +
        U.esc(label) + ' — tap for trend'
      : '';
    return '<div class="stat-card' + tap + '">' +
      '<div class="stat-head"><div class="stat-label">' + U.esc(label) + '</div>' +
      (extras.chip || "") + '</div>' +
      '<div class="stat-value">' + valueHtml + '</div>' +
      (sub ? '<div class="stat-sub">' + U.esc(sub) + '</div>' : '') +
      (extras.spark || "") +
      (extras.metric ? '<span class="stat-tap-hint" aria-hidden="true">View trend ›</span>' : '') +
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
      // Unknown/legacy goal types have no GOAL_TYPES entry — guard so the
      // dashboard degrades gracefully instead of throwing on .dir/.label.
      var gt = OF.targets.GOAL_TYPES[gi.goal.type];
      var gp = gi.progress;
      if (gt && gp && gp.status === "ok" && gp.targetKg != null) {
        goalHtml = Math.round((gp.pct || 0) * 100) + '<span class="unit">%</span>';
        goalSub = U.fmtWeightDelta((gt.dir || 1) * Math.max(0, gp.achievedKg)) +
          " of " + U.fmtWeightDelta((gt.dir || 1) * gp.targetKg) +
          (gp.metric === "muscle" ? " muscle" : "");
      } else {
        goalHtml = '<span class="unit">set</span>';
        goalSub = gt ? gt.label : "Goal set";
      }
    }

    grid.innerHTML =
      card("Latest weight", weightHtml, weightSub, { chip: wChip, spark: wSpark, metric: "weight" }) +
      card("Last sleep", sleepHtml, sleepSub, { chip: sChip, spark: sSpark, metric: "sleep" }) +
      card("Workouts this week", String(workouts.length), wSub2, { chip: exChip, metric: "workouts" }) +
      card("Calories today",
        kcal ? String(Math.round(kcal)) + ' <span class="unit">kcal</span>' : '<span class="unit">&mdash;</span>',
        kcalSub, { chip: kChip, spark: kSpark, metric: "calories" }) +
      card("Goal progress", goalHtml, goalSub);
  }

  /* ---------------- tap-a-tile → trend detail modal ---------------- */

  function statPill(label, value) {
    return '<div class="metric-stat"><div class="metric-stat-val">' + value +
      '</div><div class="metric-stat-lbl">' + U.esc(label) + '</div></div>';
  }

  function fmt1(v) { return Math.round(v * 10) / 10; }

  /** Build {title, tab, statsHtml, chartHtml} for a metric. */
  function buildDetail(metric) {
    var todayN = dayNum(U.todayISO());
    if (metric === "weight") {
      var body = S.getAll("body").filter(function (r) { return isFinite(Number(r.weightKg)); })
        .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
      if (!body.length) return { title: "Weight trend", tab: "body", statsHtml: "", chartHtml: OF.charts.empty("No weight logged yet — add one on the Body tab.") };
      var pts = body.map(function (r) { return { x: dayNum(r.date), y: Number(U.toDisplayWeight(r.weightKg)) }; });
      var ys = pts.map(function (p) { return p.y; });
      var first = ys[0], last = ys[ys.length - 1];
      var unit = U.weightUnit();
      var stats = statPill("Current", fmt1(last) + " " + unit) +
        statPill("Change", (last - first >= 0 ? "+" : "") + fmt1(last - first) + " " + unit) +
        statPill("Lowest", fmt1(Math.min.apply(null, ys)) + " " + unit) +
        statPill("Highest", fmt1(Math.max.apply(null, ys)) + " " + unit) +
        statPill("Entries", String(body.length));
      var chart = OF.charts.lineChart({ series: [{ points: pts, color: "var(--accent)" }],
        width: 640, height: 220, yFmt: function (v) { return fmt1(v) + ""; } });
      return { title: "Weight trend", tab: "body", statsHtml: stats, chartHtml: chart };
    }
    if (metric === "sleep") {
      var sleep = S.getAll("sleep").filter(function (r) { return isFinite(Number(r.durationMin)); })
        .sort(function (a, b) { return a.date < b.date ? -1 : 1; }).slice(-21);
      if (!sleep.length) return { title: "Sleep trend", tab: "sleep", statsHtml: "", chartHtml: OF.charts.empty("No sleep logged yet — add a night on the Sleep tab.") };
      var qcol = ["var(--danger)", "var(--warn)", "var(--accent)", "var(--g2)", "var(--accent-2)"];
      var bars = sleep.map(function (r) {
        var q = Math.max(1, Math.min(5, Number(r.quality) || 3));
        return { label: shortDate(r.date), value: fmt1(Number(r.durationMin) / 60), color: qcol[q - 1] };
      });
      var hrs = sleep.map(function (r) { return Number(r.durationMin) / 60; });
      var avg = hrs.reduce(function (a, b) { return a + b; }, 0) / hrs.length;
      var last7 = hrs.slice(-7), avg7 = last7.reduce(function (a, b) { return a + b; }, 0) / last7.length;
      var stats = statPill("Last night", fmt1(hrs[hrs.length - 1]) + "h") +
        statPill("7-day avg", fmt1(avg7) + "h") +
        statPill("Best", fmt1(Math.max.apply(null, hrs)) + "h") +
        statPill("Nights", String(sleep.length));
      return { title: "Sleep trend", tab: "sleep", statsHtml: stats,
        chartHtml: OF.charts.barChart({ bars: bars, width: 640, height: 220, yFmt: function (v) { return fmt1(v) + "h"; } }) };
    }
    if (metric === "calories") {
      var food = S.getAll("food");
      var byDay = {};
      food.forEach(function (r) {
        var dn = dayNum(r.date), v = Number(r.calories);
        if (dn == null || !isFinite(v) || v <= 0) return;
        if (todayN - dn < 0 || todayN - dn > 20) return;
        byDay[dn] = (byDay[dn] || 0) + v;
      });
      var barsC = [], vals = [];
      for (var d = todayN - 20; d <= todayN; d++) {
        var v = byDay[d] != null ? Math.round(byDay[d]) : null;
        barsC.push({ label: shortDate(isoFromDayNum(d)), value: v, color: "var(--warn)" });
        if (v != null) vals.push(v);
      }
      if (!vals.length) return { title: "Calories trend", tab: "food", statsHtml: "", chartHtml: OF.charts.empty("No meals logged yet — add one on the Food tab.") };
      var tC = OF.goals ? OF.goals.currentTargets() : null;
      var avgC = Math.round(vals.reduce(function (a, b) { return a + b; }, 0) / vals.length);
      var stats = statPill("Avg / day", avgC + " kcal") +
        (tC && tC.status === "ok" ? statPill("Target", tC.calories + " kcal") : "") +
        statPill("Highest", Math.max.apply(null, vals) + " kcal") +
        statPill("Days logged", String(vals.length));
      return { title: "Calories trend", tab: "food", statsHtml: stats,
        chartHtml: OF.charts.barChart({ bars: barsC, width: 640, height: 220, yFmt: function (v) { return Math.round(v) + ""; } }) };
    }
    // workouts — per-week counts over 8 weeks
    var exercise = S.getAll("exercise");
    var weeksB = [], counts = [];
    for (var w = 7; w >= 0; w--) {
      var end = todayN - 7 * w, start = end - 6, c = 0, mins = 0;
      exercise.forEach(function (r) {
        var dn = dayNum(r.date);
        if (dn != null && dn >= start && dn <= end) { c++; mins += Number(r.durationMin) || 0; }
      });
      weeksB.push({ label: shortDate(isoFromDayNum(end)), value: c, color: "var(--accent)" });
      counts.push(c);
    }
    if (!counts.some(function (c) { return c > 0; })) return { title: "Workout frequency", tab: "exercise", statsHtml: "", chartHtml: OF.charts.empty("No workouts logged yet — start one on the Workout tab.") };
    var totalMin = 0, totalW = 0;
    exercise.forEach(function (r) { var dn = dayNum(r.date); if (dn != null && todayN - dn <= 55 && todayN - dn >= 0) { totalW++; totalMin += Number(r.durationMin) || 0; } });
    var statsW = statPill("Last 7 days", String(counts[counts.length - 1])) +
      statPill("Avg / week", fmt1(counts.reduce(function (a, b) { return a + b; }, 0) / counts.length) + "") +
      statPill("8-wk total", String(counts.reduce(function (a, b) { return a + b; }, 0))) +
      statPill("Total minutes", String(totalMin));
    return { title: "Workout frequency", tab: "exercise", statsHtml: statsW,
      chartHtml: OF.charts.barChart({ bars: weeksB, width: 640, height: 220, yFmt: function (v) { return Math.round(v) + ""; } }) };
  }

  var modalEl = null;
  function ensureModal() {
    if (modalEl) return modalEl;
    modalEl = document.createElement("div");
    modalEl.className = "metric-modal";
    modalEl.hidden = true;
    modalEl.innerHTML = '<div class="metric-modal-backdrop" data-close-metric></div>' +
      '<div class="metric-modal-panel" role="dialog" aria-modal="true" aria-labelledby="metric-modal-title">' +
      '<div class="metric-modal-head"><h2 id="metric-modal-title"></h2>' +
      '<button type="button" class="metric-modal-close" data-close-metric aria-label="Close">&times;</button></div>' +
      '<div class="metric-stats"></div><div class="metric-chart"></div>' +
      '<a class="btn ghost metric-modal-link" href="#">Open full tab</a></div>';
    document.body.appendChild(modalEl);
    modalEl.addEventListener("click", function (e) {
      if (e.target.closest("[data-close-metric]") || e.target.closest(".metric-modal-link")) closeModal();
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !modalEl.hidden) closeModal(); });
    return modalEl;
  }
  function closeModal() { if (modalEl) modalEl.hidden = true; document.body.classList.remove("metric-modal-open"); }

  function openMetricDetail(metric) {
    var d;
    try { d = buildDetail(metric); } catch (e) { return; }
    if (!d) return;
    var m = ensureModal();
    m.querySelector("#metric-modal-title").textContent = d.title;
    m.querySelector(".metric-stats").innerHTML = d.statsHtml || "";
    m.querySelector(".metric-chart").innerHTML = d.chartHtml || "";
    var link = m.querySelector(".metric-modal-link");
    link.setAttribute("href", "#" + d.tab);
    link.textContent = "Open " + (d.tab === "exercise" ? "Workout" : d.tab.charAt(0).toUpperCase() + d.tab.slice(1)) + " tab";
    m.hidden = false;
    document.body.classList.add("metric-modal-open");
  }

  function onStatClick(e) {
    var t = e.target.closest("[data-metric]");
    if (t) openMetricDetail(t.getAttribute("data-metric"));
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
    var hasKcal = false, hasProt = false;
    var kcalBars = weeks.map(function (wk) {
      var v = avgOf(wk.kcal);
      if (v != null) hasKcal = true;
      return {
        label: "wk of " + shortDate(isoFromDayNum(wk.start)),
        value: v != null ? Math.round(v) : null,
        color: "var(--accent)",
        valueLabel: v != null ? String(Math.round(v)) : ""
      };
    });
    var protBars = weeks.map(function (wk) {
      var v = avgOf(wk.prot);
      if (v != null) hasProt = true;
      return {
        label: "wk of " + shortDate(isoFromDayNum(wk.start)),
        value: v != null ? Math.round(v) : null,
        color: "var(--accent-2)",
        valueLabel: v != null ? Math.round(v) + "g" : ""
      };
    });
    // Render each sub-chart only when it has data, so a protein-only history
    // (meals with protein but zero calories) still shows the protein chart
    // instead of collapsing to the empty state.
    var inner = (hasKcal || hasProt)
      ? (hasKcal
          ? '<div class="chart-mini-label">Avg daily calories (kcal)</div>' +
            OF.charts.barChart({ bars: kcalBars, height: 160 })
          : "") +
        (hasProt
          ? '<div class="chart-mini-label">Avg daily protein (g)</div>' +
            OF.charts.barChart({ bars: protBars, height: 160 })
          : "")
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
    if (OF.trainer && OF.trainer.refresh) { try { OF.trainer.refresh(); } catch (e) {} }
    try { renderTrainerValue(); } catch (e) {}
    renderTargets();
    renderCharts(sleep, food, exercise, body);

    // Receipts-Day Sunday nudge (signed-in only; unobtrusive; P3-6).
    if (OF.receipts) {
      try { OF.receipts.dashNudge(document.getElementById("dash-receipts")); }
      catch (e) { /* never break the dashboard */ }
    }
  }

  return { init: init, refresh: refresh };
})();

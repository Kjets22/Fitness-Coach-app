/* ============================================================
   receipts.js — OF.receipts: coach-verified "Receipts".

   Generates receipt payloads from REAL local data (never typed
   numbers), mirrors the backend plausibility gates client-side
   (supabase/migrations/20260708100006_receipts_benchmarks.sql)
   so only receipts that CAN verify are offered, and owns:
     - the Receipts-Day banner / dashboard nudge logic
     - PNG export (canvas → Web Share API / download)
     - the community-benchmarks cache feeding insights + coach

   Payload shapes (exactly what create_receipt_post validates —
   extra fields ride along in the jsonb for card rendering only):
     pr          { type,lift,training_age,series:[{day,e1rm}],
                   sessions*, records_only* }
     consistency { type,training_age,weeks:[{planned,done}],
                   days7*, streak*, basis* }
     progress    { type,metric:"weight",start_value,end_value,
                   days, start_date*, end_date*, maintenance* }
     weekly      { type,workouts,total_sets?,total_volume_kg?,
                   sleep_avg_h*, best_lift*, week_end* }
   (* = display-only extras, ignored by the backend gates.)

   All values metric kg internally; display goes through
   U.fmtWeight etc. Nothing here talks to the network except
   getBenchmarks() via OF.socialApi (cached per session).
   ============================================================ */

window.OF = window.OF || {};

OF.receipts = (function () {
  "use strict";

  var U = OF.util, S = OF.storage;
  var SOC_KEY = "optimalfit.social";

  function num(v) {
    if (v == null || v === "") return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function round1(v) { return v == null ? null : Math.round(v * 10) / 10; }

  function T() { return OF.targets; }

  /* ================= local mirror of the backend gates =================
     Same rules as create_receipt_post()'s plausibility section. */

  function validate(r) {
    if (!r || typeof r !== "object") return { ok: false, reason: "not an object" };
    var i;
    if (r.type === "pr") {
      if (!r.lift || typeof r.lift !== "string" || !r.lift.trim()) {
        return { ok: false, reason: "pr receipt missing lift name" };
      }
      var s = r.series;
      if (!Array.isArray(s)) return { ok: false, reason: "pr receipt missing e1RM series" };
      if (s.length < 6) return { ok: false, reason: "need at least 6 e1RM data points as backing history" };
      var prevDay = null, prevVal = null, firstDay = null;
      for (i = 0; i < s.length; i++) {
        var d = T().dayNum(s[i] && s[i].day);
        var v = num(s[i] && s[i].e1rm);
        if (d == null || v == null) return { ok: false, reason: "series points must carry day and e1rm" };
        if (v < 20 || v > 500) return { ok: false, reason: "e1RM outside plausible 20-500 kg range" };
        if (prevDay != null) {
          if (d <= prevDay) return { ok: false, reason: "series dates must be strictly increasing" };
          if (v > prevVal * Math.pow(1.10, (d - prevDay) / 7) + 0.001) {
            return { ok: false, reason: "e1RM jump exceeds +10% per week" };
          }
        } else firstDay = d;
        prevDay = d; prevVal = v;
      }
      if (prevDay - firstDay < 21) return { ok: false, reason: "series must span at least 21 days" };
      return { ok: true };
    }
    if (r.type === "consistency") {
      var w = r.weeks;
      if (!Array.isArray(w) || w.length < 2) return { ok: false, reason: "needs a weeks array (>=2 weeks)" };
      for (i = 0; i < w.length; i++) {
        var p = num(w[i] && w[i].planned), dn = num(w[i] && w[i].done);
        if (p == null || dn == null || p < 1 || p > 7 || dn < 0 || dn > 7 ||
            p !== Math.round(p) || dn !== Math.round(dn)) {
          return { ok: false, reason: "weeks must carry planned 1-7 and done 0-7" };
        }
      }
      return { ok: true };
    }
    if (r.type === "progress") {
      var sv = num(r.start_value), ev = num(r.end_value), days = num(r.days);
      if (sv == null || ev == null || days == null) return { ok: false, reason: "needs start_value, end_value, days" };
      if (sv < 30 || sv > 300 || ev < 30 || ev > 300) return { ok: false, reason: "values outside plausible 30-300 range" };
      if (days < 14 || days > 730) return { ok: false, reason: "window must be 14-730 days" };
      if (Math.abs(Math.pow(ev / sv, 7 / days) - 1) > 0.015) {
        return { ok: false, reason: "change exceeds 1.5% per week" };
      }
      return { ok: true };
    }
    if (r.type === "weekly") {
      var wo = num(r.workouts);
      if (wo == null || wo < 0 || wo > 7 || wo !== Math.floor(wo)) {
        return { ok: false, reason: "workouts must be an integer 0-7" };
      }
      if (r.total_sets != null) {
        var ts = num(r.total_sets);
        if (ts == null || ts < 0 || ts > 250) return { ok: false, reason: "total_sets outside 0-250" };
      }
      if (r.total_volume_kg != null) {
        var tv = num(r.total_volume_kg);
        if (tv == null || tv < 0 || tv > 150000) return { ok: false, reason: "total_volume_kg outside range" };
      }
      return { ok: true };
    }
    return { ok: false, reason: "unknown receipt type" };
  }

  /* ================= training-age bucket =================
     Honest heuristic from the LOGGED exercise history span (the app
     can't know about training before it existed): 3y+ of logs → gt3y,
     1y+ → 1to3y, 60d+ → lt1y (newer lifter), else unknown. */

  function trainingAge() {
    var first = null;
    S.getAll("exercise").forEach(function (r) {
      if (r && r.date && (!first || r.date < first)) first = r.date;
    });
    if (!first) return "unknown";
    var span = T().dayNum(U.todayISO()) - T().dayNum(first);
    if (span == null || !isFinite(span)) return "unknown";
    if (span >= 3 * 365) return "gt3y";
    if (span >= 365) return "1to3y";
    if (span >= 60) return "lt1y";
    return "unknown";
  }

  function bucketLabel(b) {
    return b === "lt1y" ? "newer (<1y)" :
      b === "1to3y" ? "1–3y" :
      b === "gt3y" ? "3y+" : "all-experience";
  }

  /* ================= data plumbing ================= */

  function allData() {
    return {
      exercise: S.getAll("exercise"),
      sleep: S.getAll("sleep"),
      food: S.getAll("food"),
      body: S.getAll("body")
    };
  }

  function strengthRes(data) {
    if (!OF.strength) return null;
    try {
      var gi = OF.goals ? OF.goals.info() : null;
      return OF.strength.analyze({
        exercise: data.exercise, sleep: data.sleep, food: data.food, body: data.body,
        goalType: gi && gi.goal ? gi.goal.type : null,
        proteinTargetG: gi && gi.targets && gi.targets.status === "ok" ? gi.targets.proteinG : null
      });
    } catch (e) { return null; }
  }

  /* ================= PR receipt =================
     Backing series = per-session e1RM points from the last 8 weeks
     (12 weeks if 8 don't give enough history). A deload dip followed
     by a normal recovery can trip the +10%/week jump gate, so we pick
     the longest cap-respecting sub-series of REAL sessions that ends
     at the PR session (simple O(n²) chain — points are only ever
     dropped, never invented). */

  function chainEndingAtPR(pts) {
    var n = pts.length;
    if (!n) return [];
    var pr = 0, i, j;
    for (i = 1; i < n; i++) if (pts[i].y >= pts[pr].y) pr = i;
    var best = [], prev = [], startX = [];
    for (i = 0; i < n; i++) { best[i] = 1; prev[i] = -1; startX[i] = pts[i].x; }
    for (i = 1; i <= pr; i++) {
      for (j = 0; j < i; j++) {
        if (pts[i].x <= pts[j].x) continue;
        if (pts[i].y > pts[j].y * Math.pow(1.10, (pts[i].x - pts[j].x) / 7) + 0.001) continue;
        var cand = best[j] + 1;
        if (cand > best[i] || (cand === best[i] && startX[j] < startX[i])) {
          best[i] = cand; prev[i] = j; startX[i] = startX[j];
        }
      }
    }
    var chain = [], k = pr;
    while (k !== -1) { chain.unshift(pts[k]); k = prev[k]; }
    return chain;
  }

  function prPayloadFor(ex, todayNum) {
    var sessions = (ex._sessions || [])
      .filter(function (s) { return s.e1RM != null && s.e1RM >= 20 && s.e1RM <= 500; })
      .map(function (s) { return { x: s.day, y: s.e1RM }; })
      .sort(function (a, b) { return a.x - b.x; });
    var windows = [56, 84];
    for (var w = 0; w < windows.length; w++) {
      var pts = sessions.filter(function (p) { return todayNum - p.x <= windows[w]; });
      var chain = chainEndingAtPR(pts);
      if (chain.length < 6 || chain[chain.length - 1].x - chain[0].x < 21) continue;
      var payload = {
        type: "pr",
        lift: ex.name.slice(0, 50),
        training_age: trainingAge(),
        series: chain.map(function (p) { return { day: T().isoFromDayNum(p.x), e1rm: p.y }; }),
        sessions: ex.sessions
      };
      if (chain.length < pts.length) payload.records_only = true;
      if (validate(payload).ok) return payload;
    }
    return null;
  }

  /* ================= consistency receipt ================= */

  function plannedPerWeek() {
    var goal = OF.goals ? OF.goals.activeGoal() : null;
    var map = { sedentary: 2, light: 3, moderate: 4, active: 6, "very-active": 6 };
    if (goal && goal.activity && map[goal.activity]) {
      return { n: map[goal.activity], basis: "goal" };
    }
    return null;
  }

  function consistencyPayload(data, todayNum) {
    var trained = {};
    data.exercise.forEach(function (r) {
      var dn = T().dayNum(r && r.date);
      if (dn != null) trained[dn] = true;
    });
    var blocks = [], totalDone = 0, doneMax = 0;
    for (var b = 3; b >= 0; b--) { // oldest -> newest rolling 7-day blocks
      var end = todayNum - b * 7, done = 0;
      for (var d = end - 6; d <= end; d++) if (trained[d]) done++;
      blocks.push(done);
      totalDone += done;
      if (done > doneMax) doneMax = done;
    }
    if (totalDone < 2) return null; // nothing worth a receipt
    var plan = plannedPerWeek();
    var planned = plan ? Math.max(1, Math.min(7, plan.n))
      : Math.max(1, Math.min(7, doneMax)); // honest fallback: your own typical week
    var weeks = blocks.map(function (done) { return { planned: planned, done: done }; });
    var days7 = [];
    for (var d2 = todayNum - 6; d2 <= todayNum; d2++) days7.push(trained[d2] ? 1 : 0);
    var streak = 0, cur = trained[todayNum] ? todayNum : todayNum - 1;
    while (trained[cur]) { streak++; cur--; }
    var payload = {
      type: "consistency",
      training_age: trainingAge(),
      weeks: weeks,
      days7: days7,
      streak: streak,
      basis: plan ? "goal" : "typical"
    };
    return validate(payload).ok ? payload : null;
  }

  /* ================= progress receipt ================= */

  function progressPayload(data, todayNum) {
    if (!OF.goals) return null;
    var goal = OF.goals.activeGoal();
    if (!goal) return null;
    var adjs = OF.goals.calorieAdjs();
    var live = null;
    try {
      live = T().computeAdaptation(data.food, data.body, goal, U.todayISO(), OF.goals.adjTotal());
    } catch (e) { live = null; }
    // Only when the adaptation engine has something learned to show.
    if (!adjs.length && !(live && live.ready)) return null;

    var pts = [];
    data.body.forEach(function (r) {
      var dn = T().dayNum(r && r.date), w = num(r && r.weightKg);
      if (dn == null || w == null) return;
      if (todayNum - dn > 28 || todayNum - dn < 0) return;
      pts.push({ x: dn, y: w, date: r.date });
    });
    pts.sort(function (a, b) { return a.x - b.x; });
    if (pts.length < 2) return null;
    var first = pts[0], last = pts[pts.length - 1];
    var days = last.x - first.x;
    if (days < 14) return null;
    var payload = {
      type: "progress",
      metric: "weight",
      start_value: round1(first.y),
      end_value: round1(last.y),
      days: days,
      start_date: first.date,
      end_date: last.date
    };
    if (live && live.ready) {
      var targets = OF.goals.currentTargets();
      payload.maintenance = {
        learned_kcal: live.blendedMaintenance,
        formula_kcal: targets && targets.status === "ok" ? targets.maintenanceKcal : null
      };
    } else if (adjs.length) {
      payload.adjustments = adjs.length;
    }
    return validate(payload).ok ? payload : null;
  }

  /* ================= weekly receipt ================= */

  function weeklyPayload(data, todayNum, st) {
    var days = {}, sets = 0, volKg = 0;
    data.exercise.forEach(function (r) {
      var dn = T().dayNum(r && r.date);
      if (dn == null || todayNum - dn > 6 || todayNum - dn < 0) return;
      days[dn] = true;
      (Array.isArray(r.exercises) ? r.exercises : []).forEach(function (ex) {
        (ex && Array.isArray(ex.sets) ? ex.sets : []).forEach(function (s) {
          var reps = num(s && s.reps);
          if (reps == null || reps < 1) return;
          sets++;
          var w = num(s && s.weightKg);
          if (w != null && w > 0) volKg += w * reps;
        });
      });
    });
    var workouts = Math.min(7, Object.keys(days).length);
    if (!workouts) return null;
    var payload = { type: "weekly", workouts: workouts, week_end: U.todayISO() };
    if (sets > 0 && sets <= 250) payload.total_sets = sets;
    if (volKg > 0 && volKg <= 150000) payload.total_volume_kg = Math.round(volKg);
    // sleep average over the last 7 nights that were logged
    var sh = [], cutoff = U.todayISO(-6);
    data.sleep.forEach(function (r) {
      var d = num(r && r.durationMin);
      if (r && r.date && r.date >= cutoff && d != null) sh.push(d / 60);
    });
    if (sh.length) {
      payload.sleep_avg_h = round1(sh.reduce(function (a, b) { return a + b; }, 0) / sh.length);
      payload.good_sleep_nights = sh.filter(function (h) { return h >= 7; }).length;
    }
    // best improving lift this cycle
    if (st && st.status === "ok") {
      var best = null;
      st.exercises.forEach(function (ex) {
        if (ex.trendPctWk == null || ex.verdict !== "improving") return;
        if (!best || ex.trendPctWk > best.trendPctWk) best = ex;
      });
      if (best) payload.best_lift = { name: best.name.slice(0, 50), trend_pct_wk: best.trendPctWk };
    }
    return validate(payload).ok ? payload : null;
  }

  /* ================= the candidate list ================= */

  /** All receipts generatable RIGHT NOW from local data (already
      validated against the backend gates — only offer what can verify). */
  function available() {
    var out = [];
    var data = allData();
    var todayNum = T().dayNum(U.todayISO());
    var st = strengthRes(data);

    if (st && st.status === "ok") {
      st.exercises.forEach(function (ex) {
        if (!ex.recentPR || !ex.bestE1RM) return;
        var p = prPayloadFor(ex, todayNum);
        if (!p) return;
        out.push({
          id: "pr:" + ex.name.trim().toLowerCase(),
          type: "pr",
          label: ex.name + " PR",
          sub: "New best e1RM " + U.fmtWeight(ex.bestE1RM.kg, 1) + " · " + ex.sessions + " sessions of history",
          receipt: p
        });
      });
    }

    var c = consistencyPayload(data, todayNum);
    if (c) {
      var done7 = c.days7.reduce(function (a, b) { return a + b; }, 0);
      out.push({
        id: "consistency", type: "consistency", label: "Consistency",
        sub: done7 + " of the last 7 days trained" + (c.streak > 1 ? " · " + c.streak + "-day streak" : ""),
        receipt: c
      });
    }

    var pg = progressPayload(data, todayNum);
    if (pg) {
      out.push({
        id: "progress", type: "progress", label: "Progress",
        sub: U.fmtWeightDelta(pg.end_value - pg.start_value) + " over " + pg.days + " days",
        receipt: pg
      });
    }

    var w = weeklyPayload(data, todayNum, st);
    if (w) {
      out.push({
        id: "weekly", type: "weekly", label: "This week",
        sub: w.workouts + " workout" + (w.workouts === 1 ? "" : "s") +
          (w.total_volume_kg ? " · " + (U.toDisplayWeight(w.total_volume_kg, 0) || 0).toLocaleString() +
            " " + U.weightUnit() + " lifted" : ""),
        receipt: w
      });
    }
    return out;
  }

  function byId(id) {
    var list = available();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /* ================= Receipts Day (in-app only) ================= */

  function localISO(d) {
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  /** ISO date of the most recent Sunday (local) = start of the drop week. */
  function weekStartISO() {
    var d = new Date();
    d.setDate(d.getDate() - d.getDay());
    return localISO(d);
  }

  /** Banner window: Sunday 00:00 local through end of Monday. */
  function isReceiptsWindow() {
    var day = new Date().getDay();
    return day === 0 || day === 1;
  }

  function socBlob() {
    try {
      var raw = localStorage.getItem(SOC_KEY);
      var o = raw ? JSON.parse(raw) : null;
      return (o && typeof o === "object") ? o : {};
    } catch (e) { return {}; }
  }
  function socPatch(patch) {
    try {
      var c = socBlob();
      Object.keys(patch).forEach(function (k) { c[k] = patch[k]; });
      localStorage.setItem(SOC_KEY, JSON.stringify(c));
    } catch (e) { /* private mode — banner just reappears */ }
  }

  function weeklyPostedThisWeek() {
    return socBlob().weeklyReceiptWeek === weekStartISO();
  }
  function markWeeklyPosted() {
    socPatch({ weeklyReceiptWeek: weekStartISO() });
  }

  /** Community-tab banner HTML ("" when not applicable). Caller must be
      the signed-in Community view (social.js checks that). */
  function bannerHtml() {
    if (!isReceiptsWindow() || weeklyPostedThisWeek()) return "";
    var w = byId("weekly");
    if (!w) return "";
    return '<div class="soc-receipts-banner" role="note">' +
      '<span class="soc-receipts-banner-ico">' + OF.icons.get("sparkles") + '</span>' +
      '<span class="soc-receipts-banner-txt"><strong>Receipts Day</strong> — your weekly receipt is ready. ' +
      U.esc(w.sub) + '.</span>' +
      '<button type="button" class="btn mini primary" data-act="compose-receipt" data-arg="weekly">Post it</button>' +
      '</div>';
  }

  /** Small Sunday nudge on the dashboard (only when signed in). */
  function dashNudge(el) {
    if (!el) return;
    el.innerHTML = "";
    if (new Date().getDay() !== 0 || weeklyPostedThisWeek()) return;
    var A = OF.socialApi;
    if (!A || !A.available()) return;
    A.init().then(function (user) {
      if (!user) return;
      if (new Date().getDay() !== 0 || weeklyPostedThisWeek()) return;
      var w = byId("weekly");
      if (!w) return;
      el.innerHTML = '<div class="card receipts-nudge">' +
        '<span class="receipts-nudge-txt">' + OF.icons.get("sparkles") +
        ' <strong>Receipts Day</strong> — your weekly receipt is ready to post.</span>' +
        '<a class="btn mini" href="#community">Open Community</a></div>';
    }).catch(function () { /* offline — no nudge */ });
  }

  /* ================= community benchmarks (the flywheel) =================
     In-memory, per-session cache. Never blocks rendering — callers get an
     async fill-in. Empty rows = cohort withheld below k=5 (honest gap). */

  var benchCache = {};   // "type|lift|age" -> { rows } (after resolve)
  var benchPending = {}; // same key -> Promise

  function benchKey(type, lift, age) {
    return type + "|" + String(lift || "").trim().toLowerCase() + "|" + (age || "unknown");
  }

  function getBenchmarksCached(type, lift, age) {
    var key = benchKey(type, lift, age);
    if (benchCache[key]) return Promise.resolve(benchCache[key].rows);
    if (benchPending[key]) return benchPending[key];
    var A = OF.socialApi;
    if (!A || !A.available()) return Promise.resolve(null);
    benchPending[key] = A.init().then(function (user) {
      // Signed out: DON'T memoize a null result — drop the pending entry so a
      // later signed-in call re-attempts (init() resolving null never hits the
      // .catch below, which would otherwise leave this key poisoned till reload).
      if (!user) { delete benchPending[key]; return null; }
      return A.getBenchmarks(type, lift, age).then(function (rows) {
        benchCache[key] = { rows: rows || [] };
        return benchCache[key].rows;
      });
    }).catch(function () {
      delete benchPending[key];
      return null;
    });
    return benchPending[key];
  }

  /**
   * Fill "[data-bench-lift]" placeholders inside rootEl with the honest
   * community one-liner. Async; never blocks insights rendering. Rows are
   * re-queried at resolve time (the container may have re-rendered).
   */
  function fillBenchmarkLines(rootEl) {
    if (!rootEl || !OF.socialApi || !OF.socialApi.available()) return;
    var els = rootEl.querySelectorAll("[data-bench-lift]");
    if (!els.length) return;
    var age = trainingAge();
    els.forEach(function (el) {
      var lift = el.getAttribute("data-bench-lift");
      var yours = num(el.getAttribute("data-bench-trend"));
      getBenchmarksCached("pr", lift, age).then(function (rows) {
        if (!rows || !rows.length) return; // signed out / offline / below k=5
        var row = rows[0];
        var p50 = num(row.p50);
        if (p50 == null) return;
        // element may have been re-rendered — find the live one
        var live = document.querySelectorAll('[data-bench-lift="' + (window.CSS && CSS.escape ? CSS.escape(lift) : lift) + '"]');
        live.forEach(function (n) {
          var yoursTxt = yours != null ? "your " + (yours > 0 ? "+" : "") + yours + "%/wk vs " : "";
          n.textContent = "Community: " + yoursTxt + "p50 " + (p50 > 0 ? "+" : "") + round1(p50) +
            "%/wk e1RM for " + bucketLabel(row.training_age_bucket) + " lifters (n=" + row.contributors + ")";
          n.hidden = false;
        });
      });
    });
  }

  /**
   * Compact, clearly-labeled block for the AI-coach context. SYNCHRONOUS —
   * reads only the warm cache (insights fills it after sign-in), so
   * buildContext never waits on the network. ≤600 bytes, top-2 lifts.
   */
  function coachBenchmarks() {
    var lifts = [];
    Object.keys(benchCache).forEach(function (key) {
      var parts = key.split("|");
      if (parts[0] !== "pr") return;
      var rows = benchCache[key].rows;
      if (!rows || !rows.length) return;
      var r = rows[0];
      lifts.push({
        lift: parts[1],
        p25: num(r.p25), p50: num(r.p50), p75: num(r.p75),
        n: num(r.contributors),
        bucket: r.training_age_bucket
      });
    });
    if (!lifts.length) return null;
    lifts.sort(function (a, b) { return (b.n || 0) - (a.n || 0); });
    var out = {
      note: "anonymized community aggregates (cohorts of 5+ users); percentiles are weekly e1RM progression %. The user's own on-device data stays the source of truth.",
      lifts: lifts.slice(0, 2)
    };
    while (JSON.stringify(out).length > 600 && out.lifts.length > 1) out.lifts.pop();
    if (JSON.stringify(out).length > 600) {
      out.note = "anonymized community aggregates (k>=5); weekly e1RM progression %";
    }
    return JSON.stringify(out).length <= 600 ? out : null;
  }

  /* ================= Insights → composer hand-off ================= */

  function startPrShare(lift) {
    var id = "pr:" + String(lift || "").trim().toLowerCase();
    if (location.hash !== "#community") location.hash = "community";
    setTimeout(function () {
      var A = OF.socialApi;
      if (A && A.uid() && OF.socialCompose) {
        OF.socialCompose.open({ kind: "receipt", receiptId: id });
      } else {
        U.toast("Sign in on the Community tab to share receipts.", "warn");
      }
    }, 80);
  }

  /* ================= PNG export (canvas) ================= */

  function fmtW(kg, dp) { return U.fmtWeight ? U.fmtWeight(kg, dp == null ? 1 : dp) : kg + " kg"; }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function cardLines(receipt) {
    // { title, metric, subs: [..], series?, days7? } — numbers only, pre-formatted
    var r = receipt || {};
    var out = { title: "Stat receipt", metric: "", subs: [] };
    if (r.type === "pr") {
      var series = Array.isArray(r.series) ? r.series.filter(function (p) { return p && num(p.e1rm) != null; }) : [];
      var best = 0;
      series.forEach(function (p) { if (p.e1rm > best) best = p.e1rm; });
      out.title = (typeof r.lift === "string" ? r.lift : "Lift") + " — new PR";
      out.metric = best ? fmtW(best) + " e1RM" : "";
      var spanD = series.length >= 2
        ? T().dayNum(series[series.length - 1].day) - T().dayNum(series[0].day) : 0;
      var nSess = num(r.sessions) != null ? r.sessions : series.length;
      out.subs.push(nSess + " sessions over " + Math.max(1, Math.round(spanD / 7)) + " weeks");
      if (series.length >= 2 && num(series[0].e1rm) != null) {
        out.subs.push(U.fmtWeightDelta(series[series.length - 1].e1rm - series[0].e1rm) + " across the series");
      }
      out.series = series.map(function (p) { return { x: T().dayNum(p.day), y: p.e1rm }; })
        .filter(function (p) { return p.x != null; });
    } else if (r.type === "consistency") {
      var weeks = Array.isArray(r.weeks) ? r.weeks : [];
      var planned = 0, done = 0;
      weeks.forEach(function (w) {
        if (w && num(w.planned) != null) planned += w.planned;
        if (w && num(w.done) != null) done += Math.min(w.done, w.planned || 7);
      });
      out.title = "Consistency";
      if (planned > 0) out.metric = Math.round(100 * done / planned) + "% of plan";
      out.subs.push(weeks.length + " weeks tracked");
      if (num(r.streak) != null && r.streak > 1) out.subs.push(r.streak + "-day streak");
      if (Array.isArray(r.days7)) out.days7 = r.days7.map(function (v) { return v ? 1 : 0; }).slice(0, 7);
    } else if (r.type === "progress") {
      out.title = "Progress — " + (r.metric === "weight" ? "body weight" : "progress");
      if (num(r.start_value) != null && num(r.end_value) != null) {
        out.metric = U.fmtWeightDelta(r.end_value - r.start_value);
        out.subs.push(fmtW(r.start_value) + " → " + fmtW(r.end_value) +
          (num(r.days) != null ? " in " + r.days + " days" : ""));
      }
      if (r.maintenance && num(r.maintenance.learned_kcal) != null) {
        out.subs.push("Learned maintenance ~" + Math.round(r.maintenance.learned_kcal) + " kcal" +
          (num(r.maintenance.formula_kcal) != null ? " (formula " + Math.round(r.maintenance.formula_kcal) + ")" : ""));
      }
    } else if (r.type === "weekly") {
      out.title = "This week";
      if (num(r.workouts) != null) out.metric = r.workouts + " workout" + (r.workouts === 1 ? "" : "s");
      if (num(r.total_volume_kg) != null) {
        out.subs.push((U.toDisplayWeight(r.total_volume_kg, 0) || 0).toLocaleString() + " " + U.weightUnit() + " total volume");
      }
      if (num(r.total_sets) != null) out.subs.push(r.total_sets + " sets");
      if (num(r.sleep_avg_h) != null) out.subs.push("sleep avg " + r.sleep_avg_h + "h");
      if (r.best_lift && typeof r.best_lift.name === "string" && num(r.best_lift.trend_pct_wk) != null) {
        out.subs.push(r.best_lift.name + " +" + r.best_lift.trend_pct_wk + "%/wk");
      }
    }
    return out;
  }

  function drawCard(canvas, receipt, verified) {
    var W = canvas.width, H = canvas.height;
    var ctx = canvas.getContext("2d");
    var L = cardLines(receipt);
    var G1 = "#8b5cf6", G2 = "#22d3ee";

    // backdrop
    ctx.fillStyle = "#0a0e17";
    ctx.fillRect(0, 0, W, H);
    var glow = ctx.createRadialGradient(W * 0.15, H * 0.1, 0, W * 0.15, H * 0.1, W * 0.9);
    glow.addColorStop(0, "rgba(139,92,246,0.28)");
    glow.addColorStop(1, "rgba(139,92,246,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    var glow2 = ctx.createRadialGradient(W * 0.9, H * 0.95, 0, W * 0.9, H * 0.95, W * 0.8);
    glow2.addColorStop(0, "rgba(34,211,238,0.22)");
    glow2.addColorStop(1, "rgba(34,211,238,0)");
    ctx.fillStyle = glow2;
    ctx.fillRect(0, 0, W, H);

    // card
    var cw = W - 160, chH = Math.min(H - 240, 880);
    var cx = 80, cy = (H - chH) / 2;
    var grad = ctx.createLinearGradient(cx, cy, cx + cw, cy + chH);
    grad.addColorStop(0, G1);
    grad.addColorStop(1, G2);
    roundRect(ctx, cx, cy, cw, chH, 44);
    ctx.fillStyle = "#11162a";
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = grad;
    ctx.stroke();

    var pad = 72, y = cy + pad + 20;
    var font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

    // badge
    ctx.textBaseline = "middle";
    if (verified) {
      ctx.fillStyle = G2;
      ctx.font = "800 34px " + font;
      ctx.fillText("✓ VERIFIED BY DATA", cx + pad, y);
    } else {
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.font = "800 34px " + font;
      ctx.fillText("RECEIPT", cx + pad, y);
    }
    y += 86;

    // title
    ctx.fillStyle = "rgba(255,255,255,0.82)";
    ctx.font = "700 52px " + font;
    ctx.fillText(String(L.title).slice(0, 30), cx + pad, y);
    y += 110;

    // metric (gradient)
    if (L.metric) {
      var mg = ctx.createLinearGradient(cx + pad, y, cx + cw - pad, y);
      mg.addColorStop(0, G1);
      mg.addColorStop(1, G2);
      ctx.fillStyle = mg;
      ctx.font = "800 96px " + font;
      ctx.fillText(String(L.metric).slice(0, 20), cx + pad, y);
      y += 120;
    }

    // sparkline
    if (L.series && L.series.length >= 2) {
      var sx = cx + pad, sw = cw - pad * 2, sy = y, sh = 180;
      var xs = L.series.map(function (p) { return p.x; });
      var ys = L.series.map(function (p) { return p.y; });
      var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
      var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
      if (x1 === x0) x1 = x0 + 1;
      if (y1 === y0) { y1 += 1; y0 -= 1; }
      ctx.beginPath();
      L.series.forEach(function (p, i) {
        var px = sx + (p.x - x0) / (x1 - x0) * sw;
        var py = sy + (1 - (p.y - y0) / (y1 - y0)) * sh;
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      });
      ctx.strokeStyle = grad;
      ctx.lineWidth = 7;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.stroke();
      L.series.forEach(function (p) {
        var px = sx + (p.x - x0) / (x1 - x0) * sw;
        var py = sy + (1 - (p.y - y0) / (y1 - y0)) * sh;
        ctx.beginPath();
        ctx.arc(px, py, 8, 0, Math.PI * 2);
        ctx.fillStyle = G2;
        ctx.fill();
      });
      y += sh + 70;
    }

    // 7-day grid
    if (L.days7) {
      var cell = 70, gap = 18, gx = cx + pad;
      L.days7.forEach(function (on, i) {
        roundRect(ctx, gx + i * (cell + gap), y, cell, cell, 16);
        if (on) { ctx.fillStyle = grad; ctx.fill(); }
        else {
          ctx.fillStyle = "rgba(255,255,255,0.08)";
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = "rgba(255,255,255,0.18)";
          ctx.stroke();
        }
      });
      y += cell + 64;
    }

    // sub lines
    ctx.fillStyle = "rgba(255,255,255,0.62)";
    ctx.font = "500 40px " + font;
    (L.subs || []).slice(0, 4).forEach(function (s) {
      ctx.fillText(String(s).slice(0, 44), cx + pad, y);
      y += 58;
    });

    // footer
    ctx.font = "700 36px " + font;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText("OptimalFit", cx + pad, cy + chH - pad);
    ctx.font = "500 30px " + font;
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    var dateTxt = U.fmtDate(U.todayISO());
    ctx.fillText(dateTxt, cx + cw - pad - ctx.measureText(dateTxt).width, cy + chH - pad);

    // watermark ONLY when actually verified — never fake the badge
    if (verified) {
      ctx.font = "600 30px " + font;
      ctx.fillStyle = "rgba(34,211,238,0.55)";
      var wm = "✓ Verified by OptimalFit data";
      ctx.fillText(wm, (W - ctx.measureText(wm).width) / 2, cy + chH + 60 > H - 40 ? H - 40 : cy + chH + 60);
    }
  }

  /** Render the receipt card to an offscreen canvas (story 1080×1920 or
      square 1080×1080). Exported so tests can verify pixels without
      triggering a download/share. Throws on unrenderable payloads. */
  function renderToCanvas(receipt, verified, format) {
    var canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = format !== "square" ? 1920 : 1080;
    drawCard(canvas, receipt, !!verified);
    return canvas;
  }

  /** Decode a "data:image/png;base64,…" URL into a Blob synchronously.
      Kept sync (no toBlob/await) so navigator.share below runs inside the
      tap's transient activation — iOS/WKWebView drops activation across the
      async toBlob callback, which makes share() throw NotAllowedError. */
  function dataUrlToBlob(dataUrl) {
    var comma = dataUrl.indexOf(",");
    var meta = dataUrl.slice(5, comma);            // e.g. "image/png;base64"
    var isB64 = /;base64/i.test(meta);
    var mime = meta.split(";")[0] || "image/png";
    var body = dataUrl.slice(comma + 1);
    var bytes;
    if (isB64) {
      var bin = atob(body);
      bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else {
      bytes = new TextEncoder().encode(decodeURIComponent(body));
    }
    return new Blob([bytes], { type: mime });
  }

  /** Render to PNG and share (Web Share API w/ files) or download. Everything
      up to the share() call is synchronous so it stays inside the user
      gesture (required by iOS/WKWebView). */
  function exportImage(receipt, verified, format) {
    var canvas, blob;
    try {
      canvas = renderToCanvas(receipt, verified, format);
      blob = dataUrlToBlob(canvas.toDataURL("image/png"));
    } catch (e) {
      U.toast("Couldn't render the image.", "error");
      return;
    }
    if (!blob || !blob.size) { U.toast("Couldn't create the image.", "error"); return; }
    var name = "optimalfit-receipt-" + (receipt && receipt.type || "stat") + "-" + U.todayISO() + ".png";
    var file = null;
    try { file = new File([blob], name, { type: "image/png" }); } catch (e) { /* older browsers */ }
    if (file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: "OptimalFit receipt" }).catch(function (err) {
        // AbortError = user dismissed the sheet; anything else = fall back to a save.
        if (err && (err.name === "AbortError" || /abort|cancel/i.test(String(err.message || "")))) return;
        downloadBlob(blob, name);
      });
      return;
    }
    downloadBlob(blob, name);
  }

  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    a.target = "_blank";        // desktop honors download; a WKWebView that
    document.body.appendChild(a); // ignores it opens the image so it can be saved
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    // Honest wording: a WKWebView that ignores the download attribute just opens
    // the image (see above), so don't claim it was "saved" — prompt the save.
    U.toast("Receipt image ready — long-press or right-click to save it.", "warn");
  }

  /** Small chooser sheet (story / square) on the shared social sheets. */
  function openShareSheet(receipt, verified, level) {
    if (!OF.social) { exportImage(receipt, verified, "square"); return; }
    var html = '<h2>Share as image</h2>' +
      '<p class="muted small">' + (verified
        ? 'The image carries the “Verified by OptimalFit data” watermark.'
        : 'This receipt was not verified, so the image has no verification watermark.') + '</p>' +
      '<div class="form-actions">' +
      '<button type="button" class="btn primary" data-receipt-export="story">Story (1080×1920)</button>' +
      '<button type="button" class="btn" data-receipt-export="square">Square (1080×1080)</button>' +
      '<button type="button" class="btn ghost" data-close-social="' + (level || 2) + '">Close</button></div>';
    var panel = OF.social.sheetOpen(level || 2, html);
    if (!panel) return;
    panel.querySelectorAll("[data-receipt-export]").forEach(function (b) {
      b.addEventListener("click", function () {
        exportImage(receipt, verified, b.getAttribute("data-receipt-export"));
      });
    });
  }

  return {
    available: available,
    byId: byId,
    validate: validate,
    trainingAge: trainingAge,
    bucketLabel: bucketLabel,

    isReceiptsWindow: isReceiptsWindow,
    weekStartISO: weekStartISO,
    weeklyPostedThisWeek: weeklyPostedThisWeek,
    markWeeklyPosted: markWeeklyPosted,
    bannerHtml: bannerHtml,
    dashNudge: dashNudge,

    getBenchmarksCached: getBenchmarksCached,
    fillBenchmarkLines: fillBenchmarkLines,
    coachBenchmarks: coachBenchmarks,

    startPrShare: startPrShare,
    exportImage: exportImage,
    renderToCanvas: renderToCanvas,
    openShareSheet: openShareSheet,
    cardLines: cardLines
  };
})();

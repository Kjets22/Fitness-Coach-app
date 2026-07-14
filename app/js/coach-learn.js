/* ============================================================
   coach-learn.js — the learning loop (Coach 2.0).

   Learns how THIS user responds and feeds it back into programming.
   Approach chosen by offline research (docs/COACH2-ARCHITECTURE.md):

   (a) Volume→progress response per muscle group: Bayesian ridge
       regression (normal-normal conjugate) on weekly rows
       y = e1RM %/wk, x = [1, ramp(sets), readiness], anchored to
       evidence-based priors. We claim a personal sweet spot ONLY when
       the credible intervals actually separate from the default —
       otherwise we honestly report the evidence-based default.
   (b) Exercise dislikes: Beta-Bernoulli per exercise over
       offered→completed/skipped/swapped events (swap = 1.5 skips),
       skips counted only on decent-recovery days, 8-week half-life.
   (c) Weekly decision: Thompson sampling over weekly-set levels
       (current ±1 step, inside the evidence band), with a rule-based
       deload gate that overrides everything when fatigue signs align.

   Cold start everywhere = the evidence-based defaults from
   OF.evidence; the model only moves away as data accrues. All math is
   closed-form, dependency-free, and exported under `math` for tests.

   Storage: optimalfit.learnState =
     { prefs:   { nameLower: { offers, skips, last } },   // decayed counts
       levels:  { group: setsPerWeek },                   // current volume target
       reviews: [ {at, decisions, deload} ],              // capped log
       feedback:[ {at, kind, value, note} ] }             // capped log
   ============================================================ */

window.OF = window.OF || {};

OF.learn = (function () {
  "use strict";

  var U = OF.util, S = OF.storage;
  var KEY = "optimalfit.learnState";
  var HALF_LIFE_DAYS = 56;              // 8-week preference decay
  var SWAP_WEIGHT = 1.5;                // a swap is a stronger dislike signal
  var BASE_SKIP_RATE = 0.15, KAPPA0 = 4, DISLIKE_MARGIN = 0.10, MIN_OFFERS = 3;
  var LEVEL_STEP = 2;                   // volume moves in 2-set steps
  var SIGMA_NOISE = 0.5;                // weekly e1RM %/wk measurement noise
  // features: [1, ramp(v)=min(v,12)/12, over(v)=max(0,v-12)/12, readiness]
  // over() lets the model learn PERSONAL negative returns above ~12 sets;
  // its prior is mildly negative per the diminishing-returns evidence.
  var PRIOR_MU = [0.15, 0.45, -0.10, 0.10];
  var PRIOR_VAR = [0.01, 0.09, 0.09, 0.0225];
  var MAJOR_GROUPS = ["Chest", "Back", "Legs", "Shoulders", "Biceps", "Triceps"];

  /* ================= pure math (exported for tests) ================= */

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(rng) {
    var u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function ramp(sets) { return Math.min(Number(sets) || 0, 12) / 12; }
  function over(sets) { return Math.max(0, (Number(sets) || 0) - 12) / 12; }
  function features(sets, readiness) {
    return [1, ramp(sets), over(sets), isFinite(readiness) ? readiness : 0.5];
  }

  /** Invert a small symmetric positive-definite matrix (Gauss-Jordan). */
  function matInv(m) {
    var n = m.length, i, j, k;
    var a = m.map(function (row, ri) {
      return row.concat(row.map(function (_, ci) { return ri === ci ? 1 : 0; }));
    });
    for (i = 0; i < n; i++) {
      var piv = i;
      for (k = i + 1; k < n; k++) if (Math.abs(a[k][i]) > Math.abs(a[piv][i])) piv = k;
      if (Math.abs(a[piv][i]) < 1e-12) return null;
      if (piv !== i) { var tmp = a[i]; a[i] = a[piv]; a[piv] = tmp; }
      var d = a[i][i];
      for (j = 0; j < 2 * n; j++) a[i][j] /= d;
      for (k = 0; k < n; k++) {
        if (k === i) continue;
        var f = a[k][i];
        if (!f) continue;
        for (j = 0; j < 2 * n; j++) a[k][j] -= f * a[i][j];
      }
    }
    return a.map(function (row) { return row.slice(n); });
  }

  /**
   * Conjugate Bayesian ridge. rows = [{x: features(...), y}].
   * With no rows, posterior = prior.
   */
  function bayesRidge(rows) {
    var K = PRIOR_MU.length;
    var s2 = SIGMA_NOISE * SIGMA_NOISE;
    var P = [], b = [], i, j;
    for (i = 0; i < K; i++) {
      P.push([]);
      for (j = 0; j < K; j++) P[i].push(i === j ? 1 / PRIOR_VAR[i] : 0);
      b.push(PRIOR_MU[i] / PRIOR_VAR[i]);
    }
    (rows || []).forEach(function (r) {
      if (!r || !Array.isArray(r.x) || r.x.length !== K || !isFinite(r.y)) return;
      for (var i2 = 0; i2 < K; i2++) {
        for (var j2 = 0; j2 < K; j2++) P[i2][j2] += r.x[i2] * r.x[j2] / s2;
        b[i2] += r.x[i2] * r.y / s2;
      }
    });
    var Sigma = matInv(P);
    if (!Sigma) return { mu: PRIOR_MU.slice(), Sigma: null, n: 0 };
    var mu = [];
    for (i = 0; i < K; i++) {
      mu.push(0);
      for (j = 0; j < K; j++) mu[i] += Sigma[i][j] * b[j];
    }
    return { mu: mu, Sigma: Sigma, n: (rows || []).length };
  }

  /** Expected gain (%/wk) at a weekly-set level.
      sdMean = uncertainty of the EXPECTED gain (parameter-only — shrinks as
      data accrues; use for decisions/Thompson). sd = full posterior
      predictive (includes week-to-week noise; use for honesty about what a
      single week can show). Sampling decisions with the predictive sd would
      drown real arm differences in irreducible noise and wander forever. */
  function predictGain(post, sets, readiness) {
    var x = features(sets, readiness);
    var K = x.length, mean = 0, i, j;
    for (i = 0; i < K; i++) mean += post.mu[i] * x[i];
    var varMean = 0;
    if (post.Sigma) {
      for (i = 0; i < K; i++) for (j = 0; j < K; j++) varMean += x[i] * post.Sigma[i][j] * x[j];
    }
    varMean = Math.max(varMean, 1e-9);
    return { mean: mean, sdMean: Math.sqrt(varMean),
      sd: Math.sqrt(varMean + SIGMA_NOISE * SIGMA_NOISE) };
  }

  /** Beta(α,β) posterior for one exercise's skip rate + 10th percentile. */
  function betaPosterior(skips, offers) {
    var a = KAPPA0 * BASE_SKIP_RATE + skips;
    var b = KAPPA0 * (1 - BASE_SKIP_RATE) + Math.max(0, offers - skips);
    var mean = a / (a + b);
    var sd = Math.sqrt((a * b) / ((a + b) * (a + b) * (a + b + 1)));
    return { mean: mean, q10: Math.max(0, mean - 1.2816 * sd), a: a, b: b };
  }

  /** Thompson pick over arms [{level, mean, sd}] with a seeded rng. */
  function thompsonPick(arms, rng) {
    var best = null, bestS = -Infinity;
    arms.forEach(function (arm) {
      var s = arm.mean + arm.sd * gauss(rng);
      if (s > bestS) { bestS = s; best = arm; }
    });
    return best;
  }

  /* ================= state ================= */

  function state() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY) || "{}") || {};
      if (!s.prefs) s.prefs = {};
      if (!s.levels) s.levels = {};
      if (!Array.isArray(s.reviews)) s.reviews = [];
      if (!Array.isArray(s.feedback)) s.feedback = [];
      return s;
    } catch (e) { return { prefs: {}, levels: {}, reviews: [], feedback: [] }; }
  }
  function saveState(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch (e) { return false; }
  }

  function decayFactor(days) { return Math.pow(0.5, Math.max(0, days) / HALF_LIFE_DAYS); }

  /* ================= (b) preference learning ================= */

  /** Was recovery decent today? Skips on wrecked days aren't dislikes.
      Proxy: last night's sleep within 1h of the user's 28-day median
      (or unknown → count it; missing data must not block learning). */
  function recoveryOkToday() {
    try {
      var today = U.todayISO();
      var sleeps = S.getAll("sleep").filter(function (r) { return r.durationMin != null; });
      var last = sleeps.filter(function (r) { return r.date === today; })[0];
      if (!last) return true;
      var recent = sleeps.filter(function (r) { return r.date >= U.todayISO(-27); })
        .map(function (r) { return r.durationMin; }).sort(function (a, b) { return a - b; });
      if (recent.length < 5) return true;
      var median = recent[Math.floor(recent.length / 2)];
      return last.durationMin >= median - 60;
    } catch (e) { return true; }
  }

  /**
   * Called after a prescribed program session is completed.
   * prescribed = the day's slot list (names); logged = builder exercises.
   */
  function recordSessionOutcome(prescribed, logged) {
    try {
      var s = state();
      var now = Date.now();
      var okDay = recoveryOkToday();
      var loggedByName = {}, loggedGroups = {};
      var lib = OF.exerciseLibrary;
      (logged || []).forEach(function (ex) {
        if (!ex || !ex.name) return;
        var hasSets = Array.isArray(ex.sets) && ex.sets.some(function (st) { return Number(st.reps) >= 1; });
        if (!hasSets) return;
        loggedByName[String(ex.name).toLowerCase()] = true;
        if (lib) loggedGroups[lib.muscleGroupFor(ex.name)] = true;
      });
      (prescribed || []).forEach(function (slot) {
        if (!slot || !slot.name) return;
        var k = slot.name.toLowerCase();
        var rec = s.prefs[k] || { offers: 0, skips: 0, last: now };
        // decay old counts to "forget" stale preferences
        var f = decayFactor((now - (rec.last || now)) / 86400000);
        rec.offers *= f; rec.skips *= f; rec.last = now;
        rec.offers += 1;
        if (!loggedByName[k]) {
          var group = lib ? lib.muscleGroupFor(slot.name) : null;
          var swapped = group && loggedGroups[group];   // trained the muscle, avoided THIS lift
          if (swapped) rec.skips += SWAP_WEIGHT;
          else if (okDay) rec.skips += 1;               // plain skip only counts on decent days
        }
        s.prefs[k] = rec;
      });
      saveState(s);
    } catch (e) { /* learning must never break logging */ }
  }

  /** Exercises the model is confident the user avoids. */
  function dislikeSuggestions() {
    var s = state();
    var out = [];
    Object.keys(s.prefs).forEach(function (k) {
      var r = s.prefs[k];
      if (r.offers < MIN_OFFERS) return;
      var post = betaPosterior(r.skips, r.offers);
      if (post.q10 > BASE_SKIP_RATE + DISLIKE_MARGIN) {
        out.push({
          nameLower: k,
          offers: Math.round(r.offers * 10) / 10,
          skips: Math.round(r.skips * 10) / 10,
          score: Math.round(post.mean * 100) / 100,
          message: "I've noticed you skip or swap " + k + " nearly every time it comes up (" +
            Math.round(r.skips) + " of " + Math.round(r.offers) + "). Want me to replace it permanently?"
        });
      }
    });
    out.sort(function (a, b) { return b.score - a.score; });
    return out.slice(0, 3);
  }

  /** User confirmed: never prescribe this again. */
  function confirmDislike(nameLower) {
    try {
      if (OF.trainer && OF.trainer.addAvoid) OF.trainer.addAvoid(nameLower);
      if (OF.profile) {
        var d = OF.profile.get();
        var list = (d.prefs.dislikes || []).slice();
        if (list.map(function (x) { return x.toLowerCase(); }).indexOf(nameLower) === -1) {
          list.push(nameLower);
          OF.profile.update({ prefs: { dislikes: list } }, "learned");
        }
      }
      var s = state();
      delete s.prefs[nameLower];
      saveState(s);
    } catch (e) { /* best-effort */ }
  }

  /* ================= (a) response modeling data assembly ================= */

  /** ISO week key (Mon-based) for a date string. */
  function weekKey(dateStr) {
    var d = new Date(dateStr + "T12:00:00Z");
    var day = (d.getUTCDay() + 6) % 7;             // Mon=0
    d.setUTCDate(d.getUTCDate() - day);
    return d.toISOString().slice(0, 10);
  }

  /**
   * Weekly observation rows per muscle group from the logs:
   *   { week, sets, e1rmPctWk, readiness } — e1RM change measured on the
   * group's most-trained lift that week vs the previous observation.
   */
  function weeklyRows() {
    var lib = OF.exerciseLibrary;
    if (!lib) return {};
    var byGroupWeek = {};   // group → week → {sets, bestByLift:{name:e1rm}}
    S.getAll("exercise").forEach(function (r) {
      if (!Array.isArray(r.exercises) || !r.date) return;
      var wk = weekKey(r.date);
      r.exercises.forEach(function (ex) {
        if (!ex || !ex.name || !Array.isArray(ex.sets)) return;
        var g = lib.muscleGroupFor(ex.name);
        if (MAJOR_GROUPS.indexOf(g) === -1) return;
        var gw = byGroupWeek[g] || (byGroupWeek[g] = {});
        var cell = gw[wk] || (gw[wk] = { sets: 0, best: {} });
        ex.sets.forEach(function (st) {
          var w = Number(st.weightKg), reps = Number(st.reps);
          if (!(reps >= 1)) return;
          cell.sets += 1;
          if (isFinite(w) && w > 0 && reps <= 12) {
            var e1 = w * (1 + Math.min(reps, 12) / 30);
            var k = ex.name.toLowerCase();
            if (!cell.best[k] || e1 > cell.best[k]) cell.best[k] = e1;
          }
        });
      });
    });
    // weekly sleep as the readiness proxy (normalized: 8h → 1.0)
    var sleepByWeek = {};
    S.getAll("sleep").forEach(function (r) {
      if (r.durationMin == null || !r.date) return;
      var wk = weekKey(r.date);
      (sleepByWeek[wk] = sleepByWeek[wk] || []).push(r.durationMin / 60);
    });
    function weekReadiness(wk) {
      var a = sleepByWeek[wk];
      if (!a || !a.length) return 0.5;
      var avg = a.reduce(function (x, y) { return x + y; }, 0) / a.length;
      return Math.max(0, Math.min(1.2, avg / 8));
    }

    var rows = {};
    Object.keys(byGroupWeek).forEach(function (g) {
      var weeks = Object.keys(byGroupWeek[g]).sort();
      var list = [];
      var prevBest = null;
      weeks.forEach(function (wk) {
        var cell = byGroupWeek[g][wk];
        // group e1RM benchmark = the single best lift e1RM this week
        var names = Object.keys(cell.best);
        var top = null;
        names.forEach(function (n) { if (top == null || cell.best[n] > top) top = cell.best[n]; });
        var pct = null;
        if (top != null && prevBest != null && prevBest > 0) pct = ((top - prevBest) / prevBest) * 100;
        if (top != null) prevBest = top;
        if (pct != null && cell.sets > 0 && Math.abs(pct) <= 10) {   // drop absurd jumps (data glitches)
          list.push({ week: wk, sets: cell.sets, y: pct, x: features(cell.sets, weekReadiness(wk)) });
        }
      });
      if (list.length) rows[g] = list;
    });
    return rows;
  }

  /**
   * Per-group personalization read. Returns
   * { group, n, bestLevel, defaultLevel, personalized, note } for groups
   * with any data. personalized=true ONLY when credible intervals separate.
   */
  function responseModel() {
    var level = (OF.profile && OF.profile.level()) || "intermediate";
    var band = OF.evidence.volumeBand(level);
    var defaultSets = OF.evidence.volumeStart(level);
    var rowsByGroup = weeklyRows();
    var out = [];
    Object.keys(rowsByGroup).forEach(function (g) {
      var rows = rowsByGroup[g];
      var post = bayesRidge(rows);
      var levels = [];
      for (var v = band[0]; v <= band[1]; v += LEVEL_STEP) levels.push(v);
      var best = null, dflt = null;
      levels.forEach(function (v) {
        var p = predictGain(post, v, 0.9);
        var o = { level: v, mean: p.mean, sd: p.sdMean };
        if (best == null || p.mean > best.mean) best = o;
        if (v === defaultSets || (dflt == null && Math.abs(v - defaultSets) <= 1)) dflt = o;
      });
      if (!dflt) dflt = best;
      // claim personalization only when 80% CIs separate (z≈1.28)
      var separated = best.level !== dflt.level &&
        (best.mean - 1.28 * best.sd) > (dflt.mean + 1.28 * dflt.sd);
      out.push({
        group: g, n: post.n,
        bestLevel: best.level, defaultLevel: defaultSets,
        personalized: !!separated,
        note: separated
          ? "Your " + g.toLowerCase() + " progressed fastest around " + best.level + " sets/week in your own logs."
          : "Not enough signal yet to beat the evidence-based default (" + defaultSets + " sets/week) — using it."
      });
    });
    return out;
  }

  /* ================= (c) weekly review + deload gate ================= */

  /** Fatigue gate: ≥2 stalling lifts AND depressed recent sleep. */
  function deloadGate() {
    try {
      var ex = S.getAll("exercise");
      var a = OF.strength ? OF.strength.analyze({
        exercise: ex, sleep: S.getAll("sleep"), food: S.getAll("food"),
        body: S.getAll("body"), goalType: null, proteinTargetG: null
      }) : null;
      var stalls = (a && a.status === "ok") ? a.exercises.filter(function (e) { return e.verdict === "stalling"; }).length : 0;
      if (stalls < 2) return { deload: false };
      var sleeps = S.getAll("sleep").filter(function (r) { return r.durationMin != null; });
      var last7 = sleeps.filter(function (r) { return r.date >= U.todayISO(-6); });
      var prev21 = sleeps.filter(function (r) { return r.date < U.todayISO(-6) && r.date >= U.todayISO(-27); });
      function avg(list) {
        if (!list.length) return null;
        return list.reduce(function (x, r) { return x + r.durationMin; }, 0) / list.length;
      }
      var a7 = avg(last7), a21 = avg(prev21);
      var sleepDepressed = a7 != null && a21 != null && a7 < a21 - 20;   // ≥20 min/night down
      if (sleepDepressed || stalls >= 3) {
        return { deload: true, stalls: stalls,
          why: stalls + " lifts have stalled" + (sleepDepressed ? " and your sleep is down vs your own baseline" : "") +
            " — a lighter week now protects the next block. " + OF.evidence.why("progression-deload"),
          evidenceIds: ["progression-deload", "recovery-overreaching-signs"] };
      }
      return { deload: false };
    } catch (e) { return { deload: false }; }
  }

  /**
   * The weekly programming review. Pure computation — nothing applied
   * until applyReview(). At most one level move per group per 14 days.
   */
  function weeklyReview(seed) {
    var s = state();
    var level = (OF.profile && OF.profile.level()) || "intermediate";
    var band = OF.evidence.volumeBand(level);
    var gate = deloadGate();
    var rng = mulberry32(isFinite(seed) ? seed : (Date.parse(U.todayISO()) / 86400000) | 0);
    var rowsByGroup = weeklyRows();
    var lastMove = {};
    s.reviews.slice(-4).forEach(function (r) {
      (r.decisions || []).forEach(function (d) {
        if (d.move !== 0) lastMove[d.group] = r.at;
      });
    });
    var decisions = [];
    MAJOR_GROUPS.forEach(function (g) {
      var rows = rowsByGroup[g];
      if (!rows || !rows.length) return;
      var current = s.levels[g] || OF.evidence.volumeStart(level);
      current = Math.max(band[0], Math.min(band[1], current));
      if (gate.deload) {
        decisions.push({ group: g, current: current, move: 0, deload: true });
        return;
      }
      // dwell: no move within 14 days of the last one for this group
      var moved = lastMove[g] && (Date.parse(U.todayISO()) - Date.parse(lastMove[g])) < 14 * 86400000;
      var post = bayesRidge(rows);
      var arms = [];
      [current - LEVEL_STEP, current, current + LEVEL_STEP].forEach(function (v) {
        if (v < band[0] || v > band[1]) return;
        var p = predictGain(post, v, 0.9);
        arms.push({ level: v, mean: p.mean, sd: p.sdMean });
      });
      var pick = moved ? null : thompsonPick(arms, rng);
      var target = pick ? pick.level : current;
      decisions.push({
        group: g, current: current, target: target, move: target - current,
        n: post.n,
        why: target > current
          ? "Recovery and progress support nudging " + g.toLowerCase() + " up to " + target + " sets/week. " + OF.evidence.why("volume-hypertrophy-range")
          : target < current
            ? g + " responded better with a bit less — dropping to " + target + " sets/week and watching your numbers. " + OF.evidence.why("individual-response-variability")
            : "Holding " + g.toLowerCase() + " at " + current + " sets/week — the signal doesn't justify a change yet.",
        evidenceIds: target !== current ? ["volume-hypertrophy-range", "individual-response-variability"] : []
      });
    });
    return { at: U.todayISO(), deload: gate.deload, deloadWhy: gate.why || null, decisions: decisions, band: band };
  }

  /** Persist the review + update level targets (trainer reads levels). */
  function applyReview(review) {
    if (!review) return false;
    var s = state();
    (review.decisions || []).forEach(function (d) {
      if (d.target != null) s.levels[d.group] = d.target;
    });
    s.reviews.push({ at: review.at, deload: review.deload, decisions: review.decisions });
    if (s.reviews.length > 26) s.reviews = s.reviews.slice(-26);
    return saveState(s);
  }

  function volumeTarget(group) {
    var s = state();
    return s.levels[group] || null;
  }

  /* ================= (d) feedback capture ================= */

  function feedback(kind, value, note) {
    var s = state();
    s.feedback.push({ at: U.todayISO(), kind: String(kind).slice(0, 20), value: value, note: note ? String(note).slice(0, 140) : undefined });
    if (s.feedback.length > 100) s.feedback = s.feedback.slice(-100);
    saveState(s);
  }

  /* ================= compact block for the LLM ================= */

  function coachContext() {
    try {
      var s = state();
      var model = responseModel();
      var lastReview = s.reviews.length ? s.reviews[s.reviews.length - 1] : null;
      var thumbs = s.feedback.filter(function (f) { return f.kind === "thumbs"; }).slice(-10);
      var up = thumbs.filter(function (f) { return f.value > 0; }).length;
      var ctx = {
        personalization: model.filter(function (m) { return m.n >= 3; }).map(function (m) {
          return { group: m.group, weeks: m.n, status: m.personalized ? ("personal sweet spot ~" + m.bestLevel + " sets/wk") : "on evidence default" };
        }),
        dislikeSuggestions: dislikeSuggestions().map(function (d) { return d.nameLower; }),
        lastReview: lastReview ? { at: lastReview.at, deload: lastReview.deload,
          moves: (lastReview.decisions || []).filter(function (d) { return d.move; }).map(function (d) {
            return d.group + " " + d.current + "→" + d.target;
          }) } : null,
        recentThumbs: thumbs.length ? (up + " up / " + (thumbs.length - up) + " down of last " + thumbs.length) : null
      };
      if (!ctx.personalization.length) delete ctx.personalization;
      if (!ctx.dislikeSuggestions.length) delete ctx.dislikeSuggestions;
      if (!ctx.lastReview) delete ctx.lastReview;
      if (!ctx.recentThumbs) delete ctx.recentThumbs;
      return Object.keys(ctx).length ? ctx : null;
    } catch (e) { return null; }
  }

  return {
    math: { mulberry32: mulberry32, gauss: gauss, ramp: ramp, over: over, features: features, matInv: matInv,
            bayesRidge: bayesRidge, predictGain: predictGain,
            betaPosterior: betaPosterior, thompsonPick: thompsonPick },
    recordSessionOutcome: recordSessionOutcome,
    dislikeSuggestions: dislikeSuggestions,
    confirmDislike: confirmDislike,
    weeklyRows: weeklyRows,
    responseModel: responseModel,
    weeklyReview: weeklyReview,
    applyReview: applyReview,
    volumeTarget: volumeTarget,
    feedback: feedback,
    coachContext: coachContext
  };
})();

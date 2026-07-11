/* ============================================================
   coach.js — AI Coach tab. Talks to the local serve.py bridge
   (POST /api/coach), which runs the user's Claude Code
   subscription headlessly. The rest of the app works from
   file:// with no server; ONLY this tab degrades gracefully.

   States on tab entry (GET /api/health):
     - fetch fails       -> "start the server" card
     - ok, claude:false  -> "install/sign in to Claude Code" card
     - ok, claude:true   -> chat UI
   All rendered text goes through U.esc(). Chat history lives
   in memory only (last ~20 messages).
   ============================================================ */

window.OF = window.OF || {};

OF.coach = (function () {
  "use strict";

  var U = OF.util, S = OF.storage;
  var els = {};
  var messages = [];        // {role: "user"|"coach"|"error", text}
  var MAX_MSGS = 20;
  var busy = false;
  var health = null;        // null | "no-server" | "no-claude" | "need-key" | "ok"
  var pairError = "";       // shown on the pairing card after a rejected code
  var REQUEST_TIMEOUT_MS = 130000; // server kills the CLI at 120s

  /* Phone-mode pairing: when serve.py runs with --phone, LAN clients must
     send the 6-digit code (printed in the server window) as X-OF-Key.
     Stored once in localStorage; localhost never needs it (the server
     exempts 127.0.0.1 clients, so health reports keyOk:true there). */
  var PAIR_KEY_STORE = "optimalfit.pairKey";

  function pairKey() {
    try { return localStorage.getItem(PAIR_KEY_STORE) || ""; } catch (e) { return ""; }
  }
  function setPairKey(v) {
    try {
      if (v) localStorage.setItem(PAIR_KEY_STORE, v);
      else localStorage.removeItem(PAIR_KEY_STORE);
    } catch (e) { /* private mode: the user just re-enters the code */ }
  }
  function apiHeaders(extra) {
    var h = extra || {};
    // remote coach server: the baked access key wins; else the LAN pairing key
    var k = (OF.coachApi && OF.coachApi.key()) || pairKey();
    if (k) h["X-OF-Key"] = k;
    return h;
  }
  function apiUrl(path) {
    return OF.coachApi ? OF.coachApi.url(path) : path;
  }

  /* Suggestion chips — trainer-flavoured, and program-aware when a plan exists. */
  function chips() {
    var hasPlan = false;
    try { hasPlan = !!(OF.trainer && OF.trainer.hasProgram && OF.trainer.hasProgram()); } catch (e) {}
    if (hasPlan) {
      return [
        "Walk me through today's session",
        "Make today's workout harder",
        "I'm sore — adjust today's plan",
        "What should I eat before today's session?"
      ];
    }
    return [
      "Build me a training plan for my goal",
      "What should I eat before tomorrow's session?",
      "Why is my readiness low today?"
    ];
  }

  /* ---------------- context builder ----------------
     Compact (~2-4 KB) summary: the computed insights from
     OF.engine.analyzeAll() + last-14-day raw aggregates.
     Never the full record history. */

  function round1(x) { return Math.round(x * 10) / 10; }

  function avg(arr, pick) {
    var sum = 0, n = 0;
    arr.forEach(function (r) {
      var v = pick(r);
      if (typeof v === "number" && isFinite(v)) { sum += v; n++; }
    });
    return n ? round1(sum / n) : null;
  }

  function summarizeInsights(r) {
    var s = {};
    s.weeklyPlan = r.plan.status === "ok"
      ? r.plan.text + " (confidence: " + r.plan.confidence + ")"
      : "insufficient data: " + r.plan.message;

    if (r.readiness.status === "ok") {
      s.readinessToday = r.readiness.verdict + " — score " + r.readiness.score +
        "/100. Factors: " + (r.readiness.factors || []).map(function (f) {
          return (f.good === true ? "+" : f.good === false ? "-" : "·") + " " + f.text;
        }).join("; ");
    } else s.readinessToday = "insufficient data: " + r.readiness.message;

    if (r.timeOfDay.status === "ok") {
      s.bestGymTime = r.timeOfDay.best.label + " (" + r.timeOfDay.best.range +
        "h), avg performance " + r.timeOfDay.best.avgPerf + "/5" +
        (r.timeOfDay.adjustedForSleep ? " (ranking sleep-adjusted)" : "") +
        " (confidence: " + r.timeOfDay.confidence + ")";
    } else s.bestGymTime = "insufficient data: " + r.timeOfDay.message;

    if (r.weekdays.status === "ok") {
      s.bestTrainingDays = r.weekdays.top.map(function (d) { return d.name; }).join(", ") +
        " (top day avg " + r.weekdays.top[0].avgPerf + "/5, confidence: " +
        r.weekdays.confidence + ")";
    } else s.bestTrainingDays = "insufficient data: " + r.weekdays.message;

    if (r.rest.status === "ok") {
      s.restPattern = (r.rest.fatigueDetected
        ? "performance drops after " + r.rest.maxConsecutive + " consecutive training day(s); rest after " + r.rest.maxConsecutive + " day(s) on"
        : "no clear fatigue pattern up to " + r.rest.maxConsecutive + " days in a row") +
        (r.rest.restDayNames.length ? "; best rest days: " + r.rest.restDayNames.join(" and ") : "");
    } else s.restPattern = "insufficient data: " + r.rest.message;

    if (r.sleep.status === "ok") {
      s.sleepTarget = "~" + r.sleep.targetH + "h before training days" +
        (r.sleep.avgPerfGood != null && r.sleep.avgPerfShort != null
          ? " (avg perf " + r.sleep.avgPerfGood + "/5 after 7h+ vs " + r.sleep.avgPerfShort + "/5 after short sleep)"
          : "") +
        (r.sleep.rDur != null ? "; sleep-duration/performance correlation r=" + r.sleep.rDur : "");
    } else s.sleepTarget = "insufficient data: " + r.sleep.message;

    var f = r.food, food = [];
    if (f.status === "ok") {
      if (f.pre.status === "ok") {
        food.push("pre-workout meal (within 3h): avg " + f.pre.avgWith + "/5 with vs " +
          f.pre.avgWithout + "/5 without (better: " + f.pre.better + ")");
      }
      if (f.carbs.status === "ok") {
        food.push("pre-workout carbs >=40g: " + f.carbs.avgHigh + "/5 vs <40g: " +
          f.carbs.avgLow + "/5 (better: " + f.carbs.better + ")");
      }
      if (f.protein.status === "ok") {
        food.push("protein " + f.protein.avgProteinG + "g/day = " + f.protein.gPerKg +
          " g/kg (target " + f.protein.targetGPerKg + " g/kg" +
          (f.protein.meetsTarget ? ", met)" : ", NOT met; aim ~" + f.protein.targetG + "g/day)"));
      }
    }
    s.foodFindings = food.length ? food.join("; ") : "insufficient food+workout data";

    if (r.trends.status === "ok") {
      var t = [];
      ["weightKg", "bodyFatPct", "muscleMassKg"].forEach(function (k) {
        var m = r.trends.metrics[k];
        if (m && m.status === "ok") {
          t.push(m.label + ": " + m.direction +
            (m.direction === "stable" ? "" : " " + (m.delta30 > 0 ? "+" : "") + m.delta30 + " " + m.unit + "/30d") +
            ", latest " + m.latest + " " + m.unit);
        }
      });
      s.bodyTrends30d = t.length ? t.join("; ") : "not enough body measurements";
    } else s.bodyTrends30d = "insufficient data: " + r.trends.message;

    return s;
  }

  function buildContext() {
    var data = {
      sleep: S.getAll("sleep"),
      food: S.getAll("food"),
      exercise: S.getAll("exercise"),
      body: S.getAll("body")
    };

    var insights;
    try {
      insights = summarizeInsights(OF.engine.analyzeAll(data));
    } catch (e) {
      insights = { error: "insights engine failed: " + e.message };
    }

    var cutoff = U.todayISO(-13); // last 14 days incl. today (ISO strings compare)
    var sleep14 = data.sleep.filter(function (r) { return r.date >= cutoff; });
    var ex14 = data.exercise.filter(function (r) { return r.date >= cutoff; });
    var food14 = data.food.filter(function (r) { return r.date >= cutoff; });
    var water14 = S.getAll("water").filter(function (r) { return r.date >= cutoff; });
    var steps14 = S.getAll("steps").filter(function (r) { return r.date >= cutoff; });

    // Water: average daily total over days that have entries.
    var wByDay = {};
    water14.forEach(function (r) {
      if (isFinite(Number(r.amountMl))) wByDay[r.date] = (wByDay[r.date] || 0) + Number(r.amountMl);
    });
    var wDays = Object.keys(wByDay);
    var waterAvgMl = wDays.length
      ? Math.round(wDays.reduce(function (a, d) { return a + wByDay[d]; }, 0) / wDays.length) : null;

    // per-day food totals -> daily averages (only days with entries)
    var byDay = {};
    food14.forEach(function (r) {
      var d = byDay[r.date] || (byDay[r.date] = { kcal: 0, protein: 0 });
      if (typeof r.calories === "number") { d.kcal += r.calories; d.hasKcal = true; }
      if (typeof r.protein === "number") { d.protein += r.protein; d.hasProt = true; }
    });
    var days = Object.keys(byDay);
    // Average only over days that actually carry the number — a day of
    // name-only food entries must not drag the average toward 0 kcal.
    var kcalDays = days.filter(function (d) { return byDay[d].hasKcal; });
    var protDays = days.filter(function (d) { return byDay[d].hasProt; });
    var kcalAvg = kcalDays.length
      ? Math.round(kcalDays.reduce(function (a, d) { return a + byDay[d].kcal; }, 0) / kcalDays.length) : null;
    var protAvg = protDays.length
      ? round1(protDays.reduce(function (a, d) { return a + byDay[d].protein; }, 0) / protDays.length) : null;

    var latestBody = data.body.slice().sort(function (a, b) {
      return (b.date || "") < (a.date || "") ? -1 : 1;
    })[0] || null;

    // Latest physique-photo analysis (compact — body-fat range, muscularity,
    // top focus areas, date) so the coach can tailor training/target advice.
    var physiqueRecs = S.getAll("physique");
    var latestPhysique = physiqueRecs.slice().sort(function (a, b) {
      return (b.date || "") < (a.date || "") ? -1 : 1;
    })[0] || null;
    var physique = null;
    if (latestPhysique) {
      physique = {
        date: latestPhysique.date,
        estBodyFatRangePct: [latestPhysique.bodyFatRangeLow, latestPhysique.bodyFatRangeHigh],
        estBodyFatMidpointPct: latestPhysique.bodyFatMidpoint,
        muscularity: latestPhysique.muscularity,
        topFocusAreas: (latestPhysique.focusAreas || []).slice(0, 3),
        topStrengths: (latestPhysique.strengths || []).slice(0, 3),
        note: "visual photo estimate, not a medical measurement"
      };
    }

    // Goal, targets, progress, adaptation history (compact, from goals.js).
    var goalCoaching = null;
    try {
      goalCoaching = OF.goals ? OF.goals.coachContext() : null;
    } catch (e) {
      goalCoaching = { error: "goal context failed: " + e.message };
    }

    // Adherence vs the personal targets over the last 14 days.
    var adherence = null;
    if (goalCoaching && goalCoaching.dailyTargets && typeof goalCoaching.dailyTargets === "object") {
      var dt = goalCoaching.dailyTargets;
      var sleepAvgH = avg(sleep14, function (r) { return r.durationMin / 60; });
      adherence = {
        avgDailyKcalVsTarget: kcalAvg != null ? (kcalAvg - dt.kcal) : null,
        avgDailyProteinGVsTarget: protAvg != null ? round1(protAvg - dt.proteinG) : null,
        avgDailyWaterMl: waterAvgMl,
        waterTargetMl: dt.waterMl,
        avgDailySteps: avg(steps14, function (r) { return r.count; }),
        stepsTarget: dt.steps,
        avgSleepH: sleepAvgH,
        sleepTargetH: dt.sleepH
      };
    }

    // Strength / set-logging summary (top lifts, trends, PRs, stalls).
    var strength = null;
    try {
      if (OF.strength) {
        strength = OF.strength.coachSummary(OF.strength.analyze({
          exercise: data.exercise, sleep: data.sleep, food: data.food, body: data.body,
          goalType: (goalCoaching && goalCoaching.goalType) || null,
          proteinTargetG: (goalCoaching && goalCoaching.dailyTargets &&
            typeof goalCoaching.dailyTargets === "object" &&
            goalCoaching.dailyTargets.proteinG) || null
        }));
      }
    } catch (e) {
      strength = { error: "strength engine failed: " + e.message };
    }

    // Training program + today's prescribed session (the trainer plan).
    var trainingPlan = null;
    try { trainingPlan = OF.trainer ? OF.trainer.coachContext() : null; }
    catch (e) { trainingPlan = null; }

    // Community benchmarks (P3-6): compact, clearly-labeled anonymized
    // aggregates from the in-memory cache only (never a network wait here;
    // ≤600 bytes, top-2 lifts). The on-device engine stays source of truth.
    var communityBenchmarks = null;
    try {
      communityBenchmarks = OF.receipts ? OF.receipts.coachBenchmarks() : null;
    } catch (e) {
      communityBenchmarks = null;
    }

    return {
      today: U.todayISO(),
      recordCounts: {
        sleep: data.sleep.length, food: data.food.length,
        exercise: data.exercise.length, body: data.body.length,
        water: S.getAll("water").length, steps: S.getAll("steps").length
      },
      goalCoaching: goalCoaching,
      adherence14d: adherence,
      trainingPlan: trainingPlan,
      strengthTraining: strength,
      communityBenchmarks: communityBenchmarks,
      insights: insights,
      last14days: {
        sleep: {
          nights: sleep14.length,
          // null durations must be SKIPPED, not counted as 0-hour nights (null/60 === 0)
          avgHours: avg(sleep14, function (r) { return r.durationMin == null ? null : r.durationMin / 60; }),
          avgQuality: avg(sleep14, function (r) { return r.quality; })
        },
        workouts: {
          count: ex14.length,
          avgPerformance: avg(ex14, function (r) { return r.performance; }),
          avgDurationMin: avg(ex14, function (r) { return r.durationMin; })
        },
        nutrition: {
          daysLogged: days.length,
          avgDailyKcal: kcalAvg,
          avgDailyProteinG: protAvg
        },
        hydration: {
          daysLogged: wDays.length,
          avgDailyWaterMl: waterAvgMl
        },
        steps: {
          daysLogged: steps14.length,
          avgDailySteps: avg(steps14, function (r) { return r.count; })
        }
      },
      latestBody: latestBody ? {
        date: latestBody.date,
        weightKg: latestBody.weightKg,
        bodyFatPct: latestBody.bodyFatPct,
        muscleMassKg: U.muscleKg(latestBody)   // canonical kg; converts legacy % records
      } : null,
      physique: physique
    };
  }

  /* ---------------- rendering ---------------- */

  // The coach's companion server runs on the user's own computer. Copy must fit
  // where the app is actually running: the native mobile app can't start it at
  // all, a Mac desktop uses the .command launcher, Windows uses the .bat.
  function isNativeApp() {
    var C = window.Capacitor;
    if (!C) return false;
    return C.isNativePlatform ? C.isNativePlatform() : (C.platform && C.platform !== "web");
  }
  function launcherName() {
    return /Mac|iPhone|iPad|iPod/.test(navigator.userAgent || "") ?
      "Start OptimalFit.command" : "Start OptimalFit.bat";
  }

  function statusCard(title, bodyHtml) {
    return '<div class="card placeholder-card coach-status-card"><h2>' + U.esc(title) +
      '</h2>' + bodyHtml +
      '<div class="form-actions"><button type="button" class="btn" id="coach-retry">Check again</button></div></div>';
  }

  function renderStatus() {
    // AI Coach is a Premium feature — gate before the server/health states.
    if (OF.entitlements && !OF.entitlements.isPremium()) {
      els.chat.classList.add("hidden");
      els.status.innerHTML = OF.entitlements.paywallHtml({
        title: "AI Coach is Premium",
        blurb: "The AI Coach answers questions grounded in your own logged data."
      });
      OF.entitlements.bindPaywall(els.status, renderStatus);
      return;
    }
    if (health === "ok") {
      els.status.innerHTML = "";
      els.chat.classList.remove("hidden");
      renderLog();
      return;
    }
    // Live LLM unreachable but the on-device coach can still help → show the chat
    // with an offline banner rather than a dead "can't reach the server" card.
    if (offlineUsable()) {
      els.chat.classList.remove("hidden");
      var hint = (health === "no-claude")
        ? "Install &amp; sign into Claude Code on the computer running the OptimalFit server for full AI chat."
        : ((OF.coachApi && OF.coachApi.remote())
          ? "Reconnect your computer for full chat."
          : "Start the OptimalFit server on your computer for full chat.");
      els.status.innerHTML = '<div class="coach-offline-banner">💪 Live AI coach offline — answering from your on-device plan. ' + hint +
        ' <button type="button" class="btn mini" id="coach-retry-inline">Retry</button></div>';
      renderLog();
      var rt = document.getElementById("coach-retry-inline");
      if (rt) rt.addEventListener("click", checkHealth);
      return;
    }
    els.chat.classList.add("hidden");
    if (health === "no-server") {
      els.status.innerHTML = (OF.coachApi && OF.coachApi.remote())
        ? statusCard("The coach is taking a break",
            '<p class="muted">The AI coach couldn&rsquo;t be reached right now. Check your internet ' +
            'connection and try again in a moment &mdash; everything else in the app keeps working.</p>')
        : isNativeApp()
        ? statusCard("The AI coach runs on your computer",
            '<p class="muted">The AI coach uses the Claude subscription on your own Mac or PC, so ' +
            'it stays private and costs nothing. It is a companion feature you use on your computer ' +
            '&mdash; open OptimalFit there to chat with the coach. Everything else in the app works ' +
            'right here on your phone.</p>')
        : statusCard("The AI coach needs the local server",
            '<p class="muted">Double-click <strong>&ldquo;' + launcherName() + '&rdquo;</strong> in the ' +
            'OptimalFit folder, then reload this page. Everything else in the app keeps working ' +
            'without the server &mdash; only this tab needs it.</p>');
    } else if (health === "need-key") {
      els.status.innerHTML =
        '<div class="card placeholder-card coach-status-card"><h2>Pair with the PC server</h2>' +
        '<p class="muted">The server is running in phone mode. Enter the <strong>6-digit ' +
        'pairing code</strong> shown in the OptimalFit server window on the PC (one time only).</p>' +
        (pairError ? '<p class="form-error">' + U.esc(pairError) + '</p>' : '') +
        '<form class="form-actions" id="coach-pair-form">' +
        '<input id="coach-pair-input" class="pair-input" inputmode="numeric" ' +
        'autocomplete="one-time-code" maxlength="6" placeholder="123456" aria-label="Pairing code">' +
        '<button type="submit" class="btn primary">Pair</button></form></div>';
      var pf = document.getElementById("coach-pair-form");
      pf.addEventListener("submit", function (e) {
        e.preventDefault();
        var code = document.getElementById("coach-pair-input").value.trim();
        if (!/^\d{6}$/.test(code)) {
          pairError = "The code is 6 digits — check the server window on the PC.";
          renderStatus();
          return;
        }
        setPairKey(code);
        checkHealth(); // server verifies the code via /api/health keyOk
      });
      return;
    } else { // still checking (no-claude is handled by the offlineUsable() banner above)
      els.status.innerHTML = '<div class="card coach-status-card"><p class="muted">Checking for the local server&hellip;</p></div>';
    }
    var retry = document.getElementById("coach-retry");
    if (retry) retry.addEventListener("click", checkHealth);
  }

  function renderLog() {
    var html = "";
    if (!messages.length && !busy) {
      var todayLine = "";
      try {
        if (OF.trainer && OF.trainer.nextSession) {
          var ns = OF.trainer.nextSession();
          if (ns) todayLine = '<p class="coach-today">I’m your coach. Today I’ve got you on <strong>' +
            U.esc(ns.name) + '</strong> — ask me to walk you through it or change anything.</p>';
        }
      } catch (e) {}
      html += todayLine ||
        '<p class="coach-empty muted">I’m your personal trainer. Ask me anything about your training, food, ' +
        'sleep or recovery — or build a plan on the dashboard and I’ll coach you through it. ' +
        'Answers use your tracked data and can take 10&ndash;60 seconds.</p>';
      html += '<div class="coach-chips">' + chips().map(function (c) {
        return '<button type="button" class="coach-chip" data-q="' + U.esc(c) + '">' + U.esc(c) + '</button>';
      }).join("") + '</div>';
    }
    var avatar = '<span class="coach-avatar" aria-hidden="true">' + OF.icons.get("sparkles") + '</span>';
    messages.forEach(function (m) {
      if (m.role === "user") {
        html += '<div class="bubble bubble-user">' + U.esc(m.text) + '</div>';
      } else { // coach / error rows get the avatar dot
        html += '<div class="msg-row">' + avatar +
          '<div class="bubble bubble-' + m.role + '">' + U.esc(m.text) + '</div></div>';
      }
    });
    if (busy) {
      html += '<div class="msg-row">' + avatar +
        '<div class="bubble bubble-coach bubble-thinking">Coach is thinking&hellip; ' +
        '<span class="dots"><span></span><span></span><span></span></span></div></div>';
    }
    els.log.innerHTML = html;
    els.log.scrollTop = els.log.scrollHeight;
  }

  function setBusy(b) {
    busy = b;
    els.input.disabled = b;
    els.send.disabled = b;
    els.send.textContent = b ? "Thinking…" : "Send";
  }

  function pushMsg(role, text) {
    messages.push({ role: role, text: text });
    if (messages.length > MAX_MSGS) messages = messages.slice(-MAX_MSGS);
    // [24] announce ONLY the new coach/error reply to screen readers — the
    // transcript itself is no longer aria-live, so the whole conversation is
    // not re-read on every message.
    if (role === "coach" || role === "error") {
      var live = document.getElementById("coach-live");
      if (live) live.textContent = text;
    }
  }

  /* ---------------- health + send ---------------- */

  var healthSeq = 0;   // a stale slow probe must never overwrite a fresh result

  function checkHealth() {
    var remote = OF.coachApi && OF.coachApi.remote();
    var seq = ++healthSeq;
    health = null;
    renderStatus();
    // [20] don't hang forever on 'checking' if the server/tunnel is unreachable
    var ctrl = ("AbortController" in window) ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 15000) : null;
    fetch(apiUrl("/api/health"), { cache: "no-store", headers: apiHeaders(),
                                   signal: ctrl ? ctrl.signal : undefined })
      .then(function (res) { return res.json(); })
      .then(function (j) {
        if (seq !== healthSeq) return;   // a newer probe already answered
        if (!(j && j.ok)) {
          health = "no-server";
        } else if (j.keyOk === false) {
          // [16] remote (baked-key) mode: the user can't re-enter a key — a
          // rejected key means the app needs updating, not phone-pairing
          if (remote) { health = "no-server"; }
          else {
            pairError = pairKey()
              ? "That code didn't match — check the server window on the PC." : "";
            setPairKey("");
            health = "need-key";
          }
        } else if (!j.claude) {
          health = "no-claude";
        } else {
          pairError = "";
          health = "ok";
        }
        renderStatus();
      })
      .catch(function () {
        if (seq !== healthSeq) return;
        health = "no-server";
        renderStatus();
      })
      .then(function () { if (timer) clearTimeout(timer); });
  }

  /* On-device coach: when the live LLM (owner's Mac) is unreachable, still give
     a useful, plan-grounded answer to the common questions so the coach never
     looks broken. Rule-based, from the on-device trainer/goal/readiness data. */
  function localAnswer(q) {
    q = (q || "").toLowerCase();
    var ns = null, t = null;
    try { ns = OF.trainer && OF.trainer.nextSession ? OF.trainer.nextSession() : null; } catch (e) {}
    try { t = OF.goals && OF.goals.currentTargets ? OF.goals.currentTargets() : null; } catch (e) {}
    function list() { return ns ? ns.exercises.map(function (ex) { return "• " + ex.name + " — " + OF.trainer.prescription(ex); }).join("\n") : ""; }
    if (/\breadiness\b|\brecover(y|ed)\b|\brested\b|how ready|am i ready|ready to train/.test(q)) {
      var r = null;
      try { if (OF.engine && OF.engine.analyzeAll) r = OF.engine.analyzeAll({ sleep: S.getAll("sleep"), food: S.getAll("food"), exercise: S.getAll("exercise"), body: S.getAll("body") }).readiness; } catch (e) {}
      if (r && r.status === "ok") return "Your readiness is " + r.score + "/100 (" + r.level + "). " + (r.verdict || "") +
        (r.level === "low" ? " Sleep and back-to-back training days are the usual culprits — a lighter session or a rest day is smart." : "");
      return "Log a few nights of sleep and some workouts and I'll score your daily readiness (recovery) so we train hard when you're fresh and back off when you're not.";
    }
    // check recovery/back-off BEFORE 'push harder' so "give me more rest" isn't hijacked.
    // word boundaries keep bare "rest"/"light" from firing on "restaurant"/"delight".
    if (/sore|tired|low energy|\brest\b|adjust|easier|\blight(er)?\b|short on time|busy|travel/.test(q) && ns) {
      return "Back off but don't skip — do today's " + ns.name + " lighter: drop each working set ~10% and cut one set per exercise. Hit the first two compound lifts for sure; drop the last accessory if you're gassed. A lighter session still counts.";
    }
    if (/harder|heavier|tough|intens|add weight|push me/.test(q) && ns) {
      return "Today is " + ns.name + ". To push harder: add a set to your main lifts, or take a small jump on anything you completed all your reps on last time — but keep 1 rep in reserve on the last set so every rep stays clean.";
    }
    if (/\beat(ing)?\b|\bfood\b|\bmeals?\b|nutrition|protein|pre-?workout|\bfuel\b|breakfast|before (training|a workout|the gym|my workout)/.test(q)) {
      var kcal = t && t.status === "ok" ? t.calories : null, prot = t && t.status === "ok" ? t.proteinG : null;
      return "Pre-training, aim for easy carbs + a bit of protein 60–90 min out (oats or fruit + Greek yogurt or a scoop of protein)." +
        (prot ? " Your daily target is ~" + prot + "g protein" + (kcal ? " / " + kcal + " kcal" : "") + " — spread protein across the day and get a solid feed in after you lift." : "");
    }
    if (/today|session|workout|walk|do|plan|next/.test(q)) {
      if (!ns) return "You don't have a program yet — tap “Build my program” on the dashboard and I'll set you up, then I can walk you through every session.";
      return "Today is " + ns.name + " (day " + (ns.dayIndex + 1) + "). Here's the plan:\n" + list() +
        "\n\nWarm up, then work through them in order — controlled reps, and log each set so I add weight for you next time.";
    }
    if (ns) return "My live side needs your computer online to chat freely — but your plan's ready. Today is " + ns.name + ". Tap “Start this workout” on the dashboard, or ask me to walk you through it, make it harder, or adjust for soreness.";
    return "My live AI side needs your computer online. Meanwhile, build a program on the dashboard and I'll coach you through your sessions right here on your phone.";
  }

  function offlineUsable() {
    return (health === "no-server" && OF.coachApi && OF.coachApi.remote()) || health === "no-claude";
  }

  function send(question) {
    question = (question || "").trim();
    if (!question || busy) return;
    // Offline but usable: answer on-device instead of doing nothing.
    if (health !== "ok") {
      if (!offlineUsable()) return;
      pushMsg("user", question);
      els.input.value = "";
      pushMsg("coach", localAnswer(question));
      renderLog();
      return;
    }

    pushMsg("user", question);
    els.input.value = "";
    setBusy(true);
    renderLog();

    var ctrl = ("AbortController" in window) ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, REQUEST_TIMEOUT_MS) : null;

    var httpStatus = 0;
    fetch(apiUrl("/api/coach"), {
      method: "POST",
      headers: apiHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ question: question, context: buildContext() }),
      signal: ctrl ? ctrl.signal : undefined
    })
      .then(function (res) { httpStatus = res.status; return res.json(); })
      .then(function (j) {
        if (httpStatus === 401) {
          if (OF.coachApi && OF.coachApi.remote()) {
            // [16] baked-key mode: no code to re-enter — surface an update hint
            health = "no-server";
            pushMsg("error", "The AI coach is temporarily unavailable. Please update OptimalFit or try again later.");
          } else { // phone pairing: the code was revoked
            setPairKey("");
            pairError = "The server asked to pair again — enter the current code.";
            health = "need-key";
            pushMsg("error", (j && j.error) || "Pairing required.");
          }
        } else if (j && j.ok && typeof j.answer === "string") pushMsg("coach", j.answer.trim());
        else pushMsg("error", (j && j.error) || "The coach returned an unexpected response.");
      })
      .catch(function (e) {
        pushMsg("error", e && e.name === "AbortError"
          ? "The coach took too long and the request was cancelled."
          : ((OF.coachApi && OF.coachApi.remote())
              ? "Could not reach the AI coach. Check your internet connection and try again."
              : (isNativeApp()
                  ? "Could not reach the coach on your computer. Make sure OptimalFit is running there and this phone is on the same Wi-Fi."
                  : "Could not reach the local server. Is “" + launcherName() + "” still running?")));
      })
      .then(function () { // finally
        if (timer) clearTimeout(timer);
        setBusy(false);
        // need-key swaps chat for the pairing card; a mid-chat 401/failure in
        // remote mode must ALSO surface the offline banner — otherwise later
        // questions get silently answered on-device with no explanation
        if (health === "need-key" || (health !== "ok" && offlineUsable())) { renderStatus(); renderLog(); }
        else renderLog();
        els.input.focus();
      });
  }

  /* ---------------- wiring ---------------- */

  function init() {
    els.status = document.getElementById("coach-status");
    els.chat = document.getElementById("coach-chat");
    els.log = document.getElementById("coach-log");
    els.form = document.getElementById("coach-form");
    els.input = document.getElementById("coach-input");
    els.send = document.getElementById("coach-send");

    els.form.addEventListener("submit", function (e) {
      e.preventDefault();
      send(els.input.value);
    });
    els.log.addEventListener("click", function (e) {
      var chip = e.target.closest(".coach-chip");
      if (chip) send(chip.getAttribute("data-q"));
    });
  }

  /** Called by app.js every time the Coach tab is opened. */
  function onEnter() {
    if (health !== "ok") checkHealth();
    else renderStatus();
  }

  // buildContext is exported so tests can check payload size/shape
  // without making an LLM call.
  return { init: init, onEnter: onEnter, buildContext: buildContext };
})();

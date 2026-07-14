/* ============================================================
   coach-intake.js — the coach onboarding interview (Coach 2.0).

   A chat-style adaptive intake that works fully OFFLINE (deterministic
   branching, no LLM): the coach asks, educates as it goes, branches on
   experience level, and writes everything to the User Coaching Profile
   (OF.profile). Finishes by generating the personalized program
   (OF.trainer) and explaining the reasoning with evidence-backed whys.

   The flow engine (STEPS + advance) is pure and exported for tests;
   the DOM layer renders bubbles + chips into a full-screen overlay
   reusing the coach chat styles. Re-runnable any time ("switch things
   up"); OF.profile.reinterviewTriggers() decides when to OFFER it.
   ============================================================ */

window.OF = window.OF || {};

OF.intake = (function () {
  "use strict";

  var U = OF.util;

  /* ================= the flow (pure) =================
     Each step: { id, say(state)→string, edu?(state)→string|null,
       input: {kind:"chips"|"multi"|"text", options?|placeholder?, skip?},
       save(state, value), when?(state)→bool }.
     advance(state, value) applies save and returns the next step id. */

  function lvl(state) {
    var y = state.trainingAge;
    return y == null ? null : y < 1 ? "beginner" : y <= 3 ? "intermediate" : "advanced";
  }

  var COMMON_LIFTS = ["Bench Press", "Back Squat", "Deadlift", "Pull-Up", "Overhead Press",
    "Dumbbell Curl", "Lateral Raise", "Hip Thrust", "Bulgarian Split Squat", "Walking Lunge",
    "Leg Press", "Romanian Deadlift", "Dips (Chest)", "Cable Fly", "Face Pull"];

  var STEPS = [
    {
      id: "goal",
      say: function () {
        return "Let's set up your coaching — this takes about 2 minutes, and everything you tell me shapes your plan. First: what's the main thing you want your body to do?";
      },
      input: { kind: "chips", options: [
        { label: "Build muscle", value: "muscle" },
        { label: "Lose fat", value: "fat-loss" },
        { label: "Get stronger", value: "strength" },
        { label: "Muscle + lose fat", value: "recomp" },
        { label: "Endurance / fitness", value: "endurance" },
        { label: "General health", value: "health" }
      ] },
      save: function (st, v) { st.goal = v; }
    },
    {
      id: "milestone",
      say: function (st) {
        var m = { muscle: "Love it. Any specific milestone in mind — like “gain 10 lb” or “fill out my shirts”?",
          "fat-loss": "Got it. A specific milestone helps me pace things — like “lose 15 lb by summer”?",
          strength: "Strong choice. A number you're chasing — like “bench 225” or “squat 315”?",
          recomp: "The classic body-recomposition goal. Any specific target in mind?",
          endurance: "Nice. A race or target — like “run a 10k” — or just general engine-building?",
          health: "The best long game there is. Anything specific you want to feel or do better?" };
        return m[st.goal] || m.health;
      },
      input: { kind: "text", placeholder: "e.g. bench 225 by December", skip: "No specific target" },
      save: function (st, v) { if (v) st.milestone = String(v).slice(0, 80); }
    },
    {
      id: "timeline",
      say: function () { return "And what timeline feels right to you? (I'll be honest if it's not realistic — that's my job.)"; },
      input: { kind: "chips", options: [
        { label: "~3 months", value: 13 }, { label: "~6 months", value: 26 },
        { label: "~a year", value: 52 }, { label: "No rush — lifestyle", value: null }
      ] },
      save: function (st, v) { st.timelineWeeks = v; }
    },
    {
      id: "training-age",
      say: function () { return "How long have you been lifting consistently? Be honest — the right starting point matters more than a flattering one."; },
      input: { kind: "chips", options: [
        { label: "Never / just starting", value: 0 },
        { label: "Under a year", value: 0.5 },
        { label: "1–3 years", value: 2 },
        { label: "3+ years", value: 5 }
      ] },
      save: function (st, v) { st.trainingAge = v; }
    },
    {
      id: "beginner-pep",
      when: function (st) { return lvl(st) === "beginner"; },
      say: function () {
        return "Perfect — beginners make the fastest progress of anyone (“newbie gains” are real: your body adapts to almost any sensible plan). I'll keep the plan simple, teach you as we go, and we'll add weight almost every week.";
      },
      input: { kind: "chips", options: [{ label: "Sounds good", value: true }] },
      save: function () {}
    },
    {
      id: "weak-points",
      when: function (st) { return lvl(st) === "advanced"; },
      say: function () { return "With 3+ years under the bar you know your body. Which areas feel behind — where do you want extra focus?"; },
      input: { kind: "multi", options: [
        { label: "Chest", value: "Chest" }, { label: "Back", value: "Back" },
        { label: "Shoulders", value: "Shoulders" }, { label: "Arms", value: "Arms" },
        { label: "Legs", value: "Legs" }, { label: "Nothing lagging", value: null }
      ], done: "That's them" },
      save: function (st, v) { st.weakPoints = (v || []).filter(Boolean); }
    },
    {
      id: "days",
      say: function (st) {
        return lvl(st) === "beginner"
          ? "How many days a week can you REALISTICALLY train? Pick the number you'll still be hitting in 3 months — consistency beats ambition."
          : "How many days a week can you realistically train?";
      },
      input: { kind: "chips", options: [
        { label: "2", value: 2 }, { label: "3", value: 3 }, { label: "4", value: 4 },
        { label: "5", value: 5 }, { label: "6", value: 6 }
      ] },
      save: function (st, v) { st.days = v; }
    },
    {
      id: "session-length",
      say: function () { return "And how long can a session usually run?"; },
      input: { kind: "chips", options: [
        { label: "~30 min", value: 30 }, { label: "~45 min", value: 45 },
        { label: "~60 min", value: 60 }, { label: "75+ min", value: 75 }
      ] },
      save: function (st, v) { st.sessionMinutes = v; }
    },
    {
      id: "split",
      say: function (st) {
        var rec = st.days <= 3 ? (st.days <= 2 ? "full-body" : "full-body") : st.days === 4 ? "upper-lower" : "ppl";
        st.recommendedSplit = rec;
        var names = { "full-body": "Full body", "upper-lower": "Upper / Lower", "ppl": "Push / Pull / Legs" };
        return "How do you want the week organized? Quick guide: " +
          "FULL BODY = every muscle each session (best at 2–3 days); " +
          "UPPER/LOWER = alternating halves (great at 4); " +
          "PUSH/PULL/LEGS = pressing day, pulling day, leg day (shines at 5–6). " +
          "With " + st.days + " days I'd lean " + names[rec] + " — research says hitting each muscle ~2×/week is what matters, and that split gets you there. But it's your call: the split you enjoy is the one you'll keep showing up for.";
      },
      input: { kind: "chips", options: [
        { label: "You choose for me", value: null },
        { label: "Full body", value: "full-body" },
        { label: "Upper / Lower", value: "upper-lower" },
        { label: "Push / Pull / Legs", value: "ppl" }
      ] },
      save: function (st, v) {
        st.split = v || st.recommendedSplit ||
          (st.days <= 3 ? "full-body" : st.days === 4 ? "upper-lower" : "ppl");
      }
    },
    {
      id: "style",
      say: function () {
        return "Do you enjoy heavy low-rep work (3–6 grinding reps), higher-rep pump work (10–15, chasing the burn), or a mix? Research says both build muscle when pushed hard — so this is about what YOU like doing.";
      },
      input: { kind: "chips", options: [
        { label: "Heavy & low-rep", value: "heavy" },
        { label: "Pump & higher-rep", value: "pump" },
        { label: "Mix it up", value: "mixed" }
      ] },
      save: function (st, v) { st.style = v; }
    },
    {
      id: "cardio",
      say: function (st) {
        return st.goal === "fat-loss"
          ? "Cardio: it helps a cut, but your diet and lifting do most of the work. What kind do you not hate?"
          : "Any cardio you actually enjoy? (None is a valid answer — and no, cardio won't “kill your gains”, that's mostly myth at normal doses.)";
      },
      input: { kind: "chips", options: [
        { label: "None, thanks", value: "none" }, { label: "Walking", value: "walk" },
        { label: "Running", value: "run" }, { label: "Cycling", value: "bike" },
        { label: "Swimming", value: "swim" }, { label: "Sports", value: "sport" }
      ] },
      save: function (st, v) { st.cardio = v; }
    },
    {
      id: "likes",
      say: function () { return "Which lifts do you LOVE? I'll build around them — enjoying your program is the strongest predictor that you'll stick to it."; },
      input: { kind: "multi", options: COMMON_LIFTS.map(function (n) { return { label: n, value: n }; }), done: "Those are my favorites", skip: "No strong favorites" },
      save: function (st, v) { st.likes = v || []; }
    },
    {
      id: "dislikes",
      say: function () { return "And which do you HATE or refuse to do? Zero judgment — they'll never appear in your plan."; },
      input: { kind: "multi", options: COMMON_LIFTS.map(function (n) { return { label: n, value: n }; }), done: "That's the blacklist", skip: "Nothing I refuse" },
      save: function (st, v) { st.dislikes = v || []; }
    },
    {
      id: "equipment",
      say: function () { return "What equipment do you have access to?"; },
      input: { kind: "chips", options: [
        { label: "Full gym", value: "full-gym" },
        { label: "Dumbbells only", value: "dumbbells" },
        { label: "Home basics (DBs + bands/cable)", value: "home-basic" },
        { label: "Bodyweight only", value: "bodyweight" }
      ] },
      save: function (st, v) { st.equipment = v; }
    },
    {
      id: "injury-area",
      say: function () { return "Any injuries or pain points I should program around? (If anything is sharp, worsening, or tingling/numb — please see a professional first; I coach training, not rehab.)"; },
      input: { kind: "chips", options: [
        { label: "All good", value: null },
        { label: "Knee", value: "knee" }, { label: "Shoulder", value: "shoulder" },
        { label: "Lower back", value: "lower back" }, { label: "Elbow/wrist", value: "elbow" },
        { label: "Hip", value: "hip" }
      ] },
      save: function (st, v) { st.injuryArea = v; }
    },
    {
      id: "injury-patterns",
      when: function (st) { return !!st.injuryArea; },
      say: function (st) { return "Which movements aggravate the " + st.injuryArea + "? I'll keep those patterns out entirely and we'll train around it."; },
      input: { kind: "multi", options: [
        { label: "Squatting", value: "squat" }, { label: "Lunges/split squats", value: "lunge" },
        { label: "Deadlifts/hinging", value: "hinge" }, { label: "Overhead pressing", value: "overhead" },
        { label: "Bench/push-ups/dips", value: "bench" }, { label: "Rows/pull-ups", value: "row" }
      ], done: "That covers it" },
      save: function (st, v) {
        st.injuries = [{ area: st.injuryArea, aggravates: v || [] }];
      }
    },
    {
      id: "sleep",
      say: function () { return "Almost done — recovery questions, because that's where the muscle is actually built. How much sleep do you typically get?"; },
      input: { kind: "chips", options: [
        { label: "Under 6h", value: 5.5 }, { label: "6–7h", value: 6.5 },
        { label: "7–8h", value: 7.5 }, { label: "8h+", value: 8.5 }
      ] },
      save: function (st, v) { st.sleepH = v; }
    },
    {
      id: "stress",
      say: function () { return "Day-to-day stress level? High stress is a real recovery tax — I'll program accordingly, not judge."; },
      input: { kind: "chips", options: [
        { label: "Pretty chill", value: 2 }, { label: "Moderate", value: 3 }, { label: "High", value: 4 }
      ] },
      save: function (st, v) { st.stress = v; }
    },
    {
      id: "job",
      say: function () { return "And your day job, movement-wise?"; },
      input: { kind: "chips", options: [
        { label: "Desk", value: "desk" }, { label: "On my feet", value: "onFeet" }, { label: "Physical work", value: "physical" }
      ] },
      save: function (st, v) { st.job = v; }
    },
    {
      id: "diet",
      say: function () { return "Last one: any dietary restrictions or styles I should respect in nutrition advice?"; },
      input: { kind: "multi", options: [
        { label: "None", value: null }, { label: "Vegetarian", value: "vegetarian" },
        { label: "Vegan", value: "vegan" }, { label: "Halal", value: "halal" },
        { label: "Kosher", value: "kosher" }, { label: "Lactose-free", value: "lactose-free" },
        { label: "Gluten-free", value: "gluten-free" }
      ], done: "That's everything" },
      save: function (st, v) { st.restrictions = (v || []).filter(Boolean); }
    }
  ];

  /** First applicable step index at/after i for this state. */
  function nextIdx(state, i) {
    for (var j = i; j < STEPS.length; j++) {
      if (!STEPS[j].when || STEPS[j].when(state)) return j;
    }
    return -1;   // done
  }

  /** Pure engine: apply the answer, return the next step (or null=finished). */
  function advance(state, stepId, value) {
    var idx = -1;
    for (var i = 0; i < STEPS.length; i++) if (STEPS[i].id === stepId) { idx = i; break; }
    if (idx === -1) return null;
    STEPS[idx].save(state, value);
    var n = nextIdx(state, idx + 1);
    return n === -1 ? null : STEPS[n];
  }

  /** Map the interview state → profile patch + app goal type. */
  function toProfilePatch(st) {
    var goalMap = { muscle: "lean-bulk", "fat-loss": "cut", strength: "performance",
      recomp: "recomp", endurance: "maintain", health: "maintain" };
    return {
      patch: {
        goals: {
          primary: st.goal,
          milestones: st.milestone ? [st.milestone] : [],
          timelineWeeks: st.timelineWeeks || null,
          appGoalType: goalMap[st.goal] || "maintain"
        },
        prefs: {
          split: st.split || null,
          daysPerWeek: st.days,
          sessionMinutes: st.sessionMinutes,
          style: st.style || null,
          cardio: st.cardio || null,
          likes: st.likes || [],
          dislikes: st.dislikes || []
        },
        experience: {
          trainingAgeYears: st.trainingAge,
          level: lvl(st),
          weakPoints: st.weakPoints && st.weakPoints.length ? st.weakPoints : null
        },
        constraints: {
          equipment: st.equipment,
          injuries: st.injuries || []
        },
        recovery: {
          sleepTypicalH: st.sleepH,
          stress: st.stress,
          jobActivity: st.job,
          restrictions: st.restrictions || []
        }
      },
      appGoalType: goalMap[st.goal] || "maintain"
    };
  }

  /* ================= finish: persist + build the program ================= */

  function finish(st) {
    var m = toProfilePatch(st);
    OF.profile.update(m.patch, "intake");

    // if no app goal exists yet, create one so targets/insights align
    // (same record shape onboarding.js uses)
    try {
      var g = OF.goals && OF.goals.activeGoal ? OF.goals.activeGoal() : null;
      if (!g && OF.storage) {
        OF.storage.add("goal", { date: U.todayISO(), type: m.appGoalType,
          targetAmountKg: null, targetDate: null, heightCm: null, age: null, sex: null, activity: null });
      }
    } catch (e) { /* goal card can be set up later */ }

    // emphasis: advanced lifters' first weak point gets the extra accessory
    var emphasis = null;
    if (st.weakPoints && st.weakPoints.length) emphasis = st.weakPoints[0];

    var program = OF.trainer.createProgram({
      daysPerWeek: st.days,
      equipment: st.equipment,
      experience: lvl(st) || "intermediate",
      sessionMinutes: st.sessionMinutes,
      emphasis: emphasis
    });
    return program;
  }

  /** Plain-English program summary + whys for the final bubble. */
  function summaryText(program, st) {
    var lines = [];
    lines.push("Here's your plan: " + program.split + " — " +
      program.days.map(function (d) { return d.name; }).join(", ") + ".");
    if (program.coach2) {
      var pg = program.coach2.perGroupWeeklySets;
      var vols = Object.keys(pg).map(function (g) { return g + " " + pg[g].sets; }).join(", ");
      lines.push("Weekly hard sets per muscle: " + vols + " — inside the research range for a " +
        program.coach2.level + ", starting moderate so YOUR response data decides where we go next.");
      lines.push(program.coach2.whys.effort.text);
      lines.push(program.coach2.whys.rest.text);
      if (program.coach2.injuryNotes && program.coach2.injuryNotes.length) {
        lines.push("Programmed around: " + program.coach2.injuryNotes.join("; ") + ".");
      }
    }
    if (st.milestone) lines.push("Target locked in: “" + st.milestone + "”. I'll track you toward it and tell you honestly how pace looks.");
    lines.push("Ask me “why?” about any part of this — every choice has research behind it. You can redo this interview any time from Settings or by telling me you want to switch things up.");
    return lines;
  }

  /* ================= DOM layer ================= */

  var els = {}, state = null, curStep = null, multiSel = [];

  function overlay() {
    var o = document.getElementById("intake-overlay");
    if (o) return o;
    o = document.createElement("div");
    o.id = "intake-overlay";
    o.setAttribute("role", "dialog");
    o.setAttribute("aria-modal", "true");
    o.setAttribute("aria-label", "Coach interview");
    o.innerHTML =
      '<div class="intake-panel">' +
        '<div class="intake-head"><h2>Your coach</h2>' +
          '<button type="button" class="btn ghost mini" id="intake-close" aria-label="Close interview">Save &amp; close</button></div>' +
        '<div class="coach-log" id="intake-log" aria-live="polite"></div>' +
        '<div class="intake-input" id="intake-input"></div>' +
      '</div>';
    document.body.appendChild(o);
    o.querySelector("#intake-close").addEventListener("click", close);
    return o;
  }

  function bubble(text, who) {
    var log = document.getElementById("intake-log");
    if (!log) return;
    var row = document.createElement("div");
    row.className = "msg-row" + (who === "user" ? " msg-user" : "");
    row.innerHTML = (who === "user" ? "" : '<span class="coach-avatar" aria-hidden="true"></span>') +
      '<div class="bubble bubble-' + (who === "user" ? "user" : "coach") + '">' + U.esc(text) + "</div>";
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
  }

  function renderInput(step) {
    var host = document.getElementById("intake-input");
    if (!host) return;
    multiSel = [];
    var inp = step.input;
    if (inp.kind === "chips") {
      host.innerHTML = '<div class="coach-chips">' + inp.options.map(function (o, i) {
        return '<button type="button" class="coach-chip" data-i="' + i + '">' + U.esc(o.label) + "</button>";
      }).join("") + "</div>";
    } else if (inp.kind === "multi") {
      host.innerHTML = '<div class="coach-chips">' + inp.options.map(function (o, i) {
        return '<button type="button" class="coach-chip" data-multi="' + i + '" aria-pressed="false">' + U.esc(o.label) + "</button>";
      }).join("") +
      '<button type="button" class="btn primary mini" data-done>' + U.esc(inp.done || "Done") + "</button>" +
      (inp.skip ? '<button type="button" class="btn ghost mini" data-skip>' + U.esc(inp.skip) + "</button>" : "") +
      "</div>";
    } else {   // text
      host.innerHTML = '<form class="coach-input-row" id="intake-text-form">' +
        '<input type="text" id="intake-text" maxlength="80" placeholder="' + U.esc(inp.placeholder || "") + '" autocomplete="off">' +
        '<button type="submit" class="btn primary">Send</button>' +
        (inp.skip ? '<button type="button" class="btn ghost mini" data-skip>' + U.esc(inp.skip) + "</button>" : "") +
        "</form>";
      var f = host.querySelector("#intake-text-form");
      f.addEventListener("submit", function (ev) {
        ev.preventDefault();
        var v = host.querySelector("#intake-text").value.trim();
        answer(v || null, v || (inp.skip || "Skip"));
      });
    }
  }

  function onInputClick(ev) {
    var t = ev.target;
    if (!curStep) return;
    var inp = curStep.input;
    if (t.hasAttribute && t.hasAttribute("data-i")) {
      var o = inp.options[Number(t.getAttribute("data-i"))];
      answer(o.value, o.label);
    } else if (t.hasAttribute && t.hasAttribute("data-multi")) {
      var idx = Number(t.getAttribute("data-multi"));
      var pos = multiSel.indexOf(idx);
      if (pos === -1) multiSel.push(idx); else multiSel.splice(pos, 1);
      t.classList.toggle("chip-on", pos === -1);
      t.setAttribute("aria-pressed", pos === -1 ? "true" : "false");
    } else if (t.hasAttribute && t.hasAttribute("data-done")) {
      var vals = multiSel.map(function (i) { return inp.options[i].value; });
      var labels = multiSel.map(function (i) { return inp.options[i].label; });
      answer(vals, labels.length ? labels.join(", ") : "None");
    } else if (t.hasAttribute && t.hasAttribute("data-skip")) {
      answer(inp.kind === "multi" ? [] : null, "Skip");
    }
  }

  function ask(step) {
    curStep = step;
    bubble(step.say(state), "coach");
    renderInput(step);
  }

  function answer(value, label) {
    bubble(label, "user");
    var next = advance(state, curStep.id, value);
    if (next) { ask(next); return; }
    // finished: persist, build, summarize
    document.getElementById("intake-input").innerHTML = "";
    bubble("Building your program…", "coach");
    var program;
    try { program = finish(state); }
    catch (e) {
      bubble("Something went wrong saving your plan — your answers are kept; try “Build my program” from the dashboard.", "coach");
      return;
    }
    summaryText(program, state).forEach(function (line) { bubble(line, "coach"); });
    var host = document.getElementById("intake-input");
    host.innerHTML = '<div class="coach-chips"><button type="button" class="btn primary" id="intake-finish">Let’s go</button></div>';
    host.querySelector("#intake-finish").addEventListener("click", function () {
      close();
      location.hash = "#dashboard";
      if (OF.trainer && OF.trainer.refresh) { try { OF.trainer.refresh(); } catch (e) {} }
      if (OF.settings && OF.settings.refreshAll) { try { OF.settings.refreshAll(); } catch (e) {} }
    });
    curStep = null;
  }

  function start() {
    state = {};
    var o = overlay();
    o.classList.add("open");
    var log = document.getElementById("intake-log");
    if (log) log.innerHTML = "";
    var input = document.getElementById("intake-input");
    input.removeEventListener("click", onInputClick);
    input.addEventListener("click", onInputClick);
    ask(STEPS[0]);
  }

  function close() {
    var o = document.getElementById("intake-overlay");
    if (o) o.classList.remove("open");
    curStep = null;
  }

  return {
    start: start,
    close: close,
    // pure engine exports (tests)
    flow: { steps: STEPS, advance: advance, nextIdx: nextIdx, toProfilePatch: toProfilePatch, level: lvl }
  };
})();

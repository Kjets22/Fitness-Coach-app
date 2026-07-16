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
      id: "setup-depth",
      say: function () {
        return "Want the quick version or the works? Quick asks only the essentials and builds your plan in about 30 seconds. Full adds your preferences, schedule and recovery for a more tailored plan — you can always fine-tune later either way.";
      },
      input: { kind: "chips", options: [
        { label: "\u26a1 Quick — just the essentials", value: true },
        { label: "Full — tailor it to me", value: false }
      ] },
      save: function (st, v) { st.quick = !!v; }
    },
    {
      id: "milestone",
      when: function (st) { return !st.quick; },
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
      when: function (st) { return !st.quick; },
      say: function () { return "And what timeline feels right to you? (I'll be honest if it's not realistic — that's my job.)"; },
      input: { kind: "chips", options: [
        { label: "~3 months", value: 13 }, { label: "~6 months", value: 26 },
        { label: "~a year", value: 52 }, { label: "No rush — lifestyle", value: null }
      ] },
      save: function (st, v) { st.timelineWeeks = v; }
    },
    {
      id: "age",
      say: function () { return "How old are you? This changes how I program your recovery — and it's how I keep you safe."; },
      input: { kind: "chips", options: [
        { label: "Under 18", value: 16 }, { label: "18–29", value: 25 },
        { label: "30–44", value: 37 }, { label: "45–59", value: 52 },
        { label: "60+", value: 65 }
      ] },
      save: function (st, v) { st.age = v; }
    },
    {
      id: "conditions",
      say: function () {
        return "Any health conditions I should know about? I'm a training coach, not a doctor — if you pick any of these I'll tell you to get your doctor's OK before we load you up, and then I'll program inside their guidance.";
      },
      input: { kind: "multi", options: [
        { label: "None", value: null },
        { label: "High blood pressure", value: "high blood pressure" },
        { label: "Heart condition", value: "a heart condition" },
        { label: "Diabetes", value: "diabetes" },
        { label: "Osteoporosis / low bone density", value: "low bone density" },
        { label: "Pregnant / postpartum", value: "pregnancy or postpartum recovery" },
        { label: "Other (I'll tell my coach)", value: "another condition" }
      ], done: "That's everything" },
      save: function (st, v) { st.conditions = (Array.isArray(v) ? v : []).filter(Boolean); }
    },
    {
      id: "training-age",
      say: function () { return "How long have you been lifting consistently? Be honest — the right starting point matters more than a flattering one."; },
      input: { kind: "chips", options: [
        { label: "Never / just starting", value: 0 },
        { label: "Under a year", value: 0.5 },
        { label: "1–3 years", value: 2 },
        { label: "3+ years", value: 5 },
        { label: "Trained before — coming back from a break", value: "returning" }
      ] },
      save: function (st, v) {
        if (v === "returning") { st.trainingAge = 1.5; st.returning = true; }
        else st.trainingAge = v;
      }
    },
    {
      id: "safety-brief",
      when: function (st) {
        return (st.age != null && (st.age < 18 || st.age >= 60)) ||
          (st.conditions && st.conditions.length > 0);
      },
      say: function (st) {
        var notes = OF.evidence.screenProfile({
          experience: { age: st.age },
          constraints: { conditions: st.conditions || [] }
        });
        return notes.map(function (n) { return n.text; }).join(" ");
      },
      input: { kind: "chips", options: [{ label: "Understood", value: true }] },
      save: function () {}
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
      id: "returning-pep",
      when: function (st) { return !!st.returning; },
      say: function () {
        return "Welcome back — muscle memory is real, so you'll regain old strength much faster than you built it. I'll start you a notch lighter than where you left off and ramp quickly; don't let ego pick the weights in week one.";
      },
      input: { kind: "chips", options: [{ label: "Deal", value: true }] },
      save: function () {}
    },
    {
      id: "weak-points",
      when: function (st) { return lvl(st) === "advanced" && !st.quick; },
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
      when: function (st) { return !st.quick; },
      say: function () { return "And how long can a session usually run?"; },
      input: { kind: "chips", options: [
        { label: "~30 min", value: 30 }, { label: "~45 min", value: 45 },
        { label: "~60 min", value: 60 }, { label: "75+ min", value: 75 }
      ] },
      save: function (st, v) { st.sessionMinutes = v; }
    },
    {
      id: "bodyweight",
      say: function () {
        var lb = OF.units && OF.units.weightUnit ? OF.units.weightUnit() === "lb" : true;
        return "What do you weigh right now (" + (lb ? "lb" : "kg") + ")? This unlocks your daily calorie, protein and water targets — without it the dashboard can't do its math.";
      },
      input: { kind: "text", placeholder: "e.g. 185", skip: "Skip for now" },
      save: function (st, v) {
        var n = v == null ? null : Number(String(v).replace(/[^0-9.]/g, ""));
        st.weightDisplay = (isFinite(n) && n > 0) ? n : null;
      }
    },
    {
      id: "split",
      when: function (st) { return !st.quick; },
      say: function (st) {
        var rec = st.days <= 3 ? (st.days <= 2 ? "full-body" : "full-body") : st.days === 4 ? "upper-lower" : "ppl";
        st.recommendedSplit = rec;
        var names = { "full-body": "Full body", "upper-lower": "Upper / Lower", "ppl": "Push / Pull / Legs" };
        return "How should I organize your week? In plain terms — Full body: everything each visit. Upper/Lower: top half one day, legs the next. Push/Pull/Legs: chest+shoulders day, back day, leg day. With " + st.days + " days I'd pick " + names[rec] + " for you (it hits each muscle twice a week, which is what the research cares about) — or just let me choose.";
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
      when: function (st) { return !st.quick; },
      say: function () {
        return "Last preference: do you like lifting HEAVY (few slow, hard reps), lighter with MORE reps (chasing the burn), or a mix? Both build muscle — this is purely about what you'll enjoy.";
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
      when: function (st) { return !st.quick; },
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
      when: function (st) { return lvl(st) !== "beginner" && !st.quick; },
      say: function () { return "Which lifts do you LOVE? I'll build around them — enjoying your program is the strongest predictor that you'll stick to it."; },
      input: { kind: "multi", options: COMMON_LIFTS.map(function (n) { return { label: n, value: n }; }), done: "Those are my favorites", skip: "No strong favorites" },
      save: function (st, v) { st.likes = v || []; }
    },
    {
      id: "dislikes",
      when: function (st) { return lvl(st) !== "beginner" && !st.quick; },
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
      say: function () { return "Any injuries or pain points I should program around? Pick ALL that apply. (If anything is sharp, worsening, or tingling/numb — please see a professional first; I coach training, not rehab.)"; },
      input: { kind: "multi", options: [
        { label: "All good", value: null },
        { label: "Knee", value: "knee" }, { label: "Shoulder", value: "shoulder" },
        { label: "Lower back", value: "lower back" }, { label: "Elbow/wrist", value: "elbow" },
        { label: "Hip", value: "hip" }, { label: "Neck", value: "neck" },
        { label: "Core / abdomen (incl. postpartum)", value: "core" },
        { label: "Something else", value: "other" }
      ], done: "That's all of them" },
      save: function (st, v) { st.injuryAreas = (Array.isArray(v) ? v : []).filter(Boolean); }
    },
    {
      id: "injury-patterns",
      when: function (st) { return !!(st.injuryAreas && st.injuryAreas.length); },
      say: function (st) {
        return "Which movements aggravate your " + st.injuryAreas.join(" / ") +
          "? Pick everything that hurts — I keep those patterns out entirely and we train around them. If you're not sure, pick the ones you'd rather avoid for now; you can never be too careful here.";
      },
      input: { kind: "multi", options: [
        { label: "Squatting", value: "squat" }, { label: "Lunges/split squats", value: "lunge" },
        { label: "Deadlifts/hinging", value: "hinge" }, { label: "Overhead pressing", value: "overhead" },
        { label: "Bench/push-ups/dips", value: "bench" }, { label: "Rows/pull-ups", value: "row" },
        { label: "Hard core work (crunches, leg raises)", value: "core" }
      ], done: "That covers it" },
      save: function (st, v) {
        var pats = v || [];
        // core/abdomen injuries imply the core pattern even if not ticked —
        // a postpartum tester found Core slots were literally unexcludable
        if (st.injuryAreas.indexOf("core") !== -1 && pats.indexOf("core") === -1) pats = pats.concat(["core"]);
        st.injuries = st.injuryAreas.map(function (a) { return { area: a, aggravates: pats }; });
      }
    },
    {
      id: "sleep",
      when: function (st) { return !st.quick; },
      say: function () { return "Almost done — recovery questions, because that's where the muscle is actually built. How much sleep do you typically get?"; },
      input: { kind: "chips", options: [
        { label: "Under 6h", value: 5.5 }, { label: "6–7h", value: 6.5 },
        { label: "7–8h", value: 7.5 }, { label: "8h+", value: 8.5 }
      ] },
      save: function (st, v) { st.sleepH = v; }
    },
    {
      id: "stress",
      when: function (st) { return !st.quick; },
      say: function () { return "Day-to-day stress level? High stress is a real recovery tax — I'll program accordingly, not judge."; },
      input: { kind: "chips", options: [
        { label: "Pretty chill", value: 2 }, { label: "Moderate", value: 3 }, { label: "High", value: 4 }
      ] },
      save: function (st, v) { st.stress = v; }
    },
    {
      id: "job",
      when: function (st) { return !st.quick; },
      say: function () { return "And your day job, movement-wise?"; },
      input: { kind: "chips", options: [
        { label: "Desk", value: "desk" }, { label: "On my feet", value: "onFeet" }, { label: "Physical work", value: "physical" }
      ] },
      save: function (st, v) { st.job = v; }
    },
    {
      id: "diet",
      when: function (st) { return !st.quick; },
      say: function () { return "Last one: any dietary restrictions or styles I should respect in nutrition advice?"; },
      input: { kind: "multi", options: [
        { label: "None", value: null }, { label: "Vegetarian", value: "vegetarian" },
        { label: "Vegan", value: "vegan" }, { label: "Halal", value: "halal" },
        { label: "Kosher", value: "kosher" }, { label: "Lactose-free", value: "lactose-free" },
        { label: "Gluten-free", value: "gluten-free" }
      ], done: "That's everything" },
      save: function (st, v) { st.restrictions = (v || []).filter(Boolean); }
    },
    {
      id: "anything-else",
      when: function (st) { return !st.quick; },   // quick path stays 30s; Settings card covers it
      say: function () { return "Anything else I should know that the buttons didn't cover? Type it in your own words — equipment quirks, schedule limits, exercises or foods you refuse, how you like to be coached. It becomes part of how I coach you (and you can edit it anytime in Settings)."; },
      input: { kind: "text", placeholder: "e.g. home gym only, mornings, hate burpees", skip: "Nothing else" },
      save: function (st, v) { if (v) st.freeNotes = String(v).slice(0, 300); }
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
    var appGoal = goalMap[st.goal] || "maintain";
    // SAFETY (evidence.js safety layer): never put an under-18 into a calorie
    // deficit — at that age food fuels growth. Training is still encouraged.
    if (st.age != null && st.age < 18 && appGoal === "cut") appGoal = "maintain";
    return {
      patch: {
        goals: {
          primary: st.goal,
          milestones: st.milestone ? [st.milestone] : [],
          timelineWeeks: st.timelineWeeks || null,
          appGoalType: appGoal
        },
        prefs: {
          split: st.split || null,
          daysPerWeek: st.days,
          sessionMinutes: st.sessionMinutes,
          style: st.style || null,
          cardio: st.cardio || null,
          likes: st.likes || [],
          dislikes: st.dislikes || [],
          notes: st.freeNotes || null
        },
        experience: {
          trainingAgeYears: st.trainingAge,
          level: lvl(st),
          age: st.age != null ? st.age : null,
          weakPoints: st.weakPoints && st.weakPoints.length ? st.weakPoints : null
        },
        constraints: {
          equipment: st.equipment,
          injuries: st.injuries || [],
          conditions: st.conditions && st.conditions.length ? st.conditions : []
        },
        recovery: {
          sleepTypicalH: st.sleepH,
          stress: st.stress,
          jobActivity: st.job,
          restrictions: st.restrictions || []
        }
      },
      appGoalType: appGoal
    };
  }

  /* ================= finish: persist + build the program ================= */

  function finish(st) {
    var m = toProfilePatch(st);   // (the minor-safety goal override lives in there)
    OF.profile.update(m.patch, "intake");

    // bodyweight answer → a Body record (in kg), so calorie/protein/water
    // targets work from day one instead of waiting for a weigh-in
    try {
      if (st.weightDisplay && OF.storage) {
        var kg = OF.units && OF.units.fromDisplayWeight
          ? Math.round(OF.units.fromDisplayWeight(st.weightDisplay) * 100) / 100
          : st.weightDisplay;
        if (kg >= 20 && kg <= 400 && !OF.storage.getAll("body").length) {
          OF.storage.add("body", { date: U.todayISO(), weightKg: kg,
            bodyFatPct: null, muscleMassPct: null, notes: "" });
        }
      }
    } catch (e) { /* weigh in later on the Body tab */ }

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
      lines.push("Your weekly training dose (working sets per muscle): " + vols + " — right in the research sweet spot for a " +
        program.coach2.level + ". We start moderate; your own results decide where it goes next.");
      lines.push(program.coach2.whys.effort.text);
      lines.push(program.coach2.whys.rest.text);
      if (program.coach2.injuryNotes && program.coach2.injuryNotes.length) {
        lines.push("Programmed around: " + program.coach2.injuryNotes.join("; ") + ".");
      }
    }
    if (program.coach2 && program.coach2.styleNote) lines.push(program.coach2.styleNote);
    if (program.coach2 && program.coach2.cardioNote) lines.push(program.coach2.cardioNote);
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
          '<button type="button" class="btn ghost mini" id="intake-close" aria-label="Close interview">Close</button></div>' +
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
        '<input type="text" id="intake-text" maxlength="300" placeholder="' + U.esc(inp.placeholder || "") + '" autocomplete="off">' +
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
    // a Back affordance appears once you're past the first question
    if (history.length > 0) {
      var host0 = document.getElementById("intake-input");
      if (host0 && !host0.querySelector("[data-intake-back]")) {
        var back = document.createElement("button");
        back.type = "button";
        back.className = "btn ghost mini intake-back";
        back.setAttribute("data-intake-back", "1");
        back.textContent = "\u2190 Back";
        back.addEventListener("click", goBack);
        host0.appendChild(back);
      }
    }
    // move focus to the first answer control — keyboard/screen-reader users
    // were dumped back at the top of the page after EVERY question
    var host = document.getElementById("intake-input");
    var first = host && host.querySelector("button, input");
    if (first) { try { first.focus(); } catch (e) {} }
    // keyboard animates in ~300ms later on iOS — re-pin the log then so the
    // question sits right above the input, no gap, not scrolled off the top
    setTimeout(syncViewport, 60);
    setTimeout(syncViewport, 360);
  }

  var history = [];   // {stepId, stateSnapshot} for the Back button

  function goBack() {
    if (!history.length) return;
    var prev = history.pop();
    state = prev.stateSnapshot;
    // drop the last coach question + user answer bubbles
    var log = document.getElementById("intake-log");
    if (log) { for (var k = 0; k < 2 && log.lastChild; k++) log.removeChild(log.lastChild); }
    var step = null;
    for (var i = 0; i < STEPS.length; i++) if (STEPS[i].id === prev.stepId) { step = STEPS[i]; break; }
    if (step) {
      // remove the re-asked question's coach bubble too (ask() re-adds it)
      if (log && log.lastChild) log.removeChild(log.lastChild);
      ask(step);
    }
  }

  function answer(value, label) {
    history.push({ stepId: curStep.id, stateSnapshot: JSON.parse(JSON.stringify(state)) });
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

  var lastFocus = null;

  function onOverlayKeydown(ev) {
    if (ev.key === "Escape") { close(); return; }
    if (ev.key !== "Tab") return;
    // focus trap: an aria-modal dialog must not leak focus to the page behind
    var o = document.getElementById("intake-overlay");
    var f = o ? o.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])') : [];
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  }

  function syncViewport() {
    var vv = window.visualViewport;
    var h = vv ? vv.height : window.innerHeight;
    document.documentElement.style.setProperty("--ivh", h + "px");
    var log = document.getElementById("intake-log");
    if (log) log.scrollTop = log.scrollHeight;   // keep the newest message visible
  }

  function start() {
    state = {};
    history = [];
    lastFocus = document.activeElement;
    var o = overlay();
    o.classList.add("open");
    o.addEventListener("keydown", onOverlayKeydown);
    // track the keyboard: the panel shrinks to the space above it and the
    // conversation stays scrolled to the question being answered
    syncViewport();
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", syncViewport);
      window.visualViewport.addEventListener("scroll", syncViewport);
    }
    var log = document.getElementById("intake-log");
    if (log) log.innerHTML = "";
    var input = document.getElementById("intake-input");
    input.removeEventListener("click", onInputClick);
    input.addEventListener("click", onInputClick);
    ask(STEPS[0]);
  }

  function close() {
    var o = document.getElementById("intake-overlay");
    if (o) {
      o.classList.remove("open");
      o.removeEventListener("keydown", onOverlayKeydown);
    }
    if (window.visualViewport) {
      window.visualViewport.removeEventListener("resize", syncViewport);
      window.visualViewport.removeEventListener("scroll", syncViewport);
    }
    document.documentElement.style.removeProperty("--ivh");
    curStep = null;
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }  // restore focus
    lastFocus = null;
  }

  return {
    start: start,
    close: close,
    // pure engine exports (tests)
    flow: { steps: STEPS, advance: advance, nextIdx: nextIdx, toProfilePatch: toProfilePatch, level: lvl }
  };
})();

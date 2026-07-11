/* ============================================================
   trainer.js — the "personal trainer" brain.

   Turns the app from a tracker into a coach that TELLS you what to
   do: a quick intake builds a structured training PROGRAM (split +
   exercises + set/rep schemes + starting loads), surfaces TODAY'S
   session, lets you start it (pre-loads the live logger), and
   AUTO-PROGRESSES your weights based on what you actually lifted
   (double progression). It reads the goal from OF.goals and seeds
   starting weights from your logged history (OF.strength).

   Pure-ish: all state in localStorage. Exposes data + a couple of
   render helpers; exercise.js calls back on session completion.

   Stored program (optimalfit.trainerProgram):
     { createdAt, updatedAt, split, daysPerWeek, goalType, experience,
       equipment, emphasis, pointer,
       days: [ { name, slots:[ { name, group, compound, sets, repLow,
                 repHigh, weightKg|null, incKg } ] } ] }
   Intake profile is stored in the same object's top-level fields.
   ============================================================ */

window.OF = window.OF || {};

OF.trainer = (function () {
  "use strict";
  var U = OF.util, S = OF.storage;
  var KEY = "optimalfit.trainerProgram";

  /* ---------------- exercise pool (name, group, equipment, compound, load step) ----------------
     equip tags: "gym" (barbell/machine), "db" (dumbbell), "cable", "bw" (bodyweight/home).
     A home/dumbbell user gets db/bw/cable picks; a full-gym user can get anything. */
  var POOL = [
    // Chest
    { name: "Bench Press", group: "Chest", equip: ["gym"], compound: true, incKg: 2.5 },
    { name: "Incline Bench Press", group: "Chest", equip: ["gym"], compound: true, incKg: 2.5 },
    { name: "Dumbbell Bench Press", group: "Chest", equip: ["db"], compound: true, incKg: 2 },
    { name: "Incline Dumbbell Press", group: "Chest", equip: ["db"], compound: true, incKg: 2 },
    { name: "Push-Up", group: "Chest", equip: ["bw"], compound: true, incKg: 0 },
    { name: "Dumbbell Fly", group: "Chest", equip: ["db"], compound: false, incKg: 2 },
    { name: "Cable Fly", group: "Chest", equip: ["cable"], compound: false, incKg: 2.5 },
    { name: "Dips (Chest)", group: "Chest", equip: ["bw"], compound: true, incKg: 0 },
    // Back
    { name: "Barbell Row", group: "Back", equip: ["gym"], compound: true, incKg: 2.5 },
    { name: "Deadlift", group: "Back", equip: ["gym"], compound: true, incKg: 5 },
    { name: "Pull-Up", group: "Back", equip: ["bw"], compound: true, incKg: 0 },
    { name: "Lat Pulldown", group: "Back", equip: ["cable"], compound: true, incKg: 2.5 },
    { name: "Seated Cable Row", group: "Back", equip: ["cable"], compound: true, incKg: 2.5 },
    { name: "Dumbbell Row", group: "Back", equip: ["db"], compound: true, incKg: 2 },
    { name: "Inverted Row", group: "Back", equip: ["bw"], compound: true, incKg: 0 },
    { name: "Face Pull", group: "Shoulders", equip: ["cable"], compound: false, incKg: 2.5 },
    // Shoulders
    { name: "Overhead Press", group: "Shoulders", equip: ["gym"], compound: true, incKg: 2.5 },
    { name: "Seated Dumbbell Press", group: "Shoulders", equip: ["db"], compound: true, incKg: 2 },
    { name: "Pike Push-Up", group: "Shoulders", equip: ["bw"], compound: true, incKg: 0 },
    { name: "Lateral Raise", group: "Shoulders", equip: ["db"], compound: false, incKg: 1 },
    { name: "Rear Delt Fly", group: "Shoulders", equip: ["db"], compound: false, incKg: 1 },
    // Legs
    { name: "Back Squat", group: "Legs", equip: ["gym"], compound: true, incKg: 5 },
    { name: "Front Squat", group: "Legs", equip: ["gym"], compound: true, incKg: 2.5 },
    { name: "Romanian Deadlift", group: "Legs", equip: ["gym"], compound: true, incKg: 2.5 },
    { name: "Leg Press", group: "Legs", equip: ["gym"], compound: true, incKg: 5 },
    { name: "Goblet Squat", group: "Legs", equip: ["db"], compound: true, incKg: 2 },
    { name: "Bulgarian Split Squat", group: "Legs", equip: ["db", "bw"], compound: true, incKg: 2 },
    { name: "Walking Lunge", group: "Legs", equip: ["db", "bw"], compound: true, incKg: 2 },
    { name: "Leg Curl", group: "Legs", equip: ["gym"], compound: false, incKg: 2.5 },
    { name: "Leg Extension", group: "Legs", equip: ["gym"], compound: false, incKg: 2.5 },
    { name: "Calf Raise", group: "Legs", equip: ["gym", "bw"], compound: false, incKg: 2.5 },
    { name: "Hip Thrust", group: "Legs", equip: ["gym"], compound: true, incKg: 5 },
    // Biceps
    { name: "Barbell Curl", group: "Biceps", equip: ["gym"], compound: false, incKg: 2.5 },
    { name: "Dumbbell Curl", group: "Biceps", equip: ["db"], compound: false, incKg: 1 },
    { name: "Hammer Curl", group: "Biceps", equip: ["db"], compound: false, incKg: 1 },
    { name: "Chin-Up", group: "Biceps", equip: ["bw"], compound: true, incKg: 0 },
    // Triceps
    { name: "Triceps Pushdown", group: "Triceps", equip: ["cable"], compound: false, incKg: 2.5 },
    { name: "Overhead Triceps Extension", group: "Triceps", equip: ["db", "cable"], compound: false, incKg: 2 },
    { name: "Close-Grip Bench Press", group: "Triceps", equip: ["gym"], compound: true, incKg: 2.5 },
    { name: "Dips (Triceps)", group: "Triceps", equip: ["bw"], compound: true, incKg: 0 },
    // Core
    { name: "Plank", group: "Core", equip: ["bw"], compound: false, incKg: 0, hold: true },
    { name: "Hanging Leg Raise", group: "Core", equip: ["bw"], compound: false, incKg: 0 },
    { name: "Cable Crunch", group: "Core", equip: ["cable"], compound: false, incKg: 2.5 },
    { name: "Russian Twist", group: "Core", equip: ["bw", "db"], compound: false, incKg: 1 }
  ];

  /* Which equip tags each equipment setting may use. */
  var EQUIP_ALLOW = {
    "full-gym": ["gym", "db", "cable", "bw"],
    "dumbbells": ["db", "bw"],
    "home-basic": ["db", "bw", "cable"],
    "bodyweight": ["bw"]
  };

  /* Day templates: ordered slots of { g: group, c: isCompound }. */
  var DAY = {
    push: { name: "Push", slots: [["Chest", 1], ["Shoulders", 1], ["Chest", 0], ["Triceps", 0], ["Shoulders", 0], ["Triceps", 0]] },
    pull: { name: "Pull", slots: [["Back", 1], ["Back", 1], ["Back", 0], ["Biceps", 0], ["Biceps", 0], ["Core", 0]] },
    legs: { name: "Legs", slots: [["Legs", 1], ["Legs", 1], ["Legs", 0], ["Legs", 0], ["Core", 0]] },
    upper: { name: "Upper", slots: [["Chest", 1], ["Back", 1], ["Shoulders", 1], ["Chest", 0], ["Back", 0], ["Triceps", 0], ["Biceps", 0]] },
    lower: { name: "Lower", slots: [["Legs", 1], ["Legs", 1], ["Legs", 0], ["Legs", 0], ["Core", 0]] },
    fullA: { name: "Full Body A", slots: [["Legs", 1], ["Chest", 1], ["Back", 1], ["Shoulders", 0], ["Core", 0]] },
    fullB: { name: "Full Body B", slots: [["Legs", 1], ["Back", 1], ["Chest", 1], ["Biceps", 0], ["Triceps", 0]] },
    fullC: { name: "Full Body C", slots: [["Legs", 1], ["Shoulders", 1], ["Back", 1], ["Chest", 0], ["Core", 0]] }
  };
  var SPLITS = {
    2: { name: "Full Body (2×/wk)", days: ["fullA", "fullB"] },
    3: { name: "Full Body (3×/wk)", days: ["fullA", "fullB", "fullC"] },
    4: { name: "Upper / Lower", days: ["upper", "lower", "upper", "lower"] },
    5: { name: "Push / Pull / Legs + Upper / Lower", days: ["push", "pull", "legs", "upper", "lower"] },
    6: { name: "Push / Pull / Legs (6×/wk)", days: ["push", "pull", "legs", "push", "pull", "legs"] }
  };

  var SESSION_CAP = { 30: 4, 45: 5, 60: 6, 75: 7 };  // exercises per session by minutes

  /* ---------------- storage ---------------- */
  function load() {
    try { var raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  }
  function save(p) {
    try { localStorage.setItem(KEY, JSON.stringify(p)); return true; } catch (e) { return false; }
  }
  function hasProgram() { var p = load(); return !!(p && Array.isArray(p.days) && p.days.length); }

  /* Running tally of the value the trainer has delivered (for the dashboard
     value strip / trial-conversion nudge). */
  var STATS_KEY = "optimalfit.trainerStats";
  function stats() { try { return JSON.parse(localStorage.getItem(STATS_KEY) || "{}") || {}; } catch (e) { return {}; } }
  function bumpStat(key, n) {
    var s = stats(); s[key] = (s[key] || 0) + (n || 1);
    try { localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch (e) {}
  }
  function getStats() { return stats(); }

  /* ---------------- helpers ---------------- */
  function goalType() {
    try { var g = OF.goals && OF.goals.activeGoal ? OF.goals.activeGoal() : null; return g ? g.type : null; }
    catch (e) { return null; }
  }

  /** rep scheme for a slot given the goal + whether it's a compound. */
  function scheme(gt, compound) {
    if (gt === "performance") return compound ? { sets: 4, lo: 4, hi: 6 } : { sets: 3, lo: 6, hi: 10 };
    if (gt === "cut" || gt === "maintain") return compound ? { sets: 3, lo: 6, hi: 10 } : { sets: 3, lo: 10, hi: 15 };
    // lean-bulk / recomp / default → hypertrophy
    return compound ? { sets: 4, lo: 6, hi: 10 } : { sets: 3, lo: 10, hi: 15 };
  }

  /** Best recent working weight for an exercise from logged history (kg), or null. */
  function historyWeight(name) {
    try {
      var arr = S.getAll("exercise").slice().sort(U.byNewest);
      var target = name.toLowerCase();
      for (var i = 0; i < arr.length; i++) {
        var exs = arr[i].exercises;
        if (!Array.isArray(exs)) continue;
        for (var j = 0; j < exs.length; j++) {
          if (exs[j] && String(exs[j].name).toLowerCase() === target && Array.isArray(exs[j].sets)) {
            var w = null;
            exs[j].sets.forEach(function (s) {
              var v = Number(s.weightKg);
              if (isFinite(v) && v > 0 && (w == null || v > w)) w = v;
            });
            if (w != null) return w;
          }
        }
      }
    } catch (e) {}
    return null;
  }

  /* ---------------- program generation ---------------- */
  function generate(profile) {
    var gt = goalType();
    var allow = EQUIP_ALLOW[profile.equipment] || EQUIP_ALLOW["full-gym"];
    var split = SPLITS[profile.daysPerWeek] || SPLITS[3];
    var cap = SESSION_CAP[profile.sessionMinutes] || 6;
    var emphasis = profile.emphasis || null;   // a muscle-group string or null

    // per-group rotating index so repeated days pick DIFFERENT exercises
    var rot = {};
    function pick(group, compound, usedLower) {
      var cands = POOL.filter(function (p) {
        return p.group === group && (compound ? p.compound : true) &&
          p.equip.some(function (t) { return allow.indexOf(t) !== -1; }) &&
          !usedLower[p.name.toLowerCase()];
      });
      // prefer compounds for compound slots; if none, relax to any in-group
      if (!cands.length) {
        cands = POOL.filter(function (p) {
          return p.group === group && p.equip.some(function (t) { return allow.indexOf(t) !== -1; }) &&
            !usedLower[p.name.toLowerCase()];
        });
      }
      if (!cands.length) return null;
      var idx = (rot[group + compound] = (rot[group + compound] || 0)) % cands.length;
      rot[group + compound]++;
      return cands[idx];
    }

    var days = split.days.map(function (key) {
      var tmpl = DAY[key];
      var slots = tmpl.slots.slice();
      // emphasis: append an extra accessory slot for the priority group(s)
      var emGroups = emphasis === "Arms" ? ["Triceps", "Biceps"] : (emphasis ? [emphasis] : []);
      emGroups.forEach(function (eg) {
        if (slots.some(function (s) { return s[0] === eg; })) slots.push([eg, 0]);
      });
      var used = {}, exercises = [];
      for (var i = 0; i < slots.length && exercises.length < cap; i++) {
        var ex = pick(slots[i][0], slots[i][1] === 1, used);
        if (!ex) continue;
        used[ex.name.toLowerCase()] = true;
        var sc = scheme(gt, ex.compound);
        var isHold = !!ex.hold;
        var w = isHold ? null : historyWeight(ex.name);
        exercises.push({
          name: ex.name, group: ex.group, compound: ex.compound, hold: isHold,
          sets: isHold ? 3 : sc.sets,
          repLow: isHold ? 30 : sc.lo,       // holds: seconds, not reps
          repHigh: isHold ? 60 : sc.hi,
          weightKg: w, incKg: ex.incKg
        });
      }
      return { name: tmpl.name, slots: exercises };
    });

    var now = new Date().toISOString();
    return {
      createdAt: now, updatedAt: now,
      // store the ACTUAL number of days generated, not the raw request: an
      // out-of-range daysPerWeek (e.g. 7) falls back to SPLITS[3] above, and the
      // stored field / "N days/wk" string must match the real split.
      split: split.name, daysPerWeek: split.days.length, goalType: gt,
      experience: profile.experience, equipment: profile.equipment,
      sessionMinutes: profile.sessionMinutes, emphasis: emphasis,
      pointer: 0, days: days
    };
  }

  function createProgram(profile) { var p = generate(profile); save(p); return p; }
  function regenerate() {
    var p = load(); if (!p) return null;
    return createProgram({
      daysPerWeek: p.daysPerWeek, equipment: p.equipment, experience: p.experience,
      sessionMinutes: p.sessionMinutes, emphasis: p.emphasis
    });
  }

  /* ---------------- today's session ---------------- */
  function nextSession() {
    var p = load();
    if (!p || !p.days.length) return null;
    var idx = ((p.pointer % p.days.length) + p.days.length) % p.days.length;
    return { dayIndex: idx, name: p.days[idx].name, exercises: p.days[idx].slots, program: p };
  }

  /** prescription text for one exercise, e.g. "3×6–10 @ 60 kg". */
  function prescription(ex) {
    if (ex.hold) {
      var s = ex.repLow === ex.repHigh ? String(ex.repLow) : ex.repLow + "–" + ex.repHigh;
      return ex.sets + "×" + s + "s hold";
    }
    var reps = ex.repLow === ex.repHigh ? String(ex.repLow) : ex.repLow + "–" + ex.repHigh;
    var load;
    if (ex.weightKg != null) load = " @ " + U.fmtWeight(ex.weightKg, 1);
    else if (ex.incKg === 0) load = " · bodyweight";
    else load = " · start ~2 reps shy of failure";   // concrete cue for a first-time/no-history lift
    return ex.sets + "×" + reps + load;
  }

  /** Builder-shaped exercises for exercise.js to preload the live logger. */
  function sessionForLogger(dayIndex) {
    var p = load();
    if (!p || !p.days[dayIndex]) return [];
    return p.days[dayIndex].slots.map(function (ex) {
      var sets = [];
      for (var i = 0; i < ex.sets; i++) {
        sets.push({
          weightKg: ex.weightKg != null ? ex.weightKg : null,
          // prefill the FLOOR of the range — the user edits up to what they
          // actually hit, so an untouched session never auto-adds weight.
          reps: ex.repLow
        });
      }
      return { name: ex.name, sets: sets };
    });
  }

  /** Adapt today's session to real life (advisory — never mutates stored plan):
        "time"   → compounds first, ≤4 exercises, ≤3 sets
        "travel" → swap gym lifts to a bodyweight/dumbbell alternative
        "sore"   → ~10% lighter + one fewer set per exercise
     Returns builder-shaped exercises for the live logger. */
  function adaptSession(dayIndex, mode) {
    var p = load();
    if (!p || !p.days[dayIndex]) return [];
    var slots = p.days[dayIndex].slots.slice();
    if (mode === "time") {
      slots = slots.slice().sort(function (a, b) { return (b.compound ? 1 : 0) - (a.compound ? 1 : 0); }).slice(0, 4);
    }
    // Reserve every name already in the day so a travel swap can never collide
    // into a duplicate (usedAlt tracks both originals kept and alternatives added).
    var usedAlt = {};
    slots.forEach(function (s) { usedAlt[s.name.toLowerCase()] = true; });
    return slots.map(function (ex) {
      var name = ex.name, weightKg = ex.weightKg, sets = ex.sets;
      if (mode === "time") sets = Math.min(3, sets);
      if (mode === "sore") { sets = Math.max(2, sets - 1); if (weightKg != null) weightKg = Math.round(weightKg * 0.9 * 100) / 100; }
      if (mode === "travel" && !ex.hold) {
        var self = POOL.filter(function (pp) { return pp.name === ex.name; })[0];
        var portable = self && self.equip.some(function (t) { return t === "bw" || t === "db"; });
        if (!portable) {                                    // db/bw moves already travel — only swap gym-only lifts
          var alt = POOL.filter(function (pp) {
            return pp.group === ex.group && !pp.hold &&      // never swap a rep lift to a timed hold (would be mis-prescribed in reps)
              !usedAlt[pp.name.toLowerCase()] &&             // fresh only — no duplicate
              pp.equip.some(function (t) { return t === "bw" || t === "db"; });
          })[0];
          if (alt) { usedAlt[alt.name.toLowerCase()] = true; name = alt.name; weightKg = null; }  // let the user set the load
        }
      }
      var arr = [];
      for (var i = 0; i < sets; i++) arr.push({ weightKg: weightKg != null ? weightKg : null, reps: ex.repLow });
      return { name: name, sets: arr };
    });
  }

  /* ---------------- auto-progression (double progression) ----------------
     When a program session is completed, compare what was logged to the
     prescription: if every working set hit the top of the rep range at the
     target weight, add one load increment for next time. Then advance to the
     next day in the split. Called by exercise.js on save. */
  function completeSession(dayIndex, loggedExercises) {
    var p = load();
    if (!p || !p.days[dayIndex]) return;
    var byName = {};
    (loggedExercises || []).forEach(function (ex) {
      if (ex && ex.name) byName[String(ex.name).toLowerCase()] = ex.sets || [];
    });
    // TOL covers the lb display round-trip (kg→0.1 lb→kg loses up to ~0.023 kg),
    // so a set logged at the prescribed weight isn't wrongly seen as lighter.
    var TOL = 0.05;
    var changes = [];   // per-lift outcome, for the post-session recap
    p.days[dayIndex].slots.forEach(function (ex) {
      if (ex.incKg <= 0 || ex.weightKg == null) return;   // bodyweight / no baseline: nothing to bump
      var logged = byName[ex.name.toLowerCase()];
      if (!logged || !logged.length) return;
      // "working" sets = performed AT OR ABOVE the target weight
      var working = logged.filter(function (s) {
        return isFinite(Number(s.weightKg)) && Number(s.weightKg) >= ex.weightKg - TOL && Number(s.reps) >= 1;
      });
      // Not enough sets at target (went lighter / did fewer): hold, don't count a fail.
      if (working.length < ex.sets) return;
      // Judge the BEST ex.sets by reps (order-independent). A set logged ABOVE
      // target weight always satisfies the rep target (they lifted more).
      var byReps = working.slice().sort(function (a, b) { return Number(b.reps) - Number(a.reps); }).slice(0, ex.sets);
      function over(s) { return Number(s.weightKg) > ex.weightKg + TOL; }
      var allHitTop = byReps.every(function (s) { return over(s) || Number(s.reps) >= ex.repHigh; });
      var hitFloor = byReps.every(function (s) { return over(s) || Number(s.reps) >= ex.repLow; });
      var from = ex.weightKg;
      if (allHitTop) {                                    // smashed it → add weight (double progression)
        var maxKg = byReps.reduce(function (m, s) { return Math.max(m, Number(s.weightKg)); }, ex.weightKg);
        ex.weightKg = Math.round((maxKg + ex.incKg) * 100) / 100; ex.fails = 0;
        changes.push({ name: ex.name, kind: "added", from: from, to: ex.weightKg });
      } else if (!hitFloor) {                             // hit the weight but missed the minimum reps
        ex.fails = (ex.fails || 0) + 1;
        if (ex.fails >= 2) {                              // stalled twice → deload ~10% and rebuild
          ex.weightKg = Math.round(ex.weightKg * 0.9 * 100) / 100; ex.fails = 0;
          changes.push({ name: ex.name, kind: "deloaded", from: from, to: ex.weightKg });
        } else {
          changes.push({ name: ex.name, kind: "held", to: ex.weightKg });
        }
      } else { ex.fails = 0; changes.push({ name: ex.name, kind: "held", to: ex.weightKg }); }
    });
    // if a WEIGHTED exercise had no baseline yet, seed it from what was just
    // logged (skip bodyweight/hold moves so they stay bodyweight).
    p.days[dayIndex].slots.forEach(function (ex) {
      if (ex.weightKg != null || ex.incKg <= 0) return;
      var logged = byName[ex.name.toLowerCase()];
      if (!logged) return;
      var w = null;
      logged.forEach(function (s) { var v = Number(s.weightKg); if (isFinite(v) && v > 0 && (w == null || v > w)) w = v; });
      if (w != null) { ex.weightKg = w; changes.push({ name: ex.name, kind: "seeded", to: w }); }
    });
    changes.forEach(function (c) { if (c.kind === "added") bumpStat("bumps"); else if (c.kind === "deloaded") bumpStat("deloads"); });
    bumpStat("sessions");
    // advance from the day just trained (not a possibly-skipped pointer)
    p.pointer = (dayIndex + 1) % p.days.length;
    p.updatedAt = new Date().toISOString();
    save(p);
    var ns = nextSession();
    return { changes: changes, nextName: ns ? ns.name : null };
  }

  /** Advance the split without progressing (e.g. a freeform/rest choice). */
  function skipDay() {
    var p = load(); if (!p) return;
    p.pointer = (p.pointer + 1) % p.days.length; save(p);
  }

  /* ---------------- compact block for the AI coach ---------------- */
  function coachContext() {
    var p = load();
    if (!p || !p.days.length) return null;
    var ns = nextSession();
    return {
      split: p.split, daysPerWeek: p.daysPerWeek, goalType: goalType() || p.goalType,
      equipment: p.equipment, experience: p.experience,
      todaySession: ns ? {
        name: ns.name,
        exercises: ns.exercises.map(function (ex) { return ex.name + " " + prescription(ex); })
      } : null
    };
  }

  /* ============================================================
     UI — dashboard "Today's session" card + intake / program modals
     ============================================================ */
  var els = {}, intake = {};
  function e(s) { return U.esc(s); }

  /* A trainer reads your recovery. Returns { cls, text } or null. */
  function recoveryNote() {
    var today = U.todayISO();
    var trainedToday = false;
    try {
      trainedToday = S.getAll("exercise").some(function (r) { return r.date === today; });
    } catch (x) {}
    if (trainedToday) {
      return { cls: "tr-note-good", text: "You’ve already trained today — nice. Today’s plan is here whenever you want it, or take the recovery." };
    }
    var r = null;
    try {
      if (OF.engine && OF.engine.analyzeAll) {
        r = OF.engine.analyzeAll({ sleep: S.getAll("sleep"), food: S.getAll("food"),
          exercise: S.getAll("exercise"), body: S.getAll("body") }).readiness;
      }
    } catch (x) {}
    if (!r || r.status !== "ok") return null;
    if (r.level === "low") {
      return { cls: "tr-note-warn", text: "Your readiness is low today (" + r.score + "/100) — keep it lighter, drop a set or two, or take a rest day. Your call." };
    }
    if (r.level === "high") {
      return { cls: "tr-note-good", text: "You’re well recovered (" + r.score + "/100) — let’s make today count." };
    }
    return null;
  }

  /* ---- dashboard card ---- */
  function renderCard() {
    els.card = document.getElementById("dash-trainer");
    if (!els.card) return;
    if (!hasProgram()) {
      els.card.innerHTML =
        '<div class="card trainer-cta">' +
          '<div class="trainer-cta-badge">' + OF.icons.get("dumbbell") + '</div>' +
          '<div class="trainer-cta-main">' +
            '<h2>Your personal trainer</h2>' +
            '<p class="muted small">Answer a few questions and I’ll build you a full training program — ' +
            'then tell you exactly what to do each day and add weight for you as you get stronger.</p>' +
            '<button type="button" class="btn primary" data-tr="setup">Build my program</button>' +
          '</div>' +
        '</div>';
      return;
    }
    var ns = nextSession();
    var rows = ns.exercises.map(function (ex) {
      return '<div class="tr-ex"><span class="tr-ex-name">' + e(ex.name) + '</span>' +
        '<span class="tr-ex-rx">' + e(prescription(ex)) + '</span></div>';
    }).join("");
    var p = ns.program;
    var note = recoveryNote();
    els.card.innerHTML =
      '<div class="card trainer-today">' +
        '<div class="tr-head">' +
          '<div><div class="tr-kicker">Today’s session</div>' +
          '<h2 class="tr-title">' + e(ns.name) + '</h2></div>' +
          '<span class="tr-daychip">Day ' + (ns.dayIndex + 1) + '/' + p.days.length + '</span>' +
        '</div>' +
        (note ? '<p class="tr-recovery ' + note.cls + '">' + e(note.text) + '</p>' : '') +
        '<div class="tr-exlist">' + rows + '</div>' +
        '<div class="tr-actions">' +
          '<button type="button" class="btn primary tr-start" data-tr="start">Start this workout</button>' +
          '<button type="button" class="btn ghost" data-tr="program">Program</button>' +
          '<button type="button" class="btn ghost mini" data-tr="skip" title="Skip to the next day">Skip</button>' +
        '</div>' +
        '<div class="tr-adapt"><span class="tr-adapt-lbl">Adjust for today:</span>' +
          '<button type="button" class="btn mini" data-tr="adapt" data-mode="time">Short on time</button>' +
          '<button type="button" class="btn mini" data-tr="adapt" data-mode="travel">Traveling</button>' +
          '<button type="button" class="btn mini" data-tr="adapt" data-mode="sore">Sore / low energy</button>' +
        '</div>' +
      '</div>';
  }

  /* ---- generic modal ---- */
  function modal(title, bodyHtml, footHtml) {
    var m = document.getElementById("trainer-modal");
    if (!m) {
      m = document.createElement("div");
      m.id = "trainer-modal"; m.className = "metric-modal"; m.hidden = true;
      document.body.appendChild(m);
      m.addEventListener("click", function (ev) {
        if (ev.target.closest("[data-tr-close]")) closeModal();
      });
    }
    m.innerHTML = '<div class="metric-modal-backdrop" data-tr-close></div>' +
      '<div class="metric-modal-panel" role="dialog" aria-modal="true">' +
      '<div class="metric-modal-head"><h2>' + e(title) + '</h2>' +
      '<button type="button" class="metric-modal-close" data-tr-close aria-label="Close">&times;</button></div>' +
      '<div class="tr-modal-body">' + bodyHtml + '</div>' +
      (footHtml ? '<div class="tr-modal-foot">' + footHtml + '</div>' : '') + '</div>';
    m.hidden = false; document.body.classList.add("metric-modal-open");
    return m;
  }
  function closeModal() {
    var m = document.getElementById("trainer-modal");
    if (m) m.hidden = true;
    document.body.classList.remove("metric-modal-open");
  }

  /* ---- intake ---- */
  var Q = [
    { key: "daysPerWeek", label: "How many days a week can you train?", opts: [[2, "2"], [3, "3"], [4, "4"], [5, "5"], [6, "6"]] },
    { key: "equipment", label: "What do you have to train with?", opts: [["full-gym", "Full gym"], ["dumbbells", "Dumbbells"], ["home-basic", "Home setup"], ["bodyweight", "Bodyweight only"]] },
    { key: "sessionMinutes", label: "How long is a session?", opts: [[30, "30 min"], [45, "45 min"], [60, "60 min"], [75, "75 min"]] },
    { key: "experience", label: "Your lifting experience?", opts: [["beginner", "Beginner"], ["intermediate", "Intermediate"], ["advanced", "Advanced"]] },
    { key: "emphasis", label: "Anything to prioritise? (optional)", opts: [["", "Balanced"], ["Chest", "Chest"], ["Back", "Back"], ["Shoulders", "Shoulders"], ["Arms", "Arms"], ["Legs", "Legs"]] }
  ];
  function intakeBody() {
    return Q.map(function (q) {
      var pills = q.opts.map(function (o) {
        var on = String(intake[q.key]) === String(o[0]);
        return '<button type="button" class="tr-pill' + (on ? " on" : "") +
          '" data-tr-q="' + q.key + '" data-tr-v="' + e(String(o[0])) + '">' + e(o[1]) + '</button>';
      }).join("");
      return '<div class="tr-q"><div class="tr-q-label">' + e(q.label) + '</div><div class="tr-q-pills">' + pills + '</div></div>';
    }).join("");
  }
  function openIntake() {
    var p = load();
    intake = {
      daysPerWeek: p ? p.daysPerWeek : 3, equipment: p ? p.equipment : "full-gym",
      sessionMinutes: p ? p.sessionMinutes : 60, experience: p ? p.experience : "intermediate",
      emphasis: p ? (p.emphasis || "") : ""
    };
    var gt = goalType();
    var goalNote = gt ? '' :
      '<p class="tr-note">Tip: set a goal on the Insights tab first (build muscle, get stronger, cut…) and I’ll tailor the rep ranges to it.</p>';
    modal("Build my program", goalNote + intakeBody(),
      '<button type="button" class="btn primary" data-tr="generate">Generate my program</button>');
  }

  /* ---- program view ---- */
  function openProgram() {
    var p = load();
    if (!p) { openIntake(); return; }
    var daysHtml = p.days.map(function (d, i) {
      var rows = d.slots.map(function (ex) {
        return '<div class="tr-ex"><span class="tr-ex-name">' + e(ex.name) + '</span>' +
          '<span class="tr-ex-rx">' + e(prescription(ex)) + '</span></div>';
      }).join("");
      var isNext = (p.pointer % p.days.length) === i;
      return '<div class="tr-progday' + (isNext ? " tr-next" : "") + '">' +
        '<div class="tr-progday-head">' + e(d.name) + (isNext ? ' <span class="tr-nextchip">next</span>' : '') + '</div>' +
        rows + '</div>';
    }).join("");
    var meta = '<p class="muted small">' + e(p.split) + ' · ' + p.daysPerWeek + ' days/wk · ' +
      e(p.equipment.replace("-", " ")) + (p.goalType ? ' · goal: ' + e(p.goalType) : '') + '</p>';
    modal("Your program", meta + daysHtml,
      '<button type="button" class="btn" data-tr="setup">Adjust / rebuild</button>');
  }

  /* ---- start today's workout (hand off to the live logger) ---- */
  function startToday(mode) {
    var ns = nextSession();
    if (!ns) return;
    var exercises = mode ? adaptSession(ns.dayIndex, mode) : sessionForLogger(ns.dayIndex);
    var label = ns.name + (mode === "time" ? " (quick)" : mode === "travel" ? " (travel)" : mode === "sore" ? " (light)" : "");
    if (OF.exercise && OF.exercise.startPrescribed) {
      OF.exercise.startPrescribed(exercises, ns.dayIndex, label);
    }
    location.hash = "#exercise";
  }

  /* ---- click handling ---- */
  function onClick(ev) {
    var b = ev.target.closest && ev.target.closest("[data-tr]");
    if (b) {
      var act = b.getAttribute("data-tr");
      if (act === "setup") { openIntake(); return; }
      if (act === "program") { openProgram(); return; }
      if (act === "start") { closeModal(); startToday(); return; }
      if (act === "adapt") { closeModal(); startToday(b.getAttribute("data-mode")); return; }
      if (act === "skip") { skipDay(); renderCard(); return; }
      if (act === "generate") {
        createProgram(intake); closeModal(); renderCard();
        return;
      }
    }
    var q = ev.target.closest && ev.target.closest("[data-tr-q]");
    if (q) {
      var key = q.getAttribute("data-tr-q"), v = q.getAttribute("data-tr-v");
      intake[key] = (key === "daysPerWeek" || key === "sessionMinutes") ? parseInt(v, 10) : v;
      // re-render just this question's pills
      Array.prototype.forEach.call(q.parentNode.children, function (c) {
        c.classList.toggle("on", c.getAttribute("data-tr-v") === v);
      });
    }
  }

  function init() {
    document.addEventListener("click", onClick);
    renderCard();
  }
  function refresh() { renderCard(); }

  return {
    init: init,
    refresh: refresh,
    renderCard: renderCard,
    hasProgram: hasProgram,
    load: load,
    createProgram: createProgram,
    regenerate: regenerate,
    nextSession: nextSession,
    prescription: prescription,
    sessionForLogger: sessionForLogger,
    adaptSession: adaptSession,
    completeSession: completeSession,
    getStats: getStats,
    bumpStat: bumpStat,
    skipDay: skipDay,
    coachContext: coachContext,
    EQUIP_ALLOW: EQUIP_ALLOW,
    SPLITS: SPLITS
  };
})();

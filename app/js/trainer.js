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

  /* ================= Coach 2.0 — profile-aware programming =================
     When a User Coaching Profile exists (OF.profile, written by the intake
     interview), generation upgrades: split honors the user's preference,
     injuries exclude whole movement patterns, hated lifts never appear,
     liked lifts are preferred, and weekly per-muscle sets are shaped to the
     evidence-based range for their training level (OF.evidence) — starting
     moderate and letting the learning loop (OF.learn) nudge from there.
     Without a profile, generation is EXACTLY the legacy path. */

  /* movement pattern → exercises it loads (for injury filtering) */
  var PATTERN_RULES = {
    "squat":    ["Back Squat", "Front Squat", "Goblet Squat", "Leg Press", "Bulgarian Split Squat", "Walking Lunge", "Leg Extension"],
    "hinge":    ["Deadlift", "Romanian Deadlift", "Hip Thrust"],
    "overhead": ["Overhead Press", "Seated Dumbbell Press", "Pike Push-Up", "Overhead Triceps Extension"],
    "bench":    ["Bench Press", "Incline Bench Press", "Dumbbell Bench Press", "Incline Dumbbell Press", "Push-Up", "Dips (Chest)", "Close-Grip Bench Press", "Dips (Triceps)", "Dumbbell Fly", "Cable Fly"],
    "row":      ["Barbell Row", "Dumbbell Row", "Seated Cable Row", "Inverted Row", "Pull-Up", "Lat Pulldown", "Chin-Up", "Face Pull"],
    "lunge":    ["Bulgarian Split Squat", "Walking Lunge"],
    // core: high-pressure trunk work — a postpartum tester found the Core slot
    // was literally unexcludable (every day template hard-codes one)
    "core":     ["Hanging Leg Raise", "Cable Crunch", "Russian Twist", "Plank"]
  };
  var MAJOR_GROUPS = ["Chest", "Back", "Legs", "Shoulders", "Biceps", "Triceps"];

  function splitName(pref, n) {
    var base = pref === "ppl" ? "Push / Pull / Legs" : pref === "upper-lower" ? "Upper / Lower" : "Full Body";
    return base + " (" + n + "\u00d7/wk)";
  }

  /** Split-preference → DAY-template keys for the available days (null = legacy). */
  function splitKeysFor(pref, days) {
    if (pref === "ppl") {
      if (days <= 3) return ["push", "pull", "legs"];
      if (days === 4) return ["push", "pull", "legs", "upper"];
      if (days === 5) return ["push", "pull", "legs", "upper", "lower"];
      return ["push", "pull", "legs", "push", "pull", "legs"];
    }
    if (pref === "upper-lower") {
      if (days <= 2) return ["upper", "lower"];
      if (days === 3) return ["upper", "lower", "fullA"];
      if (days === 4) return ["upper", "lower", "upper", "lower"];
      if (days === 5) return ["upper", "lower", "upper", "lower", "fullA"];
      return ["upper", "lower", "upper", "lower", "upper", "lower"];
    }
    if (pref === "full-body") {
      if (days <= 2) return ["fullA", "fullB"];
      if (days === 3) return ["fullA", "fullB", "fullC"];
      return ["fullA", "fullB", "fullC", "fullA"].slice(0, Math.min(days, 4));
    }
    return null;
  }

  /** Read the Coach-2.0 profile into generation inputs (null = legacy path). */
  function coach2Inputs() {
    try {
      if (!OF.profile || !OF.profile.exists() || !OF.evidence) return null;
      var d = OF.profile.get();
      var level = OF.profile.level() || "intermediate";
      var avoidExtra = OF.profile.dislikedExercises();
      var injuryNotes = [];
      (d.constraints.injuries || []).forEach(function (inj) {
        (inj.aggravates || []).forEach(function (pat) {
          var names = PATTERN_RULES[pat];
          if (names) {
            names.forEach(function (n) { avoidExtra.push(n.toLowerCase()); });
            injuryNotes.push(inj.area + " → no " + pat + " pattern");
          } else {
            avoidExtra.push(String(pat).toLowerCase());   // a specific exercise name
          }
        });
      });
      return {
        level: level,
        likes: OF.profile.likedExercises(),
        avoidExtra: avoidExtra,
        splitPref: d.prefs.split || null,
        injuryNotes: injuryNotes,
        style: d.prefs.style || null,
        cardio: d.prefs.cardio || null
      };
    } catch (e) { return null; }
  }

  /** Weekly hard sets per muscle group across the whole split. */
  function weeklySetsByGroup(days) {
    var out = {};
    days.forEach(function (day) {
      day.slots.forEach(function (ex) {
        if (ex.hold) return;
        out[ex.group] = (out[ex.group] || 0) + ex.sets;
      });
    });
    return out;
  }

  /** Shape per-group weekly sets into the evidence band (start moderate;
      the learning loop's stored target wins once it exists). Mutates days.
      Returns { perGroup: {group: {sets, target}} } for the why block. */
  function volumeShape(days, c2) {
    var band = OF.evidence.volumeBand(c2.level);
    var report = {};
    MAJOR_GROUPS.forEach(function (g) {
      var have = weeklySetsByGroup(days)[g] || 0;
      if (!have) return;                       // split doesn't train it directly
      var target = (OF.learn && OF.learn.volumeTarget ? OF.learn.volumeTarget(g) : null) ||
        OF.evidence.volumeStart(c2.level);
      target = Math.max(band[0], Math.min(band[1], target));
      var guard = 40;
      while (have < target && guard-- > 0) {
        // bump an accessory (isolation, non-hold) set for this group;
        // spread across days: pick the day with the fewest sets for g
        var best = null;
        days.forEach(function (day) {
          day.slots.forEach(function (ex) {
            if (ex.group !== g || ex.hold || ex.compound || ex.sets >= 5) return;
            if (!best || ex.sets < best.sets) best = ex;
          });
        });
        if (!best) {
          days.forEach(function (day) {        // no accessory: allow compounds to 5
            day.slots.forEach(function (ex) {
              if (ex.group !== g || ex.hold || ex.sets >= 5) return;
              if (!best || ex.sets < best.sets) best = ex;
            });
          });
        }
        if (!best) break;
        best.sets += 1; have += 1;
      }
      while (have > band[1] && guard-- > 0) {
        var worst = null;
        days.forEach(function (day) {          // accessories first (min 2 sets)
          day.slots.forEach(function (ex) {
            if (ex.group !== g || ex.hold || ex.compound || ex.sets <= 2) return;
            if (!worst || ex.sets > worst.sets) worst = ex;
          });
        });
        if (!worst) {
          days.forEach(function (day) {        // then compounds (min 3 sets)
            day.slots.forEach(function (ex) {
              if (ex.group !== g || ex.hold || !ex.compound || ex.sets <= 3) return;
              if (!worst || ex.sets > worst.sets) worst = ex;
            });
          });
        }
        if (!worst) break;
        worst.sets -= 1; have -= 1;
      }
      report[g] = { sets: have, target: target };
    });
    return { perGroup: report, band: band };
  }


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

  /** rep scheme for a slot given the goal + whether it's a compound.
      `style` ("heavy"|"pump"|"mixed") is the user's stated PREFERENCE from the
      interview — it shifts the rep window within what the goal allows. Both
      build muscle when effort is high (evidence: rep-range equivalence), so
      honoring the preference costs nothing and buys adherence.
      (Before: this answer was collected and silently ignored — 4 testers caught it.) */
  function scheme(gt, compound, style) {
    var sc;
    if (gt === "performance") sc = compound ? { sets: 4, lo: 4, hi: 6 } : { sets: 3, lo: 6, hi: 10 };
    else if (gt === "cut" || gt === "maintain") sc = compound ? { sets: 3, lo: 6, hi: 10 } : { sets: 3, lo: 10, hi: 15 };
    else sc = compound ? { sets: 4, lo: 6, hi: 10 } : { sets: 3, lo: 10, hi: 15 };   // hypertrophy
    if (style === "heavy") {
      // shift down the rep window (min 3 on compounds, 6 on isolation)
      sc.lo = Math.max(compound ? 3 : 6, sc.lo - 2);
      sc.hi = Math.max(sc.lo + 2, sc.hi - 3);
    } else if (style === "pump") {
      // shift up (cap 20 — beyond that it's endurance work)
      sc.lo = Math.min(15, sc.lo + 2);
      sc.hi = Math.min(20, sc.hi + 4);
    }
    return sc;
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
            // Seed from a WORKING set (4+ reps), not the single heaviest set:
            // a 1RM/PR single would otherwise become the prescribed weight for
            // a 6-10 rep scheme — guaranteed failure on day one.
            var w = null, wAny = null;
            exs[j].sets.forEach(function (s) {
              var v = Number(s.weightKg), r = Number(s.reps);
              if (!isFinite(v) || v <= 0) return;
              if (isFinite(r) && r >= 4 && (w == null || v > w)) w = v;
              if (wAny == null || v > wAny) wAny = v;
            });
            if (w != null) return w;
            if (wAny != null) return Math.round(wAny * 0.85 * 100) / 100;  // near-max single → approx working weight
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

    // Coach 2.0: profile-aware shaping (null → exact legacy behavior)
    var c2 = coach2Inputs();
    if (c2 && c2.splitPref) {
      var keys = splitKeysFor(c2.splitPref, profile.daysPerWeek || 3);
      if (keys) split = { name: splitName(c2.splitPref, keys.length), days: keys };
    }

    // per-group rotating index so repeated days pick DIFFERENT exercises
    var rot = {};
    var avoided = avoidList().map(function (n) { return n.toLowerCase(); });
    if (c2) avoided = avoided.concat(c2.avoidExtra);
    function pick(group, compound, usedLower) {
      var cands = POOL.filter(function (p) {
        return p.group === group && (compound ? p.compound : true) &&
          p.equip.some(function (t) { return allow.indexOf(t) !== -1; }) &&
          !usedLower[p.name.toLowerCase()] &&
          avoided.indexOf(p.name.toLowerCase()) === -1;   // injured/hated lifts stay out
      });
      // accessory slots: prefer ISOLATION moves — otherwise leftover heavy
      // compounds fill them and a "full gym" day stacks 5-6 compounds
      if (!compound) {
        var iso = cands.filter(function (p) { return !p.compound; });
        if (iso.length) cands = iso;
      }
      // Coach 2.0: exercises the user SAID they love come first — enjoyment
      // drives adherence, and adherence beats optimal.
      if (c2 && c2.likes.length && cands.length > 1) {
        cands = cands.slice().sort(function (a, b) {
          var la = c2.likes.indexOf(a.name.toLowerCase()) !== -1 ? 0 : 1;
          var lb = c2.likes.indexOf(b.name.toLowerCase()) !== -1 ? 0 : 1;
          return la - lb;
        });
      }
      // prefer compounds for compound slots; if none, relax to any in-group —
      // but NEVER relax the avoid list (injury exclusions are hard constraints)
      if (!cands.length) {
        cands = POOL.filter(function (p) {
          return p.group === group && p.equip.some(function (t) { return allow.indexOf(t) !== -1; }) &&
            !usedLower[p.name.toLowerCase()] &&
            avoided.indexOf(p.name.toLowerCase()) === -1;
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
        var sc = scheme(gt, ex.compound, c2 ? c2.style : null);
        // beginners: one fewer set, slightly higher reps — lighter loads with
        // more practice volume per set (the intake answer now DOES something)
        if (((c2 && c2.level === "beginner") || profile.experience === "beginner") && !ex.hold) {
          sc = { sets: Math.max(2, sc.sets - 1), lo: sc.lo + 2, hi: sc.hi + 2 };
        }
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

    // Coach 2.0: shape weekly per-muscle sets into the evidence band and
    // record the "why" for every major decision (surfaced in UI + LLM).
    var coach2 = null;
    if (c2) {
      var shaped = volumeShape(days, c2);
      coach2 = {
        level: c2.level,
        perGroupWeeklySets: shaped.perGroup,
        volumeBand: shaped.band,
        whys: {
          split: {
            text: "This split trains each muscle about " + OF.evidence.frequencyTarget().join("\u2013") +
              "\u00d7/week. " + OF.evidence.why("frequency-2x-per-week"),
            ids: ["frequency-2x-per-week"]
          },
          volume: {
            text: "Weekly sets per muscle start in the middle of the evidence range for a " + c2.level +
              " (" + shaped.band[0] + "\u2013" + shaped.band[1] + " hard sets). " +
              OF.evidence.why("volume-hypertrophy-range") + " " +
              OF.evidence.why("individual-response-variability"),
            ids: ["volume-hypertrophy-range", "individual-response-variability"]
          },
          effort: {
            text: (gt === "performance"
              ? "Main lifts stay heavy (" + OF.evidence.repRange("strength").join("\u2013") + " reps, " +
                OF.evidence.rirBand("strength").join("\u2013") + " reps in reserve). " + OF.evidence.why("intensity-load-strength")
              : "Work sets stop " + OF.evidence.rirBand("hypertrophy").join("\u2013") +
                " reps shy of failure. " + OF.evidence.why("effort-rir-hypertrophy")),
            ids: gt === "performance" ? ["intensity-load-strength", "effort-rir-strength"] : ["effort-rir-hypertrophy", "intensity-rep-range-hypertrophy"]
          },
          rest: {
            text: "Rest " + OF.evidence.restMinutes(true).join("\u2013") + " min on compounds, " +
              OF.evidence.restMinutes(false).join("\u2013") + " min on isolation work. " +
              OF.evidence.why("recovery-rest-intervals-strength"),
            ids: ["recovery-rest-intervals-strength"]
          }
        },
        injuryNotes: c2.injuryNotes,
        styleNote: c2.style === "heavy"
          ? "You said you prefer heavy, low-rep work — your rep targets are shifted down accordingly."
          : c2.style === "pump"
            ? "You said you prefer higher-rep pump work — your rep targets are shifted up accordingly."
            : null,
        cardioNote: (c2.cardio && c2.cardio !== "none")
          ? ("Your " + c2.cardio + " sessions are yours to schedule — keep them on separate days from lifting (or after it) so they don't eat into recovery. " +
             OF.evidence.why("cardio-programming-moderators"))
          : null
      };
    }

    var now = new Date().toISOString();
    return {
      createdAt: now, updatedAt: now, coach2: coach2,
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
    var fresh = generate({
      daysPerWeek: p.daysPerWeek, equipment: p.equipment, experience: p.experience,
      sessionMinutes: p.sessionMinutes, emphasis: p.emphasis
    });
    // A mid-cycle rebuild must not roll back earned progression: carry each
    // lift's current working weight + stall counter into the new program
    // (historyWeight only knows the last LOGGED weight — a bump granted after
    // the last session but not yet trained would silently vanish), and keep
    // the week position instead of restarting at Day 1.
    var prior = {};
    p.days.forEach(function (d) {
      d.slots.forEach(function (s) {
        if (s && s.name && s.weightKg != null) {
          prior[s.name.toLowerCase()] = { weightKg: s.weightKg, fails: s.fails || 0 };
        }
      });
    });
    fresh.days.forEach(function (d) {
      d.slots.forEach(function (s) {
        var old = s && s.name ? prior[s.name.toLowerCase()] : null;
        if (old && s.incKg > 0 && (s.weightKg == null || old.weightKg > s.weightKg)) {
          s.weightKg = old.weightKg;
          s.fails = old.fails;
        }
      });
    });
    fresh.pointer = p.pointer % fresh.days.length;
    save(fresh);
    return fresh;
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
      // rx = the prescription line, shown inside the live logger so the
      // target (sets x reps @ weight) stays visible while training
      return { name: ex.name, sets: sets, rx: prescription(ex) };
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
      var rxNote = mode === "sore" ? " · ~10% lighter today" : mode === "time" ? " · trimmed for time" : "";
      return { name: name, sets: arr,
        rx: (name === ex.name ? prescription(ex) + rxNote : sets + " sets — set your own weight") };
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
      if (ex && ex.name) {
        var k = String(ex.name).toLowerCase();
        // same lift logged as several cards: judge ALL its sets together —
        // overwriting dropped every card but the last (false deload/hold)
        byName[k] = (byName[k] || []).concat(ex.sets || []);
      }
    });
    // TOL covers the lb display round-trip (kg→0.1 lb→kg loses up to ~0.023 kg),
    // so a set logged at the prescribed weight isn't wrongly seen as lighter.
    var TOL = 0.05;
    var changes = [];   // per-lift outcome, for the post-session recap
    // BODYWEIGHT PROGRESSION: a calisthenics user can't add plates, so progress
    // the REP TARGET instead. Keyed on how the sets were ACTUALLY LOGGED (no
    // load), not on the exercise's incKg — a split squat done bodyweight is
    // bodyweight work even though the pool says it can be loaded.
    // (Before: any exercise with no weight simply never progressed. Ever.)
    var bwProgressed = {};
    p.days[dayIndex].slots.forEach(function (ex) {
      if (ex.hold) return;
      var loggedBw = byName[ex.name.toLowerCase()];
      if (!loggedBw || !loggedBw.length) return;
      var anyLoad = loggedBw.some(function (s2) {
        var v = Number(s2.weightKg);
        return isFinite(v) && v > 0;
      });
      if (anyLoad) return;              // real load present → weight progression below
      bwProgressed[ex.name.toLowerCase()] = true;
      var top = loggedBw.filter(function (s2) { return Number(s2.reps) >= 1; })
        .sort(function (a, b) { return Number(b.reps) - Number(a.reps); }).slice(0, ex.sets);
      if (top.length < ex.sets) return;
      var fromR = ex.repHigh;
      if (top.every(function (s2) { return Number(s2.reps) >= ex.repHigh; })) {
        // owned the top of the range on every set → make it harder
        ex.repLow = Math.min(40, ex.repLow + 2);
        ex.repHigh = Math.min(50, ex.repHigh + 2);
        changes.push({ name: ex.name, kind: "reps-up", from: fromR, to: ex.repHigh });
      }
    });

    p.days[dayIndex].slots.forEach(function (ex) {
      if (bwProgressed[ex.name.toLowerCase()]) return;    // already rep-progressed above
      if (ex.incKg <= 0 || ex.weightKg == null) return;   // no baseline yet
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
      // Going heavier only counts as a pass if the reps still landed in the
      // prescribed range: 62.5x8 against 60x6-10 beats the prescription, but
      // 62.5x2 is a failed set. The old unconditional auto-pass let a
      // grinding too-heavy session ADD weight — compounding the overload.
      var allHitTop = byReps.every(function (s) {
        return Number(s.reps) >= ex.repHigh || (over(s) && Number(s.reps) >= ex.repLow);
      });
      var hitFloor = byReps.every(function (s) { return Number(s.reps) >= ex.repLow; });
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
      // same >=4-rep guard as historyWeight: a worked-up heavy double/single
      // must not become the prescribed weight — guaranteed failure next time
      logged.forEach(function (s) {
        var v = Number(s.weightKg), r = Number(s.reps);
        if (isFinite(v) && v > 0 && r >= 4 && (w == null || v > w)) w = v;
      });
      if (w != null) { ex.weightKg = w; changes.push({ name: ex.name, kind: "seeded", to: w }); }
    });
    changes.forEach(function (c) {
      if (c.kind === "added" || c.kind === "reps-up") bumpStat("bumps");
      else if (c.kind === "deloaded") bumpStat("deloads");
    });
    bumpStat("sessions");
    // Coach 2.0: prescribed-vs-logged feeds preference learning
    try {
      if (OF.learn && OF.learn.recordSessionOutcome) {
        OF.learn.recordSessionOutcome(p.days[dayIndex].slots, loggedExercises);
      }
    } catch (e2) { /* learning must never break progression */ }
    // advance from the day just trained (not a possibly-skipped pointer)
    p.pointer = (dayIndex + 1) % p.days.length;
    p.updatedAt = new Date().toISOString();
    if (!save(p)) {
      // storage full: nothing persisted — celebrating "weight added" would be a lie
      if (OF.util) OF.util.toast("Couldn't save your progression — storage is full or blocked.", "warn");
      return { changes: [], nextName: null };
    }
    var ns = nextSession();
    return { changes: changes, nextName: ns ? ns.name : null };
  }

  /** Advance the split without progressing (e.g. a freeform/rest choice). */
  function skipDay() {
    var p = load(); if (!p) return;
    p.pointer = (p.pointer + 1) % p.days.length; save(p);
  }

  /** Is a live logging session in progress? (Owned by exercise.js.) */
  function hasLiveSession() {
    try { return !!JSON.parse(localStorage.getItem("optimalfit.activeWorkout") || "null"); }
    catch (e) { return false; }
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
      } : null,
      // Coach 2.0: the program's own reasoning, so the LLM cites OUR whys
      programRationale: p.coach2 ? {
        level: p.coach2.level,
        weeklySetsPerMuscle: p.coach2.perGroupWeeklySets,
        whys: {
          split: p.coach2.whys.split.text,
          volume: p.coach2.whys.volume.text,
          effort: p.coach2.whys.effort.text,
          rest: p.coach2.whys.rest.text
        },
        injuryNotes: p.coach2.injuryNotes && p.coach2.injuryNotes.length ? p.coach2.injuryNotes : undefined
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
      return '<div class="tr-ex" data-tr="ask" data-exname="' + e(ex.name) + '" role="button" tabindex="0"' +
        ' title="Ask your coach about ' + e(ex.name) + '">' +
        '<span class="tr-ex-name">' + e(ex.name) + '</span>' +
        '<span class="tr-ex-rx">' + e(prescription(ex)) + '</span></div>';
    }).join("");
    var p = ns.program;
    var note = recoveryNote();
    els.card.innerHTML =
      '<div class="card trainer-today">' +
        '<div class="tr-head">' +
          '<div><div class="tr-kicker">Today’s session</div>' +
          '<h2 class="tr-title">' + e(ns.name) + '</h2></div>' +
          '<span class="tr-daychip" data-tr="program" role="button" tabindex="0" title="View the full program">Day ' + (ns.dayIndex + 1) + '/' + p.days.length + '</span>' +
        '</div>' +
        (note ? '<p class="tr-recovery ' + note.cls + '">' + e(note.text) + '</p>' : '') +
        '<div class="tr-exlist">' + rows + '</div>' +
        '<div class="tr-actions">' +
          (hasLiveSession()
            ? '<button type="button" class="btn primary tr-start" data-tr="resume">Resume workout ▸</button>'
            : '<button type="button" class="btn primary tr-start" data-tr="start">Start this workout</button>') +
          '<button type="button" class="btn ghost" data-tr="program">Program</button>' +
          '<button type="button" class="btn ghost mini" data-tr="skip" title="Skip to the next day">Skip day</button>' +
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
      var rows = d.slots.map(function (ex, si) {
        return '<div class="tr-ex"><span class="tr-ex-name">' + e(ex.name) + '</span>' +
          '<span class="tr-ex-rx">' + e(prescription(ex)) + '</span>' +
          '<button type="button" class="btn mini tr-swap" data-tr="swap" data-day="' + i +
            '" data-slot="' + si + '" title="Swap ' + e(ex.name) + ' for an alternative">Swap</button>' +
          '</div>';
      }).join("");
      var isNext = (p.pointer % p.days.length) === i;
      return '<div class="tr-progday' + (isNext ? " tr-next" : "") + '">' +
        '<div class="tr-progday-head">' + e(d.name) + (isNext ? ' <span class="tr-nextchip">next</span>' : '') + '</div>' +
        rows + '</div>';
    }).join("");
    var avoid = avoidList();
    var meta = '<p class="muted small">' + e(p.split) + ' · ' + p.daysPerWeek + ' days/wk · ' +
      e(p.equipment.replace("-", " ")) + (p.goalType ? ' · goal: ' + e(p.goalType) : '') + '</p>' +
      (avoid.length ? '<p class="muted small">Avoiding: ' + avoid.map(e).join(", ") +
        ' <button type="button" class="btn mini" data-tr="clear-avoid">Clear</button></p>' : '');
    modal("Your program", meta + daysHtml,
      '<button type="button" class="btn" data-tr="setup">Adjust / rebuild</button>');
  }

  /* ---- per-exercise swap + persistent avoid list (injured/hated lifts) ---- */

  /** Add one exercise to the avoid list (used by learned-dislike confirm). */
  function addAvoid(name) {
    var n = String(name || "").trim();
    if (!n) return;
    var list = avoidList();
    if (list.map(function (x) { return x.toLowerCase(); }).indexOf(n.toLowerCase()) !== -1) return;
    list.push(n);
    try { localStorage.setItem(AVOID_KEY, JSON.stringify(list.slice(0, 40))); } catch (e) {}
  }

  var AVOID_KEY = "optimalfit.avoidExercises";
  function avoidList() {
    try { var a = JSON.parse(localStorage.getItem(AVOID_KEY) || "[]"); return Array.isArray(a) ? a : []; }
    catch (e2) { return []; }
  }
  function setAvoid(list) {
    try { localStorage.setItem(AVOID_KEY, JSON.stringify(list.slice(0, 40))); } catch (e2) {}
  }

  /** Replace one slot with a same-group alternative (respecting equipment +
      the avoid list + no duplicates in the day), keeping the set scheme.
      The old exercise is added to the avoid list so regeneration and future
      swaps never bring it back — the "my shoulder can't do this" story. */
  /**
   * Swap one slot for an alternative.
   * banIt=false (default): a plain substitution — the old lift stays eligible.
   * banIt=true: the user explicitly said "never show me this again".
   * (Before: EVERY swap silently blacklisted the lift forever with no per-item
   * undo — three testers independently flagged it, one as a quit-the-app bug.)
   */
  function swapSlot(dayIdx, slotIdx, banIt) {
    var p = load();
    if (!p || !p.days[dayIdx] || !p.days[dayIdx].slots[slotIdx]) return null;
    var cur = p.days[dayIdx].slots[slotIdx];
    var allow = EQUIP_ALLOW[p.equipment] || EQUIP_ALLOW["full-gym"];
    var used = {};
    p.days[dayIdx].slots.forEach(function (s) { used[s.name.toLowerCase()] = true; });
    var avoid = avoidList().map(function (n) { return n.toLowerCase(); });
    var cand = POOL.filter(function (pp) {
      return pp.group === cur.group && pp.name !== cur.name && !pp.hold === !cur.hold &&
        (!cur.compound || pp.compound) &&
        pp.equip.some(function (t) { return allow.indexOf(t) !== -1; }) &&
        !used[pp.name.toLowerCase()] && avoid.indexOf(pp.name.toLowerCase()) === -1;
    })[0];
    if (!cand) return null;
    if (banIt) {                       // ONLY when the user asked for a permanent ban
      var a2 = avoidList();
      if (a2.indexOf(cur.name) === -1) { a2.push(cur.name); setAvoid(a2); }
    }
    // keep the load baseline when the swap is like-for-like: same group is
    // already guaranteed, so require same compound/isolation class AND a
    // shared implement (barbell→barbell yes, barbell→dumbbell no — loads
    // don't transfer across implements) — travellers kept re-guessing weights
    var curPool = null;
    for (var pi = 0; pi < POOL.length; pi++) {
      if (POOL[pi].name === cur.name) { curPool = POOL[pi]; break; }
    }
    var sameImplement = curPool && cand.equip.some(function (t) { return curPool.equip.indexOf(t) !== -1; });
    var likeForLike = !!cand.compound === !!cur.compound && sameImplement;
    p.days[dayIdx].slots[slotIdx] = {
      name: cand.name, group: cand.group, compound: cand.compound, hold: !!cand.hold,
      sets: cur.sets, repLow: cur.repLow, repHigh: cur.repHigh,
      weightKg: (likeForLike && cur.weightKg != null) ? cur.weightKg : null,
      incKg: cand.incKg
    };
    p.updatedAt = new Date().toISOString();
    save(p);
    return { from: cur.name, to: cand.name, banned: !!banIt };
  }

  /** Remove ONE exercise from the avoid list (there was no per-item undo). */
  function unavoid(name) {
    var n = String(name || "").trim().toLowerCase();
    var list = avoidList().filter(function (x) { return x.toLowerCase() !== n; });
    setAvoid(list);
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
      if (act === "setup") {
        // Coach 2.0: the full interview replaces the 5-question modal
        // (falls back to the legacy modal if intake isn't loaded)
        if (OF.intake && OF.intake.start) { OF.intake.start(); return; }
        openIntake(); return;
      }
      if (act === "program") { openProgram(); return; }
      if (act === "swap") {
        var dIdx = parseInt(b.getAttribute("data-day"), 10), sIdx = parseInt(b.getAttribute("data-slot"), 10);
        var res = swapSlot(dIdx, sIdx, false);   // plain swap — nothing gets banned
        if (res) {
          if (OF.util) OF.util.toast("Swapped " + res.from + " → " + res.to + ".", "ok", {
            label: "Never show " + res.from,
            fn: function () {
              addAvoid(res.from);
              if (OF.util) OF.util.toast(res.from + " won't be prescribed again. Undo it in the program view.", "ok");
              openProgram(); renderCard();
            }
          });
          openProgram(); renderCard();
        } else if (OF.util) {
          OF.util.toast("No alternative available for that slot with your equipment.", "warn");
        }
        return;
      }
      if (act === "clear-avoid") {
        setAvoid([]);
        if (OF.util) OF.util.toast("Avoid list cleared.", "ok");
        openProgram();
        return;
      }
      if (act === "ask") {
        // tap an exercise row -> coach tab with the question pre-typed (the
        // user reviews and hits Send — never auto-fire an AI request)
        if (OF.app) OF.app.showTab("coach");
        var ci = document.getElementById("coach-input");
        if (ci) {
          ci.value = "Walk me through " + (b.getAttribute("data-exname") || "this exercise") +
            " — form cues, and check my working weight for today.";
          ci.focus();
        }
        return;
      }
      if (act === "start") { closeModal(); startToday(); return; }
      if (act === "resume") {
        // jump back into the live session — setting an identical hash fires no
        // hashchange, so switch the tab explicitly too
        if (location.hash === "#exercise") { if (OF.app) OF.app.showTab("exercise"); }
        else location.hash = "#exercise";
        return;
      }
      if (act === "adapt") {
        // PREVIEW the adapted session first — a curious tap must not
        // instantly start a live, wall-clock workout
        var mode = b.getAttribute("data-mode");
        var ns2 = nextSession();
        if (!ns2) return;
        var adapted = adaptSession(ns2.dayIndex, mode);
        var blurb = mode === "time" ? "Short on time: compounds first, at most 4 exercises, 3 sets each."
          : mode === "travel" ? "Traveling: gym lifts swapped to dumbbell/bodyweight alternatives."
          : "Sore / low energy: ~10% lighter and one fewer set per exercise.";
        var list = adapted.map(function (ex2) {
          return '<div class="tr-ex"><span class="tr-ex-name">' + e(ex2.name) + '</span>' +
            '<span class="tr-ex-rx">' + ex2.sets.length + ' set' + (ex2.sets.length === 1 ? '' : 's') + '</span></div>';
        }).join("");
        modal("Adjusted: " + ns2.name,
          '<p class="muted">' + e(blurb) + '</p><div class="tr-exlist">' + list + '</div>',
          '<button type="button" class="btn primary" data-tr="start-adapted" data-mode="' + e(mode) + '">Start this version</button>' +
          '<button type="button" class="btn ghost" data-tr-close>Cancel</button>');
        return;
      }
      if (act === "start-adapted") { closeModal(); startToday(b.getAttribute("data-mode")); return; }
      if (act === "skip") {
        var before = nextSession();
        skipDay();
        var after = nextSession();
        if (OF.util && before && after) {
          OF.util.toast("Skipped " + before.name + " — next up: " + after.name +
            ". Keep tapping Skip to cycle through the week.", "ok");
        }
        renderCard();
        return;
      }
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
    addAvoid: addAvoid,
    unavoid: unavoid,
    swapSlot: swapSlot,
    hasProgram: hasProgram,
    load: load,
    EQUIP_ALLOW: EQUIP_ALLOW,
    SPLITS: SPLITS
  };
})();

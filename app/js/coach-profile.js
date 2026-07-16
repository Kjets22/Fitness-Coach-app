/* ============================================================
   coach-profile.js — the User Coaching Profile (Coach 2.0).

   One versioned, structured record of everything the coach knows about
   the person that is NOT derivable from logged data: goals, training
   preferences, likes/hates, experience, constraints, recovery/lifestyle.
   Every other Coach-2.0 part reads from here (intake writes it, the
   program generator consumes it, the LLM gets a compact summary).

   Storage: optimalfit.coachProfile =
     { version, createdAt, updatedAt, data: {...sections below}, changes: [...] }
   `changes` is a compact append-only audit trail (what changed, when,
   from which source) so the coach can honestly say "you told me X on
   the 3rd, switched to Y last week".

   Sections (all optional — the profile fills in over time):
     goals:      { primary, secondary[], timelineWeeks, milestones[],
                   eventDate }            primary ∈ muscle|fat-loss|strength|
                                          recomp|endurance|health|sport
     prefs:      { split, daysPerWeek, sessionMinutes, timeOfDay,
                   style ("heavy"|"pump"|"mixed"), cardio ("none"|"walk"|
                   "run"|"bike"|"swim"|"sport"), likes[], dislikes[] }
     experience: { trainingAgeYears, level ("beginner"|"intermediate"|
                   "advanced"), knownLifts {name: e1rmKg} }
     constraints:{ equipment, injuries [{area, aggravates[], note}],
                   scheduleNote }
     recovery:   { sleepTypicalH, stress (1-5), jobActivity ("desk"|
                   "onFeet"|"physical"), dietStyle, restrictions[],
                   proteinHabit ("low"|"moderate"|"high") }
   ============================================================ */

window.OF = window.OF || {};

OF.profile = (function () {
  "use strict";

  var U = OF.util;
  var KEY = "optimalfit.coachProfile";
  var MAX_CHANGES = 60;          // audit trail cap (compact rows)
  var SECTIONS = ["goals", "prefs", "experience", "constraints", "recovery"];

  function blank() {
    return {
      version: 0,
      createdAt: null,
      updatedAt: null,
      data: { goals: {}, prefs: {}, experience: {}, constraints: {}, recovery: {} },
      changes: []
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return blank();
      var p = JSON.parse(raw);
      if (!p || typeof p !== "object" || !p.data) return blank();
      SECTIONS.forEach(function (s) { if (!p.data[s] || typeof p.data[s] !== "object") p.data[s] = {}; });
      if (!Array.isArray(p.changes)) p.changes = [];
      return p;
    } catch (e) { return blank(); }
  }

  function save(p) {
    try { localStorage.setItem(KEY, JSON.stringify(p)); return true; }
    catch (e) {
      if (U && U.toast) U.toast("Couldn't save your coaching profile — storage is full or blocked.", "warn");
      return false;
    }
  }

  /** The profile's data sections (always the full shape, never null). */
  function get() { return load().data; }

  /** Has the user completed (or meaningfully started) an intake? */
  function exists() {
    var p = load();
    return p.version > 0 && !!(p.data.goals.primary || p.data.prefs.daysPerWeek);
  }

  /**
   * Merge a patch into one or more sections; bumps version and records a
   * compact change row. patch = { goals: {...}, prefs: {...}, ... } — only
   * the keys present are touched; a key set to null DELETES the field.
   * source labels who wrote it ("intake" | "user-edit" | "learned" | "coach").
   */
  function update(patch, source) {
    if (!patch || typeof patch !== "object") return get();
    var p = load();
    var touched = [];
    SECTIONS.forEach(function (s) {
      var sec = patch[s];
      if (!sec || typeof sec !== "object") return;
      Object.keys(sec).forEach(function (k) {
        var v = sec[k];
        var old = p.data[s][k];
        var same;
        try { same = JSON.stringify(old) === JSON.stringify(v); } catch (e) { same = old === v; }
        if (same) return;
        if (v === null) delete p.data[s][k];
        else p.data[s][k] = v;
        touched.push(s + "." + k);
      });
    });
    if (!touched.length) return p.data;
    p.version += 1;
    var now = new Date().toISOString();
    if (!p.createdAt) p.createdAt = now;
    p.updatedAt = now;
    p.changes.push({ v: p.version, at: now.slice(0, 10), src: source || "user-edit", fields: touched.slice(0, 12) });
    if (p.changes.length > MAX_CHANGES) p.changes = p.changes.slice(-MAX_CHANGES);
    save(p);
    return p.data;
  }

  function meta() {
    var p = load();
    return { version: p.version, createdAt: p.createdAt, updatedAt: p.updatedAt, changes: p.changes.slice(-10) };
  }

  /* ---------- convenience readers used across Coach 2.0 ---------- */

  /** beginner | intermediate | advanced — explicit level wins, else training age. */
  function level() {
    var d = get();
    if (d.experience.level) return d.experience.level;
    var y = Number(d.experience.trainingAgeYears);
    if (!isFinite(y)) return null;
    return y < 1 ? "beginner" : y <= 3 ? "intermediate" : "advanced";
  }

  /** Exercises the user refuses/hates (lowercased), merged with learned dislikes. */
  function dislikedExercises() {
    var d = get();
    var out = {};
    (Array.isArray(d.prefs.dislikes) ? d.prefs.dislikes : []).forEach(function (n) {
      if (typeof n === "string" && n.trim()) out[n.trim().toLowerCase()] = true;
    });
    return Object.keys(out);
  }

  function likedExercises() {
    var d = get();
    return (Array.isArray(d.prefs.likes) ? d.prefs.likes : [])
      .filter(function (n) { return typeof n === "string" && n.trim(); })
      .map(function (n) { return n.trim().toLowerCase(); });
  }

  /* ---------- re-interview triggers ----------
     The coach should offer a fresh check-in when the situation changed,
     not on a timer. Returns an array of {kind, message} (empty = none). */
  function reinterviewTriggers() {
    var out = [];
    try {
      var p = load();
      if (p.version === 0) return out;   // never interviewed — intake, not RE-interview

      // (1) app goal changed after the interview
      var g = OF.goals && OF.goals.activeGoal ? OF.goals.activeGoal() : null;
      if (g && p.data.goals.appGoalType && g.type !== p.data.goals.appGoalType) {
        out.push({ kind: "goal-change", message: "Your goal changed to “" + g.type + "” — want a quick check-in so I can rebuild the plan around it?" });
      }

      // (2) long layoff: no workouts logged for 21+ days (but some exist)
      var ex = OF.storage.getAll("exercise");
      if (ex.length) {
        var newest = ex.slice().sort(U.byNewest)[0];
        var days = (Date.parse(U.todayISO()) - Date.parse(newest.date)) / 86400000;
        if (isFinite(days) && days >= 21) {
          out.push({ kind: "layoff", message: "It's been " + Math.round(days) + " days since your last logged workout — welcome back! Let's do a 1-minute check-in and restart at the right level." });
        }
      }

      // (3) plateau: strength engine reports 2+ stalled lifts
      if (OF.strength) {
        var a = OF.strength.analyze({
          exercise: ex, sleep: OF.storage.getAll("sleep"),
          food: OF.storage.getAll("food"), body: OF.storage.getAll("body"),
          goalType: g ? g.type : null, proteinTargetG: null
        });
        var stalled = (a && a.status === "ok" && Array.isArray(a.exercises))
          ? a.exercises.filter(function (r) { return r.verdict === "stalling"; }).length : 0;
        if (stalled >= 2) {
          out.push({ kind: "plateau", message: stalled + " of your lifts have stalled — a short check-in would let me reshape the plan (volume, exercise choice, recovery)." });
        }
      }
    } catch (e) { /* triggers are best-effort */ }
    return out;
  }

  /* ---------- compact block for the LLM coach (≈≤700 B typical) ---------- */
  function coachContext() {
    var p = load();
    if (p.version === 0) return null;
    var d = p.data;
    var ctx = {
      profileVersion: p.version,
      interviewed: p.createdAt ? p.createdAt.slice(0, 10) : null,
      goals: d.goals.primary ? {
        primary: d.goals.primary,
        secondary: d.goals.secondary && d.goals.secondary.length ? d.goals.secondary : undefined,
        timelineWeeks: d.goals.timelineWeeks || undefined,
        milestones: d.goals.milestones && d.goals.milestones.length ? d.goals.milestones.slice(0, 3) : undefined
      } : undefined,
      prefs: {
        split: d.prefs.split || undefined,
        daysPerWeek: d.prefs.daysPerWeek || undefined,
        sessionMinutes: d.prefs.sessionMinutes || undefined,
        style: d.prefs.style || undefined,
        cardio: d.prefs.cardio || undefined,
        likes: d.prefs.likes && d.prefs.likes.length ? d.prefs.likes.slice(0, 6) : undefined,
        dislikes: d.prefs.dislikes && d.prefs.dislikes.length ? d.prefs.dislikes.slice(0, 6) : undefined,
        notes: d.prefs.notes ? String(d.prefs.notes).slice(0, 300) : undefined
      },
      experience: {
        level: level() || undefined,
        trainingAgeYears: d.experience.trainingAgeYears || undefined
      },
      constraints: {
        equipment: d.constraints.equipment || undefined,
        injuries: (d.constraints.injuries || []).slice(0, 4).map(function (i) {
          return i.area + (i.aggravates && i.aggravates.length ? " (avoid " + i.aggravates.join(", ") + ")" : "");
        }),
        scheduleNote: d.constraints.scheduleNote || undefined
      },
      recovery: {
        sleepTypicalH: d.recovery.sleepTypicalH || undefined,
        stress: d.recovery.stress || undefined,
        jobActivity: d.recovery.jobActivity || undefined,
        dietStyle: d.recovery.dietStyle || undefined,
        restrictions: d.recovery.restrictions && d.recovery.restrictions.length ? d.recovery.restrictions : undefined
      },
      recentChanges: p.changes.slice(-3)
    };
    if (!ctx.constraints.injuries.length) delete ctx.constraints.injuries;
    return ctx;
  }

  return {
    get: get,
    exists: exists,
    update: update,
    meta: meta,
    level: level,
    dislikedExercises: dislikedExercises,
    likedExercises: likedExercises,
    reinterviewTriggers: reinterviewTriggers,
    coachContext: coachContext
  };
})();

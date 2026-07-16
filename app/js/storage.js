/* ============================================================
   storage.js — localStorage persistence layer.

   All data lives under keys "optimalfit.<type>" where <type> is
   one of: sleep, food, exercise, body. Each key holds a JSON
   array of records. Every record gets:
     id        — unique string id
     createdAt — ISO timestamp when first saved
     updatedAt — ISO timestamp of last modification
   CRUD: getAll / get / add / update / remove
   Backup: exportAll() / importAll(json, mode)
   ============================================================ */

window.OF = window.OF || {};

OF.storage = (function () {
  "use strict";

  var PREFIX = "optimalfit.";
  var TYPES = ["sleep", "food", "exercise", "body", "water", "steps", "goal", "adjustments", "physique", "activeEnergy"];
  var SCHEMA_VERSION = 2;

  function key(type) {
    if (TYPES.indexOf(type) === -1) throw new Error("Unknown record type: " + type);
    return PREFIX + type;
  }

  /** Types whose stored payload couldn't be parsed (warned once per session). */
  var corruptWarned = {};

  /** Read the full array for a type. Always returns a (possibly empty) array. */
  function getAll(type) {
    var raw;
    try {
      raw = localStorage.getItem(key(type));
    } catch (e) {
      console.error("OF.storage.getAll failed for", type, e);
      return [];
    }
    if (!raw) return [];
    try {
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) throw new Error("stored value is not an array");
      return arr;
    } catch (e) {
      // Corrupt payload: keep a copy under a backup key so the next write
      // can't silently clobber unreadable data, and warn once per session.
      console.error("OF.storage.getAll: corrupt data for", type, e);
      if (!corruptWarned[type]) {
        corruptWarned[type] = true;
        var backedUp = false;
        try {
          localStorage.setItem(key(type) + ".corrupt", raw);
          backedUp = true;
        } catch (e2) {
          console.error("OF.storage: could not back up corrupt data for", type, e2);
        }
        if (backedUp) {
          OF.util.toast('Saved ' + type + ' data could not be read. A backup copy was kept ' +
            'in this browser’s storage; new entries will start fresh.', "warn");
        } else {
          OF.util.toast('Saved ' + type + ' data could not be read and could not be backed up. ' +
            'New ' + type + ' entries will start fresh.', "warn");
        }
      }
      return [];
    }
  }

  /**
   * Persist the full array for a type. Returns true on success; on failure
   * (quota exceeded, private mode, storage disabled) shows a visible error
   * and returns false — callers must not pretend the write happened.
   */
  var changeSubs = [];
  function onChange(fn) { if (typeof fn === "function") changeSubs.push(fn); }
  function fireChange() { changeSubs.forEach(function (f) { try { f(); } catch (e) {} }); }

  function saveAll(type, arr) {
    try {
      localStorage.setItem(key(type), JSON.stringify(arr));
      fireChange();
      return true;
    } catch (e) {
      console.error("OF.storage.saveAll failed for", type, e);
      OF.util.toast("Could not save — browser storage is full or blocked. " +
        "Your latest change was NOT stored.");
      return false;
    }
  }

  /** Find one record by id, or null. */
  function get(type, id) {
    var arr = getAll(type);
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
    return null;
  }

  /**
   * Add a record; assigns id/createdAt/updatedAt.
   * Returns the stored record, or null if the write failed.
   */
  function add(type, record) {
    var arr = getAll(type);
    var now = new Date().toISOString();
    var rec = Object.assign({}, record, {
      id: OF.util.uid(),
      createdAt: now,
      updatedAt: now
    });
    arr.push(rec);
    return saveAll(type, arr) ? rec : null;
  }

  /**
   * Shallow-merge `patch` into the record with `id`.
   * Returns the updated record, or null (not found OR the write failed).
   */
  function update(type, id, patch) {
    var arr = getAll(type);
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].id === id) {
        arr[i] = Object.assign({}, arr[i], patch, {
          id: id, // id is immutable
          createdAt: arr[i].createdAt,
          updatedAt: new Date().toISOString()
        });
        return saveAll(type, arr) ? arr[i] : null;
      }
    }
    return null;
  }

  /** Delete by id. Returns true if something was removed AND the write stuck. */
  function remove(type, id) {
    var arr = getAll(type);
    var next = arr.filter(function (r) { return r.id !== id; });
    if (next.length === arr.length) return false;
    return saveAll(type, next);
  }

  /** Wipe every optimalfit.* key, including any ".corrupt" backups. */
  function clearAll() {
    TYPES.forEach(function (t) {
      localStorage.removeItem(key(t));
      localStorage.removeItem(key(t) + ".corrupt");
    });
  }

  /** Total record count across all types. */
  function countAll() {
    return TYPES.reduce(function (n, t) { return n + getAll(t).length; }, 0);
  }

  /** Export everything as a pretty JSON string. */
  /* App state that lives OUTSIDE the record store but is part of the user's
     progress: the training program (incl. every progressed weight), trainer
     value stats, PR high-water marks, and streak history. Without these a
     backup restore silently loses the whole training state. Deliberately NOT
     included: social (server-backed auth/profile cache), pairKey (a device
     secret has no business inside a shareable backup file), activeWorkout
     (transient in-flight session). */
  /* Everything under optimalfit.* that ISN'T a record list but still IS the
     user's data. A backup that silently drops these loses the coach's entire
     memory of you — a privacy-minded tester found the interview answers,
     learned preferences and chat history were all missing from exports. */
  var APPSTATE_KEYS = ["trainerProgram", "trainerStats", "prMeta", "streakMeta",
    "coachProfile", "learnState", "coachChat", "avoidExercises", "exRest"];

  function exportAll() {
    var out = {
      app: "OptimalFit",
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      data: {}
    };
    TYPES.forEach(function (t) { out.data[t] = getAll(t); });
    try {
      var rawPrefs = localStorage.getItem(PREFIX + "prefs");
      if (rawPrefs) out.prefs = JSON.parse(rawPrefs);
    } catch (e) { /* prefs are optional in a backup */ }
    out.appState = {};
    APPSTATE_KEYS.forEach(function (k) {
      try {
        var raw = localStorage.getItem(PREFIX + k);
        if (raw) out.appState[k] = JSON.parse(raw);
      } catch (e) { /* an unparsable key is skipped, never breaks the export */ }
    });
    return JSON.stringify(out, null, 2);
  }

  /* ---------- Import normalization ---------- */

  var NUM_FIELDS = {
    sleep: ["quality", "durationMin"],
    food: ["calories", "protein", "carbs", "fat"],
    exercise: ["durationMin", "intensity", "performance"],
    body: ["weightKg", "bodyFatPct", "muscleMassKg", "muscleMassPct"],
    water: ["amountMl"],
    steps: ["count"],
    goal: ["targetAmountKg", "heightCm", "age"],
    adjustments: ["delta", "from", "to"],
    physique: ["bodyFatMidpoint", "bodyFatRangeLow", "bodyFatRangeHigh"],
    activeEnergy: ["kcal"]   // HealthKit auto-sync records — missing here made importAll THROW on any backup containing them
  };

  /* Physique enum + region vocab (mirrors serve.py /api/physique). */
  var PHYS_MUSCULARITY = ["low", "below-average", "average", "above-average", "high"];
  var PHYS_CONFIDENCE = ["low", "medium", "high"];
  var PHYS_REGIONS = ["shoulders", "chest", "arms", "back", "core", "legs"];

  /** A REAL calendar date within sane bounds — "2026-02-30", "9999-12-31"
      and month 13 all poisoned charts/aggregations when imported. */
  function isRealDate(str) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
    if (!m) return false;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (y < 2000 || y > new Date().getFullYear() + 1) return false;
    var dt = new Date(Date.UTC(y, mo - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
  }

  /** Lenient numeric coercion for imported fields: number, or null. */
  function coerceNum(v) {
    if (v === "" || v == null) return null;
    var n = typeof v === "number" ? v : parseFloat(v);
    return isFinite(n) ? n : null;
  }

  /**
   * Sane value ranges per numeric field (mirrors the form-level bounds
   * from Q4 plus physical sanity caps). Imported values outside a range
   * are CLAMPED into it; `int: true` fields are rounded to integers
   * (ratings are whole 1–5 pills in the UI).
   */
  var RANGES = {
    sleep: { quality: { min: 1, max: 5, int: true }, durationMin: { min: 0, max: 1200 } },
    food: {
      calories: { min: 0, max: 10000 },
      protein: { min: 0, max: 1000 }, carbs: { min: 0, max: 1000 }, fat: { min: 0, max: 1000 }
    },
    exercise: {
      durationMin: { min: 0, max: 1200 },
      intensity: { min: 1, max: 5, int: true }, performance: { min: 1, max: 5, int: true }
    },
    body: {
      weightKg: { min: 20, max: 400 },
      bodyFatPct: { min: 0, max: 100 },
      muscleMassKg: { min: 0, max: 300 }, muscleMassPct: { min: 0, max: 100 }
    },
    water: { amountMl: { min: 0, max: 10000 } },
    steps: { count: { min: 0, max: 200000 } },
    activeEnergy: { kcal: { min: 0, max: 20000 } },
    goal: { targetAmountKg: { min: 0, max: 500 }, heightCm: { min: 90, max: 250 }, age: { min: 5, max: 120, int: true } },
    physique: {
      bodyFatMidpoint: { min: 3, max: 60 },
      bodyFatRangeLow: { min: 3, max: 60 }, bodyFatRangeHigh: { min: 3, max: 60 }
    }
  };

  /** Clamp a coerced number into its field range (null passes through). */
  function clampNum(type, field, v) {
    if (v == null) return null;
    var r = RANGES[type] && RANGES[type][field];
    if (!r) return v;
    if (r.int) v = Math.round(v);
    if (v < r.min) v = r.min;
    if (v > r.max) v = r.max;
    return v;
  }

  /**
   * Sanitize an imported exercise record's optional `exercises` array:
   *   [{ name: string ≤80, sets: [{weightKg: 0–500|null, reps: int 1–100}] }]
   * Malformed sets/exercises are DROPPED; out-of-range numbers are CLAMPED
   * (reps) or clamped into 0–500 (weight; non-numbers become null =
   * bodyweight). Caps: 30 exercises × 30 sets. Returns a clean array or
   * undefined when nothing valid remains.
   */
  var MAX_IMPORT_EXERCISES = 30, MAX_IMPORT_SETS = 30;
  function sanitizeExercises(list) {
    if (!Array.isArray(list)) return undefined;
    var out = [];
    for (var i = 0; i < list.length && out.length < MAX_IMPORT_EXERCISES; i++) {
      var ex = list[i];
      if (!ex || typeof ex !== "object" || Array.isArray(ex)) continue;
      var name = typeof ex.name === "string" ? ex.name.trim().slice(0, 80) : "";
      if (!name || !Array.isArray(ex.sets)) continue;
      var sets = [];
      for (var j = 0; j < ex.sets.length && sets.length < MAX_IMPORT_SETS; j++) {
        var s = ex.sets[j];
        if (!s || typeof s !== "object" || Array.isArray(s)) continue;
        var reps = coerceNum(s.reps);
        if (reps == null) continue;                    // a set without reps is meaningless
        reps = Math.round(reps);
        if (reps < 1) reps = 1;
        if (reps > 100) reps = 100;
        var w = coerceNum(s.weightKg);                 // null = bodyweight
        if (w != null) {
          if (w < 0) w = 0;
          if (w > 500) w = 500;
        }
        sets.push({ weightKg: w, reps: reps });
      }
      if (sets.length) out.push({ name: name, sets: sets });
    }
    return out.length ? out : undefined;
  }

  /**
   * Enum coercion helper: lowercased trimmed match against `allowed`,
   * else the default. Non-strings collapse to the default.
   */
  function coerceEnum(v, allowed, dflt) {
    if (typeof v === "string") {
      var s = v.trim().toLowerCase();
      if (allowed.indexOf(s) !== -1) return s;
    }
    return dflt;
  }

  /** Trim + slice a value to a string of at most `n` chars ("" for non-strings). */
  function capStr(v, n) {
    return typeof v === "string" ? v.trim().slice(0, n) : "";
  }

  /** Clamp an imported string array: ≤ maxItems entries, each ≤ itemLen chars. */
  function capStrList(v, maxItems, itemLen) {
    if (!Array.isArray(v)) return [];
    var out = [];
    for (var i = 0; i < v.length && out.length < maxItems; i++) {
      var s = capStr(v[i], itemLen);
      if (s) out.push(s);
    }
    return out;
  }

  /**
   * Sanitize an imported physique record's non-numeric fields in place:
   * enum coercion (muscularity/confidence), region map (6 known keys,
   * each ≤60 chars), strengths/focusAreas arrays (≤6 items, ≤80 chars),
   * and length-capped assessment/notes. Numeric body-fat fields are handled
   * by the NUM_FIELDS/clampNum pass; here we also enforce low ≤ high and
   * midpoint inside [low, high]. Strings are escaped at RENDER, never here.
   */
  function sanitizePhysique(rec) {
    rec.muscularity = coerceEnum(rec.muscularity, PHYS_MUSCULARITY, "average");
    rec.confidence = coerceEnum(rec.confidence, PHYS_CONFIDENCE, "low");
    var src = (rec.regions && typeof rec.regions === "object" && !Array.isArray(rec.regions))
      ? rec.regions : {};
    var regions = {};
    PHYS_REGIONS.forEach(function (r) { regions[r] = capStr(src[r], 60); });
    rec.regions = regions;
    rec.strengths = capStrList(rec.strengths, 6, 80);
    rec.focusAreas = capStrList(rec.focusAreas, 6, 80);
    rec.overallAssessment = capStr(rec.overallAssessment, 600);
    rec.notes = capStr(rec.notes, 600);
    rec.analyzed = rec.analyzed !== false; // saved records are analyzed=true
    var lo = rec.bodyFatRangeLow, hi = rec.bodyFatRangeHigh;
    if (lo != null && hi != null && lo > hi) {
      rec.bodyFatRangeLow = hi; rec.bodyFatRangeHigh = lo;
      lo = rec.bodyFatRangeLow; hi = rec.bodyFatRangeHigh;
    }
    if (rec.bodyFatMidpoint != null) {
      if (lo != null && rec.bodyFatMidpoint < lo) rec.bodyFatMidpoint = lo;
      if (hi != null && rec.bodyFatMidpoint > hi) rec.bodyFatMidpoint = hi;
    }
    return rec;
  }

  /**
   * Normalize one imported record: coerce expected numeric fields,
   * default missing enum fields, stringify foreign ids. Returns a
   * cleaned copy, or null if the record lacks the essential `date`.
   */
  function normalizeRecord(type, r) {
    if (!r || typeof r !== "object" || Array.isArray(r)) return null;
    if (typeof r.date !== "string" || !isRealDate(r.date)) return null;
    var rec = Object.assign({}, r);
    if (rec.id != null && typeof rec.id !== "string") rec.id = String(rec.id);
    (NUM_FIELDS[type] || []).forEach(function (f) { rec[f] = clampNum(type, f, coerceNum(rec[f])); });   // guard: a type without a field list must never crash the whole import
    if (type === "exercise" && !rec.type) rec.type = "other";
    if (type === "exercise" && rec.exercises !== undefined) {
      var exs = sanitizeExercises(rec.exercises);
      if (exs) rec.exercises = exs; else delete rec.exercises;
    }
    if (type === "food" && !rec.mealType) rec.mealType = "snack";
    if (type === "physique") sanitizePhysique(rec);
    if (type === "sleep" && rec.durationMin == null) {
      rec.durationMin = clampNum(type, "durationMin",
        coerceNum(OF.util.sleepDurationMin(rec.bedTime, rec.wakeTime)));
    }
    if (type === "goal" && rec.targetDate != null &&
        !(typeof rec.targetDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rec.targetDate))) {
      delete rec.targetDate;   // a garbage date would render "NaN-NaN-NaN" on the goal card
    }
    return rec;
  }

  /**
   * Import a JSON string produced by exportAll().
   * mode: "replace" — wipe current data first;
   *       "merge"   — keep current data, add imported records that
   *                   don't already exist (matched by id).
   * Records are normalized on the way in (numeric coercion, enum
   * defaults, id regeneration); records without a valid date are skipped.
   * Returns { imported: n, skipped: n } or throws Error on bad input
   * or if the imported data could not be written to storage.
   */
  function importAll(json, mode) {
    var parsed;
    try {
      parsed = typeof json === "string" ? JSON.parse(json) : json;
    } catch (e) {
      throw new Error("File is not valid JSON.");
    }
    var data = parsed && parsed.data;
    if (!data || typeof data !== "object") {
      throw new Error("Not an OptimalFit backup (missing \"data\" object).");
    }

    var replace = mode === "replace";
    var imported = 0, skipped = 0;

    // Build the full next-state for every type IN MEMORY first, without
    // touching storage. Replace starts each type from empty; merge starts
    // from current data and only adds imported ids it doesn't already have.
    // Types with a ONE-RECORD-PER-DAY invariant (the UIs "last one wins" /
    // upsert by date): merging a backup must not create a second record for a
    // day that already has one — the duplicate would shadow the user's entry
    // with the imported (stale) count and be uneditable/undeletable in the UI.
    var ONE_PER_DAY = { steps: true, activeEnergy: true };

    var nextState = {}; // type -> array to write (absent = leave storage untouched)
    TYPES.forEach(function (t) {
      var incoming = Array.isArray(data[t]) ? data[t] : [];
      // Merge with nothing incoming needs no write. Replace must (re)write
      // every type so any pre-existing records for it are cleared.
      if (!replace && !incoming.length) return;
      var current = replace ? [] : getAll(t);
      var seen = Object.create(null);   // null proto: an id named "__proto__"/"constructor" must not hit Object.prototype and get skipped as a "duplicate"
      var seenDates = Object.create(null);
      current.forEach(function (r) {
        if (r && r.id) seen[r.id] = true;
        if (ONE_PER_DAY[t] && r && r.date) seenDates[r.date] = true;
      });
      incoming.forEach(function (raw) {
        var r = normalizeRecord(t, raw);
        if (!r) { skipped++; return; } // not an object / missing essential date
        if (r.id && seen[r.id]) { skipped++; return; } // already have it (merge/dupe)
        if (ONE_PER_DAY[t] && r.date && seenDates[r.date]) { skipped++; return; } // the local day's entry wins
        if (!r.id) r.id = OF.util.uid();
        if (!r.createdAt) r.createdAt = new Date().toISOString();
        r.updatedAt = r.updatedAt || r.createdAt;
        current.push(r);
        seen[r.id] = true;
        if (ONE_PER_DAY[t] && r.date) seenDates[r.date] = true;
        imported++;
      });
      nextState[t] = current;
    });

    // Write phase. Replace is made ATOMIC: snapshot the raw pre-import bytes
    // for every type, then overwrite. If any write fails partway, roll every
    // already-overwritten type back to its snapshot — so a mid-write failure
    // can never destroy existing data. (The old code cleared everything up
    // front, so a failed write left the user with nothing.)
    if (replace) {
      var snapshot = {};
      TYPES.forEach(function (t) {
        try { snapshot[t] = localStorage.getItem(key(t)); }
        catch (e) { snapshot[t] = null; }
      });
      var written = [], failed = false;
      for (var i = 0; i < TYPES.length; i++) {
        if (saveAll(TYPES[i], nextState[TYPES[i]])) {
          written.push(TYPES[i]);
        } else {
          failed = true;
          break;
        }
      }
      if (failed) {
        written.forEach(function (t) {
          try {
            if (snapshot[t] == null) localStorage.removeItem(key(t));
            else localStorage.setItem(key(t), snapshot[t]);
          } catch (e) { /* best-effort rollback */ }
        });
        throw new Error("Browser storage is full or blocked — the imported data was NOT saved. Your previous data was restored where possible; check your lists before trusting counts.");
      }
    } else {
      var writeFailed = false;
      TYPES.forEach(function (t) {
        if (nextState[t] && !saveAll(t, nextState[t])) writeFailed = true;
      });
      if (writeFailed) {
        throw new Error("Browser storage is full or blocked — the imported data was NOT fully saved.");
      }
    }

    // Restore unit preferences when the backup carries them (merge = keep current).
    if (replace && parsed.prefs && typeof parsed.prefs === "object" &&
        !Array.isArray(parsed.prefs) && OF.units) {
      OF.units.setPrefs(parsed.prefs);
    }

    // Restore app state (training program, trainer stats, PR marks, streak
    // history). Replace restores everything from the backup; merge only fills
    // keys that don't exist locally — an older backup must never clobber an
    // actively-progressing program.
    var appState = parsed.appState;
    if (appState && typeof appState === "object" && !Array.isArray(appState)) {
      APPSTATE_KEYS.forEach(function (k) {
        var v = appState[k];
        if (v == null || typeof v !== "object") return;
        // a malformed trainerProgram would crash every render that touches it
        if (k === "trainerProgram") {
          var okShape = !Array.isArray(v) && Array.isArray(v.days) && v.days.length > 0 &&
            typeof v.pointer === "number" &&
            v.days.every(function (d) { return d && Array.isArray(d.slots); });
          if (!okShape) return;
        }
        var existing = null;
        try { existing = localStorage.getItem(PREFIX + k); } catch (e) {}
        if (!replace && existing) return;
        try { localStorage.setItem(PREFIX + k, JSON.stringify(v)); }
        catch (e) { /* quota — records were already saved; app state is best-effort */ }
      });
    }
    return { imported: imported, skipped: skipped };
  }

  return {
    onChange: onChange,
    TYPES: TYPES,
    getAll: getAll,
    get: get,
    add: add,
    update: update,
    remove: remove,
    clearAll: clearAll,
    countAll: countAll,
    exportAll: exportAll,
    importAll: importAll
  };
})();

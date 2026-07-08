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
  var TYPES = ["sleep", "food", "exercise", "body", "water", "steps", "goal", "adjustments"];
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
        try { localStorage.setItem(key(type) + ".corrupt", raw); } catch (e2) {
          console.error("OF.storage: could not back up corrupt data for", type, e2);
        }
        OF.util.toast('Saved ' + type + ' data could not be read. A copy was kept under "' +
          key(type) + '.corrupt" — export it before adding new entries.', "warn");
      }
      return [];
    }
  }

  /**
   * Persist the full array for a type. Returns true on success; on failure
   * (quota exceeded, private mode, storage disabled) shows a visible error
   * and returns false — callers must not pretend the write happened.
   */
  function saveAll(type, arr) {
    try {
      localStorage.setItem(key(type), JSON.stringify(arr));
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

  /** Wipe every optimalfit.* key. */
  function clearAll() {
    TYPES.forEach(function (t) { localStorage.removeItem(key(t)); });
  }

  /** Total record count across all types. */
  function countAll() {
    return TYPES.reduce(function (n, t) { return n + getAll(t).length; }, 0);
  }

  /** Export everything as a pretty JSON string. */
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
    return JSON.stringify(out, null, 2);
  }

  /* ---------- Import normalization ---------- */

  var NUM_FIELDS = {
    sleep: ["quality", "durationMin"],
    food: ["calories", "protein", "carbs", "fat"],
    exercise: ["durationMin", "intensity", "performance"],
    body: ["weightKg", "bodyFatPct", "muscleMassPct"],
    water: ["amountMl"],
    steps: ["count"],
    goal: ["targetAmountKg", "heightCm", "age"],
    adjustments: ["delta", "from", "to"]
  };

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
      bodyFatPct: { min: 0, max: 100 }, muscleMassPct: { min: 0, max: 100 }
    },
    water: { amountMl: { min: 0, max: 10000 } },
    steps: { count: { min: 0, max: 200000 } }
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
   * Normalize one imported record: coerce expected numeric fields,
   * default missing enum fields, stringify foreign ids. Returns a
   * cleaned copy, or null if the record lacks the essential `date`.
   */
  function normalizeRecord(type, r) {
    if (!r || typeof r !== "object" || Array.isArray(r)) return null;
    if (typeof r.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return null;
    var rec = Object.assign({}, r);
    if (rec.id != null && typeof rec.id !== "string") rec.id = String(rec.id);
    NUM_FIELDS[type].forEach(function (f) { rec[f] = clampNum(type, f, coerceNum(rec[f])); });
    if (type === "exercise" && !rec.type) rec.type = "other";
    if (type === "exercise" && rec.exercises !== undefined) {
      var exs = sanitizeExercises(rec.exercises);
      if (exs) rec.exercises = exs; else delete rec.exercises;
    }
    if (type === "food" && !rec.mealType) rec.mealType = "snack";
    if (type === "sleep" && rec.durationMin == null) {
      rec.durationMin = clampNum(type, "durationMin",
        coerceNum(OF.util.sleepDurationMin(rec.bedTime, rec.wakeTime)));
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

    if (mode === "replace") clearAll();

    var imported = 0, skipped = 0, writeFailed = false;
    TYPES.forEach(function (t) {
      var incoming = Array.isArray(data[t]) ? data[t] : [];
      if (!incoming.length) return;
      var current = getAll(t);
      var seen = {};
      current.forEach(function (r) { if (r && r.id) seen[r.id] = true; });
      incoming.forEach(function (raw) {
        var r = normalizeRecord(t, raw);
        if (!r) { skipped++; return; } // not an object / missing essential date
        if (r.id && seen[r.id]) { skipped++; return; } // already have it (merge)
        if (!r.id) r.id = OF.util.uid();
        if (!r.createdAt) r.createdAt = new Date().toISOString();
        r.updatedAt = r.updatedAt || r.createdAt;
        current.push(r);
        seen[r.id] = true;
        imported++;
      });
      if (!saveAll(t, current)) writeFailed = true;
    });
    // Restore unit preferences when the backup carries them (merge = keep current).
    if (mode === "replace" && parsed.prefs && typeof parsed.prefs === "object" &&
        !Array.isArray(parsed.prefs) && OF.units) {
      OF.units.setPrefs(parsed.prefs);
    }
    if (writeFailed) {
      throw new Error("Browser storage is full or blocked — the imported data was NOT fully saved.");
    }
    return { imported: imported, skipped: skipped };
  }

  return {
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

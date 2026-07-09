/* ============================================================
   exercise.js — workout tracker: form + history list.
   Record: { date, startTime, type, durationMin, intensity 1-5,
             performance 1-5 ("how good did the session feel"),
             notes,
             exercises?: [{ name, sets: [{weightKg: number|null,
                                          reps: int}] }] }
   `exercises` is OPTIONAL (older records don't have it).
   weightKg null = bodyweight movement. Weights are stored in kg;
   the builder inputs use the display unit (lb/kg) and convert on
   save. Untouched weight inputs keep their exact stored kg so an
   edit round-trip (in either unit) never drifts a value.
   ============================================================ */

window.OF = window.OF || {};

OF.exercise = (function () {
  "use strict";
  var U = OF.util, S = OF.storage;
  var els = {};

  var MAX_EXERCISES = 30, MAX_SETS = 30;

  /* Builder state: [{ name, sets: [{kg: number|null|NaN, reps: number|null|NaN,
     wRaw: string, rRaw: string}] }]. kg is the source of truth; it is only
     recomputed from wRaw when the user actually edits that input. */
  var exList = [];

  function init() {
    els.form = document.getElementById("exercise-form");
    els.editId = document.getElementById("exercise-edit-id");
    els.date = document.getElementById("exercise-date");
    els.start = document.getElementById("exercise-start");
    els.type = document.getElementById("exercise-type");
    els.duration = document.getElementById("exercise-duration");
    els.intensity = document.getElementById("exercise-intensity");
    els.performance = document.getElementById("exercise-performance");
    els.notes = document.getElementById("exercise-notes");
    els.error = document.getElementById("exercise-error");
    els.submit = document.getElementById("exercise-submit");
    els.cancel = document.getElementById("exercise-cancel-edit");
    els.title = document.getElementById("exercise-form-title");
    els.list = document.getElementById("exercise-list");
    els.summary = document.getElementById("exercise-summary");
    els.exWrap = document.getElementById("exercise-ex-list");
    els.addName = document.getElementById("exercise-add-name");
    els.addBtn = document.getElementById("exercise-add-btn");
    els.nameList = document.getElementById("exercise-name-list");

    setDefaults();
    els.form.addEventListener("submit", onSubmit);
    els.cancel.addEventListener("click", exitEditMode);
    els.list.addEventListener("click", onListClick);
    initBuilder();
    initTimer();
    renderList();
  }

  function setDefaults() {
    els.date.value = U.todayISO();
    els.start.value = U.nowTime();
    els.type.value = "strength";
    els.duration.value = "60";
    els.intensity.value = "3";
    els.performance.value = "3";
    els.notes.value = "";
    if (OF.ui) OF.ui.syncSegs(); // reflect onto the rating pills
    exList = [];
    renderBuilder();
  }

  function showError(msg) {
    els.error.textContent = msg;
    els.error.hidden = !msg;
  }

  /* ============================================================
     Exercises & sets builder
     ============================================================ */

  /** Distinct exercise names ever logged (for the autocomplete datalist). */
  function knownNames() {
    var seen = {}, out = [];
    S.getAll("exercise").forEach(function (r) {
      if (!Array.isArray(r.exercises)) return;
      r.exercises.forEach(function (ex) {
        if (!ex || typeof ex.name !== "string") return;
        var name = ex.name.trim();
        var k = name.toLowerCase();
        if (name && !seen[k]) { seen[k] = true; out.push(name); }
      });
    });
    return out.sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; });
  }

  function refreshDatalist() {
    if (!els.nameList) return;
    els.nameList.innerHTML = knownNames().map(function (n) {
      return '<option value="' + U.esc(n) + '"></option>';
    }).join("");
  }

  /** Display string for a stored kg value (or "" for bodyweight). */
  function kgToRaw(kg) {
    if (kg == null || !isFinite(Number(kg))) return "";
    var v = U.toDisplayWeight(Number(kg), 1);
    return v == null ? "" : String(v);
  }

  /**
   * Seed a builder set from a STORED set ({weightKg, reps}). kg is kept
   * exact (the source of truth) and the display strings are derived from
   * it, so an untouched save round-trips byte-identical in either unit.
   * Shared by edit mode AND last-session prefill (Feature B) so both use
   * one convention. Bodyweight (null) stays empty weight, never 0.
   */
  function seedSet(s) {
    // Number(null) is 0 — bodyweight (null) must stay null, not 0 kg.
    var kg = (s && s.weightKg != null && isFinite(Number(s.weightKg))) ? Number(s.weightKg) : null;
    var reps = (s && s.reps != null && isFinite(Number(s.reps))) ? Math.round(Number(s.reps)) : null;
    return { kg: kg, reps: reps, wRaw: kgToRaw(kg), rRaw: reps == null ? "" : String(reps) };
  }

  /**
   * Most recent past session's sets for an exercise name (case-insensitive,
   * trimmed). Scans exercise history newest-first and returns the matching
   * exercise's stored sets [{weightKg, reps}] — already sane from save /
   * import — or null if the name was never logged before. Feature B prefill.
   */
  function lastSetsFor(name) {
    var target = (name || "").trim().toLowerCase();
    if (!target) return null;
    var arr = S.getAll("exercise").slice().sort(U.byNewest);
    for (var i = 0; i < arr.length; i++) {
      var exs = arr[i].exercises;
      if (!Array.isArray(exs)) continue;
      for (var j = 0; j < exs.length; j++) {
        var ex = exs[j];
        if (ex && typeof ex.name === "string" && ex.name.trim().toLowerCase() === target &&
            Array.isArray(ex.sets) && ex.sets.length) {
          return ex.sets;
        }
      }
    }
    return null;
  }

  function newSetFrom(prev) {
    if (prev) return { kg: prev.kg, reps: prev.reps, wRaw: prev.wRaw, rRaw: prev.rRaw };
    return { kg: null, reps: null, wRaw: "", rRaw: "" };
  }

  function addExercise(name) {
    name = (name || "").trim().slice(0, 80);
    if (!name) { showError("Type an exercise name first (e.g. Bench Press)."); return; }
    if (exList.length >= MAX_EXERCISES) {
      showError("Maximum " + MAX_EXERCISES + " exercises per workout."); return;
    }
    showError("");
    // Feature B: prefill with the most recent past session's sets for this
    // name (via seedSet, so an untouched save round-trips byte-identical).
    var past = lastSetsFor(name);
    var sets, prefilled = false;
    if (past && past.length) {
      sets = past.slice(0, MAX_SETS).map(seedSet);
      prefilled = true;
    } else {
      sets = [{ kg: null, reps: null, wRaw: "", rRaw: "" }];
    }
    exList.push({ name: name, sets: sets, prefilled: prefilled });
    els.addName.value = "";
    renderBuilder();
    // focus the new exercise's first weight input for fast keyboard entry / adjusting
    var inputs = els.exWrap.querySelectorAll('[data-ex="' + (exList.length - 1) + '"][data-field="w"]');
    if (inputs.length) inputs[0].focus();
  }

  function renderBuilder() {
    if (!els.exWrap) return;
    var unit = U.weightUnit();
    els.exWrap.innerHTML = exList.map(function (ex, i) {
      var rows = ex.sets.map(function (s, j) {
        return '<div class="set-row">' +
          '<span class="set-num" aria-hidden="true">' + (j + 1) + '</span>' +
          '<input type="number" inputmode="decimal" step="0.5" min="0" ' +
            'value="' + U.esc(s.wRaw) + '" data-ex="' + i + '" data-set="' + j + '" data-field="w" ' +
            'placeholder="bodyweight" aria-label="Set ' + (j + 1) + ' weight (' + unit + ')">' +
          '<span class="set-x">' + U.esc(unit) + ' &times;</span>' +
          '<input type="number" inputmode="numeric" step="1" min="1" max="100" ' +
            'value="' + U.esc(s.rRaw) + '" data-ex="' + i + '" data-set="' + j + '" data-field="r" ' +
            'placeholder="reps" aria-label="Set ' + (j + 1) + ' reps">' +
          '<button type="button" class="btn set-del" data-act="del-set" data-ex="' + i +
            '" data-set="' + j + '" aria-label="Remove set ' + (j + 1) + '">&times;</button>' +
          '</div>';
      }).join("");
      return '<div class="ex-item">' +
        '<div class="ex-item-head">' +
          '<span class="ex-item-name">' + U.esc(ex.name) + '</span>' +
          '<button type="button" class="btn set-del" data-act="del-ex" data-ex="' + i +
            '" aria-label="Remove ' + U.esc(ex.name) + '">Remove</button>' +
        '</div>' +
        (ex.prefilled ? '<div class="ex-prefill-hint">Prefilled from your last session &mdash; tap to adjust.</div>' : '') +
        rows +
        '<button type="button" class="btn set-add" data-act="add-set" data-ex="' + i + '">+ Set</button>' +
        '</div>';
    }).join("");
  }

  function initBuilder() {
    if (!els.exWrap) return;
    refreshDatalist();

    els.addBtn.addEventListener("click", function () { addExercise(els.addName.value); });
    // Enter in the name box adds the exercise instead of submitting the form.
    els.addName.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); addExercise(els.addName.value); }
    });

    els.exWrap.addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-act]");
      if (!btn) return;
      var i = parseInt(btn.getAttribute("data-ex"), 10);
      var ex = exList[i];
      if (!ex) return;
      var act = btn.getAttribute("data-act");
      if (act === "add-set") {
        if (ex.sets.length >= MAX_SETS) { showError("Maximum " + MAX_SETS + " sets per exercise."); return; }
        ex.sets.push(newSetFrom(ex.sets[ex.sets.length - 1])); // duplicate last set's values
        renderBuilder();
        var ins = els.exWrap.querySelectorAll('[data-ex="' + i + '"][data-field="w"]');
        if (ins.length) ins[ins.length - 1].focus();
      } else if (act === "del-set") {
        var j = parseInt(btn.getAttribute("data-set"), 10);
        ex.sets.splice(j, 1);
        if (!ex.sets.length) exList.splice(i, 1); // last set removed -> drop the exercise
        renderBuilder();
      } else if (act === "del-ex") {
        exList.splice(i, 1);
        renderBuilder();
      }
    });

    // Input edits update state only (no re-render, so focus is kept).
    els.exWrap.addEventListener("input", function (e) {
      var inp = e.target;
      if (!inp.hasAttribute || !inp.hasAttribute("data-field")) return;
      var ex = exList[parseInt(inp.getAttribute("data-ex"), 10)];
      var s = ex && ex.sets[parseInt(inp.getAttribute("data-set"), 10)];
      if (!s) return;
      if (inp.getAttribute("data-field") === "w") {
        s.wRaw = inp.value;
        var v = U.numOrNull(inp.value);
        // null = bodyweight; NaN marks garbage until the user fixes it
        s.kg = v === null ? null : (isNaN(v) ? NaN : U.fromDisplayWeight(v));
      } else {
        s.rRaw = inp.value;
        var r = U.numOrNull(inp.value);
        s.reps = r === null ? null : (isNaN(r) ? NaN : Math.round(r));
      }
    });
  }

  /** Builder state -> storable exercises array (or an {err}). */
  function readExercises() {
    if (!exList.length) return { list: null };
    var out = [];
    for (var i = 0; i < exList.length && i < MAX_EXERCISES; i++) {
      var ex = exList[i];
      var sets = [];
      for (var j = 0; j < ex.sets.length && j < MAX_SETS; j++) {
        var s = ex.sets[j];
        var wEmpty = !(s.wRaw && String(s.wRaw).trim() !== "");
        var rEmpty = !(s.rRaw && String(s.rRaw).trim() !== "");
        if (wEmpty && rEmpty) continue; // fully blank row: ignore silently
        if (rEmpty || s.reps == null || isNaN(s.reps) || s.reps < 1 || s.reps > 100) {
          return { err: ex.name + ", set " + (j + 1) + ": reps must be a whole number from 1 to 100." };
        }
        var kg = null;
        if (!wEmpty) {
          if (s.kg == null || isNaN(s.kg)) {
            return { err: ex.name + ", set " + (j + 1) + ": weight must be a number (leave it empty for bodyweight)." };
          }
          kg = Math.round(s.kg * 10000) / 10000;
          if (kg < 0 || kg > 500) {
            return { err: ex.name + ", set " + (j + 1) + ": weight must be between 0 and " + U.fmtWeight(500, 0) + "." };
          }
        }
        sets.push({ weightKg: kg, reps: s.reps });
      }
      if (sets.length) out.push({ name: ex.name.trim().slice(0, 80), sets: sets });
    }
    return { list: out.length ? out : null };
  }

  /* ============================================================
     Form submit / edit
     ============================================================ */

  function readForm() {
    if (!els.date.value) return { err: "Please pick a date." };
    if (!els.start.value) return { err: "Please enter a start time." };
    var dur = U.numOrNull(els.duration.value);
    if (dur === null || isNaN(dur) || dur <= 0 || dur > 600) {
      return { err: "Duration must be between 1 and 600 minutes." };
    }
    var intensity = parseInt(els.intensity.value, 10);
    if (!(intensity >= 1 && intensity <= 5)) return { err: "Intensity must be between 1 and 5." };
    var performance = parseInt(els.performance.value, 10);
    if (!(performance >= 1 && performance <= 5)) return { err: "Performance must be between 1 and 5." };
    var exs = readExercises();
    if (exs.err) return { err: exs.err };
    return {
      rec: {
        date: els.date.value,
        startTime: els.start.value,
        type: els.type.value,
        durationMin: Math.round(dur),
        intensity: intensity,
        performance: performance,
        notes: els.notes.value.trim(),
        // undefined is dropped by JSON.stringify, so a record whose sets were
        // all removed loses the key entirely (old records stay old-shaped).
        exercises: exs.list || undefined
      }
    };
  }

  function onSubmit(e) {
    e.preventDefault();
    var r = readForm();
    if (r.err) { showError(r.err); return; }
    showError("");
    var editId = els.editId.value;
    if (editId) {
      if (!S.update("exercise", editId, r.rec)) {
        showError("Could not save — browser storage is full or blocked. Your entry was NOT saved.");
        return;
      }
      exitEditMode();
    } else {
      if (!S.add("exercise", r.rec)) {
        showError("Could not save — browser storage is full or blocked. Your entry was NOT saved.");
        return;
      }
      setDefaults();
    }
    renderList();
    OF.dashboard && OF.dashboard.refresh();
  }

  function enterEditMode(rec) {
    els.editId.value = rec.id;
    els.date.value = rec.date;
    els.start.value = rec.startTime;
    els.type.value = rec.type || "other";
    els.duration.value = String(rec.durationMin || "");
    els.intensity.value = String(rec.intensity || 3);
    els.performance.value = String(rec.performance || 3);
    els.notes.value = rec.notes || "";
    if (OF.ui) OF.ui.syncSegs();
    // Sets round-trip: kg kept exact, display strings derived from it (seedSet).
    exList = (Array.isArray(rec.exercises) ? rec.exercises : []).map(function (ex) {
      return {
        name: typeof ex.name === "string" ? ex.name : "",
        sets: (Array.isArray(ex.sets) ? ex.sets : []).map(seedSet)
      };
    }).filter(function (ex) { return ex.name; });
    renderBuilder();
    els.title.textContent = "Edit workout";
    els.submit.textContent = "Save changes";
    els.cancel.classList.remove("hidden");
    els.form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function exitEditMode() {
    els.editId.value = "";
    els.title.textContent = "Log a workout";
    els.submit.textContent = "Add workout";
    els.cancel.classList.add("hidden");
    showError("");
    setDefaults();
  }

  function onListClick(e) {
    var btn = e.target.closest("button[data-act]");
    if (!btn) return;
    var id = btn.getAttribute("data-id");
    if (btn.getAttribute("data-act") === "del") {
      if (confirm("Delete this workout?")) {
        S.remove("exercise", id);
        if (els.editId.value === id) exitEditMode();
        renderList();
        OF.dashboard && OF.dashboard.refresh();
      }
    } else {
      var rec = S.get("exercise", id);
      if (rec) enterEditMode(rec);
    }
  }

  /* ============================================================
     History list
     ============================================================ */

  /** This week's summary strip above the form. */
  function renderSummary() {
    if (!els.summary) return;
    var arr = S.getAll("exercise");
    if (!arr.length) { els.summary.innerHTML = ""; return; }
    var cutoff = U.todayISO(-6);
    var week = arr.filter(function (r) { return r.date >= cutoff; });
    var mins = week.reduce(function (n, r) {
      return n + (isFinite(Number(r.durationMin)) ? Number(r.durationMin) : 0);
    }, 0);
    els.summary.innerHTML =
      '<span class="entry-ico">' + OF.icons.get("dumbbell") + '</span>' +
      '<span>Last 7 days: <strong>' + week.length + '</strong> workout' +
      (week.length === 1 ? '' : 's') + '</span>' +
      (mins ? '<span><strong>' + U.esc(String(mins)) + ' min</strong> total</span>' : '');
  }

  /** "185 lb" (display unit, trims trailing .0). */
  function wTxt(kg) { return U.fmtWeight(kg, 1); }

  /**
   * One-line summary for a logged exercise:
   *   "3×8 @ 185 lb · top set 190 lb × 6"  (uniform work + a heavier top set)
   *   "3×12 bodyweight"
   */
  function exSummaryTxt(ex) {
    var sets = (Array.isArray(ex.sets) ? ex.sets : []).filter(function (s) {
      return s && s.reps != null && isFinite(Number(s.reps)) && Number(s.reps) >= 1;
    });
    if (!sets.length) return null;
    function kgOf(s) { // Number(null) is 0 — bodyweight must stay null
      return (s.weightKg != null && isFinite(Number(s.weightKg))) ? Number(s.weightKg) : null;
    }
    // most common (weight, reps) combo = the "work sets"
    var combos = {}, order = [];
    sets.forEach(function (s) {
      var kg = kgOf(s);
      var k = (kg == null ? "bw" : kg) + "x" + s.reps;
      if (!combos[k]) { combos[k] = { kg: kg, reps: Number(s.reps), n: 0 }; order.push(k); }
      combos[k].n++;
    });
    var main = order.map(function (k) { return combos[k]; })
      .sort(function (a, b) { return b.n - a.n; })[0];
    var txt = main.n + "×" + main.reps + (main.kg == null ? " bodyweight" : " @ " + wTxt(main.kg));
    // top set = the HEAVIEST set (most reps when all bodyweight)
    var top = null;
    sets.forEach(function (s) {
      var kg = kgOf(s), reps = Number(s.reps);
      if (!top ||
          (kg != null && (top.kg == null || kg > top.kg || (kg === top.kg && reps > top.reps))) ||
          (kg == null && top.kg == null && reps > top.reps)) {
        top = { kg: kg, reps: reps };
      }
    });
    if (top && order.length > 1 && !(top.kg === main.kg && top.reps === main.reps)) {
      txt += " · top set " + (top.kg == null ? "bodyweight" : wTxt(top.kg)) + " × " + top.reps;
    }
    return txt;
  }

  function setsHtml(rec) {
    if (!Array.isArray(rec.exercises) || !rec.exercises.length) return "";
    var lines = rec.exercises.map(function (ex) {
      if (!ex || typeof ex.name !== "string") return "";
      var sum = exSummaryTxt(ex);
      if (!sum) return "";
      return '<div class="set-line">' + U.esc(ex.name.trim().slice(0, 80)) +
        ' <span class="set-line-detail">&mdash; ' + U.esc(sum) + '</span></div>';
    }).filter(Boolean);
    return lines.length ? '<div class="entry-sets">' + lines.join("") + '</div>' : "";
  }

  function renderList() {
    renderSummary();
    refreshDatalist();
    var arr = S.getAll("exercise").slice().sort(U.byNewest);
    if (!arr.length) {
      els.list.innerHTML = '<div class="empty-state">' + OF.icons.badge("dumbbell") +
        '<p>No workouts logged yet — log a session above and your training history shows up here.</p></div>';
      return;
    }
    els.list.innerHTML = arr.map(function (r) {
      var t0 = r.type || "other";
      var title = t0.charAt(0).toUpperCase() + t0.slice(1) + " · " + r.durationMin + " min";
      var sub = U.fmtDate(r.date) + " " + r.startTime +
        " · intensity " + r.intensity + "/5" +
        (r.notes ? " · " + r.notes : "");
      var perf = "perf " + r.performance + "/5";
      return '<div class="entry">' +
        '<span class="entry-ico">' + OF.icons.get("dumbbell") + '</span>' +
        '<div class="entry-main">' +
          '<div class="entry-title">' + U.esc(title) + '</div>' +
          '<div class="entry-sub">' + U.esc(sub) + '</div>' +
          setsHtml(r) +
        '</div>' +
        '<span class="entry-badge" title="Performance rating">' + U.esc(perf) + '</span>' +
        '<div class="entry-actions">' +
          '<button class="btn mini" data-act="edit" data-id="' + U.esc(r.id) + '">Edit</button>' +
          '<button class="btn mini danger" data-act="del" data-id="' + U.esc(r.id) + '">Delete</button>' +
        '</div>' +
      '</div>';
    }).join("");
  }

  /* ============================================================
     Feature A — Rest timer (countdown + stopwatch)

     iOS / WKWebView notes:
       - navigator.vibrate is NOT supported on iOS Safari/WKWebView,
         so it is BEST-EFFORT only (wrapped, never relied on).
       - The finish cue uses WebAudio. AudioContext starts SUSPENDED
         in WKWebView until a user gesture, so we create/resume it
         inside the first Start tap (a real gesture). Once unlocked
         it can play the eventual finish beep without another tap.
       - There is also an unmissable VISUAL cue (color change +
         "Rest done!" text) since audio may be muted.

     Lifecycle: the running timer is EPHEMERAL — a full page reload
     clears it (by design). It keeps ticking while you navigate
     between in-app tabs, because this is a single page and the
     interval is never torn down. Only the last-used countdown preset
     persists (in optimalfit.prefs via OF.units).
     ============================================================ */

  var PRESETS = [60, 90, 120, 180];        // 1:00 / 1:30 / 2:00 / 3:00
  var MAX_TIMER_MS = 59 * 60 * 1000 + 59 * 1000; // clamp countdown to 59:59

  var T = {
    mode: "countdown",
    presetSec: 90,        // last-used countdown preset (persisted)
    running: false,
    finished: false,
    remainingMs: 90000,   // countdown value (frozen when paused)
    elapsedMs: 0,         // stopwatch value (frozen when paused)
    deadline: 0,          // countdown: Date.now() target while running
    startAt: 0,           // stopwatch: Date.now() base while running
    intId: null
  };
  var audioCtx = null;
  var tEls = {};

  /** secs -> "M:SS" (or "H:MM:SS" past an hour). */
  function fmtClock(secs) {
    secs = Math.max(0, Math.round(secs));
    var h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
    var ss = (s < 10 ? "0" : "") + s;
    if (h > 0) return h + ":" + (m < 10 ? "0" : "") + m + ":" + ss;
    return m + ":" + ss;
  }

  function loadPreset() {
    var sec = 90;
    try {
      var p = (OF.units && OF.units.prefs) ? OF.units.prefs() : {};
      var v = p && p.restPreset;
      if (v != null && isFinite(Number(v))) {
        v = Math.round(Number(v));
        if (v >= 15 && v <= MAX_TIMER_MS / 1000) sec = v;
      }
    } catch (e) { /* fall back to default */ }
    T.presetSec = sec;
  }

  function savePreset(sec) {
    try { if (OF.units && OF.units.setPrefs) OF.units.setPrefs({ restPreset: sec }); }
    catch (e) { /* pref persistence is best-effort */ }
  }

  /* ---- WebAudio (unlocked on the Start gesture) ---- */
  function ensureAudio() {
    try {
      if (!audioCtx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (AC) audioCtx = new AC();
      }
      if (audioCtx && audioCtx.state === "suspended" && audioCtx.resume) audioCtx.resume();
    } catch (e) { audioCtx = null; }
  }

  function beep() {
    if (!audioCtx) return;
    try {
      var now = audioCtx.currentTime;
      [0, 0.22, 0.44].forEach(function (t, i) {
        var osc = audioCtx.createOscillator();
        var g = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.value = 784 + i * 130; // gentle rising tri-tone
        g.gain.setValueAtTime(0.0001, now + t);
        g.gain.exponentialRampToValueAtTime(0.22, now + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.16);
        osc.connect(g); g.connect(audioCtx.destination);
        osc.start(now + t);
        osc.stop(now + t + 0.18);
      });
    } catch (e) { /* audio is best-effort */ }
  }

  function finishCue() {
    T.finished = true;
    beep();
    try { if (navigator.vibrate) navigator.vibrate([120, 80, 120]); } catch (e) { /* iOS ignores */ }
    updateDisplay();
  }

  /* ---- interval / ticking (wall-clock anchored so it stays accurate) ---- */
  function stopInterval() { if (T.intId) { clearInterval(T.intId); T.intId = null; } }
  function startInterval() { stopInterval(); T.intId = setInterval(tick, 200); }

  function tick() {
    if (!T.running) return;
    if (T.mode === "countdown") {
      T.remainingMs = T.deadline - Date.now();
      if (T.remainingMs <= 0) {
        T.remainingMs = 0;
        T.running = false;
        stopInterval();
        finishCue(); // auto-stop at 0 + fire the cue
        return;
      }
    } else {
      T.elapsedMs = Date.now() - T.startAt;
    }
    updateDisplay();
  }

  function startPause() {
    if (T.running) { pauseTimer(); return; }
    ensureAudio();          // create/resume inside this user gesture
    T.finished = false;
    T.running = true;
    if (T.mode === "countdown") {
      if (T.remainingMs <= 0) T.remainingMs = T.presetSec * 1000; // finished -> restart from preset
      T.deadline = Date.now() + T.remainingMs;
    } else {
      T.startAt = Date.now() - T.elapsedMs;
    }
    startInterval();
    updateDisplay();
  }

  function pauseTimer() {
    if (T.mode === "countdown") T.remainingMs = Math.max(0, T.deadline - Date.now());
    else T.elapsedMs = Date.now() - T.startAt;
    T.running = false;
    stopInterval();
    updateDisplay();
  }

  function resetTimer() {
    stopInterval();
    T.running = false;
    T.finished = false;
    if (T.mode === "countdown") T.remainingMs = T.presetSec * 1000;
    else T.elapsedMs = 0;
    updateDisplay();
  }

  function setMode(mode) {
    if ((mode !== "countdown" && mode !== "stopwatch") || mode === T.mode) return;
    stopInterval();
    T.running = false;
    T.finished = false;
    T.mode = mode;
    if (mode === "countdown") T.remainingMs = T.presetSec * 1000;
    else T.elapsedMs = 0;
    updateDisplay();
  }

  function applyPreset(sec) {
    if (!isFinite(sec) || sec <= 0) return;
    T.presetSec = sec;
    savePreset(sec);
    stopInterval();
    T.running = false;
    T.finished = false;
    T.remainingMs = sec * 1000;
    updateDisplay();
  }

  function adjust(deltaSec) {
    if (T.mode !== "countdown") return;
    var d = deltaSec * 1000;
    if (T.running) {
      T.deadline = Math.min(Date.now() + MAX_TIMER_MS, Math.max(Date.now(), T.deadline + d));
      T.remainingMs = Math.max(0, T.deadline - Date.now());
    } else {
      T.remainingMs = Math.max(0, Math.min(MAX_TIMER_MS, T.remainingMs + d));
    }
    T.finished = false;
    updateDisplay();
  }

  function updateDisplay() {
    if (!tEls.time) return;
    var isC = T.mode === "countdown";
    var ms = isC ? T.remainingMs : T.elapsedMs;
    // ceil on countdown so it shows the full starting value and lands on 0:00.
    var secs = isC ? Math.ceil(ms / 1000) : Math.floor(ms / 1000);
    tEls.time.textContent = fmtClock(secs);

    tEls.start.textContent = T.running ? "Pause" : (T.finished ? "Restart" : "Start");
    tEls.start.setAttribute("aria-label",
      (T.running ? "Pause " : "Start ") + (isC ? "rest countdown" : "stopwatch"));

    if (T.finished) {
      tEls.wrap.classList.add("rt-finished");
      tEls.status.textContent = "Rest done!";
    } else {
      tEls.wrap.classList.remove("rt-finished");
      tEls.status.textContent = T.running ? (isC ? "Resting…" : "Timing…") : "";
    }

    Array.prototype.forEach.call(tEls.modeBtns, function (b) {
      var on = b.getAttribute("data-mode") === T.mode;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    Array.prototype.forEach.call(tEls.presetBtns, function (b) {
      b.classList.toggle("active", parseInt(b.getAttribute("data-sec"), 10) === T.presetSec);
    });
    // presets + adjust only make sense for countdown
    Array.prototype.forEach.call(tEls.cdOnly, function (el) { el.classList.toggle("hidden", !isC); });
  }

  function onTimerClick(e) {
    var btn = e.target.closest("button[data-rt]");
    if (!btn) return;
    var kind = btn.getAttribute("data-rt");
    if (kind === "start") startPause();
    else if (kind === "reset") resetTimer();
    else if (kind === "mode") setMode(btn.getAttribute("data-mode"));
    else if (kind === "preset") applyPreset(parseInt(btn.getAttribute("data-sec"), 10));
    else if (kind === "adj") adjust(parseInt(btn.getAttribute("data-delta"), 10));
  }

  function renderTimer(host) {
    host.innerHTML =
      '<div class="rt">' +
        '<div class="rt-top">' +
          '<h2 class="rt-title">Rest timer</h2>' +
          '<div class="rt-seg" role="tablist" aria-label="Timer mode">' +
            '<button type="button" class="rt-seg-btn" data-rt="mode" data-mode="countdown" ' +
              'role="tab" aria-selected="true">Countdown</button>' +
            '<button type="button" class="rt-seg-btn" data-rt="mode" data-mode="stopwatch" ' +
              'role="tab" aria-selected="false">Stopwatch</button>' +
          '</div>' +
        '</div>' +
        '<div class="rt-display">' +
          '<div class="rt-time" role="timer" aria-atomic="true">0:00</div>' +
          '<div class="rt-status" role="status" aria-live="polite"></div>' +
        '</div>' +
        '<div class="rt-presets" data-cd>' +
          PRESETS.map(function (sec) {
            var lbl = fmtClock(sec);
            return '<button type="button" class="btn rt-preset" data-rt="preset" data-sec="' + sec +
              '" aria-label="Set rest to ' + lbl + '">' + lbl + '</button>';
          }).join("") +
        '</div>' +
        '<div class="rt-controls">' +
          '<button type="button" class="btn primary rt-start" data-rt="start" ' +
            'aria-label="Start rest countdown">Start</button>' +
          '<button type="button" class="btn rt-reset" data-rt="reset" aria-label="Reset timer">Reset</button>' +
          '<div class="rt-adjust" data-cd>' +
            '<button type="button" class="btn rt-adj" data-rt="adj" data-delta="-15" ' +
              'aria-label="Subtract 15 seconds">&minus;15s</button>' +
            '<button type="button" class="btn rt-adj" data-rt="adj" data-delta="15" ' +
              'aria-label="Add 15 seconds">+15s</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    tEls.wrap = host.querySelector(".rt");
    tEls.time = host.querySelector(".rt-time");
    tEls.status = host.querySelector(".rt-status");
    tEls.start = host.querySelector(".rt-start");
    tEls.modeBtns = host.querySelectorAll('[data-rt="mode"]');
    tEls.presetBtns = host.querySelectorAll('[data-rt="preset"]');
    tEls.cdOnly = host.querySelectorAll('[data-cd]');
    host.addEventListener("click", onTimerClick);
  }

  function initTimer() {
    var host = document.getElementById("exercise-timer");
    if (!host) return;
    loadPreset();
    T.mode = "countdown";
    T.running = false;
    T.finished = false;
    T.remainingMs = T.presetSec * 1000;
    T.elapsedMs = 0;
    renderTimer(host);
    updateDisplay();
  }

  return { init: init, renderList: renderList };
})();

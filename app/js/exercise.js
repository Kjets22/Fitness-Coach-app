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
    exList.push({ name: name, sets: [{ kg: null, reps: null, wRaw: "", rRaw: "" }] });
    els.addName.value = "";
    renderBuilder();
    // focus the new set's weight input for fast keyboard entry
    var inputs = els.exWrap.querySelectorAll('[data-ex="' + (exList.length - 1) + '"][data-field="w"]');
    if (inputs.length) inputs[inputs.length - 1].focus();
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
    // Sets round-trip: kg kept exact, display strings derived from it.
    exList = (Array.isArray(rec.exercises) ? rec.exercises : []).map(function (ex) {
      return {
        name: typeof ex.name === "string" ? ex.name : "",
        sets: (Array.isArray(ex.sets) ? ex.sets : []).map(function (s) {
          // Number(null) is 0 — bodyweight (null) must stay null, not 0 kg.
          var kg = (s && s.weightKg != null && isFinite(Number(s.weightKg))) ? Number(s.weightKg) : null;
          var reps = (s && s.reps != null && isFinite(Number(s.reps))) ? Math.round(Number(s.reps)) : null;
          return { kg: kg, reps: reps, wRaw: kgToRaw(kg), rRaw: reps == null ? "" : String(reps) };
        })
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

  return { init: init, renderList: renderList };
})();

/* ============================================================
   exercise.js — workout tracker built around a LIVE SESSION,
   like Strong/Hevy.

   Flow:
     Start workout  -> a live session begins; a wall-clock timer runs
                       and KEEPS running even if the app is closed
                       (elapsed is derived from a stored start timestamp).
                       Add exercises + sets as you go.
     Complete       -> a finish step: confirm duration, then the
                       intensity / performance / notes ratings (moved to
                       the END so you fill them after training), then Save.
     Log past workout -> a manual form (date/time/duration + builder +
                       ratings) for back-filling something you didn't
                       time live. Also used to Edit an existing workout.

   The active session is persisted in localStorage (optimalfit.activeWorkout)
   so closing/reopening the app resumes it with the correct elapsed time.

   Saved record (unchanged shape, backward compatible):
     { date, startTime, type, durationMin, intensity 1-5,
       performance 1-5, notes,
       exercises?: [{ name, sets: [{weightKg: number|null, reps: int}] }] }
   weightKg null = bodyweight. Weights stored in kg; builder inputs use the
   display unit and convert on save.
   ============================================================ */

window.OF = window.OF || {};

OF.exercise = (function () {
  "use strict";
  var U = OF.util, S = OF.storage;
  var els = {};

  var MAX_EXERCISES = 30, MAX_SETS = 30;
  var ACTIVE_KEY = "optimalfit.activeWorkout";

  var TYPES = [
    ["strength", "Strength"], ["cardio", "Cardio"], ["sports", "Sports"],
    ["flexibility", "Flexibility"], ["other", "Other"]
  ];

  /* Builder state, shared by the live session and the manual form:
     [{ name, sets: [{kg:number|null|NaN, reps:number|null|NaN,
        wRaw:string, rRaw:string}], prefilled? }].
     kg is the source of truth; recomputed from wRaw only when edited. */
  var exList = [];

  var builderHost = null;   // the DOM node the builder currently renders into
  var mode = "hub";         // "hub" | "active" | "manual"
  var sessType = "strength";
  var sessIntId = null;     // live-timer interval
  var finish = { open: false, intensity: 3, performance: 3 };

  function init() {
    els.tab = document.getElementById("tab-exercise");
    els.summary = document.getElementById("exercise-summary");
    els.hub = document.getElementById("workout-hub");
    els.active = document.getElementById("workout-active");
    els.list = document.getElementById("exercise-list");

    // manual / edit form elements
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
    els.title = document.getElementById("exercise-form-title");
    els.exWrap = document.getElementById("exercise-ex-list");
    els.manualBuilder = document.getElementById("exercise-manual-builder");

    // one delegated listener for the whole tab drives the builder,
    // autocomplete and session buttons (robust across re-renders / hosts)
    els.tab.addEventListener("click", onTabClick);
    els.tab.addEventListener("input", onTabInput);
    els.tab.addEventListener("keydown", onTabKeydown);

    if (els.form) els.form.addEventListener("submit", onManualSubmit);

    initTimer();
    restoreOrHub();
    renderList();
  }

  /* On load: resume a live session if one was in progress, else show the hub. */
  function restoreOrHub() {
    var a = loadActive();
    if (a) {
      exList = a.exList || [];
      sessType = a.type || "strength";
      activeStartedAt = a.startedAt;
      activeProgramDay = a.programDay;
      mode = "active";
      renderActive();
    } else {
      showHub();
    }
  }

  /* Start a live session pre-loaded with the trainer's prescribed exercises
     (called by trainer.js "Start this workout"). programDay ties the session
     back to the plan so completion auto-progresses the right day. */
  function startPrescribed(prescribed, programDay, dayName) {
    activeStartedAt = Date.now();
    sessType = "strength";
    activeProgramDay = (typeof programDay === "number") ? programDay : null;
    finish = { open: false, intensity: 3, performance: 3 };
    exList = (Array.isArray(prescribed) ? prescribed : []).map(function (ex) {
      return {
        name: typeof ex.name === "string" ? ex.name : "",
        prefilled: true,
        sets: (Array.isArray(ex.sets) ? ex.sets : []).map(seedSet)
      };
    }).filter(function (ex) { return ex.name; });
    mode = "active";
    saveActive();
    renderActive();
  }

  function showError(msg) {
    if (!els.error) return;
    els.error.textContent = msg || "";
    els.error.hidden = !msg;
  }

  /* ============================================================
     Active-session persistence
     ============================================================ */
  var activeStartedAt = 0;
  var activeProgramDay = null;   // set when the session was started from the trainer plan

  function loadActive() {
    try {
      var raw = localStorage.getItem(ACTIVE_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || typeof o.startedAt !== "number" || !isFinite(o.startedAt)) return null;
      // revive the builder (recompute kg/reps from the raw strings)
      var list = (Array.isArray(o.exList) ? o.exList : []).map(function (ex) {
        return {
          name: typeof ex.name === "string" ? ex.name : "",
          prefilled: !!ex.prefilled,
          sets: (Array.isArray(ex.sets) ? ex.sets : []).map(reviveSet)
        };
      }).filter(function (ex) { return ex.name; });
      return { startedAt: o.startedAt, type: o.type || "strength", exList: list,
        programDay: (typeof o.programDay === "number") ? o.programDay : null };
    } catch (e) { return null; }
  }

  function saveActive() {
    if (mode !== "active") return;
    try {
      localStorage.setItem(ACTIVE_KEY, JSON.stringify({
        startedAt: activeStartedAt, type: sessType, exList: exList, programDay: activeProgramDay
      }));
    } catch (e) { /* storage full/blocked: session stays in memory */ }
  }

  function clearActive() {
    try { localStorage.removeItem(ACTIVE_KEY); } catch (e) { /* ignore */ }
  }

  /** Rebuild a builder set from a persisted {wRaw,rRaw} (wRaw is the truth
      for an in-progress session — same logic as the live input handler). */
  function reviveSet(s) {
    var wRaw = (s && s.wRaw != null) ? String(s.wRaw) : "";
    var rRaw = (s && s.rRaw != null) ? String(s.rRaw) : "";
    var v = U.numOrNull(wRaw);
    var kg = v === null ? null : (isNaN(v) ? NaN : U.fromDisplayWeight(v));
    var r = U.numOrNull(rRaw);
    var reps = r === null ? null : (isNaN(r) ? NaN : Math.round(r));
    return { kg: kg, reps: reps, wRaw: wRaw, rRaw: rRaw };
  }

  /* ============================================================
     Exercise names — built-in library merged with your history
     ============================================================ */

  /** Distinct exercise names the user has actually logged. */
  function knownNames() {
    var seen = {}, out = [];
    S.getAll("exercise").forEach(function (r) {
      if (!Array.isArray(r.exercises)) return;
      r.exercises.forEach(function (ex) {
        if (!ex || typeof ex.name !== "string") return;
        var name = ex.name.trim(), k = name.toLowerCase();
        if (name && !seen[k]) { seen[k] = true; out.push(name); }
      });
    });
    return out;
  }

  /** Your history first, then the built-in library, deduped (case-insensitive). */
  function allNames() {
    var lib = (OF.exerciseLibrary ? OF.exerciseLibrary.names() : []);
    var seen = {}, out = [];
    knownNames().concat(lib).forEach(function (n) {
      var k = n.toLowerCase();
      if (!seen[k]) { seen[k] = true; out.push(n); }
    });
    return out;
  }

  /** Filter names for the autocomplete: startsWith ranked above contains. */
  function suggest(query, limit) {
    var q = (query || "").trim().toLowerCase();
    var names = allNames();
    if (!q) return names.slice(0, limit || 8);
    var starts = [], contains = [];
    names.forEach(function (n) {
      var l = n.toLowerCase();
      if (l.indexOf(q) === 0) starts.push(n);
      else if (l.indexOf(q) !== -1) contains.push(n);
    });
    return starts.concat(contains).slice(0, limit || 8);
  }

  /* ============================================================
     Builder (exercises & sets) — renders into `builderHost`
     ============================================================ */

  function kgToRaw(kg) {
    if (kg == null || !isFinite(Number(kg))) return "";
    var v = U.toDisplayWeight(Number(kg), 1);
    return v == null ? "" : String(v);
  }

  function seedSet(s) {
    var kg = (s && s.weightKg != null && isFinite(Number(s.weightKg))) ? Number(s.weightKg) : null;
    var reps = (s && s.reps != null && isFinite(Number(s.reps))) ? Math.round(Number(s.reps)) : null;
    return { kg: kg, reps: reps, wRaw: kgToRaw(kg), rRaw: reps == null ? "" : String(reps) };
  }

  /** Most recent past session's stored sets for a name (for prefill). */
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
            Array.isArray(ex.sets) && ex.sets.length) return ex.sets;
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
    if (!name) { showError("Type or pick an exercise first (e.g. Bench Press)."); return; }
    if (exList.length >= MAX_EXERCISES) {
      showError("Maximum " + MAX_EXERCISES + " exercises per workout."); return;
    }
    showError("");
    var past = lastSetsFor(name);
    var sets, prefilled = false;
    if (past && past.length) { sets = past.slice(0, MAX_SETS).map(seedSet); prefilled = true; }
    else { sets = [{ kg: null, reps: null, wRaw: "", rRaw: "" }]; }
    exList.push({ name: name, sets: sets, prefilled: prefilled });
    saveActive();
    renderBuilder();
    // clear the add input + focus the new exercise's first weight cell
    var addInput = builderHost && builderHost.parentNode.querySelector(".ex-add-input");
    if (addInput) addInput.value = "";
    hideMenu();
    var inputs = builderHost.querySelectorAll('[data-ex="' + (exList.length - 1) + '"][data-field="w"]');
    if (inputs.length) inputs[0].focus();
  }

  function setRowHtml(i, j, s, unit) {
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
  }

  function renderBuilder() {
    if (!builderHost) return;
    var unit = U.weightUnit();
    if (!exList.length) {
      builderHost.innerHTML = '<div class="ex-empty">No exercises yet — add one below.</div>';
      return;
    }
    builderHost.innerHTML = exList.map(function (ex, i) {
      var rows = ex.sets.map(function (s, j) { return setRowHtml(i, j, s, unit); }).join("");
      return '<div class="ex-item">' +
        '<div class="ex-item-head">' +
          '<span class="ex-item-name">' + U.esc(ex.name) + '</span>' +
          '<button type="button" class="btn set-del" data-act="del-ex" data-ex="' + i +
            '" aria-label="Remove ' + U.esc(ex.name) + '">Remove</button>' +
        '</div>' +
        (ex.prefilled ? '<div class="ex-prefill-hint">Prefilled from your last session — tap to adjust.</div>' : '') +
        '<div class="set-head" aria-hidden="true"><span></span><span>' + U.esc(unit) + '</span><span>reps</span><span></span></div>' +
        rows +
        '<button type="button" class="btn set-add" data-act="add-set" data-ex="' + i + '">+ Add set</button>' +
        '</div>';
    }).join("");
  }

  /* Builder click actions (delegated). Returns true if handled. */
  function builderClick(btn) {
    var act = btn.getAttribute("data-act");
    if (act !== "add-set" && act !== "del-set" && act !== "del-ex") return false;
    var i = parseInt(btn.getAttribute("data-ex"), 10);
    var ex = exList[i];
    if (!ex) return true;
    if (act === "add-set") {
      if (ex.sets.length >= MAX_SETS) { showError("Maximum " + MAX_SETS + " sets per exercise."); return true; }
      ex.sets.push(newSetFrom(ex.sets[ex.sets.length - 1]));
      saveActive(); renderBuilder();
      var ins = builderHost.querySelectorAll('[data-ex="' + i + '"][data-field="w"]');
      if (ins.length) ins[ins.length - 1].focus();
    } else if (act === "del-set") {
      var j = parseInt(btn.getAttribute("data-set"), 10);
      ex.sets.splice(j, 1);
      if (!ex.sets.length) exList.splice(i, 1);
      saveActive(); renderBuilder();
    } else if (act === "del-ex") {
      exList.splice(i, 1);
      saveActive(); renderBuilder();
    }
    return true;
  }

  /* Builder set-value edits (delegated input) — state only, no re-render. */
  function builderInput(inp) {
    if (!inp.hasAttribute || !inp.hasAttribute("data-field")) return false;
    var ex = exList[parseInt(inp.getAttribute("data-ex"), 10)];
    var s = ex && ex.sets[parseInt(inp.getAttribute("data-set"), 10)];
    if (!s) return true;
    if (inp.getAttribute("data-field") === "w") {
      s.wRaw = inp.value;
      var v = U.numOrNull(inp.value);
      s.kg = v === null ? null : (isNaN(v) ? NaN : U.fromDisplayWeight(v));
    } else {
      s.rRaw = inp.value;
      var r = U.numOrNull(inp.value);
      s.reps = r === null ? null : (isNaN(r) ? NaN : Math.round(r));
    }
    saveActive();
    return true;
  }

  /** Builder state -> storable exercises array (or {err}). */
  function readExercises() {
    if (!exList.length) return { list: null };
    var out = [];
    for (var i = 0; i < exList.length && i < MAX_EXERCISES; i++) {
      var ex = exList[i], sets = [];
      for (var j = 0; j < ex.sets.length && j < MAX_SETS; j++) {
        var s = ex.sets[j];
        var wEmpty = !(s.wRaw && String(s.wRaw).trim() !== "");
        var rEmpty = !(s.rRaw && String(s.rRaw).trim() !== "");
        if (wEmpty && rEmpty) continue;
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
     Autocomplete dropdown (custom — native datalist is flaky on iOS)
     ============================================================ */

  function renderMenu(menu, query) {
    var items = suggest(query, 8);
    var typed = (query || "").trim();
    var exact = typed && items.some(function (n) { return n.toLowerCase() === typed.toLowerCase(); });
    var html = items.map(function (n) {
      var cat = OF.exerciseLibrary ? OF.exerciseLibrary.categoryOf(n) : "";
      return '<button type="button" class="ex-opt" data-pick="' + U.esc(n) + '">' +
        '<span>' + U.esc(n) + '</span>' +
        (cat ? '<span class="ex-opt-cat">' + U.esc(cat) + '</span>' : '') + '</button>';
    }).join("");
    if (typed && !exact) {
      html += '<button type="button" class="ex-opt ex-opt-new" data-pick="' + U.esc(typed) + '">' +
        '+ Add “' + U.esc(typed) + '”</button>';
    }
    menu.innerHTML = html;
    menu.classList.toggle("hidden", !html);
  }

  function hideMenu() {
    if (!builderHost) return;
    var menu = builderHost.parentNode.querySelector(".ex-add-menu");
    if (menu) menu.classList.add("hidden");
  }

  /* ============================================================
     Live session UI
     ============================================================ */

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function fmtElapsed(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return (h > 0 ? h + ":" + pad(m) : m) + ":" + pad(sec);
  }

  function typeSelectHtml(id, val) {
    return '<select id="' + id + '" class="wo-type">' + TYPES.map(function (t) {
      return '<option value="' + t[0] + '"' + (t[0] === val ? ' selected' : '') + '>' + t[1] + '</option>';
    }).join("") + '</select>';
  }

  function addRowHtml() {
    return '<div class="ex-add">' +
      '<input type="text" class="ex-add-input" maxlength="80" autocomplete="off" ' +
        'placeholder="Add an exercise…" aria-label="Add an exercise">' +
      '<div class="ex-add-menu hidden" role="listbox"></div>' +
      '</div>';
  }

  function renderActive() {
    mode = "active";
    els.hub.classList.add("hidden");
    if (els.form) els.form.classList.add("hidden");
    els.active.classList.remove("hidden");

    if (finish.open) { renderFinish(); return; }

    els.active.innerHTML =
      '<div class="wo-live-head">' +
        '<div class="wo-live-clock"><span class="wo-live-dot"></span>' +
          '<span class="wo-elapsed" id="wo-elapsed">0:00</span></div>' +
        typeSelectHtml("wo-type", sessType) +
      '</div>' +
      '<div class="ex-list" id="wo-ex-list"></div>' +
      addRowHtml() +
      '<p class="form-error" id="wo-error" hidden></p>' +
      '<div class="wo-live-actions">' +
        '<button type="button" class="btn primary wo-complete" data-wo="complete">Complete workout</button>' +
        '<button type="button" class="btn ghost danger" data-wo="discard">Discard</button>' +
      '</div>';

    builderHost = els.active.querySelector("#wo-ex-list");
    els.error = els.active.querySelector("#wo-error");
    renderBuilder();
    startTick();
    tickElapsed();
  }

  function startTick() { stopTick(); sessIntId = setInterval(tickElapsed, 1000); }
  function stopTick() { if (sessIntId) { clearInterval(sessIntId); sessIntId = null; } }
  function tickElapsed() {
    var el = document.getElementById("wo-elapsed");
    if (el) el.textContent = fmtElapsed(Date.now() - activeStartedAt);
  }

  function startSession() {
    activeStartedAt = Date.now();
    sessType = "strength";
    exList = [];
    activeProgramDay = null;
    finish = { open: false, intensity: 3, performance: 3 };
    mode = "active";
    saveActive();
    renderActive();
  }

  function discardSession() {
    if (!confirm("Discard this workout? Nothing will be saved.")) return;
    stopTick();
    clearActive();
    exList = [];
    activeProgramDay = null;
    finish.open = false;
    showHub();
  }

  /* ---- finish step (ratings live HERE, at the end) ---- */
  function pillRow(name, val) {
    var labels = name === "intensity"
      ? ["Very light", "Light", "Moderate", "Hard", "Max effort"]
      : ["Awful", "Weak", "Normal", "Strong", "Best ever"];
    var pills = "";
    for (var i = 1; i <= 5; i++) {
      pills += '<button type="button" class="wo-pill' + (i === val ? ' on' : '') +
        '" data-rate="' + name + '" data-val="' + i + '" aria-pressed="' + (i === val) + '">' +
        i + '<span class="wo-pill-lbl">' + labels[i - 1] + '</span></button>';
    }
    return pills;
  }

  function renderFinish() {
    els.hub.classList.add("hidden");
    if (els.form) els.form.classList.add("hidden");
    els.active.classList.remove("hidden");
    stopTick();
    var mins = Math.max(1, Math.round((Date.now() - activeStartedAt) / 60000));
    finish.durationMin = finish.durationMin || mins;

    els.active.innerHTML =
      '<div class="wo-finish">' +
        '<h2 class="wo-finish-title">Finish workout</h2>' +
        '<div class="wo-finish-row">' +
          '<label class="wo-finish-field">Duration (min)' +
            '<input type="number" inputmode="numeric" min="1" max="600" id="wo-duration" value="' + finish.durationMin + '">' +
          '</label>' +
          '<label class="wo-finish-field">Type' + typeSelectHtml("wo-type", sessType) + '</label>' +
        '</div>' +
        '<div class="wo-rate-block"><span class="wo-rate-lbl">Intensity</span>' +
          '<div class="wo-pills" id="wo-intensity">' + pillRow("intensity", finish.intensity) + '</div></div>' +
        '<div class="wo-rate-block"><span class="wo-rate-lbl">How did it go?</span>' +
          '<div class="wo-pills" id="wo-performance">' + pillRow("performance", finish.performance) + '</div></div>' +
        '<label class="wo-finish-field grow">Notes' +
          '<input type="text" id="wo-notes" maxlength="300" placeholder="optional" value="' + U.esc(finish.notes || "") + '">' +
        '</label>' +
        '<p class="form-error" id="wo-error" hidden></p>' +
        '<div class="wo-live-actions">' +
          '<button type="button" class="btn primary" data-wo="save">Save workout</button>' +
          '<button type="button" class="btn ghost" data-wo="back">Back</button>' +
        '</div>' +
      '</div>';
    els.error = els.active.querySelector("#wo-error");
  }

  function saveSession() {
    var exs = readExercises();
    if (exs.err) { showError(exs.err); return; }
    var durEl = document.getElementById("wo-duration");
    var dur = U.numOrNull(durEl ? durEl.value : "");
    if (dur === null || isNaN(dur) || dur <= 0 || dur > 600) {
      showError("Duration must be between 1 and 600 minutes."); return;
    }
    var notesEl = document.getElementById("wo-notes");
    var d = new Date(activeStartedAt);
    var rec = {
      date: d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()),
      startTime: pad(d.getHours()) + ":" + pad(d.getMinutes()),
      type: sessType,
      durationMin: Math.round(dur),
      intensity: finish.intensity,
      performance: finish.performance,
      notes: notesEl ? notesEl.value.trim() : "",
      exercises: exs.list || undefined
    };
    if (!S.add("exercise", rec)) {
      showError("Could not save — browser storage is full or blocked. Your workout was NOT saved.");
      return;
    }
    // If this session came from the trainer plan, auto-progress that day.
    if (activeProgramDay != null && OF.trainer && OF.trainer.completeSession) {
      try { OF.trainer.completeSession(activeProgramDay, rec.exercises || []); } catch (e) {}
    }
    activeProgramDay = null;
    stopTick();
    clearActive();
    exList = [];
    finish = { open: false, intensity: 3, performance: 3 };
    showHub();
    renderList();
    OF.dashboard && OF.dashboard.refresh();
    if (OF.trainer && OF.trainer.refresh) OF.trainer.refresh();
  }

  /* ============================================================
     Hub (no active session)
     ============================================================ */
  function showHub() {
    mode = "hub";
    stopTick();
    builderHost = null;
    els.active.classList.add("hidden");
    els.active.innerHTML = "";
    if (els.form) els.form.classList.add("hidden");
    els.hub.classList.remove("hidden");
    els.error = document.getElementById("exercise-error");
  }

  /* ============================================================
     Manual / edit form
     ============================================================ */
  function openManual() {
    mode = "manual";
    els.hub.classList.add("hidden");
    els.active.classList.add("hidden");
    els.form.classList.remove("hidden");
    setManualDefaults();
    builderHost = els.exWrap;
    renderBuilder();
    els.error = document.getElementById("exercise-error");
    els.form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function setManualDefaults() {
    els.editId.value = "";
    els.date.value = U.todayISO();
    els.start.value = U.nowTime();
    els.type.value = "strength";
    els.duration.value = "60";
    els.intensity.value = "3";
    els.performance.value = "3";
    els.notes.value = "";
    els.title.textContent = "Log a past workout";
    els.submit.textContent = "Save workout";
    if (OF.ui) OF.ui.syncSegs();
    exList = [];
  }

  function closeManual() {
    exList = [];
    showError("");
    showHub();
  }

  function readManual() {
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
        date: els.date.value, startTime: els.start.value, type: els.type.value,
        durationMin: Math.round(dur), intensity: intensity, performance: performance,
        notes: els.notes.value.trim(), exercises: exs.list || undefined
      }
    };
  }

  function onManualSubmit(e) {
    e.preventDefault();
    var r = readManual();
    if (r.err) { showError(r.err); return; }
    showError("");
    var editId = els.editId.value;
    var ok = editId ? S.update("exercise", editId, r.rec) : S.add("exercise", r.rec);
    if (!ok) {
      showError("Could not save — browser storage is full or blocked. Your entry was NOT saved.");
      return;
    }
    exList = [];
    closeManual();
    renderList();
    OF.dashboard && OF.dashboard.refresh();
  }

  function enterEditMode(rec) {
    mode = "manual";
    els.hub.classList.add("hidden");
    els.active.classList.add("hidden");
    els.form.classList.remove("hidden");
    els.editId.value = rec.id;
    els.date.value = rec.date;
    els.start.value = rec.startTime;
    els.type.value = rec.type || "other";
    els.duration.value = String(rec.durationMin || "");
    els.intensity.value = String(rec.intensity || 3);
    els.performance.value = String(rec.performance || 3);
    els.notes.value = rec.notes || "";
    if (OF.ui) OF.ui.syncSegs();
    exList = (Array.isArray(rec.exercises) ? rec.exercises : []).map(function (ex) {
      return {
        name: typeof ex.name === "string" ? ex.name : "",
        sets: (Array.isArray(ex.sets) ? ex.sets : []).map(seedSet)
      };
    }).filter(function (ex) { return ex.name; });
    els.title.textContent = "Edit workout";
    els.submit.textContent = "Save changes";
    builderHost = els.exWrap;
    renderBuilder();
    els.error = document.getElementById("exercise-error");
    els.form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ============================================================
     Delegated tab handlers
     ============================================================ */
  function onTabClick(e) {
    var t = e.target;

    // hub buttons
    if (t.closest && t.closest('[data-wo="start"]')) { startSession(); return; }
    if (t.closest && t.closest('[data-wo="manual"]')) { openManual(); return; }
    if (t.closest && t.closest('[data-wo="hub-back"]')) { closeManual(); return; }

    // live-session buttons
    var woBtn = t.closest && t.closest("[data-wo]");
    if (woBtn) {
      var w = woBtn.getAttribute("data-wo");
      if (w === "complete") { finish.open = true; finish.durationMin = 0; renderFinish(); return; }
      if (w === "discard") { discardSession(); return; }
      if (w === "save") { saveSession(); return; }
      if (w === "back") { finish.open = false; renderActive(); return; }
    }

    // finish-step rating pills
    var pill = t.closest && t.closest(".wo-pill");
    if (pill) {
      var name = pill.getAttribute("data-rate");
      finish[name] = parseInt(pill.getAttribute("data-val"), 10);
      var box = pill.parentNode;
      Array.prototype.forEach.call(box.querySelectorAll(".wo-pill"), function (b) {
        var on = b === pill;
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", on);
      });
      return;
    }

    // autocomplete option
    var opt = t.closest && t.closest(".ex-opt");
    if (opt) { addExercise(opt.getAttribute("data-pick")); return; }

    // builder actions
    var actBtn = t.closest && t.closest("button[data-act]");
    if (actBtn && builderClick(actBtn)) return;

    // history list edit/delete
    var histBtn = t.closest && t.closest("#exercise-list button[data-act]");
    if (histBtn) { onHistoryClick(histBtn); return; }

    // clicking away closes the menu
    if (!(t.closest && t.closest(".ex-add"))) hideMenu();
  }

  function onTabInput(e) {
    var t = e.target;
    if (t.classList && t.classList.contains("ex-add-input")) {
      var menu = t.parentNode.querySelector(".ex-add-menu");
      if (menu) renderMenu(menu, t.value);
      return;
    }
    if (t.hasAttribute && t.hasAttribute("data-field")) builderInput(t);
    // live type-select change
    if (t.classList && t.classList.contains("wo-type")) {
      sessType = t.value; saveActive();
    }
  }

  function onTabKeydown(e) {
    var t = e.target;
    if (t.classList && t.classList.contains("ex-add-input") && e.key === "Enter") {
      e.preventDefault();
      addExercise(t.value);
    }
  }

  /* type-select change fires "change" not "input" on some browsers */
  document.addEventListener("change", function (e) {
    var t = e.target;
    if (t.classList && t.classList.contains("wo-type") && mode === "active") {
      sessType = t.value; saveActive();
    }
  });

  /* ============================================================
     History list
     ============================================================ */
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

  function wTxt(kg) { return U.fmtWeight(kg, 1); }

  function exSummaryTxt(ex) {
    var sets = (Array.isArray(ex.sets) ? ex.sets : []).filter(function (s) {
      return s && s.reps != null && isFinite(Number(s.reps)) && Number(s.reps) >= 1;
    });
    if (!sets.length) return null;
    function kgOf(s) {
      return (s.weightKg != null && isFinite(Number(s.weightKg))) ? Number(s.weightKg) : null;
    }
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
        ' <span class="set-line-detail">— ' + U.esc(sum) + '</span></div>';
    }).filter(Boolean);
    return lines.length ? '<div class="entry-sets">' + lines.join("") + '</div>' : "";
  }

  function onHistoryClick(btn) {
    var id = btn.getAttribute("data-id");
    if (btn.getAttribute("data-act") === "del") {
      if (confirm("Delete this workout?")) {
        S.remove("exercise", id);
        if (els.editId && els.editId.value === id) closeManual();
        renderList();
        OF.dashboard && OF.dashboard.refresh();
      }
    } else {
      var rec = S.get("exercise", id);
      if (rec) enterEditMode(rec);
    }
  }

  function renderList() {
    renderSummary();
    var arr = S.getAll("exercise").slice().sort(U.byNewest);
    if (!arr.length) {
      els.list.innerHTML = '<div class="empty-state">' + OF.icons.badge("dumbbell") +
        '<p>No workouts logged yet — start one above and your training history shows up here.</p></div>';
      return;
    }
    els.list.innerHTML = arr.map(function (r) {
      var t0 = r.type || "other";
      var title = t0.charAt(0).toUpperCase() + t0.slice(1) + " · " + r.durationMin + " min";
      var sub = U.fmtDate(r.date) + " " + r.startTime +
        " · intensity " + r.intensity + "/5" + (r.notes ? " · " + r.notes : "");
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
     Rest timer (countdown + stopwatch) — unchanged behavior
     ============================================================ */
  var PRESETS = [60, 90, 120, 180];
  var MAX_TIMER_MS = 59 * 60 * 1000 + 59 * 1000;
  var T = {
    mode: "countdown", presetSec: 90, running: false, finished: false,
    remainingMs: 90000, elapsedMs: 0, deadline: 0, startAt: 0, intId: null
  };
  var audioCtx = null, tEls = {};

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
    } catch (e) { /* default */ }
    T.presetSec = sec;
  }
  function savePreset(sec) {
    try { if (OF.units && OF.units.setPrefs) OF.units.setPrefs({ restPreset: sec }); }
    catch (e) { /* best-effort */ }
  }
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
        var osc = audioCtx.createOscillator(), g = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.value = 784 + i * 130;
        g.gain.setValueAtTime(0.0001, now + t);
        g.gain.exponentialRampToValueAtTime(0.22, now + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.16);
        osc.connect(g); g.connect(audioCtx.destination);
        osc.start(now + t); osc.stop(now + t + 0.18);
      });
    } catch (e) { /* best-effort */ }
  }
  function finishCue() {
    T.finished = true; beep();
    try { if (navigator.vibrate) navigator.vibrate([120, 80, 120]); } catch (e) { /* iOS ignores */ }
    updateDisplay();
  }
  function stopInterval() { if (T.intId) { clearInterval(T.intId); T.intId = null; } }
  function startIntervalT() { stopInterval(); T.intId = setInterval(tickT, 200); }
  function tickT() {
    if (!T.running) return;
    if (T.mode === "countdown") {
      T.remainingMs = T.deadline - Date.now();
      if (T.remainingMs <= 0) { T.remainingMs = 0; T.running = false; stopInterval(); finishCue(); return; }
    } else { T.elapsedMs = Date.now() - T.startAt; }
    updateDisplay();
  }
  function startPause() {
    if (T.running) { pauseTimer(); return; }
    ensureAudio();
    T.finished = false; T.running = true;
    if (T.mode === "countdown") {
      if (T.remainingMs <= 0) T.remainingMs = T.presetSec * 1000;
      T.deadline = Date.now() + T.remainingMs;
    } else { T.startAt = Date.now() - T.elapsedMs; }
    startIntervalT(); updateDisplay();
  }
  function pauseTimer() {
    if (T.mode === "countdown") T.remainingMs = Math.max(0, T.deadline - Date.now());
    else T.elapsedMs = Date.now() - T.startAt;
    T.running = false; stopInterval(); updateDisplay();
  }
  function resetTimer() {
    stopInterval(); T.running = false; T.finished = false;
    if (T.mode === "countdown") T.remainingMs = T.presetSec * 1000; else T.elapsedMs = 0;
    updateDisplay();
  }
  function setMode(m) {
    if ((m !== "countdown" && m !== "stopwatch") || m === T.mode) return;
    stopInterval(); T.running = false; T.finished = false; T.mode = m;
    if (m === "countdown") T.remainingMs = T.presetSec * 1000; else T.elapsedMs = 0;
    updateDisplay();
  }
  function applyPreset(sec) {
    if (!isFinite(sec) || sec <= 0) return;
    T.presetSec = sec; savePreset(sec);
    stopInterval(); T.running = false; T.finished = false; T.remainingMs = sec * 1000;
    updateDisplay();
  }
  function adjust(deltaSec) {
    if (T.mode !== "countdown") return;
    var d = deltaSec * 1000;
    if (T.running) {
      T.deadline = Math.min(Date.now() + MAX_TIMER_MS, Math.max(Date.now(), T.deadline + d));
      T.remainingMs = Math.max(0, T.deadline - Date.now());
    } else { T.remainingMs = Math.max(0, Math.min(MAX_TIMER_MS, T.remainingMs + d)); }
    T.finished = false; updateDisplay();
  }
  function updateDisplay() {
    if (!tEls.time) return;
    var isC = T.mode === "countdown";
    var ms = isC ? T.remainingMs : T.elapsedMs;
    var secs = isC ? Math.ceil(ms / 1000) : Math.floor(ms / 1000);
    tEls.time.textContent = fmtClock(secs);
    tEls.start.textContent = T.running ? "Pause" : (T.finished ? "Restart" : "Start");
    tEls.start.setAttribute("aria-label", (T.running ? "Pause " : "Start ") + (isC ? "rest countdown" : "stopwatch"));
    if (T.finished) { tEls.wrap.classList.add("rt-finished"); tEls.status.textContent = "Rest done!"; }
    else { tEls.wrap.classList.remove("rt-finished"); tEls.status.textContent = T.running ? (isC ? "Resting…" : "Timing…") : ""; }
    Array.prototype.forEach.call(tEls.modeBtns, function (b) {
      var on = b.getAttribute("data-mode") === T.mode;
      b.classList.toggle("active", on); b.setAttribute("aria-selected", on ? "true" : "false");
    });
    Array.prototype.forEach.call(tEls.presetBtns, function (b) {
      b.classList.toggle("active", parseInt(b.getAttribute("data-sec"), 10) === T.presetSec);
    });
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
            '<button type="button" class="rt-seg-btn" data-rt="mode" data-mode="countdown" role="tab" aria-selected="true">Countdown</button>' +
            '<button type="button" class="rt-seg-btn" data-rt="mode" data-mode="stopwatch" role="tab" aria-selected="false">Stopwatch</button>' +
          '</div>' +
        '</div>' +
        '<div class="rt-display">' +
          '<div class="rt-time" role="timer" aria-atomic="true">0:00</div>' +
          '<div class="rt-status" role="status" aria-live="polite"></div>' +
        '</div>' +
        '<div class="rt-presets" data-cd>' +
          PRESETS.map(function (sec) {
            var lbl = fmtClock(sec);
            return '<button type="button" class="btn rt-preset" data-rt="preset" data-sec="' + sec + '" aria-label="Set rest to ' + lbl + '">' + lbl + '</button>';
          }).join("") +
        '</div>' +
        '<div class="rt-controls">' +
          '<button type="button" class="btn primary rt-start" data-rt="start" aria-label="Start rest countdown">Start</button>' +
          '<button type="button" class="btn rt-reset" data-rt="reset" aria-label="Reset timer">Reset</button>' +
          '<div class="rt-adjust" data-cd>' +
            '<button type="button" class="btn rt-adj" data-rt="adj" data-delta="-15" aria-label="Subtract 15 seconds">&minus;15s</button>' +
            '<button type="button" class="btn rt-adj" data-rt="adj" data-delta="15" aria-label="Add 15 seconds">+15s</button>' +
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
    T.mode = "countdown"; T.running = false; T.finished = false;
    T.remainingMs = T.presetSec * 1000; T.elapsedMs = 0;
    renderTimer(host); updateDisplay();
  }

  return { init: init, renderList: renderList, startPrescribed: startPrescribed };
})();

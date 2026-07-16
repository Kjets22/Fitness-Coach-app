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
  var listLimit = 50;   // windowed history: render newest 50, expand on demand

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
    ensureAudioUnlockOnce();
    els.tab = document.getElementById("tab-exercise");
    els.summary = document.getElementById("exercise-summary");
    els.hub = document.getElementById("workout-hub");
    els.active = document.getElementById("workout-active");
    els.list = document.getElementById("exercise-list");
    // the in-progress pill + rest bar depend on which tab is visible
    window.addEventListener("hashchange", function () { updateLivePill(); renderRestBar(); });
    // stepper strip follows focus between set weight/reps inputs
    document.addEventListener("focusin", function (ev) {
      var t = ev.target;
      if (t && t.hasAttribute && t.hasAttribute("data-field") && mode === "active") updateStepper(t);
      else updateStepper(null);
    });
    document.addEventListener("focusout", function (ev) {
      // hide only when focus truly left a set input (mousedown on the strip
      // itself is prevented, so it never steals focus)
      setTimeout(function () {
        var a = document.activeElement;
        if (!a || !a.hasAttribute || !a.hasAttribute("data-field")) updateStepper(null);
      }, 50);
    });

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
    // A live session >20h old is almost never something the user means to
    // continue — after 3 weeks away, resuming it would merge today's lifting
    // into a record dated weeks in the past.
    if (a && (Date.now() - a.startedAt) > 20 * 3600 * 1000) {
      var when = new Date(a.startedAt);
      if (!confirm("Found an unfinished workout from " + when.toLocaleDateString() +
          ". Keep it? (It saves with that original date.) Cancel discards it.")) {
        clearActive();
        a = null;
      }
    }
    if (a) {
      exList = a.exList || [];
      sessType = a.type || "strength";
      activeStartedAt = a.startedAt;
      activeProgramDay = a.programDay;
      restStart = a.restStart || null;
      restDur = a.restDur || null;
      // a rest that already elapsed while the app was closed must not beep on relaunch
      restCued = restStart != null && restDur != null &&
        (Date.now() - restStart) >= restDur * 1000;
      mode = "active";
      renderActive();
    } else {
      showHub();
    }
    updateLivePill();
  }

  /* Start a live session pre-loaded with the trainer's prescribed exercises
     (called by trainer.js "Start this workout"). programDay ties the session
     back to the plan so completion auto-progresses the right day. */
  function startPrescribed(prescribed, programDay, dayName) {
    // Don't silently wipe a workout already in progress.
    if (loadActive() && !confirm("You have a workout in progress. Start today's plan and discard it?")) return;
    preRequestRestNotif();
    activeStartedAt = Date.now();
    sessType = "strength";
    activeProgramDay = (typeof programDay === "number") ? programDay : null;
    finish = { open: false, intensity: 3, performance: 3 };
    exList = (Array.isArray(prescribed) ? prescribed : []).map(function (ex) {
      return {
        name: typeof ex.name === "string" ? ex.name : "",
        prefilled: true,
        rx: typeof ex.rx === "string" ? ex.rx : null,   // prescription stays visible while logging
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
  var restStart = null;          // ms timestamp of the last set marked done -> rest timer
  var restDur = null;            // seconds for the current rest countdown (from the timer card's preset)
  var restCued = false;          // beep/vibrate fired for the current rest (never re-fire)

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
          rx: typeof ex.rx === "string" ? ex.rx : null,   // keep the prescription across app restarts
          touched: !!ex.touched,                          // "actually worked on" survives restarts too
          sets: (Array.isArray(ex.sets) ? ex.sets : []).map(reviveSet)
        };
      }).filter(function (ex) { return ex.name; });
      return { startedAt: o.startedAt, type: o.type || "strength", exList: list,
        programDay: (typeof o.programDay === "number") ? o.programDay : null,
        restStart: (typeof o.restStart === "number" && isFinite(o.restStart)) ? o.restStart : null,
        restDur: (typeof o.restDur === "number" && isFinite(o.restDur)) ? o.restDur : null };
    } catch (e) { return null; }
  }

  function saveActive() {
    if (mode !== "active") return;
    try {
      localStorage.setItem(ACTIVE_KEY, JSON.stringify({
        startedAt: activeStartedAt, type: sessType, exList: exList, programDay: activeProgramDay,
        restStart: restStart, restDur: restDur
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
    return { kg: kg, reps: reps, wRaw: wRaw, rRaw: rRaw, done: !!(s && s.done) };
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
    return '<div class="set-row' + (s.done ? ' set-done-row' : '') + '">' +
      '<span class="set-num" aria-hidden="true">' + (j + 1) + '</span>' +
      '<input type="number" inputmode="decimal" step="0.5" min="0" ' +
        'value="' + U.esc(s.wRaw) + '" data-ex="' + i + '" data-set="' + j + '" data-field="w" ' +
        'placeholder="bodyweight" aria-label="Set ' + (j + 1) + ' weight (' + unit + ')">' +
      '<span class="set-x">' + U.esc(unit) + ' &times;</span>' +
      '<input type="number" inputmode="numeric" step="1" min="1" max="100" ' +
        'value="' + U.esc(s.rRaw) + '" data-ex="' + i + '" data-set="' + j + '" data-field="r" ' +
        'placeholder="reps" aria-label="Set ' + (j + 1) + ' reps">' +
      '<button type="button" class="btn set-done' + (s.done ? ' on' : '') + '" data-act="done-set" data-ex="' + i +
        '" data-set="' + j + '" aria-label="Mark set ' + (j + 1) + (s.done ? ' not done' : ' done') +
        '" aria-pressed="' + (s.done ? 'true' : 'false') + '">✓</button>' +
      '<button type="button" class="btn set-del set-del-sep" data-act="del-set" data-ex="' + i +
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
          '<button type="button" class="btn ex-rest-chip" data-act="ex-rest" data-ex="' + i +
            '" aria-label="Rest after ' + U.esc(ex.name) + ' sets — tap to change">⏱ ' +
            fmtRest(restSecFor(ex.name)) + '</button>' +
          '<button type="button" class="btn set-del" data-act="del-ex" data-ex="' + i +
            '" aria-label="Remove ' + U.esc(ex.name) + '">Remove</button>' +
        '</div>' +
        (ex.rx ? '<div class="ex-rx">Target: ' + U.esc(ex.rx) + '</div>' : '') +
        (ex.prefilled ? '<div class="ex-prefill-hint">' +
          (ex.rx ? 'From your plan — log what you actually do.'   // plan session: don't claim a "last session" that may never have happened
                 : 'Prefilled from your last session — tap to adjust.') + '</div>' : '') +
        '<div class="set-head" aria-hidden="true"><span></span><span>' + U.esc(unit) + '</span><span></span><span>reps</span><span>done</span><span></span></div>' +
        rows +
        '<div class="set-add-row">' +
          '<button type="button" class="btn set-add" data-act="add-set" data-ex="' + i + '">+ Add set</button>' +
          '<button type="button" class="btn set-add" data-act="warmup" data-ex="' + i + '">+ Warm-up ramp</button>' +
        '</div>' +
        '</div>';
    }).join("");
  }

  /* One tap builds the ramp lifters compute in their heads: empty bar x10,
     ~55% x5, ~80% x3, prepended above the working sets (plate-rounded). */
  function addWarmup(i) {
    var ex = exList[i];
    if (!ex) return;
    var lb = U.weightUnit() === "lb";
    var bar = lb ? 45 : 20, step = lb ? 5 : 2.5;
    var work = 0;
    ex.sets.forEach(function (s) {
      var v = U.numOrNull(s.wRaw);
      if (v != null && !isNaN(v)) work = Math.max(work, v);
    });
    if (work <= bar) {
      showError("Type your working weight first — the ramp builds up to it."); return;
    }
    showError("");
    var seen = {};
    var rows = [];
    [[bar, 10], [Math.round(work * 0.55 / step) * step, 5], [Math.round(work * 0.8 / step) * step, 3]]
      .forEach(function (r) {
        var w = Math.max(bar, r[0]);
        if (w >= work || seen[w]) return;
        seen[w] = 1;
        rows.push({ kg: Math.round(U.fromDisplayWeight(w) * 100) / 100, reps: r[1],
                    wRaw: String(w), rRaw: String(r[1]) });
      });
    if (!rows.length) return;
    if (ex.sets.length + rows.length > MAX_SETS) {
      showError("Not enough room under the " + MAX_SETS + "-set cap."); return;
    }
    ex.sets = rows.concat(ex.sets);
    ex.touched = true;
    saveActive();
    renderBuilder();
  }

  /* Builder click actions (delegated). Returns true if handled. */
  function builderClick(btn) {
    var act = btn.getAttribute("data-act");
    if (act === "warmup") { addWarmup(parseInt(btn.getAttribute("data-ex"), 10)); return true; }
    if (act === "ex-rest") { cycleExRest(parseInt(btn.getAttribute("data-ex"), 10)); return true; }
    if (act !== "add-set" && act !== "del-set" && act !== "del-ex" && act !== "done-set") return false;
    var i = parseInt(btn.getAttribute("data-ex"), 10);
    var ex = exList[i];
    if (!ex) return true;
    if (act === "done-set") {
      var dj = parseInt(btn.getAttribute("data-set"), 10);
      var st = ex.sets[dj];
      if (!st) return true;
      st.done = !st.done;
      ex.touched = true;
      if (st.done) startRest(ex.name);   // marking done auto-starts the rest countdown
      saveActive();
      renderBuilder();
      renderRestBar();
      return true;
    }
    if (act === "add-set") {
      if (ex.sets.length >= MAX_SETS) { showError("Maximum " + MAX_SETS + " sets per exercise."); return true; }
      ex.sets.push(newSetFrom(ex.sets[ex.sets.length - 1]));
      saveActive(); renderBuilder();
      var ins = builderHost.querySelectorAll('[data-ex="' + i + '"][data-field="w"]');
      if (ins.length) ins[ins.length - 1].focus();
    } else if (act === "del-set") {
      var j = parseInt(btn.getAttribute("data-set"), 10);
      var removedSet = ex.sets.splice(j, 1)[0];
      var exGone = !ex.sets.length;
      if (exGone) exList.splice(i, 1);
      saveActive(); renderBuilder();
      U.toast("Set removed", "warn", { label: "Undo", fn: function () {
        if (exGone) { exList.splice(i, 0, ex); ex.sets = [removedSet]; }
        else ex.sets.splice(j, 0, removedSet);
        saveActive(); renderBuilder();
      } });
    } else if (act === "del-ex") {
      var removedEx = exList.splice(i, 1)[0];
      saveActive(); renderBuilder();
      U.toast(removedEx.name + " removed", "warn", { label: "Undo", fn: function () {
        exList.splice(i, 0, removedEx);
        saveActive(); renderBuilder();
      } });
    }
    return true;
  }

  /* Builder set-value edits (delegated input) — state only, no re-render. */
  function builderInput(inp) {
    if (!inp.hasAttribute || !inp.hasAttribute("data-field")) return false;
    var ex = exList[parseInt(inp.getAttribute("data-ex"), 10)];
    var s = ex && ex.sets[parseInt(inp.getAttribute("data-set"), 10)];
    if (!s) return true;
    ex.touched = true;   // any edit marks the exercise as actually worked on
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
    var out = [], skippedPrescribed = 0;
    for (var i = 0; i < exList.length && i < MAX_EXERCISES; i++) {
      var ex = exList[i], sets = [];
      // A PRESCRIBED card the user never touched (no edits, no ✓, injured or
      // skipped it) must not save as performed sets — phantom history was
      // masking real stalls and even minting fake PRs from seeded weights.
      if (ex.prefilled && ex.rx && !ex.touched) { skippedPrescribed++; continue; }
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
    return { list: out.length ? out : null, skippedPrescribed: skippedPrescribed };
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
    if (!builderHost || !builderHost.parentNode) return;   // finish screen detaches the builder — a blank tap must not throw
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
  function stopTick() { if (sessIntId) { clearInterval(sessIntId); sessIntId = null; } renderRestBar(); updateLivePill(); }
  function tickElapsed() {
    var el = document.getElementById("wo-elapsed");
    if (el) el.textContent = fmtElapsed(Date.now() - activeStartedAt);
    // the strip's input can be destroyed by a re-render (warm-up ramp,
    // complete, discard) with no focusout — don't let it haunt other screens
    if (stepperTarget && !document.body.contains(stepperTarget)) updateStepper(null);
    checkRestCue();
    renderRestBar();
    updateLivePill();
  }

  /** Audible rest-end cue, decoupled from the rest BAR: the bar only renders
      on the workout tab, so the old in-bar beep never fired if the lifter sat
      on the dashboard — they got a mute OS notification instead of a sound.
      This runs on every tick regardless of tab; the real audio (ducks the
      user's music via AVAudioSession) plays whenever the app is foreground. */
  function checkRestCue() {
    if (mode !== "active" || restStart == null || restCued) return;
    var remainMs = restStart + (restDur || 90) * 1000 - Date.now();
    if (remainMs > 0) return;
    restCued = true;
    if (document.visibilityState === "visible") {
      cancelRestNotif();   // foreground cue wins — never double-alarm
      if (remainMs >= -3000) {
        playBeep();
        try { if (navigator.vibrate) navigator.vibrate([120, 80, 120]); } catch (e) { /* iOS ignores */ }
      }
    }
    // backgrounded: JS may be frozen anyway — the scheduled OS notification
    // (with sound) is the cue, so don't cancel it here
  }

  /* ---------------- stepper strip (keyboard accessory for set inputs) ----------------
     Flanking +/- buttons don't fit the 375px set grid; instead, focusing any
     weight/reps input shows a slim strip with unit-aware -/+ buttons so a
     lifter can bump 60 -> 62.5 without a keyboard round-trip. */
  var stepperTarget = null;

  function stepperStrip() {
    var el = document.getElementById("stepper-strip");
    if (!el) {
      el = document.createElement("div");
      el.id = "stepper-strip";
      el.innerHTML = '<button type="button" data-step="-1" aria-label="Decrease">−</button>' +
        '<span class="stepper-lbl"></span>' +
        '<button type="button" data-step="1" aria-label="Increase">+</button>';
      // mousedown (not click) + preventDefault so the input keeps focus
      el.addEventListener("mousedown", function (ev) {
        var b = ev.target.closest("[data-step]");
        if (!b) return;
        ev.preventDefault();
        applyStep(parseInt(b.getAttribute("data-step"), 10));
      });
      document.body.appendChild(el);
    }
    return el;
  }

  function stepSizeFor(inp) {
    if (inp.getAttribute("data-field") === "r") return 1;
    return U.weightUnit() === "lb" ? 5 : 2.5;   // one small plate pair
  }

  function applyStep(dir) {
    // prefer the ACTUALLY-focused set input; fall back to the last-known one
    var a = document.activeElement;
    var inp = (a && a.hasAttribute && a.hasAttribute("data-field")) ? a : stepperTarget;
    if (!inp || !document.body.contains(inp)) return;
    var step = stepSizeFor(inp);
    var v = U.numOrNull(inp.value);
    var cur = (v == null || isNaN(v)) ? 0 : v;
    var next = Math.max(0, Math.round((cur + dir * step) * 100) / 100);
    if (inp.getAttribute("data-field") === "r") next = Math.max(1, Math.round(next));
    inp.value = String(next);
    builderInput(inp);   // sync exList state + saveActive
    updateStepper(inp);  // live plate hint tracks the new value
  }

  /* Zero-tap plate calculator: while a weight field is focused, the strip
     also shows which plates to load PER SIDE for the typed total (standard
     bar: 45 lb / 20 kg). Skipped when the total is at/below the bar or
     doesn't split cleanly onto standard plates (e.g. dumbbell work). */
  function plateHint(total) {
    if (total == null || isNaN(total)) return "";
    var lb = U.weightUnit() === "lb";
    var bar = lb ? 45 : 20;
    var plates = lb ? [45, 35, 25, 10, 5, 2.5] : [25, 20, 15, 10, 5, 2.5, 1.25];
    var side = (Number(total) - bar) / 2;
    if (side <= 0) return "";
    var out = [];
    for (var i = 0; i < plates.length && side > 1e-9; i++) {
      while (side >= plates[i] - 1e-9) { out.push(plates[i]); side -= plates[i]; }
    }
    if (side > 1e-9 || !out.length) return "";   // doesn't land on standard plates
    return " · " + out.join("+") + " /side";
  }

  function updateStepper(inp) {
    var el = stepperStrip();
    if (!inp) { el.hidden = true; stepperTarget = null; return; }
    stepperTarget = inp;
    var isReps = inp.getAttribute("data-field") === "r";
    el.querySelector(".stepper-lbl").textContent = isReps
      ? "± 1 rep"
      : "± " + stepSizeFor(inp) + " " + U.weightUnit() + plateHint(U.numOrNull(inp.value));
    el.hidden = false;
  }

  /* ---------------- rest countdown (auto-starts when a set is marked done) ----------------
     Duration = the preset chosen on the Rest-timer card (same page, persisted).
     Counts DOWN in a floating pill; beeps + vibrates at zero, then lingers a
     minute as a "go" nudge. Tap = skip/dismiss. */

  /* ---- per-exercise rest overrides (persisted by exercise name) ----
     Big lifts want 3:00, isolation work 1:00 — the chip on each exercise
     header cycles 1:00 -> 1:30 -> 2:00 -> 3:00 and is remembered forever,
     so Squat stays at 3:00 across sessions. No override -> timer-card preset. */
  var EX_REST_KEY = "optimalfit.exRest";
  function exRestMap() {
    try {
      var o = JSON.parse(localStorage.getItem(EX_REST_KEY));
      return o && typeof o === "object" && !Array.isArray(o) ? o : {};
    } catch (e) { return {}; }
  }
  function restSecFor(name) {
    var v = exRestMap()[(name || "").trim().toLowerCase()];
    return (typeof v === "number" && isFinite(v) && v >= 15) ? v : ((T && T.presetSec) || 90);
  }
  function cycleExRest(i) {
    var ex = exList[i];
    if (!ex) return;
    var opts = [60, 90, 120, 180];
    var next = opts[(opts.indexOf(restSecFor(ex.name)) + 1 + opts.length) % opts.length];
    var m = exRestMap();
    m[ex.name.trim().toLowerCase()] = next;
    try { localStorage.setItem(EX_REST_KEY, JSON.stringify(m)); } catch (e) { /* stays session-only */ }
    renderBuilder();
  }
  function fmtRest(sec) { return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0"); }

  function startRest(exName) {
    ensureAudio();                       // we're inside a tap/keypress — unlock the beep for later
    restStart = Date.now();
    restDur = restSecFor(exName);        // exercise override, else the timer-card preset
    restCued = false;
    scheduleRestNotif();
  }

  /* ---- background rest alert (native builds) ----
     JS freezes when the app is backgrounded, so the in-page beep can't fire
     if the lifter switches apps mid-rest. On native we schedule an OS local
     notification for rest-end (+2s); while the app stays foreground the
     in-page cue fires first and CANCELS it, so there's never a double alarm.
     Web builds: no plugin -> these are silent no-ops. */
  var REST_NOTIF_ID = 8642;
  function restNotifPlugin() {
    var C = window.Capacitor;
    var LN = C && C.Plugins && C.Plugins.LocalNotifications;
    return (LN && typeof LN.schedule === "function") ? LN : null;
  }
  /** Ask for notification permission at a CALM moment (Start workout), not
      on the first ✓ — the iOS alert used to land exactly as the lifter's
      first rest began, covering the countdown, and re-presented on every
      launch while unanswered. */
  function preRequestRestNotif() {
    var LN = restNotifPlugin();
    if (!LN) return;
    LN.checkPermissions().then(function (s) {
      var st = s && s.display;
      if (st !== "granted" && st !== "denied") return LN.requestPermissions();
    }).catch(function () { /* best-effort */ });
  }
  function scheduleRestNotif() {
    var LN = restNotifPlugin();
    if (!LN) return;
    var at = new Date(restStart + restDur * 1000 + 2000);
    LN.cancel({ notifications: [{ id: REST_NOTIF_ID }] }).catch(function () {}).then(function () {
      return LN.checkPermissions();
    }).then(function (s) {
      var st = s && s.display;
      if (st !== "granted") return;   // asked at Start; mid-set is never the moment
      LN.schedule({ notifications: [{
        id: REST_NOTIF_ID,
        title: "Rest done — go!",
        body: "Time for your next set.",
        schedule: { at: at },
        sound: "default"   // iOS: unset means SILENT; a missing named file falls back to the system default sound
      }] }).catch(function () { /* best-effort */ });
    }).catch(function () { /* plugin hiccup: in-page beep still covers foreground */ });
  }
  function cancelRestNotif() {
    var LN = restNotifPlugin();
    if (LN) LN.cancel({ notifications: [{ id: REST_NOTIF_ID }] }).catch(function () {});
  }

  function renderRestBar() {
    var bar = document.getElementById("rest-bar");
    var onExerciseTab = !document.getElementById("tab-exercise").classList.contains("hidden");
    var durMs = (restDur || 90) * 1000;
    var since = restStart != null ? Date.now() - restStart : Infinity;
    var showing = mode === "active" && restStart != null && since < durMs + 60 * 1000;
    if (!showing || !onExerciseTab || finish.open) { if (bar) bar.hidden = true; return; }
    if (!bar) {
      bar = document.createElement("button");
      bar.id = "rest-bar"; bar.type = "button";
      bar.setAttribute("aria-label", "Rest countdown — tap to skip");
      bar.addEventListener("click", function () {
        restStart = null; cancelRestNotif(); saveActive(); renderRestBar();
      });
      document.body.appendChild(bar);
    }
    var remain = Math.ceil((durMs - since) / 1000);
    if (remain > 0) {
      bar.classList.remove("rest-done");
      bar.innerHTML = '<span class="rest-lbl">Rest</span> <strong>' +
        Math.floor(remain / 60) + ":" + String(remain % 60).padStart(2, "0") +
        '</strong> <span class="rest-dismiss">· tap to skip</span>';
    } else {
      if (!restCued) {
        restCued = true;
        cancelRestNotif();   // foreground cue wins — don't also fire the OS notification
        if (remain >= -2) {
          playBeep();
          try { if (navigator.vibrate) navigator.vibrate([120, 80, 120]); } catch (e) { /* iOS ignores */ }
        }
      }
      bar.classList.add("rest-done");
      bar.innerHTML = '<span class="rest-lbl">Rest done</span> <strong>— go!</strong>' +
        ' <span class="rest-dismiss">· tap to hide</span>';
    }
    bar.hidden = false;
  }

  /* ---------------- global "workout in progress" pill ---------------- */

  function updateLivePill() {
    var pill = document.getElementById("live-pill");
    var live = mode === "active" && activeStartedAt > 0;
    var onExerciseTab = !document.getElementById("tab-exercise").classList.contains("hidden");
    if (!live || onExerciseTab) { if (pill) pill.hidden = true; return; }
    if (!pill) {
      pill = document.createElement("button");
      pill.id = "live-pill"; pill.type = "button";
      pill.setAttribute("aria-label", "Workout in progress — tap to return");
      pill.addEventListener("click", function () {
        if (location.hash === "#exercise") { if (OF.app) OF.app.showTab("exercise"); }
        else location.hash = "#exercise";
        updateLivePill();   // same-hash path fires no hashchange — hide immediately
        renderRestBar();
      });
      document.body.appendChild(pill);
    }
    pill.innerHTML = '<span class="live-pill-dot" aria-hidden="true"></span>Workout in progress · ' +
      fmtElapsed(Date.now() - activeStartedAt) + ' ▸';
    pill.hidden = false;
  }

  function startSession() {
    // Same guard as startPrescribed: never silently wipe a live session.
    if (loadActive() && !confirm("You have a workout in progress. Start a new one and discard it?")) return;
    preRequestRestNotif();
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
    // say exactly what's being destroyed so a blind OK can't surprise anyone
    var nSets = exList.reduce(function (n, ex) { return n + (ex.sets ? ex.sets.length : 0); }, 0);
    var what = nSets > 0 ? "this workout and its " + nSets + " logged set" + (nSets === 1 ? "" : "s") : "this workout";
    if (!confirm("Discard " + what + "? Nothing will be saved.")) return;
    stopTick();
    clearActive();
    exList = [];
    activeProgramDay = null;
    restStart = null;
    cancelRestNotif();
    finish.open = false;
    showHub();
    updateLivePill();
  }

  /* ---- finish step (ratings live HERE, at the end) ---- */
  function pillRow(name, val) {
    var labels = name === "intensity"
      ? ["Very light", "Light", "Moderate", "Hard", "Max effort"]
      : name === "enjoyment"
        ? ["Hated it", "Meh", "Fine", "Good fun", "Loved it"]
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
    updateStepper(null);   // never strand the ± strip across screens
    els.hub.classList.add("hidden");
    if (els.form) els.form.classList.add("hidden");
    els.active.classList.remove("hidden");
    stopTick();
    // Clamp to the field's own 1–600 range: a session left open and resumed the
    // next day would otherwise prefill a huge elapsed time that saveSession then
    // rejects (>600), making the workout impossible to save.
    var mins = Math.max(1, Math.min(600, Math.round((Date.now() - activeStartedAt) / 60000)));
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
        '<div class="wo-finish-block"><span class="wo-finish-lbl">Did you enjoy it?</span>' +
          '<div class="wo-pills" id="wo-enjoyment">' + pillRow("enjoyment", finish.enjoyment || 3) + '</div></div>' +
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
    if (exs.skippedPrescribed) {
      U.toast(exs.skippedPrescribed + " untouched exercise" + (exs.skippedPrescribed === 1 ? "" : "s") +
        " left out (nothing was logged for " + (exs.skippedPrescribed === 1 ? "it" : "them") + ")", "warn");
    }
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
    var planResult = null;
    if (activeProgramDay != null && OF.trainer && OF.trainer.completeSession) {
      try { planResult = OF.trainer.completeSession(activeProgramDay, rec.exercises || []); } catch (e) {}
    }
    var prs = detectPRs(rec.exercises || []);
    activeProgramDay = null;
    restStart = null;
    cancelRestNotif();
    stopTick();
    clearActive();
    exList = [];
    try {   // Coach 2.0: enjoyment rating feeds preference learning
      if (OF.learn && finish.enjoyment) OF.learn.feedback("enjoyment", finish.enjoyment, rec.type || "");
    } catch (eFb) { /* best-effort */ }
    finish = { open: false, intensity: 3, performance: 3 };
    showHub();
    renderList();
    OF.dashboard && OF.dashboard.refresh();
    if (OF.trainer && OF.trainer.refresh) OF.trainer.refresh();
    showRecap(rec, prs, planResult);
  }

  /* ---- post-session recap + PR celebration ---- */
  function prMeta() { try { return JSON.parse(localStorage.getItem("optimalfit.prMeta") || "{}") || {}; } catch (e) { return {}; } }

  /** Rebuild the per-lift e1RM high-water marks from the FULL history.
      Called after a past workout is edited or deleted — otherwise a typo'd
      500 kg entry would permanently suppress every future (real) PR. */
  function rebuildPrMeta() {
    var meta = {};
    S.getAll("exercise").forEach(function (rec) {
      (rec.exercises || []).forEach(function (ex) {
        if (!ex || !ex.name || !Array.isArray(ex.sets)) return;
        var key = ex.name.trim().toLowerCase();
        ex.sets.forEach(function (s) {
          var w = Number(s.weightKg), r = Number(s.reps);
          if (isFinite(w) && w > 0 && isFinite(r) && r >= 1 && r <= 12) {
            var eOne = r <= 1 ? w : w * (1 + r / 30);
            if (!meta[key] || eOne > meta[key]) meta[key] = Math.round(eOne * 100) / 100;
          }
        });
      });
    });
    try { localStorage.setItem("optimalfit.prMeta", JSON.stringify(meta)); } catch (e) {}
  }
  function detectPRs(loggedExercises) {
    var meta = prMeta(), prs = [], changed = false;
    // Aggregate the best e1RM per exercise NAME across all cards first, then
    // compare each name once against the persisted prior best. (Comparing
    // card-by-card and writing meta mid-loop would make a second card of the
    // same lift race against the first card's just-written value — falsely
    // celebrating a "PR" on an exercise's very first session.)
    var bestByName = {};
    (loggedExercises || []).forEach(function (ex) {
      if (!ex || !ex.name || !Array.isArray(ex.sets)) return;
      var key = ex.name.trim().toLowerCase();
      var maxReps = 0, anyLoaded = false;
      ex.sets.forEach(function (s) {
        var w = Number(s.weightKg), r = Number(s.reps);
        if (isFinite(w) && w > 0 && isFinite(r) && r >= 1 && r <= 12) {
          anyLoaded = true;
          var eOne = r <= 1 ? w : w * (1 + r / 30);   // a true single IS its own 1RM (match strength-engine)
          if (!bestByName[key] || eOne > bestByName[key].best) bestByName[key] = { best: eOne, name: ex.name };
        }
        if (isFinite(r) && r >= 1) maxReps = Math.max(maxReps, r);
      });
      // bodyweight lift (no load logged): a new best REP count is a real PR too
      if (!anyLoaded && maxReps > 0 && !bestByName[key]) {
        bestByName[key] = { best: maxReps, name: ex.name, bw: true };
      }
    });
    Object.keys(bestByName).forEach(function (key) {
      var b = bestByName[key], best = b.best, name = b.name, isBw = !!b.bw;
      // bodyweight PRs tracked under a separate key so a rep-count never races
      // an e1RM value for the same lift
      var mkey = isBw ? "bw:" + key : key, prev = meta[mkey];
      if (prev == null || best > prev * 1.001) {
        if (prev != null) {
          if (isBw) prs.push({ name: name, reps: Math.round(best), prevReps: Math.round(prev), bw: true });
          else prs.push({ name: name, e1RMkg: Math.round(best * 10) / 10, prev: Math.round(prev * 10) / 10 });
          try { OF.trainer && OF.trainer.bumpStat && OF.trainer.bumpStat("prs"); } catch (e2) {}
        }
        meta[mkey] = Math.round(best * 100) / 100; changed = true;
      }
    });
    if (changed) { try { localStorage.setItem("optimalfit.prMeta", JSON.stringify(meta)); } catch (e) {} }
    return prs;
  }

  function confettiBurst() {
    var host = document.createElement("div");
    host.className = "confetti-host";
    var colors = ["#8b5cf6", "#22d3ee", "#ff8a3d", "#4ade80", "#f472b6"];
    for (var i = 0; i < 36; i++) {
      var c = document.createElement("span");
      c.className = "confetti-bit";
      c.style.left = (Math.round(Math.random() * 100)) + "%";
      c.style.background = colors[i % colors.length];
      c.style.animationDelay = (Math.round(Math.random() * 300)) + "ms";
      c.style.transform = "rotate(" + (Math.round(Math.random() * 360)) + "deg)";
      host.appendChild(c);
    }
    document.body.appendChild(host);
    setTimeout(function () { host.remove(); }, 2600);
  }

  function showRecap(rec, prs, planResult) {
    var hasPR = prs && prs.length;
    var hasChange = planResult && planResult.changes &&
      planResult.changes.some(function (c) { return c.kind === "added" || c.kind === "deloaded" || c.kind === "seeded"; });
    // The FIRST-EVER saved workout always gets a recap — a beginner's first
    // session ending in silence is a churn moment, not a non-event.
    var firstEver = S.getAll("exercise").length === 1;
    if (!hasPR && !hasChange && !firstEver) return;   // nothing notable — don't interrupt with a modal
    var wTxtFn = function (kg) { return U.fmtWeight(kg, 1); };
    var body = "";
    if (prs && prs.length) {
      body += '<div class="recap-pr">🎉 ' + (prs.length === 1 ? "New personal record!" : prs.length + " new personal records!") + '</div>';
      body += '<ul class="recap-pr-list">' + prs.map(function (p) {
        if (p.bw) {
          return '<li><strong>' + U.esc(p.name) + '</strong> — ' + U.esc(String(p.reps)) + ' reps' +
            ' <span class="muted">(was ' + U.esc(String(p.prevReps)) + ')</span></li>';
        }
        return '<li><strong>' + U.esc(p.name) + '</strong> — est. 1RM ' + U.esc(wTxtFn(p.e1RMkg)) +
          ' <span class="muted">(was ' + U.esc(wTxtFn(p.prev)) + ')</span></li>';
      }).join("") + '</ul>';
    }
    if (planResult && planResult.changes && planResult.changes.length) {
      var adds = planResult.changes.filter(function (c) { return c.kind === "added"; });
      var dels = planResult.changes.filter(function (c) { return c.kind === "deloaded"; });
      if (adds.length) {
        body += '<div class="recap-sec"><div class="recap-sec-h">Next time — weight going up 💪</div><ul class="recap-list">' +
          adds.map(function (c) { return '<li>' + U.esc(c.name) + ': ' + U.esc(wTxtFn(c.from)) + ' → <strong>' + U.esc(wTxtFn(c.to)) + '</strong></li>'; }).join("") + '</ul></div>';
      }
      if (dels.length) {
        body += '<div class="recap-sec"><div class="recap-sec-h">Backing off to rebuild</div><ul class="recap-list">' +
          dels.map(function (c) { return '<li>' + U.esc(c.name) + ': → <strong>' + U.esc(wTxtFn(c.to)) + '</strong> (let\'s nail the reps)</li>'; }).join("") + '</ul></div>';
      }
      if (planResult.nextName) body += '<p class="recap-next">Up next: <strong>' + U.esc(planResult.nextName) + '</strong></p>';
    }
    if (!body && firstEver) {
      var nSets2 = (rec.exercises || []).reduce(function (n, ex) { return n + (ex.sets ? ex.sets.length : 0); }, 0);
      body = '<div class="recap-pr">🎉 First workout logged!</div>' +
        '<p class="recap-generic">' + (rec.durationMin || 0) + ' min · ' + (rec.exercises || []).length +
        ' exercise' + ((rec.exercises || []).length === 1 ? '' : 's') + (nSets2 ? ' · ' + nSets2 + ' set' + (nSets2 === 1 ? '' : 's') : '') +
        '. Every session from here teaches the app what works for you.</p>';
    }
    if (!body) body = '<p class="recap-generic">Logged. Every session counts — see you next time.</p>';

    var m = document.getElementById("recap-modal");
    if (!m) { m = document.createElement("div"); m.id = "recap-modal"; m.className = "metric-modal"; document.body.appendChild(m); }
    m.hidden = false;
    document.body.classList.add("metric-modal-open");
    m.innerHTML = '<div class="metric-modal-backdrop" data-recap-close></div>' +
      '<div class="metric-modal-panel recap-panel" role="dialog" aria-modal="true">' +
      '<div class="recap-head">💪 Workout complete</div>' +
      '<div class="recap-body">' + body + '</div>' +
      '<button type="button" class="btn primary recap-done" data-recap-close>Done</button></div>';
    m.querySelectorAll("[data-recap-close]").forEach(function (b) {
      b.addEventListener("click", function () { m.hidden = true; document.body.classList.remove("metric-modal-open"); });
    });
    if ((prs && prs.length) || firstEver) confettiBurst();
  }

  /* ============================================================
     Hub (no active session)
     ============================================================ */
  function showHub() {
    updateStepper(null);   // never strand the ± strip across screens
    mode = "hub";
    stopTick();
    builderHost = null;
    els.active.classList.add("hidden");
    els.active.innerHTML = "";
    if (els.form) els.form.classList.add("hidden");
    els.hub.classList.remove("hidden");
    els.error = document.getElementById("exercise-error");
    renderRepeatBtn();
  }

  /** Most recent session that actually has logged exercises (for one-tap repeat). */
  function lastLoggedSession() {
    var arr = S.getAll("exercise").slice().sort(U.byNewest);
    for (var i = 0; i < arr.length; i++) {
      var exs = arr[i].exercises;
      if (Array.isArray(exs) && exs.some(function (ex) {
        return ex && ex.name && Array.isArray(ex.sets) && ex.sets.length;
      })) return arr[i];
    }
    return null;
  }

  /* One-tap "same as last time": most lifters run the same session for weeks,
     so the hub offers the previous workout pre-loaded — names, sets, weights. */
  function renderRepeatBtn() {
    var rep = document.getElementById("wo-repeat-btn");
    var last = lastLoggedSession();
    if (!last) { if (rep) rep.remove(); return; }
    var names = last.exercises.map(function (ex) { return ex && ex.name; }).filter(Boolean);
    var lbl = names.slice(0, 3).join(", ") + (names.length > 3 ? " +" + (names.length - 3) : "");
    if (!rep) {
      rep = document.createElement("button");
      rep.type = "button";
      rep.id = "wo-repeat-btn";
      rep.className = "btn ghost wo-manual-btn";
      rep.setAttribute("data-wo", "repeat");
      var manualBtn = els.hub.querySelector('[data-wo="manual"]');
      els.hub.insertBefore(rep, manualBtn);
    }
    rep.textContent = "Repeat last workout · " + lbl;
  }

  function startRepeatLast() {
    var last = lastLoggedSession();
    if (!last) return;
    if (loadActive() && !confirm("You have a workout in progress. Start a new one and discard it?")) return;
    activeStartedAt = Date.now();
    sessType = typeof last.type === "string" && last.type ? last.type : "strength";
    activeProgramDay = null;
    finish = { open: false, intensity: 3, performance: 3 };
    exList = last.exercises.filter(function (ex) { return ex && ex.name; })
      .slice(0, MAX_EXERCISES)
      .map(function (ex) {
        return { name: ex.name, prefilled: true,
          sets: (Array.isArray(ex.sets) ? ex.sets : []).slice(0, MAX_SETS).map(seedSet) };
      });
    mode = "active";
    saveActive();
    renderActive();
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
    if (els.date.value > U.maxLogDateISO()) return { err: "That date is too far in the future." };
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
    if (editId) rebuildPrMeta();   // an edited history must re-derive the PR high-water marks
    else detectPRs(r.rec.exercises || []);
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
    if (t.closest && t.closest('[data-wo="repeat"]')) { startRepeatLast(); return; }
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
    // whole history row is tappable -> edit (same live-session guard as the button)
    var histRow = t.closest && t.closest("#exercise-list .entry[data-id]");
    if (histRow) {
      if (mode === "active") {
        U.toast("Finish or discard your live workout first, then edit past workouts.", "warn");
        return;
      }
      var hrec = S.get("exercise", histRow.getAttribute("data-id"));
      if (hrec) enterEditMode(hrec);
      return;
    }

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
    if (t.hasAttribute && t.hasAttribute("data-field")) {
      builderInput(t);
      if (t === stepperTarget) updateStepper(t);   // live plate hint while typing
    }
    // finish-screen notes: keep in state so tapping Back then Complete (which
    // re-renders the finish screen) doesn't silently wipe what was typed.
    if (t.id === "wo-notes") { finish.notes = t.value; return; }
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
    // Enter/Go inside a set's weight/reps input must not submit the manual
    // form — it would save a half-entered workout. Instead it advances the
    // flow: weight -> reps, reps -> set done (which starts the rest countdown).
    if (e.key === "Enter" && t.hasAttribute && t.hasAttribute("data-field")) {
      e.preventDefault();
      var row = t.closest && t.closest(".set-row");
      if (t.getAttribute("data-field") === "w") {
        var rIn = row && row.querySelector('[data-field="r"]');
        if (rIn) { rIn.focus(); if (rIn.select) rIn.select(); }
        return;
      }
      // reps field: done only in the live session, and only with reps entered
      t.blur();   // dismiss the keyboard first — renderBuilder replaces this node
      if (mode !== "active") return;
      var ei = parseInt(t.getAttribute("data-ex"), 10);
      var sj = parseInt(t.getAttribute("data-set"), 10);
      var ex = exList[ei], st = ex && ex.sets[sj];
      if (!st || st.done) return;
      var reps = U.numOrNull(t.value);
      if (reps == null || isNaN(reps) || reps < 1) return;   // nothing entered — just close the keyboard
      st.done = true;
      ex.touched = true;
      startRest(ex.name);
      saveActive();
      renderBuilder();
      renderRestBar();
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
    if (btn.getAttribute("data-act") === "show-more") { listLimit += 50; renderList(); return; }
    var id = btn.getAttribute("data-id");
    if (btn.getAttribute("data-act") === "del") {
      var doomed = S.get("exercise", id);
      S.remove("exercise", id);
      rebuildPrMeta();   // deleting (e.g. a typo'd entry) must free up its PR high-water mark
      if (els.editId && els.editId.value === id) closeManual();
      renderList();
      OF.dashboard && OF.dashboard.refresh();
      if (doomed) U.undoDelete("exercise", doomed, "Workout", function () {
        rebuildPrMeta();
        renderList(); OF.dashboard && OF.dashboard.refresh();
      });
    } else {
      // The manual editor shares its exercise-builder state with the live
      // logger — opening it mid-session would clobber the running workout.
      if (mode === "active") {
        U.toast("Finish or discard your live workout first, then edit past workouts.", "warn");
        return;
      }
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
    var shown = arr.slice(0, listLimit);
    els.list.innerHTML = shown.map(function (r) {
      var t0 = r.type || "other";
      var title = t0.charAt(0).toUpperCase() + t0.slice(1) + " · " + r.durationMin + " min";
      var sub = U.fmtDate(r.date) + " " + r.startTime +
        " · intensity " + r.intensity + "/5" + (r.notes ? " · " + r.notes : "");
      var perf = "perf " + r.performance + "/5";
      return '<div class="entry" data-id="' + U.esc(r.id) + '" role="button" tabindex="0" title="Tap to edit">' +
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
    }).join("") + (arr.length > listLimit
      ? '<button type="button" class="btn list-more" data-act="show-more">Show ' + Math.min(50, arr.length - listLimit) + ' more (' + (arr.length - listLimit) + ' older)</button>'
      : "");
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
  // Robust audio: a real <audio> element beats WebAudio in iOS WKWebView.
  // Primed (loaded + a silent play/pause) on the first user gesture so a later
  // programmatic .play() is allowed.
  var beepEl = null, beepPrimed = false;
  function beepAudio() {
    if (!beepEl && OF.BEEP_DATA_URI) {
      beepEl = new Audio(OF.BEEP_DATA_URI);
      beepEl.preload = "auto";
    }
    return beepEl;
  }
  function primeBeep() {
    var el = beepAudio();
    if (!el || beepPrimed) return;
    beepPrimed = true;
    try {
      el.volume = 0;
      var pr = el.play();
      if (pr && pr.then) pr.then(function () { el.pause(); el.currentTime = 0; el.volume = 1; })
        .catch(function () { el.volume = 1; });
      else { el.pause(); el.currentTime = 0; el.volume = 1; }
    } catch (e) { el.volume = 1; }
  }
  function playBeep() {
    var el = beepAudio();
    if (el) { try { el.currentTime = 0; el.volume = 1; el.play(); } catch (e) {} }
    beep();   // WebAudio too — whichever the device honors
    // second burst ~600ms later: a single chirp is easy to miss under music;
    // AVAudioSession ducks the music while these play
    setTimeout(function () {
      if (el) { try { el.currentTime = 0; el.play(); } catch (e) {} }
      beep();
    }, 600);
  }

  function ensureAudioUnlockOnce() {
    document.addEventListener("pointerdown", function onFirstTap() {
      primeBeep(); ensureAudio();
      document.removeEventListener("pointerdown", onFirstTap);
    }, { once: true });
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
        g.gain.exponentialRampToValueAtTime(0.5, now + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.16);
        osc.connect(g); g.connect(audioCtx.destination);
        osc.start(now + t); osc.stop(now + t + 0.18);
      });
    } catch (e) { /* best-effort */ }
  }
  function finishCue() {
    T.finished = true; playBeep();
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
        '<p class="rt-hint" data-cd>During a workout this starts by itself each time you check off a set (or hit Enter after your reps).</p>' +
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

  return { init: init, renderList: renderList, startPrescribed: startPrescribed, celebrate: confettiBurst };
})();

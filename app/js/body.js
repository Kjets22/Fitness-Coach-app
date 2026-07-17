/* ============================================================
   body.js — body metrics tracker: form + history list.
   Record: { date, weightKg, bodyFatPct, muscleMassKg, notes }
   Weight is required; body fat % and muscle mass optional.
   Muscle mass is a WEIGHT (smart scales report it in kg/lb), entered
   in the user's display unit and stored as muscleMassKg. Legacy
   records that stored muscleMassPct still render/convert everywhere
   via U.muscleKg(rec).
   ============================================================ */

window.OF = window.OF || {};

OF.body = (function () {
  "use strict";
  var U = OF.util, S = OF.storage;
  var els = {};
  var listLimit = 50;   // windowed history: render newest 50, expand on demand

  function init() {
    els.form = document.getElementById("body-form");
    els.editId = document.getElementById("body-edit-id");
    els.date = document.getElementById("body-date");
    els.weight = document.getElementById("body-weight");
    els.fat = document.getElementById("body-fat");
    els.muscle = document.getElementById("body-muscle");
    els.notes = document.getElementById("body-notes");
    els.error = document.getElementById("body-error");
    els.submit = document.getElementById("body-submit");
    els.cancel = document.getElementById("body-cancel-edit");
    els.title = document.getElementById("body-form-title");
    els.list = document.getElementById("body-list");
    els.summary = document.getElementById("body-summary");

    setDefaults();
    els.form.addEventListener("submit", onSubmit);
    els.cancel.addEventListener("click", exitEditMode);
    els.list.addEventListener("click", onListClick);
    if (els.summary) {
      els.summary.setAttribute("title", "Tap to edit your latest measurement");
      els.summary.addEventListener("click", function () {
        var latest = S.getAll("body").slice().sort(U.byNewest)[0];
        if (latest) enterEditMode(latest);
      });
    }
    renderList();
  }

  /** Weight + muscle mass are stored in kg but entered/shown in the preferred unit. */
  function applyUnits() {
    var unit = U.weightUnit();
    var lbl = document.getElementById("body-weight-unit");
    if (lbl) lbl.textContent = unit;
    if (els.weight) {
      els.weight.min = unit === "lb" ? 44 : 20;
      els.weight.max = unit === "lb" ? 880 : 400;
      els.weight.placeholder = unit === "lb" ? "165.0" : "75.0";
    }
    var mlbl = document.getElementById("body-muscle-unit");
    if (mlbl) mlbl.textContent = unit;
    if (els.muscle) {
      els.muscle.min = unit === "lb" ? 11 : 5;
      els.muscle.max = unit === "lb" ? 660 : 300;
      els.muscle.placeholder = unit === "lb" ? "optional — e.g. 120.0" : "optional — e.g. 55.0";
    }
  }

  function setDefaults() {
    els.date.value = U.todayISO();
    // prefill the last weight — day-to-day weight barely moves, so most
    // entries are a one-field tweak instead of typed from scratch
    var last = S.getAll("body").slice().sort(U.byNewest)[0];
    els.weight.value = (last && last.weightKg != null)
      ? U.toDisplayWeight(last.weightKg) : "";
    els.fat.value = "";
    els.muscle.value = "";
    els.notes.value = "";
  }

  function showError(msg) {
    els.error.textContent = msg;
    els.error.hidden = !msg;
  }

  function readForm() {
    if (!els.date.value) return { err: "Please pick a date." };
    if (els.date.value > U.maxLogDateISO()) return { err: "That date is too far in the future — measurements can only be logged for today or earlier." };
    var wDisp = U.numOrNull(els.weight.value);
    var lo = U.weightUnit() === "lb" ? 44 : 20;
    var hi = U.weightUnit() === "lb" ? 880 : 400;
    if (wDisp === null || isNaN(wDisp) || wDisp < lo || wDisp > hi) {
      return { err: "Weight must be between " + lo + " and " + hi + " " + U.weightUnit() + "." };
    }
    var w = U.fromDisplayWeight(wDisp); // stored metric
    var bf = U.numOrNull(els.fat.value);
    if (bf !== null && (isNaN(bf) || bf < 0 || bf > 100)) {
      return { err: "Body fat % must be between 0 and 100." };
    }
    var mmDisp = U.numOrNull(els.muscle.value);
    var mLo = U.weightUnit() === "lb" ? 11 : 5;
    var mHi = U.weightUnit() === "lb" ? 660 : 300;
    if (mmDisp !== null && (isNaN(mmDisp) || mmDisp < mLo || mmDisp > mHi)) {
      return { err: "Muscle mass must be between " + mLo + " and " + mHi + " " + U.weightUnit() + "." };
    }
    var mmKg = mmDisp !== null ? U.fromDisplayWeight(mmDisp) : null;
    // Non-blocking sanity warnings: muscle mass can't exceed body weight, and
    // a weight that jumps >8% since the last entry is usually a typo (57 for
    // 75) — it would silently rewrite calorie/water targets.
    var warn = "";
    if (mmKg !== null && mmKg > w) {
      warn = "Heads up: muscle mass (" + U.fmtWeight(mmKg) + ") is more than your body weight (" +
        U.fmtWeight(w) + ") — double-check the values.";
    } else {
      var prevRec = S.getAll("body").slice().sort(U.byNewest).filter(function (r) {
        return r.id !== els.editId.value && isFinite(Number(r.weightKg));
      })[0];
      if (prevRec && Math.abs(w - prevRec.weightKg) / prevRec.weightKg > 0.08) {
        warn = "Heads up: that's " + U.fmtWeight(w) + " vs " + U.fmtWeight(prevRec.weightKg) +
          " last time — double-check for a typo (saved anyway).";
      }
    }
    return {
      warn: warn,
      rec: {
        date: els.date.value,
        weightKg: Math.round(w * 100) / 100,
        bodyFatPct: bf !== null ? Math.round(bf * 10) / 10 : null,
        muscleMassKg: mmKg !== null ? Math.round(mmKg * 100) / 100 : null,   // 0.01 kg so lb entries round-trip exactly (like weightKg)
        muscleMassPct: null,   // legacy % field: cleared on save so edited records converge to kg
        notes: els.notes.value.trim()
      }
    };
  }

  var lastSaveAt = 0;   // double-tap guard (same as sleep.js)
  function onSubmit(e) {
    e.preventDefault();
    if (Date.now() - lastSaveAt < 800) return;
    var r = readForm();
    if (r.err) { showError(r.err); return; }
    showError("");
    lastSaveAt = Date.now();
    var editId = els.editId.value, added = null;
    if (editId) {
      if (!S.update("body", editId, r.rec)) {
        showError("Could not save — browser storage is full or blocked. Your entry was NOT saved.");
        return;
      }
      exitEditMode();
    } else {
      added = S.add("body", r.rec);
      if (!added) {
        showError("Could not save — browser storage is full or blocked. Your entry was NOT saved.");
        return;
      }
      setDefaults();
    }
    if (r.warn) {
      if (OF.haptics) OF.haptics.warning();
      // suspected typo: saved, but hand the user the Undo right in the warning
      U.toast(r.warn, "warn", added ? {
        label: "Undo",
        fn: function () { S.remove("body", added.id); renderList(); if (OF.dashboard) OF.dashboard.refresh(); }
      } : undefined);
    } else {
      U.toast(editId ? "Measurement updated." : "Saved.", "ok");
    }
    renderList();
    OF.dashboard && OF.dashboard.refresh();
  }

  function enterEditMode(rec) {
    els.editId.value = rec.id;
    els.date.value = rec.date;
    els.weight.value = rec.weightKg != null ? U.toDisplayWeight(rec.weightKg) : "";
    els.fat.value = rec.bodyFatPct != null ? rec.bodyFatPct : "";
    var mKg = U.muscleKg(rec);   // handles both new kg records and legacy % records
    els.muscle.value = mKg != null ? U.toDisplayWeight(mKg) : "";
    els.notes.value = rec.notes || "";
    els.title.textContent = "Edit measurement";
    els.submit.textContent = "Save changes";
    els.cancel.classList.remove("hidden");
    els.form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function exitEditMode() {
    els.editId.value = "";
    els.title.textContent = "Log measurements";
    els.submit.textContent = "Add measurement";
    els.cancel.classList.add("hidden");
    showError("");
    setDefaults();
  }

  function onListClick(e) {
    var btn = e.target.closest("button[data-act]");
    if (!btn) {
      // the whole row is tappable — tap anywhere on an entry to edit it
      var row = e.target.closest(".entry[data-id]");
      if (row) { var rrec = S.get("body", row.getAttribute("data-id")); if (rrec) enterEditMode(rrec); }
      return;
    }
    if (btn.getAttribute("data-act") === "show-more") { listLimit += 50; renderList(); return; }
    var id = btn.getAttribute("data-id");
    if (btn.getAttribute("data-act") === "del") {
      var doomed = S.get("body", id);
      S.remove("body", id);
      if (els.editId.value === id) exitEditMode();
      renderList();
      OF.dashboard && OF.dashboard.refresh();
      if (doomed) U.undoDelete("body", doomed, "Measurement", function () {
        renderList(); OF.dashboard && OF.dashboard.refresh();
      });
    } else {
      var rec = S.get("body", id);
      if (rec) enterEditMode(rec);
    }
  }

  /** Latest-measurement summary strip above the form. */
  function renderSummary() {
    if (!els.summary) return;
    var arr = S.getAll("body").slice().sort(U.byNewest);
    if (!arr.length) { els.summary.innerHTML = ""; return; }
    var latest = arr[0];
    var extra = [];
    if (latest.bodyFatPct != null) extra.push(latest.bodyFatPct + "% fat");
    var latestMuscle = U.muscleKg(latest);
    if (latestMuscle != null) extra.push(U.fmtWeight(latestMuscle) + " muscle");
    els.summary.innerHTML =
      '<span class="entry-ico">' + OF.icons.get("scale") + '</span>' +
      '<span>Latest: <strong>' + U.esc(U.fmtWeight(latest.weightKg)) + '</strong> · ' +
      U.esc(U.fmtDate(latest.date)) + '</span>' +
      (extra.length ? '<span>' + U.esc(extra.join(" · ")) + '</span>' : '');
  }

  function renderList() {
    applyUnits(); // keep the form label/bounds in sync with the unit pref
    // If an edit is in progress, RE-PREFILL its number fields from the stored
    // kg values: a unit switch in Settings re-renders this tab, and numbers
    // left in the OLD unit would be silently reinterpreted in the NEW unit on
    // save (165 lb -> "165" -> saved as 165 kg, a 2.2x corruption).
    var editingId = els.editId && els.editId.value;
    if (editingId) {
      var editingRec = S.get("body", editingId);
      if (editingRec) {
        els.weight.value = editingRec.weightKg != null ? U.toDisplayWeight(editingRec.weightKg) : "";
        var em = U.muscleKg(editingRec);
        els.muscle.value = em != null ? U.toDisplayWeight(em) : "";
      }
    }
    renderSummary();
    var arr = S.getAll("body").slice().sort(U.byNewest);
    if (!arr.length) {
      els.list.innerHTML = '<div class="empty-state">' + OF.icons.badge("scale") +
        '<p>No measurements logged yet — a couple of weigh-ins per week is plenty.</p></div>';
      return;
    }
    var shown = arr.slice(0, listLimit);
    els.list.innerHTML = shown.map(function (r) {
      var parts = [];
      if (r.bodyFatPct != null) parts.push(r.bodyFatPct + "% fat");
      var rMuscle = U.muscleKg(r);
      if (rMuscle != null) parts.push(U.fmtWeight(rMuscle) + " muscle");
      if (r.notes) parts.push(r.notes);
      return '<div class="entry" data-id="' + U.esc(r.id) + '" role="button" tabindex="0" title="Tap to edit">' +
        '<span class="entry-ico">' + OF.icons.get("scale") + '</span>' +
        '<div class="entry-main">' +
          '<div class="entry-title">' + U.esc(U.fmtWeight(r.weightKg)) + '</div>' +
          '<div class="entry-sub">' + U.esc(U.fmtDate(r.date)) +
            (parts.length ? ' &middot; ' + U.esc(parts.join(" · ")) : '') + '</div>' +
        '</div>' +
        '<div class="entry-actions">' +
          '<button class="btn mini" data-act="edit" data-id="' + U.esc(r.id) + '">Edit</button>' +
          '<button class="btn mini danger" data-act="del" data-id="' + U.esc(r.id) + '">Delete</button>' +
        '</div>' +
      '</div>';
    }).join("") + (arr.length > listLimit
      ? '<button type="button" class="btn list-more" data-act="show-more">Show ' + Math.min(50, arr.length - listLimit) + ' more (' + (arr.length - listLimit) + ' older)</button>'
      : "");
  }

  return { init: init, renderList: renderList };
})();

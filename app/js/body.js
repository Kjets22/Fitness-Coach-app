/* ============================================================
   body.js — body metrics tracker: form + history list.
   Record: { date, weightKg, bodyFatPct, muscleMassPct, notes }
   Weight is required; body fat % and muscle mass % optional.
   ============================================================ */

window.OF = window.OF || {};

OF.body = (function () {
  "use strict";
  var U = OF.util, S = OF.storage;
  var els = {};

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
    renderList();
  }

  /** Weight is stored in kg but entered/shown in the preferred unit. */
  function applyUnits() {
    var unit = U.weightUnit();
    var lbl = document.getElementById("body-weight-unit");
    if (lbl) lbl.textContent = unit;
    if (els.weight) {
      els.weight.min = unit === "lb" ? 44 : 20;
      els.weight.max = unit === "lb" ? 880 : 400;
      els.weight.placeholder = unit === "lb" ? "165.0" : "75.0";
    }
  }

  function setDefaults() {
    els.date.value = U.todayISO();
    els.weight.value = "";
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
    var mm = U.numOrNull(els.muscle.value);
    if (mm !== null && (isNaN(mm) || mm < 0 || mm > 100)) {
      return { err: "Muscle mass % must be between 0 and 100." };
    }
    // Non-blocking sanity warning: the two percentages can't really sum past 100.
    var warn = (bf !== null && mm !== null && bf + mm > 100)
      ? "Heads up: body fat + muscle mass add up to " + Math.round((bf + mm) * 10) / 10 +
        "% — double-check the values."
      : "";
    return {
      warn: warn,
      rec: {
        date: els.date.value,
        weightKg: Math.round(w * 100) / 100,
        bodyFatPct: bf !== null ? Math.round(bf * 10) / 10 : null,
        muscleMassPct: mm !== null ? Math.round(mm * 10) / 10 : null,
        notes: els.notes.value.trim()
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
      if (!S.update("body", editId, r.rec)) {
        showError("Could not save — browser storage is full or blocked. Your entry was NOT saved.");
        return;
      }
      exitEditMode();
    } else {
      if (!S.add("body", r.rec)) {
        showError("Could not save — browser storage is full or blocked. Your entry was NOT saved.");
        return;
      }
      setDefaults();
    }
    if (r.warn) U.toast(r.warn, "warn"); // saved fine, but the numbers look off
    renderList();
    OF.dashboard && OF.dashboard.refresh();
  }

  function enterEditMode(rec) {
    els.editId.value = rec.id;
    els.date.value = rec.date;
    els.weight.value = rec.weightKg != null ? U.toDisplayWeight(rec.weightKg) : "";
    els.fat.value = rec.bodyFatPct != null ? rec.bodyFatPct : "";
    els.muscle.value = rec.muscleMassPct != null ? rec.muscleMassPct : "";
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
    if (!btn) return;
    var id = btn.getAttribute("data-id");
    if (btn.getAttribute("data-act") === "del") {
      if (confirm("Delete this measurement?")) {
        S.remove("body", id);
        if (els.editId.value === id) exitEditMode();
        renderList();
        OF.dashboard && OF.dashboard.refresh();
      }
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
    if (latest.muscleMassPct != null) extra.push(latest.muscleMassPct + "% muscle");
    els.summary.innerHTML =
      '<span class="entry-ico">' + OF.icons.get("scale") + '</span>' +
      '<span>Latest: <strong>' + U.esc(U.fmtWeight(latest.weightKg)) + '</strong> · ' +
      U.esc(U.fmtDate(latest.date)) + '</span>' +
      (extra.length ? '<span>' + U.esc(extra.join(" · ")) + '</span>' : '');
  }

  function renderList() {
    applyUnits(); // keep the form label/bounds in sync with the unit pref
    renderSummary();
    var arr = S.getAll("body").slice().sort(U.byNewest);
    if (!arr.length) {
      els.list.innerHTML = '<div class="empty-state">' + OF.icons.badge("scale") +
        '<p>No measurements logged yet — a couple of weigh-ins per week is plenty.</p></div>';
      return;
    }
    els.list.innerHTML = arr.map(function (r) {
      var parts = [];
      if (r.bodyFatPct != null) parts.push(r.bodyFatPct + "% fat");
      if (r.muscleMassPct != null) parts.push(r.muscleMassPct + "% muscle");
      if (r.notes) parts.push(r.notes);
      return '<div class="entry">' +
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
    }).join("");
  }

  return { init: init, renderList: renderList };
})();

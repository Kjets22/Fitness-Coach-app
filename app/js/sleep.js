/* ============================================================
   sleep.js — sleep tracker: form + history list.
   Record: { date (wake-up date), bedTime, wakeTime, quality 1-5,
             durationMin (computed, crosses midnight), notes }
   Supports add, edit (form reuse) and delete.
   ============================================================ */

window.OF = window.OF || {};

OF.sleep = (function () {
  "use strict";
  var U = OF.util, S = OF.storage;
  var els = {};
  var listLimit = 50;   // windowed history: render newest 50, expand on demand

  function init() {
    els.form = document.getElementById("sleep-form");
    els.editId = document.getElementById("sleep-edit-id");
    els.date = document.getElementById("sleep-date");
    els.bed = document.getElementById("sleep-bed");
    els.wake = document.getElementById("sleep-wake");
    els.quality = document.getElementById("sleep-quality");
    els.notes = document.getElementById("sleep-notes");
    els.error = document.getElementById("sleep-error");
    els.preview = document.getElementById("sleep-duration-preview");
    els.submit = document.getElementById("sleep-submit");
    els.cancel = document.getElementById("sleep-cancel-edit");
    els.title = document.getElementById("sleep-form-title");
    els.list = document.getElementById("sleep-list");
    els.summary = document.getElementById("sleep-summary");

    setDefaults();
    renderQuick();
    els.form.addEventListener("submit", onSubmit);
    els.cancel.addEventListener("click", exitEditMode);
    els.bed.addEventListener("input", updatePreview);
    els.wake.addEventListener("input", updatePreview);
    // Event delegation for edit/delete buttons in the history list.
    els.list.addEventListener("click", onListClick);
    if (els.summary) {
      els.summary.setAttribute("title", "Tap to edit your latest entry");
      els.summary.addEventListener("click", function () {
        var latest = S.getAll("sleep").slice().sort(U.byNewest)[0];
        if (latest) enterEditMode(latest);
      });
    }
    renderList();
  }

  /* One-tap "usual night": sleep barely varies, so when today is unlogged
     offer last night's times + quality as a single tap (with Undo). */
  function renderQuick() {
    var host = document.getElementById("sleep-quick");
    if (!host) return;
    var today = U.todayISO();
    var arr = S.getAll("sleep");
    var todayHas = arr.some(function (r) { return r.date === today; });
    var last = arr.slice().sort(U.byNewest)[0];
    if (todayHas || !last || !last.bedTime || !last.wakeTime) { host.innerHTML = ""; return; }
    var t12 = function (hm) {
      var m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || ""));
      if (!m) return hm;
      var d = new Date(); d.setHours(+m[1], +m[2], 0, 0);
      return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    };
    host.innerHTML = '<div class="recent-chips"><button type="button" class="btn mini" id="sleep-usual">' +
      "\u26a1 Log usual night: " + U.esc(t12(last.bedTime)) + "\u2192" + U.esc(t12(last.wakeTime)) +
      " \u00b7 quality " + (last.quality || 3) + '</button></div>';
    host.querySelector("#sleep-usual").addEventListener("click", function () {
      var dur = U.sleepDurationMin(last.bedTime, last.wakeTime);
      var rec = S.add("sleep", { date: today, bedTime: last.bedTime, wakeTime: last.wakeTime,
        quality: last.quality || 3, durationMin: dur, notes: "" });
      if (!rec) return;
      renderList();
      renderQuick();
      if (OF.dashboard && OF.dashboard.refresh) { try { OF.dashboard.refresh(); } catch (e) {} }
      U.toast("Logged " + Math.floor(dur / 60) + "h " + (dur % 60) + "m of sleep for today.", "ok", {
        label: "Undo",
        fn: function () { S.remove("sleep", rec.id); renderList(); renderQuick();
          if (OF.dashboard && OF.dashboard.refresh) { try { OF.dashboard.refresh(); } catch (e) {} } }
      });
    });
  }

  function setDefaults() {
    els.date.value = U.todayISO();
    // default to the user's OWN usual times (last logged night), not a
    // hardcoded 23:00/07:00 they have to correct every day
    var last = S.getAll("sleep").slice().sort(U.byNewest)[0];
    els.bed.value = (last && /^\d{1,2}:\d{2}$/.test(last.bedTime || "")) ? last.bedTime : "23:00";
    els.wake.value = (last && /^\d{1,2}:\d{2}$/.test(last.wakeTime || "")) ? last.wakeTime : "07:00";
    els.quality.value = "3";
    els.notes.value = "";
    if (OF.ui) OF.ui.syncSegs(); // reflect onto the rating pills
    updatePreview();
  }

  function updatePreview() {
    var dur = U.sleepDurationMin(els.bed.value, els.wake.value);
    els.preview.textContent = dur != null ? "Duration: " + U.fmtDuration(dur) : "";
  }

  function showError(msg) {
    els.error.textContent = msg;
    els.error.hidden = !msg;
  }

  function readForm() {
    var date = els.date.value;
    var bed = els.bed.value;
    var wake = els.wake.value;
    if (!date) return { err: "Please pick the wake-up date." };
    if (date > U.maxLogDateISO()) return { err: "That date is too far in the future — sleep can only be logged for today or earlier." };
    if (!bed || U.timeToMinutes(bed) === null) return { err: "Please enter a valid bed time." };
    if (!wake || U.timeToMinutes(wake) === null) return { err: "Please enter a valid wake time." };
    var dur = U.sleepDurationMin(bed, wake);
    if (dur > 20 * 60) return { err: "That is over 20 hours of sleep — double-check the times." };
    var quality = parseInt(els.quality.value, 10);
    if (!(quality >= 1 && quality <= 5)) return { err: "Quality must be between 1 and 5." };
    return {
      rec: {
        date: date,
        bedTime: bed,
        wakeTime: wake,
        quality: quality,
        durationMin: dur,
        notes: els.notes.value.trim()
      }
    };
  }

  var lastSaveAt = 0;
  function onSubmit(e) {
    e.preventDefault();
    // Double-tap/double-Enter guard: setDefaults() refills VALID times, so a
    // second immediate submit would save a phantom 23:00-07:00 entry.
    if (Date.now() - lastSaveAt < 800) return;
    var r = readForm();
    if (r.err) { showError(r.err); return; }
    showError("");
    var editId = els.editId.value;
    if (editId) {
      // Health-imported nights store durationMin as the union of the actual
      // asleep intervals (awake gaps excluded), which is LESS than the
      // bed-to-wake span. If the user edits the record without touching the
      // times (e.g. just fixes quality), keep the imported duration instead
      // of silently inflating it to the full span.
      var orig = S.get("sleep", editId);
      if (orig && orig.durationMin != null &&
          orig.bedTime === r.rec.bedTime && orig.wakeTime === r.rec.wakeTime) {
        r.rec.durationMin = orig.durationMin;
      }
      if (!S.update("sleep", editId, r.rec)) {
        showError("Could not save — browser storage is full or blocked. Your entry was NOT saved.");
        return;
      }
      exitEditMode();
    } else {
      if (!S.add("sleep", r.rec)) {
        showError("Could not save — browser storage is full or blocked. Your entry was NOT saved.");
        return;
      }
      if (S.getAll("sleep").length === 1) {
        U.toast("First night logged 🎉 — a few more and your readiness score unlocks.", "ok");
      }
      setDefaults();
    }
    lastSaveAt = Date.now();
    renderList();
    OF.dashboard && OF.dashboard.refresh();
  }

  function enterEditMode(rec) {
    els.editId.value = rec.id;
    els.date.value = rec.date;
    els.bed.value = rec.bedTime;
    els.wake.value = rec.wakeTime;
    els.quality.value = String(rec.quality);
    els.notes.value = rec.notes || "";
    if (OF.ui) OF.ui.syncSegs();
    els.title.textContent = "Edit sleep entry";
    els.submit.textContent = "Save changes";
    els.cancel.classList.remove("hidden");
    updatePreview();
    els.form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function exitEditMode() {
    els.editId.value = "";
    els.title.textContent = "Log sleep";
    els.submit.textContent = "Add sleep entry";
    els.cancel.classList.add("hidden");
    showError("");
    setDefaults();
  }

  function onListClick(e) {
    var btn = e.target.closest("button[data-act]");
    if (!btn) {
      // the whole row is tappable — tap anywhere on an entry to edit it
      var row = e.target.closest(".entry[data-id]");
      if (row) { var rrec = S.get("sleep", row.getAttribute("data-id")); if (rrec) enterEditMode(rrec); }
      return;
    }
    if (btn.getAttribute("data-act") === "show-more") { listLimit += 50; renderList(); return; }
    var id = btn.getAttribute("data-id");
    if (btn.getAttribute("data-act") === "del") {
      var doomed = S.get("sleep", id);
      S.remove("sleep", id);
      if (els.editId.value === id) exitEditMode();
      renderList();
      OF.dashboard && OF.dashboard.refresh();
      // no scary confirm — delete immediately, offer Undo instead
      if (doomed) U.undoDelete("sleep", doomed, "Sleep entry", function () {
        renderList(); OF.dashboard && OF.dashboard.refresh();
      });
    } else {
      var rec = S.get("sleep", id);
      if (rec) enterEditMode(rec);
    }
  }

  /** Today's summary strip above the form. */
  function renderSummary() {
    if (!els.summary) return;
    var arr = S.getAll("sleep");
    if (!arr.length) { els.summary.innerHTML = ""; return; }
    var latest = arr.slice().sort(U.byNewest)[0];
    var cutoff = U.todayISO(-6);
    var week = arr.filter(function (r) { return r.date >= cutoff && isFinite(Number(r.durationMin)); });
    var avg = week.length
      ? week.reduce(function (n, r) { return n + Number(r.durationMin); }, 0) / week.length
      : null;
    els.summary.innerHTML =
      '<span class="entry-ico">' + OF.icons.get("moon") + '</span>' +
      '<span>' + (latest.date === U.todayISO() ? "Last night" : "Last sleep") + ': <strong>' +
      U.esc(U.fmtDuration(latest.durationMin)) + '</strong> · quality ' +
      U.esc(String(latest.quality)) + '/5</span>' +
      (avg != null ? '<span>7-day avg <strong>' + U.esc(U.fmtDuration(avg)) + '</strong></span>' : '');
  }

  function renderList() {
    setTimeout(renderQuick, 0);   // keep the one-tap chip in sync
    renderSummary();
    var arr = S.getAll("sleep").slice().sort(U.byNewest);
    if (!arr.length) {
      els.list.innerHTML = '<div class="empty-state">' + OF.icons.badge("moon") +
        '<p>No sleep logged yet — add last night above and your nights show up here.</p></div>';
      return;
    }
    var shown = arr.slice(0, listLimit);
    els.list.innerHTML = shown.map(function (r) {
      var stars = "★".repeat(r.quality || 0) + "☆".repeat(Math.max(0, 5 - (r.quality || 0)));
      return '<div class="entry" data-id="' + U.esc(r.id) + '" role="button" tabindex="0" title="Tap to edit">' +
        '<span class="entry-ico">' + OF.icons.get("moon") + '</span>' +
        '<div class="entry-main">' +
          '<div class="entry-title">' + U.esc(U.fmtDate(r.date)) + ' &mdash; ' +
            U.esc(U.fmtDuration(r.durationMin)) + '</div>' +
          '<div class="entry-sub">' + U.esc(r.bedTime) + ' &rarr; ' + U.esc(r.wakeTime) +
            (r.notes ? ' &middot; ' + U.esc(r.notes) : '') + '</div>' +
        '</div>' +
        '<span class="entry-badge" title="Quality">' + stars + '</span>' +
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

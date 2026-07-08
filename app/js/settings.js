/* ============================================================
   settings.js — export / import backup, demo data, clear all.
   Export downloads a JSON file via a Blob URL (works offline).
   Import lets the user choose merge vs replace.
   ============================================================ */

window.OF = window.OF || {};

OF.settings = (function () {
  "use strict";
  var S = OF.storage;
  var msgEl = null;

  function init() {
    msgEl = document.getElementById("settings-msg");
    document.getElementById("btn-export").addEventListener("click", doExport);
    document.getElementById("btn-import").addEventListener("click", function () {
      document.getElementById("import-file").click();
    });
    document.getElementById("import-file").addEventListener("change", onImportFile);
    document.getElementById("btn-demo").addEventListener("click", loadDemo);
    document.getElementById("btn-clear").addEventListener("click", clearAll);
    initUnits();
    if (OF.healthImport) OF.healthImport.init();
    initPhoneInfo();
  }

  /* ---------- "Use on your phone" server info ---------- */
  function initPhoneInfo() {
    var box = document.getElementById("phone-info");
    if (!box) return;
    if (location.protocol !== "http:" && location.protocol !== "https:") {
      // file:// — no server to ask; the static instructions above suffice.
      box.innerHTML = '<p class="muted small"><em>No server detected (you opened the app ' +
        'directly from a file). Start the phone server first to see the address here.</em></p>';
      return;
    }
    fetch("/api/health", { cache: "no-store" })
      .then(function (res) { return res.json(); })
      .then(function (j) {
        if (j && j.ok && j.phoneMode && Array.isArray(j.lanUrls) && j.lanUrls.length) {
          box.innerHTML = '<p class="muted small">Phone mode is ON. Open this on your phone:</p>' +
            j.lanUrls.map(function (u) {
              return '<span class="phone-url">' + OF.util.esc(u) + '</span>';
            }).join("") +
            '<p class="muted small">The AI coach pairing code is in the server window on the PC.</p>';
        } else if (j && j.ok) {
          box.innerHTML = '<p class="muted small">The server is running in PC-only mode. ' +
            'Close it and double-click <strong>&ldquo;Start OptimalFit (Phone).bat&rdquo;</strong> ' +
            'to allow phones on your WiFi.</p>';
        }
      })
      .catch(function () { /* no server — static instructions above still apply */ });
  }

  /* ---------- Units ---------- */
  function initUnits() {
    var wSel = document.getElementById("pref-weight-unit");
    var aSel = document.getElementById("pref-water-unit");
    if (!wSel || !aSel) return;
    var p = OF.units.prefs();
    wSel.value = p.weightUnit;
    aSel.value = p.waterUnit;
    wSel.addEventListener("change", function () {
      OF.units.setPrefs({ weightUnit: wSel.value });
      refreshAllViews();
    });
    aSel.addEventListener("change", function () {
      OF.units.setPrefs({ waterUnit: aSel.value });
      refreshAllViews();
    });
  }

  function msg(text) {
    if (msgEl) msgEl.textContent = text;
  }

  function refreshAllViews() {
    OF.sleep.renderList();
    OF.food.renderList();
    OF.exercise.renderList();
    OF.body.renderList();
    if (OF.daily) OF.daily.renderAll();
    OF.insights.refresh(); // also refreshes the goal area (adaptive loop + card)
    OF.dashboard.refresh(); // after insights so targets include fresh adjustments
  }

  /* ---------- Export ---------- */
  function doExport() {
    var json = S.exportAll();
    var blob = new Blob([json], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "optimalfit-backup-" + OF.util.todayISO() + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    msg("Exported " + S.countAll() + " records.");
  }

  /* ---------- Import ---------- */
  function onImportFile(e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;

    var reader = new FileReader();
    reader.onload = function () {
      try {
        var replace = false;
        if (S.countAll() > 0) {
          replace = confirm(
            "You already have " + S.countAll() + " records.\n\n" +
            "OK = REPLACE everything with the imported file.\n" +
            "Cancel = MERGE (keep current data, add new records)."
          );
        }
        var res = S.importAll(String(reader.result), replace ? "replace" : "merge");
        refreshAllViews();
        msg("Import complete: " + res.imported + " added, " + res.skipped + " skipped" +
            (replace ? " (replaced existing data)." : " (merged)."));
      } catch (err) {
        msg("Import failed: " + err.message);
      }
    };
    reader.onerror = function () { msg("Could not read that file."); };
    reader.readAsText(file);
  }

  /* ---------- Demo data ---------- */
  function loadDemo() {
    if (S.countAll() > 0 &&
        !confirm("Demo data will be ADDED on top of your existing " +
                 S.countAll() + " records. Continue?")) {
      return;
    }
    var c = OF.demo.generate(60);
    refreshAllViews();
    msg("Demo data loaded: " + c.sleep + " sleep, " + c.food + " food, " +
        c.exercise + " exercise, " + c.body + " body, " + c.water + " water, " +
        c.steps + " steps records" + (c.goal ? " + a demo lean-bulk goal" : "") + ".");
  }

  /* ---------- Clear ---------- */
  function clearAll() {
    if (!confirm("Delete ALL OptimalFit data from this device? This cannot be undone.")) return;
    if (!confirm("Really sure? Consider exporting a backup first.")) return;
    S.clearAll();
    refreshAllViews();
    msg("All data cleared.");
  }

  // refreshAll: used by health-import after merging records.
  return { init: init, refreshAll: refreshAllViews };
})();

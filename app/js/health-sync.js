/* ============================================================
   health-sync.js — LIVE auto-sync from Apple Health (HealthKit)
   and Android Health Connect, via the capacitor-health-extended
   plugin (registered natively as "HealthPlugin").

   Pulls the last few days of steps, body weight, sleep and active
   energy so the user doesn't have to log them by hand — while
   leaving manual entry fully intact (manual entries are never
   overwritten; Health only fills gaps / updates its OWN entries).

   Everything is feature-detected: on the web / desktop the plugin
   doesn't exist, so the module degrades to an informational note and
   the app works exactly as before. All native calls are wrapped in
   try/catch so a plugin quirk can never break the app.

   Records written carry `source: "health"` so a later sync can update
   them but never clobbers a manual entry (which has no source, or
   source "manual").
   ============================================================ */

window.OF = window.OF || {};

OF.healthSync = (function () {
  "use strict";
  var U = OF.util, S = OF.storage;

  // Which Health data types we ask for + read.
  var PERMS = ["READ_STEPS", "READ_WEIGHT", "READ_SLEEP", "READ_ACTIVE_CALORIES"];
  var SYNC_DAYS = 7;                 // how far back to pull each sync
  var MAX_DAY_STEPS = 200000;        // same sanity cap as the manual form
  var els = {};

  /* ---- plugin access (native only; null on web) ---- */
  function plugin() {
    var C = window.Capacitor;
    return (C && C.Plugins && C.Plugins.HealthPlugin) ? C.Plugins.HealthPlugin : null;
  }
  function isNative() {
    var C = window.Capacitor;
    return !!(C && (C.isNativePlatform ? C.isNativePlatform() : C.platform && C.platform !== "web"));
  }
  function platformLabel() {
    var p = (window.Capacitor && window.Capacitor.getPlatform) ? window.Capacitor.getPlatform() : "";
    return p === "android" ? "Health Connect" : "Apple Health";
  }

  /** True if the native plugin exists AND Health is available on this device. */
  function supported() {
    var pl = plugin();
    if (!pl || !isNative()) return Promise.resolve(false);
    if (!pl.isHealthAvailable) return Promise.resolve(true);
    return pl.isHealthAvailable().then(function (r) {
      return !!(r && (r.available === undefined ? true : r.available));
    }).catch(function () { return false; });
  }

  /* ---- connected / last-sync state (in the shared prefs store) ---- */
  function prefs() {
    try { return (OF.units && OF.units.prefs) ? (OF.units.prefs() || {}) : {}; }
    catch (e) { return {}; }
  }
  function setPref(patch) {
    try { if (OF.units && OF.units.setPrefs) OF.units.setPrefs(patch); } catch (e) { /* best-effort */ }
  }
  function isConnected() { return !!prefs().healthConnected; }
  function lastSync() { return prefs().healthLastSync || 0; }

  /* ---- date helpers ---- */
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function isoDate(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function hhmm(d) { return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function daysAgo(n) { var d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n); return d; }

  /* ============================================================
     Sync — pull each metric independently (one failing never
     blocks the others) and merge into local storage.
     ============================================================ */
  function connect() {
    var pl = plugin();
    if (!pl) return Promise.resolve({ ok: false, err: "unavailable" });
    return pl.requestHealthPermissions({ permissions: PERMS }).then(function (res) {
      var granted = res && res.permissions ? res.permissions : {};
      // consider it connected if at least steps was granted
      if (granted.READ_STEPS || Object.keys(granted).some(function (k) { return granted[k]; })) {
        setPref({ healthConnected: true });
        return syncNow().then(function () { return { ok: true }; });
      }
      return { ok: false, err: "denied" };
    }).catch(function (e) { return { ok: false, err: String(e && e.message || e) }; });
  }

  function disconnect() {
    setPref({ healthConnected: false });
    return Promise.resolve();
  }

  function syncNow() {
    var pl = plugin();
    if (!pl) return Promise.resolve({ ok: false });
    var start = daysAgo(SYNC_DAYS).toISOString();
    var end = new Date().toISOString();
    var jobs = [
      syncSteps(pl, start, end),
      syncActiveEnergy(pl, start, end),
      syncWeight(pl),
      syncSleep(pl)
    ];
    return Promise.all(jobs.map(function (p) { return p.catch(function () { return null; }); }))
      .then(function () {
        setPref({ healthLastSync: Date.now() });
        // refresh any visible views that show synced data
        try { OF.daily && OF.daily.refresh && OF.daily.refresh(); } catch (e) {}
        try { OF.dashboard && OF.dashboard.refresh && OF.dashboard.refresh(); } catch (e) {}
        return { ok: true };
      });
  }

  /** Upsert helper honouring the manual-wins rule: write only when there is
      no record for the day, or the existing one was created by Health. */
  function upsertHealth(type, date, patch) {
    var existing = S.getAll(type).filter(function (r) { return r.date === date; })[0];
    if (!existing) {
      var rec = { date: date, source: "health" };
      for (var k in patch) rec[k] = patch[k];
      S.add(type, rec);
    } else if (existing.source === "health") {
      S.update(type, existing.id, patch);
    } // else: a manual entry — leave it alone
  }

  function syncSteps(pl, start, end) {
    if (!pl.queryAggregated) return Promise.resolve();
    return pl.queryAggregated({ startDate: start, endDate: end, dataType: "steps", bucket: "day" })
      .then(function (res) {
        (res && res.aggregatedData || []).forEach(function (s) {
          var count = Math.round(Number(s.value) || 0);
          if (!(count > 0) || count > MAX_DAY_STEPS) return;
          var date = isoDate(new Date(s.startDate));
          upsertHealth("steps", date, { count: count });
        });
      });
  }

  function syncActiveEnergy(pl, start, end) {
    if (!pl.queryAggregated) return Promise.resolve();
    return pl.queryAggregated({ startDate: start, endDate: end, dataType: "active-calories", bucket: "day" })
      .then(function (res) {
        (res && res.aggregatedData || []).forEach(function (s) {
          var kcal = Math.round(Number(s.value) || 0);
          if (!(kcal > 0) || kcal > 20000) return;
          var date = isoDate(new Date(s.startDate));
          upsertHealth("activeEnergy", date, { kcal: kcal });
        });
      });
  }

  function syncWeight(pl) {
    if (!pl.queryLatestSample) return Promise.resolve();
    return pl.queryLatestSample({ dataType: "weight" }).then(function (r) {
      if (!r || r.value == null) return;
      var kg = Number(r.value);
      if ((r.unit || "").toLowerCase().indexOf("lb") !== -1) kg = kg * 0.45359237;
      if (!(kg > 0) || kg > 500) return;
      var date = isoDate(new Date(r.timestamp));
      // gap-fill only: never touch an existing body entry (manual weigh-ins win)
      var existing = S.getAll("body").filter(function (b) { return b.date === date; })[0];
      if (!existing) S.add("body", { date: date, weightKg: Math.round(kg * 100) / 100, source: "health" });
      else if (existing.source === "health") S.update("body", existing.id, { weightKg: Math.round(kg * 100) / 100 });
    });
  }

  function syncSleep(pl) {
    if (!pl.queryLatestSample) return Promise.resolve();
    return pl.queryLatestSample({ dataType: "sleep" }).then(function (r) {
      if (!r || (r.timestamp == null && r.value == null)) return;
      var startMs = Number(r.timestamp);
      var endMs = r.endTimestamp != null ? Number(r.endTimestamp)
                : (isFinite(startMs) && r.value != null ? startMs + Number(r.value) * 60000 : NaN);
      if (!isFinite(startMs) || !isFinite(endMs) || endMs <= startMs) return;
      var wake = new Date(endMs), bed = new Date(startMs);
      var date = isoDate(wake);                 // sleep is keyed by wake-up date
      var durationMin = Math.round((endMs - startMs) / 60000);
      if (durationMin < 10 || durationMin > 20 * 60) return;  // matches the form's own sanity cap
      var existing = S.getAll("sleep").filter(function (s) { return s.date === date; })[0];
      if (existing) return;                     // gap-fill only; manual sleep logs win
      S.add("sleep", { date: date, bedTime: hhmm(bed), wakeTime: hhmm(wake),
                       durationMin: durationMin,   // without it the list showed "?" and averages skewed
                       quality: 3, source: "health" });
    });
  }

  /* ============================================================
     Settings card UI
     ============================================================ */
  function fmtAgo(ms) {
    if (!ms) return "never";
    var s = Math.round((Date.now() - ms) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + " min ago";
    if (s < 86400) return Math.floor(s / 3600) + " h ago";
    return Math.floor(s / 86400) + " d ago";
  }

  function render() {
    if (!els.card) return;
    var name = platformLabel();

    supported().then(function (ok) {
      if (!ok) {
        // No native Health plugin on this platform: keep the card hidden so the
        // file-import card below is the path. (When a Health plugin is wired in,
        // this card appears automatically.)
        els.card.hidden = true;
        return;
      }
      els.card.hidden = false;
      if (!isConnected()) {
        els.card.innerHTML =
          '<h2>' + U.esc(name) + '</h2>' +
          '<p class="muted small">Let OptimalFit read your <strong>steps, weight, sleep and active ' +
          'energy</strong> automatically, so you don’t have to log them by hand. You can still add or ' +
          'edit anything manually — your manual entries always win. Nothing leaves your device.</p>' +
          '<div class="form-actions"><button type="button" class="btn primary" data-hs="connect">' +
          'Connect ' + U.esc(name) + '</button></div>' +
          '<p class="form-hint" data-hs-msg></p>';
      } else {
        els.card.innerHTML =
          '<h2>' + U.esc(name) + '</h2>' +
          '<p class="muted small">✓ Connected · last synced ' + U.esc(fmtAgo(lastSync())) +
          '. Steps, weight, sleep and active energy update automatically; manual edits are kept.</p>' +
          '<div class="form-actions">' +
          '<button type="button" class="btn primary" data-hs="sync">Sync now</button>' +
          '<button type="button" class="btn ghost" data-hs="disconnect">Disconnect</button>' +
          '</div><p class="form-hint" data-hs-msg></p>';
      }
    }).catch(function () { els.card.hidden = true; });
  }

  function msg(text) {
    var m = els.card && els.card.querySelector("[data-hs-msg]");
    if (m) m.textContent = text || "";
  }

  function onClick(e) {
    var b = e.target.closest && e.target.closest("[data-hs]");
    if (!b) return;
    var act = b.getAttribute("data-hs");
    b.disabled = true;
    if (act === "connect") {
      msg("Opening the Health permission dialog…");
      connect().then(function (r) {
        b.disabled = false;
        if (r.ok) { render(); }
        else { msg(r.err === "denied"
          ? "Permission was declined. You can enable it later in your phone’s Health settings."
          : "Couldn’t connect to Health (" + (r.err || "unknown error") + "). " +
            "Try again, or use the file import below."); }
      });
    } else if (act === "sync") {
      msg("Syncing…");
      syncNow().then(function () { b.disabled = false; render(); });
    } else if (act === "disconnect") {
      disconnect().then(function () { render(); });
    }
  }

  function init() {
    els.card = document.getElementById("health-sync-card");
    if (!els.card) return;
    els.card.addEventListener("click", onClick);
    render();
    // auto-sync on launch when already connected (best-effort, silent)
    if (isConnected()) supported().then(function (ok) { if (ok) syncNow().then(render); });
  }

  return { init: init, syncNow: syncNow, isConnected: isConnected, supported: supported };
})();

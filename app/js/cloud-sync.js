/* ============================================================
   cloud-sync.js — cross-device data backup tied to the account.

   The app is local-first: all tracking data lives in localStorage. This
   module mirrors it to the signed-in user's private Supabase row
   (user_backups, RLS own-row-only) so that after an uninstall/reinstall
   — or on a new phone — signing in restores everything.

   Behaviour:
   - On sign-in: if the cloud has a backup AND this device is empty,
     restore it (importAll replace). If the device already has data,
     the local copy is pushed up (local wins — we never silently
     overwrite fresh local logs with an older cloud copy).
   - Ongoing: a debounced push after any change, plus on app-hide, keeps
     the cloud copy current.
   Everything is best-effort and offline-safe: no network, no problem —
   the app keeps working exactly as before.
   ============================================================ */

window.OF = window.OF || {};

OF.cloudSync = (function () {
  "use strict";

  var U = OF.util, S = OF.storage;
  var api = function () { return OF.socialApi || OF.social && OF.social.api || null; };
  var lastUid = null, pushTimer = null, restoring = false;
  // No push may run before this session's pull has completed: pushing an
  // empty/half store over a backup that simply hasn't arrived yet (reinstall
  // + slow network + user backgrounds the app) would destroy the backup.
  var pulled = false, pullAttempts = 0;

  // whose data lives on this device — guards against merging user A's local
  // history into user B's backup when accounts switch on one phone
  var OWNER_KEY = "optimalfit.ownerUid";
  function ownerUid() { try { return localStorage.getItem(OWNER_KEY); } catch (e) { return null; } }
  function setOwner(uid) { try { localStorage.setItem(OWNER_KEY, uid); } catch (e) {} }

  function signedInUid() {
    try { var a = OF.socialApi; return a && a.uid ? a.uid() : null; } catch (e) { return null; }
  }

  /** "Fresh device" = no records AND no meaningful app state. Zero records
      alone isn't enough: right after onboarding the user may already have a
      trainer program + coach profile, and a full "replace" restore would
      delete state the (possibly older) backup doesn't carry. */
  function deviceIsFresh(recordCount) {
    if (recordCount > 0) return false;
    try {
      return !localStorage.getItem("optimalfit.trainerProgram") &&
             !localStorage.getItem("optimalfit.coachProfile");
    } catch (e) { return false; }
  }

  /** Serialize the whole local store (tracking data + prefs + coach state). */
  function snapshot() {
    try { return JSON.parse(S.exportAll()); } catch (e) { return null; }
  }

  var warnedAuth = false;
  function pushNow() {
    var a = OF.socialApi;
    if (!a || !a.pushBackup || !signedInUid()) return;
    if (!pulled) return;   // never overwrite a backup we haven't seen yet
    var snap = snapshot();
    if (!snap) return;
    a.pushBackup(snap).catch(function (e) {
      // offline: fine, try again later. Revoked token: every future push
      // will 401 too — tell the user ONCE instead of failing silently until
      // a restore comes up empty months later.
      if (e && e.authExpired && !warnedAuth && U.toast) {
        warnedAuth = true;
        U.toast("Cloud backup paused — sign in again on the Community tab to keep it running.", "warn");
      }
    });
  }

  /** Stop all pushes immediately (Settings "clear all data" calls this BEFORE
      wiping so a pending debounce can't upload the freshly-emptied store over
      the account's cloud backup). */
  function disarm() {
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
    pulled = false;
    lastUid = null;
  }

  /** Debounced push — called after writes so we don't spam the network. */
  function schedulePush() {
    if (!signedInUid() || restoring || !pulled) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, 4000);
  }

  /** Previous account's local data must not leak into this account: wipe
      (its own copy is safe in ITS cloud backup, pushed while it was
      signed in). Mirrors the Settings "clear" wipe, minus the sign-out. */
  function wipeForeignData() {
    restoring = true;
    try {
      // NOT wiped: the NEW user's just-persisted Supabase session + cached
      // profile (deleting them silently signs B out / paywalls a premium B on
      // the next offline launch) and the coach LAN pairing (device-scoped,
      // not account data).
      var KEEP = { "optimalfit.social": 1, "optimalfit.social.auth": 1, "optimalfit.pairKey": 1 };
      Object.keys(localStorage)
        .filter(function (k) { return k.indexOf("optimalfit.") === 0 && !KEEP[k]; })
        .forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) { /* best effort */ }
    restoring = false;
  }

  /** Run once when a user becomes signed-in: merge the account's data in
      (local always wins on conflicts), then push the union back up. This
      works on a fresh reinstall (local empty → full restore) AND on a
      device that already has a stray log (merge adds the account's history
      without clobbering local). */
  function onSignIn() {
    var a = OF.socialApi;
    if (!a || !a.pullBackup) return;
    var uid = signedInUid();
    if (!uid) return;
    a.pullBackup().then(function (backup) {
      pullAttempts = 0;
      var owner = ownerUid();
      if (owner && owner !== uid) wipeForeignData();
      var before = 0;
      try { before = S.countAll(); } catch (e) {}
      if (backup && backup.data) {
        restoring = true;
        try {
          // backup.data IS the full exportAll() object ({data, prefs,
          // appState}) — pass it straight through; wrapping it again made
          // importAll look for records one level too deep (restored nothing).
          // Fresh device (reinstall): full replace so prefs/app-state return
          // too. Device with data: merge — local always wins.
          S.importAll(backup.data, deviceIsFresh(before) ? "replace" : "merge");
          var after = 0;
          try { after = S.countAll(); } catch (e) {}
          var added = after - before;
          if (added > 0 && U.toast) {
            U.toast(before === 0
              ? "Welcome back — restored your data from your account."
              : "Synced " + added + " item" + (added === 1 ? "" : "s") + " from your other device.", "ok");
            if (OF.settings && OF.settings.refreshAll) { try { OF.settings.refreshAll(); } catch (e) {} }
          }
        } catch (e) {
          // corrupt/unreadable backup: leave local untouched AND keep pushes
          // disabled — uploading local state now would overwrite the cloud
          // copy we just failed to import
          restoring = false;
          return;
        }
        restoring = false;
      }
      pulled = true;
      setOwner(uid);
      // make the cloud copy the union of what we now hold
      pushNow();
    }).catch(function () {
      // transient failure (timeout/5xx): retry with backoff — a missed
      // restore would otherwise silently skip for the whole session
      pullAttempts += 1;
      if (pullAttempts <= 3) setTimeout(onSignIn, pullAttempts * 5000);
    });
  }

  /** Poll for auth changes (sign-in/out) without hard-coupling to social-api. */
  function watchAuth() {
    setInterval(function () {
      var uid = signedInUid();
      if (uid && uid !== lastUid) { lastUid = uid; pulled = false; pullAttempts = 0; onSignIn(); }
      else if (!uid && lastUid) { lastUid = null; pulled = false; }
    }, 3000);
  }

  function init() {
    watchAuth();
    document.addEventListener("visibilitychange", function () {
      // app-hide: push so the cloud copy is current even if the debounce
      // hasn't fired. App-show: if this session's restore never succeeded
      // (offline sign-in), try again now.
      if (document.visibilityState === "hidden") pushNow();
      else if (document.visibilityState === "visible" && signedInUid() && !pulled) onSignIn();
    });
    // any storage write nudges a debounced push (storage.js calls this hook)
    if (S && S.onChange) S.onChange(schedulePush);
  }

  return { init: init, pushNow: pushNow, schedulePush: schedulePush, disarm: disarm };
})();

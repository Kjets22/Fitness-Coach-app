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

  function signedInUid() {
    try { var a = OF.socialApi; return a && a.uid ? a.uid() : null; } catch (e) { return null; }
  }

  /** Serialize the whole local store (tracking data + prefs + coach state). */
  function snapshot() {
    try { return JSON.parse(S.exportAll()); } catch (e) { return null; }
  }

  function pushNow() {
    var a = OF.socialApi;
    if (!a || !a.pushBackup || !signedInUid()) return;
    var snap = snapshot();
    if (!snap) return;
    a.pushBackup(snap).catch(function () { /* offline: try again later */ });
  }

  /** Debounced push — called after writes so we don't spam the network. */
  function schedulePush() {
    if (!signedInUid() || restoring) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, 4000);
  }

  /** Run once when a user becomes signed-in: restore or seed the cloud. */
  function onSignIn() {
    var a = OF.socialApi;
    if (!a || !a.pullBackup) return;
    var localCount = 0;
    try { localCount = S.countAll(); } catch (e) {}
    a.pullBackup().then(function (backup) {
      if (backup && backup.data && localCount === 0) {
        // fresh device (reinstall / new phone) → bring the account's data back
        restoring = true;
        try {
          S.importAll(JSON.stringify(backup.data), "replace");
          if (U.toast) U.toast("Welcome back — restored your data from your account.", "ok");
          if (OF.settings && OF.settings.refreshAll) { try { OF.settings.refreshAll(); } catch (e) {} }
        } catch (e) { /* corrupt backup: keep the empty local store */ }
        restoring = false;
      } else {
        // device already has data (or cloud empty) → make the cloud match local
        pushNow();
      }
    }).catch(function () { /* offline — nothing to do */ });
  }

  /** Poll for auth changes (sign-in/out) without hard-coupling to social-api. */
  function watchAuth() {
    setInterval(function () {
      var uid = signedInUid();
      if (uid && uid !== lastUid) { lastUid = uid; onSignIn(); }
      else if (!uid) { lastUid = null; }
    }, 3000);
  }

  function init() {
    watchAuth();
    // push on app-hide (backgrounding) so the cloud copy is current even if
    // the debounce hasn't fired
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") pushNow();
    });
    // any storage write nudges a debounced push (storage.js calls this hook)
    if (S && S.onChange) S.onChange(schedulePush);
  }

  return { init: init, pushNow: pushNow, schedulePush: schedulePush };
})();

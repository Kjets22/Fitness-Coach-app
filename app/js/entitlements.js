/* ============================================================
   entitlements.js — the paywall for the AI features.

   The three LLM features (AI Coach, food-photo macros, physique
   analysis) are PREMIUM. Everything else — the full on-device
   insights/strength/targets engine, all tracking, and the whole
   Community side — stays free.

   Premium is a SERVER-CONTROLLED flag (profiles.is_premium) that a
   user can never set themselves (frozen by a DB trigger). The owner
   grants it per account with tools/grant-premium.mjs or the
   admin_set_premium RPC. This module only READS the flag off the
   signed-in profile that social-api already caches.
   ============================================================ */

window.OF = window.OF || {};

OF.entitlements = (function () {
  "use strict";
  var U = OF.util;

  function api() { return OF.socialApi || null; }
  function signedIn() { var a = api(); return !!(a && a.currentUser && a.currentUser()); }
  function profile() { var a = api(); return (a && a.cachedProfile) ? a.cachedProfile() : null; }

  /* Premium if the signed-in profile carries is_premium / is_admin (owner grant)
     OR the 7-day free trial hasn't expired. Free/anon => not premium. */
  var staleRefreshFired = false;
  function isPremium() {
    var p = profile();
    if (!p) return false;
    if (p.is_premium || p.is_admin) return true;
    // profile cached BEFORE the trial migration (key absent entirely): it is
    // stale, not expired — refetch once so the real trial_ends_at appears
    if (!("trial_ends_at" in p) && !staleRefreshFired && signedIn()) {
      staleRefreshFired = true;
      refresh();
    }
    return trialActive(p);
  }
  function trialActive(p) {
    p = p || profile();
    if (!p || p.is_premium || p.is_admin || !p.trial_ends_at) return false;
    var t = new Date(p.trial_ends_at).getTime();
    return isFinite(t) && t > Date.now();
  }
  /* Whole days left in the trial (null when not on a trial / already premium). */
  function trialDaysLeft() {
    var p = profile();
    if (!trialActive(p)) return null;
    return Math.max(1, Math.ceil((new Date(p.trial_ends_at).getTime() - Date.now()) / 86400000));
  }

  /* Re-fetch the profile so a freshly-granted upgrade shows up without a full
     reload (used by the "I already upgraded" button). */
  function refresh() {
    var a = api();
    if (signedIn() && a && a.getMyProfile) return a.getMyProfile().catch(function () {});
    return Promise.resolve();
  }

  /* Paywall card for a gated feature. feature = {title, blurb}.
     NOTE: access is owner-GRANTED (no in-app purchase yet), so the copy must NOT
     present a buy/upgrade flow — an in-app purchase button would require Apple
     IAP (Guideline 3.1.1). It's an access gate: sign in + re-check only. */
  function paywallHtml(feature) {
    var f = feature || {};
    var title = f.title || "A Premium AI feature";
    var blurb = f.blurb || "This uses AI.";
    if (!signedIn()) {
      return card(title, blurb + " It’s an OptimalFit Premium feature and every new account gets a 7-day free trial — sign in or create an account to start yours. Everything else in the app is free.",
        '<button type="button" class="btn primary" data-ent="signin">Sign in / Start free trial</button>' +
        '<a class="btn ghost" href="#dashboard">Meanwhile: build your program free</a>');
    }
    if (!profile()) {
      // auth account exists but the profile (where the trial lives) was never
      // created — the user abandoned the username step; send them back to it
      return card(title, blurb + " Finish setting up your account (pick a username on the Community tab) to start your 7-day free trial of the Premium AI features.",
        '<button type="button" class="btn primary" data-ent="signin">Finish setup</button>');
    }
    return card(title, blurb + " Your 7-day free trial of the Premium AI features has ended. It stays available to Premium members — if you’ve just been given access, re-check below.",
      '<button type="button" class="btn primary" data-ent="recheck">Check my access</button>');
  }

  function card(title, body, actions) {
    return '<div class="card placeholder-card ent-paywall">' +
      '<div class="ent-badge">✨ Premium</div>' +
      '<h2>' + U.esc(title) + '</h2>' +
      '<p class="muted">' + U.esc(body) + '</p>' +
      '<div class="form-actions">' + actions + '</div></div>';
  }

  /* Delegate paywall button clicks inside a container. onRecheck() runs after a
     successful re-check so the caller can re-render the (now unlocked) feature. */
  function bindPaywall(container, onRecheck) {
    if (!container || container._entBound) return;
    container._entBound = true;
    container.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-ent]");
      if (!b) return;
      var act = b.getAttribute("data-ent");
      if (act === "signin") {
        location.hash = "#community";
      } else if (act === "recheck") {
        refresh().then(function () { if (onRecheck) onRecheck(); });
      }
    });
  }

  /** True only for owner/admin accounts (kjets2003). Used to gate the
      version marker so ONLY the owner sees it. */
  function isAdmin() {
    var p = profile();
    return !!(p && p.is_admin);
  }

  return {
    isPremium: isPremium,
    isAdmin: isAdmin,
    trialDaysLeft: trialDaysLeft,
    signedIn: signedIn,
    refresh: refresh,
    paywallHtml: paywallHtml,
    bindPaywall: bindPaywall
  };
})();

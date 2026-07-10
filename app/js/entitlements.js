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

  /* Premium if the signed-in profile carries is_premium (or is_admin — the
     owner always has access). Free/anon => not premium. */
  function isPremium() {
    var p = profile();
    return !!(p && (p.is_premium || p.is_admin));
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
      return card(title, blurb + " It’s an OptimalFit Premium feature — sign in with a Premium account to use it. Everything else in the app is free.",
        '<button type="button" class="btn primary" data-ent="signin">Sign in</button>');
    }
    return card(title, blurb + " It’s available to OptimalFit Premium members. If you’ve just been given access, re-check below.",
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

  return {
    isPremium: isPremium,
    signedIn: signedIn,
    refresh: refresh,
    paywallHtml: paywallHtml,
    bindPaywall: bindPaywall
  };
})();

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

  /* ---- install trial: the free month SHIPS WITH THE APP ----
     No account, no setup: every install gets the Premium AI features for
     30 days from first launch, tracked on-device. After it ends the
     paywall appears. (Device-local by design — clearing app data restarts
     it; acceptable pre-revenue, revisit with real billing.) */
  var INSTALL_KEY = "optimalfit.installedAt";
  var INSTALL_TRIAL_DAYS = 30;

  function installedAt() {
    try {
      var v = Number(localStorage.getItem(INSTALL_KEY));
      if (isFinite(v) && v > 0) return v;
      v = Date.now();
      localStorage.setItem(INSTALL_KEY, String(v));
      return v;
    } catch (e) { return Date.now(); } // private mode: trial never expires
  }
  function installTrialEndsAt() {
    return installedAt() + INSTALL_TRIAL_DAYS * 86400000;
  }
  function installTrialActive() {
    return Date.now() < installTrialEndsAt();
  }
  function installTrialDaysLeft() {
    if (!installTrialActive()) return null;
    return Math.max(1, Math.ceil((installTrialEndsAt() - Date.now()) / 86400000));
  }
  /** First launch only: returns true ONCE, right when the trial starts —
      app.js uses it to show the "your first month is free" welcome. */
  function installTrialJustStarted() {
    try {
      // stamp the clock NOW — on the true first launch the key doesn't exist
      // yet (nothing has called isPremium()), and the old key-presence check
      // silently skipped the welcome until the SECOND launch (QA build 52)
      installedAt();
      if (localStorage.getItem(INSTALL_KEY)) {
        if (localStorage.getItem(INSTALL_KEY + ".welcomed")) return false;
        localStorage.setItem(INSTALL_KEY + ".welcomed", "1");
        // welcome only makes sense while the trial is actually running
        return installTrialActive();
      }
    } catch (e) { }
    return false;
  }

  /* Premium if the signed-in profile carries is_premium / is_admin (owner grant)
     OR the 1-month free trial hasn't expired. Free/anon => not premium. */
  var staleRefreshFired = false;
  function isPremium() {
    // the install trial needs NO account — the free month ships with the app
    if (installTrialActive()) return true;
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
  /* Whole days left in the trial (null when not on a trial / already premium).
     The install trial (free month with the app) counts first, then any
     account trial. */
  function trialDaysLeft() {
    var d = installTrialDaysLeft();
    if (d != null) return d;
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
    // compact: a one-line banner instead of a full-height card — used where
    // the paywall sat ABOVE the core form and pushed it below the fold
    // (user-panel finding: the Food tab opened on an ad, not the action)
    if (f.compact) {
      var act = !signedIn()
        ? '<button type="button" class="btn mini" data-ent="signin">Try free</button>'
        : (!profile()
          ? '<button type="button" class="btn mini" data-ent="signin">Finish setup</button>'
          : '<button type="button" class="btn mini" data-ent="recheck">Check access</button>');
      return '<div class="ent-paywall ent-paywall-mini">' +
        '<span class="ent-mini-txt">' + title + ' <span class="muted">— Premium</span></span>' + act + '</div>';
    }
    if (!signedIn()) {
      return card(title, blurb + " Your free month with OptimalFit has ended — every install gets the Premium AI features free for 30 days, and yours are up. Go Premium to keep them: create an account and Premium membership picks up where your free month left off. Everything else in the app stays free forever.",
        '<button type="button" class="btn primary" data-ent="signin">Go Premium</button>' +
        '<a class="btn ghost" href="#dashboard">Keep using the free features</a>');
    }
    if (!profile()) {
      // auth account exists but the profile (where membership lives) was
      // never created — the user abandoned the username step; send them back
      return card(title, blurb + " Your free month has ended. Finish setting up your account (pick a username on the Community tab) to continue with Premium.",
        '<button type="button" class="btn primary" data-ent="signin">Finish setup</button>');
    }
    return card(title, blurb + " Your free month of the Premium AI features has ended. Go Premium to keep them — if you’ve just been given access, re-check below.",
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
    installTrialActive: installTrialActive,
    installTrialDaysLeft: installTrialDaysLeft,
    installTrialJustStarted: installTrialJustStarted,
    signedIn: signedIn,
    refresh: refresh,
    paywallHtml: paywallHtml,
    bindPaywall: bindPaywall
  };
})();

/* ============================================================
   ai-consent.js — one-time, explicit consent before ANY data is
   sent to the AI coach service (App Review 5.1.1(i)/5.1.2(i)).

   Apple requires that BEFORE personal data is shared with an AI
   service the app (1) discloses what is sent, (2) names who it is
   sent to, and (3) obtains the user's permission. This sheet does
   all three; the choice is stored in prefs (aiConsent: true) so it
   is asked exactly once (and travels with backups). Declining
   leaves every non-AI feature fully usable.
   ============================================================ */

window.OF = window.OF || {};

OF.aiConsent = (function () {
  "use strict";

  function prefs() {
    try { return (OF.units && OF.units.prefs()) || {}; } catch (e) { return {}; }
  }

  function granted() { return prefs().aiConsent === true; }

  /** Run fn immediately if consent exists, else ask first (fn runs on Agree). */
  function ensure(fn) {
    if (granted()) { fn(); return; }
    ask(fn);
  }

  function ask(onAgree) {
    var existing = document.getElementById("ai-consent");
    if (existing) existing.remove();
    var o = document.createElement("div");
    o.id = "ai-consent";
    o.className = "sheet";
    o.setAttribute("role", "dialog");
    o.setAttribute("aria-modal", "true");
    o.setAttribute("aria-label", "AI features consent");
    o.innerHTML =
      '<div class="sheet-backdrop"></div>' +
      '<div class="sheet-panel">' +
        '<h3 class="sheet-title">Before your first AI request</h3>' +
        '<p class="ai-consent-p">To answer you, OptimalFit sends <strong>only</strong> the following to the ' +
          'OptimalFit coach service (operated by the developer), where it is processed by ' +
          '<strong>Anthropic’s Claude AI</strong>:</p>' +
        '<ul class="ai-consent-list">' +
          '<li>• Your question or request</li>' +
          '<li>• A compact summary of your recent stats (averages and trends — never your raw log history)</li>' +
          '<li>• A photo, only when you choose photo meal or physique analysis</li>' +
        '</ul>' +
        '<p class="ai-consent-p">It is processed transiently to generate your answer and is <strong>not stored</strong>. ' +
          'Your name and email are never included. Full details: Privacy Policy at ' +
          '<span class="ai-consent-url">kjets22.github.io/Fitness-Coach-app/store/privacy-policy.html</span> ' +
          '(also linked in Settings).</p>' +
        '<p class="ai-consent-p muted small">If you don’t agree, everything else in the app keeps working — ' +
          'only the AI coach, photo macros and physique analysis stay off.</p>' +
        '<button type="button" class="btn primary" id="ai-consent-yes">Agree — use AI features</button>' +
        '<button type="button" class="btn ghost sheet-cancel" id="ai-consent-no">Not now</button>' +
      '</div>';
    document.body.appendChild(o);
    o.querySelector("#ai-consent-yes").addEventListener("click", function () {
      try { OF.units.setPrefs({ aiConsent: true }); } catch (e) {}
      o.remove();
      if (typeof onAgree === "function") onAgree();
    });
    o.querySelector("#ai-consent-no").addEventListener("click", function () { o.remove(); });
    o.querySelector(".sheet-backdrop").addEventListener("click", function () { o.remove(); });
    var first = o.querySelector("#ai-consent-yes");
    if (first) { try { first.focus(); } catch (e) {} }
  }

  return { granted: granted, ensure: ensure, ask: ask };
})();

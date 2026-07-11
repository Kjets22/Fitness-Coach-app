/* ============================================================
   app.js — tab routing + app init. Loaded last.
   Routing uses location.hash (#sleep, #food, ...) so a refresh
   keeps the current tab and it still works from file://.

   P2-2 additions: mobile nav shows 5 destinations — the "Log"
   button opens an action sheet that routes to the tracker tabs
   (the underlying tab system is unchanged), and Settings lives
   behind the header gear. First-run onboarding shows on fresh
   storage.
   ============================================================ */

window.OF = window.OF || {};

OF.app = (function () {
  "use strict";

  var TABS = ["dashboard", "daily", "sleep", "food", "exercise", "body", "insights", "coach", "community", "settings"];
  var LOG_TABS = ["sleep", "food", "exercise", "body", "daily"]; // reached via the Log sheet on mobile

  function showTab(name) {
    if (TABS.indexOf(name) === -1) name = "dashboard";
    TABS.forEach(function (t) {
      var section = document.getElementById("tab-" + t);
      if (section) section.classList.toggle("hidden", t !== name);
    });
    document.querySelectorAll(".nav-btn, .header-btn").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-tab") === name);
    });
    // On mobile the tracker tabs highlight the "Log" destination.
    var logBtn = document.getElementById("nav-log");
    if (logBtn) logBtn.classList.toggle("active", LOG_TABS.indexOf(name) !== -1);
    // Refresh data-driven tabs on entry so they always show current data.
    if (name === "dashboard" && OF.dashboard) OF.dashboard.refresh();
    if (name === "daily" && OF.daily) OF.daily.refresh();
    if (name === "insights" && OF.insights) OF.insights.refresh();
    if (name === "coach" && OF.coach) OF.coach.onEnter();
    if (name === "community" && OF.social) OF.social.onEnter();
    if (name === "food" && OF.foodPhoto) OF.foodPhoto.onEnter(); // photo-estimate server check
    if (name === "body" && OF.physique) OF.physique.onEnter();   // physique-photo server check
  }

  function currentTabFromHash() {
    var h = (location.hash || "").replace("#", "");
    return TABS.indexOf(h) !== -1 ? h : "dashboard";
  }

  /* ---------- Log action sheet ---------- */

  function openSheet() {
    var sheet = document.getElementById("log-sheet");
    if (!sheet) return;
    sheet.classList.remove("hidden");
    var first = sheet.querySelector(".sheet-item");
    if (first) first.focus();
  }
  function closeSheet() {
    var sheet = document.getElementById("log-sheet");
    if (!sheet || sheet.classList.contains("hidden")) return;
    sheet.classList.add("hidden");
    var fab = document.getElementById("nav-log");
    if (fab && fab.offsetParent !== null) fab.focus();
  }

  function initSheet() {
    var sheet = document.getElementById("log-sheet");
    if (!sheet) return;
    sheet.addEventListener("click", function (e) {
      // backdrop / Cancel close it; tracker links route via their hash
      if (e.target.closest("[data-close-sheet]")) { closeSheet(); return; }
      if (e.target.closest(".sheet-item")) closeSheet();
    });
    document.addEventListener("keydown", function (e) {
      if (sheet.classList.contains("hidden")) return;
      if (e.key === "Escape") { closeSheet(); return; }
      if (e.key === "Tab") {
        // minimal focus trap: cycle within the sheet's focusable items
        var items = sheet.querySelectorAll(".sheet-item, [data-close-sheet]");
        if (!items.length) return;
        var first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault(); last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault(); first.focus();
        } else if (!sheet.contains(document.activeElement)) {
          e.preventDefault(); first.focus();
        }
      }
    });
  }

  /* ---------- init ---------- */

  function onNavClick(e) {
    var btn = e.target.closest("[data-tab]");
    if (!btn) return;
    var tab = btn.getAttribute("data-tab");
    if (tab === "log") { openSheet(); return; }
    if (location.hash === "#" + tab) showTab(tab); // same hash: still refresh
    else location.hash = tab;
  }

  /* iOS: the on-screen keyboard covers inputs anchored near the bottom
     (especially inside the fixed photo/physique sheets). When a form control
     is focused, scroll it into the visible area above the keyboard. Uses
     visualViewport when available (accurate keyboard height) and a delayed
     scrollIntoView so it runs after the keyboard animates in. */
  function initKeyboardScroll() {
    var t = null;
    document.addEventListener("focusin", function (e) {
      var el = e.target;
      if (!el || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (el.type === "checkbox" || el.type === "radio") return;
      if (t) clearTimeout(t);
      t = setTimeout(function () {
        try { el.scrollIntoView({ block: "center", behavior: "smooth" }); }
        catch (err) { try { el.scrollIntoView(); } catch (e2) {} }
      }, 320);
    });
  }

  function init() {
    // Segmented rating pills replace the <select data-seg> controls
    // BEFORE tracker init so their defaults render onto the pills.
    if (OF.ui) OF.ui.initSegs(document);

    // Nav clicks set the hash; the hashchange handler switches tabs.
    document.getElementById("main-nav").addEventListener("click", onNavClick);
    var gear = document.getElementById("header-settings");
    if (gear) gear.addEventListener("click", onNavClick);
    window.addEventListener("hashchange", function () {
      showTab(currentTabFromHash());
    });
    initSheet();
    initKeyboardScroll();

    // Init modules. goals.init runs the adaptive catch-up loop, so it goes
    // before dashboard/insights read the calorie targets.
    OF.sleep.init();
    OF.food.init();
    if (OF.foodPhoto) OF.foodPhoto.init();
    OF.exercise.init();
    OF.body.init();
    if (OF.physique) OF.physique.init();
    OF.goals.init();
    OF.daily.init();
    OF.dashboard.init();
    if (OF.trainer) OF.trainer.init(); // renders the "Today's session" card into the dashboard
    OF.insights.init();
    OF.coach.init();
    OF.settings.init();
    if (OF.healthSync) OF.healthSync.init(); // Health card lives in the Settings tab
    if (OF.social) OF.social.init(); // after settings (renders its Community card)

    showTab(currentTabFromHash());

    // First-run welcome tour (no data + no goal + never dismissed).
    if (OF.onboarding) OF.onboarding.init();
  }

  document.addEventListener("DOMContentLoaded", init);

  // PWA: register the service worker (offline app shell). Service workers
  // require a secure context, so only https:// and localhost qualify —
  // file:// and plain LAN-http keep working exactly as before, just
  // without offline caching.
  if ("serviceWorker" in navigator &&
      (location.protocol === "https:" ||
       location.hostname === "localhost" ||
       location.hostname === "127.0.0.1")) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function (e) {
        console.warn("Service worker registration failed:", e);
      });
    });
  }

  return { showTab: showTab };
})();

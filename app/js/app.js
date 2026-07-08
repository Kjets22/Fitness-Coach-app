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

  var TABS = ["dashboard", "daily", "sleep", "food", "exercise", "body", "insights", "coach", "settings"];
  var LOG_TABS = ["sleep", "food", "exercise", "body"]; // reached via the Log sheet on mobile

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
    if (sheet) sheet.classList.remove("hidden");
  }
  function closeSheet() {
    var sheet = document.getElementById("log-sheet");
    if (sheet) sheet.classList.add("hidden");
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
      if (e.key === "Escape" && !sheet.classList.contains("hidden")) closeSheet();
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
    OF.insights.init();
    OF.coach.init();
    OF.settings.init();

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

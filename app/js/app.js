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

  var lastTab = null;

  function showTab(name) {
    if (TABS.indexOf(name) === -1) name = "dashboard";
    TABS.forEach(function (t) {
      var section = document.getElementById("tab-" + t);
      if (section) section.classList.toggle("hidden", t !== name);
    });
    // native-style: switching tabs starts at the top (the scroller is
    // main.content — the document itself never scrolls)
    if (name !== lastTab) {
      lastTab = name;
      var scroller = document.querySelector("main.content");
      if (scroller) scroller.scrollTop = 0;
      // a toast about the previous tab shouldn't ride along to the next one
      var toastEl = document.getElementById("of-toast");
      if (toastEl) toastEl.classList.remove("show");
    }
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
    var first = sheet.querySelector(".sheet-primary") || sheet.querySelector(".sheet-item");
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
      if (e.target.closest("#log-quick-water")) {
        // one-tap glass, no tab switch — the single most frequent log
        var label = OF.daily && OF.daily.addQuickGlass ? OF.daily.addQuickGlass() : null;
        if (label && OF.util) OF.util.toast("💧 " + label + " logged", "ok");
        if (OF.dashboard) OF.dashboard.refresh();
        closeSheet();
        return;
      }
      // ANY destination in the sheet closes it — including the primary
      // Workout action (it's .sheet-primary, which the old .sheet-item-only
      // check missed: the workout tab opened BEHIND the still-open sheet)
      if (e.target.closest(".sheet-item, .sheet-primary")) closeSheet();
    });
    document.addEventListener("keydown", function (e) {
      if (sheet.classList.contains("hidden")) return;
      if (e.key === "Escape") { closeSheet(); return; }
      if (e.key === "Tab") {
        // minimal focus trap: cycle within the sheet's FOCUSABLE items —
        // buttons and links only (the [data-close-sheet] backdrop div isn't
        // focusable, and .sheet-primary/.sheet-quick weren't matched at all,
        // so Shift+Tab escaped behind the modal)
        var items = sheet.querySelectorAll("button, a[href]");
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
  /* While the keyboard is up, mobile hides the bottom tab bar so the chat /
     form input sits DIRECTLY on the keyboard (native feel) instead of the
     nav wedging between them. Driven by focus, not viewport math. */
  function initKeyboardChrome() {
    var offT = null;
    function editable(el) {
      return el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) &&
        el.type !== "checkbox" && el.type !== "radio";
    }
    document.addEventListener("focusin", function (e) {
      if (!editable(e.target)) return;
      if (offT) { clearTimeout(offT); offT = null; }
      document.body.classList.add("kb-open");
    });
    document.addEventListener("focusout", function (e) {
      if (!editable(e.target)) return;
      // small delay: moving focus between two fields must not flash the bar
      offT = setTimeout(function () {
        document.body.classList.remove("kb-open");
      }, 250);
    });
  }

  function initKeyboardScroll() {
    var t = null;
    document.addEventListener("focusin", function (e) {
      var el = e.target;
      if (!el || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (el.type === "checkbox" || el.type === "radio") return;
      // Inside a fixed overlay that manages its own keyboard layout, the
      // document-level scrollIntoView pushes the panel up out of the shrunk
      // viewport (the intake question scrolled off-screen with a gap under
      // the field). Those overlays handle focus themselves — skip them.
      if (el.closest && el.closest("#intake-overlay")) return;
      if (t) clearTimeout(t);
      t = setTimeout(function () {
        try { el.scrollIntoView({ block: "center", behavior: "smooth" }); }
        catch (err) { try { el.scrollIntoView(); } catch (e2) {} }
      }, 320);
    });

  }

  function init() {
    try { if (OF.cloudSync) OF.cloudSync.init(); } catch (e) {}   // reflects sign-in/out without a manual refresh
    try { if (OF.widgetSync) OF.widgetSync.init(); } catch (e) {}  // home-screen widgets (water quick-log + today overview)
    // Segmented rating pills replace the <select data-seg> controls
    // BEFORE tracker init so their defaults render onto the pills.
    if (OF.ui) OF.ui.initSegs(document);

    // Nav clicks set the hash; the hashchange handler switches tabs.
    document.getElementById("main-nav").addEventListener("click", onNavClick);
    var gear = document.getElementById("header-settings");
    if (gear) gear.addEventListener("click", onNavClick);
    window.addEventListener("hashchange", function () {
      // a deep link (widget) or browser-back can land while the log sheet is
      // open — the tab would switch BEHIND the still-open sheet
      closeSheet();
      showTab(currentTabFromHash());
    });
    initSheet();
    initKeyboardScroll();
    initKeyboardChrome();

    // Day rollover while backgrounded (overnight, long flights): re-stamp the
    // stale "today" defaults and recompute every today-based view on return.
    var lastDay = OF.util.todayISO();
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) return;
      var now = OF.util.todayISO();
      if (now === lastDay) return;
      var prev = lastDay;
      lastDay = now;
      ["sleep-date", "food-date", "body-date", "exercise-date", "steps-date"].forEach(function (id) {
        var el = document.getElementById(id);
        if (el && el.value === prev) el.value = now;   // only bump stale DEFAULTS, never a user-chosen date
      });
      try { if (OF.daily) OF.daily.refresh(); } catch (e) {}
      try { OF.dashboard.refresh(); } catch (e) {}
      try { if (OF.trainer) OF.trainer.renderCard(); } catch (e) {}
    });

    // Init modules. goals.init runs the adaptive catch-up loop, so it goes
    // before dashboard/insights read the calorie targets.
    // Fault isolation: one module choking on a corrupt record must not take
    // the whole app down with it — every other tab keeps working.
    function safeInit(name, fn) {
      try { fn(); } catch (e) { try { console.error("init failed:", name, e); } catch (e2) {} }
    }
    safeInit("sleep", function () { OF.sleep.init(); });
    safeInit("food", function () { OF.food.init(); });
    if (OF.foodPhoto) safeInit("foodPhoto", function () { OF.foodPhoto.init(); });
    safeInit("exercise", function () { OF.exercise.init(); });
    safeInit("body", function () { OF.body.init(); });
    if (OF.physique) safeInit("physique", function () { OF.physique.init(); });
    safeInit("goals", function () { OF.goals.init(); });
    safeInit("daily", function () { OF.daily.init(); });
    safeInit("dashboard", function () { OF.dashboard.init(); });
    if (OF.trainer) safeInit("trainer", function () { OF.trainer.init(); }); // renders the "Today's session" card
    safeInit("insights", function () { OF.insights.init(); });
    safeInit("coach", function () { OF.coach.init(); });
    safeInit("settings", function () { OF.settings.init(); });
    if (OF.healthSync) safeInit("healthSync", function () { OF.healthSync.init(); });
    if (OF.social) safeInit("social", function () { OF.social.init(); });

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

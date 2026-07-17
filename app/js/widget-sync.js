/* ============================================================
   widget-sync.js — feeds the iOS home-screen widgets.

   App -> widget: after any storage change (debounced) push today's
   water/steps/kcal + goals + streak through WidgetBridge into the
   App Group; the native side reloads widget timelines.
   Widget -> app: the widget's "+ glass" AppIntent accumulates
   pendingWaterMl in the App Group; on launch/foreground we drain it
   into a real water record (so it appears in charts, streaks, sync).
   Deep links (optimalfit://log?tab=food) route to the right tab.
   Web builds: no plugin -> everything is a silent no-op.
   ============================================================ */

window.OF = window.OF || {};

OF.widgetSync = (function () {
  "use strict";

  var U = OF.util, S = OF.storage;
  var timer = null;

  function bridge() {
    var C = window.Capacitor;
    return (C && C.Plugins && C.Plugins.WidgetBridge) || null;
  }
  function appPlugin() {
    var C = window.Capacitor;
    return (C && C.Plugins && C.Plugins.App) || null;
  }

  /* replicate daily.js targets(): goal-driven, sensible fallbacks */
  function targets() {
    try {
      var t = OF.goals ? OF.goals.currentTargets() : null;
      if (t && t.status === "ok") return { waterMl: t.waterMl, steps: t.steps, kcal: t.calories || 2000 };
    } catch (e) {}
    return { waterMl: 2500, steps: 8000, kcal: 2000 };
  }

  function state() {
    var today = U.todayISO();
    var waterMl = 0, steps = 0, kcal = 0, streak = 0;
    try { waterMl = OF.daily && OF.daily.waterTodayMl ? OF.daily.waterTodayMl() : 0; } catch (e) {}
    try {
      var sr = OF.daily && OF.daily.stepsRecordFor ? OF.daily.stepsRecordFor(today) : null;
      steps = sr && isFinite(Number(sr.count)) ? Number(sr.count) : 0;
    } catch (e) {}
    try {
      S.getAll("food").forEach(function (r) {
        if (r.date === today && isFinite(Number(r.calories))) kcal += Number(r.calories);
      });
    } catch (e) {}
    try { streak = OF.streak ? (OF.streak.compute().current || 0) : 0; } catch (e) {}
    var t = targets();
    return { today: today, waterMl: waterMl, waterGoalMl: t.waterMl, steps: steps,
      stepsGoal: t.steps, kcal: kcal, kcalGoal: t.kcal, streak: streak };
  }

  function syncNow() {
    var b = bridge();
    if (!b) return;
    try { b.sync(state()).catch(function () {}); } catch (e) {}
  }

  function scheduleSync() {
    if (!bridge()) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(syncNow, 2500);
  }

  /** Pull widget-logged water into a real record (charts/streak/backup see it). */
  function drain() {
    var b = bridge();
    if (!b) return;
    try {
      b.drain().then(function (r) {
        var ml = r && Number(r.pendingWaterMl);
        if (!ml || !isFinite(ml) || ml <= 0) { syncNow(); return; }
        S.add("water", { date: U.todayISO(), amountMl: Math.round(ml) });
        if (OF.daily && OF.daily.refresh) { try { OF.daily.refresh(); } catch (e) {} }
        if (OF.dashboard && OF.dashboard.refresh) { try { OF.dashboard.refresh(); } catch (e) {} }
        var glasses = Math.round(ml / 237);
        U.toast("💧 " + (glasses > 1 ? glasses + " glasses" : "Glass") + " from your widget logged.", "ok");
        syncNow();
      }).catch(function () {});
    } catch (e) {}
  }

  function route(url) {
    try {
      var m = /tab=([a-z]+)/.exec(String(url || ""));
      if (m && ["food", "exercise", "daily", "sleep", "body", "coach"].indexOf(m[1]) !== -1) {
        location.hash = "#" + m[1];
      }
    } catch (e) {}
  }

  function init() {
    if (!bridge()) return;
    drain();                                  // widget taps while we were closed
    if (S && S.onChange) S.onChange(scheduleSync);
    syncNow();
    var ap = appPlugin();
    if (ap && ap.addListener) {
      ap.addListener("appStateChange", function (st) {
        if (st && st.isActive) drain();
      });
      ap.addListener("appUrlOpen", function (ev) { route(ev && ev.url); });
    }
    // day rollover safety: re-sync shortly after midnight-crossing resumes
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) scheduleSync();
    });
  }

  return { init: init, syncNow: syncNow, drain: drain };
})();

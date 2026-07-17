/* ============================================================
   haptics.js — native haptic feedback (Capacitor Haptics).

   Apple-design guidance: link haptics to MEANINGFUL moments, not
   every tap — completion, success, warnings. Web/PWA falls back to
   navigator.vibrate where available; everything is best-effort and
   silent on failure.
   ============================================================ */

window.OF = window.OF || {};

OF.haptics = (function () {
  "use strict";

  function plugin() {
    var C = window.Capacitor;
    return (C && C.Plugins && C.Plugins.Haptics) || null;
  }

  function impact(style) {
    var h = plugin();
    if (h && h.impact) { h.impact({ style: style }).catch(function () {}); return; }
    try { if (navigator.vibrate) navigator.vibrate(style === "HEAVY" ? 30 : 15); } catch (e) {}
  }

  function notify(type) {
    var h = plugin();
    if (h && h.notification) { h.notification({ type: type }).catch(function () {}); return; }
    try { if (navigator.vibrate) navigator.vibrate(type === "SUCCESS" ? [15, 40, 15] : [40, 60, 40]); } catch (e) {}
  }

  return {
    /** set checked off / chip logged — a light, satisfying tick */
    light: function () { impact("LIGHT"); },
    /** rest over, timer done — firm nudge */
    medium: function () { impact("MEDIUM"); },
    /** PR, workout saved, streak milestone — celebratory */
    success: function () { notify("SUCCESS"); },
    /** typo-guard style warnings */
    warning: function () { notify("WARNING"); }
  };
})();

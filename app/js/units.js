/* ============================================================
   units.js — unit preferences + display conversion.

   Storage stays METRIC internally (kg, ml, cm) everywhere; only
   display/input goes through these helpers. Preferences live
   under "optimalfit.prefs":
     { weightUnit: "lb"|"kg", waterUnit: "oz"|"ml" }
   Defaults: lb + oz (the user thinks in pounds).

   Also attaches convenience aliases onto OF.util (U.toDisplayWeight,
   U.fromDisplayWeight, U.fmtWeight, U.toDisplayWater, ...), so every
   module can convert without importing anything new.
   ============================================================ */

window.OF = window.OF || {};

OF.units = (function () {
  "use strict";

  var KEY = "optimalfit.prefs";
  var KG_PER_LB = 0.45359237;
  var ML_PER_OZ = 29.5735295625;
  var CM_PER_IN = 2.54;

  function prefs() {
    var p = {};
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) p = JSON.parse(raw) || {};
    } catch (e) { /* fall through to defaults */ }
    // Carry unknown keys (e.g. onboarding's introSeen flag) through
    // untouched so setPrefs never drops them; normalize only the units.
    return Object.assign({}, p, {
      weightUnit: p.weightUnit === "kg" ? "kg" : "lb",
      waterUnit: p.waterUnit === "ml" ? "ml" : "oz"
    });
  }

  function setPrefs(patch) {
    var next = Object.assign({}, prefs(), patch || {});
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
      return true;
    } catch (e) {
      OF.util.toast("Could not save unit preferences — browser storage is full or blocked.");
      return false;
    }
  }

  function round(v, dp) {
    var f = Math.pow(10, dp == null ? 1 : dp);
    return Math.round(v * f) / f;
  }

  /* ---------- weight (stored kg) ---------- */
  function weightUnit() { return prefs().weightUnit; }

  function toDisplayWeight(kg, dp) {
    if (kg == null || !isFinite(Number(kg))) return null;
    var v = weightUnit() === "lb" ? Number(kg) / KG_PER_LB : Number(kg);
    return round(v, dp);
  }
  function fromDisplayWeight(v) {
    if (v == null || !isFinite(Number(v))) return null;
    return weightUnit() === "lb" ? Number(v) * KG_PER_LB : Number(v);
  }
  function fmtWeight(kg, dp) {
    var v = toDisplayWeight(kg, dp);
    return v == null ? "?" : v + " " + weightUnit();
  }
  /** Signed delta, e.g. "+3.2 lb" / "-0.4 lb". */
  function fmtWeightDelta(kg, dp) {
    var v = toDisplayWeight(kg, dp);
    if (v == null) return "?";
    return (v > 0 ? "+" : "") + v + " " + weightUnit();
  }

  /* ---------- water (stored ml) ---------- */
  function waterUnit() { return prefs().waterUnit; }

  function toDisplayWater(ml) {
    if (ml == null || !isFinite(Number(ml))) return null;
    return waterUnit() === "oz" ? Math.round(Number(ml) / ML_PER_OZ) : Math.round(Number(ml));
  }
  function fromDisplayWater(v) {
    if (v == null || !isFinite(Number(v))) return null;
    return waterUnit() === "oz" ? Number(v) * ML_PER_OZ : Number(v);
  }
  function fmtWater(ml) {
    var v = toDisplayWater(ml);
    return v == null ? "?" : v + " " + waterUnit();
  }

  /* ---------- height (stored cm; follows the weight unit) ---------- */
  function heightUnit() { return weightUnit() === "lb" ? "in" : "cm"; }
  function toDisplayHeight(cm) {
    if (cm == null || !isFinite(Number(cm))) return null;
    return heightUnit() === "in" ? round(Number(cm) / CM_PER_IN, 1) : round(Number(cm), 0);
  }
  function fromDisplayHeight(v) {
    if (v == null || !isFinite(Number(v))) return null;
    return heightUnit() === "in" ? Number(v) * CM_PER_IN : Number(v);
  }

  var api = {
    prefs: prefs,
    setPrefs: setPrefs,
    weightUnit: weightUnit,
    toDisplayWeight: toDisplayWeight,
    fromDisplayWeight: fromDisplayWeight,
    fmtWeight: fmtWeight,
    fmtWeightDelta: fmtWeightDelta,
    waterUnit: waterUnit,
    toDisplayWater: toDisplayWater,
    fromDisplayWater: fromDisplayWater,
    fmtWater: fmtWater,
    heightUnit: heightUnit,
    toDisplayHeight: toDisplayHeight,
    fromDisplayHeight: fromDisplayHeight
  };

  // Convenience aliases on OF.util (U.toDisplayWeight etc.).
  Object.keys(api).forEach(function (k) {
    if (k !== "prefs" && k !== "setPrefs") OF.util[k] = api[k];
  });

  return api;
})();

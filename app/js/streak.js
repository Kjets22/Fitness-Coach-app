/* ============================================================
   streak.js — daily logging streak with a weekly "freeze".

   The single strongest habit mechanic: a flame + count that grows
   every day you log ANYTHING, survives one missed day per ~week (a
   freeze) so a single slip doesn't wipe weeks of momentum, and fires
   a celebration at milestones. Computed from the logged data itself
   (robust to edits/deletes); only the all-time high-water mark and
   the last-celebrated milestone are persisted.
   ============================================================ */

window.OF = window.OF || {};

OF.streak = (function () {
  "use strict";
  var S = OF.storage;
  var KEY = "optimalfit.streakMeta";
  var TYPES = ["sleep", "food", "exercise", "body", "water", "steps"];
  var MILESTONES = [3, 7, 14, 30, 50, 100, 200, 365];

  function dayNum(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], 12) / 86400000) : null;
  }
  function isoFromDayNum(dn) {
    var d = new Date((dn + 0.5) * 86400000);
    return d.getUTCFullYear() + "-" +
      String(d.getUTCMonth() + 1).padStart(2, "0") + "-" +
      String(d.getUTCDate()).padStart(2, "0");
  }
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }
  function meta() {
    try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { return {}; }
  }
  function setMeta(patch) {
    var m = meta();
    for (var k in patch) m[k] = patch[k];
    try { localStorage.setItem(KEY, JSON.stringify(m)); } catch (e) {}
  }

  /** Set of local ISO dates that have ANY log. */
  function loggedDays() {
    var set = {};
    TYPES.forEach(function (t) {
      try { S.getAll(t).forEach(function (r) { if (r && r.date) set[r.date] = true; }); } catch (e) {}
    });
    return set;
  }

  /** { current, longest, freezesLeft, loggedToday } */
  function compute() {
    var days = loggedDays();
    var todayN = dayNum(todayISO());
    var loggedToday = !!days[isoFromDayNum(todayN)];
    // Not logging TODAY yet shouldn't "break" a streak — anchor at today if
    // logged, else yesterday (you still have today to keep it alive).
    var startN = loggedToday ? todayN : todayN - 1;
    var m = meta();
    if (!days[isoFromDayNum(startN)]) {
      return { current: 0, longest: m.longest || 0, freezesLeft: 1, loggedToday: loggedToday };
    }
    var current = 0, n = startN, freezeBudget = 1, sinceFreeze = 0;
    while (n > startN - 800) {
      if (days[isoFromDayNum(n)]) {
        current++; n--; sinceFreeze++;
        if (sinceFreeze >= 7) { freezeBudget++; sinceFreeze = 0; }   // ~1 freeze / 7 days
      } else if (freezeBudget > 0 && days[isoFromDayNum(n - 1)]) {
        freezeBudget--; n--; sinceFreeze = 0;                        // bridge a single missed day
      } else { break; }
    }
    var longest = Math.max(m.longest || 0, current);
    if (longest !== (m.longest || 0)) setMeta({ longest: longest });
    return { current: current, longest: longest, freezesLeft: freezeBudget, loggedToday: loggedToday };
  }

  /** If the current streak is EXACTLY at a not-yet-celebrated milestone, return
      it once. Using exact equality (not >=) means importing weeks of history at
      once doesn't wrongly fire an old milestone — the streak increments one day
      at a time in normal use, so it lands on each milestone the day it's hit. */
  function newMilestone() {
    var cur = compute().current;
    var m = meta();
    var last = m.lastMilestone || 0;
    // reset the marker if the streak fell below it, so milestones can re-fire on a comeback
    if (cur < last) { setMeta({ lastMilestone: 0 }); last = 0; }
    var hit = 0;
    MILESTONES.forEach(function (ms) { if (cur === ms && ms > last) hit = ms; });
    if (hit) { setMeta({ lastMilestone: hit }); return hit; }
    return 0;
  }

  /** Small flame chip for the dashboard hero. */
  function chipHtml() {
    var s = compute();
    if (s.current < 1) return "";
    var frozen = s.loggedToday ? "" : ' title="Log today to extend your streak"';
    return '<span class="streak-chip"' + frozen + '><span class="streak-flame" aria-hidden="true">🔥</span>' +
      '<span class="streak-num">' + s.current + '</span>' +
      '<span class="streak-lbl">day' + (s.current === 1 ? "" : "s") + '</span></span>';
  }

  return { compute: compute, newMilestone: newMilestone, chipHtml: chipHtml };
})();

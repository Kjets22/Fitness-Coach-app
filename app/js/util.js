/* ============================================================
   util.js — shared helpers under the single global namespace.
   Loaded first; every other script hangs off window.OF.
   Plain script (no ES modules) so the app works from file://.
   ============================================================ */

window.OF = window.OF || {};
OF.APP_VERSION = "1.3.0 (build 20)";  // bump every build; shown to the owner only

OF.util = (function () {
  "use strict";

  /** Unique id: timestamp + random suffix (good enough for local data). */
  function uid() {
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
  }

  /** Today's date as YYYY-MM-DD in LOCAL time (not UTC). */
  function todayISO(offsetDays) {
    var d = new Date();
    if (offsetDays) d.setDate(d.getDate() + offsetDays);
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  /** Current local time as HH:MM. */
  function nowTime() {
    var d = new Date();
    return String(d.getHours()).padStart(2, "0") + ":" +
      String(d.getMinutes()).padStart(2, "0");
  }

  /** "HH:MM" -> minutes since midnight, or null if malformed. */
  function timeToMinutes(t) {
    if (typeof t !== "string") return null;
    var m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
    if (!m) return null;
    var h = parseInt(m[1], 10), min = parseInt(m[2], 10);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }

  /**
   * Sleep duration in minutes from bed time to wake time.
   * If wake <= bed we assume the sleep crossed midnight.
   */
  function sleepDurationMin(bedTime, wakeTime) {
    var b = timeToMinutes(bedTime), w = timeToMinutes(wakeTime);
    if (b === null || w === null) return null;
    var dur = w - b;
    if (dur <= 0) dur += 24 * 60; // crossed midnight
    return dur;
  }

  /** 465 -> "7h 45m" */
  function fmtDuration(min) {
    if (min == null || isNaN(min)) return "?";
    // round the TOTAL first — rounding the remainder alone turns 419.6 into "6h 60m"
    min = Math.round(min);
    var h = Math.floor(min / 60), m = min - h * 60;
    return h + "h " + (m < 10 ? "0" : "") + m + "m";
  }

  /** "2026-07-07" -> "Tue, Jul 7" (falls back to raw string on bad input). */
  function fmtDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    if (!m) return iso || "?";
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  }

  /** Escape text for safe insertion into innerHTML. */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /**
   * Small fixed toast for storage errors / data warnings.
   * kind: "error" (default, red) or "warn" (amber).
   * Uses textContent, so the message is never interpreted as HTML.
   */
  var toastTimer = null;
  function toast(message, kind, action) {
    var el = document.getElementById("of-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "of-toast";
      // announce to screen readers — a blind tester never heard confirmations
      // OR the Undo button that follows a delete
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      (document.body || document.documentElement).appendChild(el);
    }
    el.className = "toast " + (kind === "warn" ? "toast-warn" : kind === "ok" ? "toast-ok" : "toast-error");
    el.textContent = message;
    // Optional action button (e.g. Undo after a delete): {label, fn}.
    if (action && action.label && typeof action.fn === "function") {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toast-action";
      btn.textContent = action.label;
      btn.addEventListener("click", function () {
        el.classList.remove("show");
        if (toastTimer) clearTimeout(toastTimer);
        try { action.fn(); } catch (e) { /* the restore itself must never throw into the toast */ }
      });
      el.appendChild(btn);
    }
    // Force a restyle so back-to-back toasts still animate.
    el.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, action ? 6000 : 4500);
  }

  /** Delete-with-undo: show "<what> deleted" with an 8s Undo that restores the
      record (as a fresh copy) and re-renders via onRestore. */
  function undoDelete(type, rec, what, onRestore) {
    toast(what + " deleted", "warn", {
      label: "Undo",
      fn: function () {
        var copy = Object.assign({}, rec);
        delete copy.id; delete copy.createdAt; delete copy.updatedAt;
        if (OF.storage.add(type, copy)) {
          toast(what + " restored", "ok");
          if (onRestore) onRestore();
        } else {
          toast("Could not restore — storage is full or blocked.");
        }
      }
    });
  }

  /**
   * Small progress bar HTML. frac 0..1 (clamped), color is a CSS
   * string like "var(--accent-2)". Pure presentational markup.
   */
  function progressBar(frac, color) {
    var pct = Math.max(0, Math.min(1, isFinite(frac) ? frac : 0)) * 100;
    return '<div class="progress"><div class="progress-fill" style="width:' +
      pct.toFixed(1) + '%;background:' + (color || "var(--accent)") + '"></div></div>';
  }

  /**
   * Circular progress ring as an SVG string (presentational only).
   * frac 0..1 (clamped). opts: { size, stroke, color ("var(--x)" or
   * "grad" for the brand gradient), value (text inside), sub (small
   * text under the value) }. All text goes through esc().
   */
  var ringSeq = 0;
  function progressRing(frac, opts) {
    opts = opts || {};
    var size = opts.size || 64;
    var stroke = opts.stroke || Math.max(5, Math.round(size / 11));
    var r = (size - stroke) / 2;
    var c = 2 * Math.PI * r;
    var f = Math.max(0, Math.min(1, isFinite(frac) ? frac : 0));
    var off = c * (1 - f);
    var half = size / 2;
    var color = opts.color || "var(--accent)";
    var defs = "";
    if (color === "grad") {
      var gid = "ofrg" + (++ringSeq);
      defs = '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0" stop-color="var(--g1)"/><stop offset="1" stop-color="var(--g2)"/>' +
        '</linearGradient></defs>';
      color = "url(#" + gid + ")";
    }
    var valSize = Math.round(size * (opts.sub ? 0.24 : 0.26));
    var ringName = opts.label || ((opts.value != null ? opts.value : Math.round(f * 100) + "%") +
      (opts.sub ? " " + opts.sub : ""));
    var out = '<svg class="ring" width="' + size + '" height="' + size +
      '" viewBox="0 0 ' + size + " " + size + '" role="img" aria-label="' + esc(ringName) + '">' + defs +
      '<circle class="ring-bg" cx="' + half + '" cy="' + half + '" r="' + r +
      '" stroke-width="' + stroke + '"/>' +
      '<circle class="ring-fg" cx="' + half + '" cy="' + half + '" r="' + r +
      '" stroke-width="' + stroke + '" stroke="' + color +
      '" stroke-dasharray="' + c.toFixed(2) + '" stroke-dashoffset="' + off.toFixed(2) + '"/>';
    if (opts.value != null) {
      out += '<text class="ring-val" x="' + half + '" y="' +
        (half + (opts.sub ? -1 : valSize * 0.36)) + '" text-anchor="middle" font-size="' +
        valSize + '">' + esc(opts.value) + '</text>';
    }
    if (opts.sub) {
      out += '<text class="ring-sub" x="' + half + '" y="' + (half + valSize * 0.85) +
        '" text-anchor="middle" font-size="' + Math.round(size * 0.13) + '">' +
        esc(opts.sub) + '</text>';
    }
    return out + "</svg>";
  }

  /** Parse a number field; returns null for empty, NaN for garbage. */
  function numOrNull(v) {
    if (v === "" || v == null) return null;
    var n = parseFloat(v);
    return isNaN(n) ? NaN : n;
  }

  /** Sort key for date+time strings; newest first when used with .sort().
      Times are zero-padded before comparing — imported backups can carry
      "9:30", which would otherwise string-compare as later than "19:30". */
  function padTime(t) {
    var m = /^(\d{1,2}):(\d{2})/.exec(String(t || ""));
    return m ? (m[1].length < 2 ? "0" : "") + m[1] + ":" + m[2] : "00:00";
  }
  function byNewest(a, b) {
    var ka = (a.date || "") + "T" + padTime(a.time || a.startTime || a.wakeTime || "00:00");
    var kb = (b.date || "") + "T" + padTime(b.time || b.startTime || b.wakeTime || "00:00");
    if (kb < ka) return -1;
    if (kb > ka) return 1;
    // tie-break same date+time by creation moment, so a second weigh-in on the
    // same day counts as "latest" instead of the morning one shadowing it
    var ca = a.createdAt || "", cb = b.createdAt || "";
    return cb < ca ? -1 : cb > ca ? 1 : 0;
  }

  /** Latest date the log forms accept: tomorrow, not today — after flying
      west the phone's calendar can sit a day BEHIND records already logged,
      and a strict "today" guard made those records look like future entries. */
  function maxLogDateISO() {
    var d = new Date();
    d.setDate(d.getDate() + 1);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  /** Canonical muscle mass in KG for a body record. New records store
      muscleMassKg (scales report muscle as a weight); legacy records stored
      muscleMassPct — convert via that day's body weight so old data keeps
      working in every chart/engine. Returns null when not derivable. */
  function muscleKg(rec) {
    if (!rec) return null;
    var kg = numOrNull(rec.muscleMassKg);
    // 0.01 kg precision (like weightKg): 0.1 kg ≈ 0.22 lb, coarser than the
    // 0.1 lb display grid, so lb entries would visibly change on save.
    if (kg != null && isFinite(kg) && kg > 0) return Math.round(kg * 100) / 100;
    var pct = numOrNull(rec.muscleMassPct), w = numOrNull(rec.weightKg);
    if (pct != null && isFinite(pct) && pct > 0 && pct <= 100 &&
        w != null && isFinite(w) && w > 0) {
      return Math.round(w * pct) / 100;   // w × pct/100, to 0.01 kg
    }
    return null;
  }

  return {
    uid: uid,
    todayISO: todayISO,
    nowTime: nowTime,
    timeToMinutes: timeToMinutes,
    sleepDurationMin: sleepDurationMin,
    fmtDuration: fmtDuration,
    fmtDate: fmtDate,
    esc: esc,
    toast: toast,
    progressBar: progressBar,
    progressRing: progressRing,
    numOrNull: numOrNull,
    byNewest: byNewest,
    muscleKg: muscleKg,
    undoDelete: undoDelete,
    maxLogDateISO: maxLogDateISO
  };
})();

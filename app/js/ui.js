/* ============================================================
   ui.js — small presentation-only enhancements.

   Segmented rating controls: any <select data-seg> keeps its id
   and .value semantics (tracker JS is untouched logically), but
   is visually replaced with tappable 1-5 pills. Pills write back
   to the hidden select; trackers call OF.ui.syncSegs() after
   setting select values programmatically (defaults / edit mode).
   No user text is rendered here except option values/labels from
   the static HTML (still escaped defensively via textContent).
   ============================================================ */

window.OF = window.OF || {};

OF.ui = (function () {
  "use strict";

  /** Reflect the select's current value onto its pill group. */
  function sync(sel) {
    if (!sel._segWrap) return;
    var val = sel.value;
    var btns = sel._segWrap.querySelectorAll(".seg-btn");
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute("data-val") === val;
      btns[i].classList.toggle("active", on);
      btns[i].setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  /** Convert every <select data-seg> under root into a pill group. */
  function initSegs(root) {
    var sels = (root || document).querySelectorAll("select[data-seg]");
    Array.prototype.forEach.call(sels, function (sel) {
      if (sel._segWrap) return; // already enhanced
      sel.classList.add("seg-native");
      var wrap = document.createElement("div");
      wrap.className = "seg";
      wrap.setAttribute("role", "group");
      Array.prototype.forEach.call(sel.options, function (opt) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "seg-btn";
        b.setAttribute("data-val", opt.value);
        b.textContent = opt.value; // "1".."5"
        b.title = opt.textContent; // e.g. "3 — okay"
        b.setAttribute("aria-label", opt.textContent);
        b.addEventListener("click", function () {
          sel.value = opt.value;
          sync(sel);
        });
        wrap.appendChild(b);
      });
      sel.parentNode.insertBefore(wrap, sel.nextSibling);
      sel._segWrap = wrap;
      sync(sel);
    });
  }

  /** Re-sync every pill group (after programmatic select changes). */
  function syncSegs() {
    var sels = document.querySelectorAll("select[data-seg]");
    for (var i = 0; i < sels.length; i++) sync(sels[i]);
  }

  return { initSegs: initSegs, syncSegs: syncSegs };
})();

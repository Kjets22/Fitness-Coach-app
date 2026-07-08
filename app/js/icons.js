/* ============================================================
   icons.js — hand-drawn inline SVG icon set (24px grid,
   1.8px stroke, currentColor). STATIC TRUSTED STRINGS ONLY —
   nothing user-provided ever passes through here, so the
   returned markup is safe to concatenate into innerHTML.
   Loaded right after util.js; no dependencies.
   ============================================================ */

window.OF = window.OF || {};

OF.icons = (function () {
  "use strict";

  var OPEN = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ' +
    'aria-hidden="true" focusable="false">';

  var PATHS = {
    dashboard:
      '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/>' +
      '<rect x="13.5" y="3.5" width="7" height="7" rx="2"/>' +
      '<rect x="3.5" y="13.5" width="7" height="7" rx="2"/>' +
      '<rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
    droplet:
      '<path d="M12 3.2s6 6.2 6 10a6 6 0 1 1-12 0c0-3.8 6-10 6-10Z"/>' +
      '<path d="M9.5 13.5a2.6 2.6 0 0 0 2 2.6"/>',
    moon:
      '<path d="M20.5 13.2A8.2 8.2 0 1 1 10.8 3.5a6.6 6.6 0 0 0 9.7 9.7Z"/>',
    apple:
      '<path d="M12 7.2c-1.6-1.9-4.6-1.8-6 .5-1.7 2.6-.7 6.9 1.4 9.4 1 1.2 2.3 1.9 3.4 1.4.4-.2.9-.2 1.3 0 1.1.5 2.4-.2 3.4-1.4 2.1-2.5 3.1-6.8 1.4-9.4-1.4-2.3-4.4-2.4-5.9-.5Z"/>' +
      '<path d="M12 7.2c0-2.2 1.3-3.6 3.2-4"/>',
    dumbbell:
      '<path d="M6.8 6.8v10.4M3.6 9.2v5.6M17.2 6.8v10.4M20.4 9.2v5.6M6.8 12h10.4"/>',
    scale:
      '<rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/>' +
      '<path d="M8.2 11a4.2 4.2 0 0 1 7.6 0"/>' +
      '<path d="M12 10.4l1.8-1.8"/>',
    sparkles:
      '<path d="M11 4.5l1.5 3.9 3.9 1.5-3.9 1.5L11 15.3l-1.5-3.9-3.9-1.5 3.9-1.5L11 4.5Z"/>' +
      '<path d="M18.5 14.5v5M16 17h5"/>',
    chat:
      '<path d="M4 7a3.2 3.2 0 0 1 3.2-3.2h9.6A3.2 3.2 0 0 1 20 7v6a3.2 3.2 0 0 1-3.2 3.2H9.4l-4 3.3c-.6.4-1.4 0-1.4-.7V7Z"/>',
    gear:
      '<circle cx="12" cy="12" r="3.4"/>' +
      '<path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.9 1.9M16.6 16.6l1.9 1.9M18.5 5.5l-1.9 1.9M7.4 16.6l-1.9 1.9"/>',
    plus:
      '<circle cx="12" cy="12" r="8.6"/>' +
      '<path d="M12 8.2v7.6M8.2 12h7.6"/>',
    activity:
      '<path d="M3 13.5h3.4l2.5-6.3 4.2 10 2.5-6.2H21"/>',
    flame:
      '<path d="M12 3.2c.9 3 4.2 4.6 4.2 8.3a4.7 4.7 0 1 1-9.4 0c0-2 1-3.6 2.1-4.7.1 1.5.6 2.5 1.6 3 .3-2.8.5-4.7 1.5-6.6Z"/>',
    target:
      '<circle cx="12" cy="12" r="8.4"/>' +
      '<circle cx="12" cy="12" r="4.4"/>' +
      '<circle cx="12" cy="12" r="0.8" fill="currentColor" stroke="none"/>',
    clock:
      '<circle cx="12" cy="12" r="8.6"/>' +
      '<path d="M12 7.2V12l3.4 2"/>',
    calendar:
      '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/>' +
      '<path d="M3.5 10h17M8.2 3v3.6M15.8 3v3.6"/>',
    pause:
      '<circle cx="12" cy="12" r="8.6"/>' +
      '<path d="M10 9.2v5.6M14 9.2v5.6"/>',
    trend:
      '<path d="M3 17.5l5.4-5.4 3.4 3.4L20.5 7"/>' +
      '<path d="M15.4 7h5.1v5.1"/>',
    gauge:
      '<path d="M4.5 16.5a8.5 8.5 0 1 1 15 0"/>' +
      '<path d="M12 14.6l3.6-3.8"/>' +
      '<circle cx="12" cy="14.8" r="1" fill="currentColor" stroke="none"/>',
    check:
      '<path d="M5 13l4.4 4.4L19 7.2"/>',
    close:
      '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    download:
      '<path d="M12 3.5v10M8 10l4 4 4-4M4.5 17.5v1a2.5 2.5 0 0 0 2.5 2.5h10a2.5 2.5 0 0 0 2.5-2.5v-1"/>',
    phone:
      '<rect x="7" y="2.8" width="10" height="18.4" rx="2.6"/>' +
      '<path d="M11 18.4h2"/>',
    heart:
      '<path d="M12 20s-7.5-4.6-7.5-10A4.4 4.4 0 0 1 12 7a4.4 4.4 0 0 1 7.5 3c0 5.4-7.5 10-7.5 10Z"/>',
    camera:
      '<path d="M3.5 8.6a2.6 2.6 0 0 1 2.6-2.6h1.5l1.2-1.9c.3-.4.7-.6 1.2-.6h4c.5 0 .9.2 1.2.6l1.2 1.9h1.5a2.6 2.6 0 0 1 2.6 2.6v8.2a2.6 2.6 0 0 1-2.6 2.6H6.1a2.6 2.6 0 0 1-2.6-2.6V8.6Z"/>' +
      '<circle cx="12" cy="12.4" r="3.3"/>',
    bodyscan:
      '<path d="M3.5 7.5V5.5a2 2 0 0 1 2-2h2M16.5 3.5h2a2 2 0 0 1 2 2v2M20.5 16.5v2a2 2 0 0 1-2 2h-2M7.5 20.5h-2a2 2 0 0 1-2-2v-2"/>' +
      '<circle cx="12" cy="8" r="1.9"/>' +
      '<path d="M8.4 12.2c0-1 1.6-1.6 3.6-1.6s3.6.6 3.6 1.6l-.7 3.1a1 1 0 0 1-1 .8h-.5v1.6M10 15.7v1.6M10.5 15.9l-1.9-.5"/>'
  };

  /** Return a 24px inline SVG for a known icon name ("" for unknown). */
  function get(name) {
    var body = PATHS[name];
    return body ? OPEN + body + "</svg>" : "";
  }

  /** Icon wrapped in a tinted circle (for cards / empty states). */
  function badge(name, extraClass) {
    return '<span class="ico-badge' + (extraClass ? " " + extraClass : "") + '">' +
      get(name) + '</span>';
  }

  return { get: get, badge: badge };
})();

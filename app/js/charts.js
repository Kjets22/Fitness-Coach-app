/* ============================================================
   charts.js — hand-rolled inline SVG chart helpers (no deps).

   OF.charts.lineChart(opts) -> SVG string
     opts: { series: [{ label, color, points: [{x, y}] }],
             xTicks: [{x, label}], yFmt?, yMin?, yMax?,
             width?, height?, emptyMsg? }
   OF.charts.barChart(opts) -> SVG string
     opts: { bars: [{ label, value, color?, valueLabel? }],
             yFmt?, yMax?, width?, height?, emptyMsg? }
   OF.charts.empty(msg) -> HTML string (friendly empty state)

   Colors are passed as CSS strings (e.g. "var(--accent)") and
   applied via style attributes so theming (dark/light) works.
   SVGs use a responsive viewBox: width 100% via .chart-svg CSS.
   ============================================================ */

window.OF = window.OF || {};

OF.charts = (function () {
  "use strict";

  function esc(s) { return OF.util.esc(s); }

  var gradSeq = 0; // unique ids for per-chart gradient defs

  function fmtVal(fmt, v) {
    if (typeof fmt === "function") return fmt(v);
    // default: at most 1 decimal, no trailing ".0"
    var r = Math.round(v * 10) / 10;
    return String(r);
  }

  /** Friendly empty-state block (HTML, not SVG). */
  function empty(msg) {
    return '<div class="chart-empty">' + esc(msg || "No data yet — log some entries or load demo data from Settings.") + '</div>';
  }

  /** "Nice" tick values between min and max (approx `count` of them). */
  function niceTicks(min, max, count) {
    if (!isFinite(min) || !isFinite(max)) return [];
    if (max <= min) max = min + 1;
    var span = max - min;
    var step = Math.pow(10, Math.floor(Math.log(span / count) / Math.LN10));
    var err = span / count / step;
    if (err >= 7.5) step *= 10;
    else if (err >= 3.5) step *= 5;
    else if (err >= 1.5) step *= 2;
    var ticks = [];
    var v = Math.ceil(min / step) * step;
    for (; v <= max + step * 1e-6; v += step) {
      ticks.push(Math.round(v * 1e6) / 1e6);
      if (ticks.length > 12) break; // safety
    }
    return ticks;
  }

  function svgOpen(w, h) {
    return '<svg class="chart-svg" viewBox="0 0 ' + w + ' ' + h + '" ' +
      'preserveAspectRatio="xMidYMid meet" role="img" xmlns="http://www.w3.org/2000/svg">';
  }

  function gridLine(x1, x2, y) {
    return '<line x1="' + x1 + '" x2="' + x2 + '" y1="' + y + '" y2="' + y + '" class="chart-grid"/>';
  }

  function yLabel(x, y, text) {
    return '<text x="' + x + '" y="' + y + '" class="chart-txt" text-anchor="end">' + esc(text) + '</text>';
  }

  /* ---------------- Line chart ---------------- */
  function lineChart(opts) {
    opts = opts || {};
    var series = (opts.series || []).filter(function (s) {
      return s && s.points && s.points.length > 0;
    });
    var totalPts = series.reduce(function (n, s) { return n + s.points.length; }, 0);
    if (!series.length || totalPts < 2) return empty(opts.emptyMsg);

    var W = opts.width || 640, H = opts.height || 200;
    var padL = 46, padR = 12, padT = 12, padB = 24;
    var plotW = W - padL - padR, plotH = H - padT - padB;

    var xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    series.forEach(function (s) {
      s.points.forEach(function (p) {
        if (p.x < xMin) xMin = p.x;
        if (p.x > xMax) xMax = p.x;
        if (p.y < yMin) yMin = p.y;
        if (p.y > yMax) yMax = p.y;
      });
    });
    if (opts.yMin != null && opts.yMin < yMin) yMin = opts.yMin;
    if (opts.yMax != null && opts.yMax > yMax) yMax = opts.yMax;
    if (yMax === yMin) { yMax += 1; yMin -= 1; }
    var yPad = (yMax - yMin) * 0.08;
    yMin -= yPad; yMax += yPad;
    if (xMax === xMin) xMax = xMin + 1;

    function X(x) { return padL + (x - xMin) / (xMax - xMin) * plotW; }
    function Y(y) { return padT + (1 - (y - yMin) / (yMax - yMin)) * plotH; }

    var out = svgOpen(W, H);

    niceTicks(yMin, yMax, 4).forEach(function (t) {
      var y = Y(t);
      out += gridLine(padL, W - padR, y.toFixed(1));
      out += yLabel(padL - 6, (y + 3.5).toFixed(1), fmtVal(opts.yFmt, t));
    });

    (opts.xTicks || []).forEach(function (t) {
      if (t.x < xMin || t.x > xMax) return;
      var x = X(t.x);
      out += '<text x="' + x.toFixed(1) + '" y="' + (H - 6) + '" class="chart-txt" text-anchor="middle">' + esc(t.label) + '</text>';
    });

    series.forEach(function (s) {
      var color = s.color || "var(--accent)";
      var pts = s.points.slice().sort(function (a, b) { return a.x - b.x; });
      var d = pts.map(function (p, i) {
        return (i ? "L" : "M") + X(p.x).toFixed(1) + " " + Y(p.y).toFixed(1);
      }).join(" ");
      // Soft gradient area under the line (fades to transparent).
      if (pts.length >= 2) {
        var gid = "ofcg" + (++gradSeq);
        var baseY = (padT + plotH).toFixed(1);
        out += '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" style="stop-color:' + color + '" stop-opacity="0.28"/>' +
          '<stop offset="1" style="stop-color:' + color + '" stop-opacity="0"/>' +
          '</linearGradient></defs>' +
          '<path d="' + d + ' L' + X(pts[pts.length - 1].x).toFixed(1) + ' ' + baseY +
          ' L' + X(pts[0].x).toFixed(1) + ' ' + baseY + ' Z" fill="url(#' + gid + ')"/>';
      }
      out += '<path d="' + d + '" fill="none" style="stroke:' + color + '" stroke-width="2" ' +
        'stroke-linejoin="round" stroke-linecap="round"/>';
      if (pts.length <= 45) {
        pts.forEach(function (p) {
          out += '<circle cx="' + X(p.x).toFixed(1) + '" cy="' + Y(p.y).toFixed(1) +
            '" r="2.6" style="fill:' + color + '"/>';
        });
      }
    });

    out += "</svg>";

    // Legend (only when multiple series)
    if (series.length > 1) {
      out += '<div class="chart-legend">' + series.map(function (s) {
        return '<span class="legend-item"><span class="legend-swatch" style="background:' +
          (s.color || "var(--accent)") + '"></span>' + esc(s.label || "") + '</span>';
      }).join("") + '</div>';
    }
    return out;
  }

  /* ---------------- Bar chart ---------------- */
  function barChart(opts) {
    opts = opts || {};
    var bars = (opts.bars || []).filter(function (b) { return b != null; });
    var hasValue = bars.some(function (b) { return b.value != null && isFinite(b.value); });
    if (!bars.length || !hasValue) return empty(opts.emptyMsg);

    var W = opts.width || 640, H = opts.height || 200;
    var padL = 40, padR = 8, padT = 18, padB = 26;
    var plotW = W - padL - padR, plotH = H - padT - padB;

    var dataMax = 0;
    bars.forEach(function (b) {
      if (b.value != null && isFinite(b.value) && b.value > dataMax) dataMax = b.value;
    });
    var yMax = opts.yMax != null ? opts.yMax : dataMax * 1.15;
    if (yMax <= 0) yMax = 1;

    function Y(v) { return padT + (1 - v / yMax) * plotH; }

    var out = svgOpen(W, H);

    niceTicks(0, yMax, 4).forEach(function (t) {
      var y = Y(t);
      out += gridLine(padL, W - padR, y.toFixed(1));
      out += yLabel(padL - 6, (y + 3.5).toFixed(1), fmtVal(opts.yFmt, t));
    });

    var slot = plotW / bars.length;
    var barW = Math.min(slot * 0.62, 52);

    bars.forEach(function (b, i) {
      var cx = padL + slot * (i + 0.5);
      // x label always (even for missing bars)
      out += '<text x="' + cx.toFixed(1) + '" y="' + (H - 6) + '" class="chart-txt" text-anchor="middle">' +
        esc(b.label == null ? "" : String(b.label)) + '</text>';
      if (b.value == null || !isFinite(b.value)) return;
      var v = Math.max(0, b.value);
      var y = Y(v);
      var h = Math.max(v > 0 ? 1.5 : 0, (padT + plotH) - y);
      var rx = Math.min(4.5, barW / 2, h / 2).toFixed(1);
      out += '<rect x="' + (cx - barW / 2).toFixed(1) + '" y="' + y.toFixed(1) +
        '" width="' + barW.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="' + rx + '" style="fill:' +
        (b.color || "var(--accent)") + '"/>';
      var vl = b.valueLabel != null ? b.valueLabel : fmtVal(opts.yFmt, b.value);
      out += '<text x="' + cx.toFixed(1) + '" y="' + (y - 4).toFixed(1) +
        '" class="chart-txt chart-txt-strong" text-anchor="middle">' + esc(vl) + '</text>';
    });

    out += "</svg>";
    return out;
  }

  return { lineChart: lineChart, barChart: barChart, empty: empty };
})();

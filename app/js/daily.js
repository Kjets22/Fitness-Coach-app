/* ============================================================
   daily.js — the "Daily" tab: water + steps trackers.

   Records (metric internally):
     water — { date, amountMl }   (many entries per day)
     steps — { date, count }      (ONE entry per day; saving the
                                    same date updates it)
   Quick-add buttons and the custom field follow the water-unit
   preference (oz/ml). Targets come from the active goal via
   OF.goals.currentTargets(); sensible defaults otherwise.
   ============================================================ */

window.OF = window.OF || {};

OF.daily = (function () {
  "use strict";
  var U = OF.util, S = OF.storage;
  var els = {};

  var QUICK = {
    oz: [{ label: "+8 oz glass", ml: 237 }, { label: "+16 oz", ml: 473 }, { label: "+32 oz", ml: 946 }],
    ml: [{ label: "+250 ml glass", ml: 250 }, { label: "+500 ml", ml: 500 }, { label: "+1 L", ml: 1000 }]
  };

  /* ---------------- helpers ---------------- */

  function targets() {
    var t = OF.goals ? OF.goals.currentTargets() : null;
    if (t && t.status === "ok") return { waterMl: t.waterMl, steps: t.steps, fromGoal: true };
    // No goal / no weight yet: fall back to 35 ml/kg if a weight exists, else 2500 ml.
    var kg = OF.targets ? OF.targets.latestWeightKg(S.getAll("body")) : null;
    return { waterMl: kg ? Math.round(35 * kg) : 2500, steps: 8000, fromGoal: false };
  }

  function dayTotals(type, field, days) {
    // Map ISO date -> total for the last `days` days (today inclusive).
    var out = {};
    for (var i = days - 1; i >= 0; i--) out[U.todayISO(-i)] = 0;
    S.getAll(type).forEach(function (r) {
      if (r.date in out && isFinite(Number(r[field]))) out[r.date] += Number(r[field]);
    });
    return out;
  }

  function waterTodayMl() {
    var today = U.todayISO();
    return S.getAll("water").reduce(function (n, r) {
      return n + (r.date === today && isFinite(Number(r.amountMl)) ? Number(r.amountMl) : 0);
    }, 0);
  }

  function stepsRecordFor(date) {
    var found = null;
    S.getAll("steps").forEach(function (r) {
      if (r.date === date) found = r; // last one wins
    });
    return found;
  }

  function showErr(el, msg) {
    if (el) { el.textContent = msg; el.hidden = !msg; }
  }

  /* ---------------- water ---------------- */

  function addWater(ml) {
    if (!isFinite(ml) || ml <= 0) return;
    if (!S.add("water", { date: U.todayISO(), amountMl: Math.round(ml) })) {
      U.toast("Could not save — browser storage is full or blocked.");
      return;
    }
    renderWater();
  }

  function renderWater() {
    var t = targets();
    var total = waterTodayMl();
    var frac = t.waterMl ? total / t.waterMl : 0;

    els.waterProgress.innerHTML =
      '<p class="daily-progress-line"><strong>' + U.esc(U.fmtWater(total)) + '</strong> of ' +
      U.esc(U.fmtWater(t.waterMl)) + ' today (' + Math.round(frac * 100) + '%)' +
      (t.fromGoal ? '' : ' <span class="muted small">&mdash; default target; set a goal on Insights for a personal one</span>') +
      '</p>' +
      U.progressBar(frac, frac >= 1 ? "var(--accent-2)" : "var(--accent)");

    // Quick-add buttons in the preferred unit.
    var quick = QUICK[U.waterUnit()] || QUICK.oz;
    els.waterQuick.innerHTML = quick.map(function (q) {
      return '<button type="button" class="btn" data-ml="' + q.ml + '">' + U.esc(q.label) + '</button>';
    }).join("");
    els.waterUnit.textContent = U.waterUnit();

    // Today's entries (deletable).
    var today = U.todayISO();
    var entries = S.getAll("water").filter(function (r) { return r.date === today; });
    if (entries.length) {
      els.waterToday.innerHTML = '<div class="chart-mini-label">Today</div>' +
        '<div class="water-entries">' + entries.map(function (r) {
          var when = "";
          if (r.createdAt) {
            var d = new Date(r.createdAt);
            if (!isNaN(d)) when = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
          }
          return '<span class="water-entry">' + U.esc(U.fmtWater(r.amountMl)) +
            (when ? ' <span class="muted">' + U.esc(when) + '</span>' : '') +
            '<button type="button" class="water-del" data-id="' + U.esc(r.id) + '" aria-label="Delete entry">&times;</button></span>';
        }).join("") + '</div>';
    } else {
      els.waterToday.innerHTML = '<p class="empty-msg">Nothing logged today — tap a button above.</p>';
    }

    // 14-day chart.
    var totals = dayTotals("water", "amountMl", 14);
    var hasAny = false;
    var bars = Object.keys(totals).map(function (date) {
      var v = totals[date];
      if (v > 0) hasAny = true;
      var disp = U.toDisplayWater(v);
      return {
        label: String(Number(date.slice(8, 10))),
        value: v > 0 ? disp : null,
        color: v >= t.waterMl ? "var(--accent-2)" : "var(--accent)",
        valueLabel: v > 0 ? String(disp) : ""
      };
    });
    els.waterChart.innerHTML = hasAny
      ? OF.charts.barChart({ bars: bars, height: 150 })
      : OF.charts.empty("No water logged in the last 14 days.");
  }

  function onQuickClick(evt) {
    var btn = evt.target.closest("button[data-ml]");
    if (!btn) return;
    addWater(Number(btn.getAttribute("data-ml")));
  }

  function onCustomSubmit(evt) {
    evt.preventDefault();
    var v = U.numOrNull(els.waterAmt.value);
    if (v === null || isNaN(v) || v <= 0 || v > 10000) {
      showErr(els.waterErr, "Enter an amount between 1 and 10000 " + U.waterUnit() + ".");
      return;
    }
    var ml = U.fromDisplayWater(v);
    if (ml > 10000) { // 10 L per entry is already absurd
      showErr(els.waterErr, "That's more than 10 liters in one entry — double-check the amount.");
      return;
    }
    showErr(els.waterErr, "");
    els.waterAmt.value = "";
    addWater(ml);
  }

  function onWaterListClick(evt) {
    var btn = evt.target.closest(".water-del");
    if (!btn) return;
    S.remove("water", btn.getAttribute("data-id"));
    renderWater();
  }

  /* ---------------- steps ---------------- */

  function renderSteps() {
    var t = targets();
    var todayRec = stepsRecordFor(U.todayISO());
    var todayCount = todayRec && isFinite(Number(todayRec.count)) ? Number(todayRec.count) : 0;
    var frac = t.steps ? todayCount / t.steps : 0;

    els.stepsProgress.innerHTML =
      '<p class="daily-progress-line"><strong>' + todayCount.toLocaleString() + '</strong> of ' +
      t.steps.toLocaleString() + ' steps today (' + Math.round(frac * 100) + '%)</p>' +
      U.progressBar(frac, frac >= 1 ? "var(--accent-2)" : "var(--accent)");

    // Prefill today's count for quick editing.
    if (els.stepsDate.value === U.todayISO() && todayRec && !els.stepsCount.value) {
      els.stepsCount.placeholder = String(todayCount || 8000);
    }

    var totals = dayTotals("steps", "count", 14);
    // steps is one-per-day; dayTotals sums dupes, which is fine for display
    var byDate = {};
    S.getAll("steps").forEach(function (r) {
      if (r.date in totals && isFinite(Number(r.count))) byDate[r.date] = Number(r.count); // last wins
    });
    var hasAny = false;
    var bars = Object.keys(totals).map(function (date) {
      var v = byDate[date];
      if (v != null) hasAny = true;
      return {
        label: String(Number(date.slice(8, 10))),
        value: v != null ? v : null,
        color: v != null && v >= t.steps ? "var(--accent-2)" : "var(--accent)",
        valueLabel: v != null ? (Math.round(v / 100) / 10) + "k" : ""
      };
    });
    els.stepsChart.innerHTML = hasAny
      ? OF.charts.barChart({ bars: bars, height: 150 })
      : OF.charts.empty("No steps logged in the last 14 days.");
  }

  function onStepsSubmit(evt) {
    evt.preventDefault();
    var date = els.stepsDate.value;
    if (!date) { showErr(els.stepsErr, "Pick a date."); return; }
    if (date > U.todayISO()) { showErr(els.stepsErr, "Steps can't be logged for the future."); return; }
    var v = U.numOrNull(els.stepsCount.value);
    if (v === null || isNaN(v) || v < 0 || v > 200000) {
      showErr(els.stepsErr, "Step count must be between 0 and 200000.");
      return;
    }
    var count = Math.round(v);
    var existing = stepsRecordFor(date);
    // Tag as a manual entry so an Apple Health / Health Connect auto-sync never
    // overwrites a number the user typed themselves (source "manual" wins).
    var ok = existing
      ? S.update("steps", existing.id, { count: count, source: "manual" })
      : S.add("steps", { date: date, count: count, source: "manual" });
    if (!ok) {
      showErr(els.stepsErr, "Could not save — browser storage is full or blocked.");
      return;
    }
    showErr(els.stepsErr, "");
    els.stepsCount.value = "";
    renderSteps();
  }

  /* ---------------- lifecycle ---------------- */

  function renderAll() {
    if (!els.waterProgress) return;
    renderWater();
    renderSteps();
  }

  function init() {
    els.waterProgress = document.getElementById("water-progress");
    els.waterQuick = document.getElementById("water-quick");
    els.waterForm = document.getElementById("water-form");
    els.waterAmt = document.getElementById("water-custom-amt");
    els.waterUnit = document.getElementById("water-custom-unit");
    els.waterErr = document.getElementById("water-error");
    els.waterToday = document.getElementById("water-today");
    els.waterChart = document.getElementById("water-chart");
    els.stepsProgress = document.getElementById("steps-progress");
    els.stepsForm = document.getElementById("steps-form");
    els.stepsDate = document.getElementById("steps-date");
    els.stepsCount = document.getElementById("steps-count");
    els.stepsErr = document.getElementById("steps-error");
    els.stepsChart = document.getElementById("steps-chart");

    els.stepsDate.value = U.todayISO();
    els.waterQuick.addEventListener("click", onQuickClick);
    els.waterForm.addEventListener("submit", onCustomSubmit);
    els.waterToday.addEventListener("click", onWaterListClick);
    els.stepsForm.addEventListener("submit", onStepsSubmit);
    renderAll();
  }

  return { init: init, renderAll: renderAll, refresh: renderAll, waterTodayMl: waterTodayMl, stepsRecordFor: stepsRecordFor };
})();

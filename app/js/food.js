/* ============================================================
   food.js — food/meal tracker: form + history list.
   Record: { date, time, mealType, foodName, calories,
             protein, carbs, fat, notes }
   Macros are optional; foodName + date + time are required.
   ============================================================ */

window.OF = window.OF || {};

OF.food = (function () {
  "use strict";
  var U = OF.util, S = OF.storage;
  var els = {};

  function init() {
    els.form = document.getElementById("food-form");
    els.editId = document.getElementById("food-edit-id");
    els.date = document.getElementById("food-date");
    els.time = document.getElementById("food-time");
    els.mealType = document.getElementById("food-mealtype");
    els.name = document.getElementById("food-name");
    els.calories = document.getElementById("food-calories");
    els.protein = document.getElementById("food-protein");
    els.carbs = document.getElementById("food-carbs");
    els.fat = document.getElementById("food-fat");
    els.notes = document.getElementById("food-notes");
    els.error = document.getElementById("food-error");
    els.submit = document.getElementById("food-submit");
    els.cancel = document.getElementById("food-cancel-edit");
    els.title = document.getElementById("food-form-title");
    els.list = document.getElementById("food-list");
    els.summary = document.getElementById("food-summary");

    setDefaults();
    els.form.addEventListener("submit", onSubmit);
    els.cancel.addEventListener("click", exitEditMode);
    els.list.addEventListener("click", onListClick);
    renderList();
  }

  function setDefaults() {
    els.date.value = U.todayISO();
    els.time.value = U.nowTime();
    els.mealType.value = guessMealType();
    els.name.value = "";
    els.calories.value = "";
    els.protein.value = "";
    els.carbs.value = "";
    els.fat.value = "";
    els.notes.value = "";
  }

  /** Sensible default meal type from the current hour. */
  function guessMealType() {
    var h = new Date().getHours();
    if (h < 10) return "breakfast";
    if (h < 14) return "lunch";
    if (h < 17) return "snack";
    if (h < 21) return "dinner";
    return "snack";
  }

  function showError(msg) {
    els.error.textContent = msg;
    els.error.hidden = !msg;
  }

  function readForm() {
    if (!els.date.value) return { err: "Please pick a date." };
    if (!els.time.value) return { err: "Please enter a time." };
    var name = els.name.value.trim();
    if (!name) return { err: "Please enter a food or meal name." };
    var nums = {
      calories: U.numOrNull(els.calories.value),
      protein: U.numOrNull(els.protein.value),
      carbs: U.numOrNull(els.carbs.value),
      fat: U.numOrNull(els.fat.value)
    };
    var maxes = { calories: 10000, protein: 1000, carbs: 1000, fat: 1000 }; // match input max attrs
    for (var k in nums) {
      if (nums[k] !== null && (isNaN(nums[k]) || nums[k] < 0 || nums[k] > maxes[k])) {
        return { err: "Please enter " + k + " between 0 and " + maxes[k] + "." };
      }
    }
    return {
      rec: {
        date: els.date.value,
        time: els.time.value,
        mealType: els.mealType.value,
        foodName: name,
        calories: nums.calories,
        protein: nums.protein,
        carbs: nums.carbs,
        fat: nums.fat,
        notes: els.notes.value.trim()
      }
    };
  }

  function onSubmit(e) {
    e.preventDefault();
    var r = readForm();
    if (r.err) { showError(r.err); return; }
    showError("");
    var editId = els.editId.value;
    if (editId) {
      if (!S.update("food", editId, r.rec)) {
        showError("Could not save — browser storage is full or blocked. Your entry was NOT saved.");
        return;
      }
      exitEditMode();
    } else {
      if (!S.add("food", r.rec)) {
        showError("Could not save — browser storage is full or blocked. Your entry was NOT saved.");
        return;
      }
      setDefaults();
    }
    renderList();
    OF.dashboard && OF.dashboard.refresh();
  }

  function enterEditMode(rec) {
    els.editId.value = rec.id;
    els.date.value = rec.date;
    els.time.value = rec.time;
    els.mealType.value = rec.mealType || "snack";
    els.name.value = rec.foodName || "";
    els.calories.value = rec.calories != null ? rec.calories : "";
    els.protein.value = rec.protein != null ? rec.protein : "";
    els.carbs.value = rec.carbs != null ? rec.carbs : "";
    els.fat.value = rec.fat != null ? rec.fat : "";
    els.notes.value = rec.notes || "";
    els.title.textContent = "Edit meal";
    els.submit.textContent = "Save changes";
    els.cancel.classList.remove("hidden");
    els.form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function exitEditMode() {
    els.editId.value = "";
    els.title.textContent = "Log a meal";
    els.submit.textContent = "Add meal";
    els.cancel.classList.add("hidden");
    showError("");
    setDefaults();
  }

  function onListClick(e) {
    var btn = e.target.closest("button[data-act]");
    if (!btn) return;
    var id = btn.getAttribute("data-id");
    if (btn.getAttribute("data-act") === "del") {
      if (confirm("Delete this meal?")) {
        S.remove("food", id);
        if (els.editId.value === id) exitEditMode();
        renderList();
        OF.dashboard && OF.dashboard.refresh();
      }
    } else {
      var rec = S.get("food", id);
      if (rec) enterEditMode(rec);
    }
  }

  function macroLine(r) {
    var parts = [];
    if (r.calories != null) parts.push(r.calories + " kcal");
    if (r.protein != null) parts.push("P " + r.protein + "g");
    if (r.carbs != null) parts.push("C " + r.carbs + "g");
    if (r.fat != null) parts.push("F " + r.fat + "g");
    return parts.join(" · ");
  }

  /** Today's summary strip above the form. */
  function renderSummary() {
    if (!els.summary) return;
    var today = U.todayISO();
    var todays = S.getAll("food").filter(function (r) { return r.date === today; });
    if (!todays.length) { els.summary.innerHTML = ""; return; }
    var kcal = 0, prot = 0;
    todays.forEach(function (r) {
      if (isFinite(Number(r.calories))) kcal += Number(r.calories);
      if (isFinite(Number(r.protein))) prot += Number(r.protein);
    });
    els.summary.innerHTML =
      '<span class="entry-ico">' + OF.icons.get("apple") + '</span>' +
      '<span>Today: <strong>' + U.esc(String(Math.round(kcal))) + ' kcal</strong> · <strong>' +
      U.esc(String(Math.round(prot))) + 'g</strong> protein</span>' +
      '<span><strong>' + todays.length + '</strong> meal' + (todays.length === 1 ? '' : 's') +
      ' logged</span>';
  }

  function renderList() {
    renderSummary();
    var arr = S.getAll("food").slice().sort(U.byNewest);
    if (!arr.length) {
      els.list.innerHTML = '<div class="empty-state">' + OF.icons.badge("apple") +
        '<p>No meals logged yet — a name and rough calories are enough to start.</p></div>';
      return;
    }
    els.list.innerHTML = arr.map(function (r) {
      var sub = U.fmtDate(r.date) + " " + r.time + (macroLine(r) ? " · " + macroLine(r) : "") +
        (r.notes ? " · " + r.notes : "");
      return '<div class="entry">' +
        '<span class="entry-ico">' + OF.icons.get("apple") + '</span>' +
        '<div class="entry-main">' +
          '<div class="entry-title">' + U.esc(r.foodName) + '</div>' +
          '<div class="entry-sub">' + U.esc(sub) + '</div>' +
        '</div>' +
        '<span class="entry-badge">' + U.esc(r.mealType) + '</span>' +
        '<div class="entry-actions">' +
          '<button class="btn mini" data-act="edit" data-id="' + U.esc(r.id) + '">Edit</button>' +
          '<button class="btn mini danger" data-act="del" data-id="' + U.esc(r.id) + '">Delete</button>' +
        '</div>' +
      '</div>';
    }).join("");
  }

  return { init: init, renderList: renderList };
})();

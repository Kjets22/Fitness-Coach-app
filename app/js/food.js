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
  var listLimit = 50;   // windowed history: render newest 50, expand on demand

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
    var recentHost = document.getElementById("food-recent");
    if (recentHost) recentHost.addEventListener("click", onRecentClick);
    // autocomplete: your own meal history first, then the built-in food DB;
    // picking an exact match auto-fills the macros (still editable)
    els.name.setAttribute("list", "food-name-options");
    els.name.addEventListener("input", onNameInput);
    els.name.addEventListener("change", onNameInput);
    var sm = document.getElementById("food-serv-minus"), sp = document.getElementById("food-serv-plus");
    if (sm) sm.addEventListener("click", function () { servStep(-0.5); });
    if (sp) sp.addEventListener("click", function () { servStep(0.5); });
    refreshNameOptions();
    if (els.summary) {
      els.summary.setAttribute("title", "Tap to edit your latest meal");
      els.summary.addEventListener("click", function () {
        var latest = S.getAll("food").slice().sort(U.byNewest)[0];
        if (latest) enterEditMode(latest);
      });
    }
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
    if (els.date.value > U.maxLogDateISO()) return { err: "That date is too far in the future — meals can only be logged for today or earlier." };
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
    if (Date.now() - lastSaveAt < 800) return;   // double-tap saves the meal twice
    var r = readForm();
    if (r.err) { showError(r.err); return; }
    showError("");
    lastSaveAt = Date.now();
    var editId = els.editId.value;
    if (editId) {
      if (!S.update("food", editId, r.rec)) {
        showError("Could not save — browser storage is full or blocked. Your entry was NOT saved.");
        return;
      }
      exitEditMode();
      U.toast("Meal updated.", "ok");
    } else {
      if (!S.add("food", r.rec)) {
        showError("Could not save — browser storage is full or blocked. Your entry was NOT saved.");
        return;
      }
      setDefaults();
      servReset();
      U.toast("Meal logged.", "ok");
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

  var lastSaveAt = 0;   // double-tap guard (same as sleep.js)

  function onListClick(e) {
    var btn = e.target.closest("button[data-act]");
    if (!btn) {
      // the whole row is tappable — tap anywhere on an entry to edit it
      var row = e.target.closest(".entry[data-id]");
      if (row) { var rrec = S.get("food", row.getAttribute("data-id")); if (rrec) enterEditMode(rrec); }
      return;
    }
    if (btn.getAttribute("data-act") === "show-more") { listLimit += 50; renderList(); return; }
    var id = btn.getAttribute("data-id");
    if (btn.getAttribute("data-act") === "del") {
      var doomed = S.get("food", id);
      S.remove("food", id);
      if (els.editId.value === id) exitEditMode();
      renderList();
      OF.dashboard && OF.dashboard.refresh();
      if (doomed) U.undoDelete("food", doomed, "Meal", function () {
        renderList(); OF.dashboard && OF.dashboard.refresh();
      });
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
    var kcal = 0, prot = 0, carb = 0, fat = 0;
    todays.forEach(function (r) {
      if (isFinite(Number(r.calories))) kcal += Number(r.calories);
      if (isFinite(Number(r.protein))) prot += Number(r.protein);
      if (isFinite(Number(r.carbs))) carb += Number(r.carbs);
      if (isFinite(Number(r.fat))) fat += Number(r.fat);
    });
    // show ALL FOUR macros against target where you actually make eating
    // decisions — a keto tester and a macro-tracker both had to leave the tab
    // (or add meals up by hand) just to see carbs
    var t = null;
    try {
      var gi = OF.goals && OF.goals.info ? OF.goals.info() : null;
      t = (gi && gi.targets && gi.targets.status === "ok") ? gi.targets : null;
    } catch (e) {}
    function part(label, val, target, unit) {
      var v = Math.round(val);
      return '<span class="macro-part"><strong>' + U.esc(String(v)) +
        (target ? " / " + U.esc(String(Math.round(target))) : "") + U.esc(unit) + '</strong> ' +
        U.esc(label) + '</span>';
    }
    els.summary.innerHTML =
      '<span class="entry-ico">' + OF.icons.get("apple") + '</span>' +
      '<span class="macro-row">' +
        part("kcal", kcal, t ? t.calories : null, "") +
        part("protein", prot, t ? t.proteinG : null, "g") +
        part("carbs", carb, t ? t.carbsG : null, "g") +
        part("fat", fat, t ? t.fatG : null, "g") +
      '</span>' +
      '<span><strong>' + todays.length + '</strong> meal' + (todays.length === 1 ? '' : 's') + '</span>';
  }

  /** "Log again" chips: the user's recent distinct meals — most meals repeat,
      so one tap prefills the whole form instead of retyping name + 4 macros. */
  var autoFilled = false;   // macros last set by autocomplete → safe to overwrite

  /** History + built-in DB into the <datalist> (history wins, deduped). */
  function refreshNameOptions() {
    var dl = document.getElementById("food-name-options");
    if (!dl) return;
    var seen = Object.create(null), opts = [];
    S.getAll("food").slice().sort(U.byNewest).forEach(function (r) {
      var k = (r.foodName || "").trim().toLowerCase();
      if (!k || seen[k] || opts.length >= 40) return;
      seen[k] = true;
      opts.push(r.foodName.trim());
    });
    if (OF.foodDB) {
      // respect the diet the interview collected (a halal tester was offered
      // pork and beer; a vegan was offered dairy)
      var restrictions = [];
      try {
        var d = OF.profile && OF.profile.get ? OF.profile.get() : null;
        restrictions = (d && d.recovery && d.recovery.restrictions) || [];
      } catch (e) {}
      OF.foodDB.all(restrictions).forEach(function (f) {
        var k = f.name.toLowerCase();
        if (seen[k]) return;
        seen[k] = true;
        opts.push(f.name);
      });
    }
    dl.innerHTML = opts.map(function (n) { return '<option value="' + U.esc(n) + '">'; }).join("");
  }

  /** Exact name match (your history first, then the DB) → fill the macros. */
  function onNameInput() {
    var k = els.name.value.trim().toLowerCase();
    if (!k) return;
    var macrosEmpty = !els.calories.value && !els.protein.value && !els.carbs.value && !els.fat.value;
    if (!macrosEmpty && !autoFilled) return;   // never clobber hand-typed numbers
    var hit = null;
    var hist = S.getAll("food").slice().sort(U.byNewest);
    for (var i = 0; i < hist.length; i++) {
      if ((hist[i].foodName || "").trim().toLowerCase() === k) { hit = hist[i]; break; }
    }
    if (!hit && OF.foodDB) hit = OF.foodDB.find(k);
    // no exact match: a UNIQUE substring match is safe to autofill (user
    // testing: exact-only meant "spelled slightly differently = retype all
    // four macros"). Ambiguous matches stay blank on purpose.
    if (!hit && k.length >= 3) {
      var subs = [], seenN = Object.create(null);
      for (var j = 0; j < hist.length; j++) {
        var n = (hist[j].foodName || "").trim().toLowerCase();
        if (n.indexOf(k) !== -1 && !seenN[n]) { seenN[n] = true; subs.push(hist[j]); }
      }
      if (OF.foodDB) OF.foodDB.all().forEach(function (f) {
        var n = f.name.toLowerCase();
        if (n.indexOf(k) !== -1 && !seenN[n]) { seenN[n] = true; subs.push(f); }
      });
      if (subs.length === 1) hit = subs[0];
    }
    if (!hit) { if (autoFilled) { els.calories.value = ""; els.protein.value = ""; els.carbs.value = ""; els.fat.value = ""; autoFilled = false; } servReset(); return; }
    els.calories.value = hit.calories != null ? hit.calories : "";
    els.protein.value = hit.protein != null ? hit.protein : "";
    els.carbs.value = hit.carbs != null ? hit.carbs : "";
    els.fat.value = hit.fat != null ? hit.fat : "";
    autoFilled = true;
    servShow();
  }

  /* ---- servings stepper: scales the four macro fields (base x N) ---- */
  var servN = 1, servBase = null;

  function servCapture() {
    servBase = {
      calories: U.numOrNull(els.calories.value), protein: U.numOrNull(els.protein.value),
      carbs: U.numOrNull(els.carbs.value), fat: U.numOrNull(els.fat.value)
    };
  }
  function servShow() { servN = 1; servCapture(); servRender(); var row = document.getElementById("food-serv-row"); if (row) row.hidden = false; }
  function servReset() { servN = 1; servBase = null; servRender(); var row = document.getElementById("food-serv-row"); if (row) row.hidden = true; }
  function servRender() { var v = document.getElementById("food-serv-val"); if (v) v.textContent = (servN % 1 ? servN.toFixed(1) : String(servN)); }
  function servApply() {
    if (!servBase) return;
    ["calories", "protein", "carbs", "fat"].forEach(function (kk) {
      var b = servBase[kk];
      els[kk].value = b != null ? Math.round(b * servN * 10) / 10 : "";
    });
    autoFilled = true;   // scaled values are still "ours" to replace on a new pick
  }
  function servStep(d) {
    if (!servBase) servCapture();
    servN = Math.min(10, Math.max(0.5, Math.round((servN + d) * 2) / 2));
    servRender(); servApply();
  }

  function renderRecent() {
    var host = document.getElementById("food-recent");
    if (!host) return;
    // rank by HOW OFTEN you eat it (last 30 days), newest as tiebreak — a
    // daily staple must never fall off the row just because today was varied
    var cutoff = U.todayISO(-30);
    var counts = Object.create(null), newestOf = Object.create(null);
    var arr = S.getAll("food").slice().sort(U.byNewest);
    arr.forEach(function (r) {
      var k = (r.foodName || "").trim().toLowerCase();
      if (!k) return;
      if (r.date >= cutoff) counts[k] = (counts[k] || 0) + 1;
      if (!newestOf[k]) newestOf[k] = r;
    });
    var chips = Object.keys(newestOf)
      .sort(function (a, b) { return (counts[b] || 0) - (counts[a] || 0); })
      .slice(0, 8)
      .map(function (k) { return newestOf[k]; });
    // "Copy yesterday": when today is unlogged and yesterday wasn't, one tap
    // re-logs the whole day — most days eat like the day before.
    var today = U.todayISO(), yday = U.todayISO(-1);
    var all = S.getAll("food");
    var todayHas = all.some(function (r) { return r.date === today; });
    var yCount = all.filter(function (r) { return r.date === yday; }).length;
    var copyBtn = (!todayHas && yCount > 0)
      ? '<div class="recent-chips"><button type="button" class="btn mini" data-copy-yday>' +
        (OF.icons ? OF.icons.get("zap") : "") + " Copy yesterday's meals (" + yCount + ')</button></div>'
      : "";
    host.innerHTML = copyBtn + (chips.length
      ? '<div class="recent-chips recent-scroll"><span class="recent-lbl">Tap to log again:</span>' +
        chips.map(function (r) {
          var nm = U.esc((r.foodName || "").slice(0, 24));
          return '<span class="recent-chip-wrap">' +
            '<button type="button" class="btn mini recent-log" data-recent="' + U.esc(r.id) + '">' + nm + '</button>' +
            '<button type="button" class="btn mini recent-edit" data-recent-edit="' + U.esc(r.id) + '" aria-label="Edit ' + nm + ' before logging" title="Edit before logging">' + (OF.icons ? OF.icons.get("pencil") : "") + ' edit</button>' +
            '</span>';
        }).join("") + '</div>'
      : "");
  }

  function copyYesterday() {
    var today = U.todayISO(), yday = U.todayISO(-1);
    var all = S.getAll("food").filter(function (r) { return r.date === yday; })
      .sort(function (a, b) { return String(a.time).localeCompare(String(b.time)); });
    // only meals already "eaten" by this time of day — copying tonight's
    // dinner at 1pm inflated today's total and double-counted at dinner time
    var now = U.nowTime();
    var meals = all.filter(function (r) { return String(r.time || "") <= now; });
    var skipped = all.length - meals.length;
    if (!meals.length) { U.toast("Yesterday's meals are all later in the day — they'll be one tap away tonight.", "ok"); return; }
    var added = [];
    meals.forEach(function (r) {
      var rec = S.add("food", { date: today, time: r.time, mealType: r.mealType,
        foodName: r.foodName, calories: r.calories, protein: r.protein,
        carbs: r.carbs, fat: r.fat, notes: r.notes || "" });
      if (rec) added.push(rec.id);
    });
    refreshAfterWrite();
    U.toast("Copied " + added.length + " meal" + (added.length === 1 ? "" : "s") + " from yesterday" +
      (skipped ? " (" + skipped + " later meal" + (skipped === 1 ? "" : "s") + " left for tonight)" : "") + " \u2014 edit any that differ.", "ok", {
      label: "Undo",
      fn: function () {
        added.forEach(function (id) { S.remove("food", id); });
        refreshAfterWrite();
      }
    });
  }

  function refreshAfterWrite() {
    renderList();
    renderRecent();
    refreshNameOptions();
    if (OF.dashboard && OF.dashboard.refresh) { try { OF.dashboard.refresh(); } catch (e) {} }
  }

  function onRecentClick(e) {
    if (e.target.closest("[data-copy-yday]")) { copyYesterday(); return; }
    var editBtn = e.target.closest("[data-recent-edit]");
    if (editBtn) {
      // long-press / "edit" affordance: prefill the form instead of logging,
      // for the times a repeat meal needs tweaking (portion, a macro, notes)
      var er = S.get("food", editBtn.getAttribute("data-recent-edit"));
      if (!er) return;
      els.name.value = er.foodName || "";
      els.calories.value = er.calories != null ? er.calories : "";
      els.protein.value = er.protein != null ? er.protein : "";
      els.carbs.value = er.carbs != null ? er.carbs : "";
      els.fat.value = er.fat != null ? er.fat : "";
      if (er.mealType) els.mealType.value = er.mealType;
      els.form.scrollIntoView({ behavior: "smooth", block: "start" });
      els.name.focus();
      return;
    }
    var b = e.target.closest("[data-recent]");
    if (!b) return;
    var r = S.get("food", b.getAttribute("data-recent"));
    if (!r) return;
    // ONE TAP = logged. The #1 ask across user testing: a "Log again" chip
    // should save the meal, not just fill the form. Guess the meal type from
    // the current hour (breakfast tap at dinner = dinner), keep the food +
    // macros, stamp it now, and offer Undo.
    var rec = S.add("food", {
      date: U.todayISO(),
      time: U.nowTime(),
      mealType: guessMealType(),
      foodName: r.foodName,
      calories: r.calories, protein: r.protein, carbs: r.carbs, fat: r.fat,
      notes: ""
    });
    if (!rec) { U.toast("Could not save — storage is full or blocked.", "warn"); return; }
    refreshAfterWrite();
    U.toast("Logged " + (r.foodName || "meal") + ".", "ok", {   // U.toast uses textContent — esc() here double-escaped "&"
      label: "Undo",
      fn: function () { S.remove("food", rec.id); refreshAfterWrite(); }
    });
  }

  function renderList() {
    renderRecent();
    renderSummary();
    var arr = S.getAll("food").slice().sort(U.byNewest);
    if (!arr.length) {
      els.list.innerHTML = '<div class="empty-state">' + OF.icons.badge("apple") +
        '<p>No meals logged yet — a name and rough calories are enough to start.</p></div>';
      return;
    }
    var shown = arr.slice(0, listLimit);
    els.list.innerHTML = shown.map(function (r) {
      var sub = U.fmtDate(r.date) + " " + r.time + (macroLine(r) ? " · " + macroLine(r) : "") +
        (r.notes ? " · " + r.notes : "");
      return '<div class="entry" data-id="' + U.esc(r.id) + '" role="button" tabindex="0" title="Tap to edit">' +
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
    }).join("") + (arr.length > listLimit
      ? '<button type="button" class="btn list-more" data-act="show-more">Show ' + Math.min(50, arr.length - listLimit) + ' more (' + (arr.length - listLimit) + ' older)</button>'
      : "");
  }

  return { init: init, renderList: renderList };
})();

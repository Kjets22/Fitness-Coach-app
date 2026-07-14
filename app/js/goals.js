/* ============================================================
   goals.js — goal setup UI + "Your goal" card (top of Insights),
   the adaptive-loop runner, and the coach-context summary.

   Storage:
     "goal"        — single active goal record (last one wins)
     "adjustments" — append-only adaptation log
   All math lives in targets-engine.js (pure); this file owns DOM
   and persistence. Every piece of interpolated text goes through
   U.esc().
   ============================================================ */

window.OF = window.OF || {};

OF.goals = (function () {
  "use strict";
  var U = OF.util, S = OF.storage;

  var area = null;
  var editing = false;

  /* ---------------- data accessors ---------------- */

  function activeGoal() {
    var arr = S.getAll("goal");
    if (!arr.length) return null;
    // Single active goal: the most recently created record wins.
    return arr.slice().sort(function (a, b) {
      return (a.createdAt || "") < (b.createdAt || "") ? -1 : 1;
    })[arr.length - 1];
  }

  function calorieAdjs() {
    return S.getAll("adjustments")
      .filter(function (r) { return r && r.kind === "calories" && isFinite(Number(r.delta)); })
      .sort(function (a, b) { return (a.date || "") < (b.date || "") ? -1 : 1; });
  }

  function adjTotal() {
    return calorieAdjs().reduce(function (n, r) { return n + Number(r.delta); }, 0);
  }

  function exerciseMinToday() {
    var today = U.todayISO();
    return S.getAll("exercise").reduce(function (n, r) {
      return n + (r.date === today && isFinite(Number(r.durationMin)) ? Number(r.durationMin) : 0);
    }, 0);
  }

  /** Current daily targets for the active goal (or null / no-weight state). */
  function currentTargets() {
    var goal = activeGoal();
    if (!goal) return null;
    // Body fat: a measured Body-record % always wins; else fall back to the
    // latest physique-photo estimate (labeled so nothing is double-counted).
    var bf = OF.targets.effectiveBodyFat(S.getAll("body"), S.getAll("physique"));
    return OF.targets.computeTargets(goal, {
      weightKg: OF.targets.latestWeightKg(S.getAll("body")),
      exerciseMinToday: exerciseMinToday(),
      adjTotal: adjTotal(),
      bodyFatPct: bf ? bf.pct : null,
      bodyFatSource: bf ? bf.source : null
    });
  }

  /** Everything the insight cards need, computed once. */
  function info() {
    var goal = activeGoal();
    if (!goal) return { goal: null, targets: null, progress: null };
    var body = S.getAll("body");
    return {
      goal: goal,
      targets: currentTargets(),
      progress: OF.targets.goalProgress(goal, body)
    };
  }

  /* ---------------- adaptive loop ---------------- */

  function adaptReason(goal, a) {
    var t = OF.targets.GOAL_TYPES[goal.type];
    var obs = Math.abs(a.obsWeeklyKg) < 0.05
      ? "Your weight held steady"
      : "You " + (a.obsWeeklyKg > 0 ? "gained" : "lost") + " " +
        Math.abs(U.toDisplayWeight(a.obsWeeklyKg)) + " " + U.weightUnit() + "/week";
    var target = Math.abs(a.targetWeeklyKg) < 0.05
      ? "steady weight"
      : U.fmtWeightDelta(a.targetWeeklyKg) + "/week";
    return obs + " over the last 4 weeks, but your " + t.label.toLowerCase() +
      " target is " + target + " — calories " +
      (a.deltaCal > 0 ? "+" : "") + a.deltaCal + ".";
  }

  /**
   * Catch-up adaptation: evaluate weekly checkpoints from goal start
   * (+14 days) to today, each using only data available at that point.
   * Fired adjustments persist to the "adjustments" log and feed the
   * next checkpoint, so a long history (e.g. demo data) produces a
   * realistic multi-entry log in one pass. Max one adjustment / 7 days.
   */
  function runAdaptation() {
    var goal = activeGoal();
    if (!goal) return;
    var T = OF.targets;
    var food = S.getAll("food");
    var body = S.getAll("body");
    var adjs = calorieAdjs();
    var total = adjs.reduce(function (n, r) { return n + Number(r.delta); }, 0);

    var todayDn = T.dayNum(U.todayISO());
    var startDn = T.dayNum(goal.date);
    if (startDn == null) startDn = todayDn;
    var lastDn = adjs.length ? T.dayNum(adjs[adjs.length - 1].date) : null;

    var p = startDn + 14;
    if (lastDn != null && lastDn + T.ADJ_STEP_DAYS > p) p = lastDn + T.ADJ_STEP_DAYS;
    // Never replay months of history: the 30-iteration guard covers ~30 weeks,
    // so a goal with no adjustments for longer than that would re-walk the same
    // ancient windows every run and NEVER reach the present (adaptation starved
    // forever). Ancient windows can't usefully fire today anyway — clamp the
    // catch-up to the last ~8 weeks.
    var floorDn = todayDn - 8 * T.ADJ_STEP_DAYS;
    if (p < floorDn) p = floorDn;

    var guard = 0;
    while (p <= todayDn && guard++ < 30) {
      var pIso = T.isoFromDayNum(p);
      var foodF = food.filter(function (r) {
        var dn = T.dayNum(r.date); return dn != null && dn <= p;
      });
      var bodyF = body.filter(function (r) {
        var dn = T.dayNum(r.date); return dn != null && dn <= p;
      });
      var a = T.computeAdaptation(foodF, bodyF, goal, pIso, total);
      if (a.ready && a.fire) {
        var kgAt = T.latestWeightKg(bodyF);
        var before = T.computeTargets(goal, { weightKg: kgAt, adjTotal: total });
        var after = T.computeTargets(goal, { weightKg: kgAt, adjTotal: total + a.deltaCal });
        var rec = S.add("adjustments", {
          date: pIso,
          kind: "calories",
          delta: a.deltaCal,
          from: before && before.status === "ok" ? before.calories : null,
          to: after && after.status === "ok" ? after.calories : null,
          reason: adaptReason(goal, a)
        });
        if (!rec) return; // storage failed — don't loop on it
        total += a.deltaCal;
      }
      p += T.ADJ_STEP_DAYS;
    }
  }

  /* ---------------- rendering helpers ---------------- */

  function e(s) { return U.esc(s); }

  function fmtDateShort(iso) { return U.fmtDate(iso); }

  function chip(text, cls) {
    return '<span class="conf ' + cls + '">' + e(text) + '</span>';
  }

  function goalHeadline(goal) {
    var t = OF.targets.GOAL_TYPES[goal.type];
    if (!t) return "Goal (" + String(goal.type || "unknown") + ")";   // imported backups can carry unknown types — never crash the Insights render
    var head = t.label;
    if (goal.targetAmountKg) {
      var amt = U.fmtWeight(goal.targetAmountKg);
      head += " — " + (t.dir >= 0 ? "gain " : "lose ") + amt +
        (t.metric === "muscle" ? " of muscle" : "");
    }
    if (goal.targetDate) head += " by " + fmtDateShort(goal.targetDate);
    return head;
  }

  /* ---------------- "Your goal" card ---------------- */

  function goalCardHtml(goal) {
    var T = OF.targets;
    var t = T.GOAL_TYPES[goal.type];
    var targets = currentTargets();
    var progress = T.goalProgress(goal, S.getAll("body"));
    var reality = T.realityCheck(goal, progress);
    var adjs = calorieAdjs();
    var live = T.computeAdaptation(S.getAll("food"), S.getAll("body"), goal,
      U.todayISO(), adjTotal());

    var html = '<div class="card insight-card goal-card">';
    html += '<div class="insight-head"><h2>Your goal</h2>';
    if (progress && progress.status === "ok" && progress.onTrack != null) {
      html += chip(progress.onTrack ? "on track" : "behind pace",
        progress.onTrack ? "conf-high" : "conf-medium");
    }
    html += '</div>';
    html += '<p class="insight-headline">' + e(goalHeadline(goal)) + '</p>';

    /* progress */
    if (progress && progress.status === "ok") {
      if (progress.targetKg != null) {
        var achieved = U.fmtWeightDelta(t.dir * Math.max(0, progress.achievedKg));
        var targetTxt = U.fmtWeightDelta(t.dir * progress.targetKg);
        var what = progress.metric === "muscle" ? "muscle" : "weight";
        var ringColor = progress.onTrack === false ? "var(--warn)" : "var(--accent-2)";
        html += '<div class="goal-progress-flex">' +
          U.progressRing(progress.pct, {
            size: 72, color: ringColor,
            value: Math.round(progress.pct * 100) + "%"
          }) +
          '<div style="flex:1;min-width:0">' +
          '<p class="goal-progress-line">' +
          e(achieved + " of " + targetTxt + " " + what +
            (progress.usedFallback ? " (using body weight — log muscle mass on the Body tab for a sharper number)" : "") +
            " since " + fmtDateShort(progress.baseDate)) + '</p>' +
          U.progressBar(progress.pct, ringColor) +
          '</div></div>';
        if (progress.reached) {
          html += '<p class="goal-note good">Target reached — set a new goal or switch to maintain.</p>';
        } else if (progress.projectedDate) {
          html += '<p class="goal-note">' +
            e("At your current rate (" + U.fmtWeightDelta(progress.ratePerWeekKg) +
              "/week) you'd get there around " + fmtDateShort(progress.projectedDate) + ".") + '</p>';
        } else if (progress.ratePerWeekKg != null && t.dir * progress.ratePerWeekKg <= 0.01) {
          html += '<p class="goal-note">' +
            e("Your " + (progress.metric === "muscle" ? "muscle" : "weight") +
              " isn't moving toward the goal yet — the plan below is built to change that.") + '</p>';
        }
      } else {
        html += '<p class="goal-note">' +
          e((progress.metric === "muscle" ? "Muscle" : "Weight") + " change since " +
            fmtDateShort(progress.baseDate) + ": " + U.fmtWeightDelta(progress.deltaKg) +
            (t.dir === 0 ? " (goal: keep it steady)" : "")) + '</p>';
      }
    } else {
      html += '<p class="goal-note muted">No body measurements yet — log your weight on the Body tab to start tracking progress.</p>';
    }

    /* honesty check */
    if (reality && reality.unrealistic) {
      var kindTxt = reality.kind === "muscle"
        ? "Natural muscle gain tops out around " + U.fmtWeight(reality.maxKgWk) +
          "/week for beginners (less when you're already lean)"
        : "Losing faster than about " + U.fmtWeight(reality.maxKgWk) +
          "/week usually costs muscle and doesn't stick";
      // neededKgWk is null when the target date is already in the past
      // (weeksLeft <= 0) — say that instead of rendering "?/week" (QA-3).
      var timelineTxt = reality.neededKgWk != null
        ? "reaching the remaining " + U.fmtWeight(reality.remainingKg) + " by " +
          fmtDateShort(goal.targetDate) + " would take " +
          U.fmtWeight(reality.neededKgWk) + "/week. "
        : "your target date (" + fmtDateShort(goal.targetDate) +
          ") has already passed with " + U.fmtWeight(reality.remainingKg) +
          " still to go. ";
      html += '<div class="goal-reality">' +
        e("A heads-up on the timeline: " + timelineTxt + kindTxt +
          ". A realistic finish is around " + fmtDateShort(reality.realisticDate) +
          " — the targets below aim for that healthy pace.") + '</div>';
    }

    /* daily targets */
    if (targets && targets.status === "ok") {
      html += '<div class="chart-mini-label">Daily targets</div><div class="insight-sub">';
      html += '<span class="mini-stat">' + e(targets.calories + " kcal") + '</span>';
      html += '<span class="mini-stat">' + e("protein " + targets.proteinG + "g") + '</span>';
      html += '<span class="mini-stat">' + e("fat " + targets.fatG + "g") + '</span>';
      html += '<span class="mini-stat">' + e("carbs " + targets.carbsG + "g") + '</span>';
      html += '<span class="mini-stat">' + e("water " + U.fmtWater(targets.waterMl)) + '</span>';
      html += '<span class="mini-stat">' + e(targets.steps + " steps") + '</span>';
      html += '<span class="mini-stat">' + e("sleep " + targets.sleepH + "h") + '</span>';
      if (targets.weeklyTargetKg) {
        html += '<span class="mini-stat">' + e("weight " + U.fmtWeightDelta(targets.weeklyTargetKg) + "/wk") + '</span>';
      }
      html += '</div>';
      var maintTxt;
      if (live.ready) {
        maintTxt = "Estimated maintenance: ~" + live.blendedMaintenance +
          " kcal (learned from your last 4 weeks of logging; formula says " +
          targets.maintenanceKcal + ").";
        if (targets.adjTotal) {
          maintTxt += " Includes " + (targets.adjTotal > 0 ? "+" : "") + targets.adjTotal +
            " kcal of adaptive adjustments.";
        }
      } else {
        maintTxt = "Maintenance estimate: ~" + targets.maintenanceKcal + " kcal (" +
          (targets.maintenanceMethod === "mifflin"
            ? "Mifflin-St Jeor from your profile"
            : "33 kcal/kg — add height, age and activity for a sharper estimate") + "). " +
          live.message;
      }
      html += '<p class="goal-note muted small">' + e(maintTxt) + '</p>';
    } else if (targets && targets.status === "no-weight") {
      html += '<div class="goal-reality">' + e(targets.message) + '</div>';
    }

    /* adaptation log (last 3, newest first) */
    if (adjs.length) {
      var last3 = adjs.slice(-3).reverse();
      html += '<div class="chart-mini-label">Coach adjustments</div><ul class="adj-log">';
      last3.forEach(function (a) {
        var head = fmtDateShort(a.date) +
          (a.from != null && a.to != null ? " · " + a.from + " → " + a.to + " kcal" : "");
        html += '<li><strong>' + e(head) + '</strong> ' + e(a.reason || "") + '</li>';
      });
      html += '</ul>';
    } else if (live.ready && !live.fire) {
      html += '<p class="goal-note muted small">' +
        e("Adaptive coach: on pace (" + U.fmtWeightDelta(live.obsWeeklyKg) +
          "/week observed vs " + U.fmtWeightDelta(live.targetWeeklyKg) +
          "/week target) — no calorie change needed right now.") + '</p>';
    }

    html += '<div class="form-actions">' +
      '<button type="button" class="btn mini" id="goal-edit">Edit goal</button>' +
      '<button type="button" class="btn mini danger" id="goal-delete">Remove goal</button>' +
      '</div>';
    html += '</div>';
    return html;
  }

  /* ---------------- setup / edit form ---------------- */

  function amountLabelFor(type) {
    var wu = U.weightUnit();
    if (type === "cut") return "Weight to lose (" + wu + ")";
    return "Muscle to gain (" + wu + ")";
  }

  function setupCardHtml(goal) {
    var T = OF.targets;
    var types = Object.keys(T.GOAL_TYPES);
    var g = goal || {};
    var hasAmount = g.type === "lean-bulk" || g.type === "cut" || !g.type;
    var wu = U.weightUnit(), hu = U.heightUnit();

    var html = '<div class="card goal-card"><h2>' +
      (goal ? 'Edit your goal' : 'Set a goal') + '</h2>';
    if (!goal) {
      html += '<p class="muted">Pick what you want your body to do and the app turns every ' +
        'tracker into a personal plan: daily calorie, protein, water and step targets that ' +
        'adapt as it learns how YOUR body responds. Everything is optional except the goal itself.</p>';
    }
    html += '<form id="goal-form" novalidate>';
    html += '<div class="form-row"><label class="grow">Goal' +
      '<select id="gf-type">' + types.map(function (k) {
        return '<option value="' + e(k) + '"' + (g.type === k ? " selected" : "") + '>' +
          e(T.GOAL_TYPES[k].label) + '</option>';
      }).join("") + '</select></label>';
    html += '<label id="gf-amount-label"' + (hasAmount ? '' : ' class="hidden"') + '>' +
      '<span id="gf-amount-text">' + e(amountLabelFor(g.type || "lean-bulk")) + '</span>' +
      '<input type="number" id="gf-amount" min="0" max="500" step="0.5" placeholder="optional" value="' +
      (g.targetAmountKg ? e(U.toDisplayWeight(g.targetAmountKg)) : '') + '"></label>';
    html += '<label>Target date<input type="date" id="gf-date" value="' +
      e(g.targetDate || "") + '"></label></div>';

    html += '<div class="chart-mini-label">About you (optional — sharpens the calorie math)</div>';
    html += '<div class="form-row">';
    if (hu === "in") {
      // imperial: a feet + inches pair reads far more naturally than raw inches
      var totIn = g.heightCm ? Number(U.toDisplayHeight(g.heightCm)) : null;
      var ftVal = "", inVal = "";
      if (totIn != null && !isNaN(totIn)) {
        ftVal = Math.floor(totIn / 12);
        inVal = Math.round((totIn - ftVal * 12) * 2) / 2;
        if (inVal >= 12) { ftVal += 1; inVal = 0; }
      }
      html += '<label>Height<span class="ftin">' +
        '<input type="number" id="gf-height-ft" min="0" max="8" step="1" inputmode="numeric" placeholder="5" value="' + e(ftVal) + '" aria-label="Height, feet"><span class="ftin-unit">ft</span>' +
        '<input type="number" id="gf-height-in" min="0" max="11.5" step="0.5" inputmode="decimal" placeholder="10" value="' + e(inVal) + '" aria-label="Height, inches"><span class="ftin-unit">in</span>' +
        '</span></label>';
    } else {
      html += '<label>Height (' + e(hu) + ')<input type="number" id="gf-height" min="0" max="300" step="0.5" placeholder="optional" value="' +
        (g.heightCm ? e(U.toDisplayHeight(g.heightCm)) : '') + '"></label>';
    }
    html += '<label>Age<input type="number" id="gf-age" min="10" max="100" step="1" placeholder="optional" value="' +
      (g.age != null ? e(g.age) : '') + '"></label>';
    html += '<label>Sex<select id="gf-sex">' +
      '<option value=""' + (!g.sex ? ' selected' : '') + '>prefer not to say</option>' +
      '<option value="m"' + (g.sex === "m" ? ' selected' : '') + '>male</option>' +
      '<option value="f"' + (g.sex === "f" ? ' selected' : '') + '>female</option>' +
      '</select></label>';
    html += '<label class="grow">Activity level<select id="gf-activity">' +
      '<option value=""' + (!g.activity ? ' selected' : '') + '>not sure</option>' +
      Object.keys(T.ACTIVITY).map(function (k) {
        return '<option value="' + e(k) + '"' + (g.activity === k ? ' selected' : '') + '>' +
          e(T.ACTIVITY[k].label) + '</option>';
      }).join("") + '</select></label>';
    html += '</div>';
    html += '<p class="form-error" id="gf-error" hidden></p>';
    html += '<div class="form-actions">' +
      '<button type="submit" class="btn primary">' + (goal ? 'Save goal' : 'Create goal') + '</button>' +
      (goal ? '<button type="button" class="btn ghost" id="goal-cancel">Cancel</button>' : '') +
      '</div></form></div>';
    return html;
  }

  /* ---------------- events ---------------- */

  function showFormError(msg) {
    var el = document.getElementById("gf-error");
    if (el) { el.textContent = msg; el.hidden = !msg; }
  }

  function onTypeChange() {
    var sel = document.getElementById("gf-type");
    var lbl = document.getElementById("gf-amount-label");
    var txt = document.getElementById("gf-amount-text");
    if (!sel || !lbl) return;
    var type = sel.value;
    var hasAmount = type === "lean-bulk" || type === "cut";
    lbl.classList.toggle("hidden", !hasAmount);
    if (txt) txt.textContent = amountLabelFor(type);
  }

  function onSave(evt) {
    evt.preventDefault();
    var T = OF.targets;
    var existing = activeGoal();
    var type = (document.getElementById("gf-type") || {}).value;
    if (!T.GOAL_TYPES[type]) { showFormError("Pick a goal type."); return; }
    var hasAmount = type === "lean-bulk" || type === "cut";

    var amtRaw = U.numOrNull((document.getElementById("gf-amount") || {}).value);
    // only validate the amount when the field is actually shown for this goal
    // type — a leftover value in the HIDDEN field must not block saving
    if (hasAmount && amtRaw !== null && (isNaN(amtRaw) || amtRaw < 0 || amtRaw > 500)) {
      showFormError("Target amount must be a positive number."); return;
    }
    var targetAmountKg = hasAmount && amtRaw ? Math.round(U.fromDisplayWeight(amtRaw) * 100) / 100 : null;

    var targetDate = (document.getElementById("gf-date") || {}).value || null;
    // enforce "future" only when the date CHANGED — editing another field of a
    // goal whose date already passed must not be blocked by the old prefill
    if (targetDate && targetDate <= U.todayISO() &&
        !(existing && existing.targetDate === targetDate)) {
      showFormError("Target date needs to be in the future."); return;
    }

    var hRaw;
    var ftEl = document.getElementById("gf-height-ft");
    if (ftEl) {
      // imperial pair: combine feet + inches into total inches (either field
      // alone is fine — "5 ft" empty-inches means 5 ft 0 in)
      var ftRaw = U.numOrNull(ftEl.value);
      var inRaw = U.numOrNull((document.getElementById("gf-height-in") || {}).value);
      if ((ftRaw !== null && isNaN(ftRaw)) || (inRaw !== null && isNaN(inRaw))) {
        showFormError("Height must be a number."); return;
      }
      if (inRaw !== null && (inRaw < 0 || inRaw >= 12)) {
        showFormError("Inches must be between 0 and 11.5 — carry the rest into feet."); return;
      }
      hRaw = ftRaw === null && inRaw === null ? null : (ftRaw || 0) * 12 + (inRaw || 0);
    } else {
      hRaw = U.numOrNull((document.getElementById("gf-height") || {}).value);
      if (hRaw !== null && isNaN(hRaw)) { showFormError("Height must be a number."); return; }
    }
    // 0.1 cm precision: whole-cm storage is coarser than the 0.1-in display
    // grid, so inch entries visibly shifted on save (70.0 -> 70.1)
    var heightCm = hRaw !== null ? Math.round(U.fromDisplayHeight(hRaw) * 10) / 10 : null;
    if (heightCm !== null && (heightCm < 90 || heightCm > 250)) {
      showFormError("Height looks off — expected " +
        (U.heightUnit() === "in" ? "3 ft 0 in to 8 ft 2 in" : "90-250 cm") + "."); return;
    }
    var age = U.numOrNull((document.getElementById("gf-age") || {}).value);
    if (age !== null && (isNaN(age) || age < 10 || age > 100)) {
      showFormError("Age must be between 10 and 100."); return;
    }
    var sex = (document.getElementById("gf-sex") || {}).value || null;
    var activity = (document.getElementById("gf-activity") || {}).value || null;

    var rec = {
      date: existing ? existing.date : U.todayISO(),
      type: type,
      targetAmountKg: targetAmountKg,
      targetDate: targetDate,
      heightCm: heightCm,
      age: age !== null ? Math.round(age) : null,
      sex: sex === "m" || sex === "f" ? sex : null,
      activity: activity
    };

    var ok;
    if (existing) {
      // Changing goal TYPE resets the adaptation history (old calorie
      // nudges belonged to the old goal) and restarts progress from today.
      if (existing.type !== type) {
        clearAdjustments();
        rec.date = U.todayISO();
      }
      ok = S.update("goal", existing.id, rec);
    } else {
      ok = S.add("goal", rec);
    }
    if (!ok) { showFormError("Could not save — browser storage is full or blocked."); return; }

    editing = false;
    refresh();
    if (OF.insights) OF.insights.refresh();
    if (OF.dashboard) OF.dashboard.refresh();
  }

  function clearAdjustments() {
    S.getAll("adjustments").forEach(function (r) { S.remove("adjustments", r.id); });
  }

  function onAreaClick(evt) {
    var tgt = evt.target;
    if (tgt.id === "goal-edit") {
      editing = true;
      render();
    } else if (tgt.id === "goal-cancel") {
      editing = false;
      render();
    } else if (tgt.id === "goal-delete") {
      if (!confirm("Remove your goal? The adaptation history is cleared too. Your tracked data is untouched.")) return;
      var g = activeGoal();
      if (g) S.remove("goal", g.id);
      clearAdjustments();
      editing = false;
      refresh();
      if (OF.insights) OF.insights.refresh();
      if (OF.dashboard) OF.dashboard.refresh();
    }
  }

  /* ---------------- coach context ---------------- */

  /** Compact goal block for the AI coach (kept well under 1.5 KB). */
  function coachContext() {
    var goal = activeGoal();
    if (!goal) return null;
    var T = OF.targets;
    var targets = currentTargets();
    var progress = T.goalProgress(goal, S.getAll("body"));
    var adjs = calorieAdjs();
    var live = T.computeAdaptation(S.getAll("food"), S.getAll("body"), goal,
      U.todayISO(), adjTotal());

    var out = { goal: goalHeadline(goal), goalType: goal.type, startedAt: goal.date };
    var profile = {};
    if (goal.heightCm) profile.heightCm = goal.heightCm;
    if (goal.age) profile.age = goal.age;
    if (goal.sex) profile.sex = goal.sex;
    if (goal.activity) profile.activity = goal.activity;
    if (Object.keys(profile).length) out.profile = profile;

    if (targets && targets.status === "ok") {
      out.dailyTargets = {
        kcal: targets.calories, proteinG: targets.proteinG, fatG: targets.fatG,
        carbsG: targets.carbsG, waterMl: targets.waterMl, steps: targets.steps,
        sleepH: targets.sleepH, weeklyWeightChangeKg: targets.weeklyTargetKg
      };
      out.maintenanceKcal = {
        formula: targets.maintenanceKcal,
        learnedFromData: live.ready ? live.blendedMaintenance : null,
        adaptiveAdjustmentTotal: targets.adjTotal
      };
      if (targets.bodyFatPct != null) {
        out.bodyFat = {
          pct: targets.bodyFatPct,
          source: targets.bodyFatSource, // "measured" | "photo" (estimate)
          leanMassKg: targets.leanMassKg
        };
      }
    } else if (targets) {
      out.dailyTargets = "unavailable: " + targets.message;
    }

    if (progress && progress.status === "ok") {
      var p = { metric: progress.metric, changeKg: progress.deltaKg, since: progress.baseDate };
      if (progress.targetKg != null) {
        p.targetKg = progress.targetKg;
        p.pctDone = Math.round((progress.pct || 0) * 100);
        if (progress.projectedDate) p.projectedCompletion = progress.projectedDate;
        if (progress.onTrack != null) p.onTrack = progress.onTrack;
      }
      if (progress.ratePerWeekKg != null) p.ratePerWeekKg = progress.ratePerWeekKg;
      out.progress = p;
    }

    if (live.ready) {
      out.observedVsTarget = {
        obsWeeklyKg: live.obsWeeklyKg,
        targetWeeklyKg: live.targetWeeklyKg,
        avgDailyKcalLogged: live.avgKcal
      };
    }
    if (adjs.length) {
      out.recentAdjustments = adjs.slice(-3).map(function (a) {
        return { date: a.date, deltaKcal: a.delta, reason: a.reason };
      });
    }
    return out;
  }

  /* ---------------- lifecycle ---------------- */

  function render() {
    if (!area) return;
    var goal = activeGoal();
    area.innerHTML = (editing || !goal) ? setupCardHtml(goal) : goalCardHtml(goal);
  }

  /** Run the adaptive loop, then re-render the goal area. */
  function refresh() {
    runAdaptation();
    render();
  }

  function init() {
    area = document.getElementById("goal-area");
    if (!area) return;
    area.addEventListener("click", onAreaClick);
    area.addEventListener("submit", function (evt) {
      if (evt.target && evt.target.id === "goal-form") onSave(evt);
    });
    area.addEventListener("change", function (evt) {
      if (evt.target && evt.target.id === "gf-type") onTypeChange();
    });
    runAdaptation(); // catch up before dashboard/insights first render
  }

  return {
    init: init,
    refresh: refresh,
    render: render,
    activeGoal: activeGoal,
    currentTargets: currentTargets,
    info: info,
    adjTotal: adjTotal,
    calorieAdjs: calorieAdjs,
    runAdaptation: runAdaptation,
    coachContext: coachContext
  };
})();

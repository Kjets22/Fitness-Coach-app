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

  /* ---- engine autonomy (how much the adaptive loop may change alone) ----
     Stored in the shared prefs blob so it round-trips with backups. */
  function autonomy() {
    var v = null;
    try { v = OF.units ? OF.units.prefs().engineAutonomy : null; } catch (e) {}
    return OF.targets.AUTONOMY_LEVELS.indexOf(v) >= 0 ? v : "balanced";
  }
  function setAutonomy(v) {
    if (OF.targets.AUTONOMY_LEVELS.indexOf(v) < 0) return false;
    try { if (OF.units) OF.units.setPrefs({ engineAutonomy: v }); } catch (e) { return false; }
    refresh();
    return true;
  }

  /* Proposals live in the SAME store as applied adjustments but under a
     distinct kind, so calorieAdjs()/adjTotal() (which match kind
     "calories") can never drift on a suggestion the user never accepted —
     and they still round-trip through backup/restore and cloud sync.
     (storage.js enforces a type whitelist; inventing a new type would
     throw and take the whole goal card down with it.) */
  var PROPOSAL_KIND = "calories-proposal";
  function proposals() {
    return S.getAll("adjustments").filter(function (r) {
      return r && r.kind === PROPOSAL_KIND;
    });
  }
  function pendingAdapt() {
    var all = proposals().filter(function (r) { return r.status === "pending"; });
    return all.length ? all[all.length - 1] : null;
  }
  /* A declined retune must not come straight back on the next run: the
     engine waits a full adaptation step before re-testing that idea. */
  function adaptBlockedUntilDn() {
    var dn = null;
    proposals().forEach(function (r) {
      if (r.status === "declined" && r.blockUntilDayNum != null) {
        var v = Number(r.blockUntilDayNum);
        if (isFinite(v) && (dn == null || v > dn)) dn = v;
      }
    });
    return dn;
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
      engineAutonomy: autonomy(),
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
        // the user pushed back on a recent retune — hold off re-testing it
        var blocked = adaptBlockedUntilDn();
        if (blocked != null && p <= blocked) { p += T.ADJ_STEP_DAYS; continue; }
        var decision = T.adaptationDecision(a.deltaCal, autonomy());
        if (decision === "propose") {
          // one open proposal at a time; don't stack them up
          if (!pendingAdapt()) {
            var kgP = T.latestWeightKg(bodyF);
            var beforeP = T.computeTargets(goal, { weightKg: kgP, adjTotal: total });
            var afterP = T.computeTargets(goal, { weightKg: kgP, adjTotal: total + a.deltaCal });
            S.add("adjustments", {
              date: pIso, status: "pending", kind: PROPOSAL_KIND, delta: a.deltaCal,
              from: beforeP && beforeP.status === "ok" ? beforeP.calories : null,
              to: afterP && afterP.status === "ok" ? afterP.calories : null,
              reason: adaptReason(goal, a)
            });
          }
          p += T.ADJ_STEP_DAYS;
          continue;
        }
        var kgAt = T.latestWeightKg(bodyF);
        var before = T.computeTargets(goal, { weightKg: kgAt, adjTotal: total });
        var after = T.computeTargets(goal, { weightKg: kgAt, adjTotal: total + a.deltaCal });
        var rec = S.add("adjustments", {
          date: pIso,
          kind: "calories",
          auto: true,              // applied by the engine, not by the user
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

  /* ---------------- three-tier goal display ----------------
     LONG-TERM  = the goal hero (headline + big ring + pace)
     MILESTONES = derived checkpoints (OF.targets.goalMilestones)
     DAILY      = today's live numbers vs targets, tappable    */

  /** Today's logged numbers vs targets — the DAILY goal tier. */
  function dailyGoals(targets) {
    if (!targets || targets.status !== "ok") return [];
    var today = U.todayISO();
    function sumToday(type, field) {
      return S.getAll(type).reduce(function (n, r) {
        return n + (r.date === today && isFinite(Number(r[field])) ? Number(r[field]) : 0);
      }, 0);
    }
    var stepsRec = S.getAll("steps").filter(function (r) { return r.date === today; })[0];
    var sleepRec = S.getAll("sleep").filter(function (r) { return r.date === today; })[0];
    var sleepH = sleepRec && isFinite(Number(sleepRec.durationMin))
      ? Math.round(Number(sleepRec.durationMin) / 6) / 10 : 0;
    return [
      { key: "kcal", label: "Calories", val: Math.round(sumToday("food", "calories")),
        target: targets.calories, unit: "kcal", tab: "food" },
      { key: "protein", label: "Protein", val: Math.round(sumToday("food", "protein")),
        target: targets.proteinG, unit: "g", tab: "food" },
      { key: "water", label: "Water", val: sumToday("water", "amountMl"),
        target: targets.waterMl, unit: "ml", tab: "daily" },
      { key: "steps", label: "Steps", val: stepsRec ? Number(stepsRec.count) || 0 : 0,
        target: targets.steps, unit: "", tab: "daily" },
      { key: "sleep", label: "Sleep", val: sleepH, target: targets.sleepH, unit: "h", tab: "sleep" }
    ];
  }

  function dailyGoalsHtml(targets) {
    var items = dailyGoals(targets);
    if (!items.length) return "";
    var done = items.filter(function (it) {
      return it.target > 0 && it.val / it.target >= 1;
    }).length;
    var html = '<div class="chart-mini-label">Today&rsquo;s goals ' +
      '<span class="day-goals-score">' + done + '/' + items.length + '</span></div>' +
      '<div class="day-goals">';
    items.forEach(function (it) {
      var frac = it.target > 0 ? Math.min(1, it.val / it.target) : 0;
      var isDone = frac >= 1;
      var valTxt = it.key === "water" ? U.fmtWater(it.val) : String(it.val);
      var subTxt = it.key === "water" ? "of " + U.fmtWater(it.target)
        : "of " + it.target + (it.unit ? " " + it.unit : "");
      html += '<button type="button" class="day-goal' + (isDone ? " done" : "") +
        '" data-day-nav="' + e(it.tab) + '" aria-label="' +
        e(it.label + ": " + valTxt + ", " + subTxt + (isDone ? ", goal met" : "")) + '">' +
        U.progressRing(frac, { size: 46, stroke: 5,
          color: isDone ? "var(--accent-2)" : "grad",
          value: Math.round(frac * 100) + "%", label: it.label + " progress" }) +
        '<span class="day-goal-lbl">' + (isDone ? OF.icons.get("check") : "") + e(it.label) + '</span>' +
        '<span class="day-goal-sub">' + e(valTxt) + ' <em>' + e(subTxt) + '</em></span></button>';
    });
    return html + '</div>';
  }

  /** THIS WEEK tier — training is a weekly-frequency behavior (a daily
      "train" tile falsely reads as failure on planned rest days). Target
      comes from the training program's days/week, else activity level. */
  function weeklyDaysTarget(goal) {
    try {
      var p = OF.profile && OF.profile.get ? OF.profile.get() : null;
      var d = p && p.prefs ? Number(p.prefs.daysPerWeek) : NaN;
      if (isFinite(d) && d >= 1 && d <= 7) return Math.round(d);
    } catch (e) { /* profile absent */ }
    var map = { sedentary: 2, light: 3, moderate: 4, active: 5, "very-active": 6 };
    return (goal && map[goal.activity]) || 3;
  }

  function weeklyGoalsHtml(goal) {
    var ws = OF.targets.weeklyStatus({
      exercise: S.getAll("exercise"),
      body: S.getAll("body"),
      today: U.todayISO(),
      daysPerWeek: weeklyDaysTarget(goal)
    });
    if (!ws) return "";
    var w = ws.workouts, wi = ws.weighIns;
    var wDone = w.done >= w.target, wiDone = wi.done >= wi.target;
    var dots = w.dots.map(function (d2) {
      return '<span class="wk-dot' + (d2.done ? " on" : "") +
        (d2.isToday ? " today" : "") + (d2.future ? " future" : "") + '"></span>';
    }).join("");
    return '<div class="chart-mini-label">This week</div><div class="week-goals">' +
      '<button type="button" class="day-goal week-goal' + (wDone ? " done" : "") +
        '" data-day-nav="exercise" aria-label="' +
        e("Workouts: " + w.done + " of " + w.target + " this week" + (wDone ? ", goal met" : "")) + '">' +
        U.progressRing(Math.min(1, w.target ? w.done / w.target : 0), { size: 46, stroke: 5,
          color: wDone ? "var(--accent-2)" : "grad",
          value: w.done + "/" + w.target, label: "Workouts this week" }) +
        '<span class="day-goal-lbl">' + (wDone ? OF.icons.get("check") : "") + 'Workouts</span>' +
        '<span class="wk-dots" aria-hidden="true">' + dots + '</span>' +
        '<span class="day-goal-sub">' + e(wDone ? "week goal met — rest is part of the plan"
          : (w.target - w.done) + " to go · any day this week") + '</span></button>' +
      '<button type="button" class="day-goal week-goal' + (wiDone ? " done" : "") +
        '" data-day-nav="body" aria-label="' +
        e("Weigh-ins: " + wi.done + " of " + wi.target + " this week" + (wiDone ? ", goal met" : "")) + '">' +
        U.progressRing(Math.min(1, wi.done / wi.target), { size: 46, stroke: 5,
          color: wiDone ? "var(--accent-2)" : "grad",
          value: wi.done + "/" + wi.target, label: "Weigh-ins this week" }) +
        '<span class="day-goal-lbl">' + (wiDone ? OF.icons.get("check") : "") + 'Weigh-ins</span>' +
        '<span class="day-goal-sub">' + e(wiDone ? "trend data topped up"
          : "keeps your trend accurate") + '</span></button>' +
      '</div>';
  }

  /** Derived checkpoint timeline — the INTERMEDIATE goal tier. */
  function milestonesHtml(goal) {
    var ms = OF.targets.goalMilestones(goal, S.getAll("body"));
    if (!ms || !ms.items.length) return "";
    var html = '<div class="chart-mini-label">Milestones</div><div class="ms-track">';
    ms.items.forEach(function (m, i) {
      var lbl = ms.mode === "amount"
        ? U.fmtWeightDelta((m.dir < 0 ? -1 : 1) * m.kg)
        : m.weeks + " wk";
      var sub = ms.mode === "amount" ? "~" + fmtDateShort(m.whenIso) : "on plan";
      var info = m.state === "done" ? lbl + " — milestone reached!"
        : m.state === "current" ? lbl + " is your next milestone (" + sub + ")"
        : lbl + " comes after that (" + sub + ")";
      html += '<button type="button" class="ms-step ms-' + m.state + '" data-ms-info="' +
        e(info) + '" aria-label="' + e("Milestone " + (i + 1) + ": " + info) + '">' +
        '<span class="ms-dot">' + (m.state === "done" ? OF.icons.get("check") : (i + 1)) + '</span>' +
        '<span class="ms-lbl">' + e(lbl) + '</span>' +
        '<span class="ms-sub">' + e(sub) + '</span></button>';
    });
    return html + '</div>';
  }

  /* The engine speaks for itself: a retune it WANTS to make (pending
     proposal) or one it just made on its own (auto adjustment) is shown
     with the reasoning and a way to push back. */
  function engineChangeHtml() {
    var pend = pendingAdapt();
    if (pend) {
      return '<div class="eng-change eng-propose">' +
        '<div class="eng-kicker">' + OF.icons.get("sparkles") + ' Your coach wants to test a change</div>' +
        '<p class="eng-what">' + e(deltaPhrase(pend.delta)) +
          (pend.to ? ' \u2014 to <strong>' + e(String(pend.to)) + ' kcal</strong>/day' : '') + '</p>' +
        (pend.reason ? '<p class="eng-why muted small">' + e(pend.reason) + '</p>' : '') +
        '<div class="eng-actions">' +
        '<button type="button" class="btn primary mini" data-eng="apply">Try it</button>' +
        '<button type="button" class="btn mini" data-eng="decline">No, keep it as is</button>' +
        '</div></div>';
    }
    // a recent AUTO change: tell them what happened and let them revert it
    var last = calorieAdjs().filter(function (a) { return a.auto && !a.reverted; }).pop();
    if (last) {
      var dn = OF.targets.dayNum(last.date), today = OF.targets.dayNum(U.todayISO());
      if (dn != null && today != null && today - dn <= 14) {
        return '<div class="eng-change eng-applied">' +
          '<div class="eng-kicker">' + OF.icons.get("sparkles") + ' Your coach adjusted your plan</div>' +
          '<p class="eng-what">' + e(deltaPhrase(last.delta)) +
            (last.to ? ' \u2014 now <strong>' + e(String(last.to)) + ' kcal</strong>/day' : '') + '</p>' +
          (last.reason ? '<p class="eng-why muted small">' + e(last.reason) + '</p>' : '') +
          '<div class="eng-actions">' +
          '<button type="button" class="btn mini" data-eng="revert" data-id="' + e(last.id) + '">Undo this change</button>' +
          '</div></div>';
      }
    }
    return "";
  }

  function deltaPhrase(delta) {
    var d = Math.round(Number(delta) || 0);
    if (!d) return "No change to your calories";
    return (d > 0 ? "Raise" : "Lower") + " your daily calories by " + Math.abs(d);
  }

  /** User pushed back: drop the change (or the proposal) and don't re-test
      the same idea until a full adaptation window has passed. */
  function declineAdapt(proposal) {
    var blockUntil = OF.targets.dayNum(U.todayISO()) + OF.targets.ADJ_STEP_DAYS;
    if (proposal) {
      S.update("adjustments", proposal.id, { status: "declined", blockUntilDayNum: blockUntil });
    } else {
      S.add("adjustments", { date: U.todayISO(), status: "declined",
        kind: PROPOSAL_KIND, delta: 0, blockUntilDayNum: blockUntil,
        reason: "You reverted the coach\u2019s change." });
    }
  }

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
    // pace verdict needs a week of data to mean anything — "behind pace"
    // minutes after setting a goal just discourages (sim-QA finding)
    var goalAgeDays = OF.targets.dayNum(U.todayISO()) - OF.targets.dayNum(goal.date);
    if (progress && progress.status === "ok" && progress.onTrack != null &&
        goalAgeDays >= 7) {
      html += chip(progress.onTrack ? "on track" : "behind pace",
        progress.onTrack ? "conf-high" : "conf-medium");
    } else if (progress && progress.status === "ok" && goalAgeDays < 7) {
      html += chip("day " + Math.max(1, goalAgeDays + 1), "conf-high");
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

    /* intermediate tier: derived checkpoints between today and the goal */
    html += engineChangeHtml();
    html += milestonesHtml(goal);

    /* weekly tier: frequency goals (training, weigh-ins) */
    html += weeklyGoalsHtml(goal);

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

    /* daily tier: live tappable rings — today's logs vs today's targets */
    if (targets && targets.status === "ok") {
      html += dailyGoalsHtml(targets);
      html += '<p class="goal-note muted small day-goals-fine">' +
        e("Also today: fat " + targets.fatG + "g · carbs " + targets.carbsG + "g" +
          (targets.weeklyTargetKg
            ? " · pace " + U.fmtWeightDelta(targets.weeklyTargetKg) + "/wk"
            : "")) + '</p>';
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
    } else if (targets && (targets.status === "no-weight" ||
                           targets.status === "unknown-type")) {
      // unknown-type computed an accurate explanation but nothing rendered it,
      // so the card fell through to "log your weight to start tracking" — told
      // users to do something they had already done and hid the real cause
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

    // one-tap goal switch — flipping cut<->bulk used to mean digging into
    // the full edit form past height/age/sex (user-panel finding)
    var SWITCH = [["cut", "Cut"], ["maintain", "Maintain"], ["lean-bulk", "Lean bulk"], ["recomp", "Recomp"]];
    html += '<div class="goal-switch-row"><span class="muted small">Switch:</span>' +
      SWITCH.map(function (t) {
        var on = (goal.type || "") === t[0];
        return '<button type="button" class="btn mini goal-switch' + (on ? ' goal-switch-on' : '') +
          '" data-goal-switch="' + t[0] + '"' + (on ? ' disabled' : '') + '>' + t[1] + '</button>';
      }).join("") + '</div>';
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
    // One-tap path: the coach reads the user's own data (weight, body fat,
    // physique photos, training frequency) and picks the goal for them.
    html += '<button type="button" class="btn goal-coach-pick" id="goal-coach-pick">' +
      OF.icons.get("sparkles") + '<span>Let your coach pick' +
      (goal ? ' again' : ' for you') + '</span></button>' +
      '<div id="goal-suggest"></div>';
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

  /* ---------------- coach-picked goal (one tap) ---------------- */

  var lastSuggestion = null;

  function coachPick() {
    var T = OF.targets;
    var g = activeGoal() || {};
    lastSuggestion = T.suggestGoal({
      body: S.getAll("body"),
      exercise: S.getAll("exercise"),
      physique: S.getAll("physique"),
      profile: { sex: g.sex, heightCm: g.heightCm, age: g.age, activity: g.activity },
      today: U.todayISO()
    });
    var el = document.getElementById("goal-suggest");
    if (el) el.innerHTML = suggestionHtml(lastSuggestion);
    prefillForm(lastSuggestion.rec);
    if (OF.haptics) OF.haptics.light();
  }

  function suggestionHtml(s) {
    var T = OF.targets;
    var t = T.GOAL_TYPES[s.rec.type];
    var meta = [];
    if (s.rec.targetAmountKg) {
      meta.push((s.rec.type === "cut" ? "lose " : "gain ") +
        U.fmtWeight(s.rec.targetAmountKg));
    }
    if (s.rec.targetDate) meta.push("by " + fmtDateShort(s.rec.targetDate));
    return '<div class="goal-suggest-card">' +
      '<div class="insight-head"><p class="goal-suggest-head">Coach&rsquo;s pick: <strong>' +
        e(t ? t.label : s.rec.type) + '</strong></p>' +
        chip(s.confidence + " confidence", s.confidence === "high" ? "conf-high" :
          s.confidence === "medium" ? "conf-medium" : "conf-low") + '</div>' +
      (meta.length ? '<p class="goal-suggest-meta">' + e(meta.join(" ")) + '</p>' : '') +
      '<ul class="goal-suggest-why">' + s.why.map(function (w) {
        return '<li>' + e(w) + '</li>';
      }).join("") + '</ul>' +
      '<div class="form-actions">' +
        '<button type="button" class="btn primary" id="gs-use">Use this goal</button>' +
        '<button type="button" class="btn ghost" id="gs-tweak">Tweak it below</button>' +
      '</div></div>';
  }

  /** Mirror the suggestion into the visible form so "Tweak" needs no re-entry. */
  function prefillForm(rec) {
    var typeSel = document.getElementById("gf-type");
    if (typeSel) { typeSel.value = rec.type; onTypeChange(); }
    var amt = document.getElementById("gf-amount");
    if (amt) amt.value = rec.targetAmountKg ? U.toDisplayWeight(rec.targetAmountKg) : "";
    var dt = document.getElementById("gf-date");
    if (dt) dt.value = rec.targetDate || "";
    var act = document.getElementById("gf-activity");
    if (act && rec.activity) act.value = rec.activity;
  }

  function applySuggestion() {
    if (!lastSuggestion) return;
    var existing = activeGoal();
    var rec = Object.assign({ date: existing ? existing.date : U.todayISO() },
      lastSuggestion.rec);
    var typeChanged = !!(existing && existing.type !== rec.type);
    if (typeChanged) rec.date = U.todayISO(); // progress restarts; adaptation history kept
    var ok = existing ? S.update("goal", existing.id, rec) : S.add("goal", rec);
    if (!ok) { U.toast("Could not save — storage is full or blocked."); return; }
    syncProfileGoal(rec.type);
    editing = false;
    lastSuggestion = null;
    refresh();
    if (OF.insights) OF.insights.refresh();
    if (OF.dashboard) OF.dashboard.refresh();
    if (OF.haptics) OF.haptics.medium ? OF.haptics.medium() : 0;
    if (typeChanged && OF.trainer && OF.trainer.hasProgram && OF.trainer.hasProgram()) {
      U.toast("Coach set your goal. Rebuild your training program to match?", "ok", {
        label: "Rebuild",
        fn: function () {
          try {
            OF.trainer.regenerate();
            if (OF.trainer.refresh) OF.trainer.refresh();
            if (OF.dashboard) OF.dashboard.refresh();
            U.toast("Program rebuilt for your new goal.", "ok");
          } catch (e2) { U.toast("Could not rebuild — open the Coach tab and use the check-in.", "warn"); }
        }
      });
    } else {
      U.toast("Goal set by your coach — progress tracking starts now.", "ok");
    }
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

    var ok, typeChanged = false;
    if (existing) {
      // Changing goal TYPE restarts progress display from today but KEEPS
      // the adaptation history: those nudges correct the MAINTENANCE
      // estimate, which is goal-independent — wiping them made every
      // cut<->bulk flip forget weeks of learned truth (user-panel finding).
      if (existing.type !== type) {
        typeChanged = true;
        rec.date = U.todayISO();
      }
      ok = S.update("goal", existing.id, rec);
    } else {
      ok = S.add("goal", rec);
    }
    if (!ok) { showFormError("Could not save — browser storage is full or blocked."); return; }

    // SINGLE SOURCE OF TRUTH: the goal record is canonical; mirror the type
    // into the coach profile so the coach never nags about a "changed goal"
    // it wasn't told about (the two stores used to drift apart).
    syncProfileGoal(type);

    editing = false;
    refresh();
    if (OF.insights) OF.insights.refresh();
    if (OF.dashboard) OF.dashboard.refresh();

    // the program's rep schemes were built for the OLD goal — offer the
    // one-tap rebuild instead of leaving cut-style programming on a bulk
    if (typeChanged && OF.trainer && OF.trainer.hasProgram && OF.trainer.hasProgram()) {
      U.toast("Goal switched. Rebuild your training program to match it?", "ok", {
        label: "Rebuild",
        fn: function () {
          try {
            OF.trainer.regenerate();
            if (OF.trainer.refresh) OF.trainer.refresh();
            if (OF.dashboard) OF.dashboard.refresh();
            U.toast("Program rebuilt for your new goal.", "ok");
          } catch (e) { U.toast("Could not rebuild — open the Coach tab and use the check-in.", "warn"); }
        }
      });
    }
  }

  /** Mirror the canonical goal type into the coach profile (quietly). */
  function syncProfileGoal(type) {
    try {
      if (OF.profile && OF.profile.update) OF.profile.update({ goals: { appGoalType: type } }, "goal-card");
    } catch (e) { /* profile module absent on some builds — non-fatal */ }
  }

  function clearAdjustments() {
    S.getAll("adjustments").forEach(function (r) { S.remove("adjustments", r.id); });
  }

  /* ---------------- coach proposals ----------------
     The AI coach can propose a concrete change; the user accepts or
     dismisses it in the chat (coach.js renders the Apply/Not-now card).
     Only a small, safe set of change types is accepted here — anything
     else stays advice-only text. Returns {ok, summary} or {ok, error}. */

  function applyCoachProposal(p) {
    var T = OF.targets;
    if (!p || typeof p !== "object") return { ok: false, error: "Bad proposal." };

    if (p.type === "goalType") {
      if (!T.GOAL_TYPES[p.value]) return { ok: false, error: "Unknown goal type." };
      var existing = activeGoal();
      if (existing) {
        if (existing.type === p.value) {
          return { ok: false, error: "That is already your goal." };
        }
        var rec = Object.assign({}, existing,
          { type: p.value, date: U.todayISO() });
        delete rec.id;
        clearAdjustments();  // type change restarts progress + adaptation
        if (!S.update("goal", existing.id, rec)) {
          return { ok: false, error: "Could not save the goal." };
        }
      } else {
        if (!S.add("goal", { date: U.todayISO(), type: p.value,
          targetAmountKg: null, targetDate: null, heightCm: null,
          age: null, sex: null, activity: null })) {
          return { ok: false, error: "Could not save the goal." };
        }
      }
      syncProfileGoal(p.value);
      refresh();
      if (OF.insights) OF.insights.refresh();
      if (OF.dashboard) OF.dashboard.refresh();
      return { ok: true, summary: "Goal set to " +
        ((T.GOAL_TYPES[p.value] && T.GOAL_TYPES[p.value].label) || p.value) + "." };
    }

    if (p.type === "calorieAdjust") {
      var delta = Math.round(Number(p.deltaKcal));
      if (!isFinite(delta) || delta === 0 || Math.abs(delta) > 300) {
        return { ok: false, error: "Calorie change must be within ±300 kcal." };
      }
      var goal = activeGoal();
      if (!goal) return { ok: false, error: "Set a goal first (Insights tab)." };
      var kg = T.latestWeightKg(S.getAll("body"));
      var total = adjTotal();
      var before = T.computeTargets(goal, { weightKg: kg, adjTotal: total });
      var after = T.computeTargets(goal, { weightKg: kg, adjTotal: total + delta });
      if (!S.add("adjustments", {
        date: U.todayISO(),
        kind: "calories",
        delta: delta,
        from: before && before.status === "ok" ? before.calories : null,
        to: after && after.status === "ok" ? after.calories : null,
        reason: "Coach suggestion" + (p.why ? ": " + String(p.why).slice(0, 140) : "")
      })) return { ok: false, error: "Could not save the adjustment." };
      refresh();
      if (OF.insights) OF.insights.refresh();
      if (OF.dashboard) OF.dashboard.refresh();
      return { ok: true, summary: "Daily calorie target " +
        (delta > 0 ? "raised" : "lowered") + " by " + Math.abs(delta) + " kcal" +
        (after && after.status === "ok" ? " (now " + after.calories + " kcal)." : ".") };
    }

    if (p.type === "targetDate") {
      var g2 = activeGoal();
      if (!g2) return { ok: false, error: "Set a goal first (Insights tab)." };
      var v = String(p.value || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || v <= U.todayISO()) {
        return { ok: false, error: "Target date must be a future date." };
      }
      var rec2 = Object.assign({}, g2, { targetDate: v });
      delete rec2.id;
      if (!S.update("goal", g2.id, rec2)) {
        return { ok: false, error: "Could not save the date." };
      }
      refresh();
      if (OF.insights) OF.insights.refresh();
      if (OF.dashboard) OF.dashboard.refresh();
      return { ok: true, summary: "Goal target date moved to " + v + "." };
    }

    return { ok: false, error: "This suggestion can't be applied automatically." };
  }

  function onAreaClick(evt) {
    var eng = evt.target.closest("[data-eng]");
    if (eng) {
      var act = eng.getAttribute("data-eng");
      var pend = pendingAdapt();
      if (act === "apply" && pend) {
        var ok = S.add("adjustments", {
          date: U.todayISO(), kind: "calories", auto: false, delta: pend.delta,
          from: pend.from, to: pend.to, reason: pend.reason
        });
        if (ok) {
          S.update("adjustments", pend.id, { status: "applied" });
          U.toast("Applied — your targets are updated.", "ok");
          if (OF.haptics && OF.haptics.medium) OF.haptics.medium();
        } else {
          U.toast("Could not save — storage is full or blocked.");
        }
      } else if (act === "decline") {
        declineAdapt(pend);
        U.toast("Kept as is — I won\u2019t retry that for a couple of weeks.", "ok");
      } else if (act === "revert") {
        var id = eng.getAttribute("data-id");
        var rec = S.getAll("adjustments").filter(function (a) { return a.id === id; })[0];
        if (rec) {
          // keep the audit trail: mark it reverted and cancel it out, so the
          // adaptation history still shows what the engine tried and why
          S.update("adjustments", id, { reverted: true });
          S.add("adjustments", {
            date: U.todayISO(), kind: "calories", auto: false, revertOf: id,
            delta: -Number(rec.delta) || 0, from: rec.to, to: rec.from,
            reason: "You reverted the coach\u2019s change."
          });
          declineAdapt(null);
          U.toast("Reverted — back to your previous targets.", "ok");
        }
      }
      refresh();
      if (OF.insights) OF.insights.refresh();
      if (OF.dashboard) OF.dashboard.refresh();
      return;
    }
    var sw = evt.target.closest("[data-goal-switch]");
    if (sw) {
      var g0 = activeGoal();
      var newType = sw.getAttribute("data-goal-switch");
      if (g0 && newType && g0.type !== newType) {
        var rec0 = Object.assign({}, g0, { type: newType, date: U.todayISO() });
        delete rec0.id;
        // amount only makes sense for cut/lean-bulk; keep it when still valid
        if (newType !== "cut" && newType !== "lean-bulk") rec0.targetAmountKg = null;
        if (S.update("goal", g0.id, rec0)) {
          syncProfileGoal(newType);
          refresh();
          if (OF.insights) OF.insights.refresh();
          if (OF.dashboard) OF.dashboard.refresh();
          if (OF.haptics) OF.haptics.light();
          if (OF.trainer && OF.trainer.hasProgram && OF.trainer.hasProgram()) {
            U.toast("Goal switched. Rebuild your training program to match it?", "ok", {
              label: "Rebuild",
              fn: function () {
                try {
                  OF.trainer.regenerate();
                  if (OF.trainer.refresh) OF.trainer.refresh();
                  if (OF.dashboard) OF.dashboard.refresh();
                  U.toast("Program rebuilt for your new goal.", "ok");
                } catch (e) { U.toast("Could not rebuild — open the Coach tab and use the check-in.", "warn"); }
              }
            });
          } else {
            U.toast("Goal switched — targets updated instantly.", "ok");
          }
        } else {
          U.toast("Could not switch the goal — storage is full or blocked.", "warn");
        }
      }
      return;
    }
    var dayNav = evt.target.closest("[data-day-nav]");
    if (dayNav) {
      // tap a daily goal ring -> jump straight to where you log it
      if (OF.haptics) OF.haptics.light();
      location.hash = "#" + dayNav.getAttribute("data-day-nav");
      return;
    }
    var msStep = evt.target.closest("[data-ms-info]");
    if (msStep) {
      if (OF.haptics) OF.haptics.light();
      U.toast(msStep.getAttribute("data-ms-info"), "ok");
      return;
    }
    if (evt.target.closest("#goal-coach-pick")) { coachPick(); return; }
    if (evt.target.closest("#gs-use")) { applySuggestion(); return; }
    if (evt.target.closest("#gs-tweak")) {
      // suggestion is already mirrored into the form — just clear the panel
      // and put the user on the first field
      var panel = document.getElementById("goal-suggest");
      if (panel) panel.innerHTML = "";
      var first = document.getElementById("gf-type");
      if (first) first.focus();
      return;
    }
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
    coachContext: coachContext,
    applyCoachProposal: applyCoachProposal,
    autonomy: autonomy,                // settings reads/writes the engine's power
    setAutonomy: setAutonomy,
    syncProfileGoal: syncProfileGoal   // onboarding reuses the same mirror
  };
})();

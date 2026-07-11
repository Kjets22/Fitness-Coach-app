/* ============================================================
   onboarding.js — 3-step first-run welcome overlay.

   Shows only when the app is completely fresh (0 records, no
   goal) AND the intro hasn't been dismissed before. The flag
   lives in optimalfit.prefs as { introSeen: true } (units.js
   preserves unknown pref keys, and export/replace-import carries
   prefs, so the flag round-trips with backups).

   Step 1: what the app does
   Step 2: pick a goal now (reuses OF.targets.GOAL_TYPES + the
           same record shape goals.js saves) or skip
   Step 3: how to log the first day + "Explore with demo data"

   Replayable from Settings ("Replay intro"). All static trusted
   markup; the only interpolated strings are GOAL_TYPES labels,
   which still go through U.esc for discipline.
   ============================================================ */

window.OF = window.OF || {};

OF.onboarding = (function () {
  "use strict";
  var U = OF.util, S = OF.storage;
  var root = null;
  var step = 1;
  var pickedGoal = null; // goal type chosen in step 2 (for step-3 copy)

  function seen() {
    return !!(OF.units && OF.units.prefs().introSeen);
  }
  function markSeen() {
    if (OF.units) OF.units.setPrefs({ introSeen: true });
  }

  /* ---------------- rendering ---------------- */

  function dots() {
    var h = '<div class="ob-dots" aria-hidden="true">';
    for (var i = 1; i <= 3; i++) {
      h += '<span class="ob-dot' + (i === step ? " active" : "") + '"></span>';
    }
    return h + "</div>";
  }

  function shellOpen() {
    return '<div class="ob-backdrop"></div><div class="ob-panel" role="dialog" aria-modal="true" ' +
      'aria-label="Welcome to OptimalFit">' +
      '<button type="button" class="ob-close" id="ob-close" aria-label="Skip intro">' +
      OF.icons.get("close") + '</button>';
  }

  function step1() {
    return shellOpen() +
      '<div class="ob-logo">' + logoSvg() + '</div>' +
      '<h2 class="ob-title">Welcome to <span class="grad-text">OptimalFit</span></h2>' +
      '<p class="ob-lead">Track your sleep, food, training and body — and let the app find ' +
      'what actually works for <em>your</em> body.</p>' +
      '<ul class="ob-list">' +
      '<li>' + OF.icons.badge("sparkles") + '<span><strong>Personal insights</strong><br>' +
      'Best gym times, best training days, when to rest — computed from your own data, on this device.</span></li>' +
      '<li>' + OF.icons.badge("target") + '<span><strong>Adaptive goals</strong><br>' +
      'Daily calorie, protein, water and step targets that learn how your body responds.</span></li>' +
      '<li>' + OF.icons.badge("heart") + '<span><strong>Private by default</strong><br>' +
      'Your logs stay on this device &mdash; no ads, no analytics. An optional community lets you ' +
      'share only what you choose.</span></li>' +
      '</ul>' + dots() +
      '<div class="ob-actions">' +
      '<button type="button" class="btn primary big" id="ob-next">Get started</button>' +
      '<button type="button" class="btn ghost" id="ob-skip">Skip intro</button>' +
      '</div></div>';
  }

  function step2() {
    var T = OF.targets;
    var current = OF.goals ? OF.goals.activeGoal() : null;
    var items = Object.keys(T.GOAL_TYPES).map(function (k) {
      var on = (pickedGoal || (current && current.type)) === k;
      return '<button type="button" class="ob-goal' + (on ? " active" : "") +
        '" data-goal="' + U.esc(k) + '">' +
        '<span class="ob-goal-check">' + OF.icons.get("check") + '</span>' +
        U.esc(T.GOAL_TYPES[k].label) + '</button>';
    }).join("");
    return shellOpen() +
      '<h2 class="ob-title">What’s the goal?</h2>' +
      '<p class="ob-lead">Pick one and every tracker turns into a personal plan. ' +
      'You can fine-tune amounts, dates and your profile any time on the Insights tab.</p>' +
      '<div class="ob-goals">' + items + '</div>' + dots() +
      '<div class="ob-actions">' +
      '<button type="button" class="btn primary big" id="ob-next"' +
      (pickedGoal || current ? "" : " disabled") + '>Continue</button>' +
      '<button type="button" class="btn ghost" id="ob-skip2">Skip for now</button>' +
      '</div></div>';
  }

  function step3() {
    return shellOpen() +
      '<h2 class="ob-title">Log your first day</h2>' +
      '<p class="ob-lead">' + (pickedGoal
        ? 'Goal set. The more you log, the sharper your insights get:'
        : 'The more you log, the sharper your insights get:') + '</p>' +
      '<ul class="ob-list">' +
      '<li>' + OF.icons.badge("moon") + '<span><strong>After waking</strong> — log last night on the ' +
      '<strong>Sleep</strong> tab (Log button below).</span></li>' +
      '<li>' + OF.icons.badge("apple") + '<span><strong>Each meal</strong> — a name and rough calories ' +
      'are enough to start.</span></li>' +
      '<li>' + OF.icons.badge("droplet") + '<span><strong>Through the day</strong> — tap water and steps ' +
      'on the <strong>Daily</strong> tab.</span></li>' +
      '<li>' + OF.icons.badge("scale") + '<span><strong>Weigh-ins</strong> — a couple per week on the ' +
      '<strong>Body</strong> tab is plenty.</span></li>' +
      '</ul>' + dots() +
      '<div class="ob-actions">' +
      '<button type="button" class="btn primary big" id="ob-done">Start tracking</button>' +
      '<button type="button" class="btn" id="ob-demo">Explore with demo data</button>' +
      '<p class="muted small ob-demo-note">Demo data loads ~60 days of realistic fake entries so you ' +
      'can see the dashboard and insights in action. Clear it any time in Settings.</p>' +
      '</div></div>';
  }

  function logoSvg() {
    // Same mark as the header (gradient dumbbell + pulse), own gradient id.
    return '<svg viewBox="0 0 48 48" width="56" height="56" aria-hidden="true">' +
      '<defs><linearGradient id="ob-lg" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="var(--g1)"/><stop offset="1" stop-color="var(--g2)"/>' +
      '</linearGradient></defs>' +
      '<rect x="2" y="2" width="44" height="44" rx="12" fill="url(#ob-lg)"/>' +
      '<path d="M13 18v12M9 21v6M35 18v12M39 21v6" stroke="#fff" stroke-width="3" stroke-linecap="round"/>' +
      '<path d="M15 24h4l2-4 3.5 8 2.5-4h6" stroke="#fff" stroke-width="2.6" fill="none" ' +
      'stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function render() {
    if (!root) return;
    root.innerHTML = step === 1 ? step1() : step === 2 ? step2() : step3();
    root.classList.remove("hidden");
    document.body.classList.add("ob-open");
  }

  /* ---------------- actions ---------------- */

  function hide(remember) {
    if (remember !== false) markSeen();
    if (root) { root.innerHTML = ""; root.classList.add("hidden"); }
    document.body.classList.remove("ob-open");
    step = 1;
    pickedGoal = null;
  }

  /** Save the picked goal type, reusing goals.js record shape + semantics. */
  function saveGoal(type) {
    if (!OF.targets.GOAL_TYPES[type]) return;
    var existing = OF.goals ? OF.goals.activeGoal() : null;
    if (existing) {
      if (existing.type !== type) {
        // Same rule as goals.js: a type change clears the adaptation
        // history and restarts progress from today.
        S.getAll("adjustments").forEach(function (r) { S.remove("adjustments", r.id); });
        S.update("goal", existing.id, { type: type, date: U.todayISO() });
      }
    } else {
      S.add("goal", {
        date: U.todayISO(), type: type,
        targetAmountKg: null, targetDate: null,
        heightCm: null, age: null, sex: null, activity: null
      });
    }
    if (OF.goals) OF.goals.refresh();
    if (OF.dashboard) OF.dashboard.refresh();
  }

  function onClick(e) {
    var t = e.target.closest("button");
    if (!t) return;
    if (t.id === "ob-close") { hide(); return; }
    if (t.id === "ob-skip") { hide(); return; }
    if (t.id === "ob-skip2") { pickedGoal = null; step = 3; render(); return; }
    if (t.id === "ob-next") {
      if (step === 1) { step = 2; render(); return; }
      if (step === 2) {
        if (pickedGoal) saveGoal(pickedGoal);
        step = 3; render(); return;
      }
    }
    if (t.id === "ob-done") { hide(); return; }
    if (t.id === "ob-demo") {
      // The intro can be replayed later — never dump ~460 demo records on top
      // of real data without asking (mirrors the Settings demo button).
      if (OF.storage.countAll() > 0 &&
          !confirm("Demo data will be ADDED on top of your existing " +
                   OF.storage.countAll() + " records. Continue?")) {
        return;
      }
      var c = OF.demo.generate(60);
      hide();
      if (OF.settings) OF.settings.refreshAll();
      U.toast("Demo data loaded: " + (c.sleep + c.food + c.exercise + c.body + c.water + c.steps) +
        " records across ~60 days. Clear it any time in Settings.", "warn");
      if (OF.app) OF.app.showTab("dashboard");
      location.hash = "dashboard";
      return;
    }
    var g = t.getAttribute("data-goal");
    if (g) { pickedGoal = g; render(); }
  }

  function onKey(e) {
    if (e.key === "Escape" && root && !root.classList.contains("hidden")) hide();
  }

  /* ---------------- lifecycle ---------------- */

  /** Show the intro. force=true replays it regardless of state. */
  function show(force) {
    if (!root) return;
    if (!force && (seen() || S.countAll() > 0)) return;
    step = 1;
    pickedGoal = null;
    render();
  }

  function init() {
    root = document.getElementById("onboarding");
    if (!root) return;
    root.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    var replay = document.getElementById("btn-replay-intro");
    if (replay) replay.addEventListener("click", function () { show(true); });
    show(false);
  }

  return { init: init, show: show };
})();

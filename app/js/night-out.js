/* ============================================================
   night-out.js — drinking-aware planning (PURE, no DOM).

   Alcohol is where most plans quietly die: it is 7 kcal/g, it
   comes with late food, it wrecks sleep quality, and it blunts
   recovery. Pretending it doesn't happen just means the user
   stops logging on the nights that matter most.

   Two jobs:
     estimateDrinks(list)   – kcal for what they plan to drink
     plan(ctx)              – a concrete multi-day adjustment so a
                              night out costs the week nothing

   The plan NEVER creates a crash day: every adjusted day is
   floored at a safe intake and protein is held constant, because
   cutting protein to "make room" for alcohol is exactly backwards.
   ============================================================ */

window.OF = window.OF || {};

OF.nightOut = (function () {
  "use strict";

  /* Typical serving calories. Deliberately mid-range and honest —
     a "vodka soda" is not a frozen margarita. */
  var DRINKS = {
    "beer": 153,          // 12 oz, regular
    "light-beer": 103,
    "ipa": 210,           // craft/high-ABV pint runs higher
    "wine": 123,          // 5 oz
    "prosecco": 98,
    "shot": 97,           // 1.5 oz spirit, neat
    "spirit-soda": 100,   // vodka/gin + soda water
    "spirit-mixer": 210,  // + juice/tonic/cola
    "cocktail": 250,      // shaken, sweetened
    "margarita": 330,
    "seltzer": 100
  };
  var DEFAULT_DRINK_KCAL = 150;

  /* Alcohol calorie floors: never plan a day below these, no matter
     how much banking the night needs (mirrors evidence.js safety). */
  var FLOOR_KCAL = { m: 1500, f: 1200, u: 1300 };
  /* How much of a single day's target we are willing to shave. */
  var MAX_DAY_CUT_PCT = 0.15;

  function n(v) {
    var x = Number(v);
    return isFinite(x) ? x : null;
  }

  /** Calories for a planned list of drinks.
      list: [{type, count}] or [{kcal, count}] or a bare count. */
  function estimateDrinks(list) {
    if (n(list) != null) return Math.round(n(list) * DEFAULT_DRINK_KCAL);
    if (!Array.isArray(list)) return 0;
    var total = 0;
    list.forEach(function (d) {
      if (!d) return;
      var count = n(d.count);
      if (count == null || count < 0) count = 1;
      var each = n(d.kcal);
      if (each == null) {
        var key = String(d.type || "").trim().toLowerCase().replace(/\s+/g, "-");
        each = DRINKS[key];
        if (each == null) each = DEFAULT_DRINK_KCAL;
      }
      total += each * count;
    });
    return Math.round(total);
  }

  /**
   * Spread the cost of a night out across the days around it.
   *
   * ctx:
   *   drinks        list for estimateDrinks() (or a plain number of drinks)
   *   lateFood      true if a kebab/pizza on the way home is realistic
   *   dailyKcal     their normal daily calorie target
   *   proteinG      their normal daily protein target (held CONSTANT)
   *   sex           "m" | "f" (floor selection)
   *   daysBefore    how many days of runway they gave us (0-5)
   *   daysAfter     how many days after we may still adjust (0-5)
   *   trainingDay   true if they normally train the day after
   *
   * Returns { drinkKcal, extraKcal, totalKcal, perDayCut, days:[…],
   *           protein, hydration, training, honest } — or
   *           { status:"no-targets" } when we have nothing to plan against.
   */
  function plan(ctx) {
    ctx = ctx || {};
    var daily = n(ctx.dailyKcal);
    if (daily == null || daily <= 0) {
      return { status: "no-targets",
        message: "Set a goal first and I can spread the cost of a night out across your week." };
    }
    var drinkKcal = estimateDrinks(ctx.drinks);
    // Late-night food is part of drinking for most people; planning for it
    // beats pretending it won't happen and blowing the week by surprise.
    var extraKcal = ctx.lateFood ? 700 : 0;
    var totalKcal = drinkKcal + extraKcal;

    var before = Math.max(0, Math.min(5, Math.round(n(ctx.daysBefore) || 0)));
    var after = Math.max(0, Math.min(5, Math.round(n(ctx.daysAfter) != null ? n(ctx.daysAfter) : 2)));
    var slots = before + after;

    var floor = FLOOR_KCAL[ctx.sex === "m" ? "m" : ctx.sex === "f" ? "f" : "u"];
    var maxCutPerDay = Math.min(Math.round(daily * MAX_DAY_CUT_PCT), Math.max(0, daily - floor));

    var days = [];
    var covered = 0;
    if (slots > 0 && maxCutPerDay > 0) {
      var per = Math.min(maxCutPerDay, Math.ceil(totalKcal / slots));
      for (var i = before; i >= 1; i--) {
        days.push({ when: "before", offset: -i, kcalTarget: daily - per, cut: per });
        covered += per;
      }
      for (var j = 1; j <= after; j++) {
        days.push({ when: "after", offset: j, kcalTarget: daily - per, cut: per });
        covered += per;
      }
      // never bank more than the night actually costs
      var over = covered - totalKcal;
      for (var k = days.length - 1; k >= 0 && over > 0; k--) {
        var give = Math.min(over, days[k].cut);
        days[k].cut -= give;
        days[k].kcalTarget += give;
        over -= give;
        covered -= give;
      }
      days = days.filter(function (d) { return d.cut > 0; });
    }

    var shortfall = Math.max(0, totalKcal - covered);
    return {
      status: "ok",
      drinkKcal: drinkKcal,
      extraKcal: extraKcal,
      totalKcal: totalKcal,
      covered: covered,
      shortfall: shortfall,
      days: days,
      protein: {
        keepG: n(ctx.proteinG),
        note: "Hold protein at your normal target every one of these days — " +
          "cutting protein to make room for drinks is exactly backwards."
      },
      hydration: "A glass of water between drinks and a big one before bed. " +
        "Most of tomorrow's 'hangover weight' is water and salt, not fat.",
      training: ctx.trainingDay
        ? "You normally train the day after. Keep the session but treat it as a " +
          "maintenance day: same lifts, about 10% lighter, stop 2 reps short. " +
          "Alcohol blunts recovery and sleep quality, so a hard session the " +
          "morning after buys you soreness, not progress."
        : "Don't schedule a hard session for the morning after — alcohol wrecks " +
          "sleep quality and blunts recovery. A walk is a great next day.",
      honest: shortfall > 0
        ? "This night costs about " + totalKcal + " kcal and I can only safely " +
          "bank " + covered + " of it — the rest is a real dent. That's fine " +
          "occasionally; it just means the week is a hold, not a loss."
        : "Planned for. Do this and the night costs your goal nothing."
    };
  }

  return { plan: plan, estimateDrinks: estimateDrinks, DRINKS: DRINKS };
})();

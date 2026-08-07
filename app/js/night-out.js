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


  /* ============================================================
     LEARNING — what drinking ACTUALLY costs THIS person.

     The point is not to talk anyone out of drinking. People quit
     apps that ask them to quit their life. The point is to measure
     the real cost from their own logs and then bend the plan so
     the goal still moves. Everything here is observed, never
     assumed.
     ============================================================ */

  var ALC_RE = /beer|wine|vodka|whisk|tequila|rum\b|gin\b|cocktail|margarita|seltzer|prosecco|champagne|sake|cider|shot\b|ipa\b|lager|alcohol|martini|mojito|sangria/i;

  function dayNum(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], 12) / 86400000) : null;
  }
  function mean(a) {
    var s = 0, k = 0;
    for (var i = 0; i < a.length; i++) if (isFinite(a[i])) { s += a[i]; k++; }
    return k ? s / k : null;
  }
  function r1(v) { return v == null ? null : Math.round(v * 10) / 10; }

  /** Drinking events from logged food: [{date, drinks, alcoholKcal, dayKcal}]. */
  function detect(food, sinceIso) {
    var since = sinceIso ? dayNum(sinceIso) : null;
    var byDay = {};
    (food || []).forEach(function (r) {
      if (!r || !r.date) return;
      var dn = dayNum(r.date);
      if (dn == null || (since != null && dn < since)) return;
      var d = byDay[r.date] || (byDay[r.date] = { date: r.date, drinks: 0, alcoholKcal: 0, dayKcal: 0 });
      var kcal = n(r.calories) || 0;
      d.dayKcal += kcal;
      if (ALC_RE.test(String(r.foodName || ""))) { d.drinks++; d.alcoholKcal += kcal; }
    });
    return Object.keys(byDay).map(function (k) { return byDay[k]; })
      .filter(function (d) { return d.drinks > 0; })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  }

  /**
   * What drinking costs this person, measured. Returns {status:"learning"}
   * with a plain reason until there is enough to be honest about.
   *
   * data: { food, body, exercise, sleep, today, windowDays }
   */
  function analyze(data) {
    data = data || {};
    var today = dayNum(data.today) || dayNum(new Date().toISOString().slice(0, 10));
    var win = n(data.windowDays) || 56;
    var startDn = today - win;

    var allDays = {};
    (data.food || []).forEach(function (r) {
      if (!r || !r.date) return;
      var dn = dayNum(r.date);
      if (dn == null || dn < startDn || dn > today) return;
      var d = allDays[r.date] || (allDays[r.date] = { kcal: 0, drinks: 0 });
      d.kcal += n(r.calories) || 0;
      if (ALC_RE.test(String(r.foodName || ""))) d.drinks++;
    });
    var dates = Object.keys(allDays);
    var drinkDates = dates.filter(function (d) { return allDays[d].drinks > 0; });
    var soberDates = dates.filter(function (d) { return allDays[d].drinks === 0; });

    if (drinkDates.length < 3 || soberDates.length < 5) {
      return { status: "learning",
        drinkingDays: drinkDates.length,
        message: "I need a few more logged days — including the nights you drink — " +
          "before I can tell you what it actually costs you." };
    }

    var drinkKcal = mean(drinkDates.map(function (d) { return allDays[d].kcal; }));
    var soberKcal = mean(soberDates.map(function (d) { return allDays[d].kcal; }));
    var overshoot = Math.round((drinkKcal || 0) - (soberKcal || 0));
    var weeksSpan = Math.max(1, win / 7);
    var cadence = r1(drinkDates.length / weeksSpan);
    var avgDrinks = r1(mean(drinkDates.map(function (d) { return allDays[d].drinks; })));

    // NEXT-DAY EFFECT: did training survive, and how did it feel?
    var drinkSet = {};
    drinkDates.forEach(function (d) { drinkSet[dayNum(d)] = true; });
    var perfAfter = [], perfOther = [], trainedAfter = 0, afterDays = 0;
    var trainedByDay = {};
    (data.exercise || []).forEach(function (r) {
      if (!r || !r.date) return;
      var dn = dayNum(r.date);
      if (dn == null || dn < startDn || dn > today) return;
      trainedByDay[dn] = true;
      var p = n(r.performance);
      if (p == null) return;
      if (drinkSet[dn - 1]) perfAfter.push(p); else perfOther.push(p);
    });
    Object.keys(drinkSet).forEach(function (dn) {
      var next = Number(dn) + 1;
      if (next > today) return;
      afterDays++;
      if (trainedByDay[next]) trainedAfter++;
    });

    // SLEEP on drinking nights (record is keyed by WAKE date = next morning)
    var slAfter = [], slOther = [];
    (data.sleep || []).forEach(function (r) {
      if (!r || !r.date) return;
      var dn = dayNum(r.date), dur = n(r.durationMin);
      if (dn == null || dur == null || dn < startDn || dn > today) return;
      if (drinkSet[dn - 1]) slAfter.push(dur); else slOther.push(dur);
    });

    var weeklyCost = Math.round(Math.max(0, overshoot) * (cadence || 0));
    return {
      status: "ok",
      windowDays: win,
      drinkingDays: drinkDates.length,
      soberDaysLogged: soberDates.length,
      cadencePerWeek: cadence,
      avgDrinksPerNight: avgDrinks,
      avgKcalOnDrinkingDays: Math.round(drinkKcal || 0),
      avgKcalOnOtherDays: Math.round(soberKcal || 0),
      // the REAL cost: the whole day's overshoot, which is drinks plus the
      // late food that comes with them — not a label off a bottle
      observedOvershootKcal: overshoot,
      estWeeklyCostKcal: weeklyCost,
      nextDay: {
        trainedRate: afterDays ? r1(trainedAfter / afterDays) : null,
        avgPerfAfter: r1(mean(perfAfter)),
        avgPerfOtherDays: r1(mean(perfOther)),
        avgSleepMinAfter: perfAfter.length || slAfter.length ? Math.round(mean(slAfter) || 0) || null : null,
        avgSleepMinOtherNights: slOther.length ? Math.round(mean(slOther) || 0) || null : null
      },
      confidence: drinkDates.length >= 8 ? "high" : drinkDates.length >= 5 ? "medium" : "low"
    };
  }

  /**
   * Build a WEEK that absorbs their real drinking pattern, so the goal keeps
   * moving without anyone having to quit anything.
   *
   * a = analyze() result, dailyKcal/proteinG = current targets.
   * Returns the adjusted everyday target + what it does and doesn't fix.
   */
  function weeklyBudget(a, dailyKcal, opts) {
    opts = opts || {};
    var daily = n(dailyKcal);
    if (!a || a.status !== "ok" || daily == null || daily <= 0) {
      return { status: "not-ready",
        message: "Once I've seen a few of your nights out I can build the week around them." };
    }
    var cadence = n(a.cadencePerWeek) || 0;
    var weeklyCost = n(a.estWeeklyCostKcal) || 0;
    if (weeklyCost <= 0 || cadence <= 0) {
      return { status: "no-cost",
        message: "Your drinking nights aren't actually costing you calories — nothing to adjust." };
    }
    var floor = FLOOR_KCAL[opts.sex === "m" ? "m" : opts.sex === "f" ? "f" : "u"];
    var otherDays = Math.max(1, 7 - Math.min(6, Math.round(cadence)));
    var idealCut = weeklyCost / otherDays;
    var maxCut = Math.min(daily * MAX_DAY_CUT_PCT, Math.max(0, daily - floor));
    var cut = Math.round(Math.min(idealCut, maxCut));
    var absorbed = cut * otherDays;
    var residual = Math.max(0, Math.round(weeklyCost - absorbed));

    return {
      status: "ok",
      everydayKcal: daily - cut,
      drinkingDayKcal: daily,      // the night itself stays normal on paper
      cutPerOtherDay: cut,
      otherDaysPerWeek: otherDays,
      weeklyCostKcal: Math.round(weeklyCost),
      absorbedKcal: absorbed,
      residualKcal: residual,
      // ~7700 kcal per kg: what the un-absorbed part costs in pace
      slowerKgPerWeek: residual > 0 ? Math.round((residual / 7700) * 100) / 100 : 0,
      keepProteinG: n(opts.proteinG),
      note: residual > 0
        ? "This absorbs " + absorbed + " of the " + Math.round(weeklyCost) +
          " kcal your nights out cost, so you still progress — just about " +
          (Math.round((residual / 7700) * 100) / 100) + " kg/week slower than a dry week. " +
          "Nothing to give up; the timeline just moves."
        : "This fully absorbs what your nights out cost — same goal, same date, " +
          "nothing given up."
    };
  }

  return { plan: plan, estimateDrinks: estimateDrinks, DRINKS: DRINKS,
           detect: detect, analyze: analyze, weeklyBudget: weeklyBudget,
           ALC_RE: ALC_RE };
})();

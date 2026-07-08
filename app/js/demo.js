/* ============================================================
   demo.js — demo data generator.

   Produces ~60 days of realistic, CORRELATED fake data so the
   future insights engine has real patterns to discover:

     1. Morning workouts (before noon) perform slightly better
        than evening ones (+0.6 avg performance).
     2. Good sleep the night before (>= 7.5h and quality >= 4)
        boosts workout performance (+0.9); short/bad sleep
        (< 6.5h) hurts it (-0.9).
     3. A carb-rich pre-workout meal 1-2h before training adds
        a small boost (+0.4).
     4. Training 3+ days in a row degrades performance (fatigue),
        so rest days genuinely help.
     5. Body composition follows a LEAN-BULK story (Iteration 6):
        weight holds steady for the first half of the window and
        then climbs ~1.4 kg over the second half, body fat drifts
        down, muscle mass % trends up. The flat first month makes
        the adaptive coach fire "+ calories" adjustments (observed
        gain ~0 vs the +0.25% BW/week lean-bulk target), and the
        faster second-half gain can trigger a small "- calories"
        one — so the adjustment log tells a real story.
     6. Low-water days (< ~2.1 L) slightly hurt performance.
     7. Steps 6-12k/day, higher on training days.
     8. Daily intake is calibrated (PORTION scale on every food
        record) to a realistic ~2,700-2,900 kcal/day so it is
        consistent with the weight-GAIN body story — the adaptive
        engine then "learns" a plausible maintenance (~2,400-3,000)
        instead of the impossible ~1,750 the old ~1,770 kcal/day
        intake implied (QA-3 note).
     9. Strength set logging (P2-11): most strength workouts carry
        an `exercises` array (Squat/Bench/Row and Deadlift/OHP/Bench
        A/B rotation, 3-5 sets, kg loads) with progressive overload,
        a deload week mid-window, ONE recent PR (a heavy Squat top
        set in the final session) and ONE stalled lift: Bench Press
        stops improving over the last ~3 weeks — exactly the stretch
        whose strength sessions happen to follow the seed's shortest
        nights (prior-night sleep ~6.5h vs ~7.9h earlier), so the
        strength engine's stall diagnosis finds the sleep link.
        Uses a SECOND seeded stream (rnd2) so the original rnd()
        sequence — and every record above — stays byte-identical.

   Also seeds a demo GOAL (lean bulk, +15 lb muscle, ambitious
   target date so the honesty check shows) when none exists.
   Uses a seeded PRNG so "Load demo data" is reproducible.
   ============================================================ */

window.OF = window.OF || {};

OF.demo = (function () {
  "use strict";
  var U = OF.util, S = OF.storage;

  /** mulberry32 — tiny seeded PRNG, returns () => [0,1). */
  function prng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  function isoDate(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function hm(h, m) { return pad(Math.floor(h)) + ":" + pad(Math.floor(m)); }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function pick(rnd, arr) { return arr[Math.floor(rnd() * arr.length)]; }

  var FOODS = {
    breakfast: [
      { name: "Oatmeal with berries", kcal: 380, p: 14, c: 62, f: 8 },
      { name: "Eggs and toast", kcal: 420, p: 24, c: 34, f: 20 },
      { name: "Greek yogurt and granola", kcal: 350, p: 22, c: 46, f: 9 },
      { name: "Protein smoothie", kcal: 320, p: 30, c: 38, f: 6 }
    ],
    lunch: [
      { name: "Chicken and rice bowl", kcal: 650, p: 45, c: 72, f: 16 },
      { name: "Tuna sandwich", kcal: 520, p: 32, c: 52, f: 18 },
      { name: "Beef burrito", kcal: 700, p: 38, c: 68, f: 28 },
      { name: "Salmon salad", kcal: 480, p: 36, c: 22, f: 26 }
    ],
    dinner: [
      { name: "Steak, potatoes and greens", kcal: 720, p: 48, c: 55, f: 30 },
      { name: "Pasta with chicken", kcal: 680, p: 42, c: 82, f: 18 },
      { name: "Salmon, rice and broccoli", kcal: 620, p: 40, c: 58, f: 22 },
      { name: "Chicken stir-fry", kcal: 560, p: 38, c: 52, f: 20 }
    ],
    snack: [
      { name: "Protein bar", kcal: 220, p: 20, c: 22, f: 8 },
      { name: "Apple and peanut butter", kcal: 250, p: 7, c: 30, f: 12 },
      { name: "Cottage cheese", kcal: 180, p: 22, c: 8, f: 6 },
      { name: "Mixed nuts", kcal: 280, p: 9, c: 10, f: 24 }
    ],
    preWorkout: [
      { name: "Banana and honey toast", kcal: 300, p: 6, c: 62, f: 4 },
      { name: "Rice cakes with jam", kcal: 240, p: 4, c: 54, f: 2 },
      { name: "Oats and banana", kcal: 340, p: 10, c: 64, f: 6 }
    ],
    postWorkout: [
      { name: "Whey shake and banana", kcal: 280, p: 32, c: 34, f: 3 },
      { name: "Chocolate milk", kcal: 220, p: 12, c: 32, f: 6 }
    ]
  };

  var EXERCISE_TYPES = ["strength", "strength", "strength", "cardio", "cardio", "sports", "flexibility"];

  // Portion multiplier applied to every generated food record (kcal AND
  // macros, so they stay consistent). Lifts the demo diet from ~1,770 to a
  // realistic ~2,700-2,900 kcal/day to match the lean-bulk weight story
  // WITHOUT touching the rnd() call sequence (seeded output stays
  // reproducible and every embedded correlation is preserved).
  var PORTION = 1.5;

  /**
   * Generate `days` days of correlated data ending today.
   * Returns counts per type. Appends to whatever data exists.
   */
  function generate(days) {
    days = days || 60;
    var rnd = prng(1337);
    var counts = { sleep: 0, food: 0, exercise: 0, body: 0, water: 0, steps: 0, goal: 0, physique: 0 };

    // Lean-bulk body story: flat first half, then a slow climb (see header).
    var weight0 = 82.5, fat0 = 21.0, muscle0 = 38.5;

    // Demo GOAL (only when none exists): lean bulk +15 lb muscle with an
    // ambitious target date, so targets, adaptation AND the honesty check
    // all have something to show.
    if (!S.getAll("goal").length) {
      var start = new Date();
      start.setDate(start.getDate() - (days - 1));
      var end = new Date();
      end.setDate(end.getDate() + 120);
      if (S.add("goal", {
        date: isoDate(start),
        type: "lean-bulk",
        targetAmountKg: 6.8,       // ~15 lb of muscle
        targetDate: isoDate(end),  // ~4 months out — deliberately optimistic
        heightCm: 178,
        age: 30,
        sex: "m",
        activity: "moderate"
      })) counts.goal = 1;
    }

    var consecTraining = 0;     // fatigue tracker

    /* ---------- strength set-logging (P2-11) ----------
       Its OWN seeded stream: rnd2 never touches rnd's call sequence. */
    var rnd2 = prng(1234);
    var setSessionCount = 0;
    var DELOAD_FROM = 35, DELOAD_TO = 41;  // deload week (dayIdx)
    var STALL_FROM = days - 22;            // bench e1RM stops improving here
    var FORCE_FROM = days - 14;            // last 2 weeks always logged

    function r25(w) { return Math.round(w / 2.5) * 2.5; }

    function mkSets(weight, repBase, repSpan, nSets) {
      var sets = [];
      for (var s = 0; s < nSets; s++) {
        var reps = repBase + Math.floor(rnd2() * repSpan);
        if (s === nSets - 1 && rnd2() < 0.4) reps = Math.max(1, reps - 1); // last-set fatigue
        sets.push({ weightKg: r25(weight), reps: reps });
      }
      return sets;
    }

    /** exercises array for a strength session on dayIdx, or undefined (~30% unlogged). */
    function strengthExercises(dayIdx) {
      var log = rnd2() < 0.7; // consume the stream every time, then maybe force
      if (!log && dayIdx < FORCE_FROM) return undefined;
      var deload = dayIdx >= DELOAD_FROM && dayIdx <= DELOAD_TO;
      var scale = deload ? 0.85 : 1;
      var finalWeek = dayIdx >= days - 7;
      var A = (setSessionCount % 2 === 0) || finalWeek; // final session guaranteed Squat day
      setSessionCount++;
      var nSets = 3 + Math.floor(rnd2() * 3); // 3-5
      var benchW = Math.min(85, 72.5 + Math.floor(dayIdx / 6) * 2.5);
      var bench = {
        name: "Bench Press",
        sets: dayIdx >= STALL_FROM
          ? mkSets(85, 5, 2, nSets)            // stalled: stuck at 85 kg, reps sag to 5-6
          : mkSets(benchW * scale, 7, 3, nSets) // 7-9 reps, +2.5 kg every ~6 days
      };
      var exs = [];
      if (A) {
        var squatW = (100 + 0.45 * dayIdx) * scale;
        var squat = { name: "Squat", sets: mkSets(squatW, 6, 3, nSets) }; // 6-8 reps
        if (finalWeek) squat.sets.push({ weightKg: r25(squatW + 10), reps: 6 }); // recent PR
        exs.push(squat, bench);
        exs.push({
          name: "Barbell Row",
          sets: mkSets((65 + 0.25 * dayIdx) * scale, 7, finalWeek ? 1 : 3, nSets)
        });
      } else {
        exs.push({ name: "Deadlift", sets: mkSets((130 + 0.5 * dayIdx) * scale, 4, 3, Math.min(nSets, 4)) });
        exs.push({ name: "Overhead Press", sets: mkSets((47.5 + 0.15 * dayIdx) * scale, 7, 3, nSets) });
        exs.push(bench);
      }
      return exs;
    }

    for (var i = days - 1; i >= 0; i--) {
      var d = new Date();
      d.setDate(d.getDate() - i);
      var date = isoDate(d);
      var dayIdx = days - 1 - i; // 0 .. days-1
      var weekday = d.getDay();  // 0=Sun

      /* ---------- SLEEP (logged for the night ending this morning) ---------- */
      // Weekends: later bedtime, slightly worse quality on average.
      var isWeekendNight = (weekday === 6 || weekday === 0);
      var bedH = 22.5 + rnd() * 1.5 + (isWeekendNight ? 0.8 : 0); // 22:30 - 00:48
      var durH = 6.0 + rnd() * 2.8 - (isWeekendNight ? 0.3 : 0);  // 5.7 - 8.8 h
      var bedMin = Math.round((bedH % 24) * 60);
      var wakeMin = Math.round((bedMin + durH * 60) % (24 * 60));
      var quality = clamp(Math.round(1 + (durH - 5.5) * 1.3 + (rnd() - 0.5) * 1.6), 1, 5);
      var durMin = Math.round(durH * 60);

      if (S.add("sleep", {
        date: date,
        bedTime: hm(Math.floor(bedMin / 60) % 24, bedMin % 60),
        wakeTime: hm(Math.floor(wakeMin / 60), wakeMin % 60),
        quality: quality,
        durationMin: durMin,
        notes: ""
      })) counts.sleep++;

      var sleepGood = durH >= 7.5 && quality >= 4;
      var sleepBad = durH < 6.5;

      /* ---------- WATER (3-5 entries; total 1.5-3.4 L) ---------- */
      var waterTotal = 1500 + Math.round(rnd() * 1900);
      var lowWater = waterTotal < 2100; // pattern 6: hurts performance a bit
      var nSips = 3 + Math.floor(rnd() * 3);
      var left = waterTotal;
      for (var s = 0; s < nSips && left >= 100; s++) {
        var amt = s === nSips - 1
          ? left
          : Math.max(100, Math.min(left, Math.round(left / (nSips - s) * (0.6 + rnd() * 0.8))));
        if (S.add("water", { date: date, amountMl: amt })) counts.water++;
        left -= amt;
      }

      /* ---------- EXERCISE (~4-5 days/week) ---------- */
      // Rest more often on Sundays; skip after 3 consecutive days.
      var trainChance = weekday === 0 ? 0.25 : 0.72;
      if (consecTraining >= 3) trainChance = 0.2;
      var trains = rnd() < trainChance;
      var workoutStartMin = null;

      if (trains) {
        consecTraining++;
        var morning = rnd() < 0.45;
        var startH = morning ? 6.5 + rnd() * 3 : 16.5 + rnd() * 4; // 06:30-09:30 or 16:30-20:30
        workoutStartMin = Math.round(startH * 60);
        var type = pick(rnd, EXERCISE_TYPES);
        var duration = type === "flexibility" ? 25 + Math.round(rnd() * 20)
                                              : 40 + Math.round(rnd() * 50);
        var intensity = clamp(Math.round(2 + rnd() * 3), 1, 5);

        // Pre-workout meal 1-2h before, ~55% of sessions. (pattern 3)
        var hadPre = rnd() < 0.55;
        if (hadPre) {
          var preMin = workoutStartMin - Math.round(60 + rnd() * 60);
          if (preMin > 0) {
            var pf = pick(rnd, FOODS.preWorkout);
            if (S.add("food", {
              date: date, time: hm(Math.floor(preMin / 60), preMin % 60),
              mealType: "pre-workout", foodName: pf.name,
              calories: Math.round(pf.kcal * PORTION), protein: Math.round(pf.p * PORTION),
              carbs: Math.round(pf.c * PORTION), fat: Math.round(pf.f * PORTION), notes: ""
            })) counts.food++;
          } else { hadPre = false; }
        }

        // ---- Embedded performance patterns ----
        var perf = 3.0;
        if (morning) perf += 0.6;                 // pattern 1: mornings better
        if (sleepGood) perf += 0.9;               // pattern 2: good sleep boosts
        if (sleepBad) perf -= 0.9;
        if (hadPre) perf += 0.4;                  // pattern 3: pre-workout carbs
        if (consecTraining >= 3) perf -= 0.8;     // pattern 4: fatigue
        if (lowWater) perf -= 0.3;                // pattern 6: dehydration drag
        perf += (rnd() - 0.5) * 1.4;              // noise
        perf = clamp(Math.round(perf), 1, 5);

        if (S.add("exercise", {
          date: date,
          startTime: hm(Math.floor(workoutStartMin / 60), workoutStartMin % 60),
          type: type,
          durationMin: duration,
          intensity: intensity,
          performance: perf,
          notes: "",
          // pattern 9: sets for most strength sessions (undefined is
          // dropped by JSON.stringify, so other records keep their shape)
          exercises: type === "strength" ? strengthExercises(dayIdx) : undefined
        })) counts.exercise++;

        // Post-workout shake ~50% of sessions.
        if (rnd() < 0.5) {
          var postMin = Math.min(23 * 60 + 50, workoutStartMin + duration + 15);
          var pw = pick(rnd, FOODS.postWorkout);
          if (S.add("food", {
            date: date, time: hm(Math.floor(postMin / 60), postMin % 60),
            mealType: "post-workout", foodName: pw.name,
            calories: Math.round(pw.kcal * PORTION), protein: Math.round(pw.p * PORTION),
            carbs: Math.round(pw.c * PORTION), fat: Math.round(pw.f * PORTION), notes: ""
          })) counts.food++;
        }
      } else {
        consecTraining = 0;
      }

      /* ---------- REGULAR MEALS ---------- */
      var meals = [
        { type: "breakfast", pool: FOODS.breakfast, h: 7.2 + rnd() * 1.5 },
        { type: "lunch", pool: FOODS.lunch, h: 12.2 + rnd() * 1.3 },
        { type: "dinner", pool: FOODS.dinner, h: 18.5 + rnd() * 1.5 }
      ];
      if (rnd() < 0.6) meals.push({ type: "snack", pool: FOODS.snack, h: 15 + rnd() * 1.5 });
      meals.forEach(function (m) {
        var f = pick(rnd, m.pool);
        var jitter = (0.9 + rnd() * 0.2) * PORTION; // portion size variance
        if (S.add("food", {
          date: date,
          time: hm(Math.floor(m.h), (m.h % 1) * 60),
          mealType: m.type,
          foodName: f.name,
          calories: Math.round(f.kcal * jitter),
          protein: Math.round(f.p * jitter),
          carbs: Math.round(f.c * jitter),
          fat: Math.round(f.f * jitter),
          notes: ""
        })) counts.food++;
      });

      /* ---------- STEPS (one entry per day; pattern 7) ---------- */
      var stepCount = Math.round(6000 + rnd() * 4000 + (trains ? 1500 + rnd() * 500 : 0));
      if (S.add("steps", { date: date, count: stepCount })) counts.steps++;

      /* ---------- BODY (every ~3 days; pattern 5 — lean-bulk story) ---------- */
      if (dayIdx % 3 === 0) {
        var progress = dayIdx / days;                       // 0 -> 1 over the window
        var bulk = Math.max(0, (dayIdx - days / 2) / (days / 2)); // 0 until halfway, then 0 -> 1
        if (S.add("body", {
          date: date,
          weightKg: Math.round((weight0 + 1.4 * bulk + (rnd() - 0.5) * 0.5) * 10) / 10,
          bodyFatPct: Math.round((fat0 - 1.2 * progress + (rnd() - 0.5) * 0.6) * 10) / 10,
          muscleMassPct: Math.round((muscle0 + 1.2 * progress + (rnd() - 0.5) * 0.5) * 10) / 10,
          notes: ""
        })) counts.body++;
      }
    }

    /* ---------- PHYSIQUE analyses (two, telling the lean-bulk progress
       story) — on their OWN seeded stream so the rnd()/rnd2() sequences
       above stay byte-identical. Only added when none exist yet. ---------- */
    if (!S.getAll("physique").length) {
      var rnd3 = prng(4321); // third stream — never touches rnd or rnd2
      var early = new Date(); early.setDate(early.getDate() - (days - 4));
      var recent = new Date(); recent.setDate(recent.getDate() - 2);
      var jit = function () { return Math.round((rnd3() - 0.5) * 2) / 10; }; // ±0.1
      // Early: ~20% body fat, average development.
      if (S.add("physique", {
        date: isoDate(early),
        bodyFatMidpoint: 20 + jit(),
        bodyFatRangeLow: 18, bodyFatRangeHigh: 22,
        muscularity: "average",
        regions: {
          shoulders: "average", chest: "average", arms: "developing",
          back: "average", core: "some definition", legs: "average"
        },
        strengths: ["Balanced overall base", "Good posture"],
        focusAreas: ["Build overall muscle", "Add shoulder width"],
        overallAssessment: "A solid, balanced starting point. With consistent " +
          "training and enough protein you have plenty of room to add muscle " +
          "while keeping body fat in check.",
        confidence: "medium",
        notes: "Visual estimate, not a medical body-composition measurement. " +
          "Lighting and pose affect the read."
      })) counts.physique++;
      // Recent: ~17% body fat, above-average, shoulders now the lagging area.
      if (S.add("physique", {
        date: isoDate(recent),
        bodyFatMidpoint: 17 + jit(),
        bodyFatRangeLow: 15, bodyFatRangeHigh: 19,
        muscularity: "above-average",
        regions: {
          shoulders: "a lagging area to prioritize", chest: "well-developed",
          arms: "well-developed", back: "above average",
          core: "visible definition", legs: "above average"
        },
        strengths: ["Chest and arms filling out", "Leaner midsection", "Good back width"],
        focusAreas: ["Prioritize shoulders", "Keep progressive overload"],
        overallAssessment: "Clear progress since your first photo — you look leaner " +
          "and more muscular, especially through the chest and arms. Shoulders are " +
          "the main area to prioritize next to round out your frame.",
        confidence: "medium",
        notes: "Visual estimate, not a medical body-composition measurement. " +
          "Front-lit, form-fitting photos give the most consistent reads."
      })) counts.physique++;
    }

    return counts;
  }

  return { generate: generate };
})();

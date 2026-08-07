/* ============================================================
   next-move.js — "what should I do RIGHT NOW?" (PURE, no DOM).

   The app knows a lot (readiness, the day's session, targets vs
   what's actually been eaten, goal pace, when you last weighed in)
   but until now it only ANSWERED when asked. This picks the single
   highest-impact action for this moment and says it as an
   instruction, not a status line.

   It is deliberately time-aware: the right move at 7am (train),
   1pm (protein), 9pm (sleep) and after a finished session
   (recover) are different, so the card changes through the day
   instead of showing one stale sentence.

   pick(ctx) -> { text, why, tab, kind, priority } | null
   ctx (all optional; missing pieces are simply skipped):
     hour            0-23 local
     liveSession     true while a workout is in progress
     trainedToday    true if a session was logged/completed today
     sessionName     today's prescribed session ("Push A")
     firstLift       first exercise of that session
     readiness       engine readiness result ({status, score, level})
     topAdvice       first item of engine.readinessAdvice()
     targets         { kcal, proteinG, waterMl, steps, sleepH }
     today           { kcal, proteinG, waterMl, steps }
     lastWeighInDays days since the newest weigh-in (null = never)
     adaptation      { ready, foodDays, weightPts } from the goal engine
     pace            "behind" | "ahead" | "on" | null
     daysSinceLog    days since ANY record (null = no data at all)
   ============================================================ */

window.OF = window.OF || {};

OF.nextMove = (function () {
  "use strict";

  function n(v) {
    var x = Number(v);
    return isFinite(x) ? x : null;
  }
  function remaining(target, sofar) {
    var t = n(target), s = n(sofar) || 0;
    return t == null ? null : Math.max(0, t - s);
  }

  /** Ordered candidate list; the first match wins. Kept as one flat
      function so the priority order is readable top-to-bottom. */
  function pick(ctx) {
    ctx = ctx || {};
    var hour = n(ctx.hour);
    if (hour == null) hour = 12;
    var t = ctx.targets || {};
    var d = ctx.today || {};
    var r = ctx.readiness;
    var evening = hour >= 19;
    var lateNight = hour >= 22 || hour < 4;
    var morning = hour < 11;

    // 0. Mid-workout: nothing else matters.
    if (ctx.liveSession) {
      return { kind: "finish", tab: "exercise", priority: 100,
        text: "Finish your session — you're mid-workout.",
        why: "Log each set as you go and I'll pick your weights next time." };
    }

    // 1. Long absence: re-entry beats optimization.
    if (ctx.daysSinceLog != null && ctx.daysSinceLog >= 14) {
      return { kind: "comeback", tab: "exercise", priority: 95,
        text: "Do one easy session today — just show up.",
        why: "It's been " + ctx.daysSinceLog + " days. Getting back on the board beats a perfect plan you never start." };
    }

    // 2. Already trained today → the win is recovery, not more work.
    if (ctx.trainedToday) {
      var protLeft = remaining(t.proteinG, d.proteinG);
      if (protLeft != null && protLeft >= 25) {
        return { kind: "recover-protein", tab: "food", priority: 90,
          text: "Get " + Math.round(protLeft) + "g more protein in before bed.",
          why: "You trained today — protein is what turns that session into muscle." };
      }
      if (evening && t.sleepH) {
        return { kind: "recover-sleep", tab: "sleep", priority: 85,
          text: "Aim for " + t.sleepH + "h of sleep tonight.",
          why: "You trained today. Sleep is where the adaptation actually happens." };
      }
      return { kind: "recover", tab: "dashboard", priority: 80,
        text: "Training's done — eat well and get to bed on time.",
        why: "Recovery is the part most people skip; it's why they stall." };
    }

    // 3. Readiness says back off — say so BEFORE suggesting a hard session.
    if (r && r.status === "ok" && r.level === "low") {
      return { kind: "back-off", tab: "exercise", priority: 78,
        text: "Take it easy today — rest or a light session.",
        why: (ctx.topAdvice && ctx.topAdvice.text) ||
          ("Your readiness is " + r.score + "/100; pushing through a low day costs more than it earns.") };
    }

    // 4. It's a training day and you haven't trained.
    if (ctx.sessionName && !lateNight) {
      return { kind: "train", tab: "exercise", priority: 75,
        text: "Train " + ctx.sessionName + (ctx.firstLift ? " — start with " + ctx.firstLift + "." : "."),
        why: (r && r.status === "ok" && r.level === "high")
          ? "Readiness " + r.score + "/100 — this is a day to push."
          : "It's the next session in your program." };
    }

    // 5. Nutrition gaps, ordered by how late it is to fix them.
    var protGap = remaining(t.proteinG, d.proteinG);
    if (protGap != null && protGap >= 40 && hour >= 14) {
      return { kind: "protein", tab: "food", priority: 70,
        text: Math.round(protGap) + "g of protein left today — put it in your next meal.",
        why: "Protein is the one target that changes body composition whether you're cutting or gaining." };
    }
    var kcalLeft = remaining(t.kcal, d.kcal);
    // after ~22:00 the food decisions are made — bed is the better call
    if (kcalLeft != null && n(d.kcal) != null && n(d.kcal) > 0 && kcalLeft === 0 && evening && !lateNight) {
      return { kind: "kcal-over", tab: "food", priority: 65,
        text: "You're at your calorie target — keep tonight light.",
        why: "One evening decides most people's whole day. Protein and vegetables if you're still hungry." };
    }
    if (kcalLeft != null && kcalLeft >= 600 && evening && !lateNight) {
      return { kind: "kcal-under", tab: "food", priority: 65,
        text: "You're " + Math.round(kcalLeft) + " kcal under target — eat a proper dinner.",
        why: "Chronically undereating stalls progress and wrecks your training quality." };
    }

    // 6. The adaptive engine is starved — unlocking it is worth more than
    //    any single day's tweak, so it outranks the small stuff.
    if (ctx.adaptation && ctx.adaptation.ready === false) {
      if (ctx.lastWeighInDays == null || ctx.lastWeighInDays >= 4) {
        return { kind: "weigh-in", tab: "body", priority: 60,
          text: "Step on the scale — a weigh-in this morning" + (morning ? "" : " or tomorrow morning") + " keeps your plan honest.",
          why: "I need about 4 weigh-ins over 2 weeks before I can retune your calories from what your body ACTUALLY did." };
      }
      return { kind: "log-food", tab: "food", priority: 58,
        text: "Log everything you eat today — complete days are what I learn from.",
        why: "With 14 logged days I can compare your intake to your real weight change and set your calories from evidence, not a formula." };
    }

    // 7. Goal pace drifting.
    if (ctx.pace === "behind") {
      return { kind: "pace", tab: "insights", priority: 55,
        text: "You're behind your goal pace — tighten the calorie target this week.",
        why: "Small daily misses compound; catching it now beats extending your timeline." };
    }

    // 8. Easy daily wins.
    var stepGap = remaining(t.steps, d.steps);
    if (stepGap != null && stepGap >= 3000 && hour >= 15 && hour < 21) {
      return { kind: "steps", tab: "daily", priority: 45,
        text: "Take a 20-minute walk — about " + (Math.round(stepGap / 500) * 500) + " steps to go.",
        why: "Daily movement is most of your calorie burn; it does more for a cut than any single workout." };
    }
    var waterGap = remaining(t.waterMl, d.waterMl);
    if (waterGap != null && waterGap >= 800 && hour >= 12 && hour < 21) {
      return { kind: "water", tab: "daily", priority: 40,
        text: "Drink a big glass of water — " + (Math.round(waterGap / 100) * 100) + " ml to go today.",
        why: "Even mild dehydration drops strength and makes you read hunger wrong." };
    }
    if (lateNight && t.sleepH) {
      return { kind: "sleep", tab: "sleep", priority: 38,
        text: "Head to bed — you need " + t.sleepH + "h to be ready tomorrow.",
        why: "Tomorrow's readiness score is mostly decided by what you do in the next hour." };
    }

    // 9. Rest day with nothing pressing.
    if (!ctx.sessionName && r && r.status === "ok") {
      return { kind: "rest", tab: "dashboard", priority: 30,
        text: "Rest day — walk, eat to target, and be ready to train tomorrow.",
        why: "Rest days aren't wasted days; they're when you actually get stronger." };
    }

    // 10. Cold start.
    return { kind: "start", tab: "sleep", priority: 10,
      text: "Log last night's sleep and today's food — that's how I learn what works for you.",
      why: "Everything I tell you comes from your own data, so the first few days of logging pay for themselves." };
  }

  return { pick: pick };
})();

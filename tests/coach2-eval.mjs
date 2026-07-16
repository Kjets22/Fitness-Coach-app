/* Coach 2.0 eval harness (node tests/coach2-eval.mjs).
   1) Synthetic user personas → full intake → program: assert every program
      is sensible, evidence-consistent, and constraint-respecting.
   2) Simulated weeks of logging in worlds with KNOWN ground truth:
      - responder world (true optimum 12 sets/wk): the review must move
        volume toward the optimum over time, and beat the static heuristic
        on cumulative gain (regret).
      - null world (volume-independent): the review must NOT chase noise
        (no-harm: stays near the evidence default).
   No DOM, no network, no LLM. */
import { makeWorld, check, section, report } from "./coach2-shim.mjs";

/* ================= 1. persona programs ================= */

const PERSONAS = [
  {
    name: "beginner cutting (busy)",
    answers: { goal: "fat-loss", milestone: "lose 15 lb", timeline: 26, age: 0, days: 3,
      session: 45, split: null, style: "mixed", cardio: "walk", likes: [], dislikes: [],
      equipment: "dumbbells", injury: null, patterns: null, sleep: 6.5, stress: 3, job: "desk", diet: [] },
    expect: { level: "beginner", splitLike: /Full Body/i, dayCount: 3 }
  },
  {
    name: "advanced powerlifter",
    answers: { goal: "strength", milestone: "squat 405", timeline: 52, age: 5, days: 5,
      session: 75, split: "ppl", style: "heavy", weakPoints: ["Legs"], cardio: "none",
      likes: ["Back Squat", "Bench Press", "Deadlift"], dislikes: [],
      equipment: "full-gym", injury: null, patterns: null, sleep: 7.5, stress: 2, job: "onFeet", diet: [] },
    expect: { level: "advanced", splitLike: /Push \/ Pull \/ Legs/i, dayCount: 5 }
  },
  {
    name: "injured home-gym lifter",
    answers: { goal: "muscle", milestone: null, timeline: null, age: 2, days: 4,
      session: 60, split: "upper-lower", style: "pump", cardio: "bike",
      likes: ["Dumbbell Bench Press"], dislikes: ["Bulgarian Split Squat"],
      equipment: "home-basic", injury: "shoulder", patterns: ["overhead"], sleep: 7.5, stress: 3, job: "desk", diet: ["vegetarian"] },
    expect: { level: "intermediate", splitLike: /Upper \/ Lower/i, dayCount: 4,
      bannedPatterns: ["Overhead Press", "Seated Dumbbell Press", "Pike Push-Up", "Overhead Triceps Extension"],
      banned: ["Bulgarian Split Squat"] }
  },
  {
    name: "time-poor parent",
    answers: { goal: "health", milestone: null, timeline: null, age: 0.5, days: 2,
      session: 30, split: null, style: "mixed", cardio: "walk", likes: [], dislikes: [],
      equipment: "full-gym", injury: null, patterns: null, sleep: 5.5, stress: 4, job: "onFeet", diet: [] },
    expect: { level: "beginner", splitLike: /Full Body/i, dayCount: 2, maxExPerDay: 4 }
  },
  {
    name: "endurance hybrid",
    answers: { goal: "endurance", milestone: "run a 10k", timeline: 26, age: 2, days: 3,
      session: 60, split: null, style: "pump", cardio: "run", likes: [], dislikes: [],
      equipment: "full-gym", injury: "knee", patterns: ["lunge"], sleep: 7.5, stress: 3, job: "desk", diet: [] },
    expect: { level: "intermediate", dayCount: 3, banned: ["Bulgarian Split Squat", "Walking Lunge"] }
  }
];

function runIntake(w, a) {
  const F = w.OF.intake.flow;
  const st = {};
  let step = F.steps[0];
  const go = (v) => { if (step) step = F.advance(st, step.id, v); };
  // drive the flow BY STEP ID so it survives future flow changes
  const answers = {
    goal: a.goal, "setup-depth": false, milestone: a.milestone, timeline: a.timeline,
    age: a.years != null ? a.years : 30,
    conditions: a.conditions || [],
    "training-age": a.age,
    "beginner-pep": true, "returning-pep": true, "safety-brief": true,
    "weak-points": a.weakPoints || [],
    days: a.days, "session-length": a.session, bodyweight: a.weight || null,
    split: a.split, style: a.style, cardio: a.cardio,
    likes: a.likes || [], dislikes: a.dislikes || [],
    equipment: a.equipment,
    "injury-area": a.injury ? (Array.isArray(a.injury) ? a.injury : [a.injury]) : [],
    "injury-patterns": a.patterns || [],
    sleep: a.sleep, stress: a.stress, job: a.job, diet: a.diet || [],
    "anything-else": a.freeNotes || null
  };
  let guard = 40;
  while (step && guard-- > 0) {
    if (!(step.id in answers)) throw new Error("eval has no answer for step: " + step.id);
    go(answers[step.id]);
  }
  if (step !== null) throw new Error("intake did not complete; stuck at " + (step && step.id));
  const m = F.toProfilePatch(st);
  w.OF.profile.update(m.patch, "intake");
  return w.OF.trainer.createProgram({
    daysPerWeek: a.days, equipment: a.equipment,
    experience: F.level(st) || "intermediate", sessionMinutes: a.session,
    emphasis: st.weakPoints && st.weakPoints.length ? st.weakPoints[0] : null
  });
}

section("persona programs");
for (const p of PERSONAS) {
  const w = makeWorld();
  let prog;
  try { prog = runIntake(w, p.answers); }
  catch (e) { check(p.name + ": intake completes", false, e.message); continue; }
  check(p.name + ": program generated", !!(prog && prog.days.length));
  check(p.name + ": day count", prog.days.length === p.expect.dayCount, prog.days.length);
  if (p.expect.splitLike) check(p.name + ": split", p.expect.splitLike.test(prog.split), prog.split);
  check(p.name + ": coach2 annotations present", !!prog.coach2);
  check(p.name + ": level", prog.coach2.level === p.expect.level, prog.coach2.level);
  const names = prog.days.flatMap(d => d.slots.map(x => x.name));
  const allBanned = [...(p.expect.banned || []), ...(p.expect.bannedPatterns || [])];
  if (allBanned.length) {
    check(p.name + ": constraints respected", !names.some(n => allBanned.includes(n)),
      names.filter(n => allBanned.includes(n)));
  }
  // equipment check via trainer's own allow-list
  const ALLOW = { "full-gym": ["gym", "db", "cable", "bw"], "dumbbells": ["db", "bw"],
    "home-basic": ["db", "bw", "cable"], "bodyweight": ["bw"] };
  // (names come from the POOL, whose equip tags generation already filters by;
  //  spot-check: dumbbells persona must not get barbell/cable-only lifts)
  if (p.answers.equipment === "dumbbells") {
    const gymOnly = ["Bench Press", "Barbell Row", "Back Squat", "Overhead Press", "Deadlift",
      "Leg Press", "Leg Curl", "Leg Extension", "Cable Fly", "Triceps Pushdown", "Lat Pulldown",
      "Seated Cable Row", "Cable Crunch", "Face Pull", "Hip Thrust", "Close-Grip Bench Press", "Romanian Deadlift", "Front Squat", "Incline Bench Press", "Barbell Curl"];
    check(p.name + ": equipment respected", !names.some(n => gymOnly.includes(n)), names.filter(n => gymOnly.includes(n)));
  }
  if (p.expect.maxExPerDay) {
    check(p.name + ": session cap for 30-min sessions",
      prog.days.every(d => d.slots.length <= p.expect.maxExPerDay), prog.days.map(d => d.slots.length));
  }
  // volume band compliance for all personas
  const band = prog.coach2.volumeBand;
  const pg = prog.coach2.perGroupWeeklySets;
  check(p.name + ": volume within evidence band",
    Object.values(pg).every(v => v.sets <= band[1]), { pg, band });
  // whys answer "why?" for every core decision
  check(p.name + ": every why present + cites evidence",
    ["split", "volume", "effort", "rest"].every(k => prog.coach2.whys[k].text.length > 30 && prog.coach2.whys[k].ids.length > 0));
}

/* ================= 2. adaptation simulation ================= */

/* World: each week the user trains Chest at the app's CURRENT volume target;
   true weekly e1RM gain = g(volume) + noise. The stack (bayes+thompson via
   weeklyReview) is compared to the STATIC heuristic (never changes volume)
   on cumulative gain. Ground truth optimum = 12 sets/wk in responder world. */

function simulate(gTrue, weeks, seed, policy) {
  const w = makeWorld();
  w.OF.profile.update({ goals: { primary: "muscle" }, prefs: { daysPerWeek: 3 },
    experience: { trainingAgeYears: 2 }, constraints: { equipment: "full-gym" } }, "intake");
  const M = w.OF.learn.math;
  const rng = M.mulberry32(seed);
  const start = Date.parse("2026-01-05T12:00:00Z");
  // Story: the user has been running 16 sets/wk (over their personal optimum).
  // Seed the level store so the review grid is anchored at 16.
  w.OF.learn.applyReview({ at: "2026-01-04", deload: false,
    decisions: [{ group: "Chest", current: 16, target: 16, move: 0 }] });
  let e1 = 100, vol = 16;
  let cum = 0;
  for (let wk = 0; wk < weeks; wk++) {
    // log 3 sessions this week totalling EXACTLY `vol` sets
    const base = Math.floor(vol / 3), rem = vol % 3;
    for (let s = 0; s < 3; s++) {
      const n = base + (s < rem ? 1 : 0);
      const date = new Date(start + (wk * 7 + s * 2) * 86400000).toISOString().slice(0, 10);
      w.data.exercise.push({ date, exercises: [{ name: "Bench Press",
        sets: Array(Math.max(1, n)).fill({ weightKg: Math.round(e1 * 10) / 10, reps: 8 }) }] });
      w.data.sleep.push({ date, durationMin: 450 + Math.round((rng() - 0.5) * 40) });
    }
    const gain = gTrue(vol) + (rng() - 0.5) * 0.6;   // noisy weekly gain %
    e1 *= 1 + gain / 100;
    cum += gain;
    // end of week: policy decides next week's volume
    w.now = start + ((wk + 1) * 7 + 1) * 86400000;
    if (policy === "adaptive" && wk >= 2) {
      const rev = w.OF.learn.weeklyReview(seed * 100 + wk);
      w.OF.learn.applyReview(rev);
      const d = rev.decisions.find(x => x.group === "Chest");
      if (d && d.target != null) vol = d.target;
    }
  }
  return { cum, finalVol: vol };
}

section("adaptation: responder world (true optimum 12 sets/wk)");
{
  const gResponder = (v) => 0.75 - Math.abs(v - 12) * 0.09;  // peak at 12
  let adAvg = 0, stAvg = 0, finals = [];
  const SEEDS = 12;
  for (let s = 1; s <= SEEDS; s++) {
    const ad = simulate(gResponder, 12, s, "adaptive");
    const st = simulate(gResponder, 12, s, "static");
    adAvg += ad.cum / SEEDS; stAvg += st.cum / SEEDS;
    finals.push(ad.finalVol);
  }
  console.log(`  adaptive cum gain ${adAvg.toFixed(2)}% vs static@16 ${stAvg.toFixed(2)}% | final vols: ${finals.join(",")}`);
  check("adaptive beats the static over-volumed baseline (12 wks)", adAvg > stAvg, { adAvg, stAvg });
  // Convergence needs a longer horizon: the safety rule caps moves at one
  // 2-set step per 2 weeks, so give it 24 weeks to actually settle.
  const finals24 = [];
  for (let s = 1; s <= SEEDS; s++) finals24.push(simulate(gResponder, 24, s + 200, "adaptive").finalVol);
  const dist = (arr) => arr.reduce((a, v) => a + Math.abs(v - 12), 0) / arr.length;
  const median = (arr) => arr.slice().sort((a, b) => a - b)[Math.floor(arr.length / 2)];
  console.log(`  24-week final vols: ${finals24.join(",")} | mean dist ${dist(finals24).toFixed(2)} (start 4) | median ${median(finals24)}`);
  check("mean distance to optimum shrinks well below start", dist(finals24) < 3.0, dist(finals24));
  check("median run sits at/near the optimum", Math.abs(median(finals24) - 12) <= 2, median(finals24));
}

section("adaptation: null world (volume makes no difference)");
{
  const gNull = () => 0.35;
  let drift = 0, finals = [];
  const SEEDS = 12;
  for (let s = 1; s <= SEEDS; s++) {
    const ad = simulate(gNull, 12, s + 50, "adaptive");
    finals.push(ad.finalVol);
    drift += Math.abs(ad.finalVol - 16) / SEEDS;
  }
  console.log(`  null-world final vols: ${finals.join(",")} (start 16) | mean |drift| ${drift.toFixed(2)}`);
  check("no-harm: stays near the default when there's no signal", drift <= 3.0, { drift, finals });
  const band = makeWorld().OF.evidence.volumeBand("intermediate");
  check("never leaves the evidence band", finals.every(v => v >= band[0] && v <= band[1]), finals);
}

section("cold start");
{
  // 1 week of data: review must hold the evidence default (no wild moves)
  const w = makeWorld();
  w.OF.profile.update({ goals: { primary: "muscle" }, prefs: { daysPerWeek: 3 },
    experience: { trainingAgeYears: 2 }, constraints: { equipment: "full-gym" } }, "intake");
  const start = Date.parse("2026-06-29T12:00:00Z");
  for (let s = 0; s < 3; s++) {
    const date = new Date(start + s * 2 * 86400000).toISOString().slice(0, 10);
    w.data.exercise.push({ date, exercises: [{ name: "Bench Press", sets: Array(4).fill({ weightKg: 80, reps: 8 }) }] });
  }
  w.now = start + 8 * 86400000;
  const rev = w.OF.learn.weeklyReview(1);
  const d = rev.decisions.find(x => x.group === "Chest");
  check("cold start: at most one cautious step", !d || Math.abs(d.move) <= 2, d);
  check("cold start: honest personalization status",
    w.OF.learn.responseModel().every(m => !m.personalized));
}

report("coach2-eval");

/* Coach 2.0 unit + integration tests (node tests/coach2-tests.mjs). No DOM,
   no network, no LLM. Covers: profile store, evidence KB, intake flow,
   learning math, preference learning, profile-aware program generation,
   weekly review + deload gate, and legacy no-regression. */
import { makeWorld, check, section, report } from "./coach2-shim.mjs";

/* ---------------- profile store ---------------- */
{
  section("profile store");
  const w = makeWorld();
  const P = w.OF.profile;
  check("fresh profile does not exist", !P.exists());
  P.update({ goals: { primary: "muscle" }, prefs: { daysPerWeek: 4 } }, "intake");
  P.update({ experience: { trainingAgeYears: 2 } }, "intake");
  P.update({ experience: { trainingAgeYears: 2 } }, "intake"); // identical → no bump
  check("exists after intake", P.exists());
  check("no-op update does not bump version", P.meta().version === 2, P.meta().version);
  check("level derived from training age", P.level() === "intermediate");
  P.update({ prefs: { daysPerWeek: null } }, "user-edit");
  check("null deletes a field", P.get().prefs.daysPerWeek === undefined);
  check("version bumps on delete", P.meta().version === 3);
  const ctx = P.coachContext();
  check("coach context is compact", JSON.stringify(ctx).length < 900, JSON.stringify(ctx).length);
  check("change history recorded with source", P.meta().changes.every(c => c.src));
}

/* ---------------- evidence KB ---------------- */
{
  section("evidence KB");
  const w = makeWorld();
  const E = w.OF.evidence;
  check("has 25+ entries", E.all().length >= 25, E.all().length);
  check("every entry has why + evidence grade + refs", E.all().every(e =>
    e.why && ["strong", "moderate", "mixed", "practice-based"].includes(e.evidence) && Array.isArray(e.refs)));
  const rInt = E.volumeRange("intermediate");
  check("intermediate volume range sane", rInt[0] >= 8 && rInt[1] <= 25 && rInt[0] < rInt[1], rInt);
  check("beginner < advanced volume ceiling", E.volumeRange("beginner")[1] < E.volumeRange("advanced")[1]);
  const band = E.volumeBand("intermediate");
  check("band inside sane limits", band[0] >= 4 && band[1] <= 25, band);
  check("start point inside band", E.volumeStart("intermediate") >= band[0] && E.volumeStart("intermediate") <= band[1]);
  check("hypertrophy RIR is 0-3", JSON.stringify(E.rirBand("hypertrophy")) === "[0,3]");
  check("compound rest >= isolation rest", E.restMinutes(true)[0] >= E.restMinutes(false)[0]);
  const s = E.safety();
  check("calorie floors present", s.calorieFloor.women >= 1000 && s.calorieFloor.men >= s.calorieFloor.women);
  check("max loss rate 1%/wk", s.maxWeeklyLossPctBW === 1.0);
  check("red flags include numbness", s.seeProfessionalIf.join(" ").includes("numbness"));
  check("whyHonest tags practice-based", E.whyHonest("progression-deload").includes("practice"));
  check("LLM context stays compact", JSON.stringify(E.coachContext()).length < 3200,
    JSON.stringify(E.coachContext()).length);
  const ctxIds = E.coachContext().entries.map(e => e.id);
  check("safety entries ALWAYS reach the coach", ["safety-injury-red-flags", "safety-calorie-floor", "safety-max-rates"]
    .every(id => ctxIds.includes(id)), ctxIds.filter(i => i.startsWith("safety")));
  check("screenProfile flags a minor", E.screenProfile({ experience: { age: 16 } }).some(n => n.kind === "minor"));
  check("screenProfile flags a condition", E.screenProfile({ constraints: { conditions: ["high blood pressure"] } }).length === 1);
  check("screenProfile is silent for a healthy adult", E.screenProfile({ experience: { age: 30 }, constraints: { conditions: [] } }).length === 0);
  check("red flags now include cardiac symptoms", E.safety().seeProfessionalIf.join(" ").toLowerCase().includes("chest pain"));
}

/* ---------------- intake flow (pure engine) ---------------- */
{
  section("intake flow");
  const w = makeWorld();
  const F = w.OF.intake.flow;
  // beginner path: gets the pep talk, skips weak-points and injury-patterns
  let st = {}, step = F.steps[0];
  const go = v => { step = F.advance(st, step.id, v); };
  go("muscle"); go("gain 10 lb"); go(26); go(25); go([]); go(0);
  check("beginner gets education step", step.id === "beginner-pep", step.id);
  go(true); go(3); go(45);
  check("bodyweight asked before split", step.id === "bodyweight", step.id);
  go("185"); go(null);
  check("'you choose' resolves a split", ["full-body", "upper-lower", "ppl"].includes(st.split), st.split);
  check("weight captured", st.weightDisplay === 185, st.weightDisplay);
  go("mixed"); go("walk");
  check("beginner SKIPS the 15-lift likes/dislikes walls", step.id === "equipment", step.id);
  go("dumbbells"); go([]);
  check("no injury skips pattern step", step.id === "sleep", step.id);
  go(7.5); go(3); go("desk"); go([]);
  check("beginner path completes", step === null);
  // returning-lifter lane
  let stR = {}, sR = F.steps[0];
  const goR = v => { sR = F.advance(stR, sR.id, v); };
  goR("muscle"); goR(null); goR(null); goR(25); goR([]); goR("returning");
  check("returning lane gets its own pep talk", sR.id === "returning-pep", sR.id);
  check("returning maps to intermediate", F.level(stR) === "intermediate");
  const m = F.toProfilePatch(st);
  check("level mapped", m.patch.experience.level === "beginner");
  check("goal mapped to app goal", m.appGoalType === "lean-bulk");
  check("milestone captured", m.patch.goals.milestones[0] === "gain 10 lb");

  // advanced path: weak points asked, injury patterns asked
  let st2 = {}, s2 = F.steps[0];
  const go2 = v => { s2 = F.advance(st2, s2.id, v); };
  go2("strength"); go2(null); go2(52); go2(52); go2([]); go2(5);
  check("advanced gets weak-points", s2.id === "weak-points", s2.id);
  go2(["Legs"]); go2(5); go2(60); go2(null); go2("ppl"); go2("heavy"); go2("none");
  go2([]); go2([]); go2("full-gym"); go2(["knee", "shoulder"]);
  check("injury triggers pattern step", s2.id === "injury-patterns", s2.id);
  go2(["squat", "overhead"]); go2(6.5); go2(4); go2("physical"); go2([]);
  check("advanced path completes", s2 === null);
  check("MULTIPLE injuries captured", st2.injuries.length === 2, st2.injuries);
  check("both injuries carry the patterns", st2.injuries.every(i => i.aggravates.length === 2));

  // safety lane: a minor + a condition get the safety brief and no deficit
  let st3 = {}, s3 = F.steps[0];
  const go3 = v => { s3 = F.advance(st3, s3.id, v); };
  go3("fat-loss"); go3(null); go3(null); go3(16); go3(["high blood pressure"]); go3(0);
  check("under-18 + condition triggers the safety brief", s3.id === "safety-brief", s3.id);
  check("safety brief text mentions a doctor", s3.say(st3).toLowerCase().includes("doctor"));
  const m3 = F.toProfilePatch(st3);
  check("age persisted to the profile", m3.patch.experience.age === 16);
  check("conditions persisted", m3.patch.constraints.conditions[0] === "high blood pressure");
  check("SAFETY: a minor asking to cut is NOT put on a deficit",
    m3.appGoalType === "maintain" && m3.patch.goals.appGoalType === "maintain", m3.appGoalType);
  // ...but an adult who asks to cut still cuts
  let st4 = {}, s4 = F.steps[0];
  const go4 = v => { s4 = F.advance(st4, s4.id, v); };
  go4("fat-loss"); go4(null); go4(null); go4(37); go4([]);
  check("an adult who asks to cut still cuts", F.toProfilePatch(st4).appGoalType === "cut");
}

/* ---------------- learning math ---------------- */
{
  section("learning math");
  const w = makeWorld();
  const M = w.OF.learn.math;
  const I = M.matInv([[2, 0.3, 0.1, 0], [0.3, 1.5, 0, 0.2], [0.1, 0, 1.2, 0.1], [0, 0.2, 0.1, 0.9]]);
  const mm = [[2, 0.3, 0.1, 0], [0.3, 1.5, 0, 0.2], [0.1, 0, 1.2, 0.1], [0, 0.2, 0.1, 0.9]];
  let maxErr = 0;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    let v = 0; for (let k = 0; k < 4; k++) v += mm[i][k] * I[k][j];
    maxErr = Math.max(maxErr, Math.abs(v - (i === j ? 1 : 0)));
  }
  check("matInv is exact", maxErr < 1e-10, maxErr);
  const prior = M.bayesRidge([]);
  check("no data → posterior = prior", Math.abs(prior.mu[1] - 0.45) < 1e-9);
  // learns personal NEGATIVE returns above 12
  const rows = [];
  for (let i = 0; i < 8; i++) rows.push({ x: M.features(12, 0.9), y: 0.7 });
  for (let i = 0; i < 8; i++) rows.push({ x: M.features(18, 0.9), y: 0.1 });
  const post = M.bayesRidge(rows);
  check("model separates 12 vs 18 sets", M.predictGain(post, 12, 0.9).mean > M.predictGain(post, 18, 0.9).mean + 0.15);
  // prior mildly penalizes over-volume (diminishing returns evidence)
  check("prior: 20 sets not better than 12", M.predictGain(prior, 20, 0.9).mean <= M.predictGain(prior, 12, 0.9).mean);
  const b = M.betaPosterior(5, 6);
  check("beta q10 flags heavy skipper", b.q10 > 0.25, b.q10);
  const b2 = M.betaPosterior(0, 6);
  check("beta stays quiet for a completer", b2.mean < 0.15, b2.mean);
  const rng = M.mulberry32(7);
  const picks = {};
  for (let i = 0; i < 200; i++) {
    const p = M.thompsonPick([{ level: 10, mean: 0.2, sd: 0.1 }, { level: 12, mean: 0.6, sd: 0.1 }], rng);
    picks[p.level] = (picks[p.level] || 0) + 1;
  }
  check("thompson strongly prefers the better arm", picks[12] > 160, picks);
  // exploration happens when the posterior is genuinely uncertain (wide sd)
  const rng2 = M.mulberry32(8);
  const picks2 = {};
  for (let i = 0; i < 200; i++) {
    const p = M.thompsonPick([{ level: 10, mean: 0.2, sd: 0.4 }, { level: 12, mean: 0.6, sd: 0.4 }], rng2);
    picks2[p.level] = (picks2[p.level] || 0) + 1;
  }
  check("thompson explores under uncertainty", (picks2[10] || 0) > 10, picks2);
  check("thompson exploits under certainty", (picks[10] || 0) < 5, picks);
}

/* ---------------- preference learning flow ---------------- */
{
  section("preference learning");
  const w = makeWorld();
  const L = w.OF.learn;
  const prescribed = [{ name: "Bulgarian Split Squat" }, { name: "Bench Press" }];
  for (let i = 0; i < 4; i++) {
    L.recordSessionOutcome(prescribed, [
      { name: "Bench Press", sets: [{ reps: 8 }] },
      { name: "Leg Press", sets: [{ reps: 10 }] }   // trained legs anyway → SWAP signal
    ]);
  }
  const sug = L.dislikeSuggestions();
  check("swapped exercise flagged as dislike", sug.length === 1 && sug[0].nameLower === "bulgarian split squat", sug);
  check("completed exercise NOT flagged", !sug.some(x => x.nameLower === "bench press"));
  // fewer than MIN_OFFERS: silent
  const w2 = makeWorld();
  w2.OF.learn.recordSessionOutcome([{ name: "Cable Fly" }], []);
  check("one skip is not a verdict", w2.OF.learn.dislikeSuggestions().length === 0);
  // confirm updates avoid list + profile
  const w3 = makeWorld();
  const L3 = w3.OF.learn;
  for (let i = 0; i < 4; i++) L3.recordSessionOutcome([{ name: "Walking Lunge" }], [{ name: "Leg Press", sets: [{ reps: 9 }] }]);
  L3.confirmDislike("walking lunge");
  const prog = w3.OF.trainer.createProgram({ daysPerWeek: 3, equipment: "full-gym", experience: "intermediate", sessionMinutes: 60 });
  const names = prog.days.flatMap(d => d.slots.map(x => x.name));
  check("confirmed dislike never prescribed", !names.includes("Walking Lunge"), names);
  check("confirmed dislike in profile", w3.OF.profile.get().prefs.dislikes.includes("walking lunge"));
}

/* ---------------- program generation ---------------- */
{
  section("program generation — legacy no-regression");
  const w = makeWorld();
  const p = w.OF.trainer.createProgram({ daysPerWeek: 4, equipment: "full-gym", experience: "intermediate", sessionMinutes: 60 });
  check("no profile → coach2 is null", p.coach2 === null);
  check("legacy split name preserved", p.split === "Upper / Lower", p.split);
  check("legacy day count", p.days.length === 4);
  const w1b = makeWorld();
  const pb = w1b.OF.trainer.createProgram({ daysPerWeek: 3, equipment: "bodyweight", experience: "beginner", sessionMinutes: 45 });
  check("bodyweight program uses only bw moves", pb.days.every(d => d.slots.every(x =>
    ["Push-Up", "Dips (Chest)", "Pull-Up", "Inverted Row", "Pike Push-Up", "Bulgarian Split Squat",
     "Walking Lunge", "Calf Raise", "Chin-Up", "Dips (Triceps)", "Plank", "Hanging Leg Raise", "Russian Twist"].includes(x.name))),
    pb.days.flatMap(d => d.slots.map(x => x.name)));
}
{
  section("program generation — Coach 2.0");
  const w = makeWorld();
  w.OF.profile.update({
    goals: { primary: "muscle" },
    prefs: { split: "ppl", daysPerWeek: 5, sessionMinutes: 60, likes: ["Bench Press"], dislikes: ["Romanian Deadlift"] },
    experience: { trainingAgeYears: 2 },
    constraints: { equipment: "full-gym", injuries: [{ area: "knee", aggravates: ["squat", "lunge"] }] }
  }, "intake");
  w.data = w.data || {};
  const p = w.OF.trainer.createProgram({ daysPerWeek: 5, equipment: "full-gym", experience: "intermediate", sessionMinutes: 60 });
  check("split honors preference", p.split.includes("Push / Pull / Legs"), p.split);
  const all = p.days.flatMap(d => d.slots.map(x => x.name));
  const banned = ["Back Squat", "Front Squat", "Goblet Squat", "Leg Press", "Bulgarian Split Squat",
    "Walking Lunge", "Leg Extension", "Romanian Deadlift"];
  check("injury + dislike exclusions hold everywhere", !all.some(n => banned.includes(n)), all.filter(n => banned.includes(n)));
  const band = p.coach2.volumeBand;
  const pg = p.coach2.perGroupWeeklySets;
  check("every trained group within evidence band", Object.values(pg).every(v => v.sets >= band[0] - 2 && v.sets <= band[1]), pg);
  check("liked exercise leads its day", p.days[0].slots[0].name === "Bench Press");
  check("whys reference evidence entries", p.coach2.whys.volume.ids.includes("volume-hypertrophy-range"));
  check("session caps respected", p.days.every(d => d.slots.length <= 7), p.days.map(d => d.slots.length));
  // beginner scaling still applies
  const wB = makeWorld();
  wB.OF.profile.update({ goals: { primary: "muscle" }, prefs: { daysPerWeek: 3 },
    experience: { trainingAgeYears: 0 }, constraints: { equipment: "full-gym" } }, "intake");
  const pB = wB.OF.trainer.createProgram({ daysPerWeek: 3, equipment: "full-gym", experience: "beginner", sessionMinutes: 60 });
  const bandB = pB.coach2.volumeBand;
  check("beginner band lower than intermediate", bandB[1] <= band[1], [bandB, band]);
}

/* ---------------- weekly review + deload gate ---------------- */
{
  section("weekly review");
  const w = makeWorld();
  // 8 weeks of logs at ~12 sets/wk for Chest, growing 0.6%/wk, good sleep
  let e1 = 100;
  const start = Date.parse("2026-05-04T12:00:00Z");
  for (let wk = 0; wk < 8; wk++) {
    for (let s = 0; s < 3; s++) {
      const date = new Date(start + (wk * 7 + s * 2) * 86400000).toISOString().slice(0, 10);
      w.data.exercise.push({ date, exercises: [{ name: "Bench Press", sets: Array(4).fill({ weightKg: e1, reps: 8 }) }] });
      w.data.sleep.push({ date, durationMin: 460 });
    }
    e1 = Math.round(e1 * 1.006 * 10) / 10;
  }
  w.now = start + 60 * 86400000;
  const rev = w.OF.learn.weeklyReview(42);
  check("review produces decisions", rev.decisions.length >= 1, rev.decisions.length);
  check("no deload when progressing", rev.deload === false);
  const chest = rev.decisions.find(d => d.group === "Chest");
  check("moves stay within ±2 sets", !chest || Math.abs(chest.move) <= 2, chest);
  check("band respected", !chest || (chest.target >= rev.band[0] && chest.target <= rev.band[1]));
  w.OF.learn.applyReview(rev);
  const rev2 = w.OF.learn.weeklyReview(43);
  const chest2 = rev2.decisions.find(d => d.group === "Chest");
  check("dwell: no second move within 14 days", !chest || !chest.move || !chest2 || chest2.move === 0, chest2);
}

/* ---------------- user-panel regressions (25 synthetic testers) ----------------
   Each of these locks in a fix for a complaint raised independently by 2+
   personas. They exist so the fixes can never silently regress. */
{
  section("user-panel regressions");
  // 1. the interview must USE the answers it collects (4 personas)
  const wHeavy = makeWorld();
  wHeavy.OF.profile.update({ goals: { primary: "muscle" }, prefs: { daysPerWeek: 3, style: "heavy" },
    experience: { trainingAgeYears: 2 }, constraints: { equipment: "full-gym" } }, "intake");
  const pHeavy = wHeavy.OF.trainer.createProgram({ daysPerWeek: 3, equipment: "full-gym", experience: "intermediate", sessionMinutes: 60 });
  const wPump = makeWorld();
  wPump.OF.profile.update({ goals: { primary: "muscle" }, prefs: { daysPerWeek: 3, style: "pump" },
    experience: { trainingAgeYears: 2 }, constraints: { equipment: "full-gym" } }, "intake");
  const pPump = wPump.OF.trainer.createProgram({ daysPerWeek: 3, equipment: "full-gym", experience: "intermediate", sessionMinutes: 60 });
  const topReps = p => p.days[0].slots.filter(x => !x.hold)[0].repHigh;
  check("style 'heavy' lowers the rep target", topReps(pHeavy) < topReps(pPump), [topReps(pHeavy), topReps(pPump)]);
  check("style note is surfaced to the user", !!pHeavy.coach2.styleNote);
  const wCardio = makeWorld();
  wCardio.OF.profile.update({ goals: { primary: "muscle" }, prefs: { daysPerWeek: 3, cardio: "run" },
    experience: { trainingAgeYears: 2 }, constraints: { equipment: "full-gym" } }, "intake");
  const pCardio = wCardio.OF.trainer.createProgram({ daysPerWeek: 3, equipment: "full-gym", experience: "intermediate", sessionMinutes: 60 });
  check("a cardio preference produces real guidance", /run/i.test(pCardio.coach2.cardioNote || ""), pCardio.coach2.cardioNote);

  // 2. bodyweight users must actually progress (their reps go up)
  const wBw = makeWorld();
  wBw.OF.profile.update({ goals: { primary: "muscle" }, prefs: { daysPerWeek: 3 },
    experience: { trainingAgeYears: 0 }, constraints: { equipment: "bodyweight" } }, "intake");
  const pBw = wBw.OF.trainer.createProgram({ daysPerWeek: 3, equipment: "bodyweight", experience: "beginner", sessionMinutes: 45 });
  const bwEx = pBw.days[0].slots.find(x => !x.hold && x.weightKg == null);
  const beforeHigh = bwEx.repHigh;
  // log every set at the TOP of the range → the target must get harder
  const res = wBw.OF.trainer.completeSession(0, [{ name: bwEx.name,
    sets: Array(bwEx.sets).fill({ weightKg: null, reps: bwEx.repHigh }) }]);
  const after = wBw.OF.trainer.load().days[0].slots.find(x => x.name === bwEx.name);
  check("bodyweight progression exists (reps go up)", after.repHigh > beforeHigh, [beforeHigh, after.repHigh]);
  check("bodyweight progression is reported to the user", res.changes.some(c => c.kind === "reps-up"));

  // 3. swapping must NOT permanently blacklist (3 personas)
  const wSwap = makeWorld();
  wSwap.OF.trainer.createProgram({ daysPerWeek: 3, equipment: "full-gym", experience: "intermediate", sessionMinutes: 60 });
  const before = wSwap.OF.trainer.load().days[0].slots[0].name;
  const sw = wSwap.OF.trainer.swapSlot(0, 0);         // default: no ban
  check("a plain swap changes the exercise", sw && sw.to !== before);
  check("a plain swap does NOT blacklist the old lift", sw.banned === false);
  const regen = wSwap.OF.trainer.createProgram({ daysPerWeek: 3, equipment: "full-gym", experience: "intermediate", sessionMinutes: 60 });
  check("the swapped-out lift can still be prescribed",
    regen.days.flatMap(d => d.slots.map(x => x.name)).includes(before), before);
  wSwap.OF.trainer.addAvoid(before);                  // explicit "never again"
  const regen2 = wSwap.OF.trainer.createProgram({ daysPerWeek: 3, equipment: "full-gym", experience: "intermediate", sessionMinutes: 60 });
  check("an explicit ban IS respected", !regen2.days.flatMap(d => d.slots.map(x => x.name)).includes(before));
  wSwap.OF.trainer.unavoid(before);                   // per-item undo (didn't exist)
  const regen3 = wSwap.OF.trainer.createProgram({ daysPerWeek: 3, equipment: "full-gym", experience: "intermediate", sessionMinutes: 60 });
  check("a ban can be undone per-item", regen3.days.flatMap(d => d.slots.map(x => x.name)).includes(before));

  // 4. injuries: multiple, and core is excludable (postpartum + chronic-pain testers)
  const wInj = makeWorld();
  wInj.OF.profile.update({ goals: { primary: "muscle" }, prefs: { daysPerWeek: 3 },
    experience: { trainingAgeYears: 2 },
    constraints: { equipment: "full-gym", injuries: [
      { area: "core", aggravates: ["core"] },
      { area: "shoulder", aggravates: ["overhead"] }
    ] } }, "intake");
  const pInj = wInj.OF.trainer.createProgram({ daysPerWeek: 3, equipment: "full-gym", experience: "intermediate", sessionMinutes: 60 });
  const injNames = pInj.days.flatMap(d => d.slots.map(x => x.name));
  check("core-pattern exclusion works (was impossible)",
    !injNames.some(n => ["Hanging Leg Raise", "Cable Crunch", "Russian Twist", "Plank"].includes(n)), injNames);
  check("a SECOND injury is excluded too",
    !injNames.some(n => ["Overhead Press", "Seated Dumbbell Press", "Pike Push-Up", "Overhead Triceps Extension"].includes(n)));
}

report("coach2-tests");

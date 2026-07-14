/* Shared node shim for Coach 2.0 tests: loads the app modules with a fake
   DOM-free environment. Fresh state per makeWorld() call. */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function makeWorld(data = {}) {
  const store = {};
  const g = globalThis;
  g.window = g;
  g.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
  const world = { data: { sleep: [], food: [], exercise: [], body: [], goal: [], ...data } };
  g.OF = {
    util: {
      todayISO: (o) => {
        const d = new Date((world.now || Date.now()) + (o || 0) * 86400000);
        return d.toISOString().slice(0, 10);
      },
      byNewest: (a, b) => String(b.date || "").localeCompare(String(a.date || "")),
      esc: (s) => String(s == null ? "" : s),
      fmtWeight: (kg) => kg + " kg",
      toast: () => {}
    },
    storage: {
      getAll: (t) => world.data[t] || [],
      add: (t, r) => { const rec = { ...r, id: "t" + Math.random() }; (world.data[t] = world.data[t] || []).push(rec); return rec; }
    },
    goals: { activeGoal: () => world.data.goal[world.data.goal.length - 1] || null },
    exerciseLibrary: {
      muscleGroupFor: (n) => {
        n = String(n).toLowerCase();
        if (/bench|fly|push-up|dip.*chest/.test(n)) return "Chest";
        if (/row|pull-up|pulldown|deadlift(?!.*romanian)/.test(n)) return "Back";
        if (/squat|lunge|leg|calf|hip thrust|romanian/.test(n)) return "Legs";
        if (/overhead press|shoulder|lateral|rear delt|pike|face pull/.test(n)) return "Shoulders";
        if (/curl|chin-up/.test(n)) return "Biceps";
        if (/triceps|pushdown/.test(n)) return "Triceps";
        return "Other";
      }
    },
    icons: { get: () => "" }
  };
  // fresh module instances each world (bust require cache)
  for (const f of ["evidence", "coach-profile", "coach-learn", "trainer", "coach-intake"]) {
    delete require.cache[require.resolve(join(ROOT, "app/js", f + ".js"))];
  }
  require(join(ROOT, "app/js/evidence.js"));
  require(join(ROOT, "app/js/coach-profile.js"));
  require(join(ROOT, "app/js/coach-learn.js"));
  require(join(ROOT, "app/js/trainer.js"));
  require(join(ROOT, "app/js/coach-intake.js"));
  world.OF = g.OF;
  world.store = store;
  return world;
}

let passed = 0, failed = 0;
export function check(name, cond, detail) {
  if (cond) { passed++; }
  else { failed++; console.error("  ✗ FAIL:", name, detail !== undefined ? "— " + JSON.stringify(detail) : ""); }
}
export function section(name) { console.log("· " + name); }
export function report(label) {
  console.log(`\n${label}: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

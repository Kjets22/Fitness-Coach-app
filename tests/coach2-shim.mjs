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
      fmtDuration: (min) => {
        if (min == null || isNaN(min)) return "?";
        min = Math.round(min);
        const h = Math.floor(min / 60), m = min - h * 60;
        return h + "h " + (m < 10 ? "0" : "") + m + "m";
      },
      timeToMinutes: (t) => {
        const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || "").trim());
        return m ? +m[1] * 60 + +m[2] : null;
      },
      muscleKg: (r) => {
        const v = Number(r && r.muscleMassKg);
        return isFinite(v) && v > 0 ? v : null;
      },
      toast: () => {}
    },
    storage: {
      // Mirror the REAL storage.js contract: it enforces a type whitelist and
      // THROWS on anything else. A permissive stub hid a bug where goals.js
      // wrote to an unregistered type and took the goal card down at render.
      TYPES: ["sleep", "food", "exercise", "body", "water", "steps", "goal",
              "adjustments", "physique", "activeEnergy"],
      _assert(t) {
        if (this.TYPES.indexOf(t) === -1) throw new Error("Unknown record type: " + t);
      },
      getAll(t) { this._assert(t); return world.data[t] || []; },
      add(t, r) {
        this._assert(t);
        const rec = { ...r, id: "t" + Math.random() };
        (world.data[t] = world.data[t] || []).push(rec);
        return rec;
      },
      update(t, id, patch) {
        this._assert(t);
        const arr = world.data[t] || [];
        const i = arr.findIndex((x) => x.id === id);
        if (i < 0) return false;
        arr[i] = { ...arr[i], ...patch };
        return true;
      },
      remove(t, id) {
        this._assert(t);
        const arr = world.data[t] || [];
        const i = arr.findIndex((x) => x.id === id);
        if (i < 0) return false;
        arr.splice(i, 1);
        return true;
      }
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
  for (const f of ["evidence", "coach-profile", "coach-learn", "trainer", "coach-intake", "targets-engine", "insights-engine", "next-move"]) {
    delete require.cache[require.resolve(join(ROOT, "app/js", f + ".js"))];
  }
  require(join(ROOT, "app/js/evidence.js"));
  require(join(ROOT, "app/js/coach-profile.js"));
  require(join(ROOT, "app/js/coach-learn.js"));
  require(join(ROOT, "app/js/trainer.js"));
  require(join(ROOT, "app/js/coach-intake.js"));
  require(join(ROOT, "app/js/targets-engine.js"));
  require(join(ROOT, "app/js/insights-engine.js"));
  require(join(ROOT, "app/js/next-move.js"));
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

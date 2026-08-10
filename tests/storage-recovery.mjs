/* storage-recovery.mjs — data-loss regression suite.
   Krish reported logged food going missing after returning to the app.
   Root causes: cloud-sync wiped local records BEFORE it had the account's
   backup in hand (an empty pull left him with nothing), and the tracker
   lists never re-rendered for records that arrived from a sync/import.
   These tests pin the safety net: every destructive path snapshots first,
   the snapshot survives the wipe, and restoring MERGES so nothing newer
   is ever overwritten. Run: node tests/storage-recovery.mjs */
globalThis.window = globalThis;
const store = {};
globalThis.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
  get length() { return Object.keys(store).length; },
  key: i => Object.keys(store)[i]
};
Object.defineProperty(globalThis.localStorage, Symbol.iterator, { value: undefined });
globalThis.document = { addEventListener(){}, getElementById(){ return null; } };
const { createRequire } = await import("node:module");
const require = createRequire(import.meta.url);
const R = "/Users/krishjetly/Fitness-Coach-app/app/js/";
require(R + "util.js"); require(R + "storage.js");
const S = OF.storage;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? pass++ : (fail++, console.log("  FAIL:", n, d ?? ""));

// a day of real logging
S.add("food", { date: "2026-08-10", foodName: "chicken bowl", calories: 700, protein: 55 });
S.add("food", { date: "2026-08-10", foodName: "oats", calories: 400, protein: 20 });
S.add("body", { date: "2026-08-10", weightKg: 88 });
check("3 records logged", S.countAll() === 3, S.countAll());

// the destructive path takes a snapshot first
check("snapshot taken", S.snapshotForRecovery("account-switch") === true);
const info = S.recoveryInfo();
check("snapshot describes itself", info && info.records === 3 && info.reason === "account-switch", info);

// simulate the account-switch wipe (same KEEP semantics as cloud-sync)
Object.keys(store).filter(k => k.startsWith("optimalfit.") && k !== "optimalfit.recovery")
  .forEach(k => delete store[k]);
check("wipe emptied the store", S.countAll() === 0, S.countAll());
check("the safety copy SURVIVED the wipe", !!S.recoveryInfo());

// the user hits "Put my data back"
const restored = S.restoreFromRecovery();
check("restore returns the count", restored === 3, restored);
check("every record is back", S.countAll() === 3, S.countAll());
const foods = S.getAll("food").map(f => f.foodName).sort();
check("the actual meals are back", foods.join(",") === "chicken bowl,oats", foods);

// restoring twice must not duplicate (merge: local wins)
check("second restore adds nothing", S.restoreFromRecovery() === 0);
check("still exactly 3", S.countAll() === 3, S.countAll());

// a NEWER local entry is never overwritten by the older snapshot
S.add("food", { date: "2026-08-10", foodName: "post-wipe protein shake", calories: 200 });
S.restoreFromRecovery();
check("newer entry survives a restore",
  S.getAll("food").some(f => f.foodName === "post-wipe protein shake"));
check("count is 4, not clobbered", S.countAll() === 4, S.countAll());

// snapshotting an empty store is refused (nothing worth saving)
Object.keys(store).forEach(k => delete store[k]);
check("empty store is not snapshotted", S.snapshotForRecovery("x") === false);
check("no snapshot to offer", S.recoveryInfo() === null);

console.log(`\nrecovery: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

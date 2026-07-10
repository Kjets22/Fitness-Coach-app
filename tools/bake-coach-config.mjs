#!/usr/bin/env node
/*
 * bake-coach-config.mjs — write the coach server URL + access key from the
 * gitignored .env.coach into app/js/coach-config.js before a build.
 *
 * coach-config.js ships a placeholder in the repo (the real host+key are NOT
 * committed — the repo is public, and anyone with them could use your Claude
 * account). This file bakes the real values into your LOCAL build. Run it once
 * after a fresh clone, or whenever you rotate the key:
 *
 *   node tools/bake-coach-config.mjs
 *
 * On the owner's machine coach-config.js is marked skip-worktree, so these
 * baked values never get committed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
try {
  for (const line of readFileSync(join(root, ".env.coach"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  console.error("No .env.coach found — copy .env.coach.example, or set OPTIMALFIT_PUBLIC_HOST + OPTIMALFIT_ACCESS_KEY.");
  process.exit(1);
}
const host = env.OPTIMALFIT_PUBLIC_HOST || "";
const key = env.OPTIMALFIT_ACCESS_KEY || "";
if (!host || !key) { console.error("Missing OPTIMALFIT_PUBLIC_HOST / OPTIMALFIT_ACCESS_KEY in .env.coach"); process.exit(1); }

const path = join(root, "app/js/coach-config.js");
let s = readFileSync(path, "utf8");
s = s.replace(/url:\s*"[^"]*"/, `url: "https://${host}"`);
s = s.replace(/key:\s*"[^"]*"/, `key: "${key}"`);
writeFileSync(path, s);
console.log(`Baked coach-config.js -> https://${host} (key ${key.slice(0, 4)}…)`);

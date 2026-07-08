// copy-web.js — mirror C:\Users\kjets\optimal-fit\app -> native\www for Capacitor.
// Run via `npm run copy-web` (or `npm run sync`, which also runs `npx cap sync`).
//
// Why a Node script instead of robocopy in the npm script: robocopy exits 1-7 on
// SUCCESS, which npm treats as failure; this avoids that whole class of problem
// and lets us neutralize sw.js in the same step.
//
// sw.js neutralization: the web app registers a service worker (app/sw.js,
// cache-first PWA shell). Inside the native WebView a service worker is useless
// and causes stale-asset headaches after every sync. We may NOT edit app/
// (browser/PWA users still need the real sw.js), so instead the copy REPLACES
// www/sw.js with a tiny self-unregistering no-op worker. index.html still
// registers "sw.js", but what it gets immediately unregisters itself, so the
// native app always loads fresh assets from the bundle.

"use strict";
const fs = require("fs");
const path = require("path");

const SRC = path.resolve(__dirname, "..", "..", "app");
const DEST = path.resolve(__dirname, "..", "www");

const NOOP_SW =
  "// Neutralized service worker for the native (Capacitor) build.\n" +
  "// The real PWA worker lives in app/sw.js; inside the native WebView a SW\n" +
  "// only causes stale-cache problems, so this one unregisters itself.\n" +
  "self.addEventListener('install',()=>self.skipWaiting());\n" +
  "self.registration.unregister();\n";

if (!fs.existsSync(path.join(SRC, "index.html"))) {
  console.error("copy-web: source app not found at " + SRC);
  process.exit(1);
}

// Mirror: wipe www entirely, then copy fresh (removes files deleted from app/).
fs.rmSync(DEST, { recursive: true, force: true });
fs.cpSync(SRC, DEST, { recursive: true });

// Neutralize the service worker in the native copy.
fs.writeFileSync(path.join(DEST, "sw.js"), NOOP_SW, "utf8");

// Quick sanity report.
const count = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).reduce(
    (n, e) => n + (e.isDirectory() ? count(path.join(dir, e.name)) : 1),
    0
  );
console.log(
  "copy-web: mirrored " + SRC + " -> " + DEST + " (" + count(DEST) +
  " files), sw.js replaced with self-unregistering no-op."
);

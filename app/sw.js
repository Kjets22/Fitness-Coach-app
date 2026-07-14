/* ============================================================
   sw.js — OptimalFit service worker (PWA offline shell).

   Strategy:
     - App shell (HTML/CSS/JS/icons/manifest): CACHE-FIRST.
       Everything is precached at install under a versioned cache;
       bump VERSION whenever any shell file changes and the new
       worker replaces the old cache on its next activation
       (skipWaiting + clients.claim → new assets on next load).
     - /api/* : NETWORK-ONLY, never cached (coach + health must
       always hit the live server).

   Registered from app.js only on https:// or localhost — the app
   keeps working from file:// and plain LAN http without it.
   ============================================================ */

/* Bump this string when any shell file changes. */
var VERSION = "v57";
var CACHE = "optimalfit-shell-" + VERSION;

var SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/style.css",
  "./js/util.js",
  "./js/icons.js",
  "./js/ui.js",
  "./js/storage.js",
  "./js/units.js",
  "./js/sleep.js",
  "./js/food.js",
  "./js/coach-config.js",
  "./js/food-photo.js",
  "./js/exercise-library.js",
  "./js/exercise.js",
  "./js/trainer.js",
  "./js/body.js",
  "./js/physique.js",
  "./js/charts.js",
  "./js/insights-engine.js",
  "./js/strength-engine.js",
  "./js/targets-engine.js",
  "./js/goals.js",
  "./js/daily.js",
  "./js/streak.js",
  "./js/dashboard.js",
  "./js/insights.js",
  "./js/coach.js",
  "./js/health-import.js",
  "./js/health-sync.js",
  "./js/demo.js",
  "./js/settings.js",
  "./js/vendor/supabase.js",
  "./js/social-api.js",
  "./js/entitlements.js",
  "./js/social.js",
  "./js/social-profile.js",
  "./js/social-compose.js",
  "./js/receipts.js",
  "./js/onboarding.js",
  "./js/app.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) { return cache.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k.indexOf("optimalfit-shell-") === 0 && k !== CACHE) {
          return caches.delete(k);
        }
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;              // POST /api/coach etc: network
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf("/api/") === 0) return; // network-only, never cached

  // Single-page app: any navigation is served by the cached index.html.
  if (req.mode === "navigate") {
    event.respondWith(
      caches.match("./index.html").then(function (hit) {
        return hit || fetch(req);
      })
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(function (hit) {
      return hit || fetch(req);
    })
  );
});

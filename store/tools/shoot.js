/* ============================================================
   shoot.js — store screenshot generator for OptimalFit.
   Drives the system Edge (fallback: Chrome) headless via
   puppeteer-core against a local python http.server on :8651.

   - Seeds localStorage (optimalfit.prefs introSeen:true) before
     any app script runs, generates seeded demo data (60 days).
   - Mocks /api/health + /api/coach via a fetch shim injected
     with evaluateOnNewDocument — NO real LLM is ever called.
   - Captures at device-pixel-exact sizes:
       Play  phone : 360x720  CSS px @3x = 1080x2160
                     (max dim <= 2x min dim — Play rejects taller;
                      the old 1080x2340 was 2.17:1, QA4-1)
       iPhone 6.7" : 430x932  CSS px @3x = 1290x2796
   - Onboarding shot is taken LAST per size (localStorage is
     cleared to trigger it; next size re-seeds deterministically).
   ============================================================ */
"use strict";

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const BASE = "http://127.0.0.1:8651";
const OUT = path.resolve(__dirname, "..", "screenshots");

/* Edge headless (both --headless and --headless=new) produces no output on
   this machine (exits code 0 instantly under puppeteer) — Chrome works, so
   Chrome is preferred and Edge is the fallback. Verified 2026-07-07. */
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EXE = fs.existsSync(CHROME) ? CHROME : EDGE;
const PROFILE = path.join(require("os").tmpdir(), "of-shoot-profile");

const SIZES = [
  { tag: "play-1080x2160", width: 360, height: 720, dpr: 3 },   // Google Play phone (2:1 cap)
  { tag: "iphone67-1290x2796", width: 430, height: 932, dpr: 3 } // iPhone 6.7"
];

const CANNED_ANSWER =
  "Great week to build on! Your data says morning sessions are your strongest " +
  "(3.8/5 avg vs 3.1 in the afternoon), and performance jumps after 7+ hours of sleep.\n\n" +
  "Plan for next week:\n" +
  "- Train Tue / Thu / Fri mornings (your best slots)\n" +
  "- Keep a carb-rich meal 1-2 h before each session\n" +
  "- Aim for 7.5 h of sleep the night before training\n" +
  "- Rest Wed + Sun - your logs show a dip on 3rd consecutive days\n\n" +
  "You're 23% of the way to your lean-bulk goal and trending on schedule. Keep logging!";

const CHIP_QUESTION_FALLBACK = "Plan my workouts for next week";

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function newAppPage(browser, size) {
  const page = await browser.newPage();
  await page.setViewport({
    width: size.width, height: size.height,
    deviceScaleFactor: size.dpr, isMobile: true, hasTouch: true
  });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);

  // Runs before ANY app script on every navigation of this page.
  await page.evaluateOnNewDocument((canned) => {
    // 1) fetch shim: coach API is fully mocked — no server, no LLM.
    const realFetch = window.fetch ? window.fetch.bind(window) : null;
    window.fetch = function (url, opts) {
      const u = String(url);
      if (u.indexOf("/api/health") !== -1) {
        return Promise.resolve(new Response(
          JSON.stringify({ ok: true, claude: true, phoneMode: false }),
          { status: 200, headers: { "Content-Type": "application/json" } }));
      }
      if (u.indexOf("/api/coach") !== -1) {
        return new Promise(function (resolve) {
          setTimeout(function () {
            resolve(new Response(
              JSON.stringify({ ok: true, answer: canned }),
              { status: 200, headers: { "Content-Type": "application/json" } }));
          }, 700);
        });
      }
      return realFetch ? realFetch(url, opts) : Promise.reject(new Error("no fetch"));
    };
    // 2) keep the service worker out of the way (fresh profile anyway,
    //    but a cache-first SW could serve a stale shell between runs).
    if (navigator.serviceWorker && navigator.serviceWorker.register) {
      navigator.serviceWorker.register = function () {
        return Promise.reject(new Error("SW disabled for screenshots"));
      };
    }
  }, CANNED_ANSWER);

  return page;
}

async function seedDemo(page) {
  // introSeen BEFORE load so onboarding never fires for the data shots.
  await page.evaluateOnNewDocument(() => {
    try {
      if (!localStorage.getItem("optimalfit.prefs")) {
        localStorage.setItem("optimalfit.prefs", JSON.stringify({ introSeen: true }));
      }
    } catch (e) { /* ignore */ }
  });
  await page.goto(BASE + "/#dashboard", { waitUntil: "load", timeout: 30000 });
  const counts = await page.evaluate(() => {
    if (OF.storage.countAll() === 0) OF.demo.generate(60);
    // Marketing polish (QA-4 note): the dashboard "Workouts this week"
    // card must not read 0. If the seeded data left Mon..today empty
    // (demo date early in the week), add 1-2 believable sessions.
    function iso(d) {
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
        "-" + String(d.getDate()).padStart(2, "0");
    }
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7)); // back to Monday
    const ws = iso(monday);
    const thisWeek = OF.storage.getAll("exercise").filter(r => r.date >= ws);
    if (thisWeek.length === 0) {
      OF.storage.add("exercise", {
        date: ws, startTime: "07:30", type: "strength",
        durationMin: 55, intensity: 4, performance: 4
      });
      if (iso(now) !== ws) {
        OF.storage.add("exercise", {
          date: iso(now), startTime: "07:15", type: "strength",
          durationMin: 45, intensity: 3, performance: 4
        });
      }
    }
    return OF.storage.countAll();
  });
  // reload so init (incl. goal adaptation catch-up + hero ring) runs with data
  await page.reload({ waitUntil: "load", timeout: 30000 });
  await sleep(800);
  return counts;
}

async function gotoTab(page, tab) {
  await page.evaluate((t) => { location.hash = t; }, tab);
  await sleep(900); // charts/rings render synchronously; small settle buffer
}

async function shot(page, size, n, name) {
  const file = path.join(OUT, `${size.tag}-${String(n).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file }); // viewport x dpr = exact device pixels
  console.log("  saved", path.basename(file));
}

async function captureSize(browser, size) {
  console.log(`\n=== ${size.tag} (${size.width}x${size.height} @${size.dpr}x) ===`);
  const page = await newAppPage(browser, size);

  const count = await seedDemo(page);
  console.log("  demo records:", count);

  // 1. Dashboard (hero greeting + readiness ring + stat cards)
  await gotoTab(page, "dashboard");
  await shot(page, size, 1, "dashboard");

  // 2. Insights — goal card renders at the top (#goal-area)
  await gotoTab(page, "insights");
  await page.evaluate(() => { const el = document.getElementById("goal-area"); if (el) el.scrollIntoView(); window.scrollTo(0, 0); });
  await sleep(300);
  await shot(page, size, 2, "insights-goal");

  // 3. Daily (water + steps)
  await gotoTab(page, "daily");
  await shot(page, size, 3, "daily-water-steps");

  // 4. Food tracker
  await gotoTab(page, "food");
  await shot(page, size, 4, "food-tracker");

  // 5. Coach — mocked local chat (fetch shim), zero real LLM calls
  await gotoTab(page, "coach");
  await page.waitForSelector(".coach-chip, #coach-input", { timeout: 10000 });
  const clicked = await page.evaluate(() => {
    const chip = document.querySelector(".coach-chip");
    if (chip) { chip.click(); return true; }
    return false;
  });
  if (!clicked) {
    await page.evaluate((q) => {
      const inp = document.getElementById("coach-input");
      inp.value = q;
      document.getElementById("coach-form").dispatchEvent(new Event("submit", { cancelable: true }));
    }, CHIP_QUESTION_FALLBACK);
  }
  await page.waitForFunction(() => {
    const b = document.querySelectorAll(".bubble-coach:not(.bubble-thinking)");
    return b.length > 0;
  }, { timeout: 15000 });
  await sleep(400);
  await shot(page, size, 5, "coach-chat");

  await page.close();

  // 6. Onboarding step 1 — fresh profile. Must be a NEW page: the demo
  // page's evaluateOnNewDocument seeder re-writes introSeen on every
  // navigation, which suppresses the overlay (bit us on the first run).
  const fresh = await newAppPage(browser, size);
  await fresh.goto(BASE + "/#dashboard", { waitUntil: "load", timeout: 30000 });
  await fresh.evaluate(() => { localStorage.clear(); });
  await fresh.reload({ waitUntil: "load", timeout: 30000 });
  await sleep(1200); // onboarding overlay appears at init
  const hasOverlay = await fresh.evaluate(() =>
    !!document.querySelector('[id*="onboard"], [class*="onboard"]'));
  if (!hasOverlay) console.warn("  WARNING: onboarding overlay not detected!");
  await shot(fresh, size, 6, "onboarding-welcome");
  await fresh.close();
}

(async () => {
  if (!fs.existsSync(EXE)) {
    console.error("No system Edge/Chrome found — cannot capture.");
    process.exit(2);
  }
  console.log("Browser:", EXE);
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: EXE,
    headless: true,
    userDataDir: PROFILE,
    args: ["--no-first-run", "--disable-extensions", "--hide-scrollbars",
      "--disable-gpu", "--force-device-scale-factor=1"]
  });

  try {
    for (const size of SIZES) await captureSize(browser, size);
  } finally {
    await browser.close();
  }
  console.log("\nAll screenshots done ->", OUT);
})().catch((e) => { console.error("FAILED:", e); process.exit(1); });

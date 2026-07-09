/* ============================================================
   shoot.js — store screenshot generator for OptimalFit.
   Drives the system Chrome (fallback: Edge) headless via
   puppeteer-core against a local python http.server.

   Two-sided story (Phase 3): the coach engine (solo) PLUS the
   verified-social side (Community feed + Receipts).

   - Seeds localStorage (optimalfit.prefs introSeen:true) + 60 days
     of demo data BEFORE any app script runs → clean solo shots.
   - Mocks /api/coach + /api/health via a fetch shim injected with
     evaluateOnNewDocument — NO real LLM is ever called.
   - Social shots use a DETERMINISTIC in-page mock of OF.socialApi
     (option b): a curated, marketing-clean feed rendered by the
     REAL social UI. ZERO network writes, ZERO backend pollution,
     ZERO LLM. (The live feed carries test junk — "spam post",
     "insane gains" — so mocking gives a clean composition.)
   - Captures at device-pixel-exact sizes:
       Play  phone : 360x720  CSS px @3x = 1080x2160 (2:1 cap)
       iPhone 6.7" : 430x932  CSS px @3x = 1290x2796
   ============================================================ */
"use strict";

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const BASE = process.env.SHOOT_BASE || "http://127.0.0.1:8673";
const OUT = path.resolve(__dirname, "..", "screenshots");

/* System browser. macOS Chrome is preferred here; Windows paths kept as
   fallbacks (Edge headless was broken on the old Windows box — Chrome only). */
const CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
];
const EXE = CANDIDATES.find((p) => fs.existsSync(p));
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

  // Deterministic OF.socialApi mock, patched on DOMContentLoaded BEFORE the
  // app's own init() boots the community tab (our listener registers first,
  // at document-start, so it wins the ordering). Curated marketing-clean
  // feed rendered by the REAL social UI — no network, no backend, no LLM.
  await page.evaluateOnNewDocument(() => {
    document.addEventListener("DOMContentLoaded", function () {
      if (!window.OF || !OF.socialApi) return;
      const A = OF.socialApi;
      const ME = "me";
      const SQUAT_SERIES = [
        { day: "2026-05-19", e1rm: 100 },
        { day: "2026-05-26", e1rm: 103 },
        { day: "2026-06-05", e1rm: 106.5 },
        { day: "2026-06-16", e1rm: 110 },
        { day: "2026-06-27", e1rm: 114 },
        { day: "2026-07-06", e1rm: 117.5 }
      ];
      const SQUAT_RECEIPT = { type: "pr", lift: "Squat", sessions: 6, series: SQUAT_SERIES };
      const profiles = {
        me:    { id: "me",    username: "alex_lifts",  display_name: "Alex Rivera", avatar_url: null,
                 bio: "Powerlifting + marathon base. Data over vibes.",
                 stats_summary: "Trained 5 of the last 7 days · 214 workouts logged · 12-day check-in streak",
                 tos_accepted_at: "2026-05-01T00:00:00Z", created_at: "2026-05-01T00:00:00Z" },
        maya:  { id: "maya",  username: "maya_strong", display_name: "Maya Chen",   avatar_url: null,
                 bio: "Chasing a 120kg squat.", stats_summary: null,
                 tos_accepted_at: "2026-05-01T00:00:00Z", created_at: "2026-05-01T00:00:00Z" },
        jordan:{ id: "jordan",username: "jordan_runs", display_name: "Jordan Blake", avatar_url: null,
                 bio: "5k to marathon.", stats_summary: null,
                 tos_accepted_at: "2026-05-01T00:00:00Z", created_at: "2026-05-01T00:00:00Z" }
      };
      const now = Date.now(), H = 3600 * 1000, D = 24 * H;
      const iso = (msAgo) => new Date(now - msAgo).toISOString();
      const feed = [
        { id: "p1", kind: "receipt", author_id: "maya", username: "maya_strong",
          display_name: "Maya Chen", avatar_url: null, created_at: iso(2 * H),
          caption: "Ten weeks of patient squatting — the data doesn't lie.",
          image_path: null, like_count: 47, comment_count: 6, liked_by_me: true,
          hidden: false, verified: true, receipt: SQUAT_RECEIPT },
        { id: "p2", kind: "workout", author_id: "jordan", username: "jordan_runs",
          display_name: "Jordan Blake", avatar_url: null, created_at: iso(6 * H),
          caption: "Tempo run before sunrise — 8 km @ 4:45/km. Legs felt springy.",
          image_path: null, like_count: 19, comment_count: 2, liked_by_me: false,
          hidden: false, verified: false, receipt: null }
      ];
      const myPosts = [
        { id: "m1", kind: "receipt", author_id: "me", username: "alex_lifts",
          display_name: "Alex Rivera", avatar_url: null, created_at: iso(1 * D),
          caption: "New squat PR, backed by the numbers.", image_path: null,
          like_count: 33, comment_count: 4, liked_by_me: false, hidden: false,
          verified: true, receipt: SQUAT_RECEIPT },
        { id: "m2", kind: "workout", author_id: "me", username: "alex_lifts",
          display_name: "Alex Rivera", avatar_url: null, created_at: iso(3 * D),
          caption: "Lower body: squats, RDLs, walking lunges. Consistent > heavy.",
          image_path: null, like_count: 21, comment_count: 1, liked_by_me: false,
          hidden: false, verified: false, receipt: null }
      ];
      const leaderboard = [
        { user_id: "maya",   username: "maya_strong", display_name: "Maya Chen",   avatar_url: null, value: 21, rank: 1 },
        { user_id: "me",     username: "alex_lifts",  display_name: "Alex Rivera", avatar_url: null, value: 12, rank: 2 },
        { user_id: "jordan", username: "jordan_runs", display_name: "Jordan Blake", avatar_url: null, value: 9,  rank: 3 },
        { user_id: "sam",    username: "sam_eats",    display_name: "Sam Okafor",   avatar_url: null, value: 7,  rank: 4 },
        { user_id: "priya",  username: "priya_pr",    display_name: "Priya Nair",   avatar_url: null, value: 5,  rank: 5 }
      ];
      const receiptsBoard = [
        { user_id: "me",     username: "alex_lifts",  display_name: "Alex Rivera", avatar_url: null, value: 6, rank: 1 },
        { user_id: "maya",   username: "maya_strong", display_name: "Maya Chen",   avatar_url: null, value: 4, rank: 2 },
        { user_id: "jordan", username: "jordan_runs", display_name: "Jordan Blake", avatar_url: null, value: 3, rank: 3 }
      ];
      const P = (v) => Promise.resolve(v);
      A.available = () => true;
      A.init = () => P(profiles.me);
      A.currentUser = () => profiles.me;
      A.uid = () => ME;
      A.getMyProfile = () => P(profiles.me);
      A.cachedProfile = () => profiles.me;
      A.getProfile = (id) => P(profiles[id] || profiles.me);
      A.getFollowCounts = (id) => P(id === ME ? { followers: 128, following: 84 } : { followers: 42, following: 30 });
      A.isFollowing = () => P(true);
      A.follow = () => P({});
      A.unfollow = () => P({});
      A.getHomeFeed = () => P(feed.slice());
      A.getDiscoverFeed = () => P(feed.slice());
      A.getUserPosts = (id) => P({ posts: id === ME ? myPosts.slice() : [], likedIds: {} });
      A.getComments = () => P([]);
      A.like = () => P({});
      A.unlike = () => P({});
      A.myGyms = () => P([{ id: "g1", name: "Iron Forge Barbell" }]);
      A.getMyCheckIns = () => {
        const days = [];
        for (let i = 0; i < 12; i++) days.push({ day: new Date(now - i * D).toISOString().slice(0, 10) });
        return P(days);
      };
      A.checkIn = () => P({ streak: 12 });
      A.getFriendsLeaderboard = (metric) => P(metric === "receipts" ? receiptsBoard.slice() : leaderboard.slice());
      A.getGymLeaderboard = (gid, metric) => P(metric === "receipts" ? receiptsBoard.slice() : leaderboard.slice());
      A.publicUrl = () => "";
      A.onAuthChange = () => {};
      if (OF.receipts) {
        OF.receipts.available = () => [{
          id: "pr:squat", label: "Squat — new PR",
          sub: "117.5 kg e1RM · 6 sessions over 7 weeks", receipt: SQUAT_RECEIPT
        }];
      }
    });
  });

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
    // 2) keep the service worker out of the way (fresh profile anyway).
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
    // Marketing polish: the dashboard "Workouts this week" card must not
    // read 0. Backfill 1-2 believable sessions if the seed left it empty.
    function iso(d) {
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
        "-" + String(d.getDate()).padStart(2, "0");
    }
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
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

  // ---- SOLO (coach engine — still the crown jewel) ----

  // 1. Dashboard (hero greeting + readiness ring + stat cards)
  await gotoTab(page, "dashboard");
  await shot(page, size, 1, "dashboard");

  // 2. Insights — goal card + coach engine narrative
  await gotoTab(page, "insights");
  await page.evaluate(() => { const el = document.getElementById("goal-area"); if (el) el.scrollIntoView(); window.scrollTo(0, 0); });
  await sleep(300);
  await shot(page, size, 2, "insights-goal");

  // 3. Food tracker (one representative tracker)
  await gotoTab(page, "food");
  await shot(page, size, 3, "food-tracker");

  // 4. Coach — mocked local chat (fetch shim), zero real LLM calls
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
  await shot(page, size, 4, "coach-chat");

  // ---- SOCIAL + RECEIPTS (Phase 3) — deterministic mock (patched at load) ----

  // 5. Community FEED — HERO: verified receipt (this week's drop) + normal post
  await page.evaluate(() => { location.hash = "community"; if (OF.social) OF.social.onEnter(); });
  await page.waitForFunction(() => !!document.querySelector(".soc-post-receipt .soc-verified"), { timeout: 10000 });
  await sleep(500);
  await page.evaluate(() => {
    const h = document.querySelector(".soc-drop-head");
    if (h) h.scrollIntoView({ block: "start" });
  });
  await sleep(300);
  await shot(page, size, 5, "community-feed-verified");

  // 6. Receipt being SHARED — composer with the PR card preview (sparkline)
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    OF.socialCompose.open({ kind: "receipt", receiptId: "pr:squat" });
  });
  await page.waitForFunction(() => !!document.querySelector(".soc-compose-panel .soc-receipt"), { timeout: 10000 });
  await sleep(500);
  await shot(page, size, 6, "receipt-share");
  await page.evaluate(() => { if (OF.social) { OF.social.sheetClose(2); OF.social.sheetClose(1); } });
  await sleep(200);

  // 7. Leaderboard — honest check-in streaks
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    const btn = document.querySelector('[data-act="lb-open"]');
    if (btn) btn.click();
  });
  await page.waitForFunction(() => !!document.querySelector(".soc-lb-rows .soc-lb-row"), { timeout: 10000 });
  await sleep(500);
  await shot(page, size, 7, "leaderboard");
  await page.evaluate(() => { if (OF.social) OF.social.sheetClose(1); });
  await sleep(200);

  // 8. Profile — stats + verified receipt on own profile
  await page.evaluate(() => { window.scrollTo(0, 0); OF.socialProfile.openUser("me"); });
  await page.waitForFunction(() => !!document.querySelector(".soc-prof-stats"), { timeout: 10000 });
  await sleep(500);
  await shot(page, size, 8, "profile-stats");
  await page.evaluate(() => { if (OF.social) OF.social.sheetClose(1); });

  await page.close();
}

(async () => {
  if (!EXE) {
    console.error("No system Chrome/Edge found — cannot capture.");
    process.exit(2);
  }
  console.log("Browser:", EXE);
  console.log("Base   :", BASE);
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

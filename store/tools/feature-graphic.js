/* ============================================================
   feature-graphic.js — renders store/feature-graphic-1024x500.png
   (Google Play feature graphic, exactly 1024x500).

   Same headless setup as shoot.js (puppeteer-core + system Chrome;
   Edge headless is broken on this machine). No server needed —
   the banner is inline HTML via page.setContent. No network, no LLM.

   Usage:  node feature-graphic.js     (from store/tools/)
   ============================================================ */
"use strict";

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const OUT = path.resolve(__dirname, "..", "feature-graphic-1024x500.png");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EXE = fs.existsSync(CHROME) ? CHROME : EDGE;
const PROFILE = path.join(require("os").tmpdir(), "of-shoot-profile");

/* Brand: --bg #0a0e17, gradient --g1 #8b5cf6 -> --g2 #22d3ee (Designer-1). */
const HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1024px; height: 500px; overflow: hidden; }
  body {
    background: #0a0e17;
    font-family: system-ui, "Segoe UI", Roboto, sans-serif;
    display: flex; align-items: center; justify-content: center;
    position: relative;
  }
  .glow1, .glow2 { position: absolute; border-radius: 50%; filter: blur(90px); opacity: .28; }
  .glow1 { width: 520px; height: 520px; background: #8b5cf6; left: -140px; top: -220px; }
  .glow2 { width: 520px; height: 520px; background: #22d3ee; right: -160px; bottom: -260px; }
  .wrap { position: relative; text-align: center; }
  .mark { width: 128px; height: 128px; margin: 0 auto 18px; display: block; }
  h1 {
    font-size: 84px; font-weight: 800; letter-spacing: -2px; line-height: 1;
    background: linear-gradient(100deg, #8b5cf6 10%, #22d3ee 90%);
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  p { margin-top: 18px; font-size: 30px; font-weight: 500; color: #c7d0e2; letter-spacing: .2px; }
</style></head><body>
  <div class="glow1"></div><div class="glow2"></div>
  <div class="wrap">
    <svg class="mark" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#8b5cf6"/><stop offset="1" stop-color="#22d3ee"/>
      </linearGradient></defs>
      <!-- dumbbell: bar + inner/outer plates (make_icons.py geometry x100) -->
      <g fill="url(#g)">
        <rect x="31.5" y="46.4" width="37"   height="7.2"  rx="1.5"/>
        <rect x="22.5" y="29"   width="9"    height="42"   rx="3"/>
        <rect x="68.5" y="29"   width="9"    height="42"   rx="3"/>
        <rect x="13.5" y="36.5" width="7.5"  height="27"   rx="2.8"/>
        <rect x="79"   y="36.5" width="7.5"  height="27"   rx="2.8"/>
      </g>
    </svg>
    <h1>OptimalFit</h1>
    <p>Your data. Your coach. Your best self.</p>
  </div>
</body></html>`;

(async () => {
  if (!fs.existsSync(EXE)) {
    console.error("No system Edge/Chrome found — cannot render.");
    process.exit(2);
  }
  console.log("Browser:", EXE);
  const browser = await puppeteer.launch({
    executablePath: EXE,
    headless: true,
    userDataDir: PROFILE,
    args: ["--no-first-run", "--disable-extensions", "--hide-scrollbars",
      "--disable-gpu", "--force-device-scale-factor=1"]
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1024, height: 500, deviceScaleFactor: 1 });
    await page.setContent(HTML, { waitUntil: "load" });
    await new Promise(r => setTimeout(r, 400)); // font/filter settle
    await page.screenshot({ path: OUT });
    console.log("saved", OUT);
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error("FAILED:", e); process.exit(1); });

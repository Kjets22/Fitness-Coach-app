# OptimalFit — Ship Checklist (today → live in both stores)

The honest, ordered path from this folder to "live". Part A is already done on this machine. Part B is what **only you** can do — mostly account signup, form-filling (answers are pre-written in this folder), and uploads.

---

## PART A — ALREADY DONE (on this PC)

1. ~~Web app finished & QA-hardened~~ — `app/` (3 QA passes + fix rounds; see MINDMAP.md).
2. ~~Professional UI overhaul~~ — P2-2 (dark hero theme, onboarding, 5-tab nav).
3. ~~Android native project~~ — `native/` (Capacitor 8.4.1, appId `com.optimalfit.app`).
4. ~~Android release build, SIGNED~~ — P2-3, in `dist/`:
   - `dist/OptimalFit-release.aab` — **this is what you upload to Google Play**
   - `dist/OptimalFit-release.apk` — direct-install copy (sideload/testing)
   - `dist/OptimalFit-debug.apk` — debug build
   - `dist/optimalfit-release.keystore` + `dist/SIGNING-INFO.txt` — **BACK THESE UP NOW** (two places outside this PC). Losing the keystore = losing the ability to ever update the app.
   - `dist/BUILD-INFO.txt` — versions, SHA-256 checksums, rebuild recipe. Confirmed to contain the final P2-2 UI.
5. ~~This store pack~~ — P2-5, in `store/`:
   - `privacy-policy.md` / `.html`, `terms-of-service.md` / `.html`
   - `play-store-listing.md` (title/descriptions/content-rating/**Data safety answers**)
   - `app-store-listing.md` (name/subtitle/keywords/**App Privacy answers**/age rating)
   - `screenshots/` — 6 screens × 2 sizes: `play-1080x2160-*.png` (Play, 2:1 max ratio respected) and `iphone67-1290x2796-*.png` (App Store 6.7")
   - `KNOWN-LIMITATIONS.md` — honest gaps
   - `tools/shoot.js` — regenerates all screenshots (`python -m http.server 8651` in `app/`, then `node shoot.js` in `store/tools/`; uses system Chrome headless)
6. ~~iOS project + cloud build pipeline~~ — P2-4 (`native/ios/` + `.github/workflows/ios-build.yml`). The full Mac-less guide is at **`docs/IOS-SHIP-GUIDE.md`** — follow it for steps 15–18 below.

---

## PART B — WHAT YOU MUST DO

### Stage 1 — Accounts & hosting (can start today, ~1 hour + waiting)

7. **Host the privacy policy at a public URL** (both stores require one; I could not publish it for you — it needs an account you own).
   Easiest free route, GitHub Pages:
   1. Create a GitHub account (free) → new public repo, e.g. `optimalfit-site`.
   2. Upload `store/privacy-policy.html` and `store/terms-of-service.html`.
   3. Repo Settings → Pages → deploy from branch `main`, root folder.
   4. Your URLs become `https://<username>.github.io/optimalfit-site/privacy-policy.html` (and `.../terms-of-service.html`). Keep these — you'll paste them into both consoles.
   - ✅ **DONE 2026-07-07:** the contact email (Qualixo22@gmail.com) is already filled in throughout the policies and listings — nothing to replace before uploading.
8. **Google Play Console account** — https://play.google.com/console → $25 one-time. Identity verification can take 1–3 days (new personal accounts also require a D-U-N-S only for organizations — personal is fine). Note: brand-new personal accounts must run a 14-day closed test with at least 12 testers before production access is granted — plan for this (see step 12).
9. **Apple Developer Program** — https://developer.apple.com/programs/ → $99/year. Enrollment approval typically 1–2 days.

### Stage 2 — Google Play (Android is 100% ready to upload)

10. Play Console → **Create app** (name: `OptimalFit - Private Fitness`, free, app category Health & Fitness).
11. Complete **App content** (Policy section) using `store/play-store-listing.md`:
    - Privacy policy URL (from step 7)
    - Data safety form → **"No data collected, no data shared"** (exact answers + justification in the listing file)
    - Content rating questionnaire (answers in the listing file → expect Everyone/PEGI 3)
    - Health apps declaration, Ads = No, Target audience = 18+, App access = no login (paste the reviewer note from the listing file)
12. **Internal → closed testing:**
    - Testing → Internal testing → create release → upload `dist/OptimalFit-release.aab`.
    - When prompted, **enroll in Play App Signing** (recommended — see `dist/SIGNING-INFO.txt`).
    - Install on your own phone via the internal-testing link; sanity-check onboarding, logging, demo data.
    - New personal accounts: promote to **Closed testing** and run the required 14-day / 12-tester test (friends/family emails work).
13. **Production:** Store presence → Main store listing → paste title/short/full description from `play-store-listing.md`, upload `store/screenshots/play-1080x2160-*.png` (pick 4–8), app icon 512×512 (use `app/icons/icon-512.png`), and the **1024×500 feature graphic** (`store/feature-graphic-1024x500.png`).
    Then Production → create release → same AAB → **Submit for review**.
    - Typical review time: 1–7 days for a first submission.

### Stage 3 — Apple App Store (needs P2-4's pipeline or a Mac)

14. App Store Connect → Users & Access → confirm your enrollment is active.
15. **Build the iOS app** — two paths:
    - **No Mac (prepared path):** follow **`docs/IOS-SHIP-GUIDE.md`** (Path B; workflow at `.github/workflows/ios-build.yml`): push the repo to GitHub, add your Apple certificates/API key as repo secrets, run the macOS workflow → it produces/uploads a TestFlight build in the cloud.
    - **Borrowed/owned Mac:** `cd native && npx cap sync ios && npx cap open ios`, then archive + upload from Xcode.
16. App Store Connect → **New app** (name `OptimalFit`, bundle ID from P2-4's config, category Health & Fitness).
17. Fill the version page from `store/app-store-listing.md`: subtitle, promo text, description, keywords, support + privacy URLs (step 7), upload `store/screenshots/iphone67-1290x2796-*.png`, review notes (pre-written), age rating answers (expect 4+).
18. **App Privacy** section → "Data Not Collected" (justification in the listing file). Attach the TestFlight build to the version → **Submit for review**.
    - Typical review time: 1–3 days.

### Stage 4 — After approval

19. Release both (manual release recommended so you control day 1).
20. Calendar reminders: Apple membership renews yearly ($99); bump `versionCode`/`versionName` for every Android update (`dist/BUILD-INFO.txt` has the rebuild recipe) and rebuild iOS via the same pipeline.

---

## Common health-app rejection reasons — and why OptimalFit avoids them

| Rejection reason | OptimalFit's answer |
|---|---|
| **Medical claims without evidence** (diagnosing, treating) | App makes no medical claims; listings + Terms carry an explicit "not medical advice" disclaimer; insights are described as statistics on the user's own logs. |
| **Data safety / privacy label mismatch** (forms claim no collection but app phones home) | Truthfully zero network calls to any developer server — no SDKs, no analytics. The forms in this pack match the code. |
| **Privacy policy URL missing/broken** | Step 7 — host before submitting; policy is truthful and specific. |
| **HealthKit / Health Connect misuse** | App uses neither API (file import only) — no health-platform entitlements to justify. |
| **Minimum functionality / "just a website"** (Apple 4.2) | Fully offline native-packaged app with local storage, charts, statistical engine, onboarding — not a web wrapper around a remote site (there is no remote site). If Apple questions it, the review notes explain the on-device architecture. |
| **Login/demo access for reviewers** | No login exists; review notes point reviewers to Settings → Load demo data. |
| **Broken features during review** (coach tab) | Coach tab degrades to a friendly explanation card without the companion server; review notes state this is intended. |
| **Dangerous weight-loss content** | Calorie targets have floors/caps; the goal system warns when timelines are physiologically unrealistic; age target 18+. |

## Placeholders you must fill (search for them)

- ✅ ~~`EMAIL_TO_FILL`~~ DONE 2026-07-07 — Qualixo22@gmail.com filled in privacy policy (md+html), terms (md+html), both listing files.
- Privacy policy URL + support URL — after step 7, paste into both consoles.
- Apple review contact in App Store Connect (email done: Qualixo22@gmail.com — add your name + phone there).
- (Play feature graphic is DONE: `store/feature-graphic-1024x500.png`.)

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
    - Data safety form → ~~"No data collected, no data shared"~~ **SUPERSEDED for the Phase-3 (community) build — use Part C step 23** (exact answers in the listing file)
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
18. **App Privacy** section → ~~"Data Not Collected"~~ **SUPERSEDED for the Phase-3 (community) build — use Part C step 24** (answers in the listing file). Attach the TestFlight build to the version → **Submit for review**.
    - Typical review time: 1–3 days.

### Stage 4 — After approval

19. Release both (manual release recommended so you control day 1).
20. Calendar reminders: Apple membership renews yearly ($99); bump `versionCode`/`versionName` for every Android update (`dist/BUILD-INFO.txt` has the rebuild recipe) and rebuild iOS via the same pipeline.

---

## Common health-app rejection reasons — and why OptimalFit avoids them

| Rejection reason | OptimalFit's answer |
|---|---|
| **Medical claims without evidence** (diagnosing, treating) | App makes no medical claims; listings + Terms carry an explicit "not medical advice" disclaimer; insights are described as statistics on the user's own logs. |
| **Data safety / privacy label mismatch** (forms claim no collection but app phones home) | Phase 3: the app talks to Supabase ONLY for opted-in community users — the rewritten forms (Part C steps 23–24) declare exactly that. Still no SDKs, no analytics. The forms in this pack match the code. |
| **Privacy policy URL missing/broken** | Step 7 — host before submitting; policy is truthful and specific. |
| **HealthKit / Health Connect misuse** | App uses neither API (file import only) — no health-platform entitlements to justify. |
| **Minimum functionality / "just a website"** (Apple 4.2) | Fully offline native-packaged app with local storage, charts, statistical engine, onboarding — not a web wrapper around a remote site (there is no remote site). If Apple questions it, the review notes explain the on-device architecture. |
| **Login/demo access for reviewers** | Tracking needs no login (Settings → Load demo data); the opt-in community needs one — provide the reviewer test account (Part C steps 23.7 / 24). |
| **UGC without moderation (Apple 1.2)** | Terms acknowledgment at signup, report post/comment/user, block (both directions), auto-hide at 3 reports, published moderation contact — all listed in the Apple review notes. |
| **No in-app account deletion (Apple 5.1.1(v))** | Account deletion is in-app with a full server-side cascade (profile, posts, images, likes, comments, check-ins, follows, benchmark rows). |
| **Broken features during review** (coach tab) | Coach tab degrades to a friendly explanation card without the companion server; review notes state this is intended. |
| **Dangerous weight-loss content** | Calorie targets have floors/caps; the goal system warns when timelines are physiologically unrealistic; age target 18+. |

## Placeholders you must fill (search for them)

- ✅ ~~`EMAIL_TO_FILL`~~ DONE 2026-07-07 — Qualixo22@gmail.com filled in privacy policy (md+html), terms (md+html), both listing files.
- Privacy policy URL + support URL — after step 7, paste into both consoles.
- Apple review contact in App Store Connect (email done: Qualixo22@gmail.com — add your name + phone there).
- (Play feature graphic is DONE: `store/feature-graphic-1024x500.png`.)

---

## PART C — PHASE 3 (opt-in community) — MUST DO BEFORE SHIPPING THE SOCIAL BUILD

Phase 3 added an opt-in community backed by Supabase. The old "No data collected / Data Not Collected" answers are now **false for opted-in users** — both store forms and the hosted policy must be redone before this build goes live. In order:

21. **ROTATE THE SUPABASE CREDENTIALS — do this first, before anything ships.** The service-role key, access token, and database password were shared in plaintext during setup, so treat all three as compromised:
    - Supabase dashboard → Project Settings → API → **regenerate the service_role key** (and confirm the anon key is the only key shipped in the app).
    - supabase.com account → Access Tokens → **revoke and re-issue the personal access token**.
    - Project Settings → Database → **reset the database password**.
    - Update wherever the new values are stored (server-side only — never in the app bundle or the repo).

22. **Re-host the updated privacy policy + terms.** Upload the new `store/privacy-policy.html` and `store/terms-of-service.html` (effective July 8, 2026) to the same URLs from step 7. The old pages claim zero collection — leaving them up while the social build is live is a policy violation on both stores.

23. **Redo the Google Play Data safety form** (Play Console → App content → Data safety) per the table in `play-store-listing.md`. Step-by-step:
    1. "Does your app collect or share any of the required user data types?" → **Yes**.
    2. "Is all of the user data collected by your app encrypted in transit?" → **Yes**.
    3. "Do you provide a way for users to request that their data is deleted?" → **Yes**.
    4. Mark collected: **Email address**, **User IDs** (both: App functionality + Account management), **Photos**, **Other user-generated content** (both: App functionality). For each: collection is **optional**, data is **not shared**, encrypted in transit, deletion available.
    5. Mark everything else NOT collected — especially Location, Health & fitness, Contacts, Diagnostics.
    6. Also re-run the **IARC content rating** questionnaire: "users can interact / exchange content" → **Yes**; "users can share personal info" → **Yes** (answers table in `play-store-listing.md`).
    7. App access → community requires login → create a reviewer test account in-app and paste its credentials.

24. **Redo the Apple App Privacy label** (App Store Connect → App Privacy) per `app-store-listing.md`: uncheck "Data Not Collected"; declare **Contact Info → Email Address**, **User Content → Photos or Videos + Other User Content**, **Identifiers → User ID** — all *Linked to the user*, purpose *App Functionality*, and **none used for Tracking** ("Data Used to Track You: none"). Update the review notes + demo account (pre-written in the listing file), and re-answer the age-rating UGC questions truthfully.

25. **Review Supabase Auth email settings** before launch: confirm signup-confirmation emails are enabled and actually delivered; set a proper SMTP sender (Auth → SMTP settings — the default Supabase sender is rate-limited and lands in spam); check the confirmation/reset email templates say "OptimalFit".

26. **Verify the moderation loop end-to-end** on a test account: report a post from 3 distinct accounts → confirm auto-hide; block a user → confirm both-direction hiding; delete the account → confirm the cascade removed profile, posts, **image files in Storage**, likes, comments, check-ins, follows, and benchmark rows. Keep `store/moderation-policy.md` handy — the 72h review promise starts at launch.

27. **Bump `versionCode`/`versionName`** for the Phase-3 Android upload (and the iOS build number) — stores reject re-used version codes; rebuild per `dist/BUILD-INFO.txt`.

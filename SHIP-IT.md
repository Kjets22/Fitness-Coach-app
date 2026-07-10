# OptimalFit — Ship It: the complete step-by-step

Everything in the app is built, QA'd (7 QA passes + a 39-agent code review + fixes),
polished, and on GitHub. This is the ordered list of the remaining steps that only
you can do — accounts, payments, hosting, and secrets. Do them top to bottom.

Estimated time/cost: ~2–4 focused hours of setup + **$25 (Google Play, one-time)**
and **$99/yr (Apple Developer)**. Android has a mandatory 14-day closed-test wait,
so start that early.

Secrets/credentials live in **gitignored** local files (`.env.supabase`,
`.env.reviewer`, `.env.personas`, `dist/keystore.properties`) — never in the repo.

---

## PHASE 0 — Security first (do before anything ships)

### Step 1 — Rotate the Supabase secrets  ⚠️ critical
They were shared in plaintext during setup, so treat all three as compromised.
1. Open https://supabase.com/dashboard/project/puopvaqquujalwnzwyov
2. **Settings → API → Project API keys** → roll the **`service_role`** key.
   (Leave the `anon`/publishable key — it's public by design and the only key in the app.)
3. **Account (top-right) → Access Tokens** → revoke the old personal access token.
4. **Settings → Database → Database password → Reset**.
5. Update your local `.env.supabase` with the new values (it's gitignored — no push needed).
   Nothing in the shipped app breaks; only local admin/CLI scripts use these.

---

## PHASE 1 — Host the legal pages (both stores require a live URL)

### Step 2 — Publish the privacy policy + terms
Files: `store/privacy-policy.html` and `store/terms-of-service.html`.
Easiest free option — GitHub Pages:
1. GitHub → your repo → **Settings → Pages**.
2. Source: **Deploy from a branch** → branch `main` → folder `/root` → **Save**.
3. Your policy will be live at
   `https://kjets22.github.io/Fitness-Coach-app/store/privacy-policy.html`
   (and `…/store/terms-of-service.html`). Open both to confirm they render.
4. Write down both URLs — you'll paste them into the store forms.
   *(If you'd rather I move these to a `/docs` folder so the toggle is one click, ask.)*

### Step 3 — Confirm Supabase Auth email
Dashboard → **Authentication → Providers → Email**: confirm "Confirm email" is on.
For real users, set a custom SMTP sender (Resend/SendGrid free tier) under
**Authentication → Emails** so confirmation emails don't hit spam. (Optional for
review — the reviewer demo account is already pre-confirmed.)

---

## PHASE 2 — Apple App Store (iOS)  · $99/yr

The build already **archives**; the only missing piece is your paid signing certificate.

### Step 4 — Enroll + create the app
1. Enroll at https://developer.apple.com/programs/ ($99/yr).
2. In **App Store Connect** → **My Apps → +** → New App: bundle id
   `com.optimalfit.app`, name **OptimalFit**, primary language English.

### Step 5 — Build + upload (from this Mac, in Xcode)
1. Open `native/ios/App/App.xcodeproj` in Xcode.
2. Target **App → Signing & Capabilities** → check **Automatically manage signing**
   → pick your **Team** (Xcode creates the Distribution cert + profile for you).
3. Top bar: set the device to **Any iOS Device**.
4. **Product → Archive** → when it finishes, **Distribute App → App Store Connect → Upload**.
   *(Command-line alternative with exact commands is in `docs/IOS-SHIP-GUIDE.md` → "Path A".)*

### Step 6 — Fill the listing + submit
From `store/app-store-listing.md`:
1. **App Privacy** → answer as: Contact Info (Email), User Content (Photos + Other),
   Identifiers (User ID) — all **Linked / App Functionality**; **Data Used to Track You: None**.
2. **Screenshots** → upload the 8 files `store/screenshots/iphone67-1290x2796-*.png`.
3. **App Review Information → Sign-in required** → paste the email + password from
   **`.env.reviewer`** (username `optimalfit_demo`; its feed is already populated).
4. Add your **Support URL** (the GitHub Pages index or repo) and **Privacy Policy URL** (Step 2).
5. Add your **review contact name + phone** (Apple requires all three).
6. **Submit for Review.** Typical review: 1–3 days.

---

## PHASE 3 — Google Play (Android)  · $25 one-time

### Step 7 — Create the account + start the closed test EARLY
1. Sign up at https://play.google.com/console ($25 one-time).
2. New Play developer accounts **must run a closed test with ~12 testers for 14 days**
   before production. Create the app, set up a **Closed testing** track, and invite
   testers now — this is a calendar-time gate, so don't wait.

### Step 8 — Signing decision + version bump + build
1. **Enable Play App Signing** (recommended) so Google manages the upload key and a
   lost keystore is recoverable.
2. Bump the version before the first upload: in `native/android/app/build.gradle`
   set `versionCode 2` (and bump `versionName` if you like).
3. Rebuild the AAB (recipe in `dist/BUILD-INFO.txt`):
   ```
   export JAVA_HOME=/opt/homebrew/opt/openjdk
   cd native && npm run sync && cd android && sh ./gradlew bundleRelease
   ```
   Upload `native/android/app/build/outputs/bundle/release/app-release.aab`.
   *(A pre-built `dist/OptimalFit-release.aab` exists but is versionCode 1 — rebuild after the bump.)*

### Step 9 — Fill the listing + submit
From `store/play-store-listing.md`:
1. **Data safety** form → Collected: Email, User-generated content (photos), User IDs;
   all **optional**, encrypted in transit, deletable, **not shared**, no ads.
2. **Store listing** → title/short/full description (already written), upload the 8
   screenshots `store/screenshots/play-1080x2160-*.png` + `store/feature-graphic-1024x500.png`.
3. **App access** → paste the `.env.reviewer` credentials so Google can review the community.
4. **Content rating** questionnaire (answers guided in the listing file → Everyone/Teen).
5. Complete the 14-day closed test, then **promote to Production**.

---

## PHASE 4 — One thing for the on-device coach (optional, local)

### Step 10 — Log the Claude CLI in (for the AI Coach on your own machine)
The Coach/food-photo/physique features run through your Claude subscription on your
computer (zero API cost). If you use them locally, run once in Terminal:
```
"/Users/krishjetly/Library/Application Support/Claude/claude-code/2.1.202/claude.app/Contents/MacOS/claude"
```
…and complete `/login`. (Already verified working once.) In the shipped mobile app the
Coach tab correctly shows a "runs on your computer" card — this is expected, not a bug.

---

## Final pre-submit checklist
- [ ] Supabase secrets rotated (Step 1)
- [ ] Privacy policy + terms hosted, URLs noted (Step 2)
- [ ] Apple: signed archive uploaded, listing + reviewer login + URLs filled, submitted (Steps 4–6)
- [ ] Play: account made, closed test started, versionCode bumped, AAB uploaded, forms filled (Steps 7–9)
- [ ] Reviewer demo login pasted into BOTH stores (from `.env.reviewer`)
- [ ] (Optional) manual on-device tap of Share + photo-picker on a real iPhone
- [ ] (Optional) Claude CLI logged in for the local coach (Step 10)

## Quick reference — where everything is
| Thing | Location |
|---|---|
| Reviewer demo login | `.env.reviewer` (gitignored) |
| Supabase secrets | `.env.supabase` (gitignored) |
| Android keystore + passwords | `dist/optimalfit-release.keystore`, `dist/keystore.properties` (gitignored) |
| Store copy + form answers | `store/app-store-listing.md`, `store/play-store-listing.md` |
| Screenshots / feature graphic | `store/screenshots/`, `store/feature-graphic-1024x500.png` |
| Privacy / terms / moderation | `store/privacy-policy.html`, `store/terms-of-service.html`, `store/moderation-policy.md` |
| iOS ship guide (commands) | `docs/IOS-SHIP-GUIDE.md` |
| Android rebuild recipe | `dist/BUILD-INFO.txt` |
| Backend/API contract | `docs/BACKEND.md` |

---

## Managing the AI paywall (Coach, food-photo macros, physique)

The 3 AI features are **Premium** and gated to accounts you grant. Everything
else (tracking + the on-device insights engine + Community) is free. There is
**no API key in the app**, so you have zero per-token cost exposure.

### Grant / revoke premium (owner tool)
From the repo root:
```
set -a; source .env.supabase; set +a
node tools/grant-premium.mjs <username> premium        # unlock the AI features for an account
node tools/grant-premium.mjs <username> premium off    # revoke
node tools/grant-premium.mjs <username> admin           # make an account an owner/admin (also premium)
node tools/grant-premium.mjs --list                     # list premium/admin accounts
```
Your own account: create it in the app (any username), then
`node tools/grant-premium.mjs <your-username> premium`. Users can **never**
grant themselves premium — it's a server-enforced flag.

### 7-day free trial
Every new account automatically gets the AI features free for **7 days** (a
server-set `trial_ends_at` a user can't extend). After it expires they see the
paywall unless you've granted them premium. Nothing to configure — it's on.

### To actually SELL premium (future step)
The current gate is *owner-granted access*, not an in-app purchase. To charge
users on iOS you must wire **Apple In-App Purchase** (App Store Guideline 3.1.1
requires it for digital goods) — and equivalently Google Play Billing on Android
— so a completed purchase calls `admin_set_premium` (via a server/webhook) to
flip `is_premium`. That's a separate build; the gate + entitlement plumbing it
needs is already in place. **Do not add a "Buy/Upgrade" button in the app until
IAP is wired**, or Apple will reject the build.

---

## LLM routing — your Claude subscription now, an API key when you want

Every AI request runs through `serve.py` (the companion server on your computer).
It has **two routes**, switchable with zero rebuild:

- **Default — your Claude subscription** (the `claude` CLI on this machine). Zero
  per-token cost. Nothing to set up. Right for now, with ~0 users.
- **API key** — when you'd rather not use your personal subscription (e.g. as
  usage grows), drop an Anthropic key in and every AI call goes through the paid
  API instead:
  ```
  cp .env.llm.example .env.llm        # then edit .env.llm, paste your key
  ```
  `serve.py` picks it up on the **next request** — no restart. Delete `.env.llm`
  to switch back to the subscription. Optionally set `OPTIMALFIT_LLM_MODEL`
  (default `claude-opus-4-8`; `claude-sonnet-5` / `claude-haiku-4-5` are cheaper).
  `.env.llm` is gitignored — your key never leaves the machine and is never in
  the app. `GET /api/health` reports `llmMode: "cli" | "api"` so you can confirm
  which route is live.

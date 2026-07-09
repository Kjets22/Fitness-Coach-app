# OptimalFit — Apple App Store Listing

Fields map to App Store Connect → your app → **App Information / iOS App version page / App Privacy**. Copy-paste as-is; items marked FILL need your input.

> **Phase 3 update (2026-07-08):** the app now has an OPT-IN community (accounts, posts, comments, check-ins) backed by Supabase. The App Privacy answers, description, keywords, and review notes below were rewritten to match — the old "Data Not Collected" label is **no longer valid** and must be redone in App Store Connect before the Phase-3 build is submitted.

---

## Name (max 30 chars)

```
OptimalFit
```
(10 characters — short names rank better; the subtitle carries the pitch)

## Subtitle (max 30 chars)

```
Private fitness, smarter you
```
(28 characters)

## Promotional text (max 170 chars — editable without a new build)

```
Track solo, 100% on-device — or opt in to share Receipts: proof-backed stat cards. Your logs stay on your phone; only what you post is shared. No ads, no analytics.
```
(164 characters)

## Description (max 4000 chars)

```
Your fitness data should make YOU smarter — not someone else's ad network. OptimalFit is a complete fitness tracker that keeps your data on your own phone by default. No account needed. No analytics. No ads. And now: an optional community where you share only what you choose.

TRACK EVERYTHING THAT MATTERS
• Sleep — bed time, wake time, quality; duration handled automatically, even past midnight
• Food — meals with calories, protein, carbs and fat, including pre- and post-workout meals
• Workouts — type, duration, intensity and how the session actually went
• Body — weight, body fat % and muscle mass %, with 90-day trend charts
• Water & steps — quick-add water, daily step totals, progress vs your targets

INSIGHTS THAT ACTUALLY USE YOUR DATA
OptimalFit's statistics engine runs entirely on your phone and answers questions generic apps can't:
• What time of day do YOUR workouts go best?
• Which weekdays are your strongest?
• How much does last night's sleep change today's performance?
• When do you need a rest day?
Every recommendation shows its confidence level and tells you honestly when there isn't enough data yet.

GOALS WITH A BUILT-IN REALITY CHECK
Pick a goal — lean bulk, cut, recomposition, maintain, or performance — and get personal daily targets for calories, protein, fat, carbs, water, steps and sleep. OptimalFit learns your actual maintenance calories from your own logs and adjusts your targets week by week. If your timeline is physiologically unrealistic, it tells you straight.

NEW: AN OPT-IN COMMUNITY BUILT ON RECEIPTS
Create a free account (entirely optional) and share your wins:
• Receipts — proof-backed stat cards computed by your on-device coach: estimated-1RM trends, consistency grids, weight-trend summaries. Only the numbers on the card are shared — never your logs.
• Post workouts, meals and photos you explicitly choose to publish
• Follow friends, like and comment, and check in at the gym — just a gym name and date, no GPS; the app never touches your location
• Community benchmarks — anonymous, aggregate percentiles that only appear once at least 5 people contribute; individuals are never exposed
Sharing is per-post and deliberate. Nothing is auto-uploaded. Delete your account in-app anytime and everything you shared is deleted with it. Report and block tools keep the feed kind.

PRIVATE BY ARCHITECTURE, NOT BY PROMISE
• All tracking data lives in local storage on your phone — with or without an account
• No ads, no trackers, no analytics SDKs — still zero
• The community is opt-in; only content you explicitly post reaches our servers
• One-tap export for backups; delete everything anytime

IMPORT YOUR EXISTING HISTORY
Bring in steps, weight, sleep and water from an Apple Health export (the file you create in the Health app) or Samsung Health CSV files — processed entirely on your device.

OPTIONAL AI COACH — ON YOUR OWN TERMS
Run the free companion program on your own computer and pair your phone over your home Wi-Fi. Answers grounded in your actual logs, meal-photo macro estimates, supportive physique feedback — all on your own machines, never our servers. With a community account, the coach can also pull anonymous benchmark percentiles to show how your numbers compare.

HONEST LIMITS
OptimalFit is a fitness tool, not a medical device. Its insights are statistics, not medical advice — check with a professional before big changes. Back up your local data with the built-in export.

Track everything. Learn what works. Share only the wins you choose.
```
(3,534 characters — under the 4,000 limit)

## Keywords (max 100 chars, comma-separated)

```
sleep,calorie,macro,workout,offline,private,tracker,social,receipts,gym,log,diet,muscle,friends
```
(95 characters. Don't repeat "fitness" or "OptimalFit" — the name/subtitle already index those.)

## Category

- **Primary:** Health & Fitness
- **Secondary (optional):** Social Networking (now honest — the app has a community) or Lifestyle

## Price & availability

- Free. All territories (or your preference).

## App Privacy (App Store Connect → App Privacy section)

⚠️ **This fully replaces the old "Data Not Collected" answer.** The opt-in community transmits data to a Supabase backend we control — that is "collection" under Apple's definition (transmitted off-device and accessible to the developer). Re-answer the questionnaire as follows.

**Data Used to Track You: NONE.** (No tracking, no ads, no data sale, no sharing with data brokers — nothing is used for cross-app/site tracking.)

**Data Linked to You** (all collected only if the user opts into the community; Apple's form has no "optional" flag, but state the opt-in nature in the privacy policy and review notes):

| Category | Data | Linked to identity? | Purpose |
|---|---|---|---|
| Contact Info | **Email Address** | Linked | App Functionality (sign-in, account management) |
| User Content | **Photos or Videos** (avatar + images attached to posts) | Linked | App Functionality |
| User Content | **Other User Content** (posts, Receipt stat cards, comments, bio, gym check-ins [name+date only]) | Linked | App Functionality |
| Identifiers | **User ID** (account ID / username) | Linked | App Functionality |

**Everything else: Not Collected.** In particular: Health & Fitness (raw logs never leave the device — only user-published Receipt card numbers travel, declared under User Content), Location (none — check-ins have no GPS), Contacts, Browsing/Search History, Purchases, Financial Info, Diagnostics, Usage Data, Analytics (none exist).

- No HealthKit APIs are used (file import only) — no HealthKit privacy strings or entitlements involved.
- The self-hosted AI Coach still transmits only to the user's own computer — not collection.

⚠️ If a future version adds analytics, crash reporting, or new server-bound data, update this label BEFORE release.

## Age rating questionnaire (expected answers)

- Cartoon/fantasy/realistic violence: None
- Profanity or crude humor: None
- Mature/suggestive themes: None
- Horror/fear themes: None
- Medical/treatment information: **None** — self-logged fitness statistics, not medical or treatment information (description/terms carry a not-medical-advice disclaimer).
- Alcohol, tobacco, drug use: None
- Simulated gambling: None
- Sexual content/nudity: None
- Contests: None
- Unrestricted web access: **No** (the WebView loads only the bundled app)
- Gambling with real currency: No
- **User-generated content / users can communicate (asked by the current questionnaire): Yes — NEW.** Declare truthfully: users can post content visible to others (posts, comments, images). The app has the required safety controls: report, block, auto-hide of multiply-reported posts, and a 13+ age gate at signup.

**Expected rating: 4+ base content; the UGC/social answers may raise the displayed rating (e.g. to 12/13+) depending on the questionnaire version — accept whatever it outputs, do not misdeclare to keep 4+.**

## Review notes (App Review Information)

```
LOCAL BY DEFAULT: all fitness data is stored on-device — no account is needed
for any tracking or coaching feature. To see the app populated with data, open
Settings (gear icon, top right) → "Load demo data".

OPT-IN COMMUNITY (new in this version): a social feed is available ONLY after
the user explicitly creates a free account (email + password, in-app). Nothing
is uploaded unless the user explicitly publishes a post. A demo account is
provided in the sign-in fields below — sign in to review the community.

UGC MODERATION (Guideline 1.2): sign-up requires acknowledging the Terms
(which define objectionable content); every post, comment, and user can be
reported; users can block other users (hides content both directions); posts
reported by 3+ distinct users are auto-hidden pending review; moderation
contact: Qualixo22@gmail.com.

ACCOUNT DELETION (Guideline 5.1.1(v)): the account can be deleted inside the
app (Community → Profile → Settings → Delete account). Deletion cascades:
profile, posts, images, likes, comments, check-ins, follows, and benchmark
contributions are all removed.

The "Coach" tab is an optional feature that pairs with a companion program the
user runs on their own personal computer over their own Wi-Fi. Without it, the
tab shows a friendly explanation card — expected behavior, not a bug.
```

- **Sign-in required?** For the community only. Provide a demo account: create one in the app before submitting (e.g. `applereview.optimalfit@gmail.com` + password) and fill it into the demo-account fields.
- **Contact:** Qualixo22@gmail.com (add your name + phone in App Store Connect — Apple requires all three for the review contact).

## URLs

- **Privacy Policy URL (required):** hosted copy of the **updated** `privacy-policy.html` — re-host before submitting; the old hosted copy claims zero collection and no longer matches the app.
- **Support URL (required):** can be the same site's index or a GitHub repo page — FILL

## Screenshots

- **iPhone 6.7"/6.9" (required set):** use `store/screenshots/iphone67-1290x2796-*.png` (1290×2796, exact). Regenerated 2026-07-09 to tell the two-sided story — the on-device coach engine PLUS the opt-in verified-social side (Community + Receipts). Regenerate anytime with `node store/tools/shoot.js` (serve the app first: `cd app && python3 -m http.server 8673`). Zero LLM calls (coach is mocked); the social feed is a deterministic in-page mock — no backend writes.
- **iPad:** NOT needed. OptimalFit is iPhone-only (`TARGETED_DEVICE_FAMILY = "1"`). If a future version adds iPad support ("1,2"), a 13" iPad screenshot set (2064×2752) becomes mandatory.

**The 8-shot set (in order) + suggested overlay captions.** App Store has no hard caption char cap (text is baked into the image), but keep overlays short — counts below target a ≤35-char one-liner that reads on a phone thumbnail.

| # | File (`iphone67-1290x2796-…`) | What it shows | Caption | Chars |
|---|---|---|---|---|
| 1 | `01-dashboard.png` | Readiness ring, weight/sleep/calorie cards, goal progress, today-vs-targets rings | `Your whole day, one glance` | 26 |
| 2 | `02-insights-goal.png` | On-device stats engine: goal card + data-driven narrative | `Insights only YOUR data can give` | 32 |
| 3 | `03-food-tracker.png` | Food logging with calories + macros | `Log food in seconds` | 19 |
| 4 | `04-coach-chat.png` | AI coach chat grounded in the user's own logs | `A coach that knows your logs` | 28 |
| 5 | `05-community-feed-verified.png` | **HERO** — "This week's drop": a **Verified by data** Receipt card (gradient border, e1RM sparkline, "6 sessions over 7 weeks") above a normal post | `Wins proven by data — Receipts` | 30 |
| 6 | `06-receipt-share.png` | Sharing a Squat PR Receipt: card preview + "the server re-checks it and awards the Verified badge" | `Share the proof, never raw logs` | 31 |
| 7 | `07-leaderboard.png` | Friends/gym leaderboards ranked by real check-in streaks & verified receipts | `Honest boards — show up to climb` | 32 |
| 8 | `08-profile-stats.png` | Public profile: local training stats line + your verified Receipt posts | `Your profile, your stats` | 24 |

Hero = #5 (the Receipt differentiator). If uploading fewer than 8, keep #1, #2, #5 at minimum. A matching Google Play set (1080×2160, 2:1) exists at `play-1080x2160-*.png`.

## What's New (Phase 3 update)

```
New: the OptimalFit community (100% opt-in). Share Receipts — proof-backed stat cards from your on-device coach — plus workout, meal and photo posts. Follow friends, like, comment, and check in at the gym. Your raw logs still never leave your phone; only what you explicitly post is shared, and you can delete your account (and everything with it) in-app anytime.
```

# OptimalFit — Google Play Store Listing

Everything below maps to fields in Play Console → **Grow > Store presence > Main store listing** and **Policy > App content**. Copy-paste as-is; items marked FILL need your input.

> **Phase 3 update (2026-07-08):** the app now has an OPT-IN community (accounts, posts, comments, check-ins) backed by Supabase. The Data safety form, IARC answers, and descriptions below were rewritten to match — the old "No data collected" answers are **no longer valid**. Re-submit the forms before shipping the Phase-3 build.

---

## App title (max 30 chars)

```
OptimalFit - Private Fitness
```
(28 characters)

## Short description (max 80 chars)

```
Sleep, food, workout & body tracking. On-device by default; opt-in community.
```
(77 characters)

## Full description (max 4000 chars)

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
Bring in steps, weight, sleep and water from an Apple Health export or Samsung Health CSV files — processed entirely on your device.

OPTIONAL AI COACH — ON YOUR OWN TERMS
Run the free companion program on your own PC and pair your phone over your home Wi-Fi. Answers grounded in your actual logs, meal-photo macro estimates, supportive physique feedback — all on your own machines, never our servers. With a community account, the coach can also pull anonymous benchmark percentiles to show how your numbers compare.

HONEST LIMITS
OptimalFit is a fitness tool, not a medical device. Its insights are statistics, not medical advice — check with a professional before big changes. Back up your local data with the built-in export.

Track everything. Learn what works. Share only the wins you choose.
```
(3,488 characters — under the 4,000 limit)

## Category

- **App category:** Health & Fitness
- **Tags (Play Console suggestions, pick up to 5):** Fitness tracker, Health, Workout, Nutrition, Social

## Keywords to work into your Custom Store Listings / marketing (Play has no keyword field)

private fitness tracker, offline fitness tracker, fitness community, workout sharing, receipts, sleep tracker, calorie tracker, macro tracker, workout log, body composition, gym check-in, on-device

## Contact details (Store settings)

- **Email:** Qualixo22@gmail.com (required, shown publicly)
- **Website:** optional — the hosted privacy-policy page's site works
- **Privacy policy URL:** REQUIRED — the hosted copy of the **updated** `privacy-policy.html` (re-host before submitting; the old hosted copy claims zero collection and no longer matches the app)

---

## Content rating questionnaire (IARC) — expected answers

Play Console → App content → Content ratings. Category to choose: **Utility, Productivity, Communication, or Other**.

⚠️ **Changed in Phase 3:** the app now has user interaction and UGC. Re-run the questionnaire — the two rows marked NEW below flip to Yes, which typically raises the rating from Everyone/PEGI 3 to **Everyone/Teen-adjacent "Users Interact" descriptors** (regional equivalents vary). This is normal for social apps.

| Question | Answer | Why |
|---|---|---|
| Violence, blood, gore | **No** | none in app |
| Sexuality / nudity | **No** | none (and banned by the community rules) |
| Language (profanity) | **No** | none |
| Controlled substances (drugs/alcohol/tobacco references) | **No** | none |
| Gambling (simulated or real) | **No** | none |
| Users can interact or exchange content (chat, UGC visible to others) | **Yes — NEW** | opt-in community: posts, comments, likes, follows, profile avatars/images. Report, block, and auto-hide moderation exist in-app. |
| Can users share their personal information with other users | **Yes — NEW** | users can type anything into posts/bios (we collect no location/contacts, but free-text sharing is user-controlled) |
| Does the app share user's current location | **No** | no location access at all; gym check-ins are a typed name + date, no GPS |
| Personal information shared with third parties | **No** | nothing is shared with third parties; Supabase acts only as our hosting processor |
| In-app purchases of digital goods | **No** | free, no IAP |
| Is it a web browser or search engine | **No** | |
| Made for / targeted at children | **No** | general audience; community accounts require 13+ |

Expected resulting rating: **Everyone, with "Users Interact / Shares Info" interactive elements** (IARC adds interactive-element descriptors rather than raising the age category for this alone).

## Target audience & content (App content section)

- **Target age group:** 18 and over (unchanged — safest for a health/fitness app; avoids Families policy requirements). The community itself enforces 13+ at signup, but keep the Play target audience at 18+.
- **Appeals to children?** No.

## Health apps declaration (App content → Health)

- **Is your app a health & fitness app?** Yes — "Fitness and exercise" / "Food and nutrition" / "Sleep" (activity self-tracking).
- **Does it connect to Health Connect?** No.
- **Is it a medical app / does it provide medical functionality?** No.

## Data safety form — exact answers (all truthful to the architecture)

Play Console → App content → Data safety.

⚠️ **This section fully replaces the pre-Phase-3 "No data collected" answers.** The opt-in community transmits data to a developer-controlled backend (Supabase), which is "collection" under Google's definition — even though it is optional and user-initiated.

1. **Does your app collect or share any of the required user data types?** → **Yes.**
2. **Is all of the user data collected by your app encrypted in transit?** → **Yes** (HTTPS to Supabase).
3. **Do you provide a way for users to request that their data is deleted?** → **Yes** (in-app account deletion with full cascade, plus per-post deletion).

**Data types collected** (mark each as: Collected, **Optional** [not required to use the app], NOT shared with third parties, encrypted in transit, deletion available):

| Data type | Collected? | Purpose | Optional? | Shared? |
|---|---|---|---|---|
| Personal info → **Email address** | Yes | App functionality, Account management | **Yes — optional** (only if the user opts into the community) | No |
| Personal info → **User IDs** (username / account ID) | Yes | App functionality, Account management | **Yes — optional** | No |
| Photos and videos → **Photos** | Yes (avatar + images the user attaches to posts) | App functionality | **Yes — optional** | No |
| App activity → **Other user-generated content** (posts, Receipt stat cards, comments, bios, gym check-ins [name+date, no location]) | Yes | App functionality | **Yes — optional** | No |

**Everything else: NOT collected.** In particular do NOT mark: Location (none — check-ins have no GPS), Health & fitness (raw logs never leave the device; only user-published Receipt numbers travel, declared above as UGC), Contacts, Financial info, Messages, Web history, Device IDs, Crash logs, Diagnostics, Analytics of any kind.

- **"Data collected" vs "shared":** nothing is shared with third parties. Supabase is a service provider processing on our behalf (Google's definition of "shared" excludes service providers).
- Justification for your records: tracking/coach data stays in on-device storage; only opt-in community content (account email, profile, explicitly published posts/images, likes, comments, check-ins, k-anonymous benchmark contributions) is transmitted, to a Supabase project (US) we control. No analytics, ads, or telemetry exist anywhere in the app.
- **Independent security review (optional badge):** skip.

⚠️ Keep this form truthful in future updates: adding analytics, crash reporting, or any new server-bound data means redoing the form BEFORE release.

## Ads declaration

- **Does your app contain ads?** → **No.**

## App access (for review)

- **Some functionality is restricted** → the community requires an account (free, in-app email+password signup). Provide Google a test account: create one in the app before submitting (e.g. `playreview.optimalfit@gmail.com` + password) and paste the credentials into App access. All tracking/coach functionality is available without any login.
- Reviewer note: "All fitness data is stored locally on the device — to see the app with data, open Settings → Load demo data. The Community tab is opt-in: sign in with the provided test account to view feed, posting, report/block, and in-app account deletion. The AI Coach tab requires a self-hosted companion server on the user's own PC and shows a friendly explanation card without it — expected behavior, not an error."

## Screenshots & graphics

- **Phone screenshots:** use `store/screenshots/play-1080x2160-*.png` (1080×2160 = exactly 2:1 — Play requires each screenshot's longer side ≤ 2× its shorter side; min 2, max 8). Consider regenerating to add a community/Receipts screen (`store/tools/shoot.js`).
- **App icon:** 512×512 PNG required for Play Console — export/upscale from `app/icons/icon-512.png` (already 512×512).
- **Feature graphic:** 1024×500 PNG **required** — use `store/feature-graphic-1024x500.png`. Regenerate with `node feature-graphic.js` in `store/tools/`.

## Release notes (Phase 3 update)

```
New: the OptimalFit community (100% opt-in). Share Receipts — proof-backed stat cards from your on-device coach — plus workout, meal and photo posts. Follow friends, like, comment, and check in at the gym. Your raw logs still never leave your phone; only what you explicitly post is shared, and you can delete your account (and everything with it) in-app anytime.
```

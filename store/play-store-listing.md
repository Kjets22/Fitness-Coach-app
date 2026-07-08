# OptimalFit — Google Play Store Listing

Everything below maps to fields in Play Console → **Grow > Store presence > Main store listing** and **Policy > App content**. Copy-paste as-is; items marked FILL need your input.

---

## App title (max 30 chars)

```
OptimalFit - Private Fitness
```
(28 characters)

## Short description (max 80 chars)

```
Sleep, food, workout & body tracking with smart insights. 100% on-device.
```
(73 characters)

## Full description (max 4000 chars)

```
Your fitness data should make YOU smarter — not someone else's ad network. OptimalFit is a complete fitness tracker that keeps every byte of your data on your own phone. No account. No cloud. No analytics. Nothing to sign up for and nothing to leak.

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
• Do carb-rich pre-workout meals help you?
• When do you need a rest day?
Every recommendation shows its confidence level and tells you honestly when there isn't enough data yet.

GOALS WITH A BUILT-IN REALITY CHECK
Pick a goal — lean bulk, cut, recomposition, maintain, or performance — and get personal daily targets for calories, protein, fat, carbs, water, steps and sleep. OptimalFit learns your actual maintenance calories from your own logs and gently adjusts your targets week by week. If your timeline is physiologically unrealistic, it tells you straight and shows a realistic date instead.

A DASHBOARD YOU'LL ACTUALLY OPEN
Daily readiness score, today-vs-targets rings, trend sparklines, and clean charts for body, sleep, performance and nutrition.

IMPORT YOUR EXISTING HISTORY
Bring in steps, weight, sleep and water from an Apple Health export or Samsung Health CSV files. The import runs entirely on your device — with a preview before anything is saved.

PRIVATE BY ARCHITECTURE, NOT BY PROMISE
• All data lives in local storage on your phone
• No account, no registration, no cloud sync
• No ads, no trackers, no analytics SDKs
• One-tap export for backups; delete everything anytime in Settings
• Works fully offline

OPTIONAL AI COACH — ON YOUR OWN TERMS
Tech-savvy? Run the free companion program on your own PC and pair your phone to it over your home Wi-Fi. Ask questions in plain language ("Plan my workouts for next week") and get answers grounded in your actual logs. It can even estimate a meal's calories and macros from a photo, or give a supportive, body-neutral read on your physique — body-composition and muscle-development estimates that help set your targets. Your photos go only to your own computer, are analyzed there and deleted right after, never to us. The coach talks only to YOUR computer — never to a cloud service of ours. Skip it entirely and every other feature still works.

HONEST LIMITS
OptimalFit is a fitness tool, not a medical device. Its insights are statistics on your own logs, not medical advice — always check with a professional before big changes. Because your data never touches a server, back it up with the built-in export.

Track everything. Learn what works for you. Keep it all to yourself.
```
(~3,230 characters — under the 4,000 limit)

## Category

- **App category:** Health & Fitness
- **Tags (Play Console suggestions, pick up to 5):** Fitness tracker, Health, Workout, Nutrition, Sleep

## Keywords to work into your Custom Store Listings / marketing (Play has no keyword field)

private fitness tracker, offline fitness tracker, no account fitness app, sleep tracker, calorie tracker, macro tracker, workout log, body composition, readiness score, on-device

## Contact details (Store settings)

- **Email:** Qualixo22@gmail.com (required, shown publicly)
- **Website:** optional — the hosted privacy-policy page's site works
- **Privacy policy URL:** REQUIRED — the hosted copy of `privacy-policy.html` (see SHIP-CHECKLIST.md step on hosting)

---

## Content rating questionnaire (IARC) — expected answers

Play Console → App content → Content ratings. Category to choose: **Utility, Productivity, Communication, or Other**.

| Question | Answer | Why |
|---|---|---|
| Violence, blood, gore | **No** | none in app |
| Sexuality / nudity | **No** | none |
| Language (profanity) | **No** | none |
| Controlled substances (drugs/alcohol/tobacco references) | **No** | none |
| Gambling (simulated or real) | **No** | none |
| Users can interact or exchange content (chat, UGC visible to others) | **No** | the Coach chat talks only to the user's own computer; no user-to-user interaction |
| Does the app share user's current location | **No** | no location access at all |
| Personal information shared with third parties | **No** | nothing collected or shared |
| In-app purchases of digital goods | **No** | free, no IAP |
| Is it a web browser or search engine | **No** | |
| Made for / targeted at children | **No** | general audience, 13+ recommended |

Expected resulting rating: **Everyone / PEGI 3** (or regional equivalent).

## Target audience & content (App content section)

- **Target age group:** 18 and over (safest for a health/fitness app; avoids Families policy requirements). 13–17 could be added but then Google applies extra scrutiny — not recommended for v1.
- **Appeals to children?** No.

## Health apps declaration (App content → Health)

Play now asks whether the app is a health app. Answer:

- **Is your app a health & fitness app?** Yes — "Fitness and exercise" / "Food and nutrition" / "Sleep" (activity self-tracking).
- **Does it connect to Health Connect?** No.
- **Is it a medical app / does it provide medical functionality?** No.

## Data safety form — exact answers (all truthful to the architecture)

Play Console → App content → Data safety.

1. **Does your app collect or share any of the required user data types?** → **No.**
   - Justification (for your own records, Google may ask in review): all user data is stored in the app's private on-device WebView localStorage. Nothing is transmitted off the device by the app. The only optional network feature (AI Coach) sends data exclusively to a server the *user themself* operates on their own LAN — this is user-initiated transfer to the user's own device, not collection by the developer, and it is off by default. Per Google's definition, "collected" means transmitted off the device to the developer or their agents — which never happens.
2. Because the answer to (1) is No, the rest of the form collapses. The generated Data safety card will read: **"No data collected. No data shared."**
3. **Is data encrypted in transit?** → not asked when nothing is collected (N/A).
4. **Can users request data deletion?** → not asked when nothing is collected; the app additionally offers full local deletion via Settings → "Clear all data" — mention this in the listing/description if a reviewer asks.
5. **Independent security review (optional badge):** skip.

⚠️ Keep this form truthful in future updates: if any feature is ever added that sends data to a developer-controlled server (analytics, crash reporting, cloud sync), the form MUST be redone before release.

## Ads declaration

- **Does your app contain ads?** → **No.**

## App access (for review)

- "All functionality is available without special access" → **All functionality is available without login credentials.** (No account exists.)
- Add a reviewer note: "All data is stored locally on the device. To see the app with data, open Settings → Load demo data. The AI Coach tab requires a self-hosted companion server on the user's own PC and will show a friendly explanation card without it — this is expected behavior, not an error."

## Screenshots & graphics

- **Phone screenshots:** use `store/screenshots/play-1080x2160-*.png` (1080×2160 = exactly 2:1 — Play requires each screenshot's longer side ≤ 2× its shorter side; min 2, max 8).
- **App icon:** 512×512 PNG required for Play Console — export/upscale from `app/icons/icon-512.png` (already 512×512).
- **Feature graphic:** 1024×500 PNG **required** — use `store/feature-graphic-1024x500.png` (generated: dark brand background, gradient "OptimalFit" wordmark + dumbbell mark, tagline "Your data. Your coach. Your best self."). Regenerate with `node feature-graphic.js` in `store/tools/`.

## Release notes (first release)

```
First release: track sleep, food, workouts, body, water and steps; on-device insights and goal coaching; Apple Health / Samsung Health import; 100% private — all data stays on your phone.
```

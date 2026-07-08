# OptimalFit — Apple App Store Listing

Fields map to App Store Connect → your app → **App Information / iOS App version page / App Privacy**. Copy-paste as-is; items marked FILL need your input.

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
Every workout, meal and night of sleep — tracked and analyzed 100% on your device. No account, no cloud, no ads. Your data never leaves your phone.
```
(147 characters)

## Description (max 4000 chars)

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
Bring in steps, weight, sleep and water from an Apple Health export (the export file you create in the Health app) or Samsung Health CSV files. The import runs entirely on your device — with a preview before anything is saved.

PRIVATE BY ARCHITECTURE, NOT BY PROMISE
• All data lives in local storage on your phone
• No account, no registration, no cloud sync
• No ads, no trackers, no analytics SDKs
• One-tap export for backups; delete everything anytime in Settings
• Works fully offline

OPTIONAL AI COACH — ON YOUR OWN TERMS
Tech-savvy? Run the free companion program on your own computer and pair your phone to it over your home Wi-Fi. Ask questions in plain language ("Plan my workouts for next week") and get answers grounded in your actual logs. It can even estimate a meal's calories and macros from a photo, or give a supportive, body-neutral read on your physique — body-composition and muscle-development estimates that help set your targets. Your photos go only to your own computer, are analyzed there and deleted right after, never to us. The coach talks only to YOUR computer — never to a cloud service of ours. Skip it entirely and every other feature still works.

HONEST LIMITS
OptimalFit is a fitness tool, not a medical device. Its insights are statistics on your own logs, not medical advice — always check with a professional before big changes. Because your data never touches a server, back it up with the built-in export.

Track everything. Learn what works for you. Keep it all to yourself.
```
(~3,280 characters — under the 4,000 limit)

## Keywords (max 100 chars, comma-separated, no spaces needed)

```
sleep,calorie,macro,workout,offline,private,tracker,body fat,steps,water,gym,log,diet,muscle
```
(92 characters. Don't repeat "fitness" or "OptimalFit" — the name/subtitle already index those.)

## Category

- **Primary:** Health & Fitness
- **Secondary (optional):** Lifestyle

## Price & availability

- Free. All territories (or your preference).

## App Privacy (App Store Connect → App Privacy section)

**Answer: "Data Not Collected"** — check the box "Data is not collected from this app."

**Is that claimable? Yes.** Apple's definition: data is "collected" when it is transmitted **off the device** in a way that is accessible to you (the developer) and/or your partners. OptimalFit:

- stores all user data in on-device WebView localStorage; the app makes no network requests to any developer or third-party server;
- has no analytics, ads, crash reporting, or third-party SDKs;
- the optional AI Coach transmits a data summary **only to a server the user personally runs on their own computer** on their own local network. The developer never receives it and cannot access it. Apple's "collected" definition (accessible to the developer/partners) is not met. The feature is also off by default and requires deliberate user setup.
- Apple Health **import** is via a user-chosen export file parsed on-device; the app does not use HealthKit APIs, so no HealthKit privacy strings or entitlements are involved.

So for every category in the questionnaire (Health & Fitness, Contact Info, Identifiers, Usage Data, Diagnostics, Location, etc.): **Not collected.** The resulting privacy "nutrition label" shows **Data Not Collected**.

⚠️ If a future version ever adds developer-accessible transmission (cloud sync, analytics), this label must be updated first.

## Age rating questionnaire (expected answers)

All of the following: **None**

- Cartoon/fantasy/realistic violence: None
- Profanity or crude humor: None
- Mature/suggestive themes: None
- Horror/fear themes: None
- Medical/treatment information: **None** — the app presents self-logged fitness statistics, not medical or treatment information (and the description/terms carry a not-medical-advice disclaimer). If you prefer maximum caution, "Infrequent/Mild Medical/Treatment Information" bumps the rating to 12+; the honest reading of the questionnaire supports None.
- Alcohol, tobacco, drug use: None
- Simulated gambling: None
- Sexual content/nudity: None
- Contests: None
- Unrestricted web access: **No** (the WebView loads only the bundled app)
- Gambling with real currency: No

**Expected rating: 4+**

## Review notes (App Review Information)

```
OptimalFit stores all data locally on the device — there is no account and no
login. To see the app populated with data, open Settings (gear icon, top
right) → "Load demo data".

The "Coach" tab is an optional feature that pairs with a companion program the
user runs on their own personal computer over their own Wi-Fi. Without it, the
tab shows a friendly explanation card — this is expected behavior, not a bug.
No cloud service is involved and the feature is not required for any other
part of the app.
```

- **Sign-in required?** No. Leave demo-account fields empty.
- **Contact:** Qualixo22@gmail.com (add your name + phone in App Store Connect — Apple requires all three for the review contact).

## URLs

- **Privacy Policy URL (required):** hosted copy of `privacy-policy.html` — FILL after hosting (see SHIP-CHECKLIST.md)
- **Support URL (required):** can be the same site's index or a GitHub repo page — FILL

## Screenshots

- **iPhone 6.7"/6.9" (required set):** use `store/screenshots/iphone67-1290x2796-*.png` (1290×2796). App Store Connect accepts 1290×2796 for the 6.7" slot; it auto-scales for smaller devices if you provide only this set.
- **iPad:** NOT needed. OptimalFit v1 is iPhone-only — the Xcode project sets `TARGETED_DEVICE_FAMILY = "1"` (both Debug and Release), so App Store Connect will not ask for iPad screenshots. If a future version adds iPad support ("1,2"), a 13" iPad screenshot set (2064×2752) becomes mandatory.

## What's New (first release)

```
First release: track sleep, food, workouts, body, water and steps; on-device insights and goal coaching; Apple Health / Samsung Health import; 100% private — all data stays on your phone.
```

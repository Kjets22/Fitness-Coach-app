# OptimalFit — App Store kit (CURRENT: upload 1.11.1 build 72)

> **Upload `OptimalFit build 67 UPLOAD THIS`** — the ONLY archive Organizer
> shows (2026-08-12). It is 1.11.1 (72): everything in build 47 PLUS the
> 30-day included free month, the background-safe async coach, coach
> proposals (Apply/Not-now), the nutrition/restaurant coach, full-screen
> coach UI, three-tier goals, coach-recommended per-exercise rest timers
> (saved forever), the done-for-today celebration card, the tap-to-explain
> readiness panel, the proactive "Do this next" card, engine autonomy
> (the coach retunes your calories and you can push back), and
> background-safe photo analysis. Build 47 (1.6.0) was already uploaded to
> App Store Connect — that is why this one is 1.7.0: a new upload must have
> a HIGHER version than the one already in App Store Connect. Superseded
> archives (47 through 60) live in
> `~/Library/Developer/Xcode/Archives-superseded/`, invisible to Organizer.


## ⚠️ REJECTION OF 1.7.0 (52) — 11 Aug 2026 — BOTH ISSUES FIXED IN 1.11.1 (72)

Submission ID 5696fb93-41c5-4a12-b9ac-dd30e0aeb661, reviewed on iPad Air 11-inch (M3).

**1.4.1 — health info without citations.** Fixed in-app: a "Science & sources"
section in Settings, plus a citation link directly under the calorie/protein
targets on the goal card AND under the dashboard "Today vs targets" rings, so
the source is one tap from every health number. Includes an explicit
not-medical-advice disclaimer.

**1.5 — Support URL was the GitHub repo.** A real support page is now live:
`https://kjets22.github.io/Fitness-Coach-app/store/support.html`

### YOU MUST DO THIS IN APP STORE CONNECT (not just upload the build)
In **App Information → Support URL**, replace
`https://github.com/Kjets22/Fitness-Coach-app` with
**`https://kjets22.github.io/Fitness-Coach-app/store/support.html`**
The 1.5 issue is a metadata field — it is NOT fixed by the new binary alone.

### Reply to paste into the App Store Connect message thread

```
Thank you for the detailed review. Version 1.11.0 addresses both issues.

Guideline 1.4.1: The app now cites the sources for every health and nutrition
number it produces. A new "Science & sources" section (Settings → Science &
sources) states the method behind each recommendation and links to the source:
the Mifflin-St Jeor equation for resting energy expenditure, the Dietary
Guidelines for Americans for activity factors and calorie needs, the NIH Body
Weight Planner for rate of weight change, the International Society of Sports
Nutrition position stand for protein intake, WHO guidance for physical
activity, and Schoenfeld et al. for resistance-training volume. The same
screen lists all 33 entries of the app's evidence base with their references
and an honest evidence grade for each.

To make the citations easy to find, as the guideline requires, a "How these
targets are calculated · sources" link appears directly beneath the daily
calorie and protein targets on the goal screen, and a "Where these targets
come from · sources" link appears beneath the "Today vs targets" rings on the
dashboard — so a user reading a calorie number is one tap from its source. The
section also carries an explicit statement that the app is not a medical
device and does not provide medical advice, and recommends consulting a
qualified healthcare professional.

Guideline 1.5: The Support URL has been updated to a functional support page:
https://kjets22.github.io/Fitness-Coach-app/store/support.html
It provides a contact email, guidance on what to include when reporting a
problem, and answers to common questions (data storage, export and deletion,
recovering data, what the AI features transmit, and subscriptions).
```

## HOW TO UPDATE THE APP THAT'S ALREADY IN APP STORE CONNECT (~15 min)

1. **Upload:** Xcode → Window → **Organizer** → Archives → select
   **OptimalFit build 67 UPLOAD THIS** → **Distribute App** → App Store
   Connect → Upload → accept defaults.
2. **App Store Connect → My Apps → OptimalFit.** What you do next depends on
   what the current 1.6.0 version says:
   - **"Prepare for Submission" or "Rejected"** (never approved): open that
     version, change the **Version** field at the top from 1.6.0 to
     **1.11.1**, and once build 72 finishes processing (~15 min) select it
     in the Build section (replacing 47/52/54).
   - **"Waiting for Review" / "In Review"**: click **Remove from Review**
     first, then do the step above.
   - **"Ready for Sale"** (already live): click **⊕ Add Version**, enter
     **1.11.1**, then select build 72 in the Build section.
3. **What's New:** paste the **1.11.1** block from `app-store-listing.md`.
4. Re-check **App Review Information** is still filled in (demo account from
   `.env.reviewer`, notes, contact) — it usually carries over.
5. **Submit for Review.** Keep the Mac (coach server) up during review —
   watchdogs are armed, just don't shut it down.

Historical context for the original rejection + all copy-paste text:
`store/app-store-listing.md`. The sections below are from the 1.6.0
resubmission and remain valid background.

## What the rejection said, and where each issue stands

| Guideline | Apple's finding | Status in 1.4.1 |
|---|---|---|
| 2.1(a) | "App failed to load the AI Coach" (iPad Air 11", active internet) | **FIXED.** 1.0 (3) required a companion program on the user's own computer — impossible on a review device. The coach is now a hosted service; with the demo account it works immediately. Verified on iPhone + iPad-compatibility sims. Keep the coach server up during review (watchdogs are armed). |
| 5.1.1(i) / 5.1.2(i) | Shares personal data with a third-party AI service without disclosure/consent; policy insufficient | **FIXED.** New in-app consent sheet (before ANY first AI request) disclosing what is sent, that it goes to the developer-operated coach service and is processed by Anthropic's Claude, transient/not stored, with decline keeping the app usable. Privacy policy gained a dedicated "AI features" section + "Optional account backup" section. Policy is LIVE at the URL below. |

## Submission steps (your ~20 minutes)

1. **Upload the build** — Xcode → Window → **Organizer** → Archives → select
   **OptimalFit-1.6.0-build47** (newest in the list) → **Distribute App**
   → App Store Connect → Upload → accept defaults (this creates the missing
   Distribution certificate with your Apple ID; approve any keychain prompt).
2. **App Store Connect → OptimalFit → + Version 1.6.0**
   - Paste **What's New**, description, promotional text from `app-store-listing.md`.
   - Select the uploaded build 47 once it finishes processing (~15 min).
3. **App Privacy** — re-answer using the updated table in `app-store-listing.md`
   (adds **Health & Fitness — linked — App Functionality** for the account backup).
4. **App Review Information**
   - Sign-in required: **ON**. Credentials: see local file **`.env.reviewer`**
     (email + password; the account is pre-upgraded so every AI feature works).
   - Notes: paste the **RESUBMISSION NOTES** block from `app-store-listing.md`.
   - Contact: Qualixo22@gmail.com + your name + phone.
5. **URLs** — Privacy Policy: `https://kjets22.github.io/Fitness-Coach-app/store/privacy-policy.html`
   · Support: `https://kjets22.github.io/Fitness-Coach-app/store/support.html`
6. **Reply to the rejection thread** in App Store Connect (message below), then **Submit for Review**.

## Reply to Apple (paste into the rejection thread)

```
Thank you for the detailed review. Version 1.6.0 (build 47) addresses both issues:

Guideline 2.1(a): In 1.0 (3) the AI Coach required a companion program running
on the user's own personal computer, which is why it could not load on the
review device. The coach is now a hosted service operated by us — it works
immediately on any device. Sign in with the demo account in App Review
Information, open the Coach tab, and ask a question; answers arrive in
10–60 seconds. This is verified on iPhone and on iPad (compatibility mode).

Guidelines 5.1.1(i)/5.1.2(i): The app now obtains explicit user permission
BEFORE the first AI request. A consent sheet discloses exactly what is sent
(the user's question, a compact summary of their recent stats, and any photo
they explicitly submit), identifies the recipients (the developer-operated
OptimalFit coach service, where requests are processed by Anthropic's Claude
AI), and states that processing is transient with nothing stored. Declining
keeps every non-AI feature fully usable. The privacy policy
(https://kjets22.github.io/Fitness-Coach-app/store/privacy-policy.html) now
contains a dedicated "AI features" section with the same disclosure, plus a
section covering the optional signed-in account backup. The App Privacy
answers have been updated accordingly.

To trigger the consent sheet during review: Coach tab → type any question →
Send (it appears before anything is transmitted).
```

## Assets

- **Archive:** `~/Library/Developer/Xcode/Archives/2026-08-12/OptimalFit-1.11.1-build72.xcarchive` — the ONLY archive in Organizer, labeled "OptimalFit build 67 UPLOAD THIS"
- **Screenshots:** `store/screenshots/iphone67-1290x2796-*.png` (valid set; shows the pre-redesign UI — fine for this compliance resubmission, refresh later via `store/tools/shoot.js` once updated for the new UI)
- **Demo account:** `.env.reviewer` (gitignored) — premium, pre-populated
- **Privacy manifest:** `native/ios/App/App/PrivacyInfo.xcprivacy` (new, in the build)

## During review

- Keep the Mac mini on AC power. Server + tunnel watchdogs are armed
  (`com.optimalfit.coach`, `com.optimalfit.funnelwatch`) — the coach must stay
  reachable while Apple tests.

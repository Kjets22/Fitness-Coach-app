# OptimalFit — App Store resubmission kit (UPLOAD 1.6.0 build 33)

> **Upload the newest archive: `OptimalFit-1.6.0-build33`** — it contains the
> compliance fixes (consent, privacy manifest) PLUS the redesign, widgets,
> haptics, and the full user-ready sprint. The 1.4.x archives are superseded.

Everything for the resubmission after the July 16 rejection of 1.0 (3).
All copy-paste text lives in `store/app-store-listing.md` (updated 2026-07-17).

## What the rejection said, and where each issue stands

| Guideline | Apple's finding | Status in 1.4.1 |
|---|---|---|
| 2.1(a) | "App failed to load the AI Coach" (iPad Air 11", active internet) | **FIXED.** 1.0 (3) required a companion program on the user's own computer — impossible on a review device. The coach is now a hosted service; with the demo account it works immediately. Verified on iPhone + iPad-compatibility sims. Keep the coach server up during review (watchdogs are armed). |
| 5.1.1(i) / 5.1.2(i) | Shares personal data with a third-party AI service without disclosure/consent; policy insufficient | **FIXED.** New in-app consent sheet (before ANY first AI request) disclosing what is sent, that it goes to the developer-operated coach service and is processed by Anthropic's Claude, transient/not stored, with decline keeping the app usable. Privacy policy gained a dedicated "AI features" section + "Optional account backup" section. Policy is LIVE at the URL below. |

## Submission steps (your ~20 minutes)

1. **Upload the build** — Xcode → Window → **Organizer** → Archives → select
   **OptimalFit-1.6.0-build33** (newest in the list) → **Distribute App**
   → App Store Connect → Upload → accept defaults (this creates the missing
   Distribution certificate with your Apple ID; approve any keychain prompt).
2. **App Store Connect → OptimalFit → + Version 1.6.0**
   - Paste **What's New**, description, promotional text from `app-store-listing.md`.
   - Select the uploaded build 24 once it finishes processing (~15 min).
3. **App Privacy** — re-answer using the updated table in `app-store-listing.md`
   (adds **Health & Fitness — linked — App Functionality** for the account backup).
4. **App Review Information**
   - Sign-in required: **ON**. Credentials: see local file **`.env.reviewer`**
     (email + password; the account is pre-upgraded so every AI feature works).
   - Notes: paste the **RESUBMISSION NOTES** block from `app-store-listing.md`.
   - Contact: Qualixo22@gmail.com + your name + phone.
5. **URLs** — Privacy Policy: `https://kjets22.github.io/Fitness-Coach-app/store/privacy-policy.html`
   · Support: `https://github.com/Kjets22/Fitness-Coach-app`
6. **Reply to the rejection thread** in App Store Connect (message below), then **Submit for Review**.

## Reply to Apple (paste into the rejection thread)

```
Thank you for the detailed review. Version 1.4.1 (build 24) addresses both issues:

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

- **Archive:** `~/Library/Developer/Xcode/Archives/2026-07-17/OptimalFit-1.4.1-build24.xcarchive` (visible in Organizer)
- **Screenshots:** `store/screenshots/iphone67-1290x2796-*.png` (valid set; shows the pre-redesign UI — fine for this compliance resubmission, refresh later via `store/tools/shoot.js` once updated for the new UI)
- **Demo account:** `.env.reviewer` (gitignored) — premium, pre-populated
- **Privacy manifest:** `native/ios/App/App/PrivacyInfo.xcprivacy` (new, in the build)

## During review

- Keep the Mac mini on AC power. Server + tunnel watchdogs are armed
  (`com.optimalfit.coach`, `com.optimalfit.funnelwatch`) — the coach must stay
  reachable while Apple tests.

# OptimalFit — Handoff / Where things stand (2026-07-08)

The app is **built, tested, and version-controlled**. What remains is store
account setup and submission. This file is the single starting point for
picking the work back up on any machine (e.g. a Mac for the iOS build).

## The app in one paragraph
Zero-dependency web app (`app/`) wrapped with Capacitor for Android + iOS
(`native/`). On-device statistical insights engine (optimal training times/days,
rest, adaptive goal targets), optional AI coach + photo→macros estimator (run
through the user's own Claude Code subscription via `serve.py`, zero API cost),
workout set logging + strength-progression engine, Apple/Samsung Health file
import. All data is device-local (no accounts, no servers, no tracking).

## Status
- **Android:** signed release AAB + APKs already built on the Windows PC →
  `dist/` (NOT in the repo — gitignored). Ready to upload to Google Play.
- **iOS:** `native/ios/` is a complete Xcode project (bundle id
  `com.optimalfit.app`, v1.0.0 build 1, brand icon + splash, iPhone-only).
  Needs a Mac + Xcode to compile & sign. See `docs/IOS-SHIP-GUIDE.md` Path A.
- **Store pack:** `store/` — privacy policy + terms (md + html), Play & App
  Store listings, data-safety/privacy answers, 12 screenshots, feature graphic.
  Contact email already filled: Qualixo22@gmail.com.
- **Full project history / decisions / build recipes:** `MINDMAP.md` (read this
  first — 27 loop-log entries + per-agent notes in Branch 4 + task registry in
  Branch 6).

## To resume on a Mac (for the App Store)
1. Install Claude Code (claude.ai/code) and sign in with the SAME Claude account.
2. Clone this repo, then in that session say: "Read MINDMAP.md and
   docs/IOS-SHIP-GUIDE.md, then walk me through the iOS build (Path A)."
3. Prerequisite: an Apple Developer account ($99/yr) — enroll first.

## Remaining user-only steps (ordered) — full detail in store/SHIP-CHECKLIST.md
1. Back up `dist/optimalfit-release.keystore` OFF this PC (loss = can't update
   the Android app ever). Password is in `dist/SIGNING-INFO.txt` (local only).
2. Host the privacy policy at a public URL (GitHub Pages — this repo).
3. Google Play Console account ($25 once) → upload `dist/OptimalFit-release.aab`.
4. Apple Developer Program ($99/yr) → build on Mac (Path A) → App Store Connect.

## Do NOT commit these (already in .gitignore)
`dist/*.keystore`, `dist/keystore.properties`, `dist/SIGNING-INFO.txt`,
`dist/*.apk/*.aab`, `node_modules/`, `*.p12/*.p8/*.mobileprovision`.

# OptimalFit — Known Limitations (honest gap notes)

Written by Store-1 (P2-5). These are real constraints of the current architecture, not bugs. None block store submission, but you should know them — and a few deserve roadmap attention.

## 1. iOS cannot be compiled on this Windows PC

Apple's toolchain (Xcode) only runs on macOS. The iOS project + a GitHub Actions macOS cloud-build workflow are prepared by task P2-4 (check MINDMAP.md Branch 6 for its status and docs). Until you run that workflow (or use a Mac), there is **no installable iOS build** — Android is fully built and signed, iOS is "ready to build," not "built."

## 2. localStorage eviction risk in WebViews (long-term data-loss hazard)

All user data lives in WebView `localStorage`. Operating systems treat WebView storage as evictable: iOS in particular may purge WKWebView website data if the device runs low on space (Android is gentler but not guaranteed). A user with a year of logs could lose them without warning.

- **Current mitigation:** built-in one-tap JSON export (Settings), and the privacy policy + listings explicitly tell users to back up because no server copy exists.
- **Recommended near-term mitigation:** an in-app periodic export reminder (e.g., a gentle banner every 30 days since last export).
- **Proper future fix:** migrate storage to a native plugin (e.g., Capacitor Preferences/SQLite), which uses non-evictable app storage. The storage layer is already isolated in `app/js/storage.js`, so this is a contained change.

## 3. The AI coach requires the user's own PC — it is not a cloud service

The Coach tab only works when the user runs `serve.py` (via `Start OptimalFit.bat` / phone mode with pairing code) on their own computer with their own Claude Code subscription, on the same Wi-Fi. In the store builds, most users will simply see the friendly "needs the local server" card. This is by design (zero API-token cost, zero data collection) and is disclosed in both store listings, but expect some users to perceive the feature as "not working." The listings position it honestly as an optional power-user feature.

## 4. No account sync between devices

No accounts means no sync: phone and tablet each have their own separate local data. Moving data between devices is manual (Export on device A → Import on device B). The Settings screen states this honestly for the phone-over-WiFi flow, and the store listings never claim sync.

## 5. Smaller notes

- **Health import is file-based only** — no live HealthKit/Health Connect sync (deliberate: those APIs would complicate the "no health-platform access" privacy posture; import parses user-chosen export files on-device).
- ~~Play feature graphic (1024×500) not generated~~ — now at `store/feature-graphic-1024x500.png` (regenerate via `node feature-graphic.js` in `store/tools/`).
- **Screenshots show demo data** (seeded generator) — normal store practice, but the "Tuesday, July 7" date in them will age; regenerate anytime with `store/tools/shoot.js`.
- **Edge headless is broken on this machine** — the screenshot tool uses system Chrome; if Chrome is ever removed, fix Edge or reinstall Chrome before regenerating screenshots.
- **Coach chat is not persisted** — history clears on app restart (memory-only by design, ~20 messages).
- **Photo macro estimation is an AI estimate, not a measurement** — it needs the same companion server as the coach (button is disabled without it), values are editable before saving and should be treated as rough; the photo is sent only to the user's own PC and analyzed there via their Claude subscription (it never leaves the user's machines).

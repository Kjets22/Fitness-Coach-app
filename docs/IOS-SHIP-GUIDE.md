# OptimalFit — iOS Ship Guide (the honest version)

Everything that CAN be prepared on this Windows PC has been prepared:

- `native/ios/` — a complete, ready-to-build Xcode project (Capacitor 8) with
  your web app synced into it (`native/ios/App/App/public/`, 32 files),
  display name **OptimalFit**, bundle id **com.optimalfit.app**, version
  **1.0.0 (build 1)**, and the brand app icon (1024×1024, no alpha — App
  Store requirement) already in `Assets.xcassets/AppIcon.appiconset/`.
- `.github/workflows/ios-build.yml` — a cloud build pipeline that compiles
  and signs the app on a rented Apple machine (GitHub Actions), so you never
  need to own a Mac.

## Why iOS can't be compiled on Windows (really)

Apple's toolchain (`xcodebuild`, the iOS SDK, code signing) only runs on
macOS, and Apple's license only allows it on Apple hardware or Apple-blessed
cloud runners. There is no workaround: no Docker image, no cross-compiler,
no third-party trick produces an installable, App-Store-acceptable IPA from
Windows. What we CAN do from Windows — and did — is prepare the project,
assets, and configuration so that the *only* remaining step is a compile on
some Mac, physical (Path A) or rented by the minute (Path B).

Either path first requires one thing only you can do:

> **Prerequisite (both paths): an Apple Developer account — $99/year.**
> Enroll at https://developer.apple.com/programs/enroll/ with your Apple ID.
> Approval usually takes a day or two.

---

## Path A — you can borrow (or own) a Mac

Simplest if you have any access to a Mac made in the last ~5 years.

1. Copy the whole project folder to the Mac (or clone the GitHub repo).
2. Install Xcode from the Mac App Store (free, large download) and Node.js
   (https://nodejs.org).
3. In Terminal:
   ```
   cd optimal-fit/native
   npm ci
   npm run sync
   npx cap open ios        # opens the project in Xcode
   ```
4. In Xcode, click the **App** project → **Signing & Capabilities** tab →
   check **Automatically manage signing** → pick your **Team** (appears
   after you log in to Xcode with your developer Apple ID under
   Xcode → Settings → Accounts). Xcode creates the certificate and
   provisioning profile for you — this is the big advantage of Path A.
5. Test on your own iPhone first (plug it in, select it as the run target,
   press ▶). Free and instant.
6. Ship: **Product → Archive**, then in the Organizer window press
   **Distribute App → App Store Connect → Upload**. The build appears in
   App Store Connect (https://appstoreconnect.apple.com) → TestFlight
   within ~15 minutes.
7. In App Store Connect: create the app record (name OptimalFit, bundle id
   com.optimalfit.app), fill the listing from `store/app-store-listing.md`,
   upload screenshots from `store/screenshots/` (iphone67-*.png), answer
   the privacy questions per `store/` pack, attach the uploaded build, and
   **Submit for Review**.

## Path B — no Mac at all (GitHub Actions)

GitHub gives you free macOS build minutes (2,000 free minutes/month on
private repos; macOS minutes count 10×, so ~200 real minutes — one build
takes ~10–15, plenty). The workflow is already written; you supply the
signing secrets.

### B1. Put the project on GitHub

1. Create a free account at https://github.com, then a **Private** repository
   (e.g. `optimal-fit`).
2. Install Git for Windows (https://git-scm.com), then in PowerShell:
   ```
   cd C:\Users\kjets\optimal-fit
   git init
   git add .
   git commit -m "OptimalFit"
   git remote add origin https://github.com/<your-username>/optimal-fit.git
   git push -u origin main
   ```
   A `.gitignore` is already in place that keeps the Android keystore,
   passwords, and build outputs OUT of the repo — don't delete it, and
   don't force-add anything from `dist/`.

### B2. Create the signing material (one-time, ~30 min, all in a browser + PowerShell)

You need 4 secrets for the iOS workflow. Here is where each comes from:

**1. `APPLE_CERT_P12_BASE64` + 2. `CERT_PASSWORD`** — your distribution
certificate.

Normally Keychain (a Mac app) creates the certificate signing request, but
you can do it on Windows with OpenSSL (ships inside Git for Windows —
use `C:\Program Files\Git\usr\bin\openssl.exe` if `openssl` isn't found):

```
# private key + certificate request
openssl genrsa -out ios_dist.key 2048
openssl req -new -key ios_dist.key -out ios_dist.csr -subj "/emailAddress=you@example.com/CN=OptimalFit Distribution/C=US"
```

- Go to https://developer.apple.com/account/resources/certificates/add
- Choose **Apple Distribution**, upload `ios_dist.csr`, download the
  resulting `distribution.cer`.
- Convert to .p12 (pick a password — that password IS `CERT_PASSWORD`):
```
openssl x509 -inform DER -in distribution.cer -out distribution.pem
openssl pkcs12 -export -inkey ios_dist.key -in distribution.pem -out ios_dist.p12
```
- Base64 it (this string IS `APPLE_CERT_P12_BASE64`):
```
[Convert]::ToBase64String([IO.File]::ReadAllBytes("ios_dist.p12")) | Set-Clipboard
```
Keep `ios_dist.key` / `ios_dist.p12` backed up somewhere private (NOT the repo).

**3. `PROVISIONING_PROFILE_BASE64`** — the App Store provisioning profile.

- First register the app id: https://developer.apple.com/account/resources/identifiers/add
  → App IDs → App → Bundle ID **explicit** `com.optimalfit.app`,
  description "OptimalFit". No extra capabilities needed.
- Then https://developer.apple.com/account/resources/profiles/add →
  **App Store Connect** distribution profile → select the
  `com.optimalfit.app` App ID → select the certificate you just created →
  name it (e.g. "OptimalFit App Store") → download the `.mobileprovision`.
- Base64 it the same way:
```
[Convert]::ToBase64String([IO.File]::ReadAllBytes("OptimalFit_App_Store.mobileprovision")) | Set-Clipboard
```

**4. `APPLE_TEAM_ID`** — https://developer.apple.com/account →
Membership details → **Team ID** (10 characters, e.g. `AB12CD34EF`).

### B3. Add the secrets and run the workflow

1. GitHub repo → **Settings → Secrets and variables → Actions →
   New repository secret** — add the 4 secrets above (exact names).
2. Repo → **Actions** tab → **iOS build (IPA)** → **Run workflow**.
3. ~10–15 min later the run finishes; download the **OptimalFit-ios-ipa**
   artifact (a .zip containing `App.ipa`).

### B4. Get the IPA into App Store Connect

- First create the app record at https://appstoreconnect.apple.com →
  My Apps → **+** → New App (platform iOS, name OptimalFit, bundle id
  com.optimalfit.app, SKU anything, e.g. `optimalfit-1`).
- **Easiest upload without a Mac:** enable the auto-TestFlight step —
  uncomment the "Upload to TestFlight" step at the bottom of
  `.github/workflows/ios-build.yml` and add the 3 extra secrets described
  there (App Store Connect → Users and Access → Integrations →
  App Store Connect API → **Generate API Key**, role App Manager; download
  the `.p8` — Apple lets you download it exactly ONCE — and base64 it).
  Re-run the workflow: the build lands directly in TestFlight.
- Alternative with a borrowed Mac for 5 minutes: Apple's free **Transporter**
  app (Mac App Store) uploads any .ipa. (Apple no longer offers Transporter
  for Windows.)
- Then in App Store Connect: TestFlight tab → test the build on your own
  iPhone via the TestFlight app (recommended!), then attach the build to
  version 1.0.0, fill the listing (`store/app-store-listing.md`), and
  Submit for Review.

### Android too (bonus)

`.github/workflows/android-build.yml` is the same idea for Android: add
`ANDROID_KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`
(values in `dist/SIGNING-INFO.txt`, keystore file `dist/optimalfit-release.keystore`)
and every future release AAB can be built in the cloud instead of on this PC.
Remember to bump `versionCode` in `native/android/app/build.gradle` first.

---

## What Apple's review will care about (health app)

OptimalFit is in the "Health & Fitness" category, and reviewers look
harder at these apps. What matters, and how this app answers it:

| Review concern | OptimalFit's answer |
|---|---|
| **Privacy policy URL** (required field in the listing) | `store/privacy-policy.html` must be hosted at a public URL first — see `store/SHIP-CHECKLIST.md`. GitHub Pages on your new repo is a free option. |
| **App Privacy "nutrition label"** | All data stays on-device (localStorage); nothing is collected or transmitted. Answer "Data Not Collected" — details prepared in the `store/` pack. |
| **Medical claims** (guideline 5.1.1/1.4.1) | The app gives training/eating *suggestions from the user's own logged data*, not medical advice or diagnoses. Keep listing copy free of "medical", "treats", "cures" claims — `store/app-store-listing.md` already is. |
| **HealthKit** | NOT used (no HealthKit entitlement, no `NSHealthShareUsageDescription` needed). Apple Health data arrives only via the user's own manual export.xml file import — say exactly that if the reviewer asks. |
| **Minimum functionality** (4.2) — "is it just a website?" | The app is fully offline-capable, has onboarding, charts, an insights engine — comfortably more than a wrapped webpage. If pressed, the statistical insights engine is the demonstrable native value. |
| **Account requirement** | None — no login, works instantly. Reviewers like this. |
| **AI coach expectations** | The Coach tab degrades to a friendly "not available" card in the native app (it pairs with the owner's PC over LAN). `store/KNOWN-LIMITATIONS.md` covers how to phrase this honestly in the listing so the review build doesn't look broken. |
| **Demo for the reviewer** | "Load demo data" in Settings (or onboarding's "Explore with demo data") instantly fills the app — mention it in the review notes field so the reviewer sees a populated app. |

## Current iOS project facts (for reference)

- Project: `native/ios/App/App.xcodeproj` (Capacitor 8, Swift Package Manager — no CocoaPods needed)
- Bundle id: `com.optimalfit.app` · Display name: `OptimalFit`
- Version: `MARKETING_VERSION 1.0.0`, `CURRENT_PROJECT_VERSION 1` (bump the
  build number for every App Store Connect upload)
- Deployment target: iOS 15.0 · iPhone + iPad
- Icon: `Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` — 1024×1024
  RGB **without** alpha (Apple rejects alpha here); regenerate with
  `python native/scripts/gen_native_icons.py` if the brand changes
- `ITSAppUsesNonExemptEncryption = false` is set in Info.plist (no custom
  encryption), so you won't be asked the export-compliance question on
  every TestFlight build
- After ANY change to `app/`: run `npm run sync` in `native/` before the
  next build (the cloud workflow does this automatically)

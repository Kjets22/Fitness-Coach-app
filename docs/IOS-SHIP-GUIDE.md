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

### Path A (command-line) — the exact archive → export → upload sequence

If you prefer the terminal to the Xcode GUI (or want a repeatable release
script), this is the precise pipeline. It has been dry-run on this project up
to the signing boundary, so the ONLY thing missing is your Apple cert + team.

**0. One-time signing setup (needs the $99 account).** Sign in to Xcode with
your developer Apple ID (Xcode → Settings → Accounts → **+**). Then find your
10-character Team ID at https://developer.apple.com/account → Membership, and
paste it into `native/ios/exportOptions.plist` in place of
`REPLACE_WITH_TEAM_ID`. With `signingStyle=automatic`, Xcode auto-creates the
App Store distribution certificate and the `com.optimalfit.app` provisioning
profile for you — no manual CSR/`.p12` juggling (that manual route is only
needed for the Mac-less cloud path, Path B below).

**1. Sync the latest web build and archive** (run from repo `native/`):
```
npm ci && npm run sync              # refreshes native/ios/App/App/public/
cd ios/App
xcodebuild archive \
  -project App.xcodeproj \
  -scheme App \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$HOME/OptimalFit.xcarchive"
```
(No `CODE_SIGNING_ALLOWED=NO` here — for a real upload you WANT it signed.
Automatic signing picks up the cert/profile from step 0. A build-only proof
that skips signing was already verified with
`... -archivePath <scratch>/OptimalFit.xcarchive CODE_SIGNING_ALLOWED=NO` and
**ARCHIVE SUCCEEDED**, with all three photo/camera usage strings confirmed
baked into the archived `App.app/Info.plist`.)

**2. Export a signed `App.ipa`:**
```
xcodebuild -exportArchive \
  -archivePath "$HOME/OptimalFit.xcarchive" \
  -exportOptionsPlist ../../ios/exportOptions.plist \
  -exportPath "$HOME/OptimalFit-export"
```
The signed `App.ipa` lands in `$HOME/OptimalFit-export/`.

> **Where it stops without the cert (verified):** running step 2 today, with
> no distribution certificate installed, fails at exactly this point:
> ```
> error: exportArchive No signing certificate "iOS Distribution" found
> error: exportArchive No profiles for 'com.optimalfit.app' were found
> ```
> That is the *entire* remaining gap. Completing step 0 (enroll + sign in +
> set the Team ID) resolves both errors — nothing else in the project needs
> to change.

**3. Upload to App Store Connect** (create the app record first, per step 7
above). Either:
```
xcrun altool --upload-app -f "$HOME/OptimalFit-export/App.ipa" \
  -t ios --apiKey <KEY_ID> --apiIssuer <ISSUER_ID>
```
(App Store Connect → Users and Access → Integrations → App Store Connect API →
**Generate API Key**, role App Manager; place the downloaded `AuthKey_<KEY_ID>.p8`
in `~/.appstoreconnect/private_keys/`.) Or, simpler, open the free
**Transporter** app from the Mac App Store and drag `App.ipa` in. The build
appears under TestFlight in ~15 minutes; attach it to version 1.0.0 and
**Submit for Review**.

**Device test before shipping (optional).** To side-load onto your own iPhone
first, archive as above, then export with the development variant:
`xcodebuild -exportArchive -archivePath "$HOME/OptimalFit.xcarchive"
-exportOptionsPlist ../../ios/exportOptions-development.plist -exportPath
"$HOME/OptimalFit-dev"` (your device UDID must be registered — Xcode does this
automatically the first time you run on the plugged-in device).

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
- Deployment target: iOS 15.0 · iPhone only (`TARGETED_DEVICE_FAMILY = 1`)
- Privacy usage strings in `Info.plist` (required — the web UI opens camera /
  photo-library file inputs, so their absence would CRASH the app on first tap
  and is an automatic App Review rejection): `NSCameraUsageDescription`,
  `NSPhotoLibraryUsageDescription`, `NSPhotoLibraryAddUsageDescription`. No
  location / HealthKit / contacts / microphone keys are present — the app must
  not ask for permissions it never uses. App Transport Security uses the secure
  default (no `NSAllowsArbitraryLoads`); the WebView serves local assets over
  Capacitor's own scheme and Supabase is reached over TLS, so no ATS loosening
  is needed.
- Icon: `Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` — 1024×1024
  RGB **without** alpha (Apple rejects alpha here); regenerate with
  `python native/scripts/gen_native_icons.py` if the brand changes
- `ITSAppUsesNonExemptEncryption = false` is set in Info.plist (no custom
  encryption), so you won't be asked the export-compliance question on
  every TestFlight build
- After ANY change to `app/`: run `npm run sync` in `native/` before the
  next build (the cloud workflow does this automatically)

# OptimalFit — Your Launch Checklist

Everything the app needs is built, QA'd, and on GitHub. This is the list of things
**only you can do** (accounts, payments, hosting, secrets), with exact steps.
Ordered by priority. Deeper detail lives in `store/SHIP-CHECKLIST.md` Part C.

Reviewer/demo credentials, Supabase secrets, and signing material are all in
**gitignored** local files (`.env.reviewer`, `.env.supabase`, `dist/keystore.properties`)
— never in the public repo.

---

## 0. Already done for you (no action)
- [x] Coach CLI login verified working on this Mac (real round-trip succeeded).
- [x] Reviewer demo account created + pre-confirmed, feed populated (see `.env.reviewer`).
- [x] Android + iOS built; iOS runs in Simulator + archives; camera/photo crash fixed.
- [x] All social + Receipts features live, QA-passed (0 high/0 medium), pushed to GitHub.

---

## 1. Rotate the Supabase secrets  ⚠️ DO THIS FIRST (security)
They were shared in plaintext during setup, so treat all three as compromised.
1. Go to https://supabase.com/dashboard/project/puopvaqquujalwnzwyov
2. **Settings → API → Project API keys** → roll the **`service_role`** key.
   (The `anon`/publishable key can stay — it's public by design and the only key in the app.)
3. **Account (top-right avatar) → Access Tokens** → revoke the personal access token
   (`sbp_…`). Generate a new one only if you'll run the Supabase CLI again.
4. **Settings → Database → Database password → Reset**.
5. Update your local **`.env.supabase`** with the new values (it's gitignored — nothing to push).
   Nothing in the shipped app breaks; only local CLI/admin scripts use these.

## 2. Host the updated privacy policy  (required by both stores)
The file is `store/privacy-policy.html`. Easiest free option — GitHub Pages:
1. On GitHub → your repo → **Settings → Pages**.
2. Source: **Deploy from a branch** → branch `main` → folder `/root` (or `/docs` if you move it there) → Save.
3. Your policy will be at `https://kjets22.github.io/Fitness-Coach-app/store/privacy-policy.html`
   (adjust path to where the file lands). Open it to confirm it renders.
   - Tell me if you'd rather I move the HTML to `/docs` and set it up so the toggle "just works" — I can do that part.
4. Also host `store/terms-of-service.html` the same way; note both URLs for the store forms.

## 3. Apple App Store  ($99/yr) — iOS shipping
The build is archive-ready; the ONLY missing piece is your paid signing certificate.
1. Enroll at https://developer.apple.com/programs/ ($99/yr).
2. In **App Store Connect**, create the app: bundle id `com.optimalfit.app`, name "OptimalFit".
3. Create an **Apple Distribution** certificate + an App Store **provisioning profile** for
   `com.optimalfit.app` (Xcode can do this automatically once you sign in with your Apple ID:
   open `native/ios/App/App.xcodeproj` → target App → **Signing & Capabilities** → check
   "Automatically manage signing" → pick your Team).
4. Archive + upload: in Xcode, **Product → Archive → Distribute App → App Store Connect**.
   (Command-line path with exact commands is in `docs/IOS-SHIP-GUIDE.md` → "Path A".)
5. Fill the listing from `store/app-store-listing.md`:
   - App Privacy answers (the rewritten "collects email/photos/user-id, optional, not tracking" set).
   - Screenshots: upload `store/screenshots/iphone67-1290x2796-*.png` (8 shots).
   - **Sign-in for review:** paste the email+password from `.env.reviewer` into the
     "Sign-in required" fields (username `optimalfit_demo`).
   - Support URL + your review contact **name + phone** (Apple requires all three).
6. Submit for review.

## 4. Google Play  ($25 one-time) — Android shipping
1. Create a Play Console account at https://play.google.com/console ($25 one-time).
2. **Keystore decision** (signing): the release keystore is NOT in this repo. Either:
   - Copy the original `optimalfit-release.keystore` from your old Windows PC into `dist/`, OR
   - Use the provisional one this Mac generated (`dist/optimalfit-release.keystore`) — fine,
     since nothing was ever uploaded to Play yet. **Recommended: enable Play App Signing**
     so Google manages the key going forward and a lost keystore is recoverable.
3. **Bump the version** before your first upload: in `native/android/app/build.gradle`
   set `versionCode 2` (and bump `versionName` if you like), then rebuild the AAB
   (recipe in `dist/BUILD-INFO.txt`). Upload `dist/OptimalFit-release.aab`.
4. Fill the listing from `store/play-store-listing.md`:
   - **Data safety** form (the rewritten answers — email/UGC/user-id, optional, encrypted, not shared).
   - **App access:** paste the `.env.reviewer` credentials.
   - Screenshots: `store/screenshots/play-1080x2160-*.png` (8 shots) + `store/feature-graphic-1024x500.png`.
5. New Play accounts require a **closed test with ~12 testers for 14 days** before production —
   start that early (it's a calendar-time gate, not work).

## 5. Supabase Auth email settings  (so signups work for real users)
1. Dashboard → **Authentication → Providers → Email**: confirm "Confirm email" is how you want it.
2. **Authentication → Emails / SMTP**: the default Supabase sender is rate-limited and may land
   in spam. For real launch, set a custom SMTP sender (e.g. Resend/SendGrid free tier). Optional
   for testing (the reviewer account is already pre-confirmed).

## 6. Final on-device smoke test  (5 minutes, iOS)
The code is fixed + verified; this is the human eyes-on pass Apple-style.
- I'll boot the app in the iOS Simulator for you (ask me). Then tap:
  1. Settings → Load demo data.
  2. Insights → find a lift with a PR → "Turn this PR into a Receipt" → **Share as image** →
     confirm the iOS share sheet opens.
  3. Food tab → **Estimate from photo** → tap to open the camera/photo picker → confirm it
     does NOT crash and the picker appears.
- On Android I've already driven this via the emulator (see the runtime-verification result).

---

## Quick reference — where things are
| Thing | Location |
|---|---|
| Reviewer demo login | `.env.reviewer` (gitignored) |
| Supabase secrets | `.env.supabase` (gitignored) |
| Android keystore + passwords | `dist/optimalfit-release.keystore`, `dist/keystore.properties` (gitignored) |
| Store listings + answers | `store/app-store-listing.md`, `store/play-store-listing.md` |
| Privacy policy / terms | `store/privacy-policy.html`, `store/terms-of-service.html` |
| iOS ship guide (commands) | `docs/IOS-SHIP-GUIDE.md` |
| Android rebuild recipe | `dist/BUILD-INFO.txt` |
| Full detail | `store/SHIP-CHECKLIST.md` Part C |

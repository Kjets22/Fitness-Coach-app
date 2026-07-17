# OptimalFit Privacy Policy

**Effective date:** July 8, 2026
**Applies to:** the OptimalFit app on Google Play, the Apple App Store, and the OptimalFit web/PWA version.

> **What changed:** this policy was materially updated on July 8, 2026. The previous version (July 7, 2026) truthfully said "we collect nothing" because the app had no online features at all. OptimalFit now offers an **optional, opt-in social community**. If you create a community account, some data you explicitly choose to share is stored on our servers — this policy describes exactly what, where, and how to delete it. If you never create an account, nothing has changed: the app still collects nothing.

## The short version

**OptimalFit is local by default.** Everything you log — sleep, food, exercise, weight, body measurements, water, steps, and goals — is stored **only on your own device**, exactly as before. No account is needed for any tracking or coaching feature. There are still no analytics, no advertising, no tracking, and no telemetry — anywhere in the app, signed in or not.

**The community is opt-in.** If — and only if — you choose to create a community account, we store the account itself and the things you explicitly publish (posts, likes, comments, your profile). We never upload your private logs, your unposted photos, or anything you didn't deliberately hit "share" on.

## Local by default: what never leaves your device

OptimalFit lets you log health and fitness information such as:

- Sleep times and sleep quality ratings
- Meals, foods, calories, and macronutrients
- Workouts (type, duration, intensity, how they went)
- Body metrics (weight, body fat %, muscle mass %)
- Water intake and daily steps
- A fitness goal and personal profile details you choose to enter (height, age, sex, activity level)
- Photos you analyze with the optional coach (meal or physique photos)

**All of this stays in local storage on your device.** It is processed on your device by the app itself (for charts, insights, and recommendations). The coach engine runs fully on-device. None of this raw data is ever transmitted to us — whether or not you have a community account.

## Opt-in community: what we collect if you create an account

If you choose to sign up for the OptimalFit community, we collect and store:

- **Account:** your email address and a password. The password is hashed by our authentication provider (Supabase Auth); we never see or store it in plain text. Your email is used for sign-in and account management only — not for marketing.
- **Profile:** a username, a display name, and — only if you add them — an avatar image and a short bio.
- **Content you explicitly publish:** workout, meal, and photo posts (with any images you attach), and "Receipt" cards — small stat cards computed by your on-device coach (for example an estimated-1RM trend, a consistency grid, or a weight-trend summary). **A Receipt contains only the numbers shown on the card, never the underlying logs.** Every post is shared per-post, by an explicit action from you; nothing is auto-published.
- **Social activity:** who you follow, likes, and comments.
- **Gym check-ins:** the gym name you type and the date. **No GPS or location data is collected — the app never accesses your location.** A check-in is just text you chose to post.
- **Anonymized benchmark contributions:** if you publish verified Receipt posts, the numbers on them may contribute to anonymized, aggregate community benchmarks (for example "median estimated 1RM for your cohort"). These aggregates are **k-anonymous**: a cohort statistic is only ever served when at least 5 distinct users have contributed to it, and no individual's numbers are ever exposed through benchmarks.

That is the complete list. Community features do not read or upload anything else from your device.

## Where community data lives

Community data is stored with **Supabase** (our hosting provider) in a hosted Postgres database and file storage, located in the **United States**. Supabase processes this data on our behalf to run the service. Data is encrypted in transit (HTTPS). Images you post are stored in Supabase Storage.

We do **not** sell your data, share it with data brokers or advertisers, or give any third party access to it beyond Supabase acting as our hosting processor.

## Retention and deletion

- Community data is kept for as long as your account exists.
- **You can delete your account at any time, inside the app.** Account deletion cascades: it deletes your profile, your posts, your uploaded images (the image files themselves are removed from storage), your likes, your comments, your check-ins, your follow relationships, and your benchmark contributions.
- You can also delete individual posts, comments, and check-ins at any time.
- Deleting your account does not touch your local tracking data — that stays on your device, under your control, as always.

## What we still never collect

Even with a community account:

- **Your raw log history** — your full sleep, food, workout, weight, and body-fat records are not collected for any product purpose. They leave your device only in two cases you control: the compact stats summary sent with an AI request you make (see "The AI features" below), and the private account backup if you sign in (see "Optional account backup").
- **Photos you don't submit** — the camera roll is never scanned. A photo leaves your device only when you explicitly submit it for meal/physique analysis (processed transiently, never stored — see below) or attach it to a community post.
- **No analytics or telemetry** — the app does not phone home, count usage, or report crashes to us. We added none in this update.
- **No advertising and no ad SDKs.**
- **No tracking and no sale of data** — ever, for any user.
- **No location** — the app never requests or collects GPS/location data. Gym check-ins are text you type.
- **No contact-list access** — finding people works by username, not by uploading your contacts.

## Health-file import happens on your device

You can optionally import an Apple Health export file or Samsung Health CSV files. These files are read and processed **entirely inside the app on your device**. The file contents are never uploaded anywhere.

## The AI features (coach, photo macros, physique analysis)

The AI Coach, photo meal analysis, and physique analysis are powered by the **OptimalFit coach service** — a server operated by the developer — where requests are processed by **Anthropic's Claude AI** to generate the answer.

**What is sent (and nothing more):**
- your question or request,
- a compact summary of your recent stats (averages and trends — never your raw log history), and
- a photo, only when you explicitly choose photo meal analysis or physique analysis.

**What is never sent:** your name, email, account identity, raw log history, or anything you didn't ask about.

**How it is handled:** requests are processed transiently to produce your answer and are **not stored** by the coach service. Anthropic processes the request under its commercial API terms, which prohibit using the data to train models.

**Your permission is asked first:** before your first AI request, the app shows a consent notice explaining exactly this, and no data is sent unless you agree. Declining leaves every non-AI feature fully usable. If you have a community account, the coach can additionally **fetch** anonymous aggregate benchmark percentiles from our server (a download of cohort statistics, not an upload of your logs).

## Optional account backup (cross-device sync)

If — and only if — you sign in to an account, the app keeps an encrypted-in-transit backup of your app data (logs, preferences, training program and progress) in your account's **private row** in our Supabase database, so that reinstalling the app or signing in on a new device restores your data. This backup:

- is accessible only to your account (row-level security),
- is never shared, sold, analyzed, or used for anything except restoring your data to you, and
- is **deleted when you delete your account** in-app.

If you never sign in, nothing is backed up and all data stays only on your device.

## Your data, your control

- **Export:** you can export all of your local data to a file at any time from Settings.
- **Delete local data:** erase everything on-device anytime from Settings ("Clear all data") or by uninstalling the app.
- **Delete community data:** delete individual posts anytime, or delete your whole account in-app — the cascade described above removes everything server-side.
- **Backup:** without an account we hold no copy of your data (use Settings → Export). With an account, your private backup restores your data when you sign in, and is deleted with your account.

## Data security

Local data never travels over the internet. Community data travels over HTTPS to Supabase, where passwords are hashed and data is stored in access-controlled infrastructure. Per-user access rules ensure users can only modify their own content. The optional coach connection remains limited to your own local network with a pairing code.

## Children's privacy

The tracking features have no accounts and collect nothing. **Community accounts require you to be at least 13 years old** (or the higher minimum age in your region). The sign-up flow includes an age confirmation, and we do not knowingly allow accounts for children under 13. If you believe a child under 13 has created an account, contact us and we will delete it and its data.

## Community safety and moderation

The community has rules (see the Terms of Service). You can **report** any post, comment, or user, and **block** users (blocking hides content in both directions). Posts reported by multiple users are automatically hidden pending review. Moderation questions and reports: **Qualixo22@gmail.com**.

## Permissions

OptimalFit does not request access to your contacts, location, or microphone. Health-data import and post images work only through files/photos you explicitly choose with the system picker.

## Changes to this policy

If we change how the app handles data, we will update this policy, change the effective date above, and describe the change plainly in the app's update notes — exactly as we have done with this update.

## Contact

Questions about this policy or the app:

**Email:** Qualixo22@gmail.com

---

*Summary you can quote: OptimalFit is local by default — tracking works with no account, no analytics, and no ads. AI answers are generated by sending only your question, a compact stats summary, and any photo you submit to the developer-operated coach service (processed transiently by Anthropic's Claude, never stored) — and only after you consent in-app. Signing in adds an optional private backup of your data and the opt-in community, both deletable in-app with a full cascade.*

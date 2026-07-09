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

- **Your raw logs** — sleep, food, workout, weight, and body-fat history never leave your device. Only the summary numbers on a Receipt card you chose to post are shared.
- **Photos you don't post** — coach photo analysis (meals, physique) stays on your own machines; only images you explicitly attach to a post are uploaded.
- **No analytics or telemetry** — the app does not phone home, count usage, or report crashes to us. We added none in this update.
- **No advertising and no ad SDKs.**
- **No tracking and no sale of data** — ever, for any user.
- **No location** — the app never requests or collects GPS/location data. Gym check-ins are text you type.
- **No contact-list access** — finding people works by username, not by uploading your contacts.

## Health-file import happens on your device

You can optionally import an Apple Health export file or Samsung Health CSV files. These files are read and processed **entirely inside the app on your device**. The file contents are never uploaded anywhere.

## The optional AI Coach (self-hosted, your own computer)

The optional "Coach" feature is unchanged: it only works if **you** run a small companion program on **your own personal computer** and pair your device to it over your own local network. Coach questions and photo analysis go only to your own machine — never to our servers. If you have a community account, the coach can additionally **fetch** anonymous aggregate benchmark percentiles from our server to enrich its advice (a download of cohort statistics, not an upload of your logs).

## Your data, your control

- **Export:** you can export all of your local data to a file at any time from Settings.
- **Delete local data:** erase everything on-device anytime from Settings ("Clear all data") or by uninstalling the app.
- **Delete community data:** delete individual posts anytime, or delete your whole account in-app — the cascade described above removes everything server-side.
- **Backup responsibility:** we hold no copy of your local logs, so we cannot restore them. Please use the export feature.

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

*Summary you can quote: OptimalFit is local by default — all tracking and coaching stays on your device with no account, no analytics, and no ads. The optional community stores only your account (email), profile, and the posts, likes, comments, and check-ins you explicitly publish, hosted with Supabase in the US, deletable in-app with a full cascade. Your raw logs and unposted photos never leave your device, and community benchmarks are k-anonymous aggregates.*

# OptimalFit — What Was Built

A complete record of everything designed, built, fixed, and shipped for OptimalFit, so you can see the whole picture in one place.

**What OptimalFit is:** a two-sided fitness app — a **private-by-default tracker + on-device coaching engine** on one side, and an **opt-in social community** on the other. It runs as a web app, an installable PWA, and native **iOS + Android** apps (Capacitor), with a **Supabase** backend for the community and a small **companion server** for the AI coach.

**Status:** feature-complete, security-hardened, on GitHub, native builds compiled. The AI coach is live on your phone through an internet tunnel. Remaining work is the App Store re-upload (build 3) and the store submission steps.

---

## 1. The core tracker (private, on-device)

Everything here is stored **only on your device** (localStorage) — no account needed, nothing transmitted.

- **Trackers:** Sleep, Food (calories + protein/carbs/fat), Workouts (type/duration/intensity/how it went), Body (weight, body-fat %, muscle %), Water, Steps.
- **On-device Insights Engine** — pure statistics, zero AI, runs entirely on the phone:
  - Best time of day / best weekday for *your* workouts (sleep-adjusted so it isn't fooled by confounds)
  - How last night's sleep affects today's performance (regression)
  - Fatigue detection → your ideal rest cadence
  - A daily **Readiness** score (0–100)
  - Every recommendation is **confidence-tagged** by sample size and honest when data is thin
- **Adaptive goals** — pick a goal (lean bulk / cut / recomp / maintain / performance); it learns your *real* maintenance calories from your own logs and adjusts weekly targets, and tells you straight if a timeline is unrealistic.
- **Health import** — Apple Health export + Samsung Health CSV, processed on-device.
- **Export / delete-all** for full data control.

## 2. The AI Coach (three ways to run it)

An optional AI coach that answers questions grounded in your own logged data. It never uses a hardcoded API key, so there is **zero per-token cost baked into the app**.

- **Your Claude subscription (default)** — runs through the Claude Code CLI on your computer via the companion `serve.py`. Zero cost.
- **On the phone, for everyone (now live)** — `serve.py` runs in **public mode** behind a **Tailscale Funnel**, so the shipped app reaches your Mac over the internet and every user's coach question is answered through your Claude account. Secured with a baked access key. Runs under **launchd** so it survives reboots.
- **Paid API key (future switch)** — drop an Anthropic key into `.env.llm` and every request routes through the paid API instead of your subscription — no rebuild. Built and ready for when you scale.

Also AI-powered (same routing): **food-photo → macro estimation** and **body-neutral physique analysis** (now calibrated with your height/weight/age/sex).

## 3. The Community (opt-in social side)

Built on Supabase, private-by-default, only what you explicitly post leaves the device.

- Accounts (email sign-in), profiles, follow/unfollow
- Posts, photos, likes, comments
- **Receipts** — proof-backed stat cards computed by your on-device coach (est-1RM trends, consistency grids, weight-trend summaries); only the card numbers are shared, never your logs
- Gym check-ins (name + date, **no GPS/location ever**), gym leaderboards, friends leaderboards
- **Community benchmarks** — anonymous, aggregate percentiles that only appear once **≥5 people** contribute (k-anonymous; individuals never exposed)
- **Moderation:** report, block (two-way hide), auto-hide of posts reported by 3+ users, 13+ age gate, full in-app **account deletion** (cascades to all your content)

Backend security: Row-Level Security is **default-deny**; feeds run under the caller's own permissions; privileged reads use SECURITY DEFINER functions with tight scope.

## 4. Premium paywall + 7-day free trial

- The 3 AI features (Coach, food-photo, physique) are **Premium**; everything else is free.
- **7-day free trial** for every new account (server-set, can't be extended).
- **Owner-controlled** premium: a server-enforced `is_premium` flag users can *never* set themselves, granted via `tools/grant-premium.mjs`.
- **App-Store-safe:** no in-app "Buy" button (that would require Apple IAP) — it's an access gate. Real payment (Apple IAP / Play Billing) is a documented future step; the entitlement plumbing is already in place.

> Note on the current model: because you chose "let everyone use the coach through my account for now," the paywall is currently **advisory** (client-side) and the coach server doesn't per-user-check premium. That's intentional for launch scale. Enforcing it later means validating Supabase logins on the coach server + per-install keys + IAP.

## 5. Security hardening (two adversarial audits)

Two multi-agent bug hunts (7-lens then 11-lens, ~70 agents total, each finding adversarially re-verified). Highlights:

**Two CRITICAL holes found and closed (verified live):**
1. **Internet auth bypass** — an attacker could spoof `Host: localhost` through the tunnel to skip the access key entirely and use your Claude account for free. Fixed: the key is now required on *every* public request; privilege is never derived from the (spoofable) Host header. Re-tested on the live tunnel — spoofed request now returns 401.
2. **Self-grant Premium/admin** — the database "freeze" that stops users editing their own premium status only covered updates, not inserts. Fixed with a migration; verified the exploit is now forced back to `false / false / 7-day-trial`.

**Plus:** global rate limiting (caps subscription drain / DoS), socket timeouts (slowloris), prompt-injection hardening (the image-analysis AI runs from an isolated temp folder, never your repo/secrets directory), and confirmation that your `.env` secrets are **not** reachable through the tunnel.

## 6. Everything fixed (bug sweeps + iOS polish)

Across the QA passes and the two hunts, **48+ verified bugs** were fixed. Notable ones:

- **iOS scroll bounce** — the whole app (header + tab bar) shifted during overscroll; fixed at the native WebView level (the definitive fix after a first attempt using an Apple API that silently no-ops).
- **Feed crash** — a malformed community post could take down the entire feed for everyone; guarded and stress-tested with hostile payloads.
- **iOS form bugs** — date/number/select overlap and misalignment (missing `-webkit-appearance`), the "Weight (lb)" label wrapping.
- **Log button centered** — the mobile bottom bar was redesigned to a clean 4-destination layout around a centered, raised gradient Log button.
- **Premium visual polish** — dashboard depth, readiness-ring glow, sparklines, brand-gradient fix, segmented rating pills, gradient timer, community receipt styling.
- **Confirmation email** — the sign-in confirmation link pointed at a dead `localhost` page; added a proper hosted "Email confirmed" landing page and repointed Supabase.
- **Photo picker** — wasn't a bug: the button was disabled because no server was reachable (same root cause as the coach); the tunnel fix enabled it. Verified the native iOS picker (Photo Library / Take Photo / Choose File) works.
- Rating pills showing unselected on iOS, toasts hidden behind sheets, landscape notch overlap (now portrait-locked), color-mix fallbacks for iOS 15–16.1, timezone day-boundary math, stale-premium-after-signout, keyboard-covered inputs, and many more.

## 7. Shipping infrastructure (created for you)

- **Store listings:** `store/app-store-listing.md`, `store/play-store-listing.md` — copy-paste-ready description, keywords, privacy answers, age-rating answers, review notes.
- **Legal pages (live on GitHub Pages):** privacy policy, terms of service, email-confirmed landing.
- **Screenshots:** 8 App Store (1284×2778) + 8 Play (1080×2160) + feature graphic.
- **Runbooks:** `SHIP-IT.md` (the ordered step-by-step to submit), `docs/IOS-SHIP-GUIDE.md`, `docs/BACKEND.md`.
- **Owner tools:** `tools/grant-premium.mjs` (grant/revoke premium), `tools/start-coach-server.sh` + launchd agent (auto-running coach server), `tools/bake-coach-config.mjs` (inject the tunnel config at build time without committing secrets).
- **Native builds:** iOS archive-ready (build 3), Android debug/release APK + AAB in `dist/`.

## 8. Key files & where things live

| What | Where |
|---|---|
| App source (all features) | `app/js/*.js` (vanilla JS, no build step) |
| AI coach + image analysis server | `serve.py` |
| Backend schema + security | `supabase/migrations/*.sql` (16 migrations) |
| Store listing copy | `store/app-store-listing.md`, `store/play-store-listing.md` |
| Legal pages (hosted) | `store/privacy-policy.html`, `terms-of-service.html`, `confirmed.html` |
| Shipping runbook | `SHIP-IT.md` |
| Grant premium to an account | `tools/grant-premium.mjs` |
| Secrets (gitignored, never pushed) | `.env.supabase`, `.env.coach`, `.env.llm`, `.env.reviewer` |
| Project memory / full change log | `MINDMAP.md` (Loop Log) |

## 9. Where things stand & what's left for you

**Live now:** the app is on GitHub, backend is deployed and secured, the coach works on your phone through the tunnel, legal pages are hosted, native builds compile.

**Only you can do (accounts/payment/hosting):**
1. **Re-archive build 3 in Xcode** and swap it into App Store Connect — the app in review predates all the recent fixes.
2. **Rotate the Supabase secrets** (shared in plaintext during setup) — 5 min, doesn't affect the live app.
3. **Google Play** — create the account ($25), start the mandatory 14-day closed test early, upload the AAB.
4. **Keep the coach running:** your Mac must be awake with the server running (it auto-restarts via launchd); migrate to the API key + per-install keys as users grow.

Full step-by-step for all of the above is in **`SHIP-IT.md`**.

---

*Generated 2026-07-10. The authoritative, blow-by-blow record of every change is in `MINDMAP.md` → Loop Log (68 entries).*

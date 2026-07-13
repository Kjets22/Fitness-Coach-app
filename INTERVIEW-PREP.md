# OptimalFit — Complete Interview Prep

Everything you need to explain this project in depth: what it is, how every piece works, why each decision was made, the hardest bugs, and rehearsable answers. Read the cheat sheet before the interview; read the rest until you can explain any section without looking.

---

## 1. The 30-second pitch (memorize this)

> "OptimalFit is an iOS fitness app I designed and shipped to the App Store in under a week by directing Claude Code with structured prompt engineering. It's not just a tracker — it's a personal trainer: it builds you a training program, tells you exactly what to lift each day, and automatically adds weight as you get stronger, all computed on-device so health data never leaves the phone. The AI coaching layer runs on my own server over an authenticated tunnel, so there are no per-user API costs and no third-party data sharing. The interesting part isn't just the app — it's the process: I ran multi-agent AI workflows for adversarial bug-hunting and persona-based UX testing that found and fixed over 100 verified bugs."

## 2. The 2-minute version (structure, not script)

1. **What it is:** iPhone fitness app — tracks sleep, food, water, steps, body metrics, workouts — but the differentiator is the *trainer*: program generation, daily prescriptions, automatic progression, readiness scoring, an AI coach.
2. **Architecture in one breath:** Vanilla JavaScript web app (~16K lines, zero frameworks, zero build step) wrapped in Capacitor for iOS; all user data in localStorage on-device; a small Python companion server runs the LLM features on my own machine, reached through an authenticated Tailscale tunnel; an optional social layer on Supabase with row-level security.
3. **How it was built:** Claude Code as the engineering team, me as the architect/PM. I designed multi-agent workflows — parallel "finder" agents hunting bugs per subsystem, independent adversarial "verifier" agents that had to reproduce each bug before it counted, "persona" agents that role-played different users (a beginner, an injured lifter, a night-shift nurse) to find UX friction, and a consensus judge that only green-lit changes multiple personas independently asked for.
4. **Results:** shipped to the App Store, 100+ verified bug fixes, a feature set competitive with paid apps (rest timers, undo-everywhere, exercise swapping with injury avoid-lists, photo→macros AI estimation), built in days not months.

---

## 3. Architecture — the full picture

```
┌─────────────────────  iPhone (Capacitor app)  ─────────────────────┐
│  WKWebView running vanilla JS (~16K lines, window.OF.* modules)    │
│  • All tracker data in localStorage (private by default)           │
│  • On-device engines: trainer, insights, strength, targets, streak │
│  • Native layer: Swift AppDelegate (scroll fix), HealthKit plugin  │
└──────────────┬──────────────────────────────┬──────────────────────┘
               │ HTTPS + X-OF-Key header      │ HTTPS (only if opted in)
               ▼                              ▼
┌──────────────────────────┐    ┌──────────────────────────────┐
│  serve.py (my computer)  │    │  Supabase (social features)  │
│  • /api/coach → Claude   │    │  • Postgres + RLS default-   │
│  • /api/estimate (photo  │    │    deny on every table       │
│    → macros)             │    │  • SECURITY DEFINER RPCs     │
│  • /api/physique         │    │  • Entitlement freeze        │
│  • Tailscale Funnel      │    │    triggers (anti-tamper)    │
│    public HTTPS tunnel   │    │  • k-anonymous leaderboards  │
└──────────────────────────┘    └──────────────────────────────┘
```

### The three tiers and why each exists

**Tier 1 — the on-device app (always works, fully private).**
Everything a user pays for daily — tracking, the training program, auto-progression, readiness, insights, streaks — computes locally from localStorage. No account needed, works on a plane, and there's no server bill that scales with users. *Why:* health data is sensitive; "private by default" is both an ethical stance and a marketing differentiator, and it makes the free tier genuinely free to operate.

**Tier 2 — the self-hosted AI server (premium features).**
A single-file Python HTTP server (`serve.py`) on my computer runs the LLM features: conversational coaching, photo→calorie estimation, physique analysis. The phone reaches it through a Tailscale Funnel (a public HTTPS URL that tunnels to my machine), and every request must carry a shared secret in an `X-OF-Key` header — the key is baked into the app build and compared with `secrets.compare_digest` (constant-time, to prevent timing attacks). *Why self-hosted instead of calling an LLM API from the phone:* (1) no API key can ever ship inside the app binary — anyone can unzip an IPA and extract strings; (2) zero marginal cost — it uses a subscription I already have; (3) full control of the prompt and context on the server side. *Trade-off I'll own in an interview:* it depends on my machine being awake — so I built graceful degradation (see §6) and documented the migration path to a hosted API key (the server already supports `ANTHROPIC_API_KEY` as a drop-in).

**Tier 3 — Supabase social layer (opt-in).**
Community feed, gym check-ins, leaderboards, "verified by data" achievement receipts. *Why Supabase:* Postgres + auth + row-level security out of the box, no backend code to write or host. Security posture: **default-deny RLS** on every table (you can only read what policies explicitly grant), sensitive mutations go through `SECURITY DEFINER` RPC functions (the client never gets raw table write access for those paths), and the premium flag (`is_premium`) is protected by a **database trigger that rejects any client attempt to change it** — so even a user with the anon key and the REST endpoint can't grant themselves premium.

### The frontend architecture (know this cold)

- **Pattern:** every feature is an IIFE module hung on a single global namespace — `window.OF.storage`, `OF.trainer`, `OF.dashboard`, etc. Modules expose a small public API from a `return {}` block; everything else is closure-private.
- **No framework, no build step.** `index.html` loads ~36 script tags in dependency order (utilities first, `app.js` last). *Why:* iteration speed (edit → reload, no compile), zero dependency risk, tiny bundle, and a WKWebView renders it instantly. In an interview, don't be defensive about this — frame it: "For a solo project with AI-assisted iteration, removing the build toolchain removed an entire class of failure and made every agent-generated change instantly testable. At team scale I'd reach for TypeScript + a bundler for refactoring safety."
- **Data layer:** `storage.js` is a CRUD wrapper over localStorage — one JSON array per record type (`optimalfit.sleep`, `optimalfit.food`, ...). Every record gets `id`, `createdAt`, `updatedAt`. It handles quota failures honestly (returns false, UI never pretends a save happened), keeps a backup copy of corrupt payloads before overwriting, and does **atomic replace-imports**: snapshot every key, write all, roll back everything on any failure.
- **Rendering:** each module renders its own tab with template strings into `innerHTML`, with **every user-controlled string escaped through `U.esc()`** (the XSS discipline). Charts are hand-rolled SVG (`charts.js`) — no chart library.
- **Events:** delegated listeners on stable container elements (lists re-render constantly; a listener per row would leak).

---

## 4. The trainer engine — the heart of the product

This is what makes it "a trainer, not a tracker." Be able to whiteboard this.

### Program generation (`trainer.js`)
- A quick intake asks: days/week (2–6), equipment (full gym / dumbbells / home / bodyweight), session length, experience, goal, optional emphasis (e.g. arms).
- **Splits** map days/week → day templates: 2–3 days = Full Body A/B/C, 4 = Upper/Lower, 5 = PPL + UL, 6 = PPL×2. Each day template is an ordered list of *slots*: (muscle group, compound?).
- A curated **exercise pool** (~44 movements) carries per-exercise metadata: muscle group, equipment tags, compound flag, load increment (`incKg` — 5 kg for squats, 1 kg for lateral raises, 0 for bodyweight), and a `hold` flag for timed moves like planks (prescribed in *seconds*, never reps).
- `pick()` fills each slot: filters the pool by group + equipment + not-already-used + **not on the user's avoid list**, prefers isolation moves for accessory slots, and rotates candidates so repeated days get different exercises.
- **Set/rep schemes** come from the goal (strength → lower reps, hypertrophy → 6–12) with a beginner adjustment (one fewer set, higher reps).
- Starting weights seed from logged history — from **working sets (4+ reps), never a 1RM single** (a PR single would prescribe an impossible working weight; a near-max seeds at 85%).

### Auto-progression — double progression (the algorithm interviewers will probe)
On saving a plan workout, `completeSession(dayIndex, loggedExercises)` compares logs to the prescription:
- **Working sets** = sets performed at/above the target weight (with a 0.05 kg tolerance — see the lb round-trip war story in §8).
- If every working set (judged best-N by reps, order-independent) hit the **top** of the rep range → add one `incKg` increment. A set logged *above* target weight auto-satisfies the rep requirement.
- If any missed the **floor** of the range → strike; **two consecutive strikes → deload ×0.9** (back off to rebuild momentum).
- In between → hold.
- Safeguards: untouched prefilled sets can't auto-progress (reps prefill at the *floor*); sets from an exercise card the user never touched are **excluded entirely** (phantom-history bug, §8); the same lift logged as two cards merges before judging; bodyweight moves (incKg = 0) never get a weight seeded.

### Readiness score (0–100)
Start at 70, then: last night's sleep vs the user's own average (±10/−20), sleep quality (±5/−10), consecutive training days vs a personally-derived max (−10/−25), rested bonus (+10), hours since last workout (<8h → −15), and a **long-layoff cap**: 10+ days off caps the score at 65 with "ease in ~20% lighter" (fresh ≠ ready to max out). Clamp to 0–100, map to high/medium/low with a plain-language verdict.

### The other engines
- **strength-engine.js:** per-exercise analysis on estimated 1RM — **Epley: e1RM = weight × (1 + reps/30)**, with reps = 1 returning the weight itself and reps > 12 excluded (formula unreliable). Detects stalls (no e1RM improvement in 14+ days over 3+ sessions), computes weekly tonnage with leading/trailing zero-week trimming, muscle-group balance over 28 days (flags lagging groups and prescribes fixes), and rep-range distribution vs goal.
- **insights-engine.js:** best gym time-of-day (5 buckets incl. Night 00–05, ranked on *sleep-adjusted* performance so a lucky-sleep session can't win), best training weekdays, rest-day analysis, sleep↔performance pairing (paired with the sleep that *powered* the session — see §8), pre-workout meal analysis (window crosses midnight), a weekly plan synthesizing all of it.
- **targets-engine.js:** calorie/protein/water/step targets from goal + body stats, with an **adaptive loop**: every ~2 weeks it compares actual weight change vs logged intake to estimate true maintenance calories and auto-adjusts the target (blended with a formula estimate; never fully trusts either).
- **streak.js:** daily-logging streak computed *from the data itself* (robust to edits/deletes), with a weekly "freeze" that bridges one missed day — including the tricky case where the missed day is *yesterday* and today isn't logged yet.

---

## 5. The AI features — pipeline details

**Coach chat (`coach.js` → `/api/coach`):** the client builds a compact (~2–4 KB) context: the training program, today's session, 14-day aggregates (sleep/food/workouts), goal targets, lagging muscle groups, readiness. The server wraps it in a personal-trainer system prompt and runs Claude via the CLI (using my existing subscription — no API key). Answers are trainer-style: form cues, concrete fixes, tied to the user's actual numbers.

**Photo → macros (`food-photo.js` → `/api/estimate`):** photo is re-encoded client-side on a canvas (max 1600px, JPEG q0.85 — also converts HEIC, and strips EXIF as a side effect), sent as base64; the server writes it to an isolated temp dir and runs Claude with *only* file-read capability to estimate `{foodName, calories, protein, carbs, fat, confidence, portionEstimate}`; the result prefills the food form for the user to review — **AI proposes, the user confirms.** The image is deleted after analysis, never stored.

**Reliability contract (this is a great interview story — §8):** the feature button is *never disabled*. Photo picking is fully on-device and always works; server trouble surfaces as an inline notice with retry; health checks re-run automatically on app foreground and network return; probes carry a **sequence guard** (a stale slow probe can't overwrite a fresh OK) and an 8s abort. When the server is unreachable entirely, the coach falls back to **on-device rule-based answers** generated from the program/readiness/targets — degraded, never dead.

---

## 6. How it was actually built — the AI-assisted process (your resume headline)

Be ready to go deep here; it's the most differentiated part.

**The model:** I acted as architect, product manager, and QA director; Claude Code was the implementation team. The skill is *prompt/workflow engineering* — decomposing the product into agent-sized tasks with verifiable outputs.

**The workflow patterns I designed (name them):**
1. **Map:** 8 parallel reader agents each documented one subsystem (public API, storage keys, data-shape invariants) → merged into an interactive architecture mind-map. New agents got briefed from it.
2. **Hunt → adversarially verify:** finder agents hunted bugs per subsystem — instructed to *execute the real source files under node* (shimming `window`/`localStorage`) rather than just read them. Every finding then went to an **independent verifier agent prompted to refute it** — a bug only counted if the verifier could reproduce the exact failing path. This filtered ~20% of findings as false positives and is why "100+ *verified* fixes" is an honest number.
3. **Persona sweeps:** ~20 agents role-played distinct users — beginner Betty, injured Ivan, night-shift nurse Nora, a traveler crossing timezones, someone with two years of data, a fat-fingered user — each walking the app's real code as *their* life. This found bugs no code review would (e.g., the sleep-pairing causality bug only a night-shift worker hits).
4. **Consensus judging:** UX proposals only got built if **multiple personas independently converged** on them — a defense against building one synthetic user's taste. That's how the rest timer, undo-everywhere, exercise swapping, and steppers got prioritized.

**My verification stack (I never trusted agent claims blindly):**
- `node --check` on every touched file; unit tests that `eval` the *actual production files* under node (not mirrors of the logic).
- Browser automation at iPhone viewport: driving real forms, real event dispatch, screenshot proof.
- iOS Simulator: `xcodebuild` per change-set, install/launch, lifecycle tests (background→foreground, cold restart), crash-log monitoring, WebView console capture.
- Secret scanning on every commit (grep for key patterns before push); secrets live only in gitignored env files, with the committed config holding an empty placeholder via `git skip-worktree`.

**Honest answer to "did the AI write all the code?":** "Yes — and that's the point. My contribution was the architecture, the product decisions, the workflow design, and the verification discipline. The hard part of AI-assisted development isn't generating code, it's *knowing what to build, catching what's wrong, and proving what works.* I treated agent output like PRs from a fast but fallible team: everything got adversarially reviewed and empirically tested before it shipped."

---

## 7. Native iOS layer (Capacitor specifics)

- **Capacitor 8** wraps the web app in a WKWebView; plugins via **Swift Package Manager** (not CocoaPods — this mattered: a HealthKit plugin I wanted was CocoaPods-only, so I used an SPM-compatible one and stripped its broken Android code with a postinstall script to keep Android builds green).
- **HealthKit:** auto-sync of steps, weight, sleep, active energy (gap-fill only — manual logs always win), plus an Apple Health **export.xml importer** written as a streaming chunk parser (the export can be hundreds of MB; it splits on `<Record` boundaries so even a single-line minified export parses without loading it all into memory).
- **The scroll-bounce fix (good war story, §8):** the app pins fixed bars to both screen edges; WKWebView's rubber-band bounce dragged them. Fix lives in `AppDelegate.swift`: walk the view hierarchy, find the WKWebView's own scroll view (deliberately *not* every inner scroller — chat lists keep native feel), set `bounces = false` — re-asserted on every keyboard notification, on foregrounding, and via a 2s safety-net timer scheduled in `.common` run-loop mode (the default mode is starved during touch tracking — exactly when a bounce shows).
- **Service worker:** the web build has one for offline PWA use; the native build ships a **self-unregistering no-op** instead (a SW inside Capacitor only causes stale-cache bugs).
- **iOS papercuts handled:** keyboard covering inputs (visualViewport-aware scroll-into-view), `<a download>` silently ignored by WKWebView (backup export uses the native share sheet via `navigator.share`, with honest failure states), safe-area insets everywhere.

---

## 8. War stories — "tell me about a hard bug" (pick 2–3, know them cold)

1. **The reversed-causality sleep bug (my favorite).** Insights paired each workout with the sleep record of the same calendar date. Sleep records are keyed by *wake* date — so a 2 a.m. workout got paired with the sleep the user took *after* it. Every post-midnight session had its cause and effect flipped, and the "sleep adjuster" regression built on those pairs silently re-ranked other insights using future sleep as a predictor. Found by the *night-shift-nurse persona agent*, verified by executing the engine in node with her exact week. Fix: a `sleepPoweringActivity()` helper — sessions starting before 5 a.m. pair with the previous day's sleep. Lesson: date-keyed joins need domain semantics, not calendar equality.

2. **Phantom sets / fake PRs.** Starting a planned workout prefilled every prescribed set. If a user skipped an exercise (injury) and never touched its card, saving stored those prefilled sets as *performed* — creating fake history, masking real stalls, and even firing PR confetti for lifts never done (the seed weight beat an old logged single via the e1RM formula). Fix: track a per-card `touched` flag (any edit, ✓, or added set); untouched prescribed cards are excluded from the save, with a toast. Lesson: convenience prefills must never silently become facts.

3. **The pound round-trip stall.** Weights are stored in kg, displayed in lb at 0.1 precision. 60 kg → 132.3 lb → back to 59.99 kg, which is *less than* the 60 kg target — so the progression engine judged every on-target lb-mode set as "missed weight" and never progressed anyone using pounds. Fix: a tolerance constant sized to the maximum display round-trip error. Same bug class appeared twice more (muscle-mass field, height field) — the fix each time was storing at finer precision than the display grid. Lesson: any unit conversion + rounding + comparison is a bug waiting to happen; test the *round trip*, not the conversion.

4. **The dead photo button.** The food-photo button was disabled whenever a server health check failed. My Mac slept overnight → tunnel unreachable → the user pressed the button and *nothing happened* — the exact failure mode that kills trust in a paid feature. The fix was a philosophy, not a patch: **never render a dead control.** Button always opens the flow (picking is on-device), server trouble is explained inside with retry, health re-checks on foreground/network-return, probes get sequence guards so a stale failure can't overwrite a fresh success — and the server itself now holds a `caffeinate` sleep-prevention assertion while on AC power.

5. **The backup that lost your trainer.** The JSON export covered tracker records but not the localStorage keys holding the training program, progressed weights, PRs, and streak history — a restore on a new phone silently wiped months of training state. Also: importing any backup containing HealthKit energy records *crashed the whole import* (missing schema entry → `undefined.forEach`). Fixes: an `appState` section in the export (with merge semantics that never let an old backup clobber an active program), shape-validation before restoring, real-calendar date validation (Feb 30 and year 9999 poisoned charts), and atomic replace with rollback. Lesson: backup/restore is the highest-stakes code path in a local-first app — it must round-trip *everything* and fail atomically.

6. **The streak that demoralized.** The streak "freeze" (survive one missed day/week) had two edge bugs: an off-by-one meant missing exactly one day a week still broke it, and the morning after a single missed day the chip showed **0** — because the anchor day itself was the gap and the bridge logic never got a chance. Both fixed with careful walk-back logic; the second one matters because it hit at the exact moment the mechanic exists to protect: the comeback morning.

---

## 9. Security & privacy — likely a whole interview section

- **Health data:** on-device only by default; no analytics, no tracking. The social layer is opt-in and shares derived stats, not raw logs.
- **Secrets:** no API keys in the client or repo. The AI server's access key is generated with `secrets.token_urlsafe`, lives in a gitignored `.env` file, compared constant-time; the committed client config has an empty placeholder kept out of commits via `git skip-worktree`. Every push is grep-scanned for secret patterns.
- **Transport:** the tunnel is HTTPS end-to-end (Tailscale terminates TLS); *every* API request requires the key — no exempt endpoints; wrong-key guesses get a per-connection delay so the health endpoint can't be used as a brute-force oracle.
- **Supabase:** default-deny RLS; SECURITY DEFINER RPCs for sensitive mutations; a DB trigger freezes `is_premium` against client tampering; leaderboards are k-anonymous.
- **XSS:** all user/server strings escape through one helper (`U.esc`) at render time; the AI-server responses are treated as untrusted input too.
- **AI-specific:** the photo-analysis Claude invocation is capability-restricted (read-only, isolated working directory) — treating the LLM itself as a component to sandbox.

---

## 10. Numbers to have ready

| Stat | Value |
|---|---|
| Build time | < 1 week to App Store submission |
| Codebase | ~16K lines app JS across ~36 modules + Python server + Swift shell |
| Frameworks | Zero (vanilla JS, no build step) |
| Verified bug fixes | 100+ (each adversarially reproduced before counting) |
| Agent scale | Workflows of 60–75 agents; ~4M tokens per major sweep |
| Personas used | ~20 distinct user personalities across two panels |
| Testing | node unit tests on real files, browser automation, iOS Simulator lifecycle + crash monitoring |
| Progression algorithm | Double progression; deload ×0.9 after 2 misses; Epley e1RM |

## 11. Rapid-fire Q&A (rehearse out loud)

**Q: Why vanilla JS instead of React?**
A: Speed and verifiability. No build step meant every AI-generated change was instantly testable in a reload, and zero dependencies meant zero supply-chain and upgrade risk during a one-week sprint. The module pattern (namespaced IIFEs with explicit public APIs) gave me the encapsulation I needed. At team scale I'd want TypeScript for refactoring safety — I'd own that trade-off.

**Q: localStorage? What about its limits?**
A: Deliberate: privacy by default, offline always, zero backend cost. I engineered around the limits — quota failures surface honestly instead of silently dropping data, imports are atomic with rollback, corrupt payloads get backed up before recovery, history lists render windowed (newest 50) so two years of data stays fast, and there's full JSON export/import including app state. The known residual risk is iOS evicting WKWebView storage under extreme pressure — mitigated by the backup system, and the documented next step is migrating the store behind the same CRUD interface to a native plugin.

**Q: What breaks if your Mac is off?**
A: Only the live LLM features — and they degrade, never die: the coach answers from an on-device rule-based fallback grounded in the user's actual plan, photo capture still works with honest retry messaging, and everything else is fully local. Scaling past personal use means pointing the same server at a hosted API key — that's config, not a rewrite.

**Q: How do you know the AI-written code is correct?**
A: Layered verification I ran on everything: adversarial verifier agents that had to *reproduce* each claimed bug, unit tests executing the real production files under node, browser automation of real user flows at phone size, and simulator runs with crash monitoring. Roughly a fifth of agent findings were refuted at the verify stage — which is exactly why the stage exists.

**Q: What would you do differently?**
A: Three things: TypeScript from day one (several shipped bugs were shape-drift a compiler would have caught), the storage layer behind an async interface from the start so migrating off localStorage is trivial, and CI running my node test harness on every commit instead of me triggering it — the tests existed, the automation trigger didn't.

**Q: What's the hardest part of prompt engineering at this scale?**
A: Verification economics. Generating plausible code is cheap; the bottleneck is proving it right. My biggest wins were structural: making finders *execute* code rather than read it, splitting finding from verifying across agents with opposed incentives, and requiring multi-persona consensus before building UX changes. You design the incentive structure, not just the prompt text.

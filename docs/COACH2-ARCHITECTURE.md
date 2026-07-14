# Coach 2.0 — architecture (working doc, 2026-07-14)

Mission: evolve the coach into a true personalized AI fitness coach — real
onboarding interview, science-backed programming with "why" for everything,
per-user learning loop. EXTEND, never rewrite; the on-device engines stay the
source of truth; the LLM interprets and communicates.

## Module map (all plain scripts, OF.* pattern; added to index.html + sw SHELL)

| File | Global | Role |
|---|---|---|
| `app/js/evidence.js` | `OF.evidence` | Evidence Knowledge Base: versioned structured entries `{id, topic, recommendation, numbers, evidence, why, individualNote, refs}` compiled from 2020–2026 meta-analyses (research-agent output). API: `get(id)`, `forTopic(t)`, `volumeTarget(level)`, `whyFor(decision)`, `safety()`, `coachContext()` (compact ids+claims for the LLM). |
| `app/js/coach-profile.js` | `OF.profile` | Versioned User Coaching Profile at `optimalfit.coachProfile`: goals (primary/secondary/timeline/milestones), training prefs (split, days, session length, time), likes/dislikes (enjoyment drives adherence), experience (training age, level), constraints (equipment, injuries with aggravated movements, schedule), recovery/lifestyle (sleep, stress, job activity, diet). `get()`, `update(patch, source)` bumps version + appends compact change history, `coachContext()`, `reinterviewTriggers()` (goal change / ≥21-day layoff / plateau via OF.strength / user request). |
| `app/js/coach-intake.js` | `OF.intake` | Chat-style adaptive interview rendered with the existing coach-bubble UI. Deterministic branching script (works fully OFFLINE, no LLM): beginner branch gets education (what splits are, KB-sourced blurbs), advanced branch gets periodization/weak-point questions. Answers via chips + small inputs; educates during intake; persists to OF.profile; ends by generating the program (trainer 2.0) with a plain-English summary + why chips. Re-runnable (per-section edit later). |
| `app/js/coach-learn.js` | `OF.learn` | Learning loop. (a) Preference learning: prescribed-vs-logged diffing per program session (skipped/swapped streaks → auto-suggest permanent swap, update profile dislikes on confirm). (b) Response modeling per ML-research decision (Bayesian/EWMA around KB priors; cold-start = KB defaults). (c) Weekly review: volume nudge up/down per muscle group from recovery + e1RM slope, deload trigger from readiness+stalls. (d) Feedback: thumbs on coach answers, post-workout enjoyment rating (new pill row on finish screen). |
| `trainer.js` (extended) | `OF.trainer` | generate() becomes profile-aware: split from profile prefs (respecting KB frequency evidence), weekly per-muscle set targeting from KB volume ranges scaled by training age, injury→exercise exclusion, dislikes excluded / likes preferred, per-exercise + per-day `why` annotations referencing KB ids. Old 5-question modal stays as fallback when no coach profile exists (zero regression). Double progression, adaptSession, avoid-list all unchanged. |
| `coach.js` (extended) | `OF.coach` | Context gains `coachingProfile` + `evidenceCited` + `learning` blocks (compact). Persisted conversation memory (last N compact turns in localStorage, included in requests so the coach "remembers"). Thumbs up/down under answers. Weekly check-in card + plateau interventions surfaced from OF.learn. |
| `serve.py` (PREAMBLE v2) | — | Persona: explains reasoning by default citing the provided evidence entries, offers "tell me more" depth, negotiates with options+tradeoffs, honest about mixed evidence + realistic timelines, pushes back on crash diets/ego lifting, never re-asks known profile facts. |

## Data keys
- `optimalfit.coachProfile` — versioned profile (see above).
- `optimalfit.coachChat` — persisted compact conversation memory (cap ~20 turns).
- `optimalfit.learnState` — response-model parameters + preference counters + weekly-review log.
- Existing keys untouched: trainerProgram, avoidExercises, activeWorkout, exRest, etc.

## Volume accounting (the core programming upgrade)
KB gives weekly set ranges per muscle group by training age. Program generator
counts sets per muscle group across the whole split (direct sets; compounds
count once for prime mover, 0.5 for strong secondary — documented in code),
starts at the LOWER-MIDDLE of the range (start moderate, adjust from user
data — that's also what we tell the user), and OF.learn nudges within the
range weekly. Every day card can answer "why this many sets".

## Safety layer
KB safety entries + existing targets-engine floors (1200 kcal, rate caps)
unified in `OF.evidence.safety()`: injury red flags → "see a professional"
copy, no medical diagnoses, calorie floor, max loss/gain rates. Intake injury
answers add exercises to the avoid list AND tag the profile.

## Testing
- `tests/coach2-tests.mjs` (node, no DOM): profile versioning, intake branching
  logic (pure state machine part), program rules (volume within KB range,
  injuries/equipment/dislikes respected, beginner scaling), learn-loop math.
- `tests/coach2-eval.mjs`: synthetic users (beginner-cut, advanced-powerlifter,
  injured-home-gym, time-poor-parent, endurance-hybrid) → generated programs
  asserted evidence-consistent + constraint-respecting; simulated 8 weeks of
  logs → adaptation direction asserted.

## Order of build
evidence.js → coach-profile.js → trainer extensions → coach-intake.js →
coach-learn.js → coach.js/serve.py persona → tests/eval → sim verification →
MINDMAP update → push.

## ML DECISION (research agent, 2026-07-14 — accepted)
- (a) Volume→e1RM response per muscle group: **Bayesian ridge regression**
  (normal-normal conjugate, features [1, ramp(vol)=min(v,12)/12, readiness],
  prior μ0=[0.15, 0.45, 0.10], Σ0=diag[0.10², 0.30², 0.15²], σ≈0.5%/wk;
  closed-form 3×3 inverse). Personalize ONLY when credible intervals separate
  from the default; else report the evidence-based default honestly.
- (b) Exercise dislikes: **Beta-Bernoulli** per exercise on offered→
  completed/skipped/swapped events (swap=1.5 skips), skips counted only on
  normal-readiness days, 8-week half-life decay, prior Beta(κ0·p̄, κ0·(1−p̄))
  with p̄≈0.15, κ0=4; flag dislike when Beta 10th percentile > p̄+margin and
  ≥3 offers.
- (c) Weekly volume decision: **Thompson sampling** over volume levels
  (current ±1 within [MEV,MRV]), reward = e1RM %/wk − 0.3·fatigue penalty,
  arm priors seeded from (a); **deload gate rule overrides**: fatigue EWMA
  (~10d) high AND e1RM trend <0 for ≥2wk AND readiness depressed → deload.
  ≤1 level change per 2 weeks.
- Why not alternatives: unregularized regression unidentified at n≈8-12;
  Banister fitness-fatigue (4 coupled params) unidentifiable on-device —
  borrowed only as the EWMA deload-gate structure; pure bandit is a poor
  curve estimator; pure EWMA rules (current engine) can't answer
  counterfactual "12 vs 16 sets for YOU" — kept as cold-start fallback.
- Validation: synthetic-world simulator in tests/ with known ground truth
  (responders, low-responders, FLAT non-responders), policies = current
  heuristic vs new stack vs oracle vs prior-only; success = ≥15% regret
  reduction at 8-12 wks in responder worlds, ≤ε harm in the null world,
  80% CI coverage in [0.75, 0.85]; dislike precision/recall; cold-start
  regret ≤ heuristic + ε.

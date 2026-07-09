# OptimalFit Social Backend (Supabase) — Phase 3

Written for the frontend agent. Everything here is live on project
`puopvaqquujalwnzwyov` (Postgres 17) and reproducible from
`supabase/migrations/*.sql`. Proven by `supabase/tests/rls-tests.mjs`
(50/50 passing against the real project).

- **Base URL**: `https://puopvaqquujalwnzwyov.supabase.co`
- **Client key**: the *publishable anon key* only (`sb_publishable_…`, in
  `.env.supabase`, gitignored — inject at build time; it is safe in client code).
- **Anon (logged-out) access: DENY ALL.** Every policy is scoped
  `to authenticated`; all RPC grants exclude `anon`. Logged-out users can read
  nothing and write nothing (public storage URLs are the one exception —
  avatar/post images are CDN-public). The app must require sign-in before any
  social surface.

---

## 1. Schema (text diagram)

```
auth.users ─┬─(1:1, FK CASCADE)→ profiles ── username uq, bio<=300, tos_accepted_at
            │
            │   (ALL content FKs point at profiles with ON DELETE CASCADE →
            │    deleting the auth user wipes the entire graph: the
            │    account-deletion/anonymization path.)
            │
profiles ─┬→ follows      (follower_id, followee_id) PK pair, asymmetric
          ├→ blocks       (blocker_id, blocked_id)   PK pair, hides BOTH directions
          ├→ posts        kind photo|workout|meal|receipt, caption<=1000,
          │               receipt jsonb (receipt posts only, <=16KB),
          │               verified (server-only), hidden (auto-moderation),
          │               like_count / comment_count (trigger-maintained caches)
          │     ├→ likes     (post_id, user_id) PK pair → double-like = 409
          │     └→ comments  body 1..500
          ├→ gym_members  (gym_id, user_id) PK pair
          ├→ check_ins    UNIQUE(user_id, day); day+created_at forced server-side
          ├→ reports      exactly one target (post|comment|user), reason 3..500,
          │               UNIQUE(reporter,target) → no single-user report spam
          └→ benchmark_contributions   DENY-ALL to clients (no policies +
                          grants revoked). One row per (user, receipt_type,
                          lift); holds weekly_progress_pct / consistency_ratio
                          + training_age_bucket. user_id kept ONLY for dedupe.

gyms  name 2..80, name_key = lower(btrim(name)) UNIQUE (dedupe), immutable
      after creation (no update/delete policies).

storage.buckets: avatars (2MB), post-images (5MB); public read;
      mime allowlist jpeg/png/webp; writes only under "<auth.uid()>/..." paths.
```

Notable constraints (the DB refuses absurd payloads even though the client
escapes at render): username `^[a-z0-9_]{3,20}$`, display_name ≤50,
avatar_url/image_path ≤500, bio ≤300, stats_summary ≤200, caption ≤1000,
comment ≤500, report reason 3..500, gym name 2..80, receipt jsonb ≤16KB.

## 2. RLS matrix

Default is deny: RLS is enabled on **every** table; anything not listed is
blocked. `me` = `auth.uid()`. "not blocked(x)" = no `blocks` row between me
and x in either direction (checked via `is_blocked()` SECURITY DEFINER helper,
so the blocked party never learns they were blocked — content just vanishes).

| Table | SELECT (authenticated) | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| profiles | own, OR not blocked(id) | own row only (`id = me`) | own row | own row |
| follows | edges where I'm not blocked from either end | `follower_id = me` AND not blocked(followee) | — | I'm follower (unfollow) or followee (remove follower) |
| blocks | own (`blocker_id = me`) | `blocker_id = me` | — | `blocker_id = me` |
| posts | own (even hidden), OR (not hidden AND not blocked(author)) | `author_id = me` AND `verified = false` AND `hidden = false` | own; caption+image_path ONLY (freeze trigger 42501 on protected cols) | own |
| likes | post visible AND not blocked(liker) | `user_id = me` AND post visible | — | own |
| comments | post visible AND not blocked(author) | `author_id = me` AND post visible | — (delete-and-repost) | comment author OR post author |
| gyms | all | `created_by = me` | — (immutable) | — |
| gym_members | not blocked(member) | `user_id = me` | — | own |
| check_ins | **own only** | `user_id = me`; must be gym member if gym_id given; day/created_at overwritten server-side | — (immutable) | — (immutable) |
| reports | **none** (write-only mailbox) | `reporter_id = me` | — | — |
| benchmark_contributions | **none** (grants revoked too → 401/403) | — | — | — |
| storage.objects | public read (both buckets) | authenticated, key must start `<me>/` | same | same |

Anti-tamper triggers (defense-in-depth beyond RLS):

- `posts` BEFORE INSERT: forces `created_at`, zero counters for client writes.
  `verified`/`hidden` are NOT silently zeroed — RLS **rejects** them loudly
  (42501) so a tampering client gets an error, not a quiet downgrade.
- `posts` BEFORE UPDATE freeze: clients cannot change `author_id, kind,
  receipt, verified, hidden, like_count, comment_count, created_at`.
- `check_ins` BEFORE INSERT: `day := current_date`, `created_at := now()` —
  no backdating, no forward-dating, and `UNIQUE(user_id, day)` caps at 1/day.
  `day` is the **server's (UTC) calendar date** — the frontend should treat
  "already checked in today" (409) as success-idempotent UX, and be aware a
  user in UTC-negative timezones flips days at UTC midnight.
- Counter caches and report auto-hide run as SECURITY DEFINER trigger
  functions (execute as `postgres`, which the freeze trigger recognizes as a
  privileged writer).
- Reports auto-hide: ≥3 **distinct** reporters on a post → `hidden = true`.
  Author still sees their own hidden post; nobody else does.
- Blocking severs follow edges in both directions (trigger) and blocks
  re-follow attempts across the block.

## 3. RPC contracts

All RPCs: `POST /rest/v1/rpc/<name>` with `apikey: <anon>` +
`Authorization: Bearer <user access_token>`. Execute is granted to
`authenticated` only — anon gets 401/403. Errors below surface as PostgREST
`{code, message, …}` JSON with HTTP 400 (raise) or 401/403 (42501).

### `create_receipt_post(p_kind text, p_caption text, p_receipt jsonb) → jsonb`
**THE ONLY PATH TO `verified = true`.** Returns
`{ "post_id": uuid, "verified": bool, "reason": string|null }`.

Decision (implemented): **structural** problems are hard errors (nothing
inserted); **plausibility** failures still insert the post — as a normal
UNVERIFIED receipt post — and return `verified:false` with a human-readable
`reason`. The user keeps their content; they just don't get the checkmark.
Frontend: show `reason` inline ("couldn't verify: …") and render the post
without the badge.

Hard errors: not authenticated; `p_kind != 'receipt'`; caption >1000;
`p_receipt` not an object or >16KB; `receipt.type` not one of
`pr|consistency|progress|weekly`.

Receipt payload shapes + plausibility gates:

| type | payload | gates (fail ⇒ unverified+reason) |
|---|---|---|
| `pr` | `{type,'lift',training_age?,series:[{day:'YYYY-MM-DD',e1rm:kg},…]}` | ≥6 points; span ≥21 days; strictly increasing dates; e1rm 20–500 kg; consecutive jump ≤ +10%/week compounded (`factor ≤ 1.10^(days/7)`) |
| `consistency` | `{type,training_age?,weeks:[{planned,done},…]}` | ≥2 weeks; planned 1–7; done 0–7 |
| `progress` | `{type,start_value,end_value,days}` | values 30–300; days 14–730; \|weekly change\| ≤1.5% |
| `weekly` | `{type,workouts,total_sets?,total_volume_kg?}` | workouts int 0–7; sets ≤250; volume ≤150000 |

`training_age` ∈ `lt1y|1to3y|gt3y` (anything else → `unknown`). On a verified
`pr`/`consistency` receipt, an anonymized row is upserted into
`benchmark_contributions` (newer receipt of same type+lift replaces older —
one contribution per user per cohort, which is also what makes k-anonymity
counts honest).

### `get_home_feed(p_limit int = 20, p_before timestamptz = null) → rows`
### `get_discover_feed(p_limit int = 20, p_before timestamptz = null) → rows`
Row shape (both): `id, author_id, username, display_name, avatar_url, kind,
caption, image_path, receipt, verified, like_count, comment_count, created_at,
liked_by_me`. Newest-first; keyset-paginate by passing the last row's
`created_at` as `p_before`. `p_limit` clamps to 1..50. Home = self +
followees; discover = everyone. Both are SECURITY INVOKER: hidden posts and
blocked users are filtered by the same RLS as direct reads.

### `get_friends_leaderboard(p_metric text = 'streak') → rows`
### `get_gym_leaderboard(p_gym_id uuid, p_metric text = 'streak') → rows`
Row shape: `user_id, username, display_name, avatar_url, value int, rank int`
(ties share rank), max 50 rows, sorted by value desc.
`p_metric` ∈ `streak` (consecutive check-in days ending today/yesterday) |
`days7` / `days28` (distinct check-in days in last 7/28) | `receipts`
(count of verified, non-hidden receipt posts). Errors: bad metric (400);
not authenticated (42501); gym board: caller not a member of that gym (42501).
Friends scope = me + people I follow. Blocked users are excluded from every
board. SECURITY DEFINER (check-ins are select-own-only; only these aggregate
numbers ever leave the server). **Deliberately no raw-volume/global boards** —
every metric is bounded by the 1-per-day server-dated check-in or by verified
receipts, so the cheating ceiling is "showed up every day", not "typed 9999kg".

### `get_benchmarks(p_receipt_type text, p_lift text = null, p_training_age text = null) → rows`
`p_receipt_type` ∈ `pr|consistency` (else 400). Row shape:
`receipt_type, lift (null for consistency), training_age_bucket,
contributors int, p25, p50, p75 numeric`. For `pr` the percentiles are
**weekly e1RM progression %**; for `consistency` they are the 0..1 adherence
ratio. Cohort = (type, lift, training_age_bucket).
**k-anonymity, k=5**: any cohort with <5 distinct contributors is withheld
entirely — you get zero rows, not small-n rows. Frontend must treat an empty
array as "not enough community data yet". Raw contributions are unreachable:
the table has no policies AND grants are revoked; aggregates are the only exit.

## 4. Why k=5 / anti-cheat rationale (short)

- Benchmarks are built only from **verified** receipts, which pass server-side
  plausibility gates over required backing history — you cannot contribute a
  fantasy number. One contribution per (user, type, lift) stops one person
  from stuffing a cohort. k=5 on distinct contributors means no percentile can
  be reverse-engineered to an individual (with upsert-dedupe, "distinct users"
  = rows). Percentiles (not means) are robust to a single outlier that
  squeaked past the gates.
- Check-ins are the anti-cheat base unit: server-dated, 1/day, immutable.
  Every leaderboard metric derives from them or from verified receipts.

## 5. Runbook — apply migrations (headless)

```bash
cd <repo-root>
set -a; source .env.supabase; set +a         # gitignored secrets
export SUPABASE_GO_BINARY="$HOME/.local/share/supabase/supabase-go"  # if the shim needs it

# Direct DB URL is IPv6-only from most home networks; build the IPv4
# session-pooler URL (password reused from SUPABASE_DB_URL, already %-encoded):
ENC="$(printf '%s' "$SUPABASE_DB_URL" | sed -E 's|^postgres(ql)?://[^:]+:([^@]+)@.*|\2|')"
POOLER_URL="postgresql://postgres.${SUPABASE_PROJECT_REF}:${ENC}@aws-1-us-east-2.pooler.supabase.com:5432/postgres"

~/.local/bin/supabase db push --db-url "$POOLER_URL" --yes
~/.local/bin/supabase migration list --db-url "$POOLER_URL"   # verify
```

Never `supabase login` (interactive) — `SUPABASE_ACCESS_TOKEN` from the env
file is the auth. Docker warnings from `db push` are harmless (local catalog
caching only).

## 6. Tests

```bash
node supabase/tests/rls-tests.mjs      # from repo root; needs .env.supabase + .env.test-users
```

50 assertions, all passing: anon deny-all; ownership; double-like/double-
check-in 409s; backdating rejection; verified-flag protection (insert + PATCH);
deny-all on reports/benchmark_contributions; receipt verification accept +
reject paths; report auto-hide at 3 reporters; block-hides-everything (feeds,
discover, profiles, comments, re-follow); leaderboard scoping, non-member
rejection and block exclusion; benchmark k-anonymity. Test users
`of-test-a/b/c@example.com` (creds in gitignored `.env.test-users`) were
created via the Auth Admin API with `email_confirm: true`.

## 7. Gotchas for the frontend

- Insert your `profiles` row immediately after first sign-in (id = user id,
  username required) — every other write FKs to it. Set `tos_accepted_at`
  when the user accepts the ToS (UGC compliance).
- PATCHing someone else's row doesn't error — it affects 0 rows (PostgREST +
  RLS semantics). Use `Prefer: return=representation` and check the body if
  you need confirmation.
- Expect 409 for: duplicate like, duplicate follow, second check-in of the
  day, duplicate gym name (name_key), duplicate report of same target.
  Treat all as idempotent no-ops in UX.
- Posts: clients may only set `author_id (=me), kind, caption, image_path`
  (+`receipt` only via the RPC). Sending `verified:true` or editing protected
  columns returns 42501 — never send them.
- `image_path` is a storage object key you choose; upload to bucket
  `post-images` under `${userId}/…` (that path prefix is enforced), store the
  key in the post, and render via the public URL
  `${SUPABASE_URL}/storage/v1/object/public/post-images/<key>`. Same pattern
  for `avatars` (2MB cap). Allowed types: jpeg/png/webp.
- Comment count / like count: read the cached columns on the post row; don't
  count client-side.
- Blocked content silently disappears (by design) — don't build UI that
  assumes a "you are blocked" signal exists.

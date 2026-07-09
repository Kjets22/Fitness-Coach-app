-- ============================================================
-- OptimalFit Phase 3 — 01: profiles
-- Every account gets exactly one profile row keyed to auth.users.
-- Deleting the auth user cascades through profiles to ALL content
-- (posts, likes, comments, follows, blocks, check-ins, reports,
-- benchmark contributions) — this is the account-deletion path.
--
-- Anon (logged-out) policy decision: DENY ALL. The app requires
-- login before any social content is visible; every policy below
-- is scoped `to authenticated`. Documented in docs/BACKEND.md.
-- ============================================================

-- Shared helper: keep updated_at honest on UPDATE.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  username        text not null unique
                    check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name    text check (display_name is null
                    or char_length(display_name) between 1 and 50),
  avatar_url      text check (avatar_url is null
                    or char_length(avatar_url) <= 500),
  bio             text check (bio is null or char_length(bio) <= 300),
  -- Small denormalized "stats snippet" the client renders on the
  -- profile card (e.g. "213 workouts · 41-day best streak").
  stats_summary   text check (stats_summary is null
                    or char_length(stats_summary) <= 200),
  -- UGC compliance: when the user accepted the Terms of Service.
  tos_accepted_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

-- SELECT: any logged-in user can view profiles EXCEPT across a
-- block (either direction). Own profile always visible.
-- (is_blocked() is defined in migration 02; policies are evaluated
-- at query time, so the forward reference is fine — but to keep
-- each migration self-applying we add the profile policies that
-- depend on is_blocked() in migration 02 instead.)
create policy profiles_select_own
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()));

-- INSERT: only your own row.
create policy profiles_insert_own
  on public.profiles for insert
  to authenticated
  with check (id = (select auth.uid()));

-- UPDATE: only your own row (and it must stay your row).
create policy profiles_update_own
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- DELETE: only your own row. (Normal account deletion happens via
-- auth.users cascade; this just doesn't get in the way.)
create policy profiles_delete_own
  on public.profiles for delete
  to authenticated
  using (id = (select auth.uid()));

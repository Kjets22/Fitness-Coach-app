-- ============================================================
-- OptimalFit Phase 3 — 04: gyms, memberships, check-ins
--
-- Check-ins are the anti-cheat base unit: max ONE per user per
-- day, and both `day` and `created_at` are forced server-side —
-- a client cannot backdate or forward-date a check-in, period.
-- `day` is the server's (UTC) calendar date; documented for the
-- frontend in docs/BACKEND.md.
-- ============================================================

create table public.gyms (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 2 and 80),
  -- Dedupe-friendly canonical key: two "Gold's Gym Venice" entries
  -- differing only in case/whitespace collide on this unique key.
  name_key   text generated always as (lower(btrim(name))) stored unique,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.gyms enable row level security;

-- Gym directory is readable by any logged-in user.
create policy gyms_select_all
  on public.gyms for select
  to authenticated
  using (true);

-- Any user may create a gym (dedupe enforced by name_key unique).
create policy gyms_insert_own
  on public.gyms for insert
  to authenticated
  with check (created_by = (select auth.uid()));

-- No UPDATE/DELETE policies: gyms are immutable once created
-- (prevents vandalism of a shared directory).

-- ------------------------------------------------------------
-- gym memberships
-- ------------------------------------------------------------
create table public.gym_members (
  gym_id     uuid not null references public.gyms (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (gym_id, user_id)
);

create index gym_members_user_idx on public.gym_members (user_id);

alter table public.gym_members enable row level security;

-- Member lists visible to logged-in users, minus blocked pairs.
create policy gym_members_select_visible
  on public.gym_members for select
  to authenticated
  using (not public.is_blocked((select auth.uid()), user_id));

create policy gym_members_insert_own
  on public.gym_members for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy gym_members_delete_own
  on public.gym_members for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- ------------------------------------------------------------
-- check-ins
-- ------------------------------------------------------------
create table public.check_ins (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  gym_id     uuid references public.gyms (id) on delete set null,
  day        date not null default current_date,
  created_at timestamptz not null default now(),
  unique (user_id, day)  -- max 1/day → duplicate check-in is a hard 409
);

create index check_ins_user_day_idx on public.check_ins (user_id, day desc);

-- Server-side timestamps, no exceptions for clients: whatever the
-- client sends for day/created_at is overwritten.
create or replace function public.check_ins_force_today()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not public.is_privileged_writer() then
    new.day := current_date;
    new.created_at := now();
  end if;
  return new;
end;
$$;

create trigger check_ins_before_insert
  before insert on public.check_ins
  for each row execute function public.check_ins_force_today();

alter table public.check_ins enable row level security;

-- Privacy + anti-cheat: users read ONLY their own check-ins.
-- Leaderboards over other people's check-ins are computed by
-- SECURITY DEFINER RPCs (migration 07), never by direct reads.
create policy check_ins_select_own
  on public.check_ins for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy check_ins_insert_own
  on public.check_ins for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    -- If checking in at a gym, you must actually be a member.
    and (gym_id is null or exists (
      select 1 from public.gym_members gm
      where gm.gym_id = check_ins.gym_id
        and gm.user_id = (select auth.uid())
    ))
  );

-- No UPDATE/DELETE policies: check-in history is immutable from
-- the client (streaks can't be groomed after the fact).

-- ============================================================
-- OptimalFit Phase 3 — 02: social graph (follows + blocks)
-- Follows are asymmetric. Blocks hide BOTH directions' content
-- everywhere (profiles, feeds, comments, likes, leaderboards,
-- discover) via the is_blocked() helper used in every relevant
-- policy and RPC. Blocking also severs any follow edges.
-- ============================================================

create table public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

create index follows_followee_idx on public.follows (followee_id);

create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index blocks_blocked_idx on public.blocks (blocked_id);

-- ------------------------------------------------------------
-- Helper: does a block exist between two users, in EITHER
-- direction? SECURITY DEFINER because blocks RLS only lets a user
-- read their OWN block list, but policies must consider both
-- directions (the blocked party must not learn they are blocked —
-- content just quietly disappears).
-- ------------------------------------------------------------
create or replace function public.is_blocked(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = a and blocked_id = b)
       or (blocker_id = b and blocked_id = a)
  );
$$;

revoke execute on function public.is_blocked(uuid, uuid) from public, anon;
grant execute on function public.is_blocked(uuid, uuid) to authenticated, service_role;

-- Blocking severs follow edges in both directions.
create or replace function public.on_block_sever_follows()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.follows
  where (follower_id = new.blocker_id and followee_id = new.blocked_id)
     or (follower_id = new.blocked_id and followee_id = new.blocker_id);
  return new;
end;
$$;

create trigger blocks_sever_follows
  after insert on public.blocks
  for each row execute function public.on_block_sever_follows();

-- ------------------------------------------------------------
-- RLS: follows
-- ------------------------------------------------------------
alter table public.follows enable row level security;

-- Follow edges are readable by any logged-in user (needed to show
-- follower/following lists), except edges touching someone you're
-- in a block relationship with.
create policy follows_select_visible
  on public.follows for select
  to authenticated
  using (
    not public.is_blocked((select auth.uid()), follower_id)
    and not public.is_blocked((select auth.uid()), followee_id)
  );

-- You can only follow AS yourself, and not across a block.
create policy follows_insert_own
  on public.follows for insert
  to authenticated
  with check (
    follower_id = (select auth.uid())
    and not public.is_blocked((select auth.uid()), followee_id)
  );

-- Unfollow (you are the follower) or remove a follower (you are
-- the followee).
create policy follows_delete_own_edge
  on public.follows for delete
  to authenticated
  using (
    follower_id = (select auth.uid())
    or followee_id = (select auth.uid())
  );

-- ------------------------------------------------------------
-- RLS: blocks — strictly private to the blocker.
-- ------------------------------------------------------------
alter table public.blocks enable row level security;

create policy blocks_select_own
  on public.blocks for select
  to authenticated
  using (blocker_id = (select auth.uid()));

create policy blocks_insert_own
  on public.blocks for insert
  to authenticated
  with check (blocker_id = (select auth.uid()));

create policy blocks_delete_own
  on public.blocks for delete
  to authenticated
  using (blocker_id = (select auth.uid()));

-- ------------------------------------------------------------
-- Now that is_blocked() exists: profiles of people you're in a
-- block relationship with are hidden (own profile stays visible
-- via profiles_select_own).
-- ------------------------------------------------------------
create policy profiles_select_not_blocked
  on public.profiles for select
  to authenticated
  using (not public.is_blocked((select auth.uid()), id));

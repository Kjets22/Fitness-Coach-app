-- ============================================================
-- OptimalFit Phase 3 — 07: feed + leaderboard + benchmark RPCs
--
-- Feeds are SECURITY INVOKER: they run under the caller's RLS, so
-- hidden posts and blocked users are filtered by the exact same
-- policies as direct table reads (single source of truth).
--
-- Leaderboards are SECURITY DEFINER: check_ins are private
-- (select-own only), so ranking friends/gym-mates requires
-- privileged reads. Scope is strictly limited (followees or
-- shared-gym members), blocked users are excluded, and only
-- aggregate numbers leave the function. Metrics are anti-cheat-
-- safe by construction: streaks/consistency come from the
-- 1-per-day server-dated check_ins table, receipts count only
-- verified receipt posts. NO raw-volume global boards.
-- ============================================================

-- ------------------------------------------------------------
-- Home feed: my posts + posts of people I follow. Newest first,
-- keyset pagination via p_before.
-- ------------------------------------------------------------
create or replace function public.get_home_feed(
  p_limit  integer default 20,
  p_before timestamptz default null
)
returns table (
  id uuid, author_id uuid, username text, display_name text,
  avatar_url text, kind text, caption text, image_path text,
  receipt jsonb, verified boolean, like_count integer,
  comment_count integer, created_at timestamptz, liked_by_me boolean
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select p.id, p.author_id, pr.username, pr.display_name, pr.avatar_url,
         p.kind, p.caption, p.image_path, p.receipt, p.verified,
         p.like_count, p.comment_count, p.created_at,
         exists (select 1 from public.likes l
                 where l.post_id = p.id and l.user_id = (select auth.uid())) as liked_by_me
  from public.posts p
  join public.profiles pr on pr.id = p.author_id
  where (p.author_id = (select auth.uid())
         or p.author_id in (select f.followee_id from public.follows f
                            where f.follower_id = (select auth.uid())))
    and (p_before is null or p.created_at < p_before)
  order by p.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

-- ------------------------------------------------------------
-- Discover feed: recent posts from everyone (RLS already excludes
-- hidden posts and blocked users).
-- ------------------------------------------------------------
create or replace function public.get_discover_feed(
  p_limit  integer default 20,
  p_before timestamptz default null
)
returns table (
  id uuid, author_id uuid, username text, display_name text,
  avatar_url text, kind text, caption text, image_path text,
  receipt jsonb, verified boolean, like_count integer,
  comment_count integer, created_at timestamptz, liked_by_me boolean
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select p.id, p.author_id, pr.username, pr.display_name, pr.avatar_url,
         p.kind, p.caption, p.image_path, p.receipt, p.verified,
         p.like_count, p.comment_count, p.created_at,
         exists (select 1 from public.likes l
                 where l.post_id = p.id and l.user_id = (select auth.uid())) as liked_by_me
  from public.posts p
  join public.profiles pr on pr.id = p.author_id
  where (p_before is null or p.created_at < p_before)
  order by p.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

revoke execute on function public.get_home_feed(integer, timestamptz) from public, anon;
grant execute on function public.get_home_feed(integer, timestamptz) to authenticated, service_role;
revoke execute on function public.get_discover_feed(integer, timestamptz) from public, anon;
grant execute on function public.get_discover_feed(integer, timestamptz) to authenticated, service_role;

-- ------------------------------------------------------------
-- Shared leaderboard engine over an explicit user scope.
-- Metrics:
--   'streak'   consecutive check-in days ending today or yesterday
--   'days7'    distinct check-in days in the last 7 days
--   'days28'   distinct check-in days in the last 28 days
--   'receipts' number of verified receipt posts
-- Internal only (not exposed via PostgREST — no grants).
-- ------------------------------------------------------------
create or replace function public.leaderboard_for_scope(
  p_scope  uuid[],
  p_metric text
)
returns table (
  user_id uuid, username text, display_name text, avatar_url text,
  value integer, rank integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with scope as (
    select distinct u as uid from unnest(p_scope) u
    where not public.is_blocked((select auth.uid()), u)
  ),
  streaks as (
    -- consecutive run counting back from each user's latest
    -- check-in, valid only if that latest day is today/yesterday
    select s.uid,
           count(*) filter (where d.day = d.mx - (d.rn - 1)::int)::int as v
    from scope s
    join lateral (
      select c.day,
             max(c.day) over () as mx,
             row_number() over (order by c.day desc) as rn
      from public.check_ins c
      where c.user_id = s.uid
    ) d on d.mx >= current_date - 1
    group by s.uid
  ),
  vals as (
    select s.uid,
           case p_metric
             when 'streak' then coalesce((select v from streaks where streaks.uid = s.uid), 0)
             when 'days7' then (select count(distinct c.day)::int from public.check_ins c
                                where c.user_id = s.uid and c.day > current_date - 7)
             when 'days28' then (select count(distinct c.day)::int from public.check_ins c
                                 where c.user_id = s.uid and c.day > current_date - 28)
             when 'receipts' then (select count(*)::int from public.posts p
                                   where p.author_id = s.uid and p.kind = 'receipt'
                                     and p.verified and not p.hidden)
           end as v
    from scope s
  )
  select v.uid, pr.username, pr.display_name, pr.avatar_url,
         v.v as value,
         rank() over (order by v.v desc)::int as rank
  from vals v
  join public.profiles pr on pr.id = v.uid
  order by v.v desc, pr.username
  limit 50;
$$;

revoke execute on function public.leaderboard_for_scope(uuid[], text) from public, anon, authenticated;

-- ------------------------------------------------------------
-- Friends leaderboard: me + everyone I follow.
-- ------------------------------------------------------------
create or replace function public.get_friends_leaderboard(
  p_metric text default 'streak'
)
returns table (
  user_id uuid, username text, display_name text, avatar_url text,
  value integer, rank integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_scope uuid[];
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_metric not in ('streak', 'days7', 'days28', 'receipts') then
    raise exception 'metric must be streak|days7|days28|receipts';
  end if;
  select array_agg(u) into v_scope
  from (select v_uid as u
        union
        select followee_id from public.follows where follower_id = v_uid) s;
  return query select * from public.leaderboard_for_scope(v_scope, p_metric);
end;
$$;

-- ------------------------------------------------------------
-- Gym leaderboard: members of a gym I belong to.
-- ------------------------------------------------------------
create or replace function public.get_gym_leaderboard(
  p_gym_id uuid,
  p_metric text default 'streak'
)
returns table (
  user_id uuid, username text, display_name text, avatar_url text,
  value integer, rank integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_scope uuid[];
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_metric not in ('streak', 'days7', 'days28', 'receipts') then
    raise exception 'metric must be streak|days7|days28|receipts';
  end if;
  -- (columns qualified via alias: the OUT column user_id would
  -- otherwise make these references ambiguous in plpgsql)
  if not exists (select 1 from public.gym_members gm
                 where gm.gym_id = p_gym_id and gm.user_id = v_uid) then
    raise exception 'you are not a member of this gym' using errcode = '42501';
  end if;
  select array_agg(gm.user_id) into v_scope
  from public.gym_members gm where gm.gym_id = p_gym_id;
  return query select * from public.leaderboard_for_scope(v_scope, p_metric);
end;
$$;

revoke execute on function public.get_friends_leaderboard(text) from public, anon;
grant execute on function public.get_friends_leaderboard(text) to authenticated, service_role;
revoke execute on function public.get_gym_leaderboard(uuid, text) from public, anon;
grant execute on function public.get_gym_leaderboard(uuid, text) to authenticated, service_role;

-- ------------------------------------------------------------
-- Community benchmarks: k-anonymous aggregates ONLY.
-- Cohort = (receipt_type, lift, training_age_bucket). Any cohort
-- with fewer than 5 DISTINCT contributors is withheld entirely
-- (no rows returned for it) — k-anonymity with k=5.
-- Returns percentiles of:
--   'pr'          → weekly e1RM progression % (p25/p50/p75)
--   'consistency' → consistency ratio 0..1 (p25/p50/p75)
-- ------------------------------------------------------------
create or replace function public.get_benchmarks(
  p_receipt_type text,
  p_lift         text default null,
  p_training_age text default null
)
returns table (
  receipt_type text, lift text, training_age_bucket text,
  contributors integer, p25 numeric, p50 numeric, p75 numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_receipt_type not in ('pr', 'consistency') then
    raise exception 'receipt_type must be pr|consistency';
  end if;
  return query
  select bc.receipt_type,
         nullif(bc.lift_key, '') as lift,
         bc.training_age_bucket,
         count(distinct bc.user_id)::int as contributors,
         round(percentile_cont(0.25) within group (order by
           case when bc.receipt_type = 'pr' then bc.weekly_progress_pct
                else bc.consistency_ratio end)::numeric, 3) as p25,
         round(percentile_cont(0.50) within group (order by
           case when bc.receipt_type = 'pr' then bc.weekly_progress_pct
                else bc.consistency_ratio end)::numeric, 3) as p50,
         round(percentile_cont(0.75) within group (order by
           case when bc.receipt_type = 'pr' then bc.weekly_progress_pct
                else bc.consistency_ratio end)::numeric, 3) as p75
  from public.benchmark_contributions bc
  where bc.receipt_type = p_receipt_type
    and (p_lift is null or bc.lift_key = lower(btrim(p_lift)))
    and (p_training_age is null or bc.training_age_bucket = p_training_age)
  group by bc.receipt_type, bc.lift_key, bc.training_age_bucket
  having count(distinct bc.user_id) >= 5;   -- k-anonymity, k=5
end;
$$;

revoke execute on function public.get_benchmarks(text, text, text) from public, anon;
grant execute on function public.get_benchmarks(text, text, text) to authenticated, service_role;

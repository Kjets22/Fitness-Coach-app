-- Feeds must return posts.hidden so the client can render the "hidden after
-- reports" notice on the author's own posts (RLS lets an author see their own
-- hidden posts; the feed RPCs previously dropped the column, so social.js's
-- existing row.hidden handling never fired in Home). Return-type changes
-- require dropping the functions first.

drop function if exists public.get_home_feed(integer, timestamptz);
drop function if exists public.get_discover_feed(integer, timestamptz);

create function public.get_home_feed(
  p_limit  integer default 20,
  p_before timestamptz default null
)
returns table (
  id uuid, author_id uuid, username text, display_name text,
  avatar_url text, kind text, caption text, image_path text,
  receipt jsonb, verified boolean, like_count integer,
  comment_count integer, created_at timestamptz, liked_by_me boolean,
  hidden boolean
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
                 where l.post_id = p.id and l.user_id = (select auth.uid())) as liked_by_me,
         p.hidden
  from public.posts p
  join public.profiles pr on pr.id = p.author_id
  where (p.author_id = (select auth.uid())
         or p.author_id in (select f.followee_id from public.follows f
                            where f.follower_id = (select auth.uid())))
    and (p_before is null or p.created_at < p_before)
  order by p.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

create function public.get_discover_feed(
  p_limit  integer default 20,
  p_before timestamptz default null
)
returns table (
  id uuid, author_id uuid, username text, display_name text,
  avatar_url text, kind text, caption text, image_path text,
  receipt jsonb, verified boolean, like_count integer,
  comment_count integer, created_at timestamptz, liked_by_me boolean,
  hidden boolean
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
                 where l.post_id = p.id and l.user_id = (select auth.uid())) as liked_by_me,
         p.hidden
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

-- ============================================================
-- OptimalFit Phase 3 — 03: posts, likes, comments
--
-- Anti-tamper design:
--   * posts.verified can ONLY become true via create_receipt_post
--     (SECURITY DEFINER, migration 06). Client INSERTs must carry
--     verified=false / hidden=false or RLS rejects them (42501).
--   * A BEFORE INSERT trigger forces created_at/counters server-side.
--   * A BEFORE UPDATE "freeze" trigger stops clients from touching
--     author_id, kind, receipt, verified, hidden, counters or
--     created_at. Privileged roles (postgres/service_role and our
--     SECURITY DEFINER trigger functions, which execute as
--     postgres) pass through — that is how the like/comment
--     counter caches and the report auto-hide work.
-- ============================================================

create table public.posts (
  id            uuid primary key default gen_random_uuid(),
  author_id     uuid not null references public.profiles (id) on delete cascade,
  kind          text not null check (kind in ('photo', 'workout', 'meal', 'receipt')),
  caption       text check (caption is null or char_length(caption) <= 1000),
  image_path    text check (image_path is null or char_length(image_path) <= 500),
  -- Receipt payload only makes sense on receipt posts, and must
  -- stay a sane size (the DB refuses absurd payloads).
  receipt       jsonb check (
                  (receipt is null or kind = 'receipt')
                  and (receipt is null or pg_column_size(receipt) <= 16384)
                ),
  verified      boolean not null default false,
  hidden        boolean not null default false,  -- auto-set at >=3 distinct reporters
  like_count    integer not null default 0 check (like_count >= 0),
  comment_count integer not null default 0 check (comment_count >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index posts_author_created_idx on public.posts (author_id, created_at desc);
create index posts_created_idx on public.posts (created_at desc) where not hidden;

create trigger posts_set_updated_at
  before update on public.posts
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- Privilege check shared by the anti-tamper triggers. Inside a
-- SECURITY DEFINER function owned by postgres, current_user is
-- 'postgres', so our own definer code passes; PostgREST client
-- requests run as 'authenticated' and do not.
-- ------------------------------------------------------------
create or replace function public.is_privileged_writer()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select current_user in ('postgres', 'supabase_admin', 'supabase_storage_admin', 'service_role');
$$;

-- Force server-side values on client inserts (anti-cheat: no
-- client-supplied created_at; counter caches always start at 0).
create or replace function public.posts_force_server_fields()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not public.is_privileged_writer() then
    new.created_at := now();
    new.updated_at := now();
    new.like_count := 0;
    new.comment_count := 0;
    -- NOTE: new.verified / new.hidden are deliberately NOT zeroed
    -- here — the RLS WITH CHECK below rejects verified/hidden=true
    -- loudly (42501) instead of silently ignoring them.
  end if;
  return new;
end;
$$;

create trigger posts_before_insert
  before insert on public.posts
  for each row execute function public.posts_force_server_fields();

-- Freeze protected columns on UPDATE for non-privileged writers.
-- Clients may only edit caption and image_path.
create or replace function public.posts_freeze_protected_cols()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.is_privileged_writer() then
    return new;
  end if;
  if new.author_id     is distinct from old.author_id
     or new.kind          is distinct from old.kind
     or new.receipt       is distinct from old.receipt
     or new.verified      is distinct from old.verified
     or new.hidden        is distinct from old.hidden
     or new.like_count    is distinct from old.like_count
     or new.comment_count is distinct from old.comment_count
     or new.created_at    is distinct from old.created_at
  then
    raise exception 'column is protected and cannot be modified by clients'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger posts_before_update
  before update on public.posts
  for each row execute function public.posts_freeze_protected_cols();

-- ------------------------------------------------------------
-- Helper: can the current user see this post? SECURITY DEFINER so
-- likes/comments policies don't recursively re-run posts RLS.
-- ------------------------------------------------------------
create or replace function public.can_see_post(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.posts p
    where p.id = p_post_id
      and (
        p.author_id = (select auth.uid())
        or (not p.hidden
            and not public.is_blocked((select auth.uid()), p.author_id))
      )
  );
$$;

revoke execute on function public.can_see_post(uuid) from public, anon;
grant execute on function public.can_see_post(uuid) to authenticated, service_role;

-- ------------------------------------------------------------
-- RLS: posts
-- ------------------------------------------------------------
alter table public.posts enable row level security;

-- Authors always see their own posts (even auto-hidden ones, so
-- moderation isn't a silent shadowban surprise in their own list);
-- everyone else sees non-hidden posts outside block relationships.
create policy posts_select_visible
  on public.posts for select
  to authenticated
  using (
    author_id = (select auth.uid())
    or (not hidden
        and not public.is_blocked((select auth.uid()), author_id))
  );

-- INSERT: own posts only; verified/hidden MUST be false — the only
-- path to verified=true is the create_receipt_post RPC.
create policy posts_insert_own_unverified
  on public.posts for insert
  to authenticated
  with check (
    author_id = (select auth.uid())
    and verified = false
    and hidden = false
  );

-- UPDATE: own posts only (freeze trigger limits editable columns).
create policy posts_update_own
  on public.posts for update
  to authenticated
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));

create policy posts_delete_own
  on public.posts for delete
  to authenticated
  using (author_id = (select auth.uid()));

-- ------------------------------------------------------------
-- likes — PK (post_id, user_id) makes double-liking a hard 409.
-- ------------------------------------------------------------
create table public.likes (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index likes_user_idx on public.likes (user_id);

alter table public.likes enable row level security;

create policy likes_select_visible
  on public.likes for select
  to authenticated
  using (
    public.can_see_post(post_id)
    and not public.is_blocked((select auth.uid()), user_id)
  );

create policy likes_insert_own
  on public.likes for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and public.can_see_post(post_id)
  );

create policy likes_delete_own
  on public.likes for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- ------------------------------------------------------------
-- comments
-- ------------------------------------------------------------
create table public.comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  author_id  uuid not null references public.profiles (id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

create index comments_post_idx on public.comments (post_id, created_at);

alter table public.comments enable row level security;

create policy comments_select_visible
  on public.comments for select
  to authenticated
  using (
    public.can_see_post(post_id)
    and not public.is_blocked((select auth.uid()), author_id)
  );

create policy comments_insert_own
  on public.comments for insert
  to authenticated
  with check (
    author_id = (select auth.uid())
    and public.can_see_post(post_id)
  );

-- Comment author OR the post's author (moderating their own post)
-- can delete. No UPDATE policy: comments are delete-and-repost.
create policy comments_delete_own_or_post_author
  on public.comments for delete
  to authenticated
  using (
    author_id = (select auth.uid())
    or exists (
      select 1 from public.posts p
      where p.id = post_id and p.author_id = (select auth.uid())
    )
  );

-- ------------------------------------------------------------
-- Counter caches. SECURITY DEFINER so the row-owner's RLS on posts
-- doesn't block incrementing someone else's post counters.
-- ------------------------------------------------------------
create or replace function public.bump_like_count()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    update public.posts set like_count = like_count + 1 where id = new.post_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.posts set like_count = greatest(like_count - 1, 0) where id = old.post_id;
    return old;
  end if;
  return null;
end;
$$;

create trigger likes_bump_count
  after insert or delete on public.likes
  for each row execute function public.bump_like_count();

create or replace function public.bump_comment_count()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    update public.posts set comment_count = comment_count + 1 where id = new.post_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.posts set comment_count = greatest(comment_count - 1, 0) where id = old.post_id;
    return old;
  end if;
  return null;
end;
$$;

create trigger comments_bump_count
  after insert or delete on public.comments
  for each row execute function public.bump_comment_count();

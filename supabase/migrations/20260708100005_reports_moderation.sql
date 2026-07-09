-- ============================================================
-- OptimalFit Phase 3 — 05: reports + auto-moderation
--
-- UGC compliance: any user can report a post, comment or user.
-- Reports are WRITE-ONLY for clients (insert as yourself; nobody
-- can read the reports table via the API — review happens in the
-- Supabase dashboard / service-role tooling).
-- A post with reports from >=3 DISTINCT reporters is auto-hidden.
-- ============================================================

create table public.reports (
  id                uuid primary key default gen_random_uuid(),
  reporter_id       uuid not null references public.profiles (id) on delete cascade,
  target_post_id    uuid references public.posts (id) on delete cascade,
  target_comment_id uuid references public.comments (id) on delete cascade,
  target_user_id    uuid references public.profiles (id) on delete cascade,
  reason            text not null check (char_length(reason) between 3 and 500),
  created_at        timestamptz not null default now(),
  -- Exactly one target per report.
  check (
    (target_post_id is not null)::int
    + (target_comment_id is not null)::int
    + (target_user_id is not null)::int = 1
  )
);

-- One report per reporter per target (no single-user report-spam
-- to trip the auto-hide threshold).
create unique index reports_unique_post
  on public.reports (reporter_id, target_post_id) where target_post_id is not null;
create unique index reports_unique_comment
  on public.reports (reporter_id, target_comment_id) where target_comment_id is not null;
create unique index reports_unique_user
  on public.reports (reporter_id, target_user_id) where target_user_id is not null;

create index reports_post_idx on public.reports (target_post_id) where target_post_id is not null;

alter table public.reports enable row level security;

-- INSERT only, as yourself. NO select/update/delete policies →
-- clients can never read reports (not even their own).
create policy reports_insert_own
  on public.reports for insert
  to authenticated
  with check (reporter_id = (select auth.uid()));

-- ------------------------------------------------------------
-- Auto-hide: >=3 distinct reporters on a post → posts.hidden=true.
-- SECURITY DEFINER (runs as postgres) so it passes both posts RLS
-- and the posts freeze trigger.
-- ------------------------------------------------------------
create or replace function public.auto_hide_reported_post()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.target_post_id is not null then
    if (select count(distinct reporter_id)
        from public.reports
        where target_post_id = new.target_post_id) >= 3 then
      update public.posts set hidden = true
      where id = new.target_post_id and hidden = false;
    end if;
  end if;
  return new;
end;
$$;

create trigger reports_auto_hide
  after insert on public.reports
  for each row execute function public.auto_hide_reported_post();

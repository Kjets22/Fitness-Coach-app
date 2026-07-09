-- ============================================================
-- 20260708200000_account_deletion.sql
-- Self-service account deletion (Phase 3, frontend agent).
--
-- Clients cannot delete auth.users rows with the anon key, so we
-- expose ONE SECURITY DEFINER RPC. It:
--   1. deletes the caller's storage object rows (avatars +
--      post-images under "<uid>/..."). The client also best-effort
--      removes the files through the Storage API first, so the
--      CDN objects go away too; this SQL delete guarantees the
--      database rows are gone even if that failed.
--   2. deletes the caller's benchmark_contributions row(s)
--      (kept only for dedupe; not covered by the profiles cascade
--      guarantee we want to be explicit about).
--   3. deletes the auth.users row — profiles has
--      ON DELETE CASCADE from auth.users, and every content table
--      cascades from profiles, so this wipes the whole graph:
--      posts, likes, comments, follows, blocks, gym memberships,
--      check-ins, reports.
--
-- Runs as the migration role (postgres), which Supabase grants
-- delete on auth.users and storage.objects.
-- ============================================================

create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- storage rows (both buckets; keys are enforced to start "<uid>/")
  delete from storage.objects
   where bucket_id in ('avatars', 'post-images')
     and (storage.foldername(name))[1] = v_uid::text;

  -- anonymized benchmark rows (user_id kept only for dedupe)
  delete from public.benchmark_contributions
   where user_id = v_uid;

  -- the big cascade: auth.users → profiles → all social content
  delete from auth.users
   where id = v_uid;
end;
$$;

revoke all on function public.delete_account() from public;
revoke all on function public.delete_account() from anon;
grant execute on function public.delete_account() to authenticated;

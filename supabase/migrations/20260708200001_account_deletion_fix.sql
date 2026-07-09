-- ============================================================
-- 20260708200001_account_deletion_fix.sql
-- Supabase blocks direct SQL deletes on storage.objects
-- ("Use the Storage API instead", 42501), so delete_account()
-- must NOT touch the storage schema. The division of labor is:
--
--   client (social-api.js deleteAccount):
--     lists + removes ALL of the user's objects in both buckets
--     through the Storage API (RLS: own "<uid>/..." keys), and
--     ABORTS the deletion if that cleanup fails — so we never
--     delete the account while photos would be left behind.
--   this RPC:
--     benchmark_contributions row(s) + the auth.users row, whose
--     FK cascade (auth.users → profiles → everything) wipes the
--     rest of the graph.
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

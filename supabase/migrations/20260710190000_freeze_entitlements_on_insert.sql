-- SECURITY: the entitlement freeze trigger was BEFORE UPDATE only, so a user
-- could self-grant premium/admin/infinite-trial by INSERTing their own profile
-- row with those columns set (RLS profiles_insert_own only checks id=auth.uid()),
-- or by deleting + re-inserting their row. is_admin=true is a real privilege
-- (it authorizes admin_set_premium). Freeze the three entitlement columns on
-- INSERT as well as UPDATE — only the privileged path (admin_set_premium, which
-- sets app.entitlement_write='on') may set them.

create or replace function public.protect_entitlements()
returns trigger language plpgsql as $$
begin
  -- privileged writer (admin_set_premium / service_role via the flag) may set them
  if coalesce(current_setting('app.entitlement_write', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    -- brand-new profile: force safe defaults no matter what the client sent
    new.is_premium    := false;
    new.is_admin      := false;
    new.trial_ends_at := now() + interval '7 days';
  else  -- UPDATE: these columns can never change through a normal write
    new.is_premium    := old.is_premium;
    new.is_admin      := old.is_admin;
    new.trial_ends_at := old.trial_ends_at;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_entitlements on public.profiles;
create trigger trg_protect_entitlements
  before insert or update on public.profiles
  for each row execute function public.protect_entitlements();

-- Repair any rows that may have been tampered before this fix (best-effort:
-- reset admin/premium for everyone except intentionally-granted accounts).
-- The owner re-grants via tools/grant-premium.mjs. Only run the reset for
-- rows NOT created through admin_set_premium — here we simply null out admin
-- for safety; premium/trial are cheap to re-grant if a real member is caught.
update public.profiles set is_admin = false
 where is_admin = true
   and username not in ('optimalfit_demo');  -- keep the known reviewer/demo

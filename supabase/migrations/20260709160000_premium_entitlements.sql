-- Premium entitlements: gate the LLM features (coach, food-photo macros,
-- physique analysis) behind a paywall the OWNER controls.
--
-- Design: is_premium / is_admin live on profiles but are SERVER-ENFORCED — a
-- BEFORE UPDATE trigger freezes them so a user can NEVER self-grant premium by
-- PATCHing their own profile (same posture as posts.verified). They are set
-- only through admin_set_premium(), which authorizes either the service_role
-- (the owner's local grant tool / dashboard) or an existing is_admin account.

alter table public.profiles
  add column if not exists is_premium boolean not null default false,
  add column if not exists is_admin   boolean not null default false;

-- Freeze is_premium / is_admin against direct client writes. The trigger allows
-- the change only when admin_set_premium set the transaction-local flag.
create or replace function public.protect_entitlements()
returns trigger language plpgsql as $$
begin
  if (new.is_premium is distinct from old.is_premium
      or new.is_admin is distinct from old.is_admin)
     and coalesce(current_setting('app.entitlement_write', true), '') <> 'on' then
    new.is_premium := old.is_premium;
    new.is_admin   := old.is_admin;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_entitlements on public.profiles;
create trigger trg_protect_entitlements
  before update on public.profiles
  for each row execute function public.protect_entitlements();

-- Grant/revoke premium (and, for service_role only, admin) on any account.
-- authenticated callers must themselves be is_admin. service_role (the owner's
-- CLI tool / dashboard) may also toggle is_admin to bootstrap the first admin.
create or replace function public.admin_set_premium(
  p_target  uuid,
  p_premium boolean,
  p_admin   boolean default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_is_service boolean := (auth.role() = 'service_role');
begin
  if not v_is_service
     and not coalesce((select is_admin from public.profiles where id = auth.uid()), false) then
    raise exception 'not authorized to change entitlements';
  end if;

  perform set_config('app.entitlement_write', 'on', true);
  update public.profiles
     set is_premium = coalesce(p_premium, is_premium),
         is_admin   = case when v_is_service and p_admin is not null then p_admin else is_admin end,
         updated_at = now()
   where id = p_target;
  perform set_config('app.entitlement_write', 'off', true);
end;
$$;

revoke execute on function public.admin_set_premium(uuid, boolean, boolean) from public, anon;
grant  execute on function public.admin_set_premium(uuid, boolean, boolean) to authenticated, service_role;

comment on function public.admin_set_premium is
  'Owner-controlled premium/admin toggle. Clients cannot set is_premium directly (frozen by trg_protect_entitlements); this SECURITY DEFINER fn authorizes service_role or is_admin callers only.';

-- 7-day free trial for the Premium AI features. Every new account gets AI access
-- for 7 days from sign-up; after that it reverts to the paywall unless the owner
-- has granted is_premium. trial_ends_at is SERVER-set and FROZEN (a user can't
-- extend their own trial), same posture as is_premium.

alter table public.profiles
  add column if not exists trial_ends_at timestamptz not null default (now() + interval '7 days');

-- give existing accounts a fresh 7-day trial too (one-time backfill; the DEFAULT
-- above already covers all future sign-ups)
update public.profiles
   set trial_ends_at = now() + interval '7 days'
 where trial_ends_at is null;

-- extend the entitlement freeze to cover trial_ends_at
create or replace function public.protect_entitlements()
returns trigger language plpgsql as $$
begin
  if (new.is_premium is distinct from old.is_premium
      or new.is_admin is distinct from old.is_admin
      or new.trial_ends_at is distinct from old.trial_ends_at)
     and coalesce(current_setting('app.entitlement_write', true), '') <> 'on' then
    new.is_premium    := old.is_premium;
    new.is_admin      := old.is_admin;
    new.trial_ends_at := old.trial_ends_at;
  end if;
  return new;
end;
$$;

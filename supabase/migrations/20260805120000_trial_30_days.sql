-- Free trial: 7 days -> 1 MONTH (30 days). Every new account gets full access
-- to the Premium AI features for a month from sign-up (owner decision
-- 2026-08-05, pre-launch). trial_ends_at stays SERVER-set and FROZEN
-- (protect_entitlements trigger unchanged).

alter table public.profiles
  alter column trial_ends_at set default (now() + interval '30 days');

-- One-time pre-launch backfill: give every existing non-premium account the
-- full month from today (there are no paying users yet; expired test-account
-- trials are deliberately re-opened so the longer trial can be tested).
update public.profiles
   set trial_ends_at = now() + interval '30 days'
 where coalesce(is_premium, false) = false
   and coalesce(is_admin, false) = false
   and trial_ends_at < now() + interval '30 days';

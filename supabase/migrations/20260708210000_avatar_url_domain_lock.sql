-- QA-7 MEDIUM-1 fix: avatar_url must point at our own Supabase avatars bucket.
--
-- Before this, profiles.avatar_url only had a length check, so a user could
-- PATCH it to any external URL (e.g. http://evil/track.png). Because avatars
-- render as <img src> in every viewer's public Discover/Home feed, that turned
-- the feed into a silent tracking beacon (leaking each viewer's IP/UA/timing) —
-- directly contradicting the app's "no ads, no tracking" promise.
--
-- Fix: constrain avatar_url to NULL/'' or the public avatars-bucket prefix on
-- THIS project. The client already stores exactly this shape
-- (publicUrl("avatars", "<uid>/avatar-<ts>.jpg")), so legitimate uploads pass
-- unchanged. Post images were never affected — they are stored as domain-owned
-- object keys (image_path) and the URL is built client-side.
--
-- All existing rows have avatar_url IS NULL (verified), so the constraint
-- validates immediately without a NOT VALID/backfill dance.

alter table public.profiles
  add constraint profiles_avatar_url_own_bucket
  check (
    avatar_url is null
    or avatar_url = ''
    or avatar_url like 'https://puopvaqquujalwnzwyov.supabase.co/storage/v1/object/public/avatars/%'
  );

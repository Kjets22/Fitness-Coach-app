-- ============================================================
-- OptimalFit Phase 3 — 08: storage buckets + policies
--
-- avatars      2 MB cap,  public read
-- post-images  5 MB cap,  public read
-- Mime allowlist: jpeg/png/webp. Uploads/edits/deletes allowed
-- only under a folder named after the uploader's auth.uid()
-- (i.e. object key must start with "<uid>/").
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 2097152,
   array['image/jpeg', 'image/png', 'image/webp']),
  ('post-images', 'post-images', true, 5242880,
   array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Public read (buckets are public anyway for CDN URLs; this also
-- allows authenticated API reads/lists of these two buckets).
create policy "optimalfit public read"
  on storage.objects for select
  to public
  using (bucket_id in ('avatars', 'post-images'));

-- Write/update/delete only inside your own uid-named folder.
create policy "optimalfit owner insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id in ('avatars', 'post-images')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "optimalfit owner update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id in ('avatars', 'post-images')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id in ('avatars', 'post-images')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "optimalfit owner delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id in ('avatars', 'post-images')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

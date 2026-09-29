-- Guest feedback photo storage
-- Run once in Supabase → SQL Editor (safe to re-run)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'feedback-photos',
  'feedback-photos',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Feedback photos public read" on storage.objects;
create policy "Feedback photos public read"
  on storage.objects for select
  using (bucket_id = 'feedback-photos');

drop policy if exists "Authenticated upload feedback photos" on storage.objects;
create policy "Authenticated upload feedback photos"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'feedback-photos');

drop policy if exists "Authenticated update feedback photos" on storage.objects;
create policy "Authenticated update feedback photos"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'feedback-photos');

drop policy if exists "Staff manage feedback photos" on storage.objects;
create policy "Staff manage feedback photos"
  on storage.objects for all
  using (bucket_id = 'feedback-photos' and public.is_staff());

notify pgrst, 'reload schema';

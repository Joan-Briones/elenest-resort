-- Payment receipt storage + rejection columns
-- Run once in Supabase → SQL Editor (safe to re-run)

alter table public.bookings
  add column if not exists payment_rejected_at timestamptz;

alter table public.bookings
  add column if not exists payment_rejected_by text;

alter table public.bookings
  add column if not exists payment_rejection_reason text;

alter table public.bookings
  add column if not exists payment_proof_url text;

-- Storage bucket for customer payment receipts (public read so admin can view)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-proofs',
  'payment-proofs',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Payment proofs public read" on storage.objects;
create policy "Payment proofs public read"
  on storage.objects for select
  using (bucket_id = 'payment-proofs');

drop policy if exists "Authenticated upload payment proofs" on storage.objects;
create policy "Authenticated upload payment proofs"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'payment-proofs');

drop policy if exists "Authenticated update payment proofs" on storage.objects;
create policy "Authenticated update payment proofs"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'payment-proofs');

drop policy if exists "Staff manage payment proofs" on storage.objects;
create policy "Staff manage payment proofs"
  on storage.objects for all
  using (bucket_id = 'payment-proofs' and public.is_staff());

notify pgrst, 'reload schema';

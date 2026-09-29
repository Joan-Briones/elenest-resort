-- Bookings save fix: columns + RLS policies so all roles can insert/update correctly
-- Run once in Supabase → SQL Editor (safe to re-run)

-- Payment flow columns (from supabase-payment-flow-migrate.sql)
alter table public.bookings add column if not exists payment_type text not null default 'down';
alter table public.bookings add column if not exists amount_paid numeric(12, 2);
alter table public.bookings add column if not exists balance_due numeric(12, 2);
alter table public.bookings add column if not exists hold_expires_at timestamptz;
alter table public.bookings add column if not exists arrival_status text not null default 'not_arrived';
alter table public.bookings add column if not exists non_refundable boolean not null default false;

-- Rejection + receipt columns (from supabase-payment-proofs-storage.sql)
alter table public.bookings add column if not exists payment_rejected_at timestamptz;
alter table public.bookings add column if not exists payment_rejected_by text;
alter table public.bookings add column if not exists payment_rejection_reason text;
alter table public.bookings add column if not exists payment_proof_url text;

-- RLS: staff need WITH CHECK to insert/update; guests need WITH CHECK on update
drop policy if exists "Staff manage all bookings" on public.bookings;
create policy "Staff manage all bookings"
  on public.bookings for all
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists "Guests update own bookings" on public.bookings;
create policy "Guests update own bookings"
  on public.bookings for update
  using (user_id = auth.uid() or lower(user_email) = public.current_user_email())
  with check (user_id = auth.uid() or lower(user_email) = public.current_user_email());

notify pgrst, 'reload schema';

-- Payment flow fixes: For Verification, Rejected, occupancy rules
-- Run once in Supabase → SQL Editor (safe to re-run)

alter table public.bookings
  add column if not exists payment_type text not null default 'down';

alter table public.bookings
  add column if not exists amount_paid numeric(12, 2);

alter table public.bookings
  add column if not exists balance_due numeric(12, 2);

alter table public.bookings
  add column if not exists hold_expires_at timestamptz;

alter table public.bookings
  add column if not exists arrival_status text not null default 'not_arrived';

alter table public.bookings
  add column if not exists non_refundable boolean not null default false;

-- Occupancy RPC: block For Verification + confirmed/reserved; release rejected/cancelled/no show
create or replace function public.get_booking_occupancy()
returns table (check_in date, check_out date, status text)
language sql security definer set search_path = public stable
as $$
  select b.check_in, b.check_out, b.status
  from public.bookings b
  where b.check_in is not null
    and b.check_out is not null
    and lower(trim(b.status)) not in (
      'cancelled', 'canceled', 'rejected',
      'no show', 'no_show', 'noshow'
    )
    and (
      lower(trim(b.status)) in ('for verification', 'pending payment verification', 'confirmed', 'approved', 'reserved', 'active')
      or b.hold_expires_at is not null
    );
$$;

grant execute on function public.get_booking_occupancy() to anon, authenticated;

notify pgrst, 'reload schema';

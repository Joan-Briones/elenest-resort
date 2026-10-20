-- Cancel unpaid bookings 3 hours after they were created.
-- Run once in the Supabase SQL editor. Safe to run again.
-- Confirmed, reserved, and bookings that already have a payment receipt are left alone.

create or replace function public.expire_unpaid_bookings()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer := 0;
begin
  update public.bookings b
  set
    status = 'Cancelled',
    payment_status = 'Expired — payment not completed within 3 hours',
    payload = coalesce(b.payload, '{}'::jsonb) || jsonb_build_object(
      'status', 'Cancelled',
      'paymentStatus', 'Expired — payment not completed within 3 hours',
      'workflow', 'payment_expired',
      'verificationStage', 'payment_expired',
      'slotLocked', false,
      'holdExpiresAt', null,
      'paymentDeadlineAt', null,
      'cancelledAt', now(),
      'cancelledBy', 'system'
    ),
    updated_at = now()
  where coalesce(b.submitted_at, b.created_at) <= now() - interval '3 hours'
    and lower(coalesce(b.status::text, '')) not in (
      'cancelled', 'canceled', 'rejected', 'confirmed', 'reserved', 'approved', 'active',
      'checked in', 'checked_in', 'checked out', 'checked_out', 'completed',
      'no show', 'no_show', 'noshow'
    )
    and coalesce(nullif(b.payload ->> 'paymentVerifiedAt', ''), '') = ''
    and coalesce(nullif(b.payload ->> 'payment_verified_at', ''), '') = ''
    and coalesce(nullif(b.payment_proof_url, ''), '') = ''
    and coalesce(nullif(b.payload ->> 'paymentProofUrl', ''), '') = ''
    and coalesce(nullif(b.payload ->> 'paymentProof', ''), '') = ''
    and coalesce(nullif(b.payload ->> 'paymentSubmittedAt', ''), '') = ''
    and lower(coalesce(b.payload ->> 'hasPaymentProof', '')) not in ('true', '1');

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

grant execute on function public.expire_unpaid_bookings() to anon, authenticated, service_role;

-- Run every 5 minutes when pg_cron is enabled, so rooms are released
-- even if no one has the website open.
do $$
declare
  existing_job bigint;
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    select jobid into existing_job from cron.job where jobname = 'expire-unpaid-bookings' limit 1;
    if existing_job is not null then
      perform cron.unschedule(existing_job);
    end if;
    perform cron.schedule(
      'expire-unpaid-bookings',
      '*/5 * * * *',
      'select public.expire_unpaid_bookings()'
    );
  end if;
exception
  when others then
    raise notice 'pg_cron schedule skipped: %', sqlerrm;
end $$;

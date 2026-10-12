-- =============================================================================
-- Public availability (mobile + website bookings) + realtime sync
-- Re-run in Supabase Dashboard → SQL Editor (safe to re-run).
--
-- Includes ALL active bookings from website AND mobile so both calendars match.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Helpers (mobile + website bookings) — multi-facility aware
-- ---------------------------------------------------------------------------
-- All facility IDs occupied by a booking (supports multi-select)
create or replace function public._booking_facility_ids(b public.bookings)
returns setof text
language sql
stable
set search_path = public
as $$
  -- Always UNION room_ids AND facilityIds (do not treat as exclusive).
  select distinct x
  from (
    select jsonb_array_elements_text(
      case
        when jsonb_typeof(coalesce(b.payload -> 'room_ids', 'null'::jsonb)) = 'array'
          then b.payload -> 'room_ids'
        else '[]'::jsonb
      end
    ) as x
  ) t
  where nullif(trim(x), '') is not null

  union

  select distinct x
  from (
    select jsonb_array_elements_text(
      case
        when jsonb_typeof(coalesce(b.payload -> 'facilityIds', 'null'::jsonb)) = 'array'
          then b.payload -> 'facilityIds'
        else '[]'::jsonb
      end
    ) as x
  ) t
  where nullif(trim(x), '') is not null

  union

  select distinct x
  from (
    select jsonb_array_elements_text(
      case
        when jsonb_typeof(coalesce(b.payload -> 'roomCatalogIds', 'null'::jsonb)) = 'array'
          then b.payload -> 'roomCatalogIds'
        when jsonb_typeof(coalesce(b.payload -> 'room_catalog_ids', 'null'::jsonb)) = 'array'
          then b.payload -> 'room_catalog_ids'
        else '[]'::jsonb
      end
    ) as x
  ) t
  where nullif(trim(x), '') is not null

  union

  select nullif(trim(coalesce(
    b.payload ->> 'roomCatalogId',
    b.payload ->> 'room_catalog_id',
    ''
  )), '')
  where nullif(trim(coalesce(
    b.payload ->> 'roomCatalogId',
    b.payload ->> 'room_catalog_id',
    ''
  )), '') is not null

  union

  select distinct x
  from (
    select jsonb_array_elements_text(
      case
        when jsonb_typeof(coalesce(b.payload -> 'cottageCatalogIds', 'null'::jsonb)) = 'array'
          then b.payload -> 'cottageCatalogIds'
        when jsonb_typeof(coalesce(b.payload -> 'cottage_catalog_ids', 'null'::jsonb)) = 'array'
          then b.payload -> 'cottage_catalog_ids'
        else '[]'::jsonb
      end
    ) as x
  ) t
  where nullif(trim(x), '') is not null

  union

  select distinct x
  from (
    select jsonb_array_elements_text(
      case
        when jsonb_typeof(coalesce(b.payload -> 'hallCatalogIds', 'null'::jsonb)) = 'array'
          then b.payload -> 'hallCatalogIds'
        when jsonb_typeof(coalesce(b.payload -> 'hall_catalog_ids', 'null'::jsonb)) = 'array'
          then b.payload -> 'hall_catalog_ids'
        else '[]'::jsonb
      end
    ) as x
  ) t
  where nullif(trim(x), '') is not null

  union

  select nullif(trim(coalesce(
    b.payload ->> 'hallCatalogId',
    b.payload ->> 'hall_catalog_id',
    ''
  )), '')
  where nullif(trim(coalesce(
    b.payload ->> 'hallCatalogId',
    b.payload ->> 'hall_catalog_id',
    ''
  )), '') is not null

  union

  select nullif(trim(coalesce(
    b.payload ->> 'room_id',
    b.payload ->> 'eventHall',
    ''
  )), '')
  where nullif(trim(coalesce(
    b.payload ->> 'room_id',
    b.payload ->> 'eventHall',
    ''
  )), '') is not null
    and nullif(trim(coalesce(
      b.payload ->> 'room_id',
      b.payload ->> 'eventHall',
      ''
    )), '') not in ('none', 'no', 'couple', 'big', 'small');
$$;

-- Single-id helper (legacy / mobile compatibility) — first of all facility ids
create or replace function public._booking_room_id(b public.bookings)
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(
    (
      select fid
      from public._booking_facility_ids(b) as fid
      where fid is not null and fid <> ''
      limit 1
    ),
    nullif(b.payload ->> 'room_id', ''),
    nullif(b.room_type, '')
  );
$$;

-- True when a booking should paint the public calendar (mobile workflow OR website status)
create or replace function public._booking_blocks_public_availability(b public.bookings)
returns boolean
language sql
stable
set search_path = public
as $$
  select
    b.check_in is not null
    and b.check_out is not null
    and b.check_out::date >= b.check_in::date
    and lower(coalesce(b.status::text, '')) not in (
      'cancelled',
      'canceled',
      'rejected',
      'no show',
      'no_show',
      'noshow',
      'completed',
      'checked out',
      'checked_out',
      'checked-out'
    )
    and (
      -- Mobile app workflows
      lower(coalesce(b.payload ->> 'workflow', '')) in (
        'pending',
        'pending_payment',
        'pending_verification',
        'verified_by_receptionist',
        'approved',
        'confirmed',
        'checked_in',
        'reserved',
        'awaiting_booking_review',
        'awaiting_payment'
      )
      -- Website statuses (when workflow missing / different)
      or lower(coalesce(b.status::text, '')) in (
        'pending',
        'awaiting payment',
        'for verification',
        'pending payment verification',
        'reserved',
        'confirmed',
        'approved',
        'active',
        'checked in',
        'checked_in'
      )
      -- Default: active booking with no workflow yet (website legacy rows)
      or (
        coalesce(nullif(b.payload ->> 'workflow', ''), '') = ''
        and lower(coalesce(b.status::text, 'pending')) not in (
          'cancelled', 'canceled', 'rejected', 'no show', 'no_show', 'noshow',
          'completed', 'checked out', 'checked_out', 'checked-out'
        )
      )
    )
    -- Rejected payment releases the slot
    and coalesce(nullif(b.payload ->> 'paymentRejectedAt', ''), '') = ''
    and coalesce(nullif(b.payload ->> 'payment_rejected_at', ''), '') = ''
    and not (
      lower(coalesce(b.payload ->> 'workflow', '')) = 'awaiting_payment'
      and coalesce(b.payload ->> 'paymentDeadlineAt', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
      and (b.payload ->> 'paymentDeadlineAt')::timestamptz <= now()
      and coalesce(nullif(b.payload ->> 'paymentSubmittedAt', ''), '') = ''
      and coalesce(nullif(b.payment_proof_url, ''), '') = ''
      and coalesce(nullif(b.payload ->> 'paymentProofUrl', ''), '') = ''
      and lower(coalesce(b.payload ->> 'hasPaymentProof', '')) not in ('true', '1')
    );
$$;

-- Occupies calendar night/day (overnight: check_out exclusive; same-day: occupies check_in)
create or replace function public._booking_occupies_date(b public.bookings, p_date date)
returns boolean
language sql
stable
set search_path = public
as $$
  select
    b.check_in is not null
    and b.check_out is not null
    and p_date >= b.check_in::date
    and p_date < case
      when b.check_out::date > b.check_in::date then b.check_out::date
      else (b.check_in::date + 1)
    end;
$$;

create or replace function public._booking_last_occupied_date(b public.bookings)
returns date
language sql
stable
set search_path = public
as $$
  select case
    when b.check_out::date > b.check_in::date then (b.check_out::date - 1)
    else b.check_in::date
  end;
$$;

-- True only after admin payment verification (or a settled walk-in / checked-in stay).
-- Pre-verification reservations stay pending on every calendar.
create or replace function public._booking_calendar_payment_verified(b public.bookings)
returns boolean
language sql
stable
set search_path = public
as $$
  select case
    when b.payment_verified_at is not null then true
    when coalesce(
      nullif(b.payload ->> 'paymentVerifiedAt', ''),
      nullif(b.payload ->> 'payment_verified_at', ''),
      ''
    ) <> '' then true
    when lower(coalesce(b.payload ->> 'walkIn', '')) in ('true', '1') then true
    when lower(coalesce(b.payload ->> 'workflow', '')) in (
      'awaiting_booking_review',
      'awaiting_payment',
      'pending_payment',
      'pending_verification',
      'pending'
    ) then false
    when lower(coalesce(b.status::text, '')) in (
      'pending',
      'awaiting payment',
      'awaiting_payment',
      'for verification',
      'pending payment verification'
    ) then false
    when lower(coalesce(b.payload ->> 'verificationStage', b.payload ->> 'verification_stage', '')) in (
      'awaiting_booking_review',
      'awaiting_payment',
      'awaiting_admin'
    ) then false
    when lower(coalesce(b.payload ->> 'workflow', '')) in (
      'confirmed',
      'approved',
      'checked_in',
      'verified_by_receptionist'
    ) then true
    when lower(coalesce(b.payload ->> 'verificationStage', b.payload ->> 'verification_stage', '')) = 'approved'
      then true
    when lower(coalesce(b.status::text, '')) in (
      'confirmed',
      'reserved',
      'approved',
      'active',
      'checked in',
      'checked_in',
      'checked out',
      'checked_out',
      'checked-out',
      'completed'
    ) then true
    else false
  end;
$$;

-- ---------------------------------------------------------------------------
-- 1. All public booking rows (calendar / month view) — no PII
-- ---------------------------------------------------------------------------
drop function if exists public.get_public_availability_bookings();

create function public.get_public_availability_bookings()
returns table (
  id text,
  room_id text,
  room_ids text[],
  check_in date,
  check_out date,
  status text,
  workflow text,
  hold_expires_at text,
  payment_type text,
  notes text,
  payment_verified boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    b.id::text,
    public._booking_room_id(b) as room_id,
    coalesce(
      (
        select array_agg(distinct fid order by fid)
        from public._booking_facility_ids(b) as fid
        where fid is not null and fid <> ''
      ),
      '{}'::text[]
    ) as room_ids,
    b.check_in::date,
    b.check_out::date,
    lower(coalesce(b.status::text, 'pending')) as status,
    lower(
      coalesce(
        nullif(b.payload ->> 'workflow', ''),
        case
          when lower(coalesce(b.status::text, '')) in ('confirmed', 'approved', 'active') then 'confirmed'
          when lower(coalesce(b.status::text, '')) = 'reserved' then 'approved'
          when lower(coalesce(b.status::text, '')) in ('for verification', 'pending payment verification')
            then 'pending_payment'
          else 'pending'
        end
      )
    ) as workflow,
    coalesce(
      b.payload ->> 'hold_expires_at',
      b.payload ->> 'holdExpiresAt'
    ) as hold_expires_at,
    coalesce(
      nullif(b.payload ->> 'payment_type', ''),
      nullif(b.payload ->> 'paymentType', ''),
      'down'
    ) as payment_type,
    -- Strip guest PII lines; keep workflow / meta tags only
    coalesce(
      (
        select string_agg(line, E'\n')
        from unnest(string_to_array(coalesce(b.payload ->> 'notes', ''), E'\n')) as line
        where line ~ '^__\w+__:'
      ),
      ''
    ) as notes,
    public._booking_calendar_payment_verified(b) as payment_verified
  from public.bookings b
  where public._booking_blocks_public_availability(b);
$$;

grant execute on function public.get_public_availability_bookings() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Facilities for a SPECIFIC date (available / booked)
-- ---------------------------------------------------------------------------
drop function if exists public.get_public_facility_availability_for_date(date);

create function public.get_public_facility_availability_for_date(p_date date)
returns table (
  room_id text,
  room_name text,
  facility_type text,
  price numeric,
  price_unit text,
  capacity int,
  capacity_min int,
  is_available boolean,
  is_blocked boolean,
  booking_id text,
  workflow text
)
language sql
security definer
set search_path = public
stable
as $$
  with blocked as (
    select exists (
      select 1
      from public.manager_blocked_dates m
      where m.blocked_date::date = p_date
    ) as day_blocked
  ),
  active_rooms as (
    select
      rc.id,
      rc.name,
      rc.type,
      rc.price,
      rc.price_unit,
      rc.capacity,
      rc.capacity_min
    from public.room_catalog rc
    where rc.active = true
  ),
  day_bookings as (
    select
      fid as room_id,
      b.id::text as booking_id,
      lower(coalesce(b.payload ->> 'workflow', 'pending')) as workflow
    from public.bookings b
    cross join lateral public._booking_facility_ids(b) as fid
    where public._booking_blocks_public_availability(b)
      and public._booking_occupies_date(b, p_date)
      and fid is not null
      and fid <> ''
  )
  select
    r.id as room_id,
    r.name as room_name,
    r.type as facility_type,
    r.price,
    r.price_unit,
    r.capacity,
    r.capacity_min,
    case
      when (select day_blocked from blocked) then false
      when db.room_id is not null then false
      else true
    end as is_available,
    (select day_blocked from blocked) as is_blocked,
    db.booking_id,
    db.workflow
  from active_rooms r
  left join lateral (
    select d.booking_id, d.workflow, d.room_id
    from day_bookings d
    where d.room_id = r.id
    limit 1
  ) db on true
  order by r.name;
$$;

grant execute on function public.get_public_facility_availability_for_date(date)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Booked facility IDs for a SPECIFIC date (fast list)
-- ---------------------------------------------------------------------------
drop function if exists public.get_public_unavailable_facility_ids_for_date(date);

create function public.get_public_unavailable_facility_ids_for_date(p_date date)
returns table (room_id text)
language sql
security definer
set search_path = public
stable
as $$
  -- Whole resort closed that day → every active facility unavailable
  select rc.id as room_id
  from public.room_catalog rc
  where rc.active = true
    and exists (
      select 1
      from public.manager_blocked_dates m
      where m.blocked_date::date = p_date
    )

  union

  select distinct fid as room_id
  from public.bookings b
  cross join lateral public._booking_facility_ids(b) as fid
  where public._booking_blocks_public_availability(b)
    and public._booking_occupies_date(b, p_date)
    and fid is not null
    and fid <> ''
    and not exists (
      select 1
      from public.manager_blocked_dates m
      where m.blocked_date::date = p_date
    );
$$;

grant execute on function public.get_public_unavailable_facility_ids_for_date(date)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Unavailable dates for a SPECIFIC facility (range)
-- ---------------------------------------------------------------------------
drop function if exists public.get_public_unavailable_dates_for_facility(text, date, date);

create function public.get_public_unavailable_dates_for_facility(
  p_room_id text,
  p_from date default current_date,
  p_to date default (current_date + 180)
)
returns table (
  unavailable_date date,
  reason text  -- 'booked' | 'blocked'
)
language sql
security definer
set search_path = public
stable
as $$
  -- Manager-blocked nights
  select m.blocked_date::date as unavailable_date, 'blocked'::text as reason
  from public.manager_blocked_dates m
  where m.blocked_date::date between p_from and p_to

  union

  -- Nights occupied by a blocking booking for this facility (all selected facilities)
  select d::date as unavailable_date, 'booked'::text as reason
  from public.bookings b
  cross join lateral public._booking_facility_ids(b) as fid
  cross join lateral generate_series(
    b.check_in::date,
    public._booking_last_occupied_date(b),
    interval '1 day'
  ) as d
  where public._booking_blocks_public_availability(b)
    and fid = p_room_id
    and d::date between p_from and p_to;
$$;

grant execute on function public.get_public_unavailable_dates_for_facility(text, date, date)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Calendar snapshot for a date range (month / public calendar)
-- ---------------------------------------------------------------------------
drop function if exists public.get_public_availability_snapshot(date, date);

create function public.get_public_availability_snapshot(
  p_from date default current_date,
  p_to date default (current_date + 90)
)
returns table (
  day date,
  status text,           -- available | fully_booked | blocked
  booked_count int,
  total_facilities int,
  booked_room_ids text[],
  pending_room_ids text[]
)
language sql
security definer
set search_path = public
stable
as $$
  with days as (
    select generate_series(p_from, p_to, interval '1 day')::date as day
  ),
  totals as (
    select count(*)::int as total_facilities
    from public.room_catalog
    where active = true
  ),
  blocked as (
    select m.blocked_date::date as day
    from public.manager_blocked_dates m
    where m.blocked_date::date between p_from and p_to
  ),
  booked as (
    select
      d::date as day,
      fid as room_id,
      public._booking_calendar_payment_verified(b) as payment_verified
    from public.bookings b
    cross join lateral public._booking_facility_ids(b) as fid
    cross join lateral generate_series(
      b.check_in::date,
      public._booking_last_occupied_date(b),
      interval '1 day'
    ) as d
    where public._booking_blocks_public_availability(b)
      and d::date between p_from and p_to
      and fid is not null
      and exists (
        select 1
        from public.room_catalog rc
        where rc.id = fid
          and rc.active = true
      )
  ),
  facility_day as (
    select
      day,
      room_id,
      bool_and(payment_verified) as payment_verified
    from booked
    group by day, room_id
  ),
  booked_agg as (
    select
      day,
      count(*)::int as booked_count,
      array_agg(room_id order by room_id) as booked_room_ids,
      coalesce(
        array_agg(room_id order by room_id) filter (where not payment_verified),
        '{}'::text[]
      ) as pending_room_ids
    from facility_day
    group by day
  )
  select
    d.day,
    case
      when bl.day is not null then 'blocked'
      when coalesce(ba.booked_count, 0) <= 0 then 'available'
      when coalesce(ba.booked_count, 0) >= t.total_facilities
        and t.total_facilities > 0 then 'fully_booked'
      else 'available'
    end as status,
    coalesce(ba.booked_count, 0) as booked_count,
    t.total_facilities,
    coalesce(ba.booked_room_ids, '{}'::text[]) as booked_room_ids,
    coalesce(ba.pending_room_ids, '{}'::text[]) as pending_room_ids
  from days d
  cross join totals t
  left join blocked bl on bl.day = d.day
  left join booked_agg ba on ba.day = d.day
  order by d.day;
$$;

grant execute on function public.get_public_availability_snapshot(date, date)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Realtime bump — anonymous clients subscribe to availability_version
-- ---------------------------------------------------------------------------
create table if not exists public.availability_version (
  id int primary key default 1,
  updated_at timestamptz not null default now()
);

insert into public.availability_version (id, updated_at)
values (1, now())
on conflict (id) do nothing;

alter table public.availability_version enable row level security;

drop policy if exists "availability_version_public_read" on public.availability_version;
create policy "availability_version_public_read" on public.availability_version
  for select using (true);

create or replace function public.bump_availability_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.availability_version
  set updated_at = now()
  where id = 1;
  return coalesce(new, old);
end;
$$;

drop trigger if exists bookings_bump_availability on public.bookings;
create trigger bookings_bump_availability
  after insert or update or delete on public.bookings
  for each row execute function public.bump_availability_version();

drop trigger if exists blocked_dates_bump_availability on public.manager_blocked_dates;
create trigger blocked_dates_bump_availability
  after insert or update or delete on public.manager_blocked_dates
  for each row execute function public.bump_availability_version();

drop trigger if exists room_catalog_bump_availability on public.room_catalog;
create trigger room_catalog_bump_availability
  after insert or update or delete on public.room_catalog
  for each row execute function public.bump_availability_version();

do $$
begin
  alter publication supabase_realtime add table public.availability_version;
exception
  when duplicate_object then null;
  when others then null;
end $$;

-- Staff portals (Reception / Admin / Manager) need live booking row changes
do $$
begin
  alter publication supabase_realtime add table public.bookings;
exception
  when duplicate_object then null;
  when others then null;
end $$;

-- Optional: force one bump so clients refresh after this migration
update public.availability_version set updated_at = now() where id = 1;

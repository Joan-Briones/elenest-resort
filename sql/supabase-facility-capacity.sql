-- =============================================================================
-- Facility capacity + multi-facility availability
-- Re-run in Supabase Dashboard → SQL Editor (safe to re-run).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Capacity columns on room_catalog
-- ---------------------------------------------------------------------------
alter table public.room_catalog
  add column if not exists capacity int;

alter table public.room_catalog
  add column if not exists capacity_min int;

comment on column public.room_catalog.capacity is
  'Maximum guest capacity (pax). Halls use capacity_min..capacity range.';
comment on column public.room_catalog.capacity_min is
  'Minimum suggested capacity for halls (e.g. 60). Null for rooms/cottages.';

-- Backfill defaults when capacity is missing
update public.room_catalog
set capacity = case
  when type = 'cottage' then 20
  when type = 'hall' then 150
  when type = 'room' and lower(coalesce(room_kind, '')) = 'big' then 15
  when type = 'room' then 4
  else coalesce(capacity, 4)
end
where capacity is null or capacity <= 0;

update public.room_catalog
set capacity_min = 60
where type = 'hall' and (capacity_min is null or capacity_min <= 0);

update public.room_catalog
set capacity_min = null
where type <> 'hall';

-- ---------------------------------------------------------------------------
-- 2. All facility IDs occupied by a booking (supports multi-facility)
-- ---------------------------------------------------------------------------
create or replace function public._booking_facility_ids(b public.bookings)
returns setof text
language sql
stable
set search_path = public
as $$
  -- Explicit room_ids / facilityIds arrays (website multi-select).
  -- Always UNION both — never treat as exclusive CASE/WHEN.
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

  -- Multiple rooms
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

  -- Single room (legacy)
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

  -- Cottages
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

  -- Multiple halls
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

  -- Single hall (legacy)
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

  -- Mobile / legacy primary room_id (without calling _booking_room_id — avoid recursion)
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

-- Single-id helper: first facility id (mobile / legacy compatibility)
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

-- ---------------------------------------------------------------------------
-- 3. Public availability bookings — include all room_ids
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
  notes text
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
    coalesce(
      (
        select string_agg(line, E'\n')
        from unnest(string_to_array(coalesce(b.payload ->> 'notes', ''), E'\n')) as line
        where line ~ '^__\w+__:'
      ),
      ''
    ) as notes
  from public.bookings b
  where public._booking_blocks_public_availability(b);
$$;

grant execute on function public.get_public_availability_bookings() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Facility availability for a date — mark ALL selected facilities
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
-- 5. Unavailable facility IDs for a date
-- ---------------------------------------------------------------------------
drop function if exists public.get_public_unavailable_facility_ids_for_date(date);

create function public.get_public_unavailable_facility_ids_for_date(p_date date)
returns table (room_id text)
language sql
security definer
set search_path = public
stable
as $$
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
-- 6. Unavailable dates for a specific facility
-- ---------------------------------------------------------------------------
drop function if exists public.get_public_unavailable_dates_for_facility(text, date, date);

create function public.get_public_unavailable_dates_for_facility(
  p_room_id text,
  p_from date default current_date,
  p_to date default (current_date + 180)
)
returns table (
  unavailable_date date,
  reason text
)
language sql
security definer
set search_path = public
stable
as $$
  select m.blocked_date::date as unavailable_date, 'blocked'::text as reason
  from public.manager_blocked_dates m
  where m.blocked_date::date between p_from and p_to

  union

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
-- 7. Calendar snapshot — count all occupied facilities
-- ---------------------------------------------------------------------------
drop function if exists public.get_public_availability_snapshot(date, date);

create function public.get_public_availability_snapshot(
  p_from date default current_date,
  p_to date default (current_date + 90)
)
returns table (
  day date,
  status text,
  booked_count int,
  total_facilities int,
  booked_room_ids text[]
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
      fid as room_id
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
  booked_agg as (
    select
      day,
      count(distinct room_id)::int as booked_count,
      array_agg(distinct room_id order by room_id) as booked_room_ids
    from booked
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
    coalesce(ba.booked_room_ids, '{}'::text[]) as booked_room_ids
  from days d
  cross join totals t
  left join blocked bl on bl.day = d.day
  left join booked_agg ba on ba.day = d.day
  order by d.day;
$$;

grant execute on function public.get_public_availability_snapshot(date, date)
  to anon, authenticated;

-- Bump so clients refresh after migration
update public.availability_version set updated_at = now() where id = 1;

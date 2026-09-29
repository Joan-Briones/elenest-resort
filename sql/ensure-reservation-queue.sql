-- Reservation Queue — request timestamp, room hold, and conflict order.
-- Run once in Supabase → SQL Editor (safe to re-run).
-- Does not change payment verification, payment timers, or payment settings.

alter table public.bookings add column if not exists requested_at timestamptz;
alter table public.bookings add column if not exists queue_role text not null default '';
alter table public.bookings add column if not exists queue_position integer;
alter table public.bookings add column if not exists queue_message text not null default '';
alter table public.bookings add column if not exists queue_room_id text not null default '';
alter table public.bookings add column if not exists queue_cluster_id text not null default '';

create index if not exists bookings_requested_at_idx on public.bookings (requested_at);
create index if not exists bookings_queue_room_idx on public.bookings (queue_room_id);

-- ---------------------------------------------------------------------------
-- Time and overlap helpers
-- ---------------------------------------------------------------------------
create or replace function public.elenest_time_to_minutes(p_raw text)
returns int
language plpgsql
immutable
as $$
declare
  s text := trim(coalesce(p_raw, ''));
  m text[];
  h int;
  mi int;
  ap text;
begin
  if s = '' then
    return null;
  end if;

  m := regexp_match(s, '^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(AM|PM)$', 'i');
  if m is not null then
    h := m[1]::int;
    mi := coalesce(nullif(m[2], ''), '0')::int;
    ap := upper(m[4]);
    if ap = 'PM' and h < 12 then
      h := h + 12;
    end if;
    if ap = 'AM' and h = 12 then
      h := 0;
    end if;
    return h * 60 + mi;
  end if;

  m := regexp_match(s, '^(\d{1,2}):(\d{2})');
  if m is not null then
    return m[1]::int * 60 + m[2]::int;
  end if;

  return null;
end;
$$;

create or replace function public.elenest_booking_room_id(p_queue_room_id text, p_payload jsonb)
returns text
language sql
stable
as $$
  select lower(trim(coalesce(
    nullif(trim(coalesce(p_payload->>'room_id', '')), ''),
    nullif(trim(coalesce(p_payload->>'roomCatalogId', '')), ''),
    nullif(trim(coalesce(p_payload->'roomCatalogIds'->>0, '')), ''),
    nullif(trim(coalesce(p_queue_room_id, '')), ''),
    ''
  )));
$$;

create or replace function public.elenest_schedules_overlap(
  a_in date,
  a_out date,
  a_tin text,
  a_tout text,
  b_in date,
  b_out date,
  b_tin text,
  b_tout text
) returns boolean
language plpgsql
immutable
as $$
declare
  a_in_min int;
  a_out_min int;
  b_in_min int;
  b_out_min int;
  a_start timestamp;
  a_end timestamp;
  b_start timestamp;
  b_end timestamp;
begin
  if a_in is null or a_out is null or b_in is null or b_out is null then
    return false;
  end if;
  if a_in >= a_out or b_in >= b_out then
    return false;
  end if;

  a_in_min := public.elenest_time_to_minutes(a_tin);
  a_out_min := public.elenest_time_to_minutes(a_tout);
  b_in_min := public.elenest_time_to_minutes(b_tin);
  b_out_min := public.elenest_time_to_minutes(b_tout);

  -- Same reservation date with clock times that both sit on that day.
  if a_in = b_in
     and a_out = a_in + 1
     and b_out = b_in + 1
     and a_in_min is not null and a_out_min is not null
     and b_in_min is not null and b_out_min is not null
     and a_out_min > a_in_min
     and b_out_min > b_in_min
  then
    return a_in_min < b_out_min and b_in_min < a_out_min;
  end if;

  if a_in_min is null then a_in_min := 0; end if;
  if b_in_min is null then b_in_min := 0; end if;
  if a_out_min is null then a_out_min := 0; end if;
  if b_out_min is null then b_out_min := 0; end if;

  a_start := a_in::timestamp + make_interval(mins => a_in_min);
  a_end := a_out::timestamp + make_interval(mins => a_out_min);
  b_start := b_in::timestamp + make_interval(mins => b_in_min);
  b_end := b_out::timestamp + make_interval(mins => b_out_min);

  if a_end <= a_start then
    a_end := a_end + interval '1 day';
  end if;
  if b_end <= b_start then
    b_end := b_end + interval '1 day';
  end if;

  return a_start < b_end and b_start < a_end;
end;
$$;

create or replace function public.elenest_booking_ids_overlap(p_a text, p_b text)
returns boolean
language sql
stable
as $$
  select public.elenest_schedules_overlap(
    a.check_in,
    a.check_out,
    coalesce(a.payload->>'checkInTime', a.payload->>'check_in_time', ''),
    coalesce(a.payload->>'checkOutTime', a.payload->>'check_out_time', ''),
    b.check_in,
    b.check_out,
    coalesce(b.payload->>'checkInTime', b.payload->>'check_in_time', ''),
    coalesce(b.payload->>'checkOutTime', b.payload->>'check_out_time', '')
  )
  from public.bookings a
  join public.bookings b on b.id = p_b
  where a.id = p_a;
$$;

create or replace function public.elenest_queue_is_confirmed(p_status text, p_hold timestamptz)
returns boolean
language sql
stable
as $$
  select case
    when lower(trim(coalesce(p_status, ''))) in (
      'checked in', 'checked_in', 'checked out', 'checked_out', 'completed'
    ) then true
    when lower(trim(coalesce(p_status, ''))) in ('confirmed', 'approved', 'active') then true
    when lower(trim(coalesce(p_status, ''))) = 'reserved'
      and (p_hold is null or p_hold >= clock_timestamp()) then true
    else false
  end;
$$;

create or replace function public.elenest_queue_is_released(p_status text, p_hold timestamptz)
returns boolean
language sql
stable
as $$
  select
    lower(trim(coalesce(p_status, ''))) in (
      'cancelled', 'canceled', 'rejected', 'no show', 'no_show', 'noshow'
    )
    or (
      p_hold is not null
      and p_hold < clock_timestamp()
      and not public.elenest_queue_is_confirmed(p_status, p_hold)
    );
$$;

create or replace function public.elenest_queue_rank(p_role text)
returns int
language sql
immutable
as $$
  select case lower(coalesce(p_role, ''))
    when 'unavailable' then 4
    when 'queued' then 3
    when 'next' then 2
    when 'hold' then 1
    when 'confirmed' then 1
    else 0
  end;
$$;

-- Copies the strongest room-conflict notice onto the customer-facing booking.
create or replace function public.elenest_sync_guest_queue_notice(p_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
  v_group text;
  v_best_role text := '';
  v_best_msg text := '';
  v_best_rank int := 0;
  r record;
  v_rank int;
begin
  select payload into v_payload from public.bookings where id = p_id;
  if v_payload is null then
    return;
  end if;

  v_group := coalesce(nullif(v_payload->>'bookingGroupId', ''), p_id);

  for r in
    select queue_role, queue_message
    from public.bookings
    where id = v_group
       or coalesce(payload->>'bookingGroupId', '') = v_group
  loop
    v_rank := public.elenest_queue_rank(r.queue_role);
    if v_rank > v_best_rank then
      v_best_rank := v_rank;
      v_best_role := coalesce(r.queue_role, '');
      v_best_msg := coalesce(r.queue_message, '');
    end if;
  end loop;

  if v_best_rank < 2 then
    v_best_role := '';
    v_best_msg := '';
  end if;

  update public.bookings
  set payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
    'guestQueueRole', v_best_role,
    'guestQueueMessage', v_best_msg
  )
  where id = v_group;
end;
$$;

-- ---------------------------------------------------------------------------
-- Rebuild one room's conflict groups from requested_at. Never edits that timestamp.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_reservation_queue_room(p_room text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room text := lower(trim(coalesce(p_room, '')));
  v_all text[];
  v_visited text[] := '{}';
  v_comp text[];
  v_frontier text[];
  v_next text[];
  v_ordered text[];
  v_cursor text;
  v_other text;
  v_holder text;
  v_cluster text;
  v_pos int;
  v_id text;
  v_status text;
  v_hold timestamptz;
  v_role text;
  v_msg text;
  v_released boolean;
  v_confirmed boolean;
  v_holder_confirmed boolean;
  v_holder_is_first boolean;
begin
  if v_room = '' then
    return;
  end if;
  if current_setting('elenest.queue_refresh', true) = '1' then
    return;
  end if;

  perform set_config('elenest.queue_refresh', '1', true);
  perform pg_advisory_xact_lock(hashtextextended(v_room, 0));

  perform 1
  from public.bookings b
  where b.id not like 'past-%'
    and public.elenest_booking_room_id(b.queue_room_id, b.payload) = v_room
  for update;

  select coalesce(array_agg(b.id order by b.requested_at nulls last, b.id), '{}')
  into v_all
  from public.bookings b
  where b.id not like 'past-%'
    and public.elenest_booking_room_id(b.queue_room_id, b.payload) = v_room;

  if v_all is null or cardinality(v_all) = 0 then
    perform set_config('elenest.queue_refresh', '0', true);
    return;
  end if;

  foreach v_cursor in array v_all loop
    if v_cursor = any(v_visited) then
      continue;
    end if;

    v_comp := array[v_cursor];
    v_frontier := array[v_cursor];

    loop
      v_next := '{}';
      foreach v_other in array v_all loop
        if v_other = any(v_comp) then
          continue;
        end if;
        if exists (
          select 1
          from unnest(v_frontier) as f(id)
          where public.elenest_booking_ids_overlap(f.id, v_other)
        ) then
          v_next := v_next || v_other;
          v_comp := v_comp || v_other;
        end if;
      end loop;
      exit when v_next is null or cardinality(v_next) = 0;
      v_frontier := v_next;
    end loop;

    v_visited := v_visited || v_comp;

    if cardinality(v_comp) < 2 then
      update public.bookings
      set
        queue_role = '',
        queue_position = null,
        queue_message = '',
        queue_cluster_id = '',
        queue_room_id = v_room
      where id = any(v_comp);

      foreach v_id in array v_comp loop
        perform public.elenest_sync_guest_queue_notice(v_id);
      end loop;
      continue;
    end if;

    select coalesce(array_agg(b.id order by b.requested_at asc nulls last, b.id asc), '{}')
    into v_ordered
    from public.bookings b
    where b.id = any(v_comp);

    v_cluster := v_ordered[1];
    v_holder := null;
    v_holder_confirmed := false;

    foreach v_id in array v_ordered loop
      select b.status, b.hold_expires_at
      into v_status, v_hold
      from public.bookings b
      where b.id = v_id;

      if not public.elenest_queue_is_released(v_status, v_hold) then
        v_holder := v_id;
        v_holder_confirmed := public.elenest_queue_is_confirmed(v_status, v_hold);
        exit;
      end if;
    end loop;

    v_holder_is_first := v_holder is not null and v_holder = v_ordered[1];
    v_pos := 0;

    foreach v_id in array v_ordered loop
      v_pos := v_pos + 1;
      select b.status, b.hold_expires_at
      into v_status, v_hold
      from public.bookings b
      where b.id = v_id;

      v_released := public.elenest_queue_is_released(v_status, v_hold);
      v_confirmed := public.elenest_queue_is_confirmed(v_status, v_hold);

      if v_holder is not null and v_id = v_holder and v_holder_confirmed then
        v_role := 'confirmed';
        v_msg := 'Confirmed — this request keeps the room';
      elsif v_holder is not null and v_id = v_holder and v_holder_is_first then
        v_role := 'hold';
        v_msg := 'Active room hold — review this request';
      elsif v_holder is not null and v_id = v_holder then
        v_role := 'next';
        v_msg := 'Next in Queue – Room Available for Review';
      elsif v_released then
        v_role := 'released';
        if v_hold is not null
           and v_hold < clock_timestamp()
           and lower(trim(coalesce(v_status, ''))) not in (
             'cancelled', 'canceled', 'rejected', 'no show', 'no_show', 'noshow'
           )
        then
          v_msg := 'Hold expired — room released to the next request';
        else
          v_msg := 'Released — room returned to the queue';
        end if;
      elsif v_holder_confirmed then
        v_role := 'unavailable';
        v_msg := 'Room Unavailable – Select Another Room';
      else
        v_role := 'queued';
        v_msg := 'This room is currently reserved by an earlier request. Please wait for room availability or select another room.';
      end if;

      update public.bookings
      set
        queue_role = v_role,
        queue_position = v_pos,
        queue_message = v_msg,
        queue_room_id = v_room,
        queue_cluster_id = v_cluster,
        payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
          'requestedAt', requested_at,
          'queueRole', v_role,
          'queuePosition', v_pos,
          'queueMessage', v_msg,
          'queueRoomId', v_room
        )
      where id = v_id;
    end loop;

    foreach v_id in array v_ordered loop
      perform public.elenest_sync_guest_queue_notice(v_id);
    end loop;
  end loop;

  perform set_config('elenest.queue_refresh', '0', true);
exception
  when others then
    perform set_config('elenest.queue_refresh', '0', true);
    raise;
end;
$$;

-- ---------------------------------------------------------------------------
-- Stamp the server time once. Later updates cannot change it.
-- ---------------------------------------------------------------------------
create or replace function public.elenest_reservation_queue_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.requested_at := clock_timestamp();
    new.queue_room_id := public.elenest_booking_room_id('', new.payload);
    return new;
  end if;

  if old.requested_at is not null then
    new.requested_at := old.requested_at;
  elsif new.requested_at is null then
    new.requested_at := coalesce(old.submitted_at, old.created_at, clock_timestamp());
  end if;

  new.queue_room_id := public.elenest_booking_room_id('', new.payload);
  return new;
end;
$$;

create or replace function public.elenest_reservation_queue_on_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room text;
  v_prev text;
begin
  if current_setting('elenest.queue_refresh', true) = '1' then
    return null;
  end if;
  if new.id like 'past-%' then
    return null;
  end if;

  begin
    v_room := public.elenest_booking_room_id(new.queue_room_id, new.payload);
    if tg_op = 'UPDATE' then
      v_prev := public.elenest_booking_room_id(old.queue_room_id, old.payload);
      if v_prev <> '' and v_prev is distinct from v_room then
        perform public.refresh_reservation_queue_room(v_prev);
      end if;
    end if;

    if v_room <> '' then
      perform public.refresh_reservation_queue_room(v_room);
    end if;
  exception
    when others then
      raise warning 'elenest reservation queue: %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists trg_bookings_queue_stamp on public.bookings;
create trigger trg_bookings_queue_stamp
  before insert or update on public.bookings
  for each row
  execute procedure public.elenest_reservation_queue_stamp();

drop trigger if exists trg_bookings_queue_refresh on public.bookings;
create trigger trg_bookings_queue_refresh
  after insert or update of status, hold_expires_at, check_in, check_out, payload
  on public.bookings
  for each row
  execute procedure public.elenest_reservation_queue_on_write();

-- Existing requests keep the time they were already stored. New requests use clock_timestamp().
update public.bookings
set requested_at = coalesce(submitted_at, created_at, clock_timestamp())
where requested_at is null
  and id not like 'past-%';

create or replace function public.list_reservation_queue()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not public.is_staff() then
    raise exception 'not allowed';
  end if;

  -- Read the queue only. Rebuilding every room here locked the admin page
  -- on "Checking room conflicts…" and retriggered itself after each save.
  select coalesce(jsonb_agg(to_jsonb(q) order by q.requested_at, q.id), '[]'::jsonb)
  into v_result
  from (
    select
      b.id,
      coalesce(nullif(b.full_name, ''), b.payload->>'fullName', '') as full_name,
      b.user_email,
      b.status,
      b.requested_at,
      b.queue_position,
      b.queue_role,
      b.queue_message,
      b.queue_room_id,
      b.queue_cluster_id,
      b.check_in,
      b.check_out,
      coalesce(b.payload->>'checkInTime', b.payload->>'check_in_time', '') as check_in_time,
      coalesce(b.payload->>'checkOutTime', b.payload->>'check_out_time', '') as check_out_time,
      coalesce(
        nullif(b.payload->>'roomCatalogName', ''),
        nullif(b.queue_room_id, ''),
        'Room'
      ) as room_label
    from public.bookings b
    where coalesce(b.queue_position, 0) > 0
      and b.id not like 'past-%'
  ) q;

  return v_result;
end;
$$;

revoke all on function public.list_reservation_queue() from public;
grant execute on function public.list_reservation_queue() to authenticated;

-- Pending and confirmed stays both block a room so a guest cannot book over them.
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
      lower(coalesce(b.payload ->> 'workflow', '')) in (
        'pending',
        'pending_payment',
        'pending_verification',
        'verified_by_receptionist',
        'approved',
        'confirmed',
        'checked_in',
        'reserved'
      )
      or lower(coalesce(b.status::text, '')) in (
        'pending',
        'for verification',
        'pending payment verification',
        'reserved',
        'confirmed',
        'approved',
        'active',
        'checked in',
        'checked_in'
      )
      or (
        coalesce(nullif(b.payload ->> 'workflow', ''), '') = ''
        and lower(coalesce(b.status::text, 'pending')) not in (
          'cancelled', 'canceled', 'rejected', 'no show', 'no_show', 'noshow',
          'completed', 'checked out', 'checked_out', 'checked-out'
        )
      )
    )
    and coalesce(nullif(b.payload ->> 'paymentRejectedAt', ''), '') = ''
    and coalesce(nullif(b.payload ->> 'payment_rejected_at', ''), '') = '';
$$;

notify pgrst, 'reload schema';

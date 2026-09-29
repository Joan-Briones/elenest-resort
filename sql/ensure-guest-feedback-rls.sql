-- Fix guest_feedback RLS + post-stay review invite flow.
-- Run in Supabase SQL Editor, then hard-refresh the site (Ctrl+F5).

alter table public.guest_feedback enable row level security;

-- Helper: booking is eligible for review after checkout / completion
create or replace function public.booking_is_review_eligible(p_booking_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_status text;
  v_payload jsonb;
  v_payload_status text;
begin
  if nullif(trim(coalesce(p_booking_id, '')), '') is null then
    return false;
  end if;

  select
    lower(trim(coalesce(b.status, ''))),
    coalesce(b.payload, '{}'::jsonb)
  into v_status, v_payload
  from public.bookings b
  where b.id = trim(p_booking_id)
  limit 1;

  if not found then
    return false;
  end if;

  v_payload_status := lower(trim(coalesce(v_payload->>'status', '')));

  if v_status in ('checked out', 'completed', 'checked_out') then
    return true;
  end if;
  if v_payload_status in ('checked out', 'completed', 'checked_out') then
    return true;
  end if;
  if coalesce(nullif(v_payload->>'checkedOutAt', ''), nullif(v_payload->>'checked_out_at', '')) is not null then
    return true;
  end if;
  if lower(trim(coalesce(v_payload->>'workflow', ''))) in ('checked_out', 'completed') then
    return true;
  end if;

  return false;
end;
$$;

revoke all on function public.booking_is_review_eligible(text) from public;
grant execute on function public.booking_is_review_eligible(text) to anon, authenticated;

-- Drop old / conflicting insert policies
drop policy if exists "Public read feedback" on public.guest_feedback;
drop policy if exists "Guests insert feedback" on public.guest_feedback;
drop policy if exists "Anyone can insert feedback" on public.guest_feedback;
drop policy if exists "Staff manage feedback" on public.guest_feedback;
drop policy if exists "guest_feedback_select_public" on public.guest_feedback;
drop policy if exists "guest_feedback_insert_public" on public.guest_feedback;
drop policy if exists "guest_feedback_staff_all" on public.guest_feedback;

-- Public can read reviews (Reviews page + sentiment)
create policy "guest_feedback_select_public"
  on public.guest_feedback
  for select
  to anon, authenticated
  using (true);

-- Inserts only for completed / checked-out bookings
create policy "guest_feedback_insert_public"
  on public.guest_feedback
  for insert
  to anon, authenticated
  with check (
    guest_email is not null
    and length(trim(guest_email)) > 3
    and position('@' in guest_email) > 1
    and stars between 1 and 5
    and length(trim(coalesce(comment, ''))) > 0
    and booking_id is not null
    and length(trim(booking_id)) > 0
    and public.booking_is_review_eligible(booking_id)
  );

-- Staff can manage all rows
create policy "guest_feedback_staff_all"
  on public.guest_feedback
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

grant select, insert on public.guest_feedback to anon, authenticated;
grant select, insert, update, delete on public.guest_feedback to authenticated;

-- Full name on the booking record (column, payload, or linked profile).
-- Returns null when no real name is stored so callers can keep a non-placeholder label.
create or replace function public.booking_guest_display_name(p_booking_id text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id text := trim(coalesce(p_booking_id, ''));
  v_name text;
  v_payload jsonb;
  v_user uuid;
  v_email text;
begin
  if v_id = '' then
    return null;
  end if;

  select
    nullif(trim(b.full_name), ''),
    coalesce(b.payload, '{}'::jsonb),
    b.user_id,
    lower(trim(coalesce(b.user_email, '')))
  into v_name, v_payload, v_user, v_email
  from public.bookings b
  where b.id = v_id
  limit 1;

  if not found then
    return null;
  end if;

  if v_name is null or lower(v_name) = 'guest' then
    v_name := nullif(trim(coalesce(
      v_payload->>'fullName',
      v_payload->>'full_name',
      v_payload->>'name',
      v_payload->>'guestName',
      v_payload->>'guest_name',
      ''
    )), '');
  end if;

  if v_name is null or lower(v_name) = 'guest' then
    v_name := nullif(trim(concat_ws(' ',
      nullif(trim(coalesce(v_payload->>'firstName', v_payload->>'first_name', '')), ''),
      nullif(trim(coalesce(v_payload->>'lastName', v_payload->>'last_name', '')), '')
    )), '');
  end if;

  if (v_name is null or lower(v_name) = 'guest') and v_user is not null then
    select nullif(trim(p.name), '')
    into v_name
    from public.profiles p
    where p.id = v_user
    limit 1;
  end if;

  if (v_name is null or lower(v_name) = 'guest') and v_email <> '' then
    select nullif(trim(p.name), '')
    into v_name
    from public.profiles p
    where lower(p.email) = v_email
      and nullif(trim(p.name), '') is not null
      and lower(trim(p.name)) <> 'guest'
    limit 1;
  end if;

  if v_name is null or lower(trim(v_name)) = 'guest' then
    return null;
  end if;

  return trim(v_name);
end;
$$;

revoke all on function public.booking_guest_display_name(text) from public;
grant execute on function public.booking_guest_display_name(text) to anon, authenticated;

-- Context for the post-stay email link (opens the review form for that booking).
create or replace function public.get_review_invite_context(
  p_booking_id text,
  p_email text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_booking text := trim(coalesce(p_booking_id, ''));
  v_email text := lower(trim(coalesce(p_email, '')));
  v_name text;
  v_booking_email text;
  v_payload jsonb;
  v_exists boolean := false;
begin
  if v_booking = '' then
    return jsonb_build_object(
      'ok', false,
      'eligible', false,
      'message', 'Missing booking reference.'
    );
  end if;

  select
    true,
    lower(trim(coalesce(b.user_email, ''))),
    coalesce(b.payload, '{}'::jsonb)
  into v_exists, v_booking_email, v_payload
  from public.bookings b
  where b.id = v_booking
  limit 1;

  if not coalesce(v_exists, false) then
    return jsonb_build_object(
      'ok', false,
      'eligible', false,
      'message', 'We could not find this booking.'
    );
  end if;

  if v_booking_email = '' then
    v_booking_email := lower(trim(coalesce(
      v_payload->>'email',
      v_payload->>'userEmail',
      v_payload->>'accountEmail',
      ''
    )));
  end if;

  -- The booking id in the email is the source of truth. A differing address
  -- still opens this stay; the form uses the email stored on the booking.
  if v_email = '' then
    v_email := v_booking_email;
  end if;

  v_name := coalesce(public.booking_guest_display_name(v_booking), 'Guest');

  if exists (
    select 1 from public.guest_feedback f where f.booking_id = v_booking
  ) then
    return jsonb_build_object(
      'ok', true,
      'eligible', false,
      'already_reviewed', true,
      'name', v_name,
      'email', coalesce(nullif(v_email, ''), v_booking_email),
      'message', 'A review was already submitted for this stay.'
    );
  end if;

  if not public.booking_is_review_eligible(v_booking) then
    return jsonb_build_object(
      'ok', true,
      'eligible', false,
      'already_reviewed', false,
      'name', v_name,
      'email', coalesce(nullif(v_email, ''), v_booking_email),
      'message', 'Reviews are only available after checkout or when your booking is completed.'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'eligible', true,
    'already_reviewed', false,
    'name', v_name,
    'email', coalesce(nullif(v_email, ''), v_booking_email),
    'booking_id', v_booking
  );
end;
$$;

revoke all on function public.get_review_invite_context(text, text) from public;
grant execute on function public.get_review_invite_context(text, text) to anon, authenticated;

-- RPC submit: requires completed/checked-out booking
create or replace function public.submit_guest_feedback(
  p_id text,
  p_guest_name text,
  p_guest_email text,
  p_booking_id text,
  p_stars int,
  p_comment text,
  p_photo_url text,
  p_sentiment_week_key text default null
)
returns public.guest_feedback
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.guest_feedback;
  v_id text := trim(coalesce(p_id, ''));
  v_email text := lower(trim(coalesce(p_guest_email, '')));
  v_name text := trim(coalesce(p_guest_name, ''));
  v_comment text := trim(coalesce(p_comment, ''));
  v_booking text := nullif(trim(coalesce(p_booking_id, '')), '');
  v_stars int := coalesce(p_stars, 0);
  v_week text := nullif(trim(coalesce(p_sentiment_week_key, '')), '');
  v_user uuid := auth.uid();
  v_booking_email text;
  v_payload jsonb := '{}'::jsonb;
  v_booking_name text;
begin
  if v_booking is null then
    raise exception 'A completed booking reference is required to submit a review';
  end if;
  if v_email = '' or position('@' in v_email) = 0 then
    raise exception 'A valid email is required';
  end if;
  if v_comment = '' then
    raise exception 'Comment is required';
  end if;
  if v_stars < 1 or v_stars > 5 then
    raise exception 'Stars must be between 1 and 5';
  end if;
  if v_id = '' then
    v_id := 'fb-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
  end if;

  select
    lower(trim(coalesce(b.user_email, ''))),
    coalesce(b.payload, '{}'::jsonb)
  into v_booking_email, v_payload
  from public.bookings b
  where b.id = v_booking
  limit 1;

  if v_booking_email is null then
    raise exception 'We could not find this booking';
  end if;

  if v_booking_email = '' then
    v_booking_email := lower(trim(coalesce(
      v_payload->>'email',
      v_payload->>'userEmail',
      v_payload->>'accountEmail',
      ''
    )));
  end if;

  -- Keep the review attached to the booking even if the link email differs slightly.
  if v_booking_email <> '' and v_email <> v_booking_email then
    v_email := v_booking_email;
  end if;

  v_booking_name := public.booking_guest_display_name(v_booking);
  if v_booking_name is not null then
    v_name := v_booking_name;
  elsif v_name = '' or lower(v_name) = 'guest' then
    v_name := 'Guest';
  end if;

  if not public.booking_is_review_eligible(v_booking) then
    raise exception 'Reviews are only available after checkout or when your booking is completed';
  end if;

  if exists (select 1 from public.guest_feedback f where f.booking_id = v_booking) then
    raise exception 'A review was already submitted for this stay';
  end if;

  if v_user is null and v_email <> '' then
    select p.id into v_user
    from public.profiles p
    where lower(p.email) = v_email
    limit 1;
  end if;

  insert into public.guest_feedback (
    id,
    user_id,
    guest_name,
    guest_email,
    booking_id,
    stars,
    comment,
    photo_url,
    sentiment_archived,
    sentiment_week_key
  )
  values (
    v_id,
    v_user,
    v_name,
    v_email,
    v_booking,
    v_stars,
    v_comment,
    coalesce(p_photo_url, ''),
    false,
    v_week
  )
  returning * into v_row;

  return v_row;
exception
  when undefined_column then
    insert into public.guest_feedback (
      id,
      user_id,
      guest_name,
      guest_email,
      booking_id,
      stars,
      comment,
      photo_url
    )
    values (
      v_id,
      v_user,
      v_name,
      v_email,
      v_booking,
      v_stars,
      v_comment,
      coalesce(p_photo_url, '')
    )
    returning * into v_row;
    return v_row;
end;
$$;

revoke all on function public.submit_guest_feedback(text, text, text, text, int, text, text, text) from public;
grant execute on function public.submit_guest_feedback(text, text, text, text, int, text, text, text) to anon, authenticated;

-- Names for public, admin, and manager review lists (booking id → customer full name).
create or replace function public.list_guest_review_names()
returns table (feedback_id text, booking_id text, display_name text)
language sql
stable
security definer
set search_path = public
as $$
  select s.feedback_id, s.booking_id, s.display_name
  from (
    select
      f.id as feedback_id,
      f.booking_id,
      public.booking_guest_display_name(f.booking_id) as display_name
    from public.guest_feedback f
    where coalesce(trim(f.booking_id), '') <> ''
  ) s
  where s.display_name is not null;
$$;

revoke all on function public.list_guest_review_names() from public;
grant execute on function public.list_guest_review_names() to anon, authenticated;

create or replace function public.guest_feedback_apply_booking_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if new.booking_id is null or trim(new.booking_id) = '' then
    return new;
  end if;
  v_name := public.booking_guest_display_name(new.booking_id);
  if v_name is not null and (
    new.guest_name is null
    or trim(new.guest_name) = ''
    or lower(trim(new.guest_name)) = 'guest'
  ) then
    new.guest_name := v_name;
  end if;
  return new;
end;
$$;

drop trigger if exists guest_feedback_apply_booking_name on public.guest_feedback;
create trigger guest_feedback_apply_booking_name
  before insert or update of guest_name, booking_id
  on public.guest_feedback
  for each row
  execute function public.guest_feedback_apply_booking_name();

-- Replace placeholder "Guest" labels with the name stored on the booking.
update public.guest_feedback f
set guest_name = n.display_name
from (
  select
    id,
    public.booking_guest_display_name(booking_id) as display_name
  from public.guest_feedback
  where coalesce(trim(booking_id), '') <> ''
) n
where f.id = n.id
  and n.display_name is not null
  and (
    nullif(trim(f.guest_name), '') is null
    or lower(trim(f.guest_name)) = 'guest'
  );

do $$
begin
  alter publication supabase_realtime add table public.guest_feedback;
exception
  when duplicate_object then null;
  when others then null;
end $$;

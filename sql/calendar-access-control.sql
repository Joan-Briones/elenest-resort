-- =============================================================================
-- CALENDAR ACCESS CONTROL
-- Run in Supabase → SQL Editor after the base schema.
--
-- Owner  = profiles.role 'admin'     → direct block/unblock + approve/reject
-- Manager = profiles.role 'manager'  → request only (reason required)
-- Receptionist                       → view calendar only
--
-- Direct writes to manager_blocked_dates are closed. Official availability
-- changes go through SECURITY DEFINER RPCs so they cannot be bypassed from
-- the browser.
-- =============================================================================

create table if not exists public.calendar_access_requests (
  id                  uuid primary key default gen_random_uuid(),
  requested_date      date not null,
  action              text not null check (action in ('block', 'unblock')),
  reason              text not null,
  status              text not null default 'pending'
                        check (status in ('pending', 'approved', 'rejected')),
  requested_by        uuid not null references public.profiles (id) on delete cascade,
  requested_by_name   text not null default '',
  requested_by_email  text not null default '',
  reviewed_by         uuid references public.profiles (id) on delete set null,
  reviewed_by_name    text not null default '',
  reviewed_by_email   text not null default '',
  reviewed_at         timestamptz,
  created_at          timestamptz not null default now()
);

create index if not exists calendar_access_requests_status_idx
  on public.calendar_access_requests (status, created_at desc);
create index if not exists calendar_access_requests_date_idx
  on public.calendar_access_requests (requested_date);
create index if not exists calendar_access_requests_requester_idx
  on public.calendar_access_requests (requested_by, created_at desc);

drop index if exists calendar_access_requests_pending_date_idx;
create unique index calendar_access_requests_pending_date_idx
  on public.calendar_access_requests (requested_date)
  where status = 'pending';

comment on table public.calendar_access_requests is
  'Manager block/unblock requests. Owner (admin) must approve before official calendar availability changes.';

alter table public.calendar_access_requests enable row level security;

drop policy if exists "Admin read calendar access requests" on public.calendar_access_requests;
drop policy if exists "Manager read own calendar access requests" on public.calendar_access_requests;

create policy "Admin read calendar access requests"
  on public.calendar_access_requests for select
  using (public.is_admin());

create policy "Manager read own calendar access requests"
  on public.calendar_access_requests for select
  using (public.current_user_role() = 'manager' and requested_by = auth.uid());

-- No insert/update/delete policies: mutations only via SECURITY DEFINER RPCs.

-- Official blocked dates: public/staff may read; only RPCs may write.
drop policy if exists "Managers manage blocked dates" on public.manager_blocked_dates;
drop policy if exists "Admin manage blocked dates" on public.manager_blocked_dates;

-- Keep public read so guest calendars stay in sync.
drop policy if exists "Public read blocked dates" on public.manager_blocked_dates;
create policy "Public read blocked dates"
  on public.manager_blocked_dates for select
  using (true);

create or replace function public.calendar_date_is_booked(p_date date)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.bookings b
    where b.check_in is not null
      and b.check_out is not null
      and p_date >= b.check_in
      and p_date < b.check_out
      and lower(coalesce(b.status, '')) not in (
        'cancelled', 'canceled', 'checked out', 'checkout'
      )
  );
$$;

create or replace function public.apply_official_calendar_block(
  p_date date,
  p_blocked boolean,
  p_note text,
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_blocked then
    insert into public.manager_blocked_dates (blocked_date, note, created_by, created_at)
    values (
      p_date,
      coalesce(nullif(trim(p_note), ''), 'Blocked by owner'),
      p_actor,
      now()
    )
    on conflict (blocked_date) do update
      set note = excluded.note,
          created_by = excluded.created_by;
  else
    delete from public.manager_blocked_dates
    where blocked_date = p_date;
  end if;
end;
$$;

revoke all on function public.apply_official_calendar_block(date, boolean, text, uuid) from public, anon, authenticated;

create or replace function public.owner_set_calendar_block(
  p_date date,
  p_blocked boolean,
  p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'You must be signed in.';
  end if;
  if not public.is_admin() then
    raise exception 'Only the Owner can change official calendar availability.';
  end if;
  if p_date is null then
    raise exception 'A date is required.';
  end if;
  if public.calendar_date_is_booked(p_date) then
    raise exception 'This date is booked and cannot be blocked or unblocked.';
  end if;

  perform public.apply_official_calendar_block(
    p_date,
    coalesce(p_blocked, false),
    p_note,
    actor
  );

  update public.calendar_access_requests
  set status = 'rejected',
      reviewed_by = actor,
      reviewed_by_name = coalesce(nullif(trim((select name from public.profiles where id = actor)), ''), 'Owner'),
      reviewed_by_email = coalesce((select lower(email) from public.profiles where id = actor), ''),
      reviewed_at = now()
  where requested_date = p_date
    and status = 'pending';

  return jsonb_build_object(
    'ok', true,
    'date', p_date,
    'blocked', coalesce(p_blocked, false)
  );
end;
$$;

create or replace function public.request_calendar_date_change(
  p_date date,
  p_action text,
  p_reason text
)
returns public.calendar_access_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  actor_role text := public.current_user_role();
  actor_name text := '';
  actor_email text := '';
  action_norm text := lower(trim(coalesce(p_action, '')));
  reason_norm text := trim(coalesce(p_reason, ''));
  currently_blocked boolean := false;
  rec public.calendar_access_requests;
begin
  if actor is null then
    raise exception 'You must be signed in.';
  end if;
  if actor_role <> 'manager' then
    raise exception 'Only a Manager can request calendar block or unblock changes.';
  end if;
  if p_date is null then
    raise exception 'A date is required.';
  end if;
  if action_norm not in ('block', 'unblock') then
    raise exception 'Action must be block or unblock.';
  end if;
  if char_length(reason_norm) < 3 then
    raise exception 'Please provide a reason (at least 3 characters).';
  end if;
  if public.calendar_date_is_booked(p_date) then
    raise exception 'This date is booked and cannot be blocked or unblocked.';
  end if;

  currently_blocked := exists (
    select 1 from public.manager_blocked_dates where blocked_date = p_date
  );
  if action_norm = 'block' and currently_blocked then
    raise exception 'This date is already blocked.';
  end if;
  if action_norm = 'unblock' and not currently_blocked then
    raise exception 'This date is not blocked.';
  end if;

  if exists (
    select 1
    from public.calendar_access_requests r
    where r.requested_date = p_date
      and r.status = 'pending'
  ) then
    raise exception 'A pending request already exists for this date.';
  end if;

  select coalesce(nullif(trim(p.name), ''), split_part(coalesce(p.email, ''), '@', 1), 'Manager'),
         lower(coalesce(p.email, ''))
    into actor_name, actor_email
  from public.profiles p
  where p.id = actor;

  insert into public.calendar_access_requests (
    requested_date,
    action,
    reason,
    status,
    requested_by,
    requested_by_name,
    requested_by_email
  )
  values (
    p_date,
    action_norm,
    reason_norm,
    'pending',
    actor,
    coalesce(actor_name, 'Manager'),
    coalesce(actor_email, '')
  )
  returning * into rec;

  return rec;
end;
$$;

create or replace function public.review_calendar_access_request(
  p_request_id uuid,
  p_approve boolean
)
returns public.calendar_access_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  actor_name text := '';
  actor_email text := '';
  rec public.calendar_access_requests;
begin
  if actor is null then
    raise exception 'You must be signed in.';
  end if;
  if not public.is_admin() then
    raise exception 'Only the Owner can approve or reject calendar requests.';
  end if;

  select *
    into rec
  from public.calendar_access_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Calendar request not found.';
  end if;
  if rec.status <> 'pending' then
    raise exception 'This request has already been reviewed.';
  end if;

  select coalesce(nullif(trim(p.name), ''), split_part(coalesce(p.email, ''), '@', 1), 'Owner'),
         lower(coalesce(p.email, ''))
    into actor_name, actor_email
  from public.profiles p
  where p.id = actor;

  if coalesce(p_approve, false) then
    if public.calendar_date_is_booked(rec.requested_date) then
      raise exception 'This date is booked and cannot be blocked or unblocked.';
    end if;
    perform public.apply_official_calendar_block(
      rec.requested_date,
      rec.action = 'block',
      rec.reason,
      actor
    );
    rec.status := 'approved';
  else
    rec.status := 'rejected';
  end if;

  rec.reviewed_by := actor;
  rec.reviewed_by_name := coalesce(actor_name, 'Owner');
  rec.reviewed_by_email := coalesce(actor_email, '');
  rec.reviewed_at := now();

  update public.calendar_access_requests
  set status = rec.status,
      reviewed_by = rec.reviewed_by,
      reviewed_by_name = rec.reviewed_by_name,
      reviewed_by_email = rec.reviewed_by_email,
      reviewed_at = rec.reviewed_at
  where id = rec.id;

  return rec;
end;
$$;

revoke all on function public.owner_set_calendar_block(date, boolean, text) from public, anon;
revoke all on function public.request_calendar_date_change(date, text, text) from public, anon;
revoke all on function public.review_calendar_access_request(uuid, boolean) from public, anon;
revoke all on function public.calendar_date_is_booked(date) from public, anon;

grant execute on function public.owner_set_calendar_block(date, boolean, text) to authenticated;
grant execute on function public.request_calendar_date_change(date, text, text) to authenticated;
grant execute on function public.review_calendar_access_request(uuid, boolean) to authenticated;
grant execute on function public.calendar_date_is_booked(date) to authenticated;

grant select on public.calendar_access_requests to authenticated;

alter table public.calendar_access_requests replica identity full;

do $$
begin
  begin
    alter publication supabase_realtime add table public.calendar_access_requests;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;
end $$;

notify pgrst, 'reload schema';

-- =============================================================================
-- ELENEST RESORT — COMPLETE DATABASE SCHEMA
-- =============================================================================
-- Run in Supabase Dashboard → SQL Editor → New query
--
-- Covers all app data for:
--   • Customers (guests) — register, book, pay, notifications, feedback
--   • Receptionist — bookings, walk-ins, payment verification
--   • Manager — bookings, content, facilities, policies, calendar blocks, broadcasts
--   • Admin — staff users, payment methods, analytics, sentiment, all of the above
--
-- Auth users live in auth.users (Supabase Auth). Profile rows link via profiles.id.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. HELPER FUNCTIONS (avoid RLS infinite recursion)
-- ---------------------------------------------------------------------------
create or replace function public.current_user_role()
returns text
language sql security definer set search_path = public stable
as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid()),
    'guest'
  );
$$;

create or replace function public.is_staff()
returns boolean
language sql security definer set search_path = public stable
as $$
  select public.current_user_role() in ('admin', 'manager', 'receptionist');
$$;

create or replace function public.is_manager_or_admin()
returns boolean
language sql security definer set search_path = public stable
as $$
  select public.current_user_role() in ('admin', 'manager');
$$;

create or replace function public.is_admin()
returns boolean
language sql security definer set search_path = public stable
as $$
  select public.current_user_role() = 'admin';
$$;

create or replace function public.current_user_email()
returns text
language sql stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

-- ---------------------------------------------------------------------------
-- 2. PROFILES — all users (guest, admin, manager, receptionist)
--    Used by: ALL portals
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  name          text not null default '',
  phone         text not null default '',
  email         text not null default '',
  role          text not null default 'guest'
                  check (role in ('guest', 'admin', 'manager', 'receptionist')),
  gender        text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists profiles_email_idx on public.profiles (lower(email));
create index if not exists profiles_role_idx on public.profiles (role);

comment on table public.profiles is 'User accounts linked to Supabase Auth. Role controls portal access.';

-- ---------------------------------------------------------------------------
-- 3. BOOKINGS — guest & walk-in reservations
--    Used by: Customer (book.html), Reception, Manager, Admin
--    payload = full booking JSON (rooms, cottages, halls, payment proof, etc.)
-- ---------------------------------------------------------------------------
create table if not exists public.bookings (
  id              text primary key,
  user_email      text not null,
  user_id         uuid references public.profiles (id) on delete set null,
  payload         jsonb not null default '{}'::jsonb,
  status          text not null default 'Pending',
  payment_status  text not null default '',
  check_in        date,
  check_out       date,
  full_name       text not null default '',
  phone           text not null default '',
  room_type       text not null default '',
  total_estimate  numeric(12, 2),
  amount_down     numeric(12, 2),
  payment_method  text not null default '',
  submitted_at    timestamptz not null default now(),
  manager_approved_at timestamptz,
  manager_approved_by text,
  payment_verified_at timestamptz,
  payment_verified_by text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Upgrade old bookings table (created before user_id and extra columns existed)
alter table public.bookings add column if not exists user_id uuid references public.profiles (id) on delete set null;
alter table public.bookings add column if not exists payment_status text not null default '';
alter table public.bookings add column if not exists full_name text not null default '';
alter table public.bookings add column if not exists phone text not null default '';
alter table public.bookings add column if not exists room_type text not null default '';
alter table public.bookings add column if not exists total_estimate numeric(12, 2);
alter table public.bookings add column if not exists amount_down numeric(12, 2);
alter table public.bookings add column if not exists payment_method text not null default '';
alter table public.bookings add column if not exists manager_approved_at timestamptz;
alter table public.bookings add column if not exists manager_approved_by text;
alter table public.bookings add column if not exists payment_verified_at timestamptz;
alter table public.bookings add column if not exists payment_verified_by text;

create index if not exists bookings_user_email_idx on public.bookings (user_email);
create index if not exists bookings_user_id_idx on public.bookings (user_id);
create index if not exists bookings_check_in_idx on public.bookings (check_in);
create index if not exists bookings_status_idx on public.bookings (status);
create index if not exists bookings_submitted_at_idx on public.bookings (submitted_at desc);

comment on table public.bookings is 'Reservations. payload holds roomCatalogId, cottageCatalogIds, eventHall, paymentProof, etc.';
comment on column public.bookings.payload is 'Full booking object from the app (JSON).';

-- ---------------------------------------------------------------------------
-- 4. ROOM / FACILITY CATALOG — rooms, cottages, event halls
--    Used by: Customer booking, Manager (edit), Admin (edit), Reception
-- ---------------------------------------------------------------------------
create table if not exists public.room_catalog (
  id            text primary key,
  type          text not null default 'room'
                  check (type in ('room', 'cottage', 'hall')),
  room_kind     text check (room_kind in ('small', 'big', 'couple')),
  name          text not null default '',
  price         numeric(12, 2) not null default 0,
  price_unit    text not null default 'night'
                  check (price_unit in ('night', 'day', 'event', 'hour')),
  image         text not null default '',
  description   text not null default '',
  sort_order    int not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists room_catalog_type_idx on public.room_catalog (type);
create index if not exists room_catalog_active_idx on public.room_catalog (active);

comment on table public.room_catalog is 'Facilities shown on rooms.html and used during booking unit selection.';

-- ---------------------------------------------------------------------------
-- 5. RESORT POLICIES — general & pool rules
--    Used by: Manager (manage), Customer (policies.html)
-- ---------------------------------------------------------------------------
create table if not exists public.policies (
  id            text primary key,
  kind          text not null default 'general'
                  check (kind in ('general', 'pool')),
  title         text not null default '',
  description   text not null default '',
  image         text not null default '',
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.policies is 'Resort policy pages (general rules and swimming pool rules).';

-- ---------------------------------------------------------------------------
-- 6. PAYMENT METHODS — GCash, bank QR codes (Admin manages)
--    Used by: Admin (CRUD), Customer (book flow payment step)
-- ---------------------------------------------------------------------------
create table if not exists public.payment_methods (
  id              text primary key,
  provider        text not null default '',
  account_name    text not null default '',
  account_number  text not null default '',
  instructions    text not null default '',
  qr_image        text not null default '',
  active          boolean not null default true,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.payment_methods is 'QR / bank payment options configured by Admin.';

-- ---------------------------------------------------------------------------
-- 7. SITE CONTENT — About page (single row)
--    Used by: Manager (edit), Customer (about.html)
-- ---------------------------------------------------------------------------
create table if not exists public.content_about (
  id          int primary key default 1 check (id = 1),
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

comment on table public.content_about is 'About Us page JSON (hero, story cards, credentials, map).';

-- ---------------------------------------------------------------------------
-- 8. SITE CONTENT — FAQ items
--    Used by: Manager (edit), Customer (faq.html)
-- ---------------------------------------------------------------------------
create table if not exists public.content_faqs (
  id          text primary key,
  question    text not null default '',
  answer      text not null default '',
  sort_order  int not null default 0,
  cta_label   text not null default '',
  cta_href    text not null default '',
  updated_at  timestamptz not null default now()
);

comment on table public.content_faqs is 'FAQ questions and answers.';

-- ---------------------------------------------------------------------------
-- 9. SITE CONTENT — Activities (promotions & past events)
--    Used by: Manager (edit), Customer (activities.html)
-- ---------------------------------------------------------------------------
create table if not exists public.content_activities (
  id          text primary key,
  type        text not null default 'Event',
  title       text not null default '',
  date        text not null default '',
  description text not null default '',
  badge       text not null default '',
  category    text not null default 'promo'
                check (category in ('promo', 'past')),
  image       text not null default '',
  image_alt   text not null default '',
  updated_at  timestamptz not null default now()
);

comment on table public.content_activities is 'Promotions and past celebration cards on Activities page.';

-- ---------------------------------------------------------------------------
-- 10. CUSTOMER NOTIFICATIONS — per-user inbox
--     Used by: Customer (bell icon), system triggers from bookings/payments
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id          text primary key,
  user_email  text not null,
  user_id     uuid references public.profiles (id) on delete cascade,
  type        text not null default 'booking_updated'
                check (type in (
                  'booking_confirmed', 'booking_updated', 'booking_reminder',
                  'payment_approved', 'payment_rejected',
                  'promotion', 'event', 'review_request'
                )),
  title       text not null default '',
  message     text not null default '',
  read        boolean not null default false,
  link        text not null default '',
  booking_id  text references public.bookings (id) on delete set null,
  dedup_key   text not null default '',
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

alter table public.notifications add column if not exists user_id uuid references public.profiles (id) on delete cascade;

create index if not exists notifications_user_email_idx on public.notifications (user_email);
create index if not exists notifications_user_id_idx on public.notifications (user_id);
create index if not exists notifications_user_read_idx on public.notifications (user_email, read);
create index if not exists notifications_created_at_idx on public.notifications (created_at desc);
create unique index if not exists notifications_dedup_idx
  on public.notifications (user_email, dedup_key)
  where dedup_key <> '';

comment on table public.notifications is 'In-app notifications for each customer.';

-- ---------------------------------------------------------------------------
-- 11. NOTIFICATION BROADCASTS — manager promotions & events
--     Used by: Manager (send to all customers), Admin
-- ---------------------------------------------------------------------------
create table if not exists public.notification_broadcasts (
  id          text primary key,
  kind        text not null default 'promotion'
                check (kind in ('promotion', 'event')),
  title       text not null default '',
  message     text not null default '',
  event_date  date,
  link        text not null default '',
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.notification_broadcasts is 'Promotions and events broadcast to all guest inboxes.';

-- ---------------------------------------------------------------------------
-- 12. CONTACT MESSAGES — Contact Us form
--     Used by: Customer (contact.html), Manager (inbox & reply)
-- ---------------------------------------------------------------------------
create table if not exists public.contact_messages (
  id          text primary key,
  user_id     uuid references public.profiles (id) on delete set null,
  name        text not null default '',
  email       text not null default '',
  message     text not null default '',
  status      text not null default 'new'
                check (status in ('new', 'read', 'replied', 'archived')),
  reply       text not null default '',
  replied_at  timestamptz,
  replied_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table public.contact_messages add column if not exists user_id uuid references public.profiles (id) on delete set null;

create index if not exists contact_messages_user_id_idx on public.contact_messages (user_id);

create index if not exists contact_messages_status_idx on public.contact_messages (status);
create index if not exists contact_messages_created_at_idx on public.contact_messages (created_at desc);

comment on table public.contact_messages is 'Inquiries from Contact Us page; Manager replies stored here.';

-- ---------------------------------------------------------------------------
-- 13. GUEST FEEDBACK / REVIEWS — star ratings after stay
--     Used by: Customer (logout feedback), Manager & Admin (sentiment charts)
-- ---------------------------------------------------------------------------
create table if not exists public.guest_feedback (
  id            text primary key,
  user_id       uuid references public.profiles (id) on delete set null,
  guest_name    text not null default '',
  guest_email   text not null default '',
  booking_id    text references public.bookings (id) on delete set null,
  stars         int not null default 5 check (stars >= 1 and stars <= 5),
  comment       text not null default '',
  photo_url     text not null default '',
  created_at    timestamptz not null default now()
);

alter table public.guest_feedback add column if not exists user_id uuid references public.profiles (id) on delete set null;
alter table public.guest_feedback add column if not exists sentiment_archived boolean not null default false;
alter table public.guest_feedback add column if not exists sentiment_week_key text;

create index if not exists guest_feedback_user_id_idx on public.guest_feedback (user_id);
create index if not exists guest_feedback_stars_idx on public.guest_feedback (stars);
create index if not exists guest_feedback_created_at_idx on public.guest_feedback (created_at desc);
create index if not exists guest_feedback_sentiment_week_idx on public.guest_feedback (sentiment_week_key, sentiment_archived);

comment on table public.guest_feedback is 'Post-stay reviews used in Admin sentiment analysis and Manager dashboard.';
comment on column public.guest_feedback.sentiment_archived is 'Past-week comment moved to Guest Sentiment Comment Archive.';
comment on column public.guest_feedback.sentiment_week_key is 'Monday date key (YYYY-MM-DD) for the Mon–Sun week of created_at.';

-- ---------------------------------------------------------------------------
-- 14. MANAGER BLOCKED DATES — calendar unavailable dates
--     Used by: Manager (block dates), Customer (availability calendar)
-- ---------------------------------------------------------------------------
create table if not exists public.manager_blocked_dates (
  blocked_date  date primary key,
  note          text not null default '',
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);

comment on table public.manager_blocked_dates is 'Dates manually blocked on the availability calendar.';

-- ---------------------------------------------------------------------------
-- 15. ADMIN SENTIMENT — accepted AI recommendations
--     Used by: Admin dashboard only
-- ---------------------------------------------------------------------------
create table if not exists public.admin_sentiment_accepted (
  recommendation_id text not null,
  accepted_by       uuid not null references public.profiles (id) on delete cascade,
  accepted_at       timestamptz not null default now(),
  primary key (recommendation_id, accepted_by)
);

comment on table public.admin_sentiment_accepted is 'Tracks which Admin sentiment recommendations were accepted.';

-- ---------------------------------------------------------------------------
-- 15b. GUEST SENTIMENT — weekly recommendation archive
--      Used by: Admin Guest Sentiment (Recommendation Archive)
-- ---------------------------------------------------------------------------
create table if not exists public.guest_sentiment_recommendation_archive (
  week_start_key  text primary key,
  week_label      text not null default '',
  comment_count   int not null default 0 check (comment_count >= 0),
  payload         jsonb not null default '{}'::jsonb,
  archived_at     timestamptz not null default now()
);

create index if not exists guest_sentiment_rec_archive_archived_at_idx
  on public.guest_sentiment_recommendation_archive (archived_at desc);

comment on table public.guest_sentiment_recommendation_archive is
  'Weekly Guest Sentiment recommendations archived at end of each Mon–Sun week.';

-- ---------------------------------------------------------------------------
-- 16. APP SETTINGS — optional key/value store
--     Used by: Admin (site config, Google Calendar URL, etc.)
-- ---------------------------------------------------------------------------
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  updated_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now()
);

comment on table public.app_settings is 'Optional config keys (e.g. staff_access_pin, google_calendar_ics_url, resort_contact). See sql/staff-access-pin.sql.';

-- ---------------------------------------------------------------------------
-- 17. ACTIVITY LOGS — automatic Manager / Receptionist audit trail
--     Used by: Admin (Activity Logs page). See sql/activity-logs.sql.
-- ---------------------------------------------------------------------------
create table if not exists public.activity_logs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references public.profiles (id) on delete set null,
  user_name     text not null default '',
  user_email    text not null default '',
  user_role     text not null default ''
                  check (user_role in ('manager', 'receptionist', '')),
  activity      text not null,
  action_key    text not null default '',
  entity_type   text not null default '',
  entity_id     text not null default '',
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists activity_logs_created_at_idx
  on public.activity_logs (created_at desc);
create index if not exists activity_logs_role_idx
  on public.activity_logs (user_role, created_at desc);
create index if not exists activity_logs_user_idx
  on public.activity_logs (user_id, created_at desc);
create index if not exists activity_logs_action_key_idx
  on public.activity_logs (action_key, created_at desc);

comment on table public.activity_logs is
  'Automatic audit trail of Manager and Receptionist actions for the Admin Activity Logs page.';

create or replace function public.fill_activity_log_actor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.profiles;
begin
  if new.user_id is null then
    new.user_id := auth.uid();
  end if;
  if new.user_id is not null then
    select * into p from public.profiles where id = new.user_id;
    if found then
      if coalesce(nullif(trim(new.user_name), ''), '') = '' then
        new.user_name := coalesce(nullif(trim(p.name), ''), split_part(coalesce(p.email, ''), '@', 1), 'Staff');
      end if;
      if coalesce(nullif(trim(new.user_email), ''), '') = '' then
        new.user_email := lower(coalesce(p.email, ''));
      end if;
      if coalesce(nullif(trim(new.user_role), ''), '') = '' then
        new.user_role := coalesce(p.role, '');
      end if;
    end if;
  end if;
  new.user_email := lower(coalesce(new.user_email, ''));
  new.user_role := lower(coalesce(new.user_role, ''));
  return new;
end;
$$;

drop trigger if exists trg_activity_logs_actor on public.activity_logs;
create trigger trg_activity_logs_actor
  before insert on public.activity_logs
  for each row execute function public.fill_activity_log_actor();

-- ---------------------------------------------------------------------------
-- AUTO-CREATE PROFILE ON SIGN-UP
-- ---------------------------------------------------------------------------
create or replace function public.normalize_profile_role(raw_role text)
returns text
language plpgsql
immutable
as $$
declare
  r text := lower(trim(coalesce(raw_role, '')));
begin
  if r in ('admin', 'administrator') then return 'admin'; end if;
  if r = 'manager' then return 'manager'; end if;
  if r in ('receptionist', 'reception') then return 'receptionist'; end if;
  return 'guest';
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  desired_role text;
begin
  desired_role := public.normalize_profile_role(new.raw_user_meta_data ->> 'role');

  insert into public.profiles (id, email, name, phone, role, gender)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    coalesce(new.raw_user_meta_data ->> 'phone', ''),
    desired_role,
    coalesce(new.raw_user_meta_data ->> 'gender', '')
  )
  on conflict (id) do update set
    email = excluded.email,
    name = coalesce(nullif(excluded.name, ''), public.profiles.name),
    phone = coalesce(nullif(excluded.phone, ''), public.profiles.phone),
    gender = coalesce(nullif(excluded.gender, ''), public.profiles.gender),
    role = case
      when excluded.role <> 'guest' then excluded.role
      else public.profiles.role
    end,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.sync_profile_from_metadata()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  meta jsonb;
  desired_role text;
begin
  if uid is null then return; end if;

  select u.raw_user_meta_data into meta from auth.users u where u.id = uid;
  if meta is null then meta := '{}'::jsonb; end if;

  desired_role := public.normalize_profile_role(meta ->> 'role');

  insert into public.profiles (id, email, name, phone, role, gender)
  values (
    uid,
    coalesce(auth.jwt() ->> 'email', ''),
    coalesce(meta ->> 'name', ''),
    coalesce(meta ->> 'phone', ''),
    desired_role,
    coalesce(meta ->> 'gender', '')
  )
  on conflict (id) do update set
    email = coalesce(nullif(excluded.email, ''), public.profiles.email),
    name = coalesce(nullif(excluded.name, ''), public.profiles.name),
    phone = coalesce(nullif(excluded.phone, ''), public.profiles.phone),
    gender = coalesce(nullif(excluded.gender, ''), public.profiles.gender),
    role = case when desired_role <> 'guest' then desired_role else public.profiles.role end,
    updated_at = now();
end;
$$;

grant execute on function public.sync_profile_from_metadata() to authenticated;

create or replace function public.admin_set_user_role(target_user_id uuid, new_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized text := public.normalize_profile_role(new_role);
begin
  if not public.is_admin() then
    raise exception 'Only administrators can change user roles.';
  end if;

  update public.profiles
  set role = normalized, updated_at = now()
  where id = target_user_id;

  if not found then
    raise exception 'Profile not found for user %', target_user_id;
  end if;
end;
$$;

grant execute on function public.admin_set_user_role(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- PUBLIC AVAILABILITY FUNCTION (no guest PII exposed)
-- ---------------------------------------------------------------------------
create or replace function public.get_booking_occupancy()
returns table (check_in date, check_out date, status text)
language sql security definer set search_path = public stable
as $$
  select b.check_in, b.check_out, b.status
  from public.bookings b
  where b.check_in is not null and b.check_out is not null;
$$;

grant execute on function public.get_booking_occupancy() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- AUTO-FILL user_id from logged-in user or email → profiles lookup
-- ---------------------------------------------------------------------------
create or replace function public.fill_user_id_from_auth()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  em text;
begin
  if new.user_id is not null then
    return new;
  end if;

  if auth.uid() is not null then
    new.user_id := auth.uid();
    return new;
  end if;

  if tg_table_name = 'bookings' then
    em := new.user_email;
  elsif tg_table_name = 'notifications' then
    em := new.user_email;
  elsif tg_table_name = 'guest_feedback' then
    em := new.guest_email;
  elsif tg_table_name = 'contact_messages' then
    em := new.email;
  end if;

  if em is not null and em <> '' then
    select p.id into new.user_id
    from public.profiles p
    where lower(p.email) = lower(em)
    limit 1;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_bookings_user_id on public.bookings;
create trigger trg_bookings_user_id
  before insert or update on public.bookings
  for each row execute function public.fill_user_id_from_auth();

drop trigger if exists trg_notifications_user_id on public.notifications;
create trigger trg_notifications_user_id
  before insert or update on public.notifications
  for each row execute function public.fill_user_id_from_auth();

drop trigger if exists trg_guest_feedback_user_id on public.guest_feedback;
create trigger trg_guest_feedback_user_id
  before insert or update on public.guest_feedback
  for each row execute function public.fill_user_id_from_auth();

drop trigger if exists trg_contact_messages_user_id on public.contact_messages;
create trigger trg_contact_messages_user_id
  before insert or update on public.contact_messages
  for each row execute function public.fill_user_id_from_auth();

-- Backfill user_id on existing rows from matching profile email
update public.bookings b
set user_id = p.id
from public.profiles p
where b.user_id is null and lower(b.user_email) = lower(p.email);

update public.notifications n
set user_id = p.id
from public.profiles p
where n.user_id is null and lower(n.user_email) = lower(p.email);

update public.guest_feedback g
set user_id = p.id
from public.profiles p
where g.user_id is null and lower(g.guest_email) = lower(p.email);

update public.contact_messages c
set user_id = p.id
from public.profiles p
where c.user_id is null and lower(c.email) = lower(p.email);

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------

-- PROFILES
alter table public.profiles enable row level security;
drop policy if exists "Profiles view own" on public.profiles;
drop policy if exists "Profiles update own" on public.profiles;
drop policy if exists "Profiles insert own" on public.profiles;
drop policy if exists "Staff view all profiles" on public.profiles;
drop policy if exists "Admin update any profile" on public.profiles;

create policy "Profiles view own" on public.profiles for select using (auth.uid() = id);
create policy "Profiles update own" on public.profiles for update
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and role = (select p.role from public.profiles p where p.id = auth.uid())
  );
create policy "Profiles insert own" on public.profiles for insert with check (auth.uid() = id);
create policy "Staff view all profiles" on public.profiles for select using (public.is_staff());
create policy "Admin update any profile" on public.profiles for update using (public.is_admin());

-- BOOKINGS
alter table public.bookings enable row level security;
drop policy if exists "Guests read own bookings" on public.bookings;
drop policy if exists "Guests insert own bookings" on public.bookings;
drop policy if exists "Guests update own bookings" on public.bookings;
drop policy if exists "Guests delete own bookings" on public.bookings;
drop policy if exists "Staff manage all bookings" on public.bookings;

create policy "Guests read own bookings" on public.bookings for select
  using (user_id = auth.uid() or lower(user_email) = public.current_user_email());
create policy "Guests insert own bookings" on public.bookings for insert
  with check (user_id = auth.uid() or lower(user_email) = public.current_user_email());
create policy "Guests update own bookings" on public.bookings for update
  using (user_id = auth.uid() or lower(user_email) = public.current_user_email());
create policy "Guests delete own bookings" on public.bookings for delete
  using (user_id = auth.uid() or lower(user_email) = public.current_user_email());
create policy "Staff manage all bookings" on public.bookings for all
  using (public.is_staff());

-- ROOM CATALOG (public read, staff write)
alter table public.room_catalog enable row level security;
drop policy if exists "Public read room catalog" on public.room_catalog;
drop policy if exists "Staff manage room catalog" on public.room_catalog;

create policy "Public read room catalog" on public.room_catalog for select using (true);
create policy "Staff manage room catalog" on public.room_catalog for all using (public.is_staff());

-- POLICIES (public read, manager/admin write)
alter table public.policies enable row level security;
drop policy if exists "Public read policies" on public.policies;
drop policy if exists "Managers edit policies" on public.policies;

create policy "Public read policies" on public.policies for select using (true);
create policy "Managers edit policies" on public.policies for all using (public.is_manager_or_admin());

-- PAYMENT METHODS (public read active, admin write)
alter table public.payment_methods enable row level security;
drop policy if exists "Public read active payment methods" on public.payment_methods;
drop policy if exists "Admin manage payment methods" on public.payment_methods;

create policy "Public read active payment methods" on public.payment_methods for select
  using (active = true or public.is_admin());
create policy "Admin manage payment methods" on public.payment_methods for all
  using (public.is_admin());

-- CONTENT (public read, manager/admin write)
alter table public.content_about enable row level security;
alter table public.content_faqs enable row level security;
alter table public.content_activities enable row level security;

drop policy if exists "Public read about" on public.content_about;
drop policy if exists "Managers edit about" on public.content_about;
drop policy if exists "Public read faqs" on public.content_faqs;
drop policy if exists "Managers edit faqs" on public.content_faqs;
drop policy if exists "Public read activities" on public.content_activities;
drop policy if exists "Managers edit activities" on public.content_activities;

create policy "Public read about" on public.content_about for select using (true);
create policy "Managers edit about" on public.content_about for all using (public.is_manager_or_admin());
create policy "Public read faqs" on public.content_faqs for select using (true);
create policy "Managers edit faqs" on public.content_faqs for all using (public.is_manager_or_admin());
create policy "Public read activities" on public.content_activities for select using (true);
create policy "Managers edit activities" on public.content_activities for all using (public.is_manager_or_admin());

-- NOTIFICATIONS (own inbox + staff read all)
alter table public.notifications enable row level security;
drop policy if exists "Users read own notifications" on public.notifications;
drop policy if exists "Users update own notifications" on public.notifications;
drop policy if exists "Users insert own notifications" on public.notifications;
drop policy if exists "Staff insert notifications" on public.notifications;
drop policy if exists "Staff read all notifications" on public.notifications;

create policy "Users read own notifications" on public.notifications for select
  using (user_id = auth.uid() or lower(user_email) = public.current_user_email());
create policy "Users update own notifications" on public.notifications for update
  using (user_id = auth.uid() or lower(user_email) = public.current_user_email());
create policy "Users insert own notifications" on public.notifications for insert
  with check (user_id = auth.uid() or lower(user_email) = public.current_user_email());
create policy "Staff insert notifications" on public.notifications for insert
  with check (public.is_staff());
create policy "Staff read all notifications" on public.notifications for select
  using (public.is_staff());

-- BROADCASTS (staff manage, public read for reference)
alter table public.notification_broadcasts enable row level security;
drop policy if exists "Public read broadcasts" on public.notification_broadcasts;
drop policy if exists "Staff manage broadcasts" on public.notification_broadcasts;

create policy "Public read broadcasts" on public.notification_broadcasts for select using (true);
create policy "Staff manage broadcasts" on public.notification_broadcasts for all using (public.is_staff());

-- CONTACT MESSAGES (anyone insert, staff read/reply)
alter table public.contact_messages enable row level security;
drop policy if exists "Anyone submit contact message" on public.contact_messages;
drop policy if exists "Staff manage contact messages" on public.contact_messages;
drop policy if exists "Staff read contact messages" on public.contact_messages;
drop policy if exists "Staff update contact messages" on public.contact_messages;
drop policy if exists "Staff delete contact messages" on public.contact_messages;

create policy "Anyone submit contact message" on public.contact_messages for insert to anon, authenticated with check (true);
create policy "Staff read contact messages" on public.contact_messages for select to authenticated using (public.is_staff());
create policy "Staff update contact messages" on public.contact_messages for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "Staff delete contact messages" on public.contact_messages for delete to authenticated using (public.is_staff());

-- GUEST FEEDBACK (public read + insert, staff manage)
alter table public.guest_feedback enable row level security;
drop policy if exists "Public read feedback" on public.guest_feedback;
drop policy if exists "Guests insert feedback" on public.guest_feedback;
drop policy if exists "Staff manage feedback" on public.guest_feedback;
drop policy if exists "guest_feedback_select_public" on public.guest_feedback;
drop policy if exists "guest_feedback_insert_public" on public.guest_feedback;
drop policy if exists "guest_feedback_staff_all" on public.guest_feedback;

create policy "guest_feedback_select_public" on public.guest_feedback
  for select to anon, authenticated using (true);

create policy "guest_feedback_insert_public" on public.guest_feedback
  for insert to anon, authenticated
  with check (
    guest_email is not null
    and length(trim(guest_email)) > 3
    and position('@' in guest_email) > 1
    and stars between 1 and 5
    and length(trim(coalesce(comment, ''))) > 0
  );

create policy "guest_feedback_staff_all" on public.guest_feedback
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- BLOCKED DATES (public read, manager/admin write)
alter table public.manager_blocked_dates enable row level security;
drop policy if exists "Public read blocked dates" on public.manager_blocked_dates;
drop policy if exists "Managers manage blocked dates" on public.manager_blocked_dates;

create policy "Public read blocked dates" on public.manager_blocked_dates for select using (true);
create policy "Managers manage blocked dates" on public.manager_blocked_dates for all
  using (public.is_manager_or_admin());

-- ADMIN SENTIMENT
alter table public.admin_sentiment_accepted enable row level security;
drop policy if exists "Admin manage sentiment accepted" on public.admin_sentiment_accepted;

create policy "Admin manage sentiment accepted" on public.admin_sentiment_accepted for all
  using (public.is_admin());

-- GUEST SENTIMENT RECOMMENDATION ARCHIVE (staff read/write)
alter table public.guest_sentiment_recommendation_archive enable row level security;
drop policy if exists "Staff read sentiment rec archive" on public.guest_sentiment_recommendation_archive;
drop policy if exists "Staff manage sentiment rec archive" on public.guest_sentiment_recommendation_archive;

create policy "Staff read sentiment rec archive" on public.guest_sentiment_recommendation_archive for select
  using (public.is_staff());
create policy "Staff manage sentiment rec archive" on public.guest_sentiment_recommendation_archive for all
  using (public.is_staff());

-- APP SETTINGS
alter table public.app_settings enable row level security;
drop policy if exists "Staff read settings" on public.app_settings;
drop policy if exists "Admin manage settings" on public.app_settings;

create policy "Staff read settings" on public.app_settings for select using (public.is_staff());
create policy "Admin manage settings" on public.app_settings for all using (public.is_admin());

-- ACTIVITY LOGS (manager/receptionist insert own, admin read)
alter table public.activity_logs enable row level security;
drop policy if exists "Staff insert own activity logs" on public.activity_logs;
drop policy if exists "Admin read activity logs" on public.activity_logs;

create policy "Staff insert own activity logs"
  on public.activity_logs for insert
  to authenticated
  with check (
    public.current_user_role() in ('manager', 'receptionist')
    and user_id = auth.uid()
  );
create policy "Admin read activity logs"
  on public.activity_logs for select
  to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- OPTIONAL: Create Supabase Storage buckets (run separately if needed)
-- ---------------------------------------------------------------------------
-- Storage buckets (run dedicated SQL files for policies):
--   sql/supabase-payment-proofs-storage.sql  → payment-proofs
--   sql/supabase-feedback-photos-storage.sql → feedback-photos
-- insert into storage.buckets (id, name, public) values
--   ('payment-proofs', 'payment-proofs', true),
--   ('feedback-photos', 'feedback-photos', true),
--   ('content-images', 'content-images', true)
-- on conflict do nothing;

-- =============================================================================
-- TABLE SUMMARY BY ROLE
-- =============================================================================
-- CUSTOMER (guest):
--   profiles, bookings, notifications, guest_feedback, contact_messages (insert)
--   room_catalog, policies, content_*, payment_methods (read only)
--
-- RECEPTIONIST:
--   bookings (all), notifications (insert), profiles (read staff/guests)
--   room_catalog, contact_messages (read/reply)
--
-- MANAGER:
--   bookings, room_catalog, policies, content_*, notification_broadcasts
--   manager_blocked_dates, contact_messages, guest_feedback, notifications
--
-- ADMIN:
--   Everything above + payment_methods, profiles (all), admin_sentiment_accepted
--   app_settings, activity_logs, staff user management (via Supabase Auth + profiles.role)
-- =============================================================================

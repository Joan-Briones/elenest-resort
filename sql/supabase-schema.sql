-- Elenest Resort — Supabase schema
-- Run this in Supabase Dashboard → SQL Editor → New query

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null default '',
  phone text not null default '',
  email text not null default '',
  role text not null default 'guest'
    check (role in ('guest', 'admin', 'manager', 'receptionist')),
  gender text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bookings (
  id text primary key,
  user_email text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'Pending',
  check_in date,
  check_out date,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bookings_user_email_idx on public.bookings (user_email);
create index if not exists bookings_check_in_idx on public.bookings (check_in);

create table if not exists public.content_about (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.content_faqs (
  id text primary key,
  question text not null default '',
  answer text not null default '',
  sort_order int not null default 0,
  cta_label text not null default '',
  cta_href text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.content_activities (
  id text primary key,
  type text not null default 'Event',
  title text not null default '',
  date text not null default '',
  description text not null default '',
  badge text not null default '',
  category text not null default 'promo'
    check (category in ('promo', 'past')),
  image text not null default '',
  image_alt text not null default '',
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Helper functions (security definer — avoids RLS infinite recursion)
-- ---------------------------------------------------------------------------
create or replace function public.current_user_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid()),
    'guest'
  );
$$;

create or replace function public.is_staff()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.current_user_role() in ('admin', 'manager', 'receptionist');
$$;

create or replace function public.is_manager_or_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.current_user_role() in ('admin', 'manager');
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.bookings enable row level security;
alter table public.content_about enable row level security;
alter table public.content_faqs enable row level security;
alter table public.content_activities enable row level security;

drop policy if exists "Profiles are viewable by owner" on public.profiles;
drop policy if exists "Profiles are updatable by owner" on public.profiles;
drop policy if exists "Profiles insert own" on public.profiles;
drop policy if exists "Staff can view all profiles" on public.profiles;

create policy "Profiles are viewable by owner"
  on public.profiles for select using (auth.uid() = id);

create policy "Profiles are updatable by owner"
  on public.profiles for update using (auth.uid() = id);

create policy "Profiles insert own"
  on public.profiles for insert with check (auth.uid() = id);

create policy "Staff can view all profiles"
  on public.profiles for select using (public.is_staff());

drop policy if exists "Guests read own bookings" on public.bookings;
drop policy if exists "Guests insert own bookings" on public.bookings;
drop policy if exists "Guests update own bookings" on public.bookings;
drop policy if exists "Guests delete own bookings" on public.bookings;
drop policy if exists "Staff manage all bookings" on public.bookings;

create policy "Guests read own bookings"
  on public.bookings for select
  using (lower(user_email) = lower(coalesce(auth.jwt() ->> 'email', '')));

create policy "Guests insert own bookings"
  on public.bookings for insert
  with check (lower(user_email) = lower(coalesce(auth.jwt() ->> 'email', '')));

create policy "Guests update own bookings"
  on public.bookings for update
  using (lower(user_email) = lower(coalesce(auth.jwt() ->> 'email', '')));

create policy "Guests delete own bookings"
  on public.bookings for delete
  using (lower(user_email) = lower(coalesce(auth.jwt() ->> 'email', '')));

create policy "Staff manage all bookings"
  on public.bookings for all using (public.is_staff());

drop policy if exists "Public read about content" on public.content_about;
drop policy if exists "Public read faqs" on public.content_faqs;
drop policy if exists "Public read activities" on public.content_activities;
drop policy if exists "Managers edit about content" on public.content_about;
drop policy if exists "Managers edit faqs" on public.content_faqs;
drop policy if exists "Managers edit activities" on public.content_activities;

create policy "Public read about content"
  on public.content_about for select using (true);

create policy "Public read faqs"
  on public.content_faqs for select using (true);

create policy "Public read activities"
  on public.content_activities for select using (true);

create policy "Managers edit about content"
  on public.content_about for all using (public.is_manager_or_admin());

create policy "Managers edit faqs"
  on public.content_faqs for all using (public.is_manager_or_admin());

create policy "Managers edit activities"
  on public.content_activities for all using (public.is_manager_or_admin());

-- ---------------------------------------------------------------------------
-- Auto-create profile on sign-up
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    coalesce(new.raw_user_meta_data ->> 'role', 'guest')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Public availability (dates only)
-- ---------------------------------------------------------------------------
create or replace function public.get_booking_occupancy()
returns table (check_in date, check_out date, status text)
language sql
security definer
set search_path = public
stable
as $$
  select b.check_in, b.check_out, b.status
  from public.bookings b
  where b.check_in is not null and b.check_out is not null;
$$;

grant execute on function public.get_booking_occupancy() to anon, authenticated;

-- =============================================================================
-- FIX PROFILE ROLES (admin / manager / receptionist / guest)
-- Run this in Supabase → SQL Editor after your base schema is in place.
--
-- Problem: Admin (or staff) sign-up saves role as "guest" in public.profiles.
-- Cause:   The sign-up trigger may be missing, or the app upsert cannot set role.
--
-- Roles in this app:
--   guest          = customer (booking page)
--   admin          = admin dashboard
--   manager        = manager dashboard
--   receptionist   = reception dashboard
-- =============================================================================

-- 1) Normalize role text from sign-up metadata
create or replace function public.normalize_profile_role(raw_role text)
returns text
language plpgsql
immutable
as $$
declare
  r text := lower(trim(coalesce(raw_role, '')));
begin
  if r in ('admin', 'administrator') then
    return 'admin';
  end if;
  if r = 'manager' then
    return 'manager';
  end if;
  if r in ('receptionist', 'reception') then
    return 'receptionist';
  end if;
  if r in ('guest', 'customer', 'user', '') then
    return 'guest';
  end if;
  return 'guest';
end;
$$;

-- 2) Auto-create / update profile when auth.users row is created
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
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

-- 3) After login / sign-up, copy role + name from auth metadata into profiles
create or replace function public.sync_profile_from_metadata()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  meta jsonb;
  desired_role text;
begin
  if uid is null then
    return;
  end if;

  select u.raw_user_meta_data
  into meta
  from auth.users u
  where u.id = uid;

  if meta is null then
    meta := '{}'::jsonb;
  end if;

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
    role = case
      when desired_role <> 'guest' then desired_role
      else public.profiles.role
    end,
    updated_at = now();
end;
$$;

grant execute on function public.sync_profile_from_metadata() to authenticated;

-- 4) Staff-only: admin can change another user's role (for User Manager later)
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

  if normalized = 'guest' and new_role not in ('guest', 'customer', 'user', '') then
    raise exception 'Invalid role: %', new_role;
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

-- 5) RLS: users may update their profile but NOT change their own role
alter table public.profiles enable row level security;

drop policy if exists "Profiles update own" on public.profiles;
create policy "Profiles update own"
  on public.profiles
  for update
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and role = (
      select p.role
      from public.profiles p
      where p.id = auth.uid()
    )
  );

-- =============================================================================
-- FIX EXISTING ACCOUNTS (edit the emails below, then run)
-- =============================================================================
-- Example: promote your admin account if it was saved as guest
--
-- update public.profiles
-- set role = 'admin', updated_at = now()
-- where lower(email) = lower('your-admin@gmail.com');
--
-- update public.profiles
-- set role = 'manager', updated_at = now()
-- where lower(email) = lower('manager@example.com');
--
-- update public.profiles
-- set role = 'receptionist', updated_at = now()
-- where lower(email) = lower('reception@example.com');
--
-- Check all roles:
-- select email, name, role, created_at from public.profiles order by created_at desc;

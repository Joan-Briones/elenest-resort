-- =============================================================================
-- UNIFIED SIGN-IN + SERVER-SIDE ROLE PROTECTION
-- Run in Supabase → SQL Editor after the base schema.
--
-- Roles live only on public.profiles.role. Email/password/metadata cannot
-- change an existing account's role. Only an administrator (via
-- admin_set_user_role) can assign staff roles.
-- =============================================================================

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

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.current_user_role() = 'admin';
$$;

-- New accounts are always guest. The first admin may be bootstrapped from
-- signup metadata only when no admin profile exists yet.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  desired_role text := 'guest';
  meta_role text;
  admin_exists boolean;
begin
  meta_role := public.normalize_profile_role(new.raw_user_meta_data ->> 'role');
  select exists (
    select 1 from public.profiles where role = 'admin'
  ) into admin_exists;

  if meta_role = 'admin' and not admin_exists then
    desired_role := 'admin';
  end if;

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
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Sync name/email/phone from auth metadata. NEVER overwrite profiles.role.
create or replace function public.sync_profile_from_metadata()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  meta jsonb;
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

  insert into public.profiles (id, email, name, phone, role, gender)
  values (
    uid,
    coalesce(auth.jwt() ->> 'email', ''),
    coalesce(meta ->> 'name', ''),
    coalesce(meta ->> 'phone', ''),
    'guest',
    coalesce(meta ->> 'gender', '')
  )
  on conflict (id) do update set
    email = coalesce(nullif(excluded.email, ''), public.profiles.email),
    name = coalesce(nullif(excluded.name, ''), public.profiles.name),
    phone = coalesce(nullif(excluded.phone, ''), public.profiles.phone),
    gender = coalesce(nullif(excluded.gender, ''), public.profiles.gender),
    updated_at = now();
end;
$$;

grant execute on function public.sync_profile_from_metadata() to authenticated;

-- Belt-and-suspenders: only admins can change the role column.
create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.role is distinct from old.role then
    if not public.is_admin() then
      new.role := old.role;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_role on public.profiles;
create trigger protect_profile_role
  before update on public.profiles
  for each row execute function public.protect_profile_role();

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

alter table public.profiles enable row level security;

drop policy if exists "Profiles view own" on public.profiles;
drop policy if exists "Profiles update own" on public.profiles;
drop policy if exists "Profiles insert own" on public.profiles;
drop policy if exists "Staff view all profiles" on public.profiles;
drop policy if exists "Admin update any profile" on public.profiles;

create policy "Profiles view own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Profiles insert own"
  on public.profiles for insert
  with check (auth.uid() = id and role = 'guest');

create policy "Profiles update own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and role = (select p.role from public.profiles p where p.id = auth.uid())
  );

create policy "Staff view all profiles"
  on public.profiles for select
  using (public.is_staff());

create policy "Admin update any profile"
  on public.profiles for update
  using (public.is_admin())
  with check (public.is_admin());

notify pgrst, 'reload schema';

-- =============================================================================
-- FIX: Supabase /auth/v1/callback → {"error_code":"unexpected_failure"}
-- =============================================================================
-- Prefer the stronger script if this still fails after running:
--   sql/fix-facebook-auth-nuclear.sql
-- =============================================================================
-- Cause: on_auth_user_created → public.handle_new_user() throws while creating
--        a profiles row (missing helper, column mismatch, etc.). That aborts the
--        auth.users insert and Facebook/OAuth returns HTTP 500.
--
-- Safe for existing users:
--   • Does NOT change admin / manager / receptionist roles
--   • Does NOT touch bookings, contact_messages, or other tables
--   • New OAuth guests still get role = 'guest'
--   • If profile insert still fails, auth login succeeds anyway (warning only)
--
-- Run once: Supabase → SQL Editor → Run
-- Then retry: Continue with Facebook
-- =============================================================================

-- 1) Columns used by OAuth profile sync
alter table public.profiles
  add column if not exists avatar_url text not null default '';

alter table public.profiles
  add column if not exists gender text not null default '';

alter table public.profiles
  add column if not exists phone text not null default '';

-- 2) Helpers (idempotent)
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
  return 'guest';
end;
$$;

create or replace function public.profile_name_from_metadata(meta jsonb)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(meta ->> 'full_name', ''),
    nullif(meta ->> 'name', ''),
    ''
  );
$$;

create or replace function public.profile_avatar_from_metadata(meta jsonb)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(meta ->> 'avatar_url', ''),
    nullif(meta ->> 'picture', ''),
    nullif(meta ->> 'photo_url', ''),
    ''
  );
$$;

-- 3) Trigger: never block Auth on profile errors
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  desired_role text;
  meta jsonb;
begin
  meta := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  desired_role := public.normalize_profile_role(meta ->> 'role');

  insert into public.profiles (id, email, name, phone, role, gender, avatar_url)
  values (
    new.id,
    coalesce(new.email, ''),
    public.profile_name_from_metadata(meta),
    coalesce(meta ->> 'phone', ''),
    desired_role,
    coalesce(meta ->> 'gender', ''),
    public.profile_avatar_from_metadata(meta)
  )
  on conflict (id) do update set
    email = coalesce(nullif(excluded.email, ''), public.profiles.email),
    name = coalesce(nullif(excluded.name, ''), public.profiles.name),
    phone = coalesce(nullif(excluded.phone, ''), public.profiles.phone),
    gender = coalesce(nullif(excluded.gender, ''), public.profiles.gender),
    avatar_url = coalesce(nullif(excluded.avatar_url, ''), public.profiles.avatar_url),
    -- Never demote existing staff to guest
    role = case
      when excluded.role <> 'guest' then excluded.role
      else public.profiles.role
    end,
    updated_at = now();

  return new;
exception
  when others then
    raise warning 'handle_new_user skipped for %: %', new.id, sqlerrm;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4) Post-login sync (client RPC) — same role-safe rules
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

  insert into public.profiles (id, email, name, phone, role, gender, avatar_url)
  values (
    uid,
    coalesce(auth.jwt() ->> 'email', ''),
    public.profile_name_from_metadata(meta),
    coalesce(meta ->> 'phone', ''),
    desired_role,
    coalesce(meta ->> 'gender', ''),
    public.profile_avatar_from_metadata(meta)
  )
  on conflict (id) do update set
    email = coalesce(nullif(excluded.email, ''), public.profiles.email),
    name = coalesce(nullif(excluded.name, ''), public.profiles.name),
    phone = coalesce(nullif(excluded.phone, ''), public.profiles.phone),
    gender = coalesce(nullif(excluded.gender, ''), public.profiles.gender),
    avatar_url = coalesce(nullif(excluded.avatar_url, ''), public.profiles.avatar_url),
    role = case
      when desired_role <> 'guest' then desired_role
      else public.profiles.role
    end,
    updated_at = now();
exception
  when others then
    raise warning 'sync_profile_from_metadata skipped for %: %', uid, sqlerrm;
end;
$$;

grant execute on function public.sync_profile_from_metadata() to authenticated;

-- Optional check (should show on_auth_user_created → handle_new_user):
-- select tgname, pg_get_triggerdef(oid)
-- from pg_trigger
-- where tgrelid = 'auth.users'::regclass
--   and not tgisinternal;

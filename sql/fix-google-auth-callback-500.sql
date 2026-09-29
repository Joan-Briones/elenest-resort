-- =============================================================================
-- FIX: Google /auth/v1/callback → {"error_code":"unexpected_failure"}
-- =============================================================================
-- You signed in with Google OK, but Supabase crashed while creating the user
-- (usually a broken trigger on auth.users). That shows a black JSON page
-- instead of redirecting to booking.
--
-- Run ALL of this in: Supabase → SQL Editor → Run
-- Then retry: Continue with Google
--
-- Profile rows are still created/updated by the website (auth-oauth.js).
-- Safe: does not change staff roles or bookings.
-- =============================================================================

-- A) Remove triggers that can abort Auth during Google callback
drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists on_auth_user_created_trigger on auth.users;
drop trigger if exists handle_new_user on auth.users;
drop trigger if exists on_auth_user_updated on auth.users;

-- B) Columns used by Google / Facebook profile sync
alter table public.profiles add column if not exists avatar_url text not null default '';
alter table public.profiles add column if not exists gender text not null default '';
alter table public.profiles add column if not exists phone text not null default '';
alter table public.profiles add column if not exists name text not null default '';
alter table public.profiles add column if not exists email text not null default '';
alter table public.profiles add column if not exists role text not null default 'guest';
alter table public.profiles add column if not exists auth_provider text not null default '';
alter table public.profiles add column if not exists last_login_at timestamptz;
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

-- C) Safe helpers
create or replace function public.normalize_profile_role(raw_role text)
returns text
language sql
immutable
as $$
  select case lower(trim(coalesce(raw_role, '')))
    when 'admin' then 'admin'
    when 'administrator' then 'admin'
    when 'manager' then 'manager'
    when 'receptionist' then 'receptionist'
    when 'reception' then 'receptionist'
    else 'guest'
  end;
$$;

-- D) Optional trigger that NEVER fails Auth (login always succeeds)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    insert into public.profiles (
      id, email, name, phone, role, gender, avatar_url, auth_provider, last_login_at
    )
    values (
      new.id,
      coalesce(new.email, ''),
      coalesce(
        nullif(new.raw_user_meta_data ->> 'full_name', ''),
        nullif(new.raw_user_meta_data ->> 'name', ''),
        ''
      ),
      coalesce(new.raw_user_meta_data ->> 'phone', ''),
      public.normalize_profile_role(new.raw_user_meta_data ->> 'role'),
      coalesce(new.raw_user_meta_data ->> 'gender', ''),
      coalesce(
        nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
        nullif(new.raw_user_meta_data ->> 'picture', ''),
        ''
      ),
      case
        when coalesce(new.raw_app_meta_data ->> 'provider', '') ilike '%google%' then 'google'
        when coalesce(new.raw_app_meta_data ->> 'provider', '') ilike '%facebook%' then 'facebook'
        else 'email'
      end,
      now()
    )
    on conflict (id) do update set
      email = coalesce(nullif(excluded.email, ''), public.profiles.email),
      name = coalesce(nullif(excluded.name, ''), public.profiles.name),
      phone = coalesce(nullif(excluded.phone, ''), public.profiles.phone),
      gender = coalesce(nullif(excluded.gender, ''), public.profiles.gender),
      avatar_url = coalesce(nullif(excluded.avatar_url, ''), public.profiles.avatar_url),
      auth_provider = coalesce(nullif(excluded.auth_provider, ''), public.profiles.auth_provider),
      last_login_at = coalesce(excluded.last_login_at, public.profiles.last_login_at),
      role = case
        when excluded.role <> 'guest' then excluded.role
        else public.profiles.role
      end,
      updated_at = now();
  exception
    when others then
      raise warning 'handle_new_user skipped for %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- E) Client-side sync after login (used by auth-oauth.js)
create or replace function public.sync_profile_from_metadata()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  meta jsonb;
  app_meta jsonb;
  provider_hint text;
begin
  if uid is null then
    return;
  end if;

  select u.raw_user_meta_data, u.raw_app_meta_data
  into meta, app_meta
  from auth.users u
  where u.id = uid;

  meta := coalesce(meta, '{}'::jsonb);
  app_meta := coalesce(app_meta, '{}'::jsonb);

  provider_hint := coalesce(app_meta ->> 'provider', '');
  if provider_hint ilike '%google%' then
    provider_hint := 'google';
  elsif provider_hint ilike '%facebook%' then
    provider_hint := 'facebook';
  elsif provider_hint = '' then
    provider_hint := 'email';
  end if;

  insert into public.profiles (
    id, email, name, phone, role, gender, avatar_url, auth_provider, last_login_at
  )
  values (
    uid,
    coalesce(auth.jwt() ->> 'email', ''),
    coalesce(
      nullif(meta ->> 'full_name', ''),
      nullif(meta ->> 'name', ''),
      ''
    ),
    coalesce(meta ->> 'phone', ''),
    public.normalize_profile_role(meta ->> 'role'),
    coalesce(meta ->> 'gender', ''),
    coalesce(
      nullif(meta ->> 'avatar_url', ''),
      nullif(meta ->> 'picture', ''),
      ''
    ),
    provider_hint,
    now()
  )
  on conflict (id) do update set
    email = coalesce(nullif(excluded.email, ''), public.profiles.email),
    name = coalesce(nullif(excluded.name, ''), public.profiles.name),
    phone = coalesce(nullif(excluded.phone, ''), public.profiles.phone),
    gender = coalesce(nullif(excluded.gender, ''), public.profiles.gender),
    avatar_url = coalesce(nullif(excluded.avatar_url, ''), public.profiles.avatar_url),
    auth_provider = coalesce(nullif(excluded.auth_provider, ''), public.profiles.auth_provider),
    last_login_at = now(),
    role = case
      when excluded.role <> 'guest' then excluded.role
      else public.profiles.role
    end,
    updated_at = now();
exception
  when others then
    raise warning 'sync_profile_from_metadata skipped for %: %', uid, sqlerrm;
end;
$$;

grant execute on function public.sync_profile_from_metadata() to authenticated;

-- F) Confirm: should list on_auth_user_created only
select tgname as trigger_name
from pg_trigger
where tgrelid = 'auth.users'::regclass
  and not tgisinternal;

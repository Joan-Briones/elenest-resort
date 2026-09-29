-- =============================================================================
-- ELENEST RESORT — Google (and social) OAuth profile columns
-- Run in Supabase Dashboard → SQL Editor (after profiles table exists)
-- Safe to re-run. Does not remove Facebook support.
--
-- If Google login shows a black JSON page:
--   {"error_code":"unexpected_failure"}
-- run this INSTEAD (or after):
--   sql/fix-google-auth-callback-500.sql
-- =============================================================================

alter table public.profiles add column if not exists avatar_url text not null default '';
alter table public.profiles add column if not exists auth_provider text not null default '';
alter table public.profiles add column if not exists last_login_at timestamptz;

comment on column public.profiles.avatar_url is 'Profile photo URL (Google / Facebook OAuth).';
comment on column public.profiles.auth_provider is 'Last auth provider used (google, facebook, email).';
comment on column public.profiles.last_login_at is 'Last successful sign-in timestamp.';

-- Read display name from Auth metadata (Google uses full_name / name)
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

-- Read avatar from Auth metadata (Google picture / avatar_url)
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

-- Detect provider hint from Auth metadata / app_metadata
create or replace function public.profile_provider_from_auth(
  meta jsonb,
  app_meta jsonb
)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(app_meta ->> 'provider', ''),
    nullif(meta ->> 'provider', ''),
    nullif(meta ->> 'iss', ''),
    ''
  );
$$;

-- Auto-create / update profile on new auth.users (email, Google, Facebook).
-- EXCEPTION handler required: any throw becomes Auth /callback 500.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  desired_role text;
  meta jsonb;
  app_meta jsonb;
  provider_hint text;
begin
  meta := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  app_meta := coalesce(new.raw_app_meta_data, '{}'::jsonb);
  desired_role := public.normalize_profile_role(meta ->> 'role');
  provider_hint := public.profile_provider_from_auth(meta, app_meta);
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
    new.id,
    coalesce(new.email, ''),
    public.profile_name_from_metadata(meta),
    coalesce(meta ->> 'phone', ''),
    desired_role,
    coalesce(meta ->> 'gender', ''),
    public.profile_avatar_from_metadata(meta),
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
    last_login_at = coalesce(excluded.last_login_at, public.profiles.last_login_at),
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

-- After login, sync auth metadata → profiles (safe upsert by auth uid)
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
  desired_role text;
  provider_hint text;
begin
  if uid is null then
    return;
  end if;

  select u.raw_user_meta_data, u.raw_app_meta_data
  into meta, app_meta
  from auth.users u
  where u.id = uid;

  if meta is null then
    meta := '{}'::jsonb;
  end if;
  if app_meta is null then
    app_meta := '{}'::jsonb;
  end if;

  desired_role := public.normalize_profile_role(meta ->> 'role');
  provider_hint := public.profile_provider_from_auth(meta, app_meta);
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
    public.profile_name_from_metadata(meta),
    coalesce(meta ->> 'phone', ''),
    desired_role,
    coalesce(meta ->> 'gender', ''),
    public.profile_avatar_from_metadata(meta),
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
      when desired_role <> 'guest' then desired_role
      else public.profiles.role
    end,
    updated_at = now();
end;
$$;

grant execute on function public.sync_profile_from_metadata() to authenticated;

-- Tip (Supabase Dashboard → Authentication → Providers / Sign-in / Linking):
-- Enable Google provider and allow linking identities that share the same email
-- so Google and email/password accounts merge instead of creating duplicates.

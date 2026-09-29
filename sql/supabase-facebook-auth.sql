-- =============================================================================
-- ELENEST RESORT — Facebook OAuth profile support
-- Run in Supabase Dashboard → SQL Editor (after profiles table exists)
-- =============================================================================

-- Store Facebook profile photo URL on guest profiles
alter table public.profiles add column if not exists avatar_url text not null default '';

comment on column public.profiles.avatar_url is 'Profile photo URL (e.g. from Facebook OAuth).';

-- Helper: read display name from Supabase Auth metadata (email or Facebook)
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

-- Helper: read avatar from Supabase Auth metadata (Facebook picture)
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

-- Auto-create / update profile when auth.users row is created (email or OAuth).
-- EXCEPTION handler is required: any throw here becomes Auth /callback 500.
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

-- After login, sync auth metadata → profiles (safe upsert, no duplicates)
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
end;
$$;

grant execute on function public.sync_profile_from_metadata() to authenticated;

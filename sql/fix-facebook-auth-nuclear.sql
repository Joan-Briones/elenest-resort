-- =============================================================================
-- NUCLEAR FIX: Facebook /auth/v1/callback 500 → then redirect to booking
-- =============================================================================
-- Run ALL of this in Supabase → SQL Editor → Run
-- Does NOT change staff roles or other tables.
-- =============================================================================

-- A) Show any triggers on auth.users (for your eyes only)
select tgname as trigger_name,
       pg_get_triggerdef(oid) as definition
from pg_trigger
where tgrelid = 'auth.users'::regclass
  and not tgisinternal;

-- B) Remove broken profile triggers that abort Auth
drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists on_auth_user_created_trigger on auth.users;
drop trigger if exists handle_new_user on auth.users;
drop trigger if exists on_auth_user_updated on auth.users;

-- C) Ensure columns exist
alter table public.profiles add column if not exists avatar_url text not null default '';
alter table public.profiles add column if not exists gender text not null default '';
alter table public.profiles add column if not exists phone text not null default '';
alter table public.profiles add column if not exists name text not null default '';
alter table public.profiles add column if not exists email text not null default '';
alter table public.profiles add column if not exists role text not null default 'guest';
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

-- D) Minimal helpers
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

-- E) Trigger that NEVER fails Auth (empty catch-all)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    insert into public.profiles (id, email, name, phone, role, gender, avatar_url)
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
      )
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
  exception
    when others then
      -- Never block Facebook / email sign-up
      raise warning 'handle_new_user ignored error for %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- F) Client sync RPC (safe)
create or replace function public.sync_profile_from_metadata()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  meta jsonb := '{}'::jsonb;
begin
  if uid is null then
    return;
  end if;

  begin
    select coalesce(u.raw_user_meta_data, '{}'::jsonb)
    into meta
    from auth.users u
    where u.id = uid;

    insert into public.profiles (id, email, name, phone, role, gender, avatar_url)
    values (
      uid,
      coalesce(auth.jwt() ->> 'email', ''),
      coalesce(nullif(meta ->> 'full_name', ''), nullif(meta ->> 'name', ''), ''),
      coalesce(meta ->> 'phone', ''),
      public.normalize_profile_role(meta ->> 'role'),
      coalesce(meta ->> 'gender', ''),
      coalesce(nullif(meta ->> 'avatar_url', ''), nullif(meta ->> 'picture', ''), '')
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
  exception
    when others then
      raise warning 'sync_profile_from_metadata ignored: %', sqlerrm;
  end;
end;
$$;

grant execute on function public.sync_profile_from_metadata() to authenticated;

-- G) Confirm trigger is back
select tgname as trigger_name
from pg_trigger
where tgrelid = 'auth.users'::regclass
  and not tgisinternal;

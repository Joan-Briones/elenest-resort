-- =============================================================================
-- CREATE admin_set_user_role (run once in Supabase → SQL Editor)
-- Fixes: "Could not find the function public.admin_set_user_role ..."
-- =============================================================================

-- Required helpers (safe to re-run)
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

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.current_user_role() = 'admin';
$$;

-- Main function used when Admin creates Manager / Receptionist accounts
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

-- Reload PostgREST schema cache (Supabase API)
notify pgrst, 'reload schema';

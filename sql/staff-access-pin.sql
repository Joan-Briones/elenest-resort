-- Staff Access PIN (homepage gate before staff login)
-- Run once in the Supabase SQL Editor.
-- Default PIN: 2468 (change immediately via Admin → Settings → Staff Access PIN)

insert into public.app_settings (key, value)
values (
  'staff_access_pin',
  jsonb_build_object('pin', '2468')
)
on conflict (key) do nothing;

-- Staff may read other settings, but not the Staff Access PIN row.
drop policy if exists "Staff read settings" on public.app_settings;
create policy "Staff read settings" on public.app_settings
  for select
  using (public.is_staff() and key <> 'staff_access_pin');

-- Anonymous callers verify the PIN without reading the stored value.
create or replace function public.verify_staff_access_pin(p_pin text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  stored text;
begin
  select coalesce(value->>'pin', '')
    into stored
  from public.app_settings
  where key = 'staff_access_pin';

  if stored is null or stored = '' then
    stored := '2468';
  end if;

  return trim(coalesce(p_pin, '')) = stored;
end;
$$;

revoke all on function public.verify_staff_access_pin(text) from public;
grant execute on function public.verify_staff_access_pin(text) to anon, authenticated;

-- Admin-only: read the current PIN for Settings.
create or replace function public.admin_get_staff_access_pin()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  stored text;
begin
  if not public.is_admin() then
    raise exception 'Only administrators can view the Staff Access PIN.';
  end if;

  select coalesce(value->>'pin', '')
    into stored
  from public.app_settings
  where key = 'staff_access_pin';

  if stored is null or stored = '' then
    return '2468';
  end if;

  return stored;
end;
$$;

revoke all on function public.admin_get_staff_access_pin() from public;
grant execute on function public.admin_get_staff_access_pin() to authenticated;

-- Admin-only: update the PIN (takes effect immediately).
create or replace function public.admin_set_staff_access_pin(p_pin text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned text := trim(coalesce(p_pin, ''));
begin
  if not public.is_admin() then
    raise exception 'Only administrators can change the Staff Access PIN.';
  end if;

  if cleaned = '' then
    raise exception 'Staff Access PIN cannot be empty.';
  end if;

  if char_length(cleaned) < 4 or char_length(cleaned) > 12 then
    raise exception 'Staff Access PIN must be between 4 and 12 characters.';
  end if;

  if cleaned !~ '^[0-9]+$' then
    raise exception 'Staff Access PIN must contain digits only.';
  end if;

  insert into public.app_settings (key, value, updated_by, updated_at)
  values (
    'staff_access_pin',
    jsonb_build_object('pin', cleaned),
    auth.uid(),
    now()
  )
  on conflict (key) do update
  set
    value = excluded.value,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

  return true;
end;
$$;

revoke all on function public.admin_set_staff_access_pin(text) from public;
grant execute on function public.admin_set_staff_access_pin(text) to authenticated;

-- Refresh PostgREST so the new RPCs appear in the schema cache immediately.
notify pgrst, 'reload schema';

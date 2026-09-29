-- =============================================================================
-- CREATE admin_delete_staff_user (run once in Supabase → SQL Editor)
-- Allows Admin to permanently remove Manager / Receptionist auth accounts.
-- Requires helpers from supabase-admin-set-user-role.sql (run that first if needed).
-- =============================================================================

create or replace function public.admin_delete_staff_user(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = auth, public
as $$
declare
  target_role text;
begin
  if not public.is_admin() then
    raise exception 'Only administrators can delete staff accounts.';
  end if;

  if target_user_id is null then
    raise exception 'User id is required.';
  end if;

  if target_user_id = auth.uid() then
    raise exception 'You cannot delete your own account.';
  end if;

  select role into target_role
  from public.profiles
  where id = target_user_id;

  if target_role is null then
    raise exception 'User not found.';
  end if;

  if public.normalize_profile_role(target_role) not in ('manager', 'receptionist') then
    raise exception 'Only Manager or Receptionist accounts can be deleted here.';
  end if;

  delete from auth.users where id = target_user_id;
end;
$$;

grant execute on function public.admin_delete_staff_user(uuid) to authenticated;

notify pgrst, 'reload schema';

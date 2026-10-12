-- Password reset is limited to Admin and Customer (guest) accounts.
-- Run in Supabase → SQL Editor. Anonymous callers only learn
-- eligible / denied / unknown — never the stored role.

create or replace function public.password_reset_eligibility(target_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  e text := lower(trim(coalesce(target_email, '')));
  r text;
  saw_allowed boolean := false;
begin
  if e = '' or position('@' in e) = 0 then
    return 'unknown';
  end if;

  for r in
    select lower(trim(coalesce(p.role, '')))
    from public.profiles p
    left join auth.users u on u.id = p.id
    where lower(trim(coalesce(p.email, ''))) = e
       or lower(trim(coalesce(u.email, ''))) = e
  loop
    if r in ('manager', 'receptionist', 'reception') then
      return 'denied';
    end if;
    if r in ('admin', 'administrator', 'guest', 'customer', 'client', 'user') then
      saw_allowed := true;
    end if;
  end loop;

  if saw_allowed then
    return 'eligible';
  end if;
  return 'unknown';
end;
$$;

revoke all on function public.password_reset_eligibility(text) from public;
grant execute on function public.password_reset_eligibility(text) to anon, authenticated;

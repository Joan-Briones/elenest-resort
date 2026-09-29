-- =============================================================================
-- DISABLE auth profile trigger (stops Facebook /callback 500 from DB)
-- Profile rows are created by the website after login (auth-oauth.js).
-- Safe: does not change existing users or staff roles.
-- Run in Supabase → SQL Editor → Run
-- =============================================================================

drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists on_auth_user_created_trigger on auth.users;
drop trigger if exists handle_new_user on auth.users;

-- Keep the function for later, but it must not run during Auth insert.
-- (Optional) Confirm no user triggers remain:
select tgname
from pg_trigger
where tgrelid = 'auth.users'::regclass
  and not tgisinternal;

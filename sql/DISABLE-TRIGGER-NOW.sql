-- Paste into Supabase → SQL Editor → Run (this alone can stop the black JSON 500)
drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists on_auth_user_created_trigger on auth.users;
drop trigger if exists handle_new_user on auth.users;
drop trigger if exists on_auth_user_updated on auth.users;

-- Should return 0 rows:
select tgname from pg_trigger
where tgrelid = 'auth.users'::regclass and not tgisinternal;

-- FIX web Contact Us RLS on EXISTING contact_messages (same table as mobile).
-- Mobile login inserts still work. Web guests need this.
--
-- Supabase → SQL Editor → Run ALL of this → then Ctrl+F5 on contact.html

grant usage on schema public to anon, authenticated;
grant insert on public.contact_messages to anon, authenticated;
grant select, update, delete on public.contact_messages to authenticated;

alter table public.contact_messages enable row level security;

-- Remove policies that only allow logged-in mobile users (auth.uid() = user_id),
-- which block anonymous website submits.
do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'contact_messages'
  loop
    execute format('drop policy if exists %I on public.contact_messages', pol.policyname);
  end loop;
end $$;

-- Public website + mobile can insert
create policy "contact_messages_insert_public"
  on public.contact_messages
  for insert
  to anon, authenticated
  with check (true);

-- Staff (manager/admin/reception) can read & reply
create policy "contact_messages_select_staff"
  on public.contact_messages
  for select
  to authenticated
  using (public.is_staff());

create policy "contact_messages_update_staff"
  on public.contact_messages
  for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

create policy "contact_messages_delete_staff"
  on public.contact_messages
  for delete
  to authenticated
  using (public.is_staff());

-- Bypass RLS for web/mobile insert via RPC (always works)
create or replace function public.submit_contact_message(
  p_id text,
  p_name text,
  p_email text,
  p_message text
)
returns public.contact_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.contact_messages;
  v_id text := trim(coalesce(p_id, ''));
  v_email text := lower(trim(coalesce(p_email, '')));
  v_name text := trim(coalesce(p_name, ''));
begin
  if v_email = '' or position('@' in v_email) = 0 then
    raise exception 'A valid email is required';
  end if;
  if v_name = '' then
    v_name := 'Guest';
  end if;
  if v_id = '' then
    v_id := 'msg-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
  end if;

  insert into public.contact_messages (id, name, email, message, status, reply)
  values (v_id, v_name, v_email, coalesce(p_message, ''), 'new', '')
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.submit_contact_message(text, text, text, text) from public;
grant execute on function public.submit_contact_message(text, text, text, text) to anon, authenticated;

-- =============================================================================
-- CONNECT website/manager to EXISTING public.customer_messages (mobile table)
-- Does NOT recreate the table — only grants, RLS, submit RPC, and realtime.
--
-- How to run:
--   1. Open Supabase → SQL Editor → New query
--   2. Paste this entire file → Run
-- =============================================================================

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role, '')) in ('admin', 'manager', 'receptionist')
  );
$$;

-- Safe column adds (skipped if you already have them)
alter table public.customer_messages add column if not exists user_id uuid;
alter table public.customer_messages add column if not exists name text;
alter table public.customer_messages add column if not exists email text;
alter table public.customer_messages add column if not exists message text;
alter table public.customer_messages add column if not exists status text;
alter table public.customer_messages add column if not exists reply text;
alter table public.customer_messages add column if not exists replied_at timestamptz;
alter table public.customer_messages add column if not exists replied_by uuid;
alter table public.customer_messages add column if not exists created_at timestamptz;

grant insert on public.customer_messages to anon, authenticated;
grant select, update, delete on public.customer_messages to authenticated;

alter table public.customer_messages enable row level security;

do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'customer_messages'
  loop
    execute format('drop policy if exists %I on public.customer_messages', pol.policyname);
  end loop;
end $$;

create policy "customer_messages_insert_public"
  on public.customer_messages
  for insert
  to anon, authenticated
  with check (true);

create policy "customer_messages_select_staff"
  on public.customer_messages
  for select
  to authenticated
  using (public.is_staff());

create policy "customer_messages_update_staff"
  on public.customer_messages
  for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

create policy "customer_messages_delete_staff"
  on public.customer_messages
  for delete
  to authenticated
  using (public.is_staff());

create policy "customer_messages_select_own"
  on public.customer_messages
  for select
  to authenticated
  using (
    (user_id is not null and user_id = auth.uid())
    or lower(trim(coalesce(email, ''))) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
  );

create or replace function public.submit_contact_message(
  p_id text,
  p_name text,
  p_email text,
  p_message text
)
returns public.customer_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.customer_messages;
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

  insert into public.customer_messages (id, name, email, message, status, reply)
  values (v_id, v_name, v_email, coalesce(p_message, ''), 'new', '')
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.submit_contact_message(text, text, text, text) from public;
grant execute on function public.submit_contact_message(text, text, text, text) to anon, authenticated;

do $$
begin
  alter publication supabase_realtime add table public.customer_messages;
exception
  when duplicate_object then null;
  when others then null;
end $$;

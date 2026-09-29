-- =============================================================================
-- DEPRECATED for mobile sync — use sql/ensure-customer-message.sql instead.
-- Mobile + website now share: public.customer_message
-- (This file still targets the old public.contact_messages table.)
-- =============================================================================
--
-- CUSTOMER MESSAGES TABLE (legacy name: contact_messages)
-- Table name: public.contact_messages
--
-- How to run:
--   Prefer: sql/ensure-customer-message.sql
--   1. Open Supabase → SQL Editor → New query
--   2. Paste this entire file → Run
--   3. Open Table Editor → contact_messages to see all messages
-- =============================================================================

-- Staff helper (safe if it already exists)
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
      and lower(coalesce(p.role, '')) in ('admin', 'manager', 'receptionist', 'reception')
  );
$$;

-- ---------------------------------------------------------------------------
-- 1) Create the table
-- ---------------------------------------------------------------------------
create table if not exists public.contact_messages (
  id          text primary key,
  user_id     uuid references public.profiles (id) on delete set null,
  name        text not null default '',
  email       text not null default '',
  message     text not null default '',
  status      text not null default 'new'
                check (status in ('new', 'read', 'replied', 'archived')),
  reply       text not null default '',
  replied_at  timestamptz,
  replied_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

-- Add any missing columns (safe to re-run)
alter table public.contact_messages add column if not exists user_id uuid references public.profiles (id) on delete set null;
alter table public.contact_messages add column if not exists name text not null default '';
alter table public.contact_messages add column if not exists email text not null default '';
alter table public.contact_messages add column if not exists message text not null default '';
alter table public.contact_messages add column if not exists status text not null default 'new';
alter table public.contact_messages add column if not exists reply text not null default '';
alter table public.contact_messages add column if not exists replied_at timestamptz;
alter table public.contact_messages add column if not exists replied_by uuid references public.profiles (id) on delete set null;
alter table public.contact_messages add column if not exists created_at timestamptz not null default now();

create index if not exists contact_messages_user_id_idx on public.contact_messages (user_id);
create index if not exists contact_messages_status_idx on public.contact_messages (status);
create index if not exists contact_messages_created_at_idx on public.contact_messages (created_at desc);
create index if not exists contact_messages_email_idx on public.contact_messages (email);

comment on table public.contact_messages is
  'Customer Contact Us messages from website and mobile. Manager replies are stored here.';

-- ---------------------------------------------------------------------------
-- 2) Permissions + RLS
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant insert on public.contact_messages to anon, authenticated;
grant select, update, delete on public.contact_messages to authenticated;

alter table public.contact_messages enable row level security;

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

-- Anyone (web guest or mobile) can submit
create policy "contact_messages_insert_public"
  on public.contact_messages
  for insert
  to anon, authenticated
  with check (true);

-- Staff can see every customer message in Manager/Admin and in Table Editor (as staff)
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

-- ---------------------------------------------------------------------------
-- 3) Submit RPC (website uses this so inserts are not blocked by RLS)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 4) Realtime (so Manager page updates live)
-- ---------------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.contact_messages;
exception
  when duplicate_object then null;
  when others then null;
end $$;

-- =============================================================================
-- CUSTOMER MESSAGE TABLE (shared by website Contact Us + mobile)
-- Table name: public.customer_message
--
-- How to run:
--   1. Open Supabase → SQL Editor → New query
--   2. Paste this entire file → Run
--   3. Open Table Editor → customer_message to see all messages
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

-- ---------------------------------------------------------------------------
-- 1) Table (create if missing; add columns if an older mobile schema exists)
-- ---------------------------------------------------------------------------
create table if not exists public.customer_message (
  id text primary key,
  user_id uuid references public.profiles (id) on delete set null,
  name text not null default '',
  email text not null default '',
  message text not null default '',
  status text not null default 'new',
  reply text not null default '',
  replied_at timestamptz,
  replied_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.customer_message add column if not exists user_id uuid references public.profiles (id) on delete set null;
alter table public.customer_message add column if not exists name text not null default '';
alter table public.customer_message add column if not exists email text not null default '';
alter table public.customer_message add column if not exists message text not null default '';
alter table public.customer_message add column if not exists status text not null default 'new';
alter table public.customer_message add column if not exists reply text not null default '';
alter table public.customer_message add column if not exists replied_at timestamptz;
alter table public.customer_message add column if not exists replied_by uuid references public.profiles (id) on delete set null;
alter table public.customer_message add column if not exists created_at timestamptz not null default now();

create index if not exists customer_message_user_id_idx on public.customer_message (user_id);
create index if not exists customer_message_status_idx on public.customer_message (status);
create index if not exists customer_message_created_at_idx on public.customer_message (created_at desc);
create index if not exists customer_message_email_idx on public.customer_message (email);

comment on table public.customer_message is
  'Customer Contact Us messages from website + mobile; Manager replies stored here.';

-- ---------------------------------------------------------------------------
-- 2) Grants + RLS
-- ---------------------------------------------------------------------------
grant insert on public.customer_message to anon, authenticated;
grant select, update, delete on public.customer_message to authenticated;

alter table public.customer_message enable row level security;

do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'customer_message'
  loop
    execute format('drop policy if exists %I on public.customer_message', pol.policyname);
  end loop;
end $$;

create policy "customer_message_insert_public"
  on public.customer_message
  for insert
  to anon, authenticated
  with check (true);

create policy "customer_message_select_staff"
  on public.customer_message
  for select
  to authenticated
  using (public.is_staff());

create policy "customer_message_update_staff"
  on public.customer_message
  for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

create policy "customer_message_delete_staff"
  on public.customer_message
  for delete
  to authenticated
  using (public.is_staff());

-- Customers can read their own rows (mobile inbox)
create policy "customer_message_select_own"
  on public.customer_message
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or lower(trim(email)) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
  );

-- ---------------------------------------------------------------------------
-- 3) Submit RPC (website uses this so inserts are not blocked by RLS)
-- ---------------------------------------------------------------------------
create or replace function public.submit_contact_message(
  p_id text,
  p_name text,
  p_email text,
  p_message text
)
returns public.customer_message
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.customer_message;
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

  insert into public.customer_message (id, name, email, message, status, reply)
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
  alter publication supabase_realtime add table public.customer_message;
exception
  when duplicate_object then null;
  when others then null;
end $$;

-- =============================================================================
-- ACTIVITY LOGS
-- Run in Supabase → SQL Editor after the base schema.
--
-- Automatically records important Manager and Receptionist actions.
-- Admin reads the log in the Activity Logs section (search + filters).
-- Staff never enter logs by hand.
-- =============================================================================

create table if not exists public.activity_logs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references public.profiles (id) on delete set null,
  user_name     text not null default '',
  user_email    text not null default '',
  user_role     text not null default ''
                  check (user_role in ('manager', 'receptionist', '')),
  activity      text not null,
  action_key    text not null default '',
  entity_type   text not null default '',
  entity_id     text not null default '',
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists activity_logs_created_at_idx
  on public.activity_logs (created_at desc);
create index if not exists activity_logs_role_idx
  on public.activity_logs (user_role, created_at desc);
create index if not exists activity_logs_user_idx
  on public.activity_logs (user_id, created_at desc);
create index if not exists activity_logs_action_key_idx
  on public.activity_logs (action_key, created_at desc);

comment on table public.activity_logs is
  'Automatic audit trail of Manager and Receptionist actions for the Admin Activity Logs page.';

create or replace function public.fill_activity_log_actor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.profiles;
begin
  if new.user_id is null then
    new.user_id := auth.uid();
  end if;

  if new.user_id is not null then
    select * into p from public.profiles where id = new.user_id;
    if found then
      if coalesce(nullif(trim(new.user_name), ''), '') = '' then
        new.user_name := coalesce(
          nullif(trim(p.name), ''),
          split_part(coalesce(p.email, ''), '@', 1),
          'Staff'
        );
      end if;
      if coalesce(nullif(trim(new.user_email), ''), '') = '' then
        new.user_email := lower(coalesce(p.email, ''));
      end if;
      if coalesce(nullif(trim(new.user_role), ''), '') = '' then
        new.user_role := coalesce(p.role, '');
      end if;
    end if;
  end if;

  new.user_email := lower(coalesce(new.user_email, ''));
  new.user_role := lower(coalesce(new.user_role, ''));
  return new;
end;
$$;

drop trigger if exists trg_activity_logs_actor on public.activity_logs;
create trigger trg_activity_logs_actor
  before insert on public.activity_logs
  for each row execute function public.fill_activity_log_actor();

alter table public.activity_logs enable row level security;

drop policy if exists "Staff insert own activity logs" on public.activity_logs;
drop policy if exists "Admin read activity logs" on public.activity_logs;
drop policy if exists "Staff read own activity logs" on public.activity_logs;

create policy "Staff insert own activity logs"
  on public.activity_logs for insert
  to authenticated
  with check (
    public.current_user_role() in ('manager', 'receptionist')
    and user_id = auth.uid()
  );

create policy "Admin read activity logs"
  on public.activity_logs for select
  to authenticated
  using (public.is_admin());

grant select, insert on public.activity_logs to authenticated;

alter table public.activity_logs replica identity full;

do $$
begin
  begin
    alter publication supabase_realtime add table public.activity_logs;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;
end $$;

notify pgrst, 'reload schema';

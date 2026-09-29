-- =============================================================================
-- ADD user_id TO ALL USER-RELATED TABLES
-- Run this in Supabase SQL Editor, then re-run supabase-full-schema.sql
-- =============================================================================

-- BOOKINGS
alter table public.bookings add column if not exists user_id uuid references public.profiles (id) on delete set null;
alter table public.bookings add column if not exists payment_status text not null default '';
alter table public.bookings add column if not exists full_name text not null default '';
alter table public.bookings add column if not exists phone text not null default '';
alter table public.bookings add column if not exists room_type text not null default '';
alter table public.bookings add column if not exists total_estimate numeric(12, 2);
alter table public.bookings add column if not exists amount_down numeric(12, 2);
alter table public.bookings add column if not exists payment_method text not null default '';
alter table public.bookings add column if not exists manager_approved_at timestamptz;
alter table public.bookings add column if not exists manager_approved_by text;
alter table public.bookings add column if not exists payment_verified_at timestamptz;
alter table public.bookings add column if not exists payment_verified_by text;

create index if not exists bookings_user_id_idx on public.bookings (user_id);
create index if not exists bookings_status_idx on public.bookings (status);
create index if not exists bookings_submitted_at_idx on public.bookings (submitted_at desc);

-- PROFILES
alter table public.profiles add column if not exists gender text not null default '';

-- Other tables (only if they already exist)
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'notifications') then
    alter table public.notifications add column if not exists user_id uuid references public.profiles (id) on delete cascade;
    create index if not exists notifications_user_id_idx on public.notifications (user_id);
  end if;

  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'guest_feedback') then
    alter table public.guest_feedback add column if not exists user_id uuid references public.profiles (id) on delete set null;
    alter table public.guest_feedback add column if not exists sentiment_archived boolean not null default false;
    alter table public.guest_feedback add column if not exists sentiment_week_key text;
    create index if not exists guest_feedback_user_id_idx on public.guest_feedback (user_id);
    create index if not exists guest_feedback_sentiment_week_idx on public.guest_feedback (sentiment_week_key, sentiment_archived);
  end if;

  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'contact_messages') then
    alter table public.contact_messages add column if not exists user_id uuid references public.profiles (id) on delete set null;
    create index if not exists contact_messages_user_id_idx on public.contact_messages (user_id);
  end if;
end $$;

-- Backfill user_id from email where profile exists
update public.bookings b
set user_id = p.id
from public.profiles p
where b.user_id is null and lower(b.user_email) = lower(p.email);

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'notifications') then
    update public.notifications n
    set user_id = p.id
    from public.profiles p
    where n.user_id is null and lower(n.user_email) = lower(p.email);
  end if;

  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'guest_feedback') then
    update public.guest_feedback g
    set user_id = p.id
    from public.profiles p
    where g.user_id is null and lower(g.guest_email) = lower(p.email);
  end if;

  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'contact_messages') then
    update public.contact_messages c
    set user_id = p.id
    from public.profiles p
    where c.user_id is null and lower(c.email) = lower(p.email);
  end if;
end $$;

-- Auto-fill user_id on every new row
create or replace function public.fill_user_id_from_auth()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  em text;
begin
  if new.user_id is not null then
    return new;
  end if;

  if auth.uid() is not null then
    new.user_id := auth.uid();
    return new;
  end if;

  if tg_table_name = 'bookings' then
    em := new.user_email;
  elsif tg_table_name = 'notifications' then
    em := new.user_email;
  elsif tg_table_name = 'guest_feedback' then
    em := new.guest_email;
  elsif tg_table_name = 'contact_messages' then
    em := new.email;
  end if;

  if em is not null and em <> '' then
    select p.id into new.user_id
    from public.profiles p
    where lower(p.email) = lower(em)
    limit 1;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_bookings_user_id on public.bookings;
create trigger trg_bookings_user_id
  before insert or update on public.bookings
  for each row execute function public.fill_user_id_from_auth();

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'notifications') then
    drop trigger if exists trg_notifications_user_id on public.notifications;
    create trigger trg_notifications_user_id
      before insert or update on public.notifications
      for each row execute function public.fill_user_id_from_auth();
  end if;

  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'guest_feedback') then
    drop trigger if exists trg_guest_feedback_user_id on public.guest_feedback;
    create trigger trg_guest_feedback_user_id
      before insert or update on public.guest_feedback
      for each row execute function public.fill_user_id_from_auth();
  end if;

  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'contact_messages') then
    drop trigger if exists trg_contact_messages_user_id on public.contact_messages;
    create trigger trg_contact_messages_user_id
      before insert or update on public.contact_messages
      for each row execute function public.fill_user_id_from_auth();
  end if;
end $$;

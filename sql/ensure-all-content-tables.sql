-- =============================================================================
-- ELENEST — Ensure all website content tables match the live app
-- Run once in Supabase SQL Editor (safe to re-run)
--
-- Tables used by the website:
--   content_about, content_faqs, content_activities, content_events,
--   content_policies, room_catalog, guest_feedback, payment_methods,
--   contact_messages
-- + RPC get_homepage_stats()
-- =============================================================================

-- ABOUT — keep existing legacy (kind/title/body) rows; create JSON table only if missing
do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'content_about'
  ) then
    create table public.content_about (
      id          int primary key default 1 check (id = 1),
      data        jsonb not null default '{}'::jsonb,
      updated_at  timestamptz not null default now()
    );
  end if;
end $$;

-- FAQS
create table if not exists public.content_faqs (
  id          text primary key,
  question    text not null default '',
  answer      text not null default '',
  sort_order  int not null default 0,
  cta_label   text not null default '',
  cta_href    text not null default '',
  updated_at  timestamptz not null default now()
);
create index if not exists content_faqs_sort_order_idx on public.content_faqs (sort_order);

-- ACTIVITIES (promotions)
create table if not exists public.content_activities (
  id          text primary key,
  type        text not null default 'Event',
  title       text not null default '',
  date        text not null default '',
  description text not null default '',
  badge       text not null default 'Promotion',
  category    text not null default 'promo',
  image       text not null default '',
  image_alt   text not null default '',
  updated_at  timestamptz not null default now()
);

-- EVENTS (past events)
create table if not exists public.content_events (
  id          text primary key,
  type        text not null default 'Event',
  title       text not null default '',
  date        text not null default '',
  description text not null default '',
  badge       text not null default 'Past event',
  image       text not null default '',
  image_alt   text not null default '',
  updated_at  timestamptz not null default now()
);

-- POLICIES
create table if not exists public.content_policies (
  id          text primary key,
  kind        text not null default 'general' check (kind in ('general', 'pool')),
  title       text not null default '',
  description text not null default '',
  image       text not null default '',
  sort_order  int not null default 0,
  updated_at  timestamptz not null default now()
);
create index if not exists content_policies_sort_order_idx on public.content_policies (sort_order);

-- Moments at Elenest homepage gallery
create table if not exists public.content_gallery (
  id          text primary key,
  title       text not null default '',
  image       text not null default '',
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists content_gallery_sort_order_idx on public.content_gallery (sort_order);

-- Move legacy public.policies → content_policies (once)
insert into public.content_policies (id, kind, title, description, image, sort_order, updated_at)
select id, kind, title, description, image, sort_order, updated_at
from public.policies
where exists (
  select 1 from information_schema.tables
  where table_schema = 'public' and table_name = 'policies'
)
and not exists (select 1 from public.content_policies limit 1)
on conflict (id) do nothing;

-- FACILITIES live in room_catalog (website does NOT use content_facilities)
create table if not exists public.room_catalog (
  id            text primary key,
  type          text not null default 'room' check (type in ('room', 'cottage', 'hall')),
  room_kind     text check (room_kind in ('small', 'big', 'couple')),
  name          text not null default '',
  price         numeric(12, 2) not null default 0,
  price_unit    text not null default 'night' check (price_unit in ('night', 'day', 'event', 'hour')),
  image         text not null default '',
  description   text not null default '',
  sort_order    int not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- If obsolete content_facilities has rows and room_catalog is empty, copy once
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'content_facilities'
  ) and not exists (select 1 from public.room_catalog limit 1) then
    insert into public.room_catalog (
      id, type, room_kind, name, price, price_unit, image, description, sort_order, active, updated_at
    )
    select id, type, room_kind, name, price, price_unit, image, description, sort_order, active, updated_at
    from public.content_facilities
    on conflict (id) do nothing;
  end if;
end $$;

-- CONTACT MESSAGES
create table if not exists public.contact_messages (
  id          text primary key,
  user_id     uuid references public.profiles (id) on delete set null,
  name        text not null default '',
  email       text not null default '',
  message     text not null default '',
  status      text not null default 'new' check (status in ('new', 'read', 'replied', 'archived')),
  reply       text not null default '',
  replied_at  timestamptz,
  replied_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.content_about enable row level security;
alter table public.content_faqs enable row level security;
alter table public.content_activities enable row level security;
alter table public.content_events enable row level security;
alter table public.content_policies enable row level security;
alter table public.content_gallery enable row level security;
alter table public.room_catalog enable row level security;
alter table public.contact_messages enable row level security;

drop policy if exists "Public read content about" on public.content_about;
drop policy if exists "Managers edit content about" on public.content_about;
drop policy if exists "Public read content faqs" on public.content_faqs;
drop policy if exists "Managers edit content faqs" on public.content_faqs;
drop policy if exists "Public read content activities" on public.content_activities;
drop policy if exists "Managers edit content activities" on public.content_activities;
drop policy if exists "Public read content events" on public.content_events;
drop policy if exists "Managers edit content events" on public.content_events;
drop policy if exists "Public read content policies" on public.content_policies;
drop policy if exists "Managers edit content policies" on public.content_policies;
drop policy if exists "Public read content gallery" on public.content_gallery;
drop policy if exists "Managers edit content gallery" on public.content_gallery;
drop policy if exists "Public read room catalog" on public.room_catalog;
drop policy if exists "Staff manage room catalog" on public.room_catalog;
drop policy if exists "Anyone submit contact message" on public.contact_messages;
drop policy if exists "Staff manage contact messages" on public.contact_messages;
drop policy if exists "Staff read contact messages" on public.contact_messages;
drop policy if exists "Staff update contact messages" on public.contact_messages;
drop policy if exists "Staff delete contact messages" on public.contact_messages;

create policy "Public read content about" on public.content_about for select using (true);
create policy "Managers edit content about" on public.content_about for all using (public.is_manager_or_admin());

create policy "Public read content faqs" on public.content_faqs for select using (true);
create policy "Managers edit content faqs" on public.content_faqs for all using (public.is_manager_or_admin());

create policy "Public read content activities" on public.content_activities for select using (true);
create policy "Managers edit content activities" on public.content_activities for all using (public.is_manager_or_admin());

create policy "Public read content events" on public.content_events for select using (true);
create policy "Managers edit content events" on public.content_events for all using (public.is_manager_or_admin());

create policy "Public read content policies" on public.content_policies for select using (true);
create policy "Managers edit content policies" on public.content_policies for all using (public.is_manager_or_admin());

create policy "Public read content gallery" on public.content_gallery for select using (true);
create policy "Managers edit content gallery" on public.content_gallery for all using (public.is_manager_or_admin());

create policy "Public read room catalog" on public.room_catalog for select using (true);
create policy "Staff manage room catalog" on public.room_catalog for all using (public.is_staff());

create policy "Anyone submit contact message" on public.contact_messages for insert to anon, authenticated with check (true);
create policy "Staff read contact messages" on public.contact_messages for select to authenticated using (public.is_staff());
create policy "Staff update contact messages" on public.contact_messages for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "Staff delete contact messages" on public.contact_messages for delete to authenticated using (public.is_staff());

-- Realtime (ignore errors if already added)
do $$
begin
  begin alter publication supabase_realtime add table public.content_about; exception when others then null; end;
  begin alter publication supabase_realtime add table public.content_faqs; exception when others then null; end;
  begin alter publication supabase_realtime add table public.content_activities; exception when others then null; end;
  begin alter publication supabase_realtime add table public.content_events; exception when others then null; end;
  begin alter publication supabase_realtime add table public.content_policies; exception when others then null; end;
  begin alter publication supabase_realtime add table public.content_gallery; exception when others then null; end;
  begin alter publication supabase_realtime add table public.room_catalog; exception when others then null; end;
  begin alter publication supabase_realtime add table public.contact_messages; exception when others then null; end;
  begin alter publication supabase_realtime add table public.guest_feedback; exception when others then null; end;
end $$;

-- Homepage live counters
create or replace function public.get_homepage_stats()
returns json
language sql
security definer
set search_path = public
stable
as $$
  select json_build_object(
    'customers', (
      select count(*)::int from (
        select lower(trim(email)) as email
        from public.profiles
        where role = 'guest' and coalesce(trim(email), '') <> ''
        union
        select lower(trim(user_email))
        from public.bookings
        where coalesce(trim(user_email), '') <> ''
      ) guests
    ),
    'positive_feedback', (
      select count(*)::int from public.guest_feedback where stars >= 4
    ),
    'facilities', (
      select count(*)::int from public.room_catalog where active is true
    )
  );
$$;

revoke all on function public.get_homepage_stats() from public;
grant execute on function public.get_homepage_stats() to anon, authenticated;

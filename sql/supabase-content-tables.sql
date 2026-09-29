-- =============================================================================
-- ELENEST RESORT — Centralized CMS content tables
-- Run in Supabase Dashboard → SQL Editor
-- Prefer sql/ensure-all-content-tables.sql (canonical, includes room_catalog).
-- Tables: content_about, content_faqs, content_policies, content_events
-- Facilities = public.room_catalog (NOT content_facilities)
-- (content_activities should already exist)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ABOUT — single JSON row (about.html + Content Management)
-- Migrates legacy row-based content_about (kind/name/title/body) if present
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'content_about'
      and column_name = 'kind'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'content_about'
      and column_name = 'data'
  ) then
    alter table public.content_about rename to content_about_legacy;
  end if;
end $$;

create table if not exists public.content_about (
  id          int primary key default 1 check (id = 1),
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

comment on table public.content_about is 'About Us page JSON (hero, story cards, credentials, map).';

do $$
declare
  legacy_name text;
  legacy_tagline text;
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'content_about_legacy'
  ) then
    select nullif(name, ''), nullif(tagline, '')
      into legacy_name, legacy_tagline
    from public.content_about_legacy
    where kind = 'profile'
    limit 1;
  end if;

  if not exists (select 1 from public.content_about where id = 1) then
    insert into public.content_about (id, data, updated_at)
    values (
      1,
      jsonb_strip_nulls(jsonb_build_object(
        'heroTitle', coalesce(legacy_name, 'About Elenest Resort'),
        'heroLead', coalesce(
          legacy_tagline,
          'Elenest Resort is a nature-inspired destination in Mataasnakahoy, Batangas where comfort, warm service, and memorable moments come together for every guest.'
        )
      )),
      now()
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- FAQS — questions and answers (faq.html + Content Management)
-- ---------------------------------------------------------------------------
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

comment on table public.content_faqs is 'FAQ questions and answers managed via Content Management.';

-- ---------------------------------------------------------------------------
-- FACILITIES — public.room_catalog (used by website; do not use content_facilities)
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- POLICIES — resort policy cards (policies.html + homepage rules)
-- ---------------------------------------------------------------------------
create table if not exists public.content_policies (
  id            text primary key,
  kind          text not null default 'general'
                  check (kind in ('general', 'pool')),
  title         text not null default '',
  description   text not null default '',
  image         text not null default '',
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.content_policies is 'Resort policy cards managed via Content Management.';

-- ---------------------------------------------------------------------------
-- EVENTS — past celebrations & event showcase (activities page)
-- ---------------------------------------------------------------------------
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

comment on table public.content_events is 'Past celebrations and event showcase cards on the Activities page.';

-- ---------------------------------------------------------------------------
-- Migrate legacy past items from content_activities → content_events (one-time)
-- ---------------------------------------------------------------------------
insert into public.content_events (id, type, title, date, description, badge, image, image_alt, updated_at)
select
  id, type, title, date, description,
  coalesce(nullif(badge, ''), 'Past event'),
  image, image_alt, updated_at
from public.content_activities
where category = 'past'
on conflict (id) do nothing;

delete from public.content_activities where category = 'past';

-- ---------------------------------------------------------------------------
-- Optional: migrate obsolete content_facilities → room_catalog if catalog empty
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Optional: migrate policies → content_policies if CMS table is empty
-- ---------------------------------------------------------------------------
insert into public.content_policies (id, kind, title, description, image, sort_order, updated_at)
select id, kind, title, description, image, sort_order, updated_at
from public.policies
where not exists (select 1 from public.content_policies limit 1)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Row Level Security — public read, manager/admin full CRUD
-- ---------------------------------------------------------------------------
alter table public.content_about enable row level security;
alter table public.content_faqs enable row level security;
alter table public.room_catalog enable row level security;
alter table public.content_policies enable row level security;
alter table public.content_events enable row level security;

drop policy if exists "Public read content about" on public.content_about;
drop policy if exists "Managers edit content about" on public.content_about;
drop policy if exists "Public read about" on public.content_about;
drop policy if exists "Managers edit about" on public.content_about;
drop policy if exists "Public read about content" on public.content_about;
drop policy if exists "Managers edit about content" on public.content_about;
drop policy if exists "Public read content faqs" on public.content_faqs;
drop policy if exists "Managers edit content faqs" on public.content_faqs;
drop policy if exists "Public read room catalog" on public.room_catalog;
drop policy if exists "Staff manage room catalog" on public.room_catalog;
drop policy if exists "Public read content policies" on public.content_policies;
drop policy if exists "Managers edit content policies" on public.content_policies;
drop policy if exists "Public read content events" on public.content_events;
drop policy if exists "Managers edit content events" on public.content_events;

create policy "Public read content about" on public.content_about for select using (true);
create policy "Managers edit content about" on public.content_about for all using (public.is_manager_or_admin());

create policy "Public read content faqs" on public.content_faqs for select using (true);
create policy "Managers edit content faqs" on public.content_faqs for all using (public.is_manager_or_admin());

create policy "Public read room catalog" on public.room_catalog for select using (true);
create policy "Staff manage room catalog" on public.room_catalog for all using (public.is_staff());

create policy "Public read content policies" on public.content_policies for select using (true);
create policy "Managers edit content policies" on public.content_policies for all using (public.is_manager_or_admin());

create policy "Public read content events" on public.content_events for select using (true);
create policy "Managers edit content events" on public.content_events for all using (public.is_manager_or_admin());

-- Realtime (enable in Dashboard → Database → Replication if not auto-enabled)
do $$
begin
  begin alter publication supabase_realtime add table public.room_catalog; exception when others then null; end;
  begin alter publication supabase_realtime add table public.content_policies; exception when others then null; end;
  begin alter publication supabase_realtime add table public.content_events; exception when others then null; end;
  begin alter publication supabase_realtime add table public.content_about; exception when others then null; end;
  begin alter publication supabase_realtime add table public.content_faqs; exception when others then null; end;
  begin alter publication supabase_realtime add table public.content_activities; exception when others then null; end;
end $$;

-- ---------------------------------------------------------------------------
-- Example FAQs (only when table is empty — safe to re-run)
-- ---------------------------------------------------------------------------
insert into public.content_faqs (id, question, answer, sort_order, cta_label, cta_href)
select * from (values
  ('faq1', 'What time is check-in and check-out?', 'Check-in is 2:00 PM and check-out is 12:00 PM.', 1, '', ''),
  ('faq2', 'Do you accept walk-in guests?', 'Yes, but we recommend booking in advance, especially on weekends.', 2, '', ''),
  ('faq3', 'Are pets allowed?', 'Please contact us first for our latest pet policy.', 3, '', ''),
  ('faq4', 'Do room rates include breakfast?', 'Some room packages include breakfast. Please check promotion details.', 4, '', ''),
  ('faq5', 'Can we book for private events?', 'Yes. We host birthdays, reunions, and corporate gatherings. Contact us for event packages and availability.', 5, '', ''),
  ('faq6', 'What payment methods are accepted?', 'We accept cash, bank transfer, and selected e-wallet options for reservation and onsite payment.', 6, '', ''),
  ('faq7', 'How do we secure a reservation?', 'Send your details through our booking page. Our team will confirm availability and reservation steps.', 7, 'Go to Booking', 'book.html')
) as examples(id, question, answer, sort_order, cta_label, cta_href)
where not exists (select 1 from public.content_faqs limit 1);

-- Facilities seed skipped: website uses public.room_catalog (your existing data).
-- Run sql/ensure-all-content-tables.sql for the full content stack.

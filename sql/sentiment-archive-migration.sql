-- Guest Sentiment weekly archive (Mon–Sun weeks).
-- Run in Supabase SQL editor after supabase-full-schema.sql.

alter table public.guest_feedback
  add column if not exists sentiment_archived boolean not null default false;

alter table public.guest_feedback
  add column if not exists sentiment_week_key text;

create index if not exists guest_feedback_sentiment_week_idx
  on public.guest_feedback (sentiment_week_key, sentiment_archived);

comment on column public.guest_feedback.sentiment_archived is
  'When true, comment is in the Guest Sentiment Comment Archive (past week).';

comment on column public.guest_feedback.sentiment_week_key is
  'Monday date key (YYYY-MM-DD) for the calendar week containing created_at.';

-- Back-fill week keys for existing rows.
update public.guest_feedback
set sentiment_week_key = to_char(
  date_trunc('week', created_at at time zone 'UTC')::date,
  'YYYY-MM-DD'
)
where sentiment_week_key is null or sentiment_week_key = '';

-- PostgreSQL date_trunc week starts Monday when ISO; verify with:
-- For JS consistency we use Monday-based keys computed client-side on insert.

create table if not exists public.guest_sentiment_recommendation_archive (
  week_start_key  text primary key,
  week_label      text not null default '',
  comment_count   int not null default 0 check (comment_count >= 0),
  payload         jsonb not null default '{}'::jsonb,
  archived_at     timestamptz not null default now()
);

create index if not exists guest_sentiment_rec_archive_archived_at_idx
  on public.guest_sentiment_recommendation_archive (archived_at desc);

comment on table public.guest_sentiment_recommendation_archive is
  'Weekly Guest Sentiment recommendations archived at end of each Mon–Sun week.';

alter table public.guest_sentiment_recommendation_archive enable row level security;

drop policy if exists "Staff read sentiment rec archive" on public.guest_sentiment_recommendation_archive;
drop policy if exists "Staff manage sentiment rec archive" on public.guest_sentiment_recommendation_archive;

create policy "Staff read sentiment rec archive"
  on public.guest_sentiment_recommendation_archive for select
  using (public.is_staff());

create policy "Staff manage sentiment rec archive"
  on public.guest_sentiment_recommendation_archive for all
  using (public.is_staff());

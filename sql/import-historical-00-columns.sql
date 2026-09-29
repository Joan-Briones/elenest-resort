-- Run this tiny query first in Supabase SQL Editor (safe, small).
-- Then import the CSV files in Table Editor.

alter table public.guest_feedback
  add column if not exists sentiment_archived boolean not null default false;
alter table public.guest_feedback
  add column if not exists sentiment_week_key text;

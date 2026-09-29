-- =============================================================================
-- ELENEST RESORT — OTP phone verification (iProg SMS + Edge Functions)
-- Run in Supabase Dashboard → SQL Editor
-- =============================================================================
-- Table used by verify-otp Edge Function (service role) after iProg confirms OTP.
-- Frontend never writes here directly.
-- =============================================================================

create table if not exists public.users (
  id            uuid primary key default gen_random_uuid(),
  phone_number  text not null,
  is_verified   boolean not null default false,
  created_at    timestamptz not null default now(),
  constraint users_phone_number_unique unique (phone_number),
  constraint users_phone_number_format check (phone_number ~ '^09[0-9]{9}$')
);

create index if not exists users_phone_number_idx on public.users (phone_number);
create index if not exists users_is_verified_idx on public.users (is_verified);

comment on table public.users is 'Phone numbers verified via iProg SMS OTP (Edge Functions).';

alter table public.users enable row level security;

-- No public policies: only service role (Edge Functions) can read/write.
-- Authenticated clients may read their own row if you later tie phone to auth.users.

revoke all on public.users from anon, authenticated;
grant select, insert, update on public.users to service_role;

-- Predictive Analytics: monthly booking history + forecast results
-- Run in Supabase Dashboard → SQL Editor

-- ---------------------------------------------------------------------------
-- Aggregated historical months (bookings / guests / revenue / weather mix)
-- ---------------------------------------------------------------------------
create table if not exists public.booking_monthly_history (
  id uuid primary key default gen_random_uuid(),
  year int not null,
  month int not null check (month between 1 and 12),
  facility_type text not null default 'all'
    check (facility_type in ('all', 'rooms', 'cottages', 'event_hall')),
  bookings_count int not null default 0,
  guests_count int not null default 0,
  revenue numeric(14, 2) not null default 0,
  occupancy_rate numeric(6, 3) not null default 0,
  weekend_days int not null default 0,
  holiday_days int not null default 0,
  sunny_days int not null default 0,
  rainy_days int not null default 0,
  stormy_days int not null default 0,
  positive_feedback_count int not null default 0,
  feedback_count int not null default 0,
  avg_rating numeric(4, 2) not null default 0,
  source text not null default 'aggregated',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (year, month, facility_type)
);

-- Safe for DBs that already ran an earlier version of this migration.
alter table public.booking_monthly_history
  add column if not exists positive_feedback_count int not null default 0;
alter table public.booking_monthly_history
  add column if not exists feedback_count int not null default 0;
alter table public.booking_monthly_history
  add column if not exists avg_rating numeric(4, 2) not null default 0;

create index if not exists booking_monthly_history_period_idx
  on public.booking_monthly_history (year desc, month desc);

-- ---------------------------------------------------------------------------
-- Forecast rows for the next 1–12 months
-- ---------------------------------------------------------------------------
create table if not exists public.booking_forecasts (
  id uuid primary key default gen_random_uuid(),
  forecast_run_id uuid not null,
  year int not null,
  month int not null check (month between 1 and 12),
  horizon_months int not null check (horizon_months between 1 and 12),
  facility_type text not null default 'all'
    check (facility_type in ('all', 'rooms', 'cottages', 'event_hall')),
  weather_scenario text not null default 'expected'
    check (weather_scenario in ('expected', 'sunny', 'rainy', 'stormy')),
  predicted_bookings numeric(10, 2) not null default 0,
  predicted_guests numeric(10, 2) not null default 0,
  predicted_revenue numeric(14, 2) not null default 0,
  predicted_occupancy numeric(6, 3) not null default 0,
  confidence_level numeric(5, 2) not null default 0,
  weather_impact_pct numeric(8, 2) not null default 0,
  model_type text not null default 'linear_regression',
  previous_month_revenue numeric(14, 2),
  revenue_delta_pct numeric(8, 2),
  created_at timestamptz not null default now(),
  unique (forecast_run_id, year, month, facility_type, weather_scenario)
);

create index if not exists booking_forecasts_period_idx
  on public.booking_forecasts (year, month);

create index if not exists booking_forecasts_run_idx
  on public.booking_forecasts (forecast_run_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Prescriptive recommendations generated from forecasts
-- ---------------------------------------------------------------------------
create table if not exists public.forecast_recommendations (
  id uuid primary key default gen_random_uuid(),
  forecast_run_id uuid not null,
  year int not null,
  month int not null check (month between 1 and 12),
  facility_type text not null default 'all',
  category text not null
    check (category in (
      'staffing', 'promotion', 'facilities', 'maintenance', 'revenue', 'reputation'
    )),
  priority text not null default 'medium'
    check (priority in ('high', 'medium', 'low')),
  title text not null,
  detail text not null,
  created_at timestamptz not null default now()
);

-- If an earlier migration created the table without 'reputation', widen the check.
alter table public.forecast_recommendations
  drop constraint if exists forecast_recommendations_category_check;
alter table public.forecast_recommendations
  add constraint forecast_recommendations_category_check
  check (category in (
    'staffing', 'promotion', 'facilities', 'maintenance', 'revenue', 'reputation'
  ));

create index if not exists forecast_recommendations_run_idx
  on public.forecast_recommendations (forecast_run_id);

-- ---------------------------------------------------------------------------
-- RLS — staff read/write (reuses public.is_staff())
-- ---------------------------------------------------------------------------
alter table public.booking_monthly_history enable row level security;
alter table public.booking_forecasts enable row level security;
alter table public.forecast_recommendations enable row level security;

drop policy if exists "Staff read booking_monthly_history" on public.booking_monthly_history;
create policy "Staff read booking_monthly_history" on public.booking_monthly_history
  for select using (public.is_staff());

drop policy if exists "Staff write booking_monthly_history" on public.booking_monthly_history;
create policy "Staff write booking_monthly_history" on public.booking_monthly_history
  for all using (public.is_staff())
  with check (public.is_staff());

drop policy if exists "Staff read booking_forecasts" on public.booking_forecasts;
create policy "Staff read booking_forecasts" on public.booking_forecasts
  for select using (public.is_staff());

drop policy if exists "Staff write booking_forecasts" on public.booking_forecasts;
create policy "Staff write booking_forecasts" on public.booking_forecasts
  for all using (public.is_staff())
  with check (public.is_staff());

drop policy if exists "Staff read forecast_recommendations" on public.forecast_recommendations;
create policy "Staff read forecast_recommendations" on public.forecast_recommendations
  for select using (public.is_staff());

drop policy if exists "Staff write forecast_recommendations" on public.forecast_recommendations;
create policy "Staff write forecast_recommendations" on public.forecast_recommendations
  for all using (public.is_staff())
  with check (public.is_staff());

-- Realtime so the admin Predictive Analytics page refreshes when forecasts update.
do $$
begin
  alter publication supabase_realtime add table public.booking_forecasts;
exception
  when duplicate_object then null;
end $$;

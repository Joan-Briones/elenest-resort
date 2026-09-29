-- FIX: Run this if you already ran the old schema and see "infinite recursion" errors.

create or replace function public.current_user_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid()),
    'guest'
  );
$$;

create or replace function public.is_staff()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.current_user_role() in ('admin', 'manager', 'receptionist');
$$;

create or replace function public.is_manager_or_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.current_user_role() in ('admin', 'manager');
$$;

drop policy if exists "Staff can view all profiles" on public.profiles;
create policy "Staff can view all profiles"
  on public.profiles for select
  using (public.is_staff());

drop policy if exists "Staff manage all bookings" on public.bookings;
create policy "Staff manage all bookings"
  on public.bookings for all
  using (public.is_staff());

drop policy if exists "Managers edit about content" on public.content_about;
create policy "Managers edit about content"
  on public.content_about for all
  using (public.is_manager_or_admin());

drop policy if exists "Managers edit faqs" on public.content_faqs;
create policy "Managers edit faqs"
  on public.content_faqs for all
  using (public.is_manager_or_admin());

drop policy if exists "Managers edit activities" on public.content_activities;
create policy "Managers edit activities"
  on public.content_activities for all
  using (public.is_manager_or_admin());

drop policy if exists "Profiles insert own" on public.profiles;
create policy "Profiles insert own"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "Guests update own bookings" on public.bookings;
create policy "Guests update own bookings"
  on public.bookings for update
  using (lower(user_email) = lower(coalesce(auth.jwt() ->> 'email', '')));

create or replace function public.get_booking_occupancy()
returns table (check_in date, check_out date, status text)
language sql
security definer
set search_path = public
stable
as $$
  select b.check_in, b.check_out, b.status
  from public.bookings b
  where b.check_in is not null and b.check_out is not null;
$$;

grant execute on function public.get_booking_occupancy() to anon, authenticated;

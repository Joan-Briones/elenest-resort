-- Homepage counters (public-safe aggregates, no PII)
-- Run once in Supabase SQL Editor.

create or replace function public.get_homepage_stats()
returns json
language sql
security definer
set search_path = public
stable
as $$
  select json_build_object(
    'customers', (
      select count(*)::int
      from (
        select lower(trim(email)) as email
        from public.profiles
        where role = 'guest'
          and coalesce(trim(email), '') <> ''
        union
        select lower(trim(user_email))
        from public.bookings
        where coalesce(trim(user_email), '') <> ''
        union
        select lower(trim(guest_email))
        from public.guest_feedback
        where coalesce(trim(guest_email), '') <> ''
      ) guests
    ),
    'positive_feedback', (
      select count(*)::int
      from public.guest_feedback
      where stars >= 4
         or lower(trim(coalesce(sentiment, ''))) in ('pos', 'positive')
    )
  );
$$;

revoke all on function public.get_homepage_stats() from public;
grant execute on function public.get_homepage_stats() to anon, authenticated;

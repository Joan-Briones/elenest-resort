-- Enable live staff/customer notification inbox updates.
-- Run in Supabase Dashboard → SQL Editor.

do $$
begin
  begin
    alter publication supabase_realtime add table public.notifications;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;
end $$;

alter table public.notifications replica identity full;

drop policy if exists "Users delete own notifications" on public.notifications;
create policy "Users delete own notifications" on public.notifications for delete
  using (user_id = auth.uid() or lower(user_email) = public.current_user_email());

drop policy if exists "Users insert own notifications" on public.notifications;
create policy "Users insert own notifications" on public.notifications for insert
  with check (user_id = auth.uid() or lower(user_email) = public.current_user_email());

drop policy if exists "Users read own notifications" on public.notifications;
create policy "Users read own notifications" on public.notifications for select
  using (user_id = auth.uid() or lower(user_email) = public.current_user_email());

drop policy if exists "Staff insert customer notifications" on public.notifications;
create policy "Staff insert customer notifications" on public.notifications for insert
  with check (public.is_staff());

-- Store the notice on the customer's profile, not the admin who created it.
create or replace function public.fill_user_id_from_auth()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  em text;
begin
  if tg_table_name = 'notifications' and coalesce(new.user_email, '') <> '' then
    select p.id into new.user_id
    from public.profiles p
    where lower(p.email) = lower(new.user_email)
    limit 1;
    if new.user_id is not null then
      return new;
    end if;
  end if;

  if new.user_id is not null then
    return new;
  end if;

  if auth.uid() is not null and tg_table_name <> 'notifications' then
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

  if new.user_id is null and auth.uid() is not null then
    new.user_id := auth.uid();
  end if;

  return new;
end;
$$;

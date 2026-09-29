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

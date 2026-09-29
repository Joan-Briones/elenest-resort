-- Moments at Elenest gallery (homepage carousel)
-- Run once in Supabase SQL Editor if the table is missing.
-- Live shape: id, title, image, sort_order, created_at, updated_at

create table if not exists public.content_gallery (
  id          text primary key,
  title       text not null default '',
  image       text not null default '',
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists content_gallery_sort_order_idx on public.content_gallery (sort_order);

alter table public.content_gallery enable row level security;

drop policy if exists "Public read content gallery" on public.content_gallery;
drop policy if exists "Managers edit content gallery" on public.content_gallery;

create policy "Public read content gallery" on public.content_gallery for select using (true);
create policy "Managers edit content gallery" on public.content_gallery for all using (public.is_manager_or_admin());

do $$
begin
  begin alter publication supabase_realtime add table public.content_gallery; exception when others then null; end;
end $$;

-- Multiple photos per facility (Content Management → Facilities).
-- Run in Supabase Dashboard → SQL Editor.

alter table public.room_catalog
  add column if not exists images jsonb not null default '[]'::jsonb;

comment on column public.room_catalog.images is 'Gallery photos for each room/cottage/hall. First image is also stored in image.';

update public.room_catalog
set images = case
  when image is not null and image <> '' then jsonb_build_array(image)
  else '[]'::jsonb
end
where images = '[]'::jsonb;

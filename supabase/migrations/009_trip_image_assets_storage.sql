-- Public storage bucket for generated OurTrips image assets written by the MCP server.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'trip-image-assets',
  'trip-image-assets',
  true,
  10485760,
  array['image/png', 'image/webp', 'image/jpeg']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

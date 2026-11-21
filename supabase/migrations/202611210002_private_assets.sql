insert into storage.buckets (id, name, public)
values ('private-assets', 'private-assets', false)
on conflict (id) do update
set public = false;

create policy "private_assets_read_privileged"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'private-assets'
  and public.has_role('admin', 'project_manager')
);

create policy "private_assets_insert_privileged"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'private-assets'
  and name = 'riyad-sig.png'
  and public.has_role('admin', 'project_manager')
);

create policy "private_assets_update_privileged"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'private-assets'
  and name = 'riyad-sig.png'
  and public.has_role('admin', 'project_manager')
)
with check (
  bucket_id = 'private-assets'
  and name = 'riyad-sig.png'
  and public.has_role('admin', 'project_manager')
);

create or replace function public.delete_school_size_correction(p_school_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  correction public.school_size_corrections%rowtype;
begin
  if auth.uid() is null or not public.has_role('admin', 'project_manager') then
    raise exception 'غير مصرح بإلغاء تصحيح حجم المدرسة';
  end if;

  select * into correction
  from public.school_size_corrections
  where school_id = p_school_id
  for update;
  if not found then
    raise exception 'لا يوجد تصحيح حجم لإلغائه';
  end if;

  delete from public.school_size_corrections
  where school_id = correction.school_id;

  insert into public.audit_log(actor, action, table_name, row_id, details)
  values (
    auth.uid(),
    'DELETE',
    'school_size_corrections',
    correction.school_id::text,
    jsonb_build_object(
      'corrected_size', correction.corrected_size,
      'updated_by', correction.updated_by,
      'updated_at', correction.updated_at
    )
  );
end;
$$;

revoke all on function public.delete_school_size_correction(uuid) from public, anon, authenticated;
grant execute on function public.delete_school_size_correction(uuid) to authenticated;

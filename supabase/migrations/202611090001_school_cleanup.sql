create or replace function public.school_cleanup_link_counts(p_school_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'cleaner_assignments', (select count(*)::integer from public.cleaner_assignments where school_id = p_school_id),
    'school_size_corrections', (select count(*)::integer from public.school_size_corrections where school_id = p_school_id),
    'staffing_exceptions', (select count(*)::integer from public.staffing_exceptions where school_id = p_school_id),
    'gatekeepers', (select count(*)::integer from public.gatekeepers where school_id = p_school_id),
    'monthly_plan_rows', (select count(*)::integer from public.monthly_plan_rows where school_id = p_school_id),
    'general_plan_rows', (select count(*)::integer from public.general_plan_rows where school_id = p_school_id),
    'custom_plan_rows', (select count(*)::integer from public.custom_plan_rows where school_id = p_school_id)
  );
$$;
revoke all on function public.school_cleanup_link_counts(uuid) from public, anon, authenticated;

create or replace function public.admin_school_cleanup_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.has_role('admin') then
    raise exception 'غير مصرح: تنظيف المدارس متاح لمدير النظام فقط';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'ministry_no', s.ministry_no,
      'ministry_key', s.ministry_key,
      'name', s.name,
      'source_key', s.source_key,
      'source_row', s.source_row,
      'missing_from_sheet_at', s.missing_from_sheet_at,
      'link_counts', links.counts,
      'live_twins', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', live.id,
          'ministry_no', live.ministry_no,
          'name', live.name,
          'source_row', live.source_row
        ) order by live.source_row nulls last, live.name)
        from public.schools live
        where live.missing_from_sheet_at is null
          and live.id <> s.id
          and live.ministry_key = s.ministry_key
      ), '[]'::jsonb)
    ) order by s.source_row nulls last, s.name
  ), '[]'::jsonb)
  into result
  from public.schools s
  cross join lateral (select public.school_cleanup_link_counts(s.id) as counts) links
  where s.missing_from_sheet_at is not null;

  return result;
end;
$$;
revoke all on function public.admin_school_cleanup_list() from public, anon;
grant execute on function public.admin_school_cleanup_list() to authenticated;

create or replace function public.admin_school_cleanup_backup(p_school_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.has_role('admin') then
    raise exception 'غير مصرح: النسخ الاحتياطي متاح لمدير النظام فقط';
  end if;
  if coalesce(cardinality(p_school_ids), 0) = 0 then
    raise exception 'يجب تحديد مدرسة واحدة على الأقل للنسخ الاحتياطي';
  end if;
  if (select count(distinct id) from unnest(p_school_ids) as ids(id))
    <> (select count(*) from public.schools where id = any(p_school_ids)) then
    raise exception 'تعذر العثور على جميع المدارس المطلوبة للنسخ الاحتياطي';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'school', to_jsonb(s),
    'cleaner_assignments', coalesce((
      select jsonb_agg(to_jsonb(a)) from public.cleaner_assignments a where a.school_id = s.id
    ), '[]'::jsonb),
    'school_size_corrections', coalesce((
      select jsonb_agg(to_jsonb(c)) from public.school_size_corrections c where c.school_id = s.id
    ), '[]'::jsonb),
    'staffing_exceptions', coalesce((
      select jsonb_agg(to_jsonb(x)) from public.staffing_exceptions x where x.school_id = s.id
    ), '[]'::jsonb),
    'gatekeepers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id, 'school_id', g.school_id, 'employee_id', g.employee_id,
        'full_name', g.full_name, 'employee_no', g.employee_no, 'phone', g.phone,
        'notes', g.notes, 'created_at', g.created_at, 'updated_at', g.updated_at
      )) from public.gatekeepers g where g.school_id = s.id
    ), '[]'::jsonb),
    'monthly_plan_rows', coalesce((
      select jsonb_agg(to_jsonb(r)) from public.monthly_plan_rows r where r.school_id = s.id
    ), '[]'::jsonb),
    'general_plan_rows', coalesce((
      select jsonb_agg(to_jsonb(r)) from public.general_plan_rows r where r.school_id = s.id
    ), '[]'::jsonb),
    'custom_plan_rows', coalesce((
      select jsonb_agg(to_jsonb(r)) from public.custom_plan_rows r where r.school_id = s.id
    ), '[]'::jsonb)
  ) order by s.name), '[]'::jsonb)
  into result
  from public.schools s
  where s.id = any(p_school_ids);

  return result;
end;
$$;
revoke all on function public.admin_school_cleanup_backup(uuid[]) from public, anon;
grant execute on function public.admin_school_cleanup_backup(uuid[]) to authenticated;

create or replace function public.admin_cleanup_school(
  p_action text,
  p_school_id uuid,
  p_target_id uuid default null,
  p_confirmation text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  source_school public.schools%rowtype;
  target_school public.schools%rowtype;
  links jsonb;
  linked_count integer;
begin
  if not public.has_role('admin') then
    raise exception 'غير مصرح: تنظيف المدارس متاح لمدير النظام فقط';
  end if;
  if p_action is null or p_action not in ('merge', 'delete') then
    raise exception 'عملية تنظيف المدارس غير مدعومة';
  end if;

  select * into source_school
  from public.schools
  where id = p_school_id and missing_from_sheet_at is not null
  for update;
  if not found then
    raise exception 'المدرسة غير موجودة ضمن السجلات الغائبة عن المصدر';
  end if;

  links := public.school_cleanup_link_counts(source_school.id);
  select coalesce(sum(value::integer), 0)::integer into linked_count
  from jsonb_each_text(links);

  if p_action = 'delete' then
    if linked_count > 0 and p_confirmation is distinct from 'مع حذف البيانات المرتبطة' then
      raise exception 'توجد بيانات مرتبطة؛ اكتب "مع حذف البيانات المرتبطة" لتأكيد حذفها';
    end if;
    delete from public.cleaner_assignments where school_id = source_school.id;
    delete from public.school_size_corrections where school_id = source_school.id;
    delete from public.staffing_exceptions where school_id = source_school.id;
    delete from public.gatekeepers where school_id = source_school.id;
    delete from public.monthly_plan_rows where school_id = source_school.id;
    delete from public.general_plan_rows where school_id = source_school.id;
    delete from public.custom_plan_rows where school_id = source_school.id;
    delete from public.schools where id = source_school.id;

    insert into public.audit_log(actor, action, table_name, row_id, details)
    values (auth.uid(), 'cleanup_school_delete', 'schools', source_school.id,
      jsonb_build_object('link_counts', links, 'deleted_links', linked_count));
    return jsonb_build_object('action', p_action, 'school_id', source_school.id, 'deleted_links', linked_count);
  end if;

  if p_target_id is null or p_target_id = p_school_id then
    raise exception 'اختر مدرسة حالية مختلفة لإتمام الدمج';
  end if;
  select * into target_school
  from public.schools
  where id = p_target_id and missing_from_sheet_at is null
  for update;
  if not found then
    raise exception 'المدرسة المستهدفة غير موجودة أو لم تعد حالية';
  end if;
  if target_school.ministry_key is distinct from source_school.ministry_key then
    raise exception 'لا يمكن دمج مدرستين لا تتطابق أرقامهما الوزارية بعد التطبيع';
  end if;

  update public.cleaner_assignments
    set school_id = target_school.id
    where school_id = source_school.id;

  delete from public.school_size_corrections source_row
  where source_row.school_id = source_school.id
    and exists (select 1 from public.school_size_corrections target_row where target_row.school_id = target_school.id);
  update public.school_size_corrections
    set school_id = target_school.id
    where school_id = source_school.id;

  delete from public.staffing_exceptions source_row
  where source_row.school_id = source_school.id
    and exists (select 1 from public.staffing_exceptions target_row where target_row.school_id = target_school.id);
  update public.staffing_exceptions
    set school_id = target_school.id
    where school_id = source_school.id;

  update public.gatekeepers target_row
  set employee_id = coalesce(target_row.employee_id, source_row.employee_id),
      employee_no = coalesce(target_row.employee_no, source_row.employee_no),
      phone = coalesce(target_row.phone, source_row.phone),
      notes = coalesce(target_row.notes, source_row.notes),
      residence_no = coalesce(target_row.residence_no, source_row.residence_no)
  from public.gatekeepers source_row
  where target_row.school_id = target_school.id and source_row.school_id = source_school.id;
  delete from public.gatekeepers source_row
  where source_row.school_id = source_school.id
    and exists (select 1 from public.gatekeepers target_row where target_row.school_id = target_school.id);
  update public.gatekeepers set school_id = target_school.id where school_id = source_school.id;

  update public.monthly_plan_rows target_row
  set planned_date = coalesce(target_row.planned_date, source_row.planned_date),
      engineer_id = coalesce(target_row.engineer_id, source_row.engineer_id),
      engineer_name = coalesce(target_row.engineer_name, source_row.engineer_name),
      supervisor_id = coalesce(target_row.supervisor_id, source_row.supervisor_id),
      supervisor_name = coalesce(target_row.supervisor_name, source_row.supervisor_name),
      contractor_name = coalesce(target_row.contractor_name, source_row.contractor_name),
      notes = coalesce(nullif(concat_ws(E'\n', nullif(target_row.notes, ''), nullif(source_row.notes, '')), ''), target_row.notes, source_row.notes),
      visited = target_row.visited or source_row.visited or target_row.report_done or source_row.report_done,
      visited_date = coalesce(target_row.visited_date, source_row.visited_date),
      report_done = target_row.report_done or source_row.report_done,
      report_done_date = coalesce(target_row.report_done_date, source_row.report_done_date)
  from public.monthly_plan_rows source_row
  where target_row.plan_id = source_row.plan_id
    and target_row.school_id = target_school.id
    and source_row.school_id = source_school.id;
  delete from public.monthly_plan_rows source_row
  where source_row.school_id = source_school.id
    and exists (select 1 from public.monthly_plan_rows target_row
      where target_row.plan_id = source_row.plan_id and target_row.school_id = target_school.id);
  update public.monthly_plan_rows set school_id = target_school.id where school_id = source_school.id;

  update public.custom_plan_rows target_row
  set planned_date = coalesce(target_row.planned_date, source_row.planned_date),
      execution_date = coalesce(target_row.execution_date, source_row.execution_date),
      status = case
        when target_row.status in ('planned', 'cancelled') and source_row.status in ('in_progress', 'done') then source_row.status
        else target_row.status
      end,
      supervisor_id = coalesce(target_row.supervisor_id, source_row.supervisor_id),
      supervisor_name = coalesce(target_row.supervisor_name, source_row.supervisor_name),
      engineer_name = coalesce(target_row.engineer_name, source_row.engineer_name),
      contractor_name = coalesce(target_row.contractor_name, source_row.contractor_name),
      notes = coalesce(nullif(concat_ws(E'\n', nullif(target_row.notes, ''), nullif(source_row.notes, '')), ''), target_row.notes, source_row.notes),
      visited = coalesce(target_row.visited, false) or coalesce(source_row.visited, false)
        or coalesce(target_row.report_done, false) or coalesce(source_row.report_done, false),
      visited_date = coalesce(target_row.visited_date, source_row.visited_date),
      report_done = coalesce(target_row.report_done, false) or coalesce(source_row.report_done, false),
      report_done_date = coalesce(target_row.report_done_date, source_row.report_done_date)
  from public.custom_plan_rows source_row
  where target_row.plan_id = source_row.plan_id
    and target_row.school_id = target_school.id
    and source_row.school_id = source_school.id;
  delete from public.custom_plan_rows source_row
  where source_row.school_id = source_school.id
    and exists (select 1 from public.custom_plan_rows target_row
      where target_row.plan_id = source_row.plan_id and target_row.school_id = target_school.id);
  update public.custom_plan_rows set school_id = target_school.id where school_id = source_school.id;

  update public.general_plan_rows set school_id = target_school.id where school_id = source_school.id;
  delete from public.schools where id = source_school.id;

  insert into public.audit_log(actor, action, table_name, row_id, details)
  values (auth.uid(), 'cleanup_school_merge', 'schools', source_school.id,
    jsonb_build_object('target_school_id', target_school.id, 'link_counts', links));
  return jsonb_build_object('action', p_action, 'school_id', source_school.id, 'target_school_id', target_school.id, 'moved_links', linked_count);
end;
$$;
revoke all on function public.admin_cleanup_school(text, uuid, uuid, text) from public, anon;
grant execute on function public.admin_cleanup_school(text, uuid, uuid, text) to authenticated;

create or replace function public.admin_bulk_delete_unlinked_schools(p_school_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate_id uuid;
  deleted_count integer := 0;
  outcome jsonb;
begin
  if not public.has_role('admin') then
    raise exception 'غير مصرح: تنظيف المدارس متاح لمدير النظام فقط';
  end if;
  if coalesce(cardinality(p_school_ids), 0) = 0 then
    raise exception 'لا توجد مدارس محددة للحذف الجماعي';
  end if;

  for candidate_id in
    select distinct id from unnest(p_school_ids) as ids(id)
  loop
    if not exists (
      select 1 from public.schools s
      where s.id = candidate_id and s.missing_from_sheet_at is not null
    ) then
      raise exception 'يمكن حذف السجلات الغائبة عن المصدر فقط';
    end if;
    outcome := public.admin_cleanup_school('delete', candidate_id, null, null);
    if outcome is null then
      raise exception 'تعذر حذف المدرسة %', candidate_id;
    end if;
    deleted_count := deleted_count + 1;
  end loop;

  insert into public.audit_log(actor, action, table_name, details)
  values (auth.uid(), 'cleanup_school_bulk_delete', 'schools',
    jsonb_build_object('deleted_schools', deleted_count, 'school_ids', p_school_ids));
  return jsonb_build_object('deleted_schools', deleted_count);
end;
$$;
revoke all on function public.admin_bulk_delete_unlinked_schools(uuid[]) from public, anon;
grant execute on function public.admin_bulk_delete_unlinked_schools(uuid[]) to authenticated;

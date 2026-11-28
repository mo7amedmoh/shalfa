create or replace function public.bulk_update_general_plan_rows(
  p_updates jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  row_id uuid;
  v_plan_id uuid;
  row_count integer := 0;
  updated_ids uuid[] := '{}';
  updated_plan_ids uuid[] := '{}';
begin
  if not public.has_role('admin', 'project_manager', 'area_engineer') then
    raise exception 'غير مصرح بالتحديث الجماعي للخطة العامة';
  end if;
  if jsonb_typeof(p_updates) <> 'array' then
    raise exception 'تحديثات الخطة العامة يجب أن تكون قائمة';
  end if;
  if jsonb_array_length(p_updates) > 500 then
    raise exception 'لا يمكن تحديث أكثر من 500 صف في الدفعة الواحدة';
  end if;

  for item in select value from jsonb_array_elements(p_updates)
  loop
    if jsonb_typeof(item) <> 'object'
      or coalesce(item->>'row_id', '') = ''
      or coalesce(item->>'plan_id', '') = '' then
      raise exception 'كل تحديث يجب أن يتضمن معرّف الخطة والصف';
    end if;
    row_id := (item->>'row_id')::uuid;
    v_plan_id := (item->>'plan_id')::uuid;
    if row_id = any(updated_ids) then
      raise exception 'تكرر الصف % في التحديثات', row_id;
    end if;
    if not (item ? 'status' or item ? 'execution_date' or item ? 'report_done' or item ? 'report_done_date') then
      raise exception 'يجب أن يتضمن التحديث حقلاً واحداً على الأقل';
    end if;
    if item ? 'status' and coalesce(item->>'status', '') not in ('planned', 'in_progress', 'done', 'cancelled') then
      raise exception 'حالة تنفيذ غير صالحة';
    end if;
    if item ? 'report_done' and coalesce(item->>'report_done', '') not in ('true', 'false') then
      raise exception 'حالة التقرير غير صالحة';
    end if;

    perform 1
    from public.general_plan_rows r
    where r.id = row_id and r.plan_id = v_plan_id
    for update;
    if not found then
      raise exception 'الصف % غير موجود ضمن الخطة المحددة', row_id;
    end if;

    update public.general_plan_rows r
    set status = case when item ? 'status' then (item->>'status')::public.work_status else r.status end,
        execution_date = case when item ? 'execution_date' then nullif(item->>'execution_date', '')::date else r.execution_date end,
        report_done = case when item ? 'report_done' then (item->>'report_done')::boolean else r.report_done end,
        report_done_date = case when item ? 'report_done_date' then nullif(item->>'report_done_date', '')::date else r.report_done_date end
    where r.id = row_id and r.plan_id = v_plan_id;

    updated_ids := array_append(updated_ids, row_id);
    if not v_plan_id = any(updated_plan_ids) then
      updated_plan_ids := array_append(updated_plan_ids, v_plan_id);
    end if;
    row_count := row_count + 1;
  end loop;

  if row_count = 0 then
    raise exception 'لم يتم تحديد صفوف للتحديث';
  end if;

  insert into public.audit_log(actor, action, table_name, row_id, details)
  values (
    auth.uid(),
    'bulk_update_general_plan_rows',
    'general_plan_rows',
    null,
    jsonb_build_object('rows', row_count, 'plan_ids', updated_plan_ids)
  );

  return jsonb_build_object('rows', row_count);
end;
$$;

revoke all on function public.bulk_update_general_plan_rows(jsonb) from public, anon;
grant execute on function public.bulk_update_general_plan_rows(jsonb) to authenticated;

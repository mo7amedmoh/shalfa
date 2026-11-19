create or replace function public.set_plan_row_edit_state(
  p_audit_id bigint,
  p_direction text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  source_event public.audit_log;
  latest_action text;
  changes jsonb;
  change_item record;
  current_row jsonb;
  target_values jsonb := '{}'::jsonb;
  applied_changes jsonb := '{}'::jsonb;
  target_row_id uuid;
  expected_value jsonb;
  next_value jsonb;
begin
  if not public.has_role('admin') then
    raise exception 'غير مصرح بتنفيذ التراجع أو الإعادة';
  end if;
  if p_direction is null or p_direction not in ('undo', 'redo') then
    raise exception 'اتجاه العملية غير صالح';
  end if;

  select * into source_event
  from public.audit_log
  where id = p_audit_id and action = 'edit_plan_row'
  for share;
  if not found then
    raise exception 'عملية التعديل غير موجودة أو غير قابلة للاستعادة';
  end if;
  if source_event.table_name is null
    or source_event.table_name not in ('monthly_plan_rows', 'general_plan_rows', 'custom_plan_rows') then
    raise exception 'نوع سجل الخطة غير مدعوم للتراجع';
  end if;
  if coalesce(source_event.details, '{}'::jsonb) ? 'swap_row_id' then
    raise exception 'تراجع تبديل الصفوف غير مدعوم من سجل التدقيق';
  end if;

  select action into latest_action
  from public.audit_log
  where action in ('undo_plan_row_edit', 'redo_plan_row_edit')
    and details->>'source_audit_id' = p_audit_id::text
  order by at desc, id desc
  limit 1;
  if (p_direction = 'undo' and latest_action = 'undo_plan_row_edit')
    or (p_direction = 'redo' and latest_action is distinct from 'undo_plan_row_edit') then
    raise exception 'حالة العملية تغيّرت؛ حدّث سجل التدقيق وحاول مجددًا';
  end if;

  changes := source_event.details->'changes';
  if jsonb_typeof(changes) is distinct from 'object' or changes = '{}'::jsonb
    or (changes - array['school_id', 'supervisor_id', 'planned_date']) <> '{}'::jsonb then
    raise exception 'تفاصيل التعديل لا تحتوي على تغييرات قابلة للاستعادة';
  end if;
  if source_event.row_id is null then
    raise exception 'معرّف صف الخطة غير موجود';
  end if;
  target_row_id := source_event.row_id::uuid;

  execute format(
    'select to_jsonb(r) from public.%I r where r.id = $1 for update',
    source_event.table_name
  ) into current_row using target_row_id;
  if current_row is null then
    raise exception 'صف الخطة غير موجود؛ تعذر التراجع أو الإعادة';
  end if;

  for change_item in select key, value from jsonb_each(changes)
  loop
    if jsonb_typeof(change_item.value) <> 'object'
      or not (change_item.value ? 'old')
      or not (change_item.value ? 'new') then
      raise exception 'تفاصيل التعديل غير مكتملة';
    end if;
    expected_value := case when p_direction = 'undo'
      then change_item.value->'new' else change_item.value->'old' end;
    next_value := case when p_direction = 'undo'
      then change_item.value->'old' else change_item.value->'new' end;
    if current_row->change_item.key is distinct from expected_value then
      raise exception 'تغيرت قيم الصف بعد العملية؛ لن يتم الكتابة فوق التغيير الأحدث';
    end if;
    target_values := jsonb_set(target_values, array[change_item.key], next_value, true);
    applied_changes := applied_changes || jsonb_build_object(
      change_item.key,
      jsonb_build_object('old', expected_value, 'new', next_value)
    );
  end loop;

  execute format(
    'update public.%I
     set school_id = case when $2 ? ''school_id'' then ($2->>''school_id'')::uuid else school_id end,
         supervisor_id = case when $2 ? ''supervisor_id'' then ($2->>''supervisor_id'')::uuid else supervisor_id end,
         planned_date = case when $2 ? ''planned_date'' then ($2->>''planned_date'')::date else planned_date end,
         edited_at = now(),
         edited_by = auth.uid()
     where id = $1',
    source_event.table_name
  ) using target_row_id, target_values;

  insert into public.audit_log(actor, action, table_name, row_id, details)
  values (
    auth.uid(),
    case when p_direction = 'undo' then 'undo_plan_row_edit' else 'redo_plan_row_edit' end,
    source_event.table_name,
    source_event.row_id,
    jsonb_build_object(
      'source_audit_id', p_audit_id,
      'changes', applied_changes
    )
  );
end;
$$;

revoke all on function public.set_plan_row_edit_state(bigint, text) from public, anon;
grant execute on function public.set_plan_row_edit_state(bigint, text) to authenticated;

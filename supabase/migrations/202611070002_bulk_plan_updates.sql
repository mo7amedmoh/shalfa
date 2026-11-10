alter table public.custom_plan_rows
  add column if not exists visited_date date,
  add column if not exists report_done_date date;

drop policy if exists custom_rows_update on public.custom_plan_rows;
create policy custom_rows_update on public.custom_plan_rows for update to authenticated
using (public.has_role('admin', 'project_manager', 'area_engineer', 'report_follower'))
with check (public.has_role('admin', 'project_manager', 'area_engineer', 'report_follower'));

create or replace function public.guard_custom_plan_row_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.report_done and not new.visited and
    (new.report_done is distinct from old.report_done or new.report_done_date is distinct from old.report_done_date) then
    raise exception 'لا يمكن إكمال التقرير قبل تسجيل الزيارة';
  end if;
  if public.current_user_role() = 'report_follower' and
    (new.plan_id, new.school_id, new.planned_date, new.execution_date, new.status,
     new.supervisor_id, new.supervisor_name, new.engineer_name, new.contractor_name, new.notes)
    is distinct from
    (old.plan_id, old.school_id, old.planned_date, old.execution_date, old.status,
     old.supervisor_id, old.supervisor_name, old.engineer_name, old.contractor_name, old.notes) then
    raise exception 'غير مصرح: متابع التقارير يستطيع تحديث حالة الزيارة والتقرير فقط';
  end if;
  return new;
end;
$$;

drop trigger if exists custom_plan_row_update_guard on public.custom_plan_rows;
create trigger custom_plan_row_update_guard
before update on public.custom_plan_rows
for each row execute function public.guard_custom_plan_row_update();

create or replace function public.guard_plan_row_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.report_done and not new.visited and
    (new.report_done is distinct from old.report_done or new.report_done_date is distinct from old.report_done_date) then
    raise exception 'لا يمكن إكمال التقرير قبل تسجيل الزيارة';
  end if;
  if public.current_user_role() = 'report_follower' then
    if (new.plan_id, new.school_id, new.planned_date, new.engineer_id, new.supervisor_id, new.contractor_name)
       is distinct from (old.plan_id, old.school_id, old.planned_date, old.engineer_id, old.supervisor_id, old.contractor_name) then
      raise exception 'غير مصرح: متابع التقارير يستطيع تحديث حالة الزيارة والتقرير فقط';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.bulk_update_plan_rows(
  p_plan_kind text,
  p_plan_id uuid,
  p_updates jsonb,
  p_counts jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  row_id uuid;
  old_visit_date date;
  old_report_date date;
  next_visit_date date;
  next_report_date date;
  old_visited boolean;
  old_report_done boolean;
  next_visited boolean;
  next_report_done boolean;
  row_count integer := 0;
  visits_count integer := 0;
  reports_count integer := 0;
  cleared_count integer := 0;
begin
  if not public.has_role('admin', 'project_manager', 'area_engineer', 'report_follower') then
    raise exception 'غير مصرح بالتحديث الجماعي';
  end if;
  if p_plan_kind not in ('monthly', 'custom') then
    raise exception 'نوع الخطة غير مدعوم';
  end if;
  if jsonb_typeof(p_updates) <> 'array' then
    raise exception 'تحديثات الخطة يجب أن تكون قائمة';
  end if;

  for item in select value from jsonb_array_elements(p_updates)
  loop
    row_id := (item->>'row_id')::uuid;
    if p_plan_kind = 'monthly' then
      select r.visited_date, r.report_done_date, r.visited, r.report_done
        into old_visit_date, old_report_date, old_visited, old_report_done
      from public.monthly_plan_rows r
      where r.id = row_id and r.plan_id = p_plan_id
      for update;
    else
      select r.visited_date, r.report_done_date, r.visited, r.report_done
        into old_visit_date, old_report_date, old_visited, old_report_done
      from public.custom_plan_rows r
      where r.id = row_id and r.plan_id = p_plan_id
      for update;
    end if;
    if not found then
      raise exception 'الصف % غير موجود ضمن الفترة المختارة', row_id;
    end if;

    next_visit_date := case when item ? 'visited_date' then nullif(item->>'visited_date', '')::date else old_visit_date end;
    next_report_date := case when item ? 'report_date' then nullif(item->>'report_date', '')::date else old_report_date end;
    next_visited := case when item ? 'visited_date' then next_visit_date is not null else coalesce(old_visited, old_visit_date is not null) end;
    next_report_done := case when item ? 'report_date' then next_report_date is not null else coalesce(old_report_done, old_report_date is not null) end;
    if next_report_done and not next_visited then
      raise exception 'لا يمكن إكمال التقرير قبل تسجيل الزيارة للصف %', row_id;
    end if;

    if p_plan_kind = 'monthly' then
      update public.monthly_plan_rows
      set visited_date = next_visit_date, visited = next_visited,
          report_done_date = next_report_date, report_done = next_report_done
      where id = row_id and plan_id = p_plan_id;
    else
      update public.custom_plan_rows
      set visited_date = next_visit_date, visited = next_visited,
          report_done_date = next_report_date, report_done = next_report_done
      where id = row_id and plan_id = p_plan_id;
    end if;

    row_count := row_count + 1;
    if item ? 'visited_date' and next_visited then visits_count := visits_count + 1; end if;
    if item ? 'report_date' and next_report_done then reports_count := reports_count + 1; end if;
    if item ? 'visited_date' and item ? 'report_date'
      and next_visit_date is null and next_report_date is null then
      cleared_count := cleared_count + 1;
    end if;
  end loop;

  if row_count = 0 and coalesce(p_counts, '{}'::jsonb) = '{}'::jsonb then
    return jsonb_build_object('rows', 0, 'visits_marked', 0, 'reports_marked', 0, 'rows_cleared', 0);
  end if;

  insert into public.audit_log(actor, action, table_name, row_id, details)
  values (
    auth.uid(),
    'bulk_update_plan_rows',
    case when p_plan_kind = 'monthly' then 'monthly_plan_rows' else 'custom_plan_rows' end,
    p_plan_id,
    jsonb_build_object(
      'plan_kind', p_plan_kind,
      'rows', row_count,
      'visits_marked', visits_count,
      'reports_marked', reports_count,
      'rows_cleared', cleared_count,
      'preview_counts', coalesce(p_counts, '{}'::jsonb)
    )
  );
  return jsonb_build_object(
    'rows', row_count,
    'visits_marked', visits_count,
    'reports_marked', reports_count,
    'rows_cleared', cleared_count
  );
end;
$$;

revoke all on function public.bulk_update_plan_rows(text, uuid, jsonb, jsonb) from public;
grant execute on function public.bulk_update_plan_rows(text, uuid, jsonb, jsonb) to authenticated;

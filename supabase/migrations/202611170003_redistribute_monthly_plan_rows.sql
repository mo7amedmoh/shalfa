create table if not exists public.plan_holidays (
  holiday_date date primary key,
  name text not null check (length(btrim(name)) > 0),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.plan_holidays enable row level security;
grant select, insert, update, delete on public.plan_holidays to authenticated;

drop policy if exists plan_holidays_read on public.plan_holidays;
create policy plan_holidays_read on public.plan_holidays
for select to authenticated
using (public.is_member());

drop policy if exists plan_holidays_insert on public.plan_holidays;
create policy plan_holidays_insert on public.plan_holidays
for insert to authenticated
with check (public.has_role('admin', 'project_manager') and created_by = auth.uid());

drop policy if exists plan_holidays_update on public.plan_holidays;
create policy plan_holidays_update on public.plan_holidays
for update to authenticated
using (public.has_role('admin', 'project_manager'))
with check (public.has_role('admin', 'project_manager') and created_by = auth.uid());

drop policy if exists plan_holidays_delete on public.plan_holidays;
create policy plan_holidays_delete on public.plan_holidays
for delete to authenticated
using (public.has_role('admin', 'project_manager'));

create or replace function public.redistribute_monthly_plan_rows(
  p_plan_id uuid,
  p_start_date date,
  p_end_date date,
  p_daily_limit integer,
  p_updates jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  row_data record;
  row_id uuid;
  old_date date;
  next_date date;
  supervisor_key text;
  supervisor_label text;
  supervisor_load integer;
  eligible_count integer;
  updated_count integer := 0;
  seen_ids uuid[] := '{}';
  audit_reason text;
begin
  if not public.has_role('admin', 'project_manager') then
    raise exception 'غير مصرح بإعادة توزيع الخطة';
  end if;
  if p_plan_id is null or p_start_date is null or p_end_date is null or p_start_date > p_end_date then
    raise exception 'يجب تحديد الخطة وفترة إعادة توزيع صالحة';
  end if;
  if p_daily_limit is null or p_daily_limit < 1 or p_daily_limit > 20 then
    raise exception 'الحد اليومي يجب أن يكون عدداً صحيحاً بين 1 و20';
  end if;
  if p_updates is null or jsonb_typeof(p_updates) <> 'array' or jsonb_array_length(p_updates) > 5000 then
    raise exception 'تحديثات إعادة التوزيع يجب أن تكون قائمة صالحة لا تتجاوز 5000 صف';
  end if;

  perform 1
  from public.monthly_plans p
  where p.id = p_plan_id
  for update;
  if not found then
    raise exception 'الخطة الشهرية غير موجودة';
  end if;

  for row_data in
    select r.id
    from public.monthly_plan_rows r
    where r.plan_id = p_plan_id
    order by r.id
    for update
  loop
    null;
  end loop;

  select count(*) into eligible_count
  from public.monthly_plan_rows r
  where r.plan_id = p_plan_id
    and not r.visited
    and r.planned_date >= p_start_date;

  if eligible_count <> jsonb_array_length(p_updates) then
    raise exception 'تغيّرت الصفوف المؤهلة منذ المعاينة؛ أعد تحميل الخطة ثم أنشئ معاينة جديدة';
  end if;

  for item in select value from jsonb_array_elements(p_updates)
  loop
    if jsonb_typeof(item) <> 'object'
      or jsonb_typeof(item->'row_id') <> 'string'
      or jsonb_typeof(item->'old_planned_date') <> 'string'
      or jsonb_typeof(item->'planned_date') <> 'string' then
      raise exception 'كل صف في المعاينة يجب أن يتضمن المعرّف والموعد القديم والجديد';
    end if;

    row_id := (item->>'row_id')::uuid;
    old_date := (item->>'old_planned_date')::date;
    next_date := (item->>'planned_date')::date;
    if row_id = any(seen_ids) then
      raise exception 'تكرر الصف % في معاينة إعادة التوزيع', row_id;
    end if;
    seen_ids := array_append(seen_ids, row_id);

    select r.* into row_data
    from public.monthly_plan_rows r
    where r.id = row_id
      and r.plan_id = p_plan_id
      and not r.visited
      and r.planned_date >= p_start_date;
    if not found or row_data.planned_date is distinct from old_date then
      raise exception 'تغيّر الصف % منذ إنشاء المعاينة؛ أعد تحميل الخطة', row_id;
    end if;
    if next_date < p_start_date or next_date > p_end_date
      or extract(isodow from next_date) in (5, 6)
      or exists (select 1 from public.plan_holidays h where h.holiday_date = next_date) then
      raise exception 'موعد غير صالح ضمن إعادة التوزيع للصف %', row_id;
    end if;
  end loop;

  audit_reason := format(
    'إعادة توزيع المتبقي (حد يومي %s زيارة لكل مشرف)',
    p_daily_limit
  );

  for item in select value from jsonb_array_elements(p_updates)
  loop
    row_id := (item->>'row_id')::uuid;
    old_date := (item->>'old_planned_date')::date;
    next_date := (item->>'planned_date')::date;
    if old_date = next_date then
      continue;
    end if;

    update public.monthly_plan_rows r
    set planned_date = next_date,
        original_planned_date = case when r.edited_at is null then r.planned_date else r.original_planned_date end,
        edited_at = now(),
        edited_by = auth.uid()
    where r.id = row_id
      and r.plan_id = p_plan_id
      and not r.visited
      and r.planned_date = old_date;
    if not found then
      raise exception 'تعذر حفظ موعد الصف %؛ أعد تحميل الخطة', row_id;
    end if;

    updated_count := updated_count + 1;
    insert into public.audit_log(actor, action, table_name, row_id, details)
    values (
      auth.uid(),
      'edit_plan_row',
      'monthly_plan_rows',
      row_id::text,
      jsonb_build_object(
        'editor', auth.uid(),
        'changes', jsonb_build_object(
          'planned_date', jsonb_build_object('old', old_date, 'new', next_date)
        ),
        'reason', audit_reason,
        'redistribution', jsonb_build_object(
          'start_date', p_start_date,
          'end_date', p_end_date,
          'daily_limit', p_daily_limit
        )
      )
    );
  end loop;

  for item in select value from jsonb_array_elements(p_updates)
  loop
    row_id := (item->>'row_id')::uuid;
    next_date := (item->>'planned_date')::date;
    select
      coalesce(r.supervisor_id::text, 'name:' || lower(btrim(coalesce(r.supervisor_name, '')))),
      coalesce(nullif(btrim(r.supervisor_name), ''), 'غير محدد')
    into supervisor_key, supervisor_label
    from public.monthly_plan_rows r
    where r.id = row_id;

    select count(*) into supervisor_load
    from public.monthly_plan_rows r
    where r.plan_id = p_plan_id
      and r.planned_date = next_date
      and coalesce(r.supervisor_id::text, 'name:' || lower(btrim(coalesce(r.supervisor_name, '')))) = supervisor_key;
    if supervisor_load > p_daily_limit then
      raise exception 'تجاوزت سعة المشرف % في %: % زيارة والحد %', supervisor_label, next_date, supervisor_load, p_daily_limit;
    end if;
  end loop;

  return jsonb_build_object('rows', updated_count, 'daily_limit', p_daily_limit);
end;
$$;

revoke all on function public.redistribute_monthly_plan_rows(uuid, date, date, integer, jsonb) from public, anon;
grant execute on function public.redistribute_monthly_plan_rows(uuid, date, date, integer, jsonb) to authenticated;

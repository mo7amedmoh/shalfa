insert into public.permissions (key, group_key, label_ar, description, enforced_in_db)
values (
  'plans.write_row_fields',
  'plans',
  'كتابة حقول صفوف الخطط',
  'تعديل جميع حقول صفوف الخطط عبر السياسات',
  true
)
on conflict (key) do update
set group_key = excluded.group_key,
    label_ar = excluded.label_ar,
    description = excluded.description,
    enforced_in_db = true;

-- Admins inherit every permission through has_permission; their system grants are immutable.
insert into public.role_permissions (role_id, permission_key)
select r.id, 'plans.write_row_fields'
from public.roles r
where r.key in ('project_manager', 'area_engineer')
on conflict do nothing;

update public.permissions
set enforced_in_db = true
where key = any(array[
  'residence.reveal',
  'gatekeepers.manage',
  'gatekeepers.export_residence',
  'attendance.view',
  'attendance.manage',
  'attendance.import',
  'plans.write_row_fields'
]);

create or replace function public.reveal_residence(p_kind text, p_ids uuid[])
returns table (id uuid, residence_no text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'غير مصرح';
  end if;
  if p_kind = 'employees' and not public.has_permission('residence.reveal') then
    raise exception 'غير مصرح';
  elsif p_kind = 'gatekeepers' and not public.has_permission('gatekeepers.manage') then
    raise exception 'غير مصرح';
  elsif p_kind not in ('employees', 'gatekeepers') then
    raise exception 'نوع غير معروف';
  end if;
  if p_kind = 'gatekeepers' and coalesce(array_length(p_ids, 1), 0) > 1 then
    raise exception 'يتطلب تصدير أرقام إقامة البوابين صلاحية التصدير';
  end if;
  if coalesce(array_length(p_ids, 1), 0) > 500 then
    raise exception 'عدد كبير جدًا';
  end if;

  insert into public.audit_log (action, table_name, details)
  values (
    'REVEAL_RESIDENCE',
    p_kind,
    jsonb_build_object('count', coalesce(array_length(p_ids, 1), 0), 'ids', p_ids)
  );

  if p_kind = 'employees' then
    return query
    select e.id, e.residence_no
    from public.employees e
    where e.id = any(p_ids)
      and (
        public.has_role('admin', 'project_manager')
        or public.is_in_my_team(e.id)
        or e.category = 'cleaner'
      );
  else
    return query
    select g.id, g.residence_no
    from public.gatekeepers g
    where g.id = any(p_ids);
  end if;
end;
$$;

create or replace function public.export_gatekeeper_residence(p_ids uuid[])
returns table (id uuid, residence_no text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.has_permission('gatekeepers.export_residence') then
    raise exception 'غير مصرح بتصدير أرقام إقامة البوابين';
  end if;
  if coalesce(array_length(p_ids, 1), 0) > 500 then
    raise exception 'عدد كبير جدًا';
  end if;

  insert into public.audit_log (action, table_name, details)
  values (
    'REVEAL_RESIDENCE',
    'gatekeepers',
    jsonb_build_object('count', coalesce(array_length(p_ids, 1), 0), 'ids', p_ids, 'purpose', 'export')
  );

  return query
  select g.id, g.residence_no
  from public.gatekeepers g
  where g.id = any(p_ids);
end;
$$;

revoke all on function public.export_gatekeeper_residence(uuid[]) from public, anon, authenticated;
grant execute on function public.export_gatekeeper_residence(uuid[]) to authenticated;

drop policy if exists attendance_months_read on public.attendance_months;
create policy attendance_months_read
  on public.attendance_months for select to authenticated
  using (public.has_permission('attendance.view'));

drop policy if exists attendance_months_update on public.attendance_months;
create policy attendance_months_update
  on public.attendance_months for update to authenticated
  using (public.has_permission('attendance.manage'))
  with check (public.has_permission('attendance.manage'));

drop policy if exists attendance_rosters_read on public.attendance_rosters;
create policy attendance_rosters_read
  on public.attendance_rosters for select to authenticated
  using (public.has_permission('attendance.view'));

drop policy if exists attendance_rosters_write on public.attendance_rosters;
create policy attendance_rosters_write
  on public.attendance_rosters for all to authenticated
  using (public.has_permission('attendance.manage'))
  with check (public.has_permission('attendance.manage'));

drop policy if exists attendance_marks_read on public.attendance_marks;
create policy attendance_marks_read
  on public.attendance_marks for select to authenticated
  using (public.has_permission('attendance.view'));

drop policy if exists attendance_marks_write on public.attendance_marks;
create policy attendance_marks_write
  on public.attendance_marks for all to authenticated
  using (public.has_permission('attendance.manage'))
  with check (public.has_permission('attendance.manage'));

create or replace view public.attendance_rosters_with_identity
with (security_barrier = true)
as
select
  r.id, r.month, r.sort_no, r.school_name, r.school_id,
  r.worker_name, r.worker_id_number, r.assignment_id, r.source, r.remarks
from public.attendance_rosters r
where public.has_permission('attendance.view');

create or replace function public.create_month_roster(p_month date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  month_locked boolean;
  inserted_count integer;
begin
  if auth.uid() is null or not public.has_permission('attendance.manage') then
    raise exception 'غير مصرح بإنشاء كشف التحضير';
  end if;
  if p_month is null or p_month <> date_trunc('month', p_month)::date then
    raise exception 'يجب تحديد أول يوم من الشهر';
  end if;

  insert into public.attendance_months (month)
  values (p_month)
  on conflict (month) do nothing;

  select m.locked into month_locked
  from public.attendance_months m
  where m.month = p_month
  for update;
  if month_locked then
    raise exception 'الشهر مقفل';
  end if;
  if exists (
    select 1 from public.attendance_rosters r where r.month = p_month
  ) then
    raise exception 'تم إنشاء كشف لهذا الشهر مسبقاً';
  end if;

  insert into public.attendance_rosters (
    month, sort_no, school_name, school_id, worker_name,
    worker_id_number, assignment_id, source
  )
  select
    p_month,
    row_number() over (order by s.name, e.full_name, a.id)::integer,
    s.name,
    s.id,
    e.full_name,
    e.residence_no,
    a.id,
    'placement'
  from public.cleaner_assignments a
  join public.employees e on e.id = a.employee_id and e.category = 'cleaner'
  join public.schools s on s.id = a.school_id
  order by s.name, e.full_name, a.id;

  get diagnostics inserted_count = row_count;

  insert into public.audit_log (actor, action, table_name, row_id, details)
  values (
    auth.uid(),
    'create_month_roster',
    'attendance_rosters',
    p_month::text,
    jsonb_build_object('month', p_month, 'row_count', inserted_count)
  );
  return inserted_count;
end;
$$;

create or replace function public.set_attendance(
  p_roster_ids uuid[],
  p_day date,
  p_present boolean
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  month_date date;
  month_locked boolean;
  non_working_days smallint[];
  affected_count integer;
begin
  if auth.uid() is null or not public.has_permission('attendance.manage') then
    raise exception 'غير مصرح بتسجيل التحضير';
  end if;
  if p_day is null then
    raise exception 'يجب تحديد يوم التحضير';
  end if;
  if p_present is null then
    raise exception 'يجب تحديد حالة الحضور';
  end if;
  if p_roster_ids is null or cardinality(p_roster_ids) = 0
    or array_position(p_roster_ids, null) is not null then
    raise exception 'يجب تحديد صفوف التحضير';
  end if;
  if cardinality(p_roster_ids) <> (
    select count(distinct roster_id) from unnest(p_roster_ids) as ids(roster_id)
  ) then
    raise exception 'قائمة صفوف التحضير تحتوي على تكرار';
  end if;

  month_date := date_trunc('month', p_day)::date;
  insert into public.attendance_months (month)
  values (month_date)
  on conflict (month) do nothing;

  select m.locked, m.non_working_weekdays
  into month_locked, non_working_days
  from public.attendance_months m
  where m.month = month_date
  for update;
  if month_locked then
    raise exception 'الشهر مقفل';
  end if;
  if extract(dow from p_day)::smallint = any(non_working_days) then
    raise exception 'لا يمكن تسجيل التحضير في يوم غير عمل';
  end if;
  if cardinality(p_roster_ids) <> (
    select count(*)
    from public.attendance_rosters r
    where r.id = any(p_roster_ids) and r.month = month_date
  ) then
    raise exception 'يجب أن تنتمي كل صفوف التحضير إلى الشهر المحدد';
  end if;

  if p_present then
    insert into public.attendance_marks (roster_id, day, marked_by, marked_at)
    select r.id, p_day, auth.uid(), now()
    from public.attendance_rosters r
    where r.id = any(p_roster_ids) and r.month = month_date
    on conflict (roster_id, day) do update
    set marked_by = excluded.marked_by,
        marked_at = excluded.marked_at;
    get diagnostics affected_count = row_count;
  else
    delete from public.attendance_marks m
    where m.day = p_day and m.roster_id = any(p_roster_ids);
    get diagnostics affected_count = row_count;
  end if;

  insert into public.audit_log (actor, action, table_name, row_id, details)
  values (
    auth.uid(),
    'set_attendance_bulk',
    'attendance_marks',
    p_day::text,
    jsonb_build_object(
      'month', month_date,
      'day', p_day,
      'present', p_present,
      'roster_count', cardinality(p_roster_ids),
      'changed_count', affected_count
    )
  );
  return affected_count;
end;
$$;

create or replace function public.replace_roster(
  p_month date,
  p_rows jsonb,
  p_confirm_attendance_deletion boolean
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  month_locked boolean;
  item jsonb;
  row_ordinal bigint;
  sort_offset integer;
  matched_roster_id uuid;
  matched_roster_ids uuid[] := array[]::uuid[];
  removed_count integer;
  removed_marks integer;
  imported_count integer := 0;
  allowed_keys text[] := array[
    'sort_no', 'school_name', 'school_id', 'worker_name',
    'worker_id_number', 'assignment_id', 'remarks'
  ];
begin
  if auth.uid() is null or not public.has_permission('attendance.import') then
    raise exception 'غير مصرح باستيراد كشف التحضير';
  end if;
  if p_month is null or p_month <> date_trunc('month', p_month)::date then
    raise exception 'يجب تحديد أول يوم من الشهر';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'بيانات الاستيراد يجب أن تكون قائمة غير فارغة';
  end if;
  if jsonb_array_length(p_rows) = 0 then
    raise exception 'بيانات الاستيراد يجب أن تكون قائمة غير فارغة';
  end if;
  if p_confirm_attendance_deletion is null then
    raise exception 'يجب تحديد تأكيد حذف التحضير';
  end if;

  for item in select value from jsonb_array_elements(p_rows)
  loop
    if jsonb_typeof(item) <> 'object'
      or (item - allowed_keys) <> '{}'::jsonb
      or jsonb_typeof(item->'school_name') is distinct from 'string'
      or length(btrim(item->>'school_name')) = 0
      or jsonb_typeof(item->'worker_name') is distinct from 'string'
      or length(btrim(item->>'worker_name')) = 0
      or (item ? 'worker_id_number'
        and jsonb_typeof(item->'worker_id_number') not in ('string', 'null'))
      or (item ? 'school_id'
        and jsonb_typeof(item->'school_id') not in ('string', 'null'))
      or (item ? 'assignment_id'
        and jsonb_typeof(item->'assignment_id') not in ('string', 'null'))
      or (item ? 'remarks'
        and jsonb_typeof(item->'remarks') not in ('string', 'null'))
      or (item ? 'sort_no' and jsonb_typeof(item->'sort_no') <> 'number') then
      raise exception 'أحد صفوف الاستيراد غير صالح';
    end if;
  end loop;

  insert into public.attendance_months (month)
  values (p_month)
  on conflict (month) do nothing;

  select m.locked into month_locked
  from public.attendance_months m
  where m.month = p_month
  for update;
  if month_locked then
    raise exception 'لا يمكن استبدال كشف شهر مقفل';
  end if;

  select coalesce(max(r.sort_no), 0) + jsonb_array_length(p_rows)::integer + 1
  into sort_offset
  from public.attendance_rosters r
  where r.month = p_month;
  update public.attendance_rosters r
  set sort_no = r.sort_no + sort_offset
  where r.month = p_month;

  for item, row_ordinal in
    select value, ordinality
    from jsonb_array_elements(p_rows) with ordinality
  loop
    matched_roster_id := null;
    if nullif(btrim(item->>'worker_id_number'), '') is not null then
      select r.id into matched_roster_id
      from public.attendance_rosters r
      where r.month = p_month
        and translate(
          btrim(r.worker_id_number),
          '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
          '01234567890123456789'
        ) = translate(
          btrim(item->>'worker_id_number'),
          '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
          '01234567890123456789'
        )
        and r.id <> all(matched_roster_ids)
      order by r.sort_no, r.id
      limit 1
      for update;
    end if;

    if matched_roster_id is null then
      insert into public.attendance_rosters (
        month, sort_no, school_name, school_id, worker_name,
        worker_id_number, assignment_id, source, remarks
      )
      values (
        p_month,
        coalesce(nullif(item->>'sort_no', '')::integer, row_ordinal::integer),
        item->>'school_name',
        nullif(item->>'school_id', '')::uuid,
        item->>'worker_name',
        nullif(btrim(item->>'worker_id_number'), ''),
        nullif(item->>'assignment_id', '')::uuid,
        'import',
        item->>'remarks'
      )
      returning id into matched_roster_id;
      matched_roster_ids := array_append(matched_roster_ids, matched_roster_id);
    else
      update public.attendance_rosters r
      set sort_no = coalesce(nullif(item->>'sort_no', '')::integer, row_ordinal::integer),
          school_name = item->>'school_name',
          worker_name = item->>'worker_name',
          worker_id_number = nullif(btrim(item->>'worker_id_number'), ''),
          source = 'import'
      where r.id = matched_roster_id;
      matched_roster_ids := array_append(matched_roster_ids, matched_roster_id);
    end if;
    imported_count := imported_count + 1;
  end loop;

  select count(*) into removed_count
  from public.attendance_rosters r
  where r.month = p_month
    and r.id <> all(matched_roster_ids);
  select count(*) into removed_marks
  from public.attendance_marks m
  join public.attendance_rosters r on r.id = m.roster_id
  where r.month = p_month
    and r.id <> all(matched_roster_ids);

  if removed_marks > 0 and not p_confirm_attendance_deletion then
    raise exception 'يتطلب حذف عمال لديهم تحضير تأكيداً صريحاً';
  end if;

  delete from public.attendance_rosters r
  where r.month = p_month
    and r.id <> all(matched_roster_ids);

  insert into public.audit_log (actor, action, table_name, row_id, details)
  values (
    auth.uid(),
    'replace_attendance_roster',
    'attendance_rosters',
    p_month::text,
    jsonb_build_object(
      'month', p_month,
      'rows_removed', removed_count,
      'marks_removed', removed_marks,
      'rows_imported', imported_count
    )
  );
  return imported_count;
end;
$$;

create or replace function public.lock_attendance_month(p_month date)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  month_locked boolean;
begin
  if auth.uid() is null or not public.has_permission('attendance.manage') then
    raise exception 'غير مصرح بقفل شهر التحضير';
  end if;
  if p_month is null or p_month <> date_trunc('month', p_month)::date then
    raise exception 'يجب تحديد أول يوم من الشهر';
  end if;

  insert into public.attendance_months (month)
  values (p_month)
  on conflict (month) do nothing;

  select m.locked into month_locked
  from public.attendance_months m
  where m.month = p_month
  for update;
  if month_locked then
    return false;
  end if;

  update public.attendance_months m
  set locked = true
  where m.month = p_month;

  insert into public.audit_log (actor, action, table_name, row_id, details)
  values (
    auth.uid(),
    'lock_attendance_month',
    'attendance_months',
    p_month::text,
    jsonb_build_object('month', p_month)
  );
  return true;
end;
$$;

create or replace function public.get_attendance_marks(
  p_month date,
  p_offset integer,
  p_limit integer
)
returns table (roster_id uuid, day date)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.has_permission('attendance.view') then
    raise exception 'غير مصرح بقراءة سجلات التحضير';
  end if;
  if p_month is null or p_month <> date_trunc('month', p_month)::date then
    raise exception 'يجب تحديد أول يوم من الشهر';
  end if;
  if p_offset is null or p_offset < 0 or p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'حدود صفحة التحضير غير صالحة';
  end if;

  return query
  select m.roster_id, m.day
  from public.attendance_marks as m
  where m.day >= p_month
    and m.day < (p_month + interval '1 month')::date
  order by m.day, m.roster_id
  limit p_limit
  offset p_offset;
end;
$$;

revoke all on function public.get_attendance_marks(date, integer, integer)
  from public, anon, authenticated;
grant execute on function public.get_attendance_marks(date, integer, integer)
  to authenticated;

create or replace function public.guard_plan_row_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.report_done and not new.visited and
    (new.report_done is distinct from old.report_done
     or new.report_done_date is distinct from old.report_done_date) then
    raise exception 'لا يمكن إكمال التقرير قبل تسجيل الزيارة';
  end if;
  if not public.has_permission('plans.write_row_fields') then
    if (new.plan_id, new.school_id, new.planned_date, new.engineer_id, new.supervisor_id, new.contractor_name)
       is distinct from
       (old.plan_id, old.school_id, old.planned_date, old.engineer_id, old.supervisor_id, old.contractor_name) then
      raise exception 'غير مصرح: يقتصر تحديث الصف على حالة الزيارة والتقرير فقط';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.guard_general_plan_import_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('plans.write_row_fields')
    and (new.plan_id, new.school_id, new.planned_date, new.responses_count, new.contractor_name)
    is distinct from
    (old.plan_id, old.school_id, old.planned_date, old.responses_count, old.contractor_name) then
    raise exception 'غير مصرح بتعديل بيانات الاستيراد في الخطة العامة';
  end if;
  return new;
end;
$$;

create or replace function public.guard_custom_plan_row_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.report_done and not new.visited and
    (new.report_done is distinct from old.report_done
     or new.report_done_date is distinct from old.report_done_date) then
    raise exception 'لا يمكن إكمال التقرير قبل تسجيل الزيارة';
  end if;
  if not public.has_permission('plans.write_row_fields') and
    (new.plan_id, new.school_id, new.planned_date, new.execution_date, new.status,
     new.supervisor_id, new.supervisor_name, new.engineer_name, new.contractor_name, new.notes)
    is distinct from
    (old.plan_id, old.school_id, old.planned_date, old.execution_date, old.status,
     old.supervisor_id, old.supervisor_name, old.engineer_name, old.contractor_name, old.notes) then
    raise exception 'غير مصرح: يقتصر تحديث الصف على حالة الزيارة والتقرير فقط';
  end if;
  return new;
end;
$$;

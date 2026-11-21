create table public.attendance_months (
  month date primary key check (month = date_trunc('month', month)::date),
  locked boolean not null default false,
  locked_by uuid references auth.users(id) on delete restrict,
  locked_at timestamptz,
  non_working_weekdays smallint[] not null default array[5]::smallint[],
  check (non_working_weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  check (array_position(non_working_weekdays, null::smallint) is null),
  check (
    (locked and locked_by is not null and locked_at is not null)
    or (not locked and locked_by is null and locked_at is null)
  )
);

create table public.attendance_rosters (
  id uuid primary key default gen_random_uuid(),
  month date not null references public.attendance_months(month) on delete cascade,
  sort_no integer not null check (sort_no > 0),
  school_name text not null check (length(btrim(school_name)) > 0),
  school_id uuid references public.schools(id) on delete set null,
  worker_name text not null check (length(btrim(worker_name)) > 0),
  worker_id_number text,
  assignment_id uuid references public.cleaner_assignments(id) on delete set null,
  source text not null check (source in ('placement', 'import')),
  remarks text,
  unique (month, sort_no)
);

create table public.attendance_marks (
  roster_id uuid not null references public.attendance_rosters(id) on delete cascade,
  day date not null,
  marked_by uuid not null references auth.users(id) on delete restrict,
  marked_at timestamptz not null default now(),
  primary key (roster_id, day)
);

create index attendance_rosters_month_sort_idx
  on public.attendance_rosters (month, sort_no);
create index attendance_marks_day_idx
  on public.attendance_marks (day);

alter table public.attendance_months enable row level security;
alter table public.attendance_rosters enable row level security;
alter table public.attendance_marks enable row level security;

revoke all on public.attendance_months, public.attendance_rosters, public.attendance_marks
  from public, anon, authenticated;

grant select, update (locked, non_working_weekdays)
  on public.attendance_months to authenticated;
grant select (
  id, month, sort_no, school_name, school_id, worker_name,
  assignment_id, source, remarks
) on public.attendance_rosters to authenticated;
grant update (remarks) on public.attendance_rosters to authenticated;
grant select on public.attendance_marks to authenticated;

create policy attendance_months_read
  on public.attendance_months for select to authenticated
  using (public.has_role('admin', 'project_manager'));
create policy attendance_months_update
  on public.attendance_months for update to authenticated
  using (public.has_role('admin', 'project_manager'))
  with check (public.has_role('admin', 'project_manager'));

create policy attendance_rosters_read
  on public.attendance_rosters for select to authenticated
  using (public.has_role('admin', 'project_manager'));
create policy attendance_rosters_write
  on public.attendance_rosters for all to authenticated
  using (public.has_role('admin', 'project_manager'))
  with check (public.has_role('admin', 'project_manager'));

create policy attendance_marks_read
  on public.attendance_marks for select to authenticated
  using (public.has_role('admin', 'project_manager'));
create policy attendance_marks_write
  on public.attendance_marks for all to authenticated
  using (public.has_role('admin', 'project_manager'))
  with check (public.has_role('admin', 'project_manager'));

create or replace function public.touch_attendance_month_lock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.locked is distinct from old.locked then
    if new.locked then
      new.locked_by := auth.uid();
      new.locked_at := now();
    else
      new.locked_by := null;
      new.locked_at := null;
    end if;
  elsif old.locked and new.non_working_weekdays is distinct from old.non_working_weekdays then
    raise exception 'لا يمكن تغيير أيام عدم العمل بعد قفل الشهر';
  end if;
  return new;
end;
$$;

create trigger attendance_months_lock_metadata
before update on public.attendance_months
for each row execute function public.touch_attendance_month_lock();

create view public.attendance_rosters_with_identity
with (security_barrier = true)
as
select
  r.id, r.month, r.sort_no, r.school_name, r.school_id,
  r.worker_name, r.worker_id_number, r.assignment_id, r.source, r.remarks
from public.attendance_rosters r
where public.has_role('admin', 'project_manager');

revoke all on public.attendance_rosters_with_identity from public, anon, authenticated;
grant select on public.attendance_rosters_with_identity to authenticated;

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
  if auth.uid() is null or not public.has_role('admin', 'project_manager') then
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
  if auth.uid() is null or not public.has_role('admin', 'project_manager') then
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
  if auth.uid() is null or not public.has_role('admin', 'project_manager') then
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
  if auth.uid() is null or not public.has_role('admin', 'project_manager') then
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

revoke all on function public.create_month_roster(date) from public, anon, authenticated;
revoke all on function public.set_attendance(uuid[], date, boolean) from public, anon, authenticated;
revoke all on function public.replace_roster(date, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.lock_attendance_month(date) from public, anon, authenticated;
grant execute on function public.create_month_roster(date) to authenticated;
grant execute on function public.set_attendance(uuid[], date, boolean) to authenticated;
grant execute on function public.replace_roster(date, jsonb, boolean) to authenticated;
grant execute on function public.lock_attendance_month(date) to authenticated;

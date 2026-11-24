create or replace function public.normalize_ministry_number(p_value text)
returns text
language plpgsql
immutable
parallel safe
as $$
declare
  normalized text;
begin
  normalized := upper(regexp_replace(
    translate(coalesce(p_value, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'),
    '[[:space:]' || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194)
      || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200)
      || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287)
      || chr(12288) || chr(65279) || ']',
    '', 'g'
  ));
  if normalized ~ '^M[0-9]' then
    normalized := substr(normalized, 2);
  end if;
  if normalized <> '' and normalized !~ '[^0]' then
    return '0';
  end if;
  if normalized ~ '^0+[0-9]' then
    normalized := regexp_replace(normalized, '^0+', '');
  end if;
  return normalized;
end;
$$;

create or replace function public.normalise_ministry_no(p_value text)
returns text
language sql
immutable
parallel safe
as $$
  select public.normalize_ministry_number(p_value);
$$;

create table public.school_supervisor_assignments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict,
  service text not null check (service in ('maintenance', 'cleaning')),
  valid_from date not null default current_date,
  valid_to date,
  assigned_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from)
);

create unique index school_supervisor_assignments_one_active_idx
  on public.school_supervisor_assignments (school_id, service)
  where valid_to is null;
create index school_supervisor_assignments_employee_idx
  on public.school_supervisor_assignments (employee_id, service, valid_to);

alter table public.school_supervisor_assignments enable row level security;
grant select on public.school_supervisor_assignments to authenticated;

create policy school_supervisor_assignments_read
on public.school_supervisor_assignments
for select to authenticated
using (
  public.has_permission('workforce.view')
  or public.has_permission('workforce.assign_schools')
);

create or replace view public.school_current_supervisors
with (security_invoker = true)
as
select
  s.id as school_id,
  maintenance.employee_id as maintenance_supervisor_id,
  maintenance_employee.full_name as maintenance_supervisor_name,
  cleaning.employee_id as cleaning_supervisor_id,
  cleaning_employee.full_name as cleaning_supervisor_name
from public.schools s
left join public.school_supervisor_assignments maintenance
  on maintenance.school_id = s.id
  and maintenance.service = 'maintenance'
  and maintenance.valid_to is null
left join public.employees maintenance_employee
  on maintenance_employee.id = maintenance.employee_id
left join public.school_supervisor_assignments cleaning
  on cleaning.school_id = s.id
  and cleaning.service = 'cleaning'
  and cleaning.valid_to is null
left join public.employees cleaning_employee
  on cleaning_employee.id = cleaning.employee_id;

grant select on public.school_current_supervisors to authenticated;

insert into public.permissions (key, group_key, label_ar, description, enforced_in_db)
values
  ('workforce.assign_schools', 'workforce', 'إسناد المدارس للمشرفين', 'إدارة إسناد المدارس لمشرفي الصيانة والنظافة', true),
  ('workforce.view_contacts', 'workforce', 'عرض بيانات التواصل', 'عرض بيانات التواصل الخاصة بالقوى العاملة', false),
  ('workforce.view_id_image', 'workforce', 'عرض صور الهوية', 'عرض صور هوية موظفي القوى العاملة', true)
on conflict (key) do update
set group_key = excluded.group_key,
    label_ar = excluded.label_ar,
    description = excluded.description,
    enforced_in_db = excluded.enforced_in_db;

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
join public.permissions p
  on p.key = 'workforce.assign_schools'
where r.key in ('project_manager', 'area_engineer')
on conflict do nothing;

drop policy if exists employee_identity_read on storage.objects;
create policy employee_identity_read
on storage.objects for select to authenticated
using (
  bucket_id = 'employee-identity'
  and public.has_permission('workforce.view_id_image')
);

create or replace function public.assign_schools(
  p_employee_id uuid,
  p_service text,
  p_ministry_numbers text[],
  p_on_conflict text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  employee_row public.employees;
  ministry_number text;
  matching_school public.schools;
  existing_assignment public.school_supervisor_assignments;
  outcome text;
  result_rows jsonb := '[]'::jsonb;
  seen_school_ids uuid[] := '{}';
  matched_count integer := 0;
  not_found_count integer := 0;
  conflict_count integer := 0;
begin
  if auth.uid() is null or not public.has_permission('workforce.assign_schools') then
    raise exception 'غير مصرح بإسناد المدارس للمشرفين';
  end if;
  if p_service is null or p_service not in ('maintenance', 'cleaning') then
    raise exception 'نوع خدمة الإسناد غير صالح';
  end if;
  if p_on_conflict is null or p_on_conflict not in ('skip', 'move') then
    raise exception 'خيار التعارض يجب أن يكون skip أو move';
  end if;
  if p_ministry_numbers is null or cardinality(p_ministry_numbers) > 5000 then
    raise exception 'قائمة الأرقام الوزارية مطلوبة ولا تتجاوز 5000 رقماً';
  end if;

  select e into employee_row
  from public.employees e
  where e.id = p_employee_id
    and e.category = 'supervisor'
    and e.status = 'active'
  for update;
  if not found then
    raise exception 'الموظف غير موجود أو ليس مشرفاً نشطاً';
  end if;

  perform s.id
  from public.schools s
  where s.ministry_key = any(array(
    select public.normalize_ministry_number(value)
    from unnest(p_ministry_numbers) as input(value)
  ))
  order by s.id
  for update;

  for ministry_number in
    select value from unnest(p_ministry_numbers) with ordinality as input(value, position)
    order by position
  loop
    ministry_number := public.normalize_ministry_number(ministry_number);
    if ministry_number = '' then
      outcome := 'not_found';
      result_rows := result_rows || jsonb_build_array(jsonb_build_object(
        'ministry_number', ministry_number, 'school_id', null, 'school_name', null,
        'status', outcome, 'reason', 'empty_ministry_number'
      ));
      not_found_count := not_found_count + 1;
      continue;
    end if;

    select s.* into matching_school
    from public.schools s
    where s.ministry_key = ministry_number
    order by s.id
    limit 1;
    if not found then
      outcome := 'not_found';
      result_rows := result_rows || jsonb_build_array(jsonb_build_object(
        'ministry_number', ministry_number, 'school_id', null, 'school_name', null,
        'status', outcome
      ));
      not_found_count := not_found_count + 1;
      continue;
    end if;

    if (select count(*) from public.schools s where s.ministry_key = ministry_number) > 1 then
      outcome := 'conflict';
      result_rows := result_rows || jsonb_build_array(jsonb_build_object(
        'ministry_number', ministry_number, 'school_id', null, 'school_name', null,
        'status', outcome, 'reason', 'duplicate_ministry_number'
      ));
      conflict_count := conflict_count + 1;
      continue;
    end if;

    if matching_school.id = any(seen_school_ids) then
      outcome := 'conflict';
      result_rows := result_rows || jsonb_build_array(jsonb_build_object(
        'ministry_number', ministry_number, 'school_id', matching_school.id, 'school_name', matching_school.name,
        'status', outcome, 'reason', 'duplicate_input'
      ));
      conflict_count := conflict_count + 1;
      continue;
    end if;
    seen_school_ids := array_append(seen_school_ids, matching_school.id);

    select a.* into existing_assignment
    from public.school_supervisor_assignments a
    where a.school_id = matching_school.id
      and a.service = p_service
      and a.valid_to is null
    for update;

    if existing_assignment.id is not null and existing_assignment.employee_id = p_employee_id then
      outcome := 'matched';
    elsif existing_assignment.id is not null and p_on_conflict = 'skip' then
      outcome := 'conflict';
    else
      if existing_assignment.id is not null then
        if current_date < existing_assignment.valid_from then
          raise exception 'لا يمكن نقل إسناد لم يبدأ بعد';
        end if;
        update public.school_supervisor_assignments
        set valid_to = current_date
        where id = existing_assignment.id;
      end if;

      insert into public.school_supervisor_assignments (
        school_id, employee_id, service, valid_from, assigned_by
      )
      values (matching_school.id, p_employee_id, p_service, current_date, auth.uid());
      outcome := 'matched';
    end if;

    result_rows := result_rows || jsonb_build_array(jsonb_build_object(
      'ministry_number', ministry_number,
      'school_id', matching_school.id,
      'school_name', matching_school.name,
      'status', outcome
    ));
    if outcome = 'matched' then
      matched_count := matched_count + 1;
    else
      conflict_count := conflict_count + 1;
    end if;
  end loop;

  insert into public.audit_log (actor, action, table_name, row_id, details)
  values (
    auth.uid(),
    'assign_school_supervisors',
    'school_supervisor_assignments',
    p_employee_id::text,
    jsonb_build_object(
      'employee_id', p_employee_id, 'service', p_service, 'on_conflict', p_on_conflict,
      'matched', matched_count, 'not_found', not_found_count, 'conflicts', conflict_count,
      'results', result_rows
    )
  );

  return jsonb_build_object(
    'matched', matched_count, 'not_found', not_found_count,
    'conflicts', conflict_count, 'results', result_rows
  );
end;
$$;

revoke all on function public.assign_schools(uuid, text, text[], text) from public, anon;
grant execute on function public.assign_schools(uuid, text, text[], text) to authenticated;

create or replace function public.unassign_school(
  p_school_id uuid,
  p_service text,
  p_effective_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_assignment public.school_supervisor_assignments;
  ended boolean := false;
begin
  if auth.uid() is null or not public.has_permission('workforce.assign_schools') then
    raise exception 'غير مصرح بإلغاء إسناد المشرف';
  end if;
  if p_service is null or p_service not in ('maintenance', 'cleaning') or p_effective_date is null then
    raise exception 'بيانات إلغاء الإسناد غير صالحة';
  end if;

  perform 1 from public.schools where id = p_school_id for update;
  if not found then
    raise exception 'المدرسة غير موجودة';
  end if;
  select a.* into active_assignment
  from public.school_supervisor_assignments a
  where a.school_id = p_school_id and a.service = p_service and a.valid_to is null
  for update;

  if active_assignment.id is not null then
    if p_effective_date < active_assignment.valid_from then
      raise exception 'تاريخ الإلغاء يسبق بداية الإسناد';
    end if;
    update public.school_supervisor_assignments
    set valid_to = p_effective_date
    where id = active_assignment.id;
    ended := true;
  end if;

  insert into public.audit_log (actor, action, table_name, row_id, details)
  values (
    auth.uid(), 'unassign_school_supervisor', 'school_supervisor_assignments', p_school_id::text,
    jsonb_build_object(
      'school_id', p_school_id, 'service', p_service, 'effective_date', p_effective_date,
      'assignment_id', active_assignment.id, 'unassigned', ended
    )
  );
  return jsonb_build_object(
    'unassigned', ended,
    'assignment_id', active_assignment.id,
    'employee_id', active_assignment.employee_id,
    'service', p_service,
    'effective_date', p_effective_date
  );
end;
$$;

revoke all on function public.unassign_school(uuid, text, date) from public, anon;
grant execute on function public.unassign_school(uuid, text, date) to authenticated;

create or replace function public.transfer_supervisor_schools(
  p_from_employee_id uuid,
  p_to_employee_id uuid,
  p_effective_date date,
  p_update_future_plans boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_employee public.employees;
  target_employee public.employees;
  assignment_row public.school_supervisor_assignments;
  moved_schools uuid[] := '{}';
  moved_count integer := 0;
  updated_plan_rows integer := 0;
begin
  if auth.uid() is null or not public.has_permission('workforce.assign_schools') then
    raise exception 'غير مصرح بنقل إسنادات المشرف';
  end if;
  if p_from_employee_id is null or p_to_employee_id is null
    or p_from_employee_id = p_to_employee_id or p_effective_date is null
    or p_update_future_plans is null then
    raise exception 'بيانات نقل الإسنادات غير صالحة';
  end if;

  select e.* into source_employee
  from public.employees e
  where e.id = p_from_employee_id and e.category = 'supervisor'
  for update;
  if not found then
    raise exception 'المشرف الحالي غير موجود';
  end if;
  select e.* into target_employee
  from public.employees e
  where e.id = p_to_employee_id and e.category = 'supervisor' and e.status = 'active'
  for update;
  if not found then
    raise exception 'المشرف البديل غير موجود أو غير نشط';
  end if;

  for assignment_row in
    select a.*
    from public.school_supervisor_assignments a
    where a.employee_id = p_from_employee_id and a.valid_to is null
    order by a.school_id, a.service
    for update
  loop
    if p_effective_date < assignment_row.valid_from then
      raise exception 'تاريخ النقل يسبق بداية أحد الإسنادات';
    end if;

    update public.school_supervisor_assignments
    set valid_to = p_effective_date
    where id = assignment_row.id;
    insert into public.school_supervisor_assignments (
      school_id, employee_id, service, valid_from, assigned_by
    )
    values (
      assignment_row.school_id, p_to_employee_id, assignment_row.service,
      p_effective_date, auth.uid()
    );
    moved_schools := array_append(moved_schools, assignment_row.school_id);
    moved_count := moved_count + 1;
  end loop;

  if p_update_future_plans and cardinality(moved_schools) > 0 then
    update public.monthly_plan_rows r
    set supervisor_id = p_to_employee_id,
        supervisor_name = target_employee.full_name
    where r.supervisor_id = p_from_employee_id
      and r.school_id = any(moved_schools)
      and r.planned_date > p_effective_date
      and not r.visited
      and not r.report_done;
    get diagnostics updated_plan_rows = row_count;
  end if;

  insert into public.audit_log (actor, action, table_name, row_id, details)
  values (
    auth.uid(), 'transfer_supervisor_schools', 'school_supervisor_assignments',
    p_from_employee_id::text,
    jsonb_build_object(
      'from_employee_id', p_from_employee_id, 'to_employee_id', p_to_employee_id,
      'effective_date', p_effective_date, 'assignments_moved', moved_count,
      'future_plans_updated', updated_plan_rows, 'update_future_plans', p_update_future_plans
    )
  );
  return jsonb_build_object(
    'assignments_moved', moved_count,
    'future_plans_updated', updated_plan_rows,
    'effective_date', p_effective_date
  );
end;
$$;

revoke all on function public.transfer_supervisor_schools(uuid, uuid, date, boolean) from public, anon;
grant execute on function public.transfer_supervisor_schools(uuid, uuid, date, boolean) to authenticated;

create or replace function public.preview_school_supervisor_assignments()
returns table (
  school_id uuid,
  ministry_number text,
  school_name text,
  service text,
  source_name text,
  employee_id uuid,
  employee_name text,
  outcome text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.has_permission('workforce.assign_schools') then
    raise exception 'غير مصرح بمعاينة إسنادات المدارس';
  end if;

  return query
  with source_names as (
    select
      s.id,
      s.ministry_no,
      s.name,
      source.service,
      nullif(btrim(s.extra->>source.header), '') as source_name,
      public.normalise_plan_name(s.extra->>source.header) as normalized_name
    from public.schools s
    cross join (values
      ('maintenance'::text, 'اسم المشرف (صيانة)'::text),
      ('cleaning'::text, 'اسم المشرف (نظافة)'::text)
    ) as source(service, header)
    where nullif(btrim(s.extra->>source.header), '') is not null
  ),
  resolutions as (
    select
      names.*,
      alias_match.employee_id as alias_employee_id,
      exact_match.employee_id as exact_employee_id,
      exact_match.match_count
    from source_names names
    left join lateral (
      select a.employee_id
      from public.supervisor_aliases a
      where a.alias_normalised = names.normalized_name
    ) alias_match on true
    left join lateral (
      select min(e.id::text)::uuid as employee_id, count(*)::integer as match_count
      from public.employees e
      where e.category = 'supervisor'
        and e.status = 'active'
        and public.normalise_plan_name(e.full_name) = names.normalized_name
    ) exact_match on alias_match.employee_id is null
  ),
  resolved as (
    select
      resolutions.*,
      coalesce(alias_employee_id, exact_employee_id) as resolved_employee_id
    from resolutions
  )
  select
    resolved.id,
    resolved.ministry_no,
    resolved.name,
    resolved.service,
    resolved.source_name,
    employee.id,
    employee.full_name,
    case
      when resolved.alias_employee_id is null and coalesce(resolved.match_count, 0) > 1 then 'ambiguous'
      when employee.id is null then 'unmatched'
      when employee.category <> 'supervisor' or employee.status <> 'active' then 'ineligible_employee'
      when active.id is not null and active.employee_id = employee.id then 'already_assigned'
      when active.id is not null then 'conflict'
      else 'proposed'
    end
  from resolved
  left join public.employees employee on employee.id = resolved.resolved_employee_id
  left join public.school_supervisor_assignments active
    on active.school_id = resolved.id
    and active.service = resolved.service
    and active.valid_to is null
  order by resolved.ministry_no, resolved.service, resolved.id;
end;
$$;

revoke all on function public.preview_school_supervisor_assignments() from public, anon;
grant execute on function public.preview_school_supervisor_assignments() to authenticated;

notify pgrst, 'reload schema';

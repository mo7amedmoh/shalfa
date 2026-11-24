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
  and maintenance.valid_from <= current_date
  and (maintenance.valid_to is null or maintenance.valid_to >= current_date)
left join public.employees maintenance_employee
  on maintenance_employee.id = maintenance.employee_id
left join public.school_supervisor_assignments cleaning
  on cleaning.school_id = s.id
  and cleaning.service = 'cleaning'
  and cleaning.valid_from <= current_date
  and (cleaning.valid_to is null or cleaning.valid_to >= current_date)
left join public.employees cleaning_employee
  on cleaning_employee.id = cleaning.employee_id;

create or replace function public.preview_employee_school_assignments(
  p_employee_id uuid,
  p_service text,
  p_ministry_numbers text[]
)
returns table (
  ministry_number text,
  school_id uuid,
  school_name text,
  school_size text,
  valid_from date,
  assigned_employee_id uuid,
  assigned_employee_name text,
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
  if p_service is null or p_service not in ('maintenance', 'cleaning')
    or p_ministry_numbers is null or cardinality(p_ministry_numbers) > 5000 then
    raise exception 'بيانات معاينة الإسناد غير صالحة';
  end if;
  if not exists (
    select 1 from public.employees e
    where e.id = p_employee_id and e.category = 'supervisor' and e.status = 'active'
  ) then
    raise exception 'الموظف غير موجود أو ليس مشرفاً نشطاً';
  end if;

  return query
  with input_numbers as (
    select public.normalize_ministry_number(value) as normalized_number, position
    from unnest(p_ministry_numbers) with ordinality as input(value, position)
  ),
  matches as (
    select
      input_numbers.normalized_number,
      input_numbers.position,
      s.id as matched_school_id,
      s.name as matched_school_name,
      coalesce(size_corrections.corrected_size::text, s.size_source::text, s.size_calc::text) as matched_school_size,
      count(s.id) over (partition by input_numbers.position) as match_count
    from input_numbers
    left join public.schools s on s.ministry_key = input_numbers.normalized_number
    left join public.school_size_corrections size_corrections on size_corrections.school_id = s.id
  )
  select
    matches.normalized_number,
    case when matches.match_count = 1 then matches.matched_school_id end,
    case when matches.match_count = 1 then matches.matched_school_name end,
    case when matches.match_count = 1 then matches.matched_school_size end,
    active.valid_from,
    active.employee_id,
    assigned_employee.full_name,
    case
      when matches.normalized_number = '' or matches.match_count = 0 then 'not_found'
      when matches.match_count > 1 then 'ambiguous'
      when active.id is null then 'matched'
      when active.employee_id = p_employee_id then 'already_assigned'
      else 'conflict'
    end
  from matches
  left join public.school_supervisor_assignments active
    on active.school_id = matches.matched_school_id
    and active.service = p_service
    and active.valid_to is null
    and matches.match_count = 1
  left join public.employees assigned_employee on assigned_employee.id = active.employee_id
  order by matches.position;
end;
$$;

revoke all on function public.preview_employee_school_assignments(uuid, text, text[]) from public, anon;
grant execute on function public.preview_employee_school_assignments(uuid, text, text[]) to authenticated;

create or replace function public.list_employee_school_assignments(p_employee_id uuid)
returns table (
  assignment_id uuid,
  school_id uuid,
  school_name text,
  ministry_number text,
  school_size text,
  service text,
  valid_from date
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not (
    public.has_permission('workforce.view')
    or public.has_permission('workforce.assign_schools')
  ) then
    raise exception 'غير مصرح بعرض إسنادات المدارس';
  end if;
  if p_employee_id is null then
    raise exception 'الموظف مطلوب لعرض الإسنادات';
  end if;

  return query
  select
    a.id,
    s.id,
    s.name,
    s.ministry_no,
    coalesce(size_corrections.corrected_size::text, s.size_source::text, s.size_calc::text),
    a.service,
    a.valid_from
  from public.school_supervisor_assignments a
  join public.schools s on s.id = a.school_id
  left join public.school_size_corrections size_corrections on size_corrections.school_id = s.id
  where a.employee_id = p_employee_id
    and a.valid_from <= current_date
    and (a.valid_to is null or a.valid_to >= current_date)
  order by a.service, s.name;
end;
$$;

revoke all on function public.list_employee_school_assignments(uuid) from public, anon;
grant execute on function public.list_employee_school_assignments(uuid) to authenticated;

create or replace function public.list_cleaner_school_supervisors(p_employee_id uuid)
returns table (
  school_id uuid,
  school_name text,
  supervisor_name text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.has_permission('workforce.view') then
    raise exception 'غير مصرح بعرض بيانات المشرف';
  end if;
  if not exists (
    select 1 from public.employees e
    where e.id = p_employee_id and e.category = 'cleaner'
  ) then
    raise exception 'العامل غير موجود أو ليس عامل نظافة';
  end if;

  return query
  select s.id, s.name, current_supervisors.cleaning_supervisor_name
  from public.cleaner_assignments a
  join public.schools s on s.id = a.school_id
  left join public.school_current_supervisors current_supervisors on current_supervisors.school_id = s.id
  where a.employee_id = p_employee_id
  order by s.name;
end;
$$;

revoke all on function public.list_cleaner_school_supervisors(uuid) from public, anon;
grant execute on function public.list_cleaner_school_supervisors(uuid) to authenticated;

create or replace function public.list_cleaner_assignment_supervisors()
returns table (
  school_id uuid,
  supervisor_name text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not (
    public.has_permission('workforce.view')
    or public.has_permission('placement.cleaners.view')
    or public.has_permission('workforce.assign_cleaners')
  ) then
    raise exception 'غير مصرح بعرض مشرفي مدارس عمال النظافة';
  end if;

  return query
  select current_supervisors.school_id, current_supervisors.cleaning_supervisor_name
  from public.school_current_supervisors current_supervisors
  where exists (
    select 1 from public.cleaner_assignments a
    where a.school_id = current_supervisors.school_id
  );
end;
$$;

revoke all on function public.list_cleaner_assignment_supervisors() from public, anon;
grant execute on function public.list_cleaner_assignment_supervisors() to authenticated;

create or replace function public.log_employee_identity_open(p_employee_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.has_permission('workforce.view_id_image') then
    raise exception 'غير مصرح بعرض صورة الهوية';
  end if;
  if not exists (
    select 1 from public.employees e
    where e.id = p_employee_id and e.identity_card_path is not null
  ) then
    raise exception 'لا توجد صورة هوية لهذا الموظف';
  end if;

  insert into public.audit_log (actor, action, table_name, row_id, details)
  values (
    auth.uid(),
    'VIEW_EMPLOYEE_IDENTITY_IMAGE',
    'employees',
    p_employee_id::text,
    jsonb_build_object('employee_id', p_employee_id)
  );
end;
$$;

revoke all on function public.log_employee_identity_open(uuid) from public, anon;
grant execute on function public.log_employee_identity_open(uuid) to authenticated;

create or replace function public.update_employee_profile(
  p_employee_id uuid,
  p_full_name text,
  p_employee_no text,
  p_job_title text,
  p_category text,
  p_department text,
  p_phone text,
  p_project_name text,
  p_manager_id uuid,
  p_nationality text,
  p_hire_date text,
  p_status text,
  p_identity_card_path text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.has_permission('settings.view') then
    raise exception 'غير مصرح بتعديل بيانات الموظفين';
  end if;
  if p_employee_id is null or nullif(btrim(p_full_name), '') is null then
    raise exception 'بيانات الموظف غير مكتملة';
  end if;

  update public.employees
  set full_name = btrim(p_full_name),
      employee_no = nullif(btrim(p_employee_no), ''),
      job_title = nullif(btrim(p_job_title), ''),
      category = p_category::public.employee_category,
      department = nullif(btrim(p_department), ''),
      phone = case
        when public.has_permission('workforce.view_contacts') then nullif(btrim(p_phone), '')
        else phone
      end,
      project_name = nullif(btrim(p_project_name), ''),
      manager_id = p_manager_id,
      nationality = nullif(btrim(p_nationality), ''),
      hire_date = nullif(p_hire_date, '')::date,
      status = p_status,
      identity_card_path = case
        when public.has_permission('workforce.view_id_image') then p_identity_card_path
        else identity_card_path
      end
  where id = p_employee_id;

  insert into public.audit_log (action, table_name, row_id, details)
  values (
    'UPDATE_EMPLOYEE_PROFILE',
    'employees',
    p_employee_id::text,
    jsonb_build_object('employee_no', nullif(btrim(p_employee_no), ''), 'project_name', nullif(btrim(p_project_name), ''))
  );
end;
$$;

revoke all on function public.update_employee_profile(uuid,text,text,text,text,text,text,text,uuid,text,text,text,text) from public, anon;
grant execute on function public.update_employee_profile(uuid,text,text,text,text,text,text,text,uuid,text,text,text,text) to authenticated;

notify pgrst, 'reload schema';

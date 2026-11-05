alter table public.profiles
  add column if not exists job_title text;

revoke update (employee_id) on public.profiles from authenticated;

create or replace function public.link_area_engineer_profile(
  p_profile_id uuid,
  p_employee_id uuid default null
)
returns table (profile_id uuid, employee_id uuid, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.profiles;
  linked_employee public.employees;
  created_employee boolean := false;
begin
  if not public.has_role('admin', 'project_manager') then
    raise exception 'غير مصرح بربط مهندسي المناطق';
  end if;

  select * into target
  from public.profiles
  where id = p_profile_id and role = 'area_engineer'
  for update;
  if not found then
    raise exception 'الملف ليس لمهندس منطقة';
  end if;
  if target.employee_id is not null then
    return query select target.id, target.employee_id, false;
    return;
  end if;

  if p_employee_id is null then
    insert into public.employees (full_name, job_title, category)
    values (
      coalesce(nullif(btrim(target.full_name), ''), target.username),
      coalesce(nullif(btrim(target.job_title), ''), 'مهندس منطقة'),
      'engineer'
    )
    returning * into linked_employee;
    created_employee := true;
  else
    select * into linked_employee
    from public.employees
    where id = p_employee_id and category = 'engineer'
    for update;
    if not found then
      raise exception 'يجب اختيار سجل موظف من فئة المهندسين';
    end if;
    if exists (select 1 from public.profiles p where p.employee_id = linked_employee.id) then
      raise exception 'سجل الموظف مربوط بملف آخر';
    end if;
  end if;

  update public.profiles
  set employee_id = linked_employee.id
  where id = target.id;

  insert into public.audit_log (action, table_name, row_id, details)
  values (
    'LINK_AREA_ENGINEER_PROFILE',
    'profiles',
    target.id::text,
    jsonb_build_object('employee_id', linked_employee.id, 'created_employee', created_employee)
  );

  return query select target.id, linked_employee.id, created_employee;
end;
$$;

revoke all on function public.link_area_engineer_profile(uuid, uuid) from public, anon, authenticated;
grant execute on function public.link_area_engineer_profile(uuid, uuid) to authenticated;

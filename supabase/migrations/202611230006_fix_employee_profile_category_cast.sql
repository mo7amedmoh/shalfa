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
      phone = nullif(btrim(p_phone), ''),
      project_name = nullif(btrim(p_project_name), ''),
      manager_id = p_manager_id,
      nationality = nullif(btrim(p_nationality), ''),
      hire_date = nullif(p_hire_date, '')::date,
      status = p_status,
      identity_card_path = p_identity_card_path
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

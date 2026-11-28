begin;

do $$
declare
  actor_id uuid;
  exact_employee_id uuid;
  candidate_employee_id uuid;
  supervisor_employee_id uuid;
  test_school_id uuid;
  exact_no text := 'EMP-IMPORT-' || gen_random_uuid()::text;
  candidate_no text := 'EMP-IMPORT-LINK-' || gen_random_uuid()::text;
  supervisor_no text := 'EMP-IMPORT-SUP-' || gen_random_uuid()::text;
  preview jsonb;
  preview_row jsonb;
  apply_result jsonb;
  matched_count integer;
begin
  select p.id into actor_id
  from public.profiles p
  join public.roles r on r.id = p.role_id
  where p.active and r.key in ('admin', 'project_manager')
  order by case when r.key = 'admin' then 0 else 1 end
  limit 1;
  if actor_id is null then
    raise exception 'employee_import_behavior.sql requires an active admin or project-manager test profile';
  end if;
  perform set_config('request.jwt.claim.sub', actor_id::text, true);

  insert into public.employees (
    full_name, employee_no, job_title, category, department, phone, status
  ) values (
    'اختبار مطابقة الرقم', exact_no, 'مهندس اختبار', 'engineer', 'قسم اختبار', '0501234567', 'active'
  ) returning id into exact_employee_id;

  preview := public.employee_import_preview(jsonb_build_array(jsonb_build_object(
    'full_name', 'اختبار مطابقة الرقم',
    'employee_no', 'EMP-IMPORT-NOT-' || gen_random_uuid()::text,
    'category', 'engineer'
  )));
  preview_row := preview->'rows'->0;
  if preview_row->>'status' <> 'new' or preview_row->>'employee_id' is not null then
    raise exception 'A name-only match must not select an existing employee';
  end if;

  preview := public.employee_import_preview(jsonb_build_array(jsonb_build_object(
    'full_name', 'اسم مختلف وارد',
    'employee_no', exact_no,
    'category', 'engineer'
  )));
  preview_row := preview->'rows'->0;
  if preview_row->>'employee_id' <> exact_employee_id::text
     or preview_row->>'match_method' <> 'employee_no' then
    raise exception 'The exact employee number must match despite a different name';
  end if;

  preview := public.employee_import_preview(jsonb_build_array(jsonb_build_object(
    'full_name', 'اختبار مطابقة الرقم',
    'employee_no', exact_no,
    'job_title', '',
    'category', 'engineer',
    'department', '',
    'phone', '',
    'residence_no', ''
  )));
  preview_row := preview->'rows'->0;
  if preview_row->>'status' <> 'no_change' then
    raise exception 'Blank optional cells must not be interpreted as updates';
  end if;
  perform public.employee_import_apply(
    jsonb_build_array(jsonb_build_object(
      'full_name', 'اختبار مطابقة الرقم',
      'employee_no', exact_no,
      'job_title', '',
      'category', 'engineer',
      'department', '',
      'phone', '',
      'residence_no', ''
    )),
    jsonb_build_array(jsonb_build_object(
      'row', 1, 'fingerprint', preview_row->>'fingerprint', 'action', 'update'
    ))
  );
  if not exists (
    select 1 from public.employees e
    where e.id = exact_employee_id
      and e.phone = '0501234567'
      and e.department = 'قسم اختبار'
  ) then
    raise exception 'Applying blank cells must preserve stored phone and department';
  end if;

  insert into public.employees (full_name, employee_no, category, status)
  values ('مرشح ربط اختبار', 'TEMP-' || gen_random_uuid()::text, 'engineer', 'active')
  returning id into candidate_employee_id;
  preview := public.employee_import_preview(jsonb_build_array(jsonb_build_object(
    'full_name', 'مرشح ربط اختبار',
    'employee_no', candidate_no,
    'category', 'engineer'
  )));
  preview_row := preview->'rows'->0;
  if preview_row->>'status' <> 'needs_decision'
     or preview_row->>'employee_id' is not null
     or not exists (
       select 1 from jsonb_array_elements(preview_row->'candidates') candidate(value)
       where candidate.value->>'id' = candidate_employee_id::text
     ) then
    raise exception 'A name candidate must require an explicit link and must not auto-create a duplicate';
  end if;
  perform public.employee_import_apply(
    jsonb_build_array(jsonb_build_object(
      'full_name', 'مرشح ربط اختبار',
      'employee_no', candidate_no,
      'category', 'engineer'
    )),
    jsonb_build_array(jsonb_build_object(
      'row', 1,
      'fingerprint', preview_row->>'fingerprint',
      'action', 'link',
      'employee_id', candidate_employee_id
    ))
  );
  select count(*) into matched_count
  from public.employees e where e.employee_no = candidate_no;
  if matched_count <> 1 then
    raise exception 'Linking a candidate must update the existing employee instead of creating a duplicate';
  end if;

  select s.id into test_school_id
  from public.schools s
  where not exists (
    select 1
    from public.school_supervisor_assignments a
    where a.school_id = s.id and a.service = 'maintenance' and a.valid_to is null
  )
  limit 1;
  if test_school_id is null then
    raise exception 'employee_import_behavior.sql requires an unassigned school fixture';
  end if;
  insert into public.employees (full_name, employee_no, category, status)
  values ('مشرف اختبار قبل', supervisor_no, 'supervisor', 'active')
  returning id into supervisor_employee_id;
  insert into public.school_supervisor_assignments (
    school_id, employee_id, service, valid_from, assigned_by
  ) values (test_school_id, supervisor_employee_id, 'maintenance', current_date, actor_id);

  preview := public.employee_import_preview(jsonb_build_array(jsonb_build_object(
    'full_name', 'مشرف اختبار قبل مكتمل',
    'employee_no', supervisor_no,
    'category', 'supervisor'
  )));
  preview_row := preview->'rows'->0;
  if preview_row->>'status' <> 'update'
     or preview_row->'diff'->'full_name'->>'classification' <> 'completion' then
    raise exception 'A supervisor name completion should be an update';
  end if;
  apply_result := public.employee_import_apply(
    jsonb_build_array(jsonb_build_object(
      'full_name', 'مشرف اختبار قبل مكتمل',
      'employee_no', supervisor_no,
      'category', 'supervisor'
    )),
    jsonb_build_array(jsonb_build_object(
      'row', 1, 'fingerprint', preview_row->>'fingerprint', 'action', 'update'
    ))
  );
  if not exists (
    select 1 from public.school_supervisor_assignments a
    where a.employee_id = supervisor_employee_id
      and a.school_id = test_school_id
      and a.service = 'maintenance'
      and a.valid_to is null
  ) or not exists (
    select 1 from public.employees e
    where e.id = supervisor_employee_id and e.full_name = 'مشرف اختبار قبل مكتمل'
  ) or apply_result->'school_assignments_before' is distinct from apply_result->'school_assignments_after' then
    raise exception 'Updating a supervisor name must preserve active school assignments and counts';
  end if;
end;
$$;

rollback;

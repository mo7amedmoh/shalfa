alter table public.gatekeepers
  add column if not exists employee_no text,
  add column if not exists employee_id uuid references public.employees(id) on delete set null;

revoke insert, update on public.gatekeepers from authenticated;

create or replace function public.save_gatekeeper(
  p_school_id uuid,
  p_employee_id uuid,
  p_full_name text,
  p_employee_no text,
  p_phone text,
  p_residence_no text,
  p_notes text,
  p_clear_residence boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_gatekeeper public.gatekeepers;
  matched_employee public.employees;
  gatekeeper_id uuid;
  next_employee_no text := nullif(btrim(p_employee_no), '');
  next_phone text := nullif(btrim(p_phone), '');
  next_residence_no text;
  operation text;
begin
  if not public.has_role('admin', 'project_manager', 'area_engineer') then
    raise exception 'غير مصرح بإدارة بيانات البوابين';
  end if;
  if nullif(btrim(p_full_name), '') is null then
    raise exception 'اسم البواب مطلوب';
  end if;
  if not exists (select 1 from public.schools where id = p_school_id and plan_scope is true) then
    raise exception 'المدرسة غير موجودة أو خارج نطاق التسكين';
  end if;

  select g.* into existing_gatekeeper
  from public.gatekeepers g
  where g.school_id = p_school_id
  for update;

  if p_employee_id is not null then
    select e.* into matched_employee
    from public.employees e
    where e.id = p_employee_id
    for update;
    if matched_employee.id is null or matched_employee.category <> 'gatekeeper' then
      raise exception 'الموظف المختار ليس موظفاً من فئة حراس المدارس';
    end if;
  elsif existing_gatekeeper.employee_id is not null then
    select e.* into matched_employee
    from public.employees e
    where e.id = existing_gatekeeper.employee_id
      and e.category = 'gatekeeper'
    for update;
  end if;

  if matched_employee.id is null and next_employee_no is not null then
    select e.* into matched_employee
    from public.employees e
    where e.employee_no = next_employee_no
    for update;
    if matched_employee.id is not null and matched_employee.category <> 'gatekeeper' then
      raise exception 'الرقم الوظيفي مسجل لموظف ليس حارس مدرسة';
    end if;
  end if;

  if matched_employee.id is null then
    select e.* into matched_employee
    from public.employees e
    where e.category = 'gatekeeper'
      and lower(regexp_replace(btrim(e.full_name), '\s+', ' ', 'g'))
        = lower(regexp_replace(btrim(p_full_name), '\s+', ' ', 'g'))
    limit 1
    for update;
    if matched_employee.id is not null and exists (
      select 1 from public.employees e
      where e.category = 'gatekeeper'
        and lower(regexp_replace(btrim(e.full_name), '\s+', ' ', 'g'))
          = lower(regexp_replace(btrim(p_full_name), '\s+', ' ', 'g'))
        and e.id <> matched_employee.id
    ) then
      raise exception 'اسم البواب يطابق أكثر من موظف';
    end if;
  end if;

  if next_employee_no is not null and exists (
    select 1 from public.employees e
    where e.employee_no = next_employee_no
      and (matched_employee.id is null or e.id <> matched_employee.id)
  ) then
    raise exception 'الرقم الوظيفي مسجل لموظف آخر';
  end if;

  if matched_employee.id is null then
    insert into public.employees(full_name, employee_no, residence_no, category, job_title, phone)
    values (
      btrim(p_full_name), next_employee_no,
      case when p_clear_residence then null else nullif(btrim(p_residence_no), '') end,
      'gatekeeper', 'حارس مدرسة', next_phone
    )
    returning * into matched_employee;
    operation := case when existing_gatekeeper.id is null then 'created' else 'updated' end;
  else
    if next_employee_no is not null and matched_employee.employee_no is not null
      and matched_employee.employee_no <> next_employee_no then
      raise exception 'الرقم الوظيفي يختلف عن الموظف المرتبط';
    end if;
    next_residence_no := case
      when p_clear_residence then null
      else coalesce(nullif(btrim(p_residence_no), ''), matched_employee.residence_no)
    end;
    update public.employees e set
      full_name = btrim(p_full_name),
      employee_no = coalesce(next_employee_no, e.employee_no),
      phone = coalesce(next_phone, e.phone),
      residence_no = next_residence_no,
      job_title = 'حارس مدرسة',
      category = 'gatekeeper',
      status = 'active'
    where e.id = matched_employee.id
    returning * into matched_employee;
    operation := case when existing_gatekeeper.id is null then 'created' else 'updated' end;
  end if;

  next_residence_no := matched_employee.residence_no;
  insert into public.gatekeepers(
    school_id, employee_id, full_name, employee_no, phone, residence_no, notes
  ) values (
    p_school_id, matched_employee.id, matched_employee.full_name, matched_employee.employee_no,
    matched_employee.phone, next_residence_no, nullif(btrim(p_notes), '')
  )
  on conflict (school_id) do update set
    employee_id = excluded.employee_id,
    full_name = excluded.full_name,
    employee_no = excluded.employee_no,
    phone = excluded.phone,
    residence_no = excluded.residence_no,
    notes = excluded.notes
  returning id into gatekeeper_id;

  insert into public.audit_log(actor, action, table_name, row_id, details)
  values (
    auth.uid(),
    'save_gatekeeper_employee',
    'gatekeepers',
    gatekeeper_id,
    jsonb_build_object('operation', operation, 'employee_id', matched_employee.id)
  );
  return jsonb_build_object('id', gatekeeper_id, 'employee_id', matched_employee.id, 'operation', operation);
end;
$$;

create or replace function public.backfill_gatekeeper_employees()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  gatekeeper_row public.gatekeepers;
  matched_employee public.employees;
  created_count integer := 0;
  linked_count integer := 0;
  next_employee_no text;
  next_residence_no text;
begin
  if not public.has_role('admin', 'project_manager') then
    raise exception 'غير مصرح بترحيل سجلات البوابين';
  end if;

  for gatekeeper_row in
    select g.*
    from public.gatekeepers g
    left join public.employees linked
      on linked.id = g.employee_id and linked.category = 'gatekeeper'
    where linked.id is null
    order by g.id
    for update of g
  loop
    matched_employee := null;
    next_employee_no := nullif(btrim(gatekeeper_row.employee_no), '');
    if next_employee_no is not null then
      select e.* into matched_employee
      from public.employees e
      where e.employee_no = next_employee_no
      for update;
      if matched_employee.id is not null and matched_employee.category <> 'gatekeeper' then
        raise exception 'الرقم الوظيفي % مسجل لموظف ليس حارس مدرسة', next_employee_no;
      end if;
    end if;

    if matched_employee.id is null then
      select e.* into matched_employee
      from public.employees e
      where e.category = 'gatekeeper'
        and lower(regexp_replace(btrim(e.full_name), '\s+', ' ', 'g'))
          = lower(regexp_replace(btrim(gatekeeper_row.full_name), '\s+', ' ', 'g'))
      limit 1
      for update;
      if matched_employee.id is not null and exists (
        select 1 from public.employees e
        where e.category = 'gatekeeper'
          and lower(regexp_replace(btrim(e.full_name), '\s+', ' ', 'g'))
            = lower(regexp_replace(btrim(gatekeeper_row.full_name), '\s+', ' ', 'g'))
          and e.id <> matched_employee.id
      ) then
        raise exception 'اسم البواب % يطابق أكثر من موظف', gatekeeper_row.full_name;
      end if;
    end if;

    if matched_employee.id is null then
      insert into public.employees(full_name, employee_no, residence_no, category, job_title, phone)
      values (
        btrim(gatekeeper_row.full_name), next_employee_no, gatekeeper_row.residence_no,
        'gatekeeper', 'حارس مدرسة', gatekeeper_row.phone
      )
      returning * into matched_employee;
      created_count := created_count + 1;
    else
      if next_employee_no is not null and matched_employee.employee_no is not null
        and matched_employee.employee_no <> next_employee_no then
        raise exception 'الرقم الوظيفي للبواب % لا يطابق الموظف الموجود', gatekeeper_row.full_name;
      end if;
      if gatekeeper_row.residence_no is not null and matched_employee.residence_no is not null
        and gatekeeper_row.residence_no <> matched_employee.residence_no then
        raise exception 'رقم إقامة البواب % لا يطابق الموظف الموجود', gatekeeper_row.full_name;
      end if;
      next_residence_no := coalesce(matched_employee.residence_no, gatekeeper_row.residence_no);
      update public.employees e set
        employee_no = coalesce(e.employee_no, next_employee_no),
        residence_no = next_residence_no,
        phone = coalesce(e.phone, gatekeeper_row.phone),
        job_title = 'حارس مدرسة',
        category = 'gatekeeper'
      where e.id = matched_employee.id
      returning * into matched_employee;
    end if;

    update public.gatekeepers g set
      employee_id = matched_employee.id,
      employee_no = matched_employee.employee_no,
      phone = matched_employee.phone,
      residence_no = matched_employee.residence_no
    where g.id = gatekeeper_row.id;
    linked_count := linked_count + 1;
  end loop;

  insert into public.audit_log(actor, action, table_name, details)
  values (
    auth.uid(),
    'backfill_gatekeeper_employees',
    'gatekeepers',
    jsonb_build_object('created', created_count, 'linked', linked_count)
  );
  return jsonb_build_object('created', created_count, 'linked', linked_count);
end;
$$;

create or replace function public.gatekeeper_employee_status()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_role('admin', 'project_manager', 'area_engineer') then
    raise exception 'غير مصرح بقراءة حالة ربط البوابين';
  end if;
  return jsonb_build_object(
    'unlinked',
      (select count(*) from public.gatekeepers g
       left join public.employees e on e.id = g.employee_id and e.category = 'gatekeeper'
       where e.id is null),
    'employees',
      (select count(*) from public.employees e where e.category = 'gatekeeper')
  );
end;
$$;

revoke all on function public.save_gatekeeper(uuid, uuid, text, text, text, text, text, boolean) from public, anon;
revoke all on function public.backfill_gatekeeper_employees() from public, anon;
revoke all on function public.gatekeeper_employee_status() from public, anon;
grant execute on function public.save_gatekeeper(uuid, uuid, text, text, text, text, text, boolean) to authenticated;
grant execute on function public.backfill_gatekeeper_employees() to authenticated;
grant execute on function public.gatekeeper_employee_status() to authenticated;

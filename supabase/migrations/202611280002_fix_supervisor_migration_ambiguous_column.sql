create or replace function public.preview_school_supervisor_assignments(p_apply boolean default false)
returns table (
  school_id uuid,
  ministry_number text,
  school_name text,
  service text,
  source_name text,
  employee_id uuid,
  employee_name text,
  match_status text,
  outcome text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  source_row record;
  current_assignment public.school_supervisor_assignments;
  created_assignment_id uuid;
  assigned_count integer := 0;
  already_assigned_count integer := 0;
  conflict_count integer := 0;
begin
  if auth.uid() is null or not public.has_permission('workforce.assign_schools') then
    raise exception 'غير مصرح بمعاينة إسنادات المدارس';
  end if;

  for source_row in
    with source_names as (
      select
        s.id,
        s.ministry_no,
        s.name,
        source.service,
        btrim(s.extra->>source.header) as source_name,
        public.normalise_supervisor_migration_name(s.extra->>source.header) as normalized_name,
        exists (
          select 1
          from public.gatekeepers g
          where g.school_id = s.id
            and source.service = 'maintenance'
            and public.normalise_supervisor_migration_name(g.full_name)
              = public.normalise_supervisor_migration_name(s.extra->>source.header)
        ) as is_gatekeeper
      from public.schools s
      cross join (values
        ('maintenance'::text, 'اسم المشرف (صيانة)'::text),
        ('cleaning'::text, 'اسم المشرف (نظافة)'::text)
      ) as source(service, header)
      where s.missing_from_sheet_at is null
        and nullif(btrim(s.extra->>source.header), '') is not null
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
        join public.employees e
          on e.id = a.employee_id
          and e.category = 'supervisor'
          and e.status = 'active'
        where a.alias_normalised = names.normalized_name
      ) alias_match on true
      left join lateral (
        select
          case when count(*) = 1 then min(e.id::text)::uuid end as employee_id,
          count(*)::integer as match_count
        from public.employees e
        where e.category = 'supervisor'
          and e.status = 'active'
          and public.normalise_supervisor_migration_name(e.full_name) = names.normalized_name
      ) exact_match on alias_match.employee_id is null
    ),
    resolved as (
      select
        resolutions.*,
        case when is_gatekeeper then null
          else coalesce(alias_employee_id, exact_employee_id)
        end as resolved_employee_id
      from resolutions
    )
    select
      resolved.id as school_id,
      resolved.ministry_no as ministry_number,
      resolved.name as school_name,
      resolved.service,
      resolved.source_name,
      resolved.resolved_employee_id as employee_id,
      employee.full_name as employee_name,
      case
        when resolved.is_gatekeeper then 'ambiguous'
        when resolved.alias_employee_id is not null then 'alias'
        when coalesce(resolved.match_count, 0) > 1 then 'ambiguous'
        when resolved.exact_employee_id is not null then 'employee'
        else 'unmatched'
      end as match_status
    from resolved
    left join public.employees employee on employee.id = resolved.resolved_employee_id
    order by resolved.ministry_no, resolved.service, resolved.id
  loop
    outcome := case
      when source_row.match_status = 'unmatched' then 'unmatched'
      when source_row.match_status = 'ambiguous' then 'ambiguous'
      else 'proposed'
    end;

    if source_row.match_status in ('employee', 'alias') then
      select a.* into current_assignment
      from public.school_supervisor_assignments a
      where a.school_id = source_row.school_id
        and a.service = source_row.service
        and a.valid_to is null
      for update;

      if found and current_assignment.employee_id = source_row.employee_id then
        outcome := 'already_assigned';
        already_assigned_count := already_assigned_count + 1;
      elsif found then
        outcome := 'conflict';
        conflict_count := conflict_count + 1;
      elsif p_apply then
        created_assignment_id := null;
        insert into public.school_supervisor_assignments (
          school_id, employee_id, service, valid_from, assigned_by
        ) values (
          source_row.school_id, source_row.employee_id, source_row.service, current_date, auth.uid()
        )
        on conflict (school_id, service) where valid_to is null do nothing
        returning id into created_assignment_id;

        if created_assignment_id is not null then
          outcome := 'assigned';
          assigned_count := assigned_count + 1;
        else
          select a.* into current_assignment
          from public.school_supervisor_assignments a
          where a.school_id = source_row.school_id
            and a.service = source_row.service
            and a.valid_to is null;
          if current_assignment.employee_id = source_row.employee_id then
            outcome := 'already_assigned';
            already_assigned_count := already_assigned_count + 1;
          else
            outcome := 'conflict';
            conflict_count := conflict_count + 1;
          end if;
        end if;
      end if;
    end if;

    school_id := source_row.school_id;
    ministry_number := source_row.ministry_number;
    school_name := source_row.school_name;
    service := source_row.service;
    source_name := source_row.source_name;
    employee_id := source_row.employee_id;
    employee_name := source_row.employee_name;
    match_status := source_row.match_status;
    return next;
  end loop;

  if p_apply then
    insert into public.audit_log (actor, action, table_name, row_id, details)
    values (
      auth.uid(),
      'migrate_school_supervisor_assignments',
      'school_supervisor_assignments',
      auth.uid()::text,
      jsonb_build_object(
        'assigned', assigned_count,
        'already_assigned', already_assigned_count,
        'conflicts', conflict_count
      )
    );
  end if;
end;
$$;

notify pgrst, 'reload schema';

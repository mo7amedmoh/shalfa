-- Add current supervisor assignments for source-header variants already used by school buildings.
-- This supplements, never replaces, an existing active assignment.
with building_sources as (
  select
    s.id as school_id,
    source.service,
    source_name.source_name as source_name
  from public.schools s
  cross join lateral (
    select key as header, value #>> '{}' as source_name
    from jsonb_each(s.extra)
  ) source_name
  cross join lateral (
    values
      ('maintenance'::text),
      ('cleaning'::text)
  ) as source(service)
  where nullif(btrim(source_name.source_name), '') is not null
    and (
      (source.service = 'maintenance'
        and source_name.header ~* 'مشرف'
        and source_name.header ~* '(صيانة|صيانه)')
      or
      (source.service = 'cleaning'
        and source_name.header ~* 'مشرف'
        and source_name.header ~* '(نظافة|نظافه)')
    )
),
resolved as (
  select distinct
    building_sources.school_id,
    building_sources.service,
    employee.id as employee_id
  from building_sources
  join public.employees employee
    on employee.status = 'active'
    and employee.category = 'supervisor'
    and coalesce(employee.job_title, '') !~* '(حارس|بواب)'
    and (
      public.normalise_plan_name(employee.full_name)
        = public.normalise_plan_name(building_sources.source_name)
      or exists (
        select 1
        from public.supervisor_aliases alias
        where alias.employee_id = employee.id
          and alias.alias_normalised
            = public.normalise_plan_name(building_sources.source_name)
      )
    )
  where not exists (
    select 1
    from public.gatekeepers gatekeeper
    where gatekeeper.school_id = building_sources.school_id
      and gatekeeper.full_name = building_sources.source_name
  )
)
insert into public.school_supervisor_assignments (
  school_id,
  employee_id,
  service,
  valid_from,
  valid_to
)
select
  resolved.school_id,
  resolved.employee_id,
  resolved.service,
  current_date,
  null
from resolved
where not exists (
  select 1
  from public.school_supervisor_assignments active
  where active.school_id = resolved.school_id
    and active.service = resolved.service
    and active.valid_to is null
)

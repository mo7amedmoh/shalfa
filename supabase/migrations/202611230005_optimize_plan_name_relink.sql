create index if not exists employees_normalised_full_name_idx
  on public.employees (public.normalise_plan_name(full_name));

create or replace function public.relink_plan_names()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  changed integer := 0;
  relinked integer := 0;
begin
  if not public.has_role('admin', 'project_manager', 'area_engineer') then
    raise exception 'غير مصرح بإعادة ربط أسماء الخطط';
  end if;

  with employee_names as materialized (
    select distinct on (public.normalise_plan_name(e.full_name))
      public.normalise_plan_name(e.full_name) as name_key,
      e.id,
      e.full_name
    from public.employees e
    where nullif(btrim(e.full_name), '') is not null
    order by public.normalise_plan_name(e.full_name), e.id
  ),
  matches as (
    select
      r.id,
      coalesce(alias.employee_id, exact_match.id) as employee_id,
      coalesce(alias_employee.full_name, exact_match.full_name, r.supervisor_name) as full_name
    from public.monthly_plan_rows r
    left join public.supervisor_aliases alias
      on alias.alias_normalised = public.normalise_plan_name(r.supervisor_name)
    left join public.employees alias_employee on alias_employee.id = alias.employee_id
    left join employee_names exact_match
      on exact_match.name_key = public.normalise_plan_name(r.supervisor_name)
    where r.supervisor_id is null
      and nullif(btrim(r.supervisor_name), '') is not null
      and coalesce(alias.employee_id, exact_match.id) is not null
  )
  update public.monthly_plan_rows r
  set supervisor_id = matches.employee_id,
      supervisor_name = matches.full_name
  from matches
  where r.id = matches.id;
  get diagnostics relinked = row_count;
  changed := relinked;

  with employee_names as materialized (
    select distinct on (public.normalise_plan_name(e.full_name))
      public.normalise_plan_name(e.full_name) as name_key,
      e.id,
      e.full_name
    from public.employees e
    where nullif(btrim(e.full_name), '') is not null
    order by public.normalise_plan_name(e.full_name), e.id
  ),
  matches as (
    select
      r.id,
      coalesce(alias.employee_id, exact_match.id) as employee_id,
      coalesce(alias_employee.full_name, exact_match.full_name, r.supervisor_name) as full_name
    from public.general_plan_rows r
    left join public.supervisor_aliases alias
      on alias.alias_normalised = public.normalise_plan_name(r.supervisor_name)
    left join public.employees alias_employee on alias_employee.id = alias.employee_id
    left join employee_names exact_match
      on exact_match.name_key = public.normalise_plan_name(r.supervisor_name)
    where r.supervisor_id is null
      and nullif(btrim(r.supervisor_name), '') is not null
      and coalesce(alias.employee_id, exact_match.id) is not null
  )
  update public.general_plan_rows r
  set supervisor_id = matches.employee_id,
      supervisor_name = matches.full_name
  from matches
  where r.id = matches.id;
  get diagnostics relinked = row_count;
  changed := changed + relinked;

  with employee_names as materialized (
    select distinct on (public.normalise_plan_name(e.full_name))
      public.normalise_plan_name(e.full_name) as name_key,
      e.id
    from public.employees e
    where nullif(btrim(e.full_name), '') is not null
    order by public.normalise_plan_name(e.full_name), e.id
  ),
  matches as (
    select r.id, coalesce(alias.employee_id, exact_match.id) as employee_id
    from public.monthly_plan_rows r
    left join public.supervisor_aliases alias
      on alias.alias_normalised = public.normalise_plan_name(r.engineer_name)
    left join employee_names exact_match
      on exact_match.name_key = public.normalise_plan_name(r.engineer_name)
    where r.engineer_id is null
      and nullif(btrim(r.engineer_name), '') is not null
      and coalesce(alias.employee_id, exact_match.id) is not null
  )
  update public.monthly_plan_rows r
  set engineer_id = matches.employee_id
  from matches
  where r.id = matches.id;
  get diagnostics relinked = row_count;
  changed := changed + relinked;

  insert into public.audit_log(actor, action, table_name, details)
    values (auth.uid(), 'relink_plan_names', 'plan_rows', jsonb_build_object('rows', changed));
  return changed;
end;
$$;

revoke all on function public.relink_plan_names() from public, anon;
grant execute on function public.relink_plan_names() to authenticated;

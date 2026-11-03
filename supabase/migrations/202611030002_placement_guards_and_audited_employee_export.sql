create or replace function public.validate_school_staffing_override()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.corrected_size is not null and new.corrected_size not in ('small', 'medium', 'large') then
    raise exception 'Corrected school size must be small, medium, or large';
  end if;
  if new.staffing_exception is not null then
    if jsonb_typeof(new.staffing_exception) <> 'object'
      or jsonb_typeof(new.staffing_exception->'requiredCleaners') <> 'number'
      or (new.staffing_exception->>'requiredCleaners') !~ '^[0-9]+$'
      or jsonb_typeof(new.staffing_exception->'reason') <> 'string'
      or length(trim(new.staffing_exception->>'reason')) = 0 then
      raise exception 'Staffing exceptions require a non-negative integer and a reason';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists school_staffing_override_guard on public.school_overrides;
create trigger school_staffing_override_guard
before insert or update on public.school_overrides
for each row execute function public.validate_school_staffing_override();

create or replace function public.validate_placement_employee_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actual_category text;
  required_category text;
begin
  if tg_table_name = 'cleaner_assignments' then
    required_category := 'cleaner';
  else
    required_category := 'gatekeeper';
  end if;
  if new.employee_id is null and tg_table_name = 'gatekeeper_assignments' then
    return new;
  end if;
  select employee.employee_category into actual_category
  from public.employees employee
  where employee.id = new.employee_id;
  if actual_category is distinct from required_category then
    raise exception 'Placement employee must belong to category %', required_category;
  end if;
  return new;
end;
$$;

drop trigger if exists cleaner_assignment_category_guard on public.cleaner_assignments;
create trigger cleaner_assignment_category_guard
before insert or update on public.cleaner_assignments
for each row execute function public.validate_placement_employee_category();
drop trigger if exists gatekeeper_assignment_category_guard on public.gatekeeper_assignments;
create trigger gatekeeper_assignment_category_guard
before insert or update on public.gatekeeper_assignments
for each row execute function public.validate_placement_employee_category();

drop function if exists public.audit_employee_export(integer);

create or replace function public.export_employee_roster(p_employee_ids uuid[])
returns table (
  id uuid,
  full_name text,
  employee_number text,
  job_title text,
  department text,
  phone text,
  rating numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  exported_count integer;
begin
  if not public.is_privileged() then
    raise exception 'Only privileged staff may export employee data';
  end if;
  if p_employee_ids is null or cardinality(p_employee_ids) = 0 then
    raise exception 'At least one employee must be selected for export';
  end if;
  select count(*) into exported_count
  from public.employees employee
  where employee.id = any(p_employee_ids);
  insert into public.audit_log(actor_id, action, entity, details)
  values ((select auth.uid()), 'export', 'employees', jsonb_build_object('record_count', exported_count));
  return query
  select employee.id, employee.full_name, employee.employee_number, employee.job_title,
         employee.department, employee.phone, employee_rating.rating
  from public.employees employee
  left join public.employee_ratings employee_rating on employee_rating.employee_id = employee.id
  where employee.id = any(p_employee_ids)
  order by employee.full_name;
end;
$$;

revoke all on function public.export_employee_roster(uuid[]) from public;
grant execute on function public.export_employee_roster(uuid[]) to authenticated;

alter table public.monthly_plan_rows
  add column if not exists contractor_name text;

alter table public.general_plan_rows
  add column if not exists responses_count integer check (responses_count is null or responses_count >= 0),
  add column if not exists contractor_name text;

alter table public.gatekeepers
  add column if not exists employee_no text;

create table public.supervisor_aliases (
  alias_normalised text primary key check (length(btrim(alias_normalised)) > 0),
  employee_id uuid not null references public.employees(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.supervisor_aliases enable row level security;
grant select, insert, update, delete on public.supervisor_aliases to authenticated;

create policy supervisor_aliases_read on public.supervisor_aliases
for select to authenticated
using (public.has_role('admin', 'project_manager', 'area_engineer'));

create policy supervisor_aliases_write on public.supervisor_aliases
for all to authenticated
using (public.has_role('admin', 'project_manager', 'area_engineer'))
with check (public.has_role('admin', 'project_manager', 'area_engineer'));

drop policy gp_rows_write on public.general_plan_rows;
create policy gp_rows_insert on public.general_plan_rows
for insert to authenticated
with check (public.has_role('admin', 'project_manager', 'area_engineer'));

create policy gp_rows_update on public.general_plan_rows
for update to authenticated
using (public.has_role('admin', 'project_manager', 'area_engineer', 'report_follower'))
with check (public.has_role('admin', 'project_manager', 'area_engineer', 'report_follower'));

create policy gp_rows_delete on public.general_plan_rows
for delete to authenticated
using (public.has_role('admin', 'project_manager', 'area_engineer'));

create or replace function public.guard_plan_row_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.current_user_role() = 'report_follower' then
    if (new.plan_id, new.school_id, new.planned_date, new.engineer_id, new.supervisor_id, new.contractor_name)
       is distinct from (old.plan_id, old.school_id, old.planned_date, old.engineer_id, old.supervisor_id, old.contractor_name) then
      raise exception 'غير مصرح: متابع التقارير يستطيع تحديث حالة الزيارة والتقرير فقط';
    end if;
  end if;
  return new;
end $$;

create or replace function public.guard_general_plan_import_fields() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.current_user_role() = 'report_follower' and
    (new.plan_id, new.school_id, new.planned_date, new.responses_count, new.contractor_name)
    is distinct from
    (old.plan_id, old.school_id, old.planned_date, old.responses_count, old.contractor_name) then
    raise exception 'غير مصرح بتعديل بيانات الاستيراد في الخطة العامة';
  end if;
  return new;
end $$;

create trigger general_plan_import_fields_guard
before update on public.general_plan_rows
for each row execute function public.guard_general_plan_import_fields();

create or replace function public.import_general_plan_rows(p_plan_id uuid, p_rows jsonb)
returns table (source_line integer, school_id uuid, operation text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  existing_id uuid;
  row_school_id uuid;
  row_line integer;
begin
  if not public.has_role('admin', 'project_manager', 'area_engineer') then
    raise exception 'غير مصرح باستيراد صفوف الخطط العامة';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'بيانات الاستيراد يجب أن تكون قائمة';
  end if;

  for item in select value from jsonb_array_elements(p_rows)
  loop
    row_school_id := (item->>'school_id')::uuid;
    row_line := (item->>'source_line')::integer;
    select r.id into existing_id
    from public.general_plan_rows r
    where r.plan_id = p_plan_id and r.school_id = row_school_id
    order by r.updated_at desc
    limit 1
    for update;

    if existing_id is null then
      insert into public.general_plan_rows (
        plan_id, school_id, planned_date, responses_count, contractor_name, notes
      ) values (
        p_plan_id,
        row_school_id,
        nullif(item->>'planned_date', '')::date,
        case when item ? 'responses_count' then nullif(item->>'responses_count', '')::integer else null end,
        nullif(item->>'contractor_name', ''),
        nullif(item->>'notes', '')
      );
      source_line := row_line;
      school_id := row_school_id;
      operation := 'created';
    else
      update public.general_plan_rows r set
        planned_date = case when item ? 'planned_date' then nullif(item->>'planned_date', '')::date else r.planned_date end,
        responses_count = case when item ? 'responses_count' then nullif(item->>'responses_count', '')::integer else r.responses_count end,
        contractor_name = case when item ? 'contractor_name' then nullif(item->>'contractor_name', '') else r.contractor_name end,
        notes = case when item ? 'notes' then nullif(item->>'notes', '') else r.notes end
      where r.id = existing_id;
      source_line := row_line;
      school_id := row_school_id;
      operation := 'updated';
    end if;
    return next;
  end loop;
end;
$$;

create or replace function public.resolve_import_cleaner(
  p_school_id uuid,
  p_full_name text,
  p_employee_no text,
  p_residence_no text,
  p_labour_source public.labour_source
)
returns table (id uuid, full_name text, employee_no text, operation text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  matched public.employees;
  employee_no_match public.employees;
  residence_match public.employees;
  assignment_id uuid;
begin
  if not public.has_role('admin', 'project_manager', 'area_engineer') then
    raise exception 'غير مصرح باستيراد عمال النظافة';
  end if;
  if nullif(btrim(p_full_name), '') is null then
    raise exception 'اسم عامل النظافة مطلوب';
  end if;

  if nullif(btrim(p_employee_no), '') is not null then
    select e into employee_no_match from public.employees e
    where e.employee_no = btrim(p_employee_no)
    limit 1;
    if employee_no_match.id is not null and employee_no_match.category <> 'cleaner' then
      raise exception 'الرقم الوظيفي مسجل لموظف ليس عامل نظافة';
    end if;
    if employee_no_match.id is not null and exists (
      select 1 from public.employees e
      where e.employee_no = btrim(p_employee_no) and e.id <> employee_no_match.id
    ) then
      raise exception 'الرقم الوظيفي مرتبط بأكثر من موظف';
    end if;
  end if;
  if nullif(btrim(p_residence_no), '') is not null then
    select e into residence_match from public.employees e
    where e.residence_no = btrim(p_residence_no)
    limit 1;
    if residence_match.id is not null and residence_match.category <> 'cleaner' then
      raise exception 'رقم الإقامة مسجل لموظف ليس عامل نظافة';
    end if;
    if residence_match.id is not null and exists (
      select 1 from public.employees e
      where e.residence_no = btrim(p_residence_no)
        and e.id <> residence_match.id
    ) then
      raise exception 'رقم الإقامة مرتبط بأكثر من موظف';
    end if;
  end if;

  if employee_no_match.id is not null and residence_match.id is not null
    and employee_no_match.id <> residence_match.id then
    raise exception 'الرقم الوظيفي ورقم الإقامة يخصان موظفين مختلفين';
  end if;
  if employee_no_match.id is not null then
    matched := employee_no_match;
  elsif residence_match.id is not null then
    matched := residence_match;
  end if;

  if matched.id is null then
    select e into matched from public.employees e
    where e.category = 'cleaner'
      and lower(regexp_replace(
        translate(btrim(e.full_name), 'أإآٱى', 'ااااي'),
        '\s+', ' ', 'g'
      )) = lower(regexp_replace(
        translate(btrim(p_full_name), 'أإآٱى', 'ااااي'),
        '\s+', ' ', 'g'
      ))
    limit 1;
    if matched.id is not null and exists (
      select 1 from public.employees e
      where e.category = 'cleaner'
        and lower(regexp_replace(
          translate(btrim(e.full_name), 'أإآٱى', 'ااااي'),
          '\s+', ' ', 'g'
        )) = lower(regexp_replace(
          translate(btrim(p_full_name), 'أإآٱى', 'ااااي'),
          '\s+', ' ', 'g'
        ))
        and e.id <> matched.id
    ) then
      raise exception 'اسم عامل النظافة يطابق أكثر من موظف';
    end if;
  end if;

  if matched.id is null then
    insert into public.employees (
      full_name, employee_no, residence_no, category, job_title
    ) values (
      btrim(p_full_name), nullif(btrim(p_employee_no), ''),
      nullif(btrim(p_residence_no), ''), 'cleaner', 'عامل نظافة'
    )
    returning * into matched;
  else
    if nullif(btrim(p_employee_no), '') is not null
      and matched.employee_no is not null
      and matched.employee_no <> btrim(p_employee_no) then
      raise exception 'الرقم الوظيفي يختلف عن رقم الموظف المطابق';
    end if;
    if nullif(btrim(p_residence_no), '') is not null
      and matched.residence_no is not null
      and matched.residence_no <> btrim(p_residence_no) then
      raise exception 'رقم الإقامة يختلف عن الموظف المطابق';
    end if;
    if nullif(btrim(p_employee_no), '') is not null and exists (
      select 1 from public.employees e
      where e.employee_no = btrim(p_employee_no) and e.id <> matched.id
    ) then
      raise exception 'الرقم الوظيفي مسجل لموظف آخر';
    end if;
    if nullif(btrim(p_residence_no), '') is not null and exists (
      select 1 from public.employees e
      where e.residence_no = btrim(p_residence_no) and e.id <> matched.id
    ) then
      raise exception 'رقم الإقامة مسجل لموظف آخر';
    end if;
    update public.employees e set
      employee_no = coalesce(e.employee_no, nullif(btrim(p_employee_no), '')),
      residence_no = coalesce(e.residence_no, nullif(btrim(p_residence_no), ''))
    where e.id = matched.id
    returning * into matched;
  end if;

  select a.id into assignment_id from public.cleaner_assignments a
  where a.employee_id = matched.id
  for update;
  if assignment_id is null then
    insert into public.cleaner_assignments (school_id, employee_id, labour_source)
    values (p_school_id, matched.id, p_labour_source);
    operation := 'created';
  else
    update public.cleaner_assignments a set
      school_id = p_school_id,
      labour_source = p_labour_source
    where a.id = assignment_id;
    operation := 'updated';
  end if;

  id := matched.id;
  full_name := matched.full_name;
  employee_no := matched.employee_no;
  return next;
end;
$$;

revoke all on function public.resolve_import_cleaner(uuid, text, text, text, public.labour_source) from public, anon;
grant execute on function public.resolve_import_cleaner(uuid, text, text, text, public.labour_source) to authenticated;

revoke all on function public.import_general_plan_rows(uuid, jsonb) from public, anon;
grant execute on function public.import_general_plan_rows(uuid, jsonb) to authenticated;

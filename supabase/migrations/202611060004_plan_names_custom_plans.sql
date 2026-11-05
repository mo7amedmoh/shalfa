create or replace function public.normalise_plan_name(value text)
returns text
language sql
immutable
set search_path = public
as $$
  select lower(regexp_replace(
    translate(coalesce(value, ''), 'أإآٱىةـ', 'اااايي'),
    '[[:space:][:punct:]]+', ' ', 'g'
  ))::text;
$$;

alter table public.monthly_plan_rows
  add column if not exists supervisor_name text,
  add column if not exists engineer_name text;
alter table public.general_plan_rows
  add column if not exists supervisor_name text,
  add column if not exists engineer_name text;
create index if not exists monthly_plan_rows_supervisor_name_idx
  on public.monthly_plan_rows (public.normalise_plan_name(supervisor_name));
create index if not exists monthly_plan_rows_engineer_name_idx
  on public.monthly_plan_rows (public.normalise_plan_name(engineer_name));
create index if not exists general_plan_rows_supervisor_name_idx
  on public.general_plan_rows (public.normalise_plan_name(supervisor_name));
create index if not exists general_plan_rows_engineer_name_idx
  on public.general_plan_rows (public.normalise_plan_name(engineer_name));

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
  update public.monthly_plan_rows r
  set supervisor_id = coalesce(
        (select employee_id from public.supervisor_aliases where alias_normalised = public.normalise_plan_name(r.supervisor_name) limit 1),
        (select id from public.employees where public.normalise_plan_name(full_name) = public.normalise_plan_name(r.supervisor_name) limit 1)
      ),
      supervisor_name = coalesce(
        (select full_name from public.employees where id = (select employee_id from public.supervisor_aliases where alias_normalised = public.normalise_plan_name(r.supervisor_name) limit 1)),
        (select full_name from public.employees where public.normalise_plan_name(full_name) = public.normalise_plan_name(r.supervisor_name) limit 1),
        r.supervisor_name
      )
  where r.supervisor_id is null and nullif(btrim(r.supervisor_name), '') is not null
    and coalesce(
      (select employee_id from public.supervisor_aliases where alias_normalised = public.normalise_plan_name(r.supervisor_name) limit 1),
      (select id from public.employees where public.normalise_plan_name(full_name) = public.normalise_plan_name(r.supervisor_name) limit 1)
    ) is not null;
  get diagnostics relinked = row_count;
  changed := relinked;
  update public.general_plan_rows r
  set supervisor_id = coalesce(
        (select employee_id from public.supervisor_aliases where alias_normalised = public.normalise_plan_name(r.supervisor_name) limit 1),
        (select id from public.employees where public.normalise_plan_name(full_name) = public.normalise_plan_name(r.supervisor_name) limit 1)
      ),
      supervisor_name = coalesce(
        (select full_name from public.employees where id = (select employee_id from public.supervisor_aliases where alias_normalised = public.normalise_plan_name(r.supervisor_name) limit 1)),
        (select full_name from public.employees where public.normalise_plan_name(full_name) = public.normalise_plan_name(r.supervisor_name) limit 1),
        r.supervisor_name
      )
  where r.supervisor_id is null and nullif(btrim(r.supervisor_name), '') is not null
    and coalesce(
      (select employee_id from public.supervisor_aliases where alias_normalised = public.normalise_plan_name(r.supervisor_name) limit 1),
      (select id from public.employees where public.normalise_plan_name(full_name) = public.normalise_plan_name(r.supervisor_name) limit 1)
    ) is not null;
  get diagnostics relinked = row_count;
  changed := changed + relinked;
  update public.monthly_plan_rows r
  set engineer_id = coalesce(
    (select employee_id from public.supervisor_aliases where alias_normalised = public.normalise_plan_name(r.engineer_name) limit 1),
    (select id from public.employees where public.normalise_plan_name(full_name) = public.normalise_plan_name(r.engineer_name) limit 1))
  where r.engineer_id is null and nullif(btrim(r.engineer_name), '') is not null;
  get diagnostics relinked = row_count;
  changed := changed + relinked;
  insert into public.audit_log(actor, action, table_name, details)
    values (auth.uid(), 'relink_plan_names', 'plan_rows', jsonb_build_object('rows', changed));
  return changed;
end;
$$;
revoke all on function public.relink_plan_names() from public, anon;
grant execute on function public.relink_plan_names() to authenticated;

create table if not exists public.custom_plan_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  cadence text not null check (cadence in ('monthly','yearly')),
  scope text not null check (scope in ('all_in_scope','manual')),
  track_visit_report boolean not null default true,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  is_active boolean not null default true
);
create unique index if not exists custom_plan_types_active_name_idx
  on public.custom_plan_types (name) where is_active;
create table if not exists public.custom_plans (
  id uuid primary key default gen_random_uuid(),
  type_id uuid not null references public.custom_plan_types(id) on delete cascade,
  period date not null,
  unique (type_id, period)
);
create table if not exists public.custom_plan_rows (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.custom_plans(id) on delete cascade,
  school_id uuid references public.schools(id) on delete set null,
  planned_date date,
  execution_date date,
  status text not null default 'planned' check (status in ('planned','in_progress','done','cancelled')),
  supervisor_id uuid references public.employees(id) on delete set null,
  supervisor_name text,
  engineer_name text,
  visited boolean,
  report_done boolean,
  contractor_name text,
  notes text
);
alter table public.custom_plan_types enable row level security;
alter table public.custom_plans enable row level security;
alter table public.custom_plan_rows enable row level security;
grant select, insert, update, delete on public.custom_plan_types, public.custom_plans, public.custom_plan_rows to authenticated;
create policy custom_types_read on public.custom_plan_types for select to authenticated using (public.is_member());
create policy custom_types_write on public.custom_plan_types for insert to authenticated with check (public.has_role('admin','project_manager'));
create policy custom_types_update on public.custom_plan_types for update to authenticated using (public.has_role('admin','project_manager')) with check (public.has_role('admin','project_manager'));
create policy custom_types_delete on public.custom_plan_types for delete to authenticated using (public.has_role('admin','project_manager'));
create policy custom_plans_read on public.custom_plans for select to authenticated using (public.is_member());
create policy custom_plans_write on public.custom_plans for all to authenticated using (public.has_role('admin','project_manager','area_engineer')) with check (public.has_role('admin','project_manager','area_engineer'));
create policy custom_rows_read on public.custom_plan_rows for select to authenticated using (public.is_member());
create policy custom_rows_write on public.custom_plan_rows for insert to authenticated with check (public.has_role('admin','project_manager','area_engineer'));
create policy custom_rows_update on public.custom_plan_rows for update to authenticated using (public.has_role('admin','project_manager','area_engineer')) with check (public.has_role('admin','project_manager','area_engineer'));
create policy custom_rows_delete on public.custom_plan_rows for delete to authenticated using (public.has_role('admin','project_manager','area_engineer'));

drop policy if exists monthly_plan_rows_delete on public.monthly_plan_rows;
create policy monthly_plan_rows_delete on public.monthly_plan_rows for delete to authenticated
using (public.has_role('admin','project_manager','area_engineer'));
drop policy if exists monthly_plans_delete on public.monthly_plans;
create policy monthly_plans_delete on public.monthly_plans for delete to authenticated
using (public.has_role('admin','project_manager','area_engineer'));
drop policy if exists general_plans_delete on public.general_plans;
create policy general_plans_delete on public.general_plans for delete to authenticated
using (public.has_role('admin','project_manager','area_engineer'));

create or replace function public.audit_plan_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log(actor, action, table_name, row_id, details)
  values (auth.uid(), 'delete', tg_table_name, old.id, jsonb_build_object('plan_id', old.plan_id));
  return old;
end $$;
drop trigger if exists audit_monthly_plan_row_delete on public.monthly_plan_rows;
create trigger audit_monthly_plan_row_delete after delete on public.monthly_plan_rows for each row execute function public.audit_plan_delete();
drop trigger if exists audit_general_plan_row_delete on public.general_plan_rows;
create trigger audit_general_plan_row_delete after delete on public.general_plan_rows for each row execute function public.audit_plan_delete();

create or replace function public.audit_plan_delete_parent()
returns trigger language plpgsql security definer set search_path = public as $$
declare row_count integer;
begin
  if tg_table_name = 'monthly_plans' then
    select count(*) into row_count from public.monthly_plan_rows where plan_id = old.id;
  else
    select count(*) into row_count from public.general_plan_rows where plan_id = old.id;
  end if;
  if tg_table_name = 'monthly_plans' then
    insert into public.audit_log(actor, action, table_name, row_id, details)
    values (auth.uid(), 'delete_plan', tg_table_name, old.id,
      jsonb_build_object('plan_id', old.id, 'month', old.month, 'row_count', row_count));
  else
    insert into public.audit_log(actor, action, table_name, row_id, details)
    values (auth.uid(), 'delete_plan', tg_table_name, old.id,
      jsonb_build_object('plan_id', old.id, 'year', old.year, 'row_count', row_count));
  end if;
  return old;
end $$;
drop trigger if exists audit_monthly_plan_delete on public.monthly_plans;
create trigger audit_monthly_plan_delete before delete on public.monthly_plans for each row execute function public.audit_plan_delete_parent();
drop trigger if exists audit_general_plan_delete on public.general_plans;
create trigger audit_general_plan_delete before delete on public.general_plans for each row execute function public.audit_plan_delete_parent();

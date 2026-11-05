alter table public.custom_plan_types
  add column if not exists group_key text not null default 'monthly'
    check (group_key in ('monthly', 'general'));

create unique index if not exists custom_plan_types_active_normalised_name_idx
  on public.custom_plan_types (public.normalise_plan_name(name))
  where is_active;

create unique index if not exists custom_plan_rows_plan_school_idx
  on public.custom_plan_rows (plan_id, school_id)
  where school_id is not null;

drop policy if exists custom_types_write on public.custom_plan_types;
create policy custom_types_write on public.custom_plan_types for insert to authenticated
  with check (public.has_role('admin', 'project_manager', 'area_engineer'));

create or replace function public.audit_custom_plan_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  row_count integer;
begin
  select count(*) into row_count
  from public.custom_plan_rows
  where plan_id in (select id from public.custom_plans where type_id = old.id);
  insert into public.audit_log(actor, action, table_name, row_id, details)
    values (auth.uid(), 'delete_custom_plan_type', tg_table_name, old.id,
      jsonb_build_object('name', old.name, 'row_count', row_count));
  return old;
end;
$$;

drop trigger if exists audit_custom_plan_type_delete on public.custom_plan_types;
create trigger audit_custom_plan_type_delete
before delete on public.custom_plan_types
for each row execute function public.audit_custom_plan_delete();

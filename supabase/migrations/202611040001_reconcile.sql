create table public.app_config (
  key text primary key check (key in ('school_sync', 'plan_eligibility')),
  value jsonb not null,
  updated_by uuid not null default auth.uid() references auth.users(id),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_app_config()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

create trigger app_config_touch
before insert or update on public.app_config
for each row execute function public.touch_app_config();

alter table public.app_config enable row level security;
grant select, insert, update, delete on public.app_config to authenticated;

create policy app_config_select on public.app_config
for select to authenticated using (public.is_member());

create policy app_config_write on public.app_config
for all to authenticated
using (public.has_role('admin', 'project_manager'))
with check (public.has_role('admin', 'project_manager') and updated_by = auth.uid());

alter table public.gatekeepers
  add column employee_id uuid references public.employees(id) on delete set null;
grant select (employee_id) on public.gatekeepers to authenticated;

create table public.school_size_corrections (
  school_id uuid primary key references public.schools(id) on delete cascade,
  corrected_size text not null check (corrected_size in ('small', 'medium', 'large')),
  updated_by uuid not null default auth.uid() references auth.users(id),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_school_size_correction()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

create trigger school_size_corrections_touch
before insert or update on public.school_size_corrections
for each row execute function public.touch_school_size_correction();

alter table public.school_size_corrections enable row level security;
grant select, insert, update, delete on public.school_size_corrections to authenticated;

create policy school_size_corrections_select on public.school_size_corrections
for select to authenticated using (public.is_member());

create policy school_size_corrections_write on public.school_size_corrections
for all to authenticated
using (public.has_role('admin', 'project_manager'))
with check (public.has_role('admin', 'project_manager') and updated_by = auth.uid());

drop policy checklist_read on public.checklist_items;
create policy checklist_read on public.checklist_items
for select to authenticated
using (public.has_role('admin', 'project_manager'));

drop policy deliv_read on public.deliverables;
create policy deliv_read on public.deliverables
for select to authenticated
using (public.has_role('admin', 'project_manager'));

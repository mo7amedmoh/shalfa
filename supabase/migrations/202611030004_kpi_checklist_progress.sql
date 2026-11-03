create table public.kpi_checklist_progress (
  id text primary key check (id ~ '^(CM|OM)-[1-9][0-9]*$'),
  owner text not null default '' check (char_length(owner) <= 120),
  status text not null default 'لم يبدأ'
    check (status in ('مكتمل', 'جارٍ', 'لم يبدأ', 'لا ينطبق')),
  notes text not null default '' check (char_length(notes) <= 2000),
  updated_by uuid not null references public.user_profiles(id),
  updated_at timestamptz not null default now()
);

alter table public.kpi_checklist_progress enable row level security;

create policy "authenticated read KPI checklist progress"
  on public.kpi_checklist_progress
  for select to authenticated using (true);

create policy "authorized staff manage KPI checklist progress"
  on public.kpi_checklist_progress
  for all to authenticated
  using (public.current_app_role() in ('admin', 'project_manager', 'area_engineer'))
  with check (
    public.current_app_role() in ('admin', 'project_manager', 'area_engineer')
    and updated_by = (select auth.uid())
  );

create or replace function public.touch_kpi_checklist_progress()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger kpi_checklist_progress_updated_at
before insert or update on public.kpi_checklist_progress
for each row execute function public.touch_kpi_checklist_progress();

create trigger audit_kpi_checklist_progress
after insert or update or delete on public.kpi_checklist_progress
for each row execute function public.audit_row_change();

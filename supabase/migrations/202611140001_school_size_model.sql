alter table public.schools
  drop constraint if exists schools_size_source_check,
  add constraint schools_size_source_check
    check (size_source is null or size_source in (
      'small', 'small_plus', 'medium', 'medium_plus', 'large', 'large_plus'
    ));

alter table public.school_size_corrections
  drop constraint if exists school_size_corrections_corrected_size_check,
  add constraint school_size_corrections_corrected_size_check
    check (corrected_size in (
      'small', 'small_plus', 'medium', 'medium_plus', 'large', 'large_plus'
    ));

alter table public.app_config
  drop constraint if exists app_config_key_check,
  add constraint app_config_key_check
    check (key in ('school_sync', 'plan_eligibility', 'staffing_rules'));

insert into public.app_config (key, value, updated_by)
select
  'staffing_rules',
  '{"small":1,"small_plus":2,"medium":2,"medium_plus":3,"large":3,"large_plus":4}'::jsonb,
  p.id
from public.profiles p
where p.role = 'admin'
order by p.created_at
limit 1
on conflict (key) do nothing;

drop policy if exists app_config_write on public.app_config;

create policy app_config_write on public.app_config
for all to authenticated
using (
  (key = 'staffing_rules' and public.has_role('admin'))
  or (key <> 'staffing_rules' and public.has_role('admin', 'project_manager'))
)
with check (
  updated_by = auth.uid()
  and (
    (key = 'staffing_rules' and public.has_role('admin'))
    or (key <> 'staffing_rules' and public.has_role('admin', 'project_manager'))
  )
);

drop view if exists public.school_staffing;

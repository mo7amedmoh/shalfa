update public.cleaner_assignments
set labour_source = 'ajeer'
where labour_source <> 'ajeer';

alter table public.cleaner_assignments
  alter column labour_source set default 'ajeer';

alter table public.cleaner_assignments
  add constraint cleaner_assignments_ajeer_source_check
  check (labour_source = 'ajeer');

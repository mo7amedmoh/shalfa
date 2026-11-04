alter table public.app_settings
  add column award_letter_date date default '2026-07-01';

alter table public.deliverables
  add column duration_text text;

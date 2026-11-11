alter table public.monthly_plans
  add column if not exists late_by_planned_date boolean not null default true;

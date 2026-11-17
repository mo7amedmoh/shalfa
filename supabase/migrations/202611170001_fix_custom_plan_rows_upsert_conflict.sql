drop index if exists public.custom_plan_rows_plan_school_idx;

create unique index custom_plan_rows_plan_school_idx
  on public.custom_plan_rows (plan_id, school_id);

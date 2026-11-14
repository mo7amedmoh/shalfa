alter table public.general_plan_rows
  add column report_done boolean not null default false,
  add column report_done_date date,
  add constraint general_plan_rows_report_done_date_check
    check (report_done or report_done_date is null);

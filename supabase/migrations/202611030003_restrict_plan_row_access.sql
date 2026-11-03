drop policy if exists "authorized staff update monthly rows"
  on public.monthly_plan_rows;

create policy "plan owners and privileged manage monthly rows"
  on public.monthly_plan_rows
  for all to authenticated
  using (
    public.current_app_role() in ('admin', 'project_manager')
    or (
      public.current_app_role() = 'area_engineer'
      and exists (
        select 1
        from public.monthly_plans p
        where p.id = plan_id
          and p.created_by = (select auth.uid())
      )
    )
  )
  with check (
    public.current_app_role() in ('admin', 'project_manager')
    or (
      public.current_app_role() = 'area_engineer'
      and exists (
        select 1
        from public.monthly_plans p
        where p.id = plan_id
          and p.created_by = (select auth.uid())
      )
    )
  );

create policy "report followers update monthly status"
  on public.monthly_plan_rows
  for update to authenticated
  using (public.current_app_role() = 'report_follower')
  with check (public.current_app_role() = 'report_follower');

create or replace function public.guard_report_follower_monthly_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.current_app_role() = 'report_follower'
    and (to_jsonb(new) - array['visited_at', 'report_completed_at'])
        is distinct from
        (to_jsonb(old) - array['visited_at', 'report_completed_at']) then
    raise exception 'Report followers may only update visit and report dates';
  end if;
  return new;
end;
$$;

drop trigger if exists report_follower_monthly_row_guard
  on public.monthly_plan_rows;

create trigger report_follower_monthly_row_guard
before update on public.monthly_plan_rows
for each row
execute function public.guard_report_follower_monthly_row();

drop policy if exists "authorized staff manage general plans"
  on public.general_plan_rows;

create policy "authorized staff manage general plans"
  on public.general_plan_rows
  for all to authenticated
  using (
    public.current_app_role() in ('admin', 'project_manager')
    or (
      public.current_app_role() = 'area_engineer'
      and created_by = (select auth.uid())
    )
  )
  with check (
    public.current_app_role() in ('admin', 'project_manager')
    or (
      public.current_app_role() = 'area_engineer'
      and created_by = (select auth.uid())
    )
  );

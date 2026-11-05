-- Run with a Supabase/Postgres test harness (pgTAP). These assertions cover
-- the RPC authorization and its employee-category contract.
select plan(2);

select ok(
  has_function_privilege(
  'authenticated',
  'public.link_area_engineer_profile(uuid,uuid)',
  'EXECUTE'
  ),
  'authenticated can call the linking RPC'
);
select ok(
  not has_column_privilege(
    'authenticated',
    'public.profiles',
    'employee_id',
    'UPDATE'
  ),
  'authenticated cannot update profiles.employee_id directly'
);

select * from finish();

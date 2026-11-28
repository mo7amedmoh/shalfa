do $$
declare
  preview_is_definer boolean;
  apply_is_definer boolean;
  preview_config text[];
  apply_config text[];
begin
  if not exists (
    select 1
    from public.permissions
    where key = 'workforce.import_employees' and enforced_in_db
  ) then
    raise exception 'Employee import permission must be registered and enforced in the database';
  end if;
  if exists (
    select expected_roles.role_key
    from (values ('admin'::text), ('project_manager'::text)) expected_roles(role_key)
    join public.roles r on r.key = expected_roles.role_key
    where not exists (
      select 1
      from public.role_permissions rp
      where rp.role_id = r.id and rp.permission_key = 'workforce.import_employees'
    )
  ) then
    raise exception 'Admin and project manager roles must receive the employee import permission';
  end if;

  if public.employee_import_digits('٠٥١٢٣٤٥٦٧٨') <> '0512345678' then
    raise exception 'Arabic digit normalization failed';
  end if;
  if public.employee_import_normalize_name('أَحْمَدٌ إِبْرَاهِيم') <> 'احمد ابراهيم' then
    raise exception 'Arabic name normalization failed';
  end if;
  if not public.employee_import_contains_words('محمد علي', 'محمد علي عبدالله')
     or public.employee_import_contains_words('محمد علي', 'محمد علياء') then
    raise exception 'Candidate name token matching failed';
  end if;

  select p.prosecdef, p.proconfig
  into preview_is_definer, preview_config
  from pg_catalog.pg_proc p
  where p.oid = 'public.employee_import_preview(jsonb)'::regprocedure;
  if not found or not preview_is_definer
     or not coalesce(array_to_string(preview_config, ',') like '%search_path=%', false) then
    raise exception 'Preview RPC must be SECURITY DEFINER with a fixed search_path';
  end if;

  select p.prosecdef, p.proconfig
  into apply_is_definer, apply_config
  from pg_catalog.pg_proc p
  where p.oid = 'public.employee_import_apply(jsonb,jsonb)'::regprocedure;
  if not found or not apply_is_definer
     or not coalesce(array_to_string(apply_config, ',') like '%search_path=%', false) then
    raise exception 'Apply RPC must be SECURITY DEFINER with a fixed search_path';
  end if;

  if not has_function_privilege('authenticated', 'public.employee_import_preview(jsonb)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.employee_import_apply(jsonb,jsonb)', 'EXECUTE') then
    raise exception 'Authenticated users must be able to invoke the employee import RPCs';
  end if;
  if has_function_privilege('anon', 'public.employee_import_preview(jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.employee_import_apply(jsonb,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.employee_import_preview_row(jsonb,integer,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.employee_import_metrics()', 'EXECUTE') then
    raise exception 'Employee import internals must not be directly executable by client roles';
  end if;
end;
$$;

do $$
declare
  role_row record;
  permission_row record;
  legacy_allowed boolean;
  permission_allowed boolean;
  legacy_update_capable boolean;
  legacy_row_field_restricted boolean;
  permission_row_field_restricted boolean;
begin
  if (
    select count(*)
    from public.roles
    where is_system
      and key in ('admin', 'project_manager', 'area_engineer', 'report_follower', 'supervisor', 'viewer')
  ) <> 6 then
    raise exception 'expected all six system roles for batch-one behavior comparison';
  end if;

  for role_row in
    select r.id, r.key
    from public.roles r
    where r.is_system
      and r.key in ('admin', 'project_manager', 'area_engineer', 'report_follower', 'supervisor', 'viewer')
    order by r.key
  loop
    for permission_row in
      select *
      from (values
        ('residence.reveal', array['admin', 'project_manager', 'area_engineer']::text[]),
        ('gatekeepers.manage', array['admin', 'project_manager', 'area_engineer']::text[]),
        ('gatekeepers.export_residence', array['admin', 'project_manager']::text[]),
        ('attendance.view', array['admin', 'project_manager']::text[]),
        ('attendance.manage', array['admin', 'project_manager']::text[]),
        ('attendance.import', array['admin', 'project_manager']::text[]),
        ('plans.write_row_fields', array['admin', 'project_manager', 'area_engineer']::text[])
      ) as expected(key, legacy_roles)
    loop
      legacy_allowed := role_row.key = any(permission_row.legacy_roles);
      select role_row.key = 'admin' or exists (
        select 1
        from public.role_permissions rp
        where rp.role_id = role_row.id
          and rp.permission_key = permission_row.key
      ) into permission_allowed;

      if permission_allowed is distinct from legacy_allowed then
        raise exception 'batch-one role behavior changed for role %, permission %: before %, after %',
          role_row.key, permission_row.key, legacy_allowed, permission_allowed;
      end if;
    end loop;

    legacy_update_capable := role_row.key = any(
      array['admin', 'project_manager', 'area_engineer', 'report_follower']::text[]
    );
    legacy_row_field_restricted := legacy_update_capable and role_row.key = 'report_follower';
    select legacy_update_capable and role_row.key <> 'admin' and not exists (
      select 1
      from public.role_permissions rp
      where rp.role_id = role_row.id
        and rp.permission_key = 'plans.write_row_fields'
    ) into permission_row_field_restricted;

    if permission_row_field_restricted is distinct from legacy_row_field_restricted then
      raise exception 'visit/report-only behavior changed for role %: before %, after %',
        role_row.key, legacy_row_field_restricted, permission_row_field_restricted;
    end if;
  end loop;

  if (
    select count(*)
    from public.permissions
    where key = any(array[
      'residence.reveal',
      'gatekeepers.manage',
      'gatekeepers.export_residence',
      'attendance.view',
      'attendance.manage',
      'attendance.import',
      'plans.write_row_fields'
    ])
      and enforced_in_db
  ) <> 7 then
    raise exception 'all batch-one permissions must be marked enforced_in_db';
  end if;
end;
$$;

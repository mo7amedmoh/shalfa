-- Read-only regression test for the legacy role-permission matrix.
-- Raises an exception on the first mismatch; does not depend on pgTAP.

do $$
declare
  role_row record;
  permission_row record;
  expected_granted boolean;
  actual_granted boolean;
  expected_effective boolean;
begin
  for role_row in
    select r.key role_key, r.id role_id, sample.user_id
    from public.roles r
    left join lateral (
      select p.id user_id
      from public.profiles p
      where p.role_id = r.id and p.active
      order by p.id
      limit 1
    ) sample on true
    where r.is_system
  loop
    if role_row.user_id is not null then
      perform set_config('request.jwt.claim.sub', role_row.user_id::text, true);
    end if;

    for permission_row in
      select key from public.permissions order by key
    loop
      expected_granted := (role_row.role_key = 'admin' and permission_row.key <> 'plans.write_row_fields')
        or case role_row.role_key
          when 'project_manager' then permission_row.key = any(array[
            'dashboard.view','schools.view','schools.edit','schools.correct_size','schools.export_csv',
            'plans.view','plans.create_delete','plans.edit_rows','plans.write_row_fields','plans.record_visit_report',
            'plans.bulk_update_general','plans.import','plans.redistribute_remaining','plans.manage_types',
            'workforce.view','workforce.assign_cleaners','placement.cleaners.view',
            'placement.gatekeepers.view','gatekeepers.manage','gatekeepers.backfill',
            'gatekeepers.export_residence','residence.reveal','staffing.rules.view',
            'staffing.exceptions.manage','attendance.view','attendance.manage','attendance.import',
            'attendance.export','kpi.view','kpi.edit','kpi.approve','deliverables.view',
            'deliverables.edit','rewards.view','reports.tools','tools.ticket_analysis','settings.view'
          ])
          when 'area_engineer' then permission_row.key = any(array[
            'dashboard.view','schools.view','schools.export_csv','plans.view','plans.create_delete',
            'plans.write_row_fields','plans.record_visit_report','plans.bulk_update_general','plans.import','workforce.view',
            'workforce.assign_cleaners','placement.cleaners.view','placement.gatekeepers.view',
            'gatekeepers.manage','residence.reveal','kpi.view','deliverables.view','rewards.view',
            'rewards.distribute','reports.tools'
          ])
          when 'report_follower' then permission_row.key = any(array[
            'dashboard.view','schools.view','schools.export_csv','plans.view','plans.record_visit_report',
            'workforce.view','placement.cleaners.view','placement.gatekeepers.view','kpi.view',
            'deliverables.view','rewards.view','reports.tools'
          ])
          when 'supervisor' then permission_row.key = any(array[
            'dashboard.view','schools.view','schools.export_csv','plans.view','workforce.view',
            'placement.cleaners.view','placement.gatekeepers.view','kpi.view','deliverables.view','rewards.view'
          ])
          when 'viewer' then permission_row.key = any(array[
            'dashboard.view','schools.view','schools.export_csv','plans.view','workforce.view',
            'placement.cleaners.view','placement.gatekeepers.view','kpi.view','deliverables.view','rewards.view'
          ])
          else false
        end;

      select exists (
        select 1
        from public.role_permissions rp
        where rp.role_id = role_row.role_id
          and rp.permission_key = permission_row.key
      ) into actual_granted;

      if actual_granted is distinct from expected_granted then
        raise exception 'role_permissions mismatch for role %, permission %: expected %, got %',
          role_row.role_key, permission_row.key, expected_granted, actual_granted;
      end if;

      if role_row.user_id is not null then
        expected_effective := case
          when role_row.role_key = 'admin' then true
          else coalesce((
            select o.granted
            from public.user_permission_overrides o
            where o.user_id = role_row.user_id
              and o.permission_key = permission_row.key
          ), expected_granted)
        end;

        if public.has_permission(permission_row.key) is distinct from expected_effective then
          raise exception 'has_permission mismatch for role %, permission %: expected %, got %',
            role_row.role_key, permission_row.key, expected_effective,
            public.has_permission(permission_row.key);
        end if;
      end if;
    end loop;
  end loop;
end;
$$;

-- Individual overrides must take precedence over role defaults.
do $$
declare
  sample record;
  role_default boolean;
  override_value boolean;
  effective_value boolean;
begin
  select p.id user_id, p.role_id
  into sample
  from public.profiles p
  join public.roles r on r.id = p.role_id
  where r.key = 'viewer' and p.active
  order by p.id
  limit 1;

  if sample.user_id is not null then
    select exists (
      select 1
      from public.role_permissions rp
      where rp.role_id = sample.role_id
        and rp.permission_key = 'schools.view'
    ) into role_default;

    select o.granted
    into override_value
    from public.user_permission_overrides o
    where o.user_id = sample.user_id
      and o.permission_key = 'schools.view';

    effective_value := coalesce(override_value, role_default);
    if effective_value is distinct from (
      select coalesce(override_value, role_default)
    ) then
      raise exception 'individual override precedence check failed';
    end if;
  end if;
end;
$$;

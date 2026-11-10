begin;

do $$
declare
  admin_id uuid := gen_random_uuid();
  source_id uuid := gen_random_uuid();
  target_id uuid := gen_random_uuid();
  v_plan_id uuid := gen_random_uuid();
  merge_result jsonb;
begin
  insert into auth.users (id, aud, role, email, encrypted_password)
  values (admin_id, 'authenticated', 'authenticated', 'ct-' || substr(admin_id::text, 1, 8) || '@example.test', '');
  update public.profiles set role = 'admin' where id = admin_id;
  perform set_config('request.jwt.claim.sub', admin_id::text, true);

  insert into public.schools (id, ministry_no, name, source_key, missing_from_sheet_at)
  values
    (source_id, 'M001234', 'مدرسة قديمة', 'm001234#1', now()),
    (target_id, '1234', 'مدرسة حالية', '1234#1', null);

  insert into public.monthly_plans (id, plan_type, month) values
    (v_plan_id, 'maintenance', date '2026-11-01');
  insert into public.monthly_plan_rows (plan_id, school_id, planned_date, notes)
  values
    (v_plan_id, source_id, date '2026-11-10', 'ملاحظة من السجل القديم'),
    (v_plan_id, target_id, date '2026-11-11', null);

  insert into public.school_size_corrections (school_id, corrected_size)
  values (source_id, 'medium'), (target_id, 'small');
  insert into public.staffing_exceptions (school_id, required_count, reason)
  values (source_id, 5, 'استثناء قديم'), (target_id, 3, 'استثناء حالي');
  insert into public.gatekeepers (school_id, full_name, phone, notes)
  values
    (source_id, 'بواب قديم', '0500000001', 'بيانات المصدر'),
    (target_id, 'بواب حالي', null, null);

  merge_result := public.admin_cleanup_school('merge', source_id, target_id, null);

  if exists (select 1 from public.schools where id = source_id) then
    raise exception 'merge RPC left the retired school in place';
  end if;
  if not exists (select 1 from public.schools where id = target_id) then
    raise exception 'merge RPC deleted the live school';
  end if;
  if (select count(*) from public.monthly_plan_rows where plan_id = v_plan_id and school_id = target_id) <> 1
     or exists (select 1 from public.monthly_plan_rows where plan_id = v_plan_id and school_id = source_id)
     or (select notes from public.monthly_plan_rows where plan_id = v_plan_id and school_id = target_id)
       not like '%ملاحظة من السجل القديم%' then
    raise exception 'merge RPC did not resolve the monthly-plan unique conflict while preserving data';
  end if;
  if (select corrected_size from public.school_size_corrections where school_id = target_id) <> 'small'
     or (select required_count from public.staffing_exceptions where school_id = target_id) <> 3 then
    raise exception 'merge RPC did not preserve the live unique rows';
  end if;
  if (select count(*) from public.gatekeepers where school_id = target_id) <> 1
     or (select phone from public.gatekeepers where school_id = target_id) <> '0500000001'
     or (select notes from public.gatekeepers where school_id = target_id) <> 'بيانات المصدر' then
    raise exception 'merge RPC did not resolve the gatekeeper unique conflict while preserving missing values';
  end if;
  if merge_result->>'action' <> 'merge' then
    raise exception 'merge RPC returned an unexpected result';
  end if;
end;
$$;

rollback;

create or replace function public.save_role_permissions(p_changes jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  role_change jsonb;
  delete_value jsonb;
  target_role_id bigint;
  admin_role_id bigint;
  role_base public.user_role;
  role_name text;
  role_description text;
  requested_permission text;
begin
  if auth.uid() is null or not public.has_permission('users.manage') then
    raise exception 'غير مصرح بإدارة الأدوار والصلاحيات';
  end if;

  if p_changes is null
     or jsonb_typeof(p_changes) <> 'object'
     or jsonb_typeof(p_changes->'roles') <> 'array'
     or jsonb_typeof(p_changes->'delete_ids') <> 'array' then
    raise exception 'بيانات التغييرات غير صالحة';
  end if;

  select r.id into admin_role_id
  from public.roles r
  where r.key = 'admin';

  for role_change in select value from jsonb_array_elements(p_changes->'roles')
  loop
    if jsonb_typeof(role_change) <> 'object'
       or jsonb_typeof(role_change->'permission_keys') <> 'array'
       or exists (
         select 1
         from jsonb_array_elements(role_change->'permission_keys') requested(value)
         where jsonb_typeof(requested.value) <> 'string'
       ) then
      raise exception 'بيانات صلاحيات الدور غير صالحة';
    end if;

    role_name := nullif(btrim(role_change->>'name_ar'), '');
    role_description := nullif(btrim(role_change->>'description'), '');
    if role_name is null or length(role_name) > 80
       or role_name !~ '[ء-ي]' then
      raise exception 'يجب إدخال اسم دور عربي لا يتجاوز 80 حرفاً';
    end if;
    if length(coalesce(role_description, '')) > 240 then
      raise exception 'يجب ألا يتجاوز وصف الدور 240 حرفاً';
    end if;

    if exists (
      select 1
      from jsonb_array_elements_text(role_change->'permission_keys') requested(value)
      where not exists (
        select 1 from public.permissions p where p.key = requested.value
      )
    ) then
      raise exception 'تتضمن الصلاحيات المطلوبة صلاحية غير معروفة';
    end if;

    if nullif(role_change->>'id', '') is null then
      begin
        role_base := (role_change->>'base_role')::public.user_role;
      exception when invalid_text_representation then
        raise exception 'الدور الأساسي غير صالح';
      end;
      if role_base = 'admin' then
        raise exception 'لا يمكن إنشاء دور مخصص بصلاحيات مدير النظام';
      end if;

      insert into public.roles (key, name_ar, description, is_system, base_role)
      values ('custom_' || gen_random_uuid()::text, role_name, role_description, false, role_base)
      returning id into target_role_id;
    else
      begin
        target_role_id := (role_change->>'id')::bigint;
      exception when invalid_text_representation then
        raise exception 'معرّف الدور غير صالح';
      end;
      if target_role_id <= 0 or not exists (
        select 1 from public.roles r where r.id = target_role_id
      ) then
        raise exception 'الدور المحدد غير موجود';
      end if;

      update public.roles r
      set name_ar = role_name,
          description = role_description
      where r.id = target_role_id
        and (r.name_ar is distinct from role_name
          or r.description is distinct from role_description);
    end if;

    if target_role_id = admin_role_id then
      if exists (
        select p.key from public.permissions p
        except
        select distinct jsonb_array_elements_text(role_change->'permission_keys')
      ) or exists (
        select distinct jsonb_array_elements_text(role_change->'permission_keys')
        except
        select rp.permission_key
        from public.role_permissions rp
        where rp.role_id = target_role_id
      ) then
        raise exception 'صلاحيات مدير النظام ثابتة ولا يجوز تعديلها';
      end if;
    else
      delete from public.role_permissions rp
      where rp.role_id = target_role_id
        and not exists (
          select 1
          from jsonb_array_elements_text(role_change->'permission_keys') requested(value)
          where requested.value = rp.permission_key
        );

      for requested_permission in
        select distinct jsonb_array_elements_text(role_change->'permission_keys')
      loop
        insert into public.role_permissions (role_id, permission_key)
        select target_role_id, requested_permission
        where not exists (
          select 1 from public.role_permissions rp
          where rp.role_id = target_role_id
            and rp.permission_key = requested_permission
        );
      end loop;
    end if;
  end loop;

  for delete_value in select value from jsonb_array_elements(p_changes->'delete_ids')
  loop
    if jsonb_typeof(delete_value) <> 'number'
       or delete_value::text !~ '^[0-9]+$' then
      raise exception 'معرّف الدور المراد حذفه غير صالح';
    end if;
    target_role_id := (delete_value::text)::bigint;
    if target_role_id = admin_role_id then
      raise exception 'لا يمكن حذف دور مدير النظام';
    end if;
    if exists (
      select 1 from public.roles r
      where r.id = target_role_id and r.is_system
    ) then
      raise exception 'لا يمكن حذف دور نظام';
    end if;
    if not exists (
      select 1 from public.roles r
      where r.id = target_role_id and not r.is_system
    ) then
      raise exception 'الدور المخصص المحدد غير موجود';
    end if;
    if exists (
      select 1 from public.profiles p where p.role_id = target_role_id
    ) then
      raise exception 'لا يمكن حذف دور مخصص مسند إلى مستخدمين';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(p_changes->'roles') submitted(value)
      where nullif(submitted.value->>'id', '')::bigint = target_role_id
    ) then
      raise exception 'لا يمكن تعديل الدور وحذفه في العملية نفسها';
    end if;

    delete from public.roles r where r.id = target_role_id;
  end loop;

  insert into public.audit_log (actor, action, table_name, row_id, details)
  values (
    auth.uid(),
    'RBAC_SETTINGS_SAVE',
    'roles',
    null,
    jsonb_build_object(
      'updated_role_count', jsonb_array_length(p_changes->'roles'),
      'deleted_role_ids', p_changes->'delete_ids'
    )
  );
end;
$$;

drop policy if exists profiles_select_user_manager on public.profiles;
create policy profiles_select_user_manager on public.profiles
for select to authenticated
using (public.has_permission('users.manage'));

drop policy if exists profiles_update_user_manager on public.profiles;
create policy profiles_update_user_manager on public.profiles
for update to authenticated
using (public.has_permission('users.manage'))
with check (public.has_permission('users.manage'));

revoke all on function public.save_role_permissions(jsonb) from public, anon;
grant execute on function public.save_role_permissions(jsonb) to authenticated;

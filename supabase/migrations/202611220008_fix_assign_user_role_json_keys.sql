create or replace function public.assign_user_role(
  p_user_id uuid,
  p_role_id bigint,
  p_phone text default null,
  p_overrides jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target record;
  target_role record;
  actor_admin boolean;
  target_permission text;
  override_change record;
  override_granted boolean;
  remaining_admins bigint;
  old_admin_id bigint;
  old_effective boolean;
  new_effective boolean;
begin
  if actor_id is null
     or not public.has_permission('users.manage')
     or not public.has_permission('users.assign_roles') then
    raise exception 'غير مصرح بإسناد دور للمستخدم';
  end if;

  select * into target
  from public.profiles p
  where p.id = p_user_id;
  if not found then
    raise exception 'المستخدم المحدد غير موجود';
  end if;

  select * into target_role
  from public.roles r
  where r.id = p_role_id;
  if not found then
    raise exception 'الدور المحدد غير موجود';
  end if;

  select exists (
    select 1
    from public.profiles p
    join public.roles r on r.id = p.role_id
    where p.id = actor_id and p.active and r.base_role = 'admin'
  ) into actor_admin;

  if p_user_id = actor_id and target.role_id is distinct from p_role_id then
    raise exception 'لا يجوز للمستخدم تغيير دوره لنفسه';
  end if;

  if target_role.base_role = 'admin' and not actor_admin then
    raise exception 'لا يجوز إسناد دور يتجاوز صلاحيات المانح';
  end if;

  if target_role.base_role <> 'admin' then
    for target_permission in
      select rp.permission_key
      from public.role_permissions rp
      where rp.role_id = p_role_id
    loop
      if not public.has_permission(target_permission) then
        raise exception 'لا يمكن إسناد دور يتجاوز صلاحيات المانح: %', target_permission;
      end if;
    end loop;
  end if;

  if p_overrides is null
     or jsonb_typeof(p_overrides) <> 'object'
     or exists (
       select 1
       from jsonb_object_keys(p_overrides) as override_key(permission_key)
       where not exists (
         select 1
         from public.permissions permission
         where permission.key = override_key.permission_key
       )
     ) then
    raise exception 'استثناءات الصلاحيات غير صالحة';
  end if;

  for target_permission in
    select override_key.permission_key
    from jsonb_object_keys(p_overrides) as override_key(permission_key)
  loop
    if jsonb_typeof(p_overrides->target_permission) <> 'string'
       or p_overrides->>target_permission not in ('allow', 'deny', 'default') then
      raise exception 'حالة الاستثناء الفردي غير صالحة';
    end if;
  end loop;

  if target_role.base_role = 'admin' then
    if exists (
      select 1
      from jsonb_object_keys(p_overrides) as override_key(permission_key)
      where p_overrides->>override_key.permission_key <> 'default'
    ) then
      raise exception 'لا يجوز إضافة استثناءات فردية لمدير النظام';
    end if;
  else
    for override_change in
      select key, value
      from jsonb_each_text(p_overrides)
    loop
      if override_change.value = 'allow' then
        override_granted := true;
      elsif override_change.value = 'deny' then
        override_granted := false;
      else
        override_granted := null;
      end if;

      if p_user_id = actor_id then
        select coalesce((
          select o.granted
          from public.user_permission_overrides o
          where o.user_id = p_user_id
            and o.permission_key = override_change.key
        ), exists (
          select 1
          from public.role_permissions rp
          where rp.role_id = target.role_id
            and rp.permission_key = override_change.key
        )) into old_effective;

        if override_granted is not null then
          new_effective := override_granted;
        else
          select exists (
            select 1
            from public.role_permissions rp
            where rp.role_id = p_role_id
              and rp.permission_key = override_change.key
          ) into new_effective;
        end if;
        if new_effective and not old_effective then
          raise exception 'لا يجوز للمستخدم رفع صلاحياته لنفسه';
        end if;
      end if;

      if override_granted is true
         and not public.has_permission(override_change.key) then
        raise exception 'لا يمكن منح استثناء يتجاوز صلاحيات المانح: %', override_change.key;
      end if;

      if override_granted is null then
        delete from public.user_permission_overrides o
        where o.user_id = p_user_id
          and o.permission_key = override_change.key;
      else
        insert into public.user_permission_overrides (user_id, permission_key, granted)
        values (p_user_id, override_change.key, override_granted)
        on conflict (user_id, permission_key) do update
        set granted = excluded.granted,
            set_by = actor_id,
            set_at = now();
      end if;
    end loop;
  end if;

  select r.id into old_admin_id
  from public.roles r
  where r.key = 'admin';

  if target.role_id = old_admin_id
     and p_role_id is distinct from old_admin_id
     and target.active then
    select count(*) into remaining_admins
    from public.profiles p
    where p.active and p.role_id = old_admin_id and p.id <> p_user_id;
    if remaining_admins = 0 then
      raise exception 'لا يمكن إزالة آخر مدير نظام نشط';
    end if;
  end if;

  update public.profiles
  set role_id = p_role_id,
      phone = nullif(btrim(p_phone), '')
  where id = p_user_id;

  insert into public.audit_log (actor, action, table_name, row_id, details)
  values (
    actor_id,
    'RBAC_USER_ASSIGN',
    'profiles',
    p_user_id::text,
    jsonb_build_object('role_id', p_role_id, 'phone_updated', p_phone is not null, 'overrides', p_overrides)
  );
end;
$$;

notify pgrst, 'reload schema';

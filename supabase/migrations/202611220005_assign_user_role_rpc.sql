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
       from jsonb_object_keys(p_overrides) key
       where not exists (
         select 1 from public.permissions permission where permission.key = key
       )
     ) then
    raise exception 'استثناءات الصلاحيات غير صالحة';
  end if;

  for target_permission in
    select key from jsonb_object_keys(p_overrides)
  loop
    if jsonb_typeof(p_overrides->target_permission) not in ('string')
       or p_overrides->>target_permission not in ('allow', 'deny', 'default') then
      raise exception 'حالة الاستثناء الفردي غير صالحة';
    end if;
  end loop;

  if target_role.base_role = 'admin' then
    -- Administrator roles have fixed permissions and cannot receive individual exceptions.
    if exists (
      select 1
      from jsonb_object_keys(p_overrides) key
      where p_overrides->>key <> 'default'
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

revoke all on function public.assign_user_role(uuid, bigint, text, jsonb) from public, anon;
grant execute on function public.assign_user_role(uuid, bigint, text, jsonb) to authenticated;

create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_admin_id bigint;
  new_admin_id bigint;
  target_permission text;
  remaining_admins bigint;
begin
  if new.username <> old.username then
    raise exception 'اسم المستخدم غير قابل للتغيير';
  end if;

  if new.role_id is distinct from old.role_id then
    select r.base_role into new.role
    from public.roles r where r.id = new.role_id;
  elsif new.role is distinct from old.role then
    select r.id into new.role_id
    from public.roles r
    where r.is_system and r.base_role = new.role
    limit 1;
  end if;

  if auth.uid() is not null and new.role_id is distinct from old.role_id and auth.uid() = new.id then
    raise exception 'لا يجوز للمستخدم تغيير دوره لنفسه';
  end if;

  if auth.uid() is not null
     and (new.role_id is distinct from old.role_id or new.role is distinct from old.role)
     and not public.has_permission('users.assign_roles') then
    raise exception 'غير مصرح بتغيير الدور';
  end if;

  select id into old_admin_id from public.roles where key = 'admin';
  select id into new_admin_id from public.roles where key = 'admin';

  if old.role_id = old_admin_id and new.role_id is distinct from new_admin_id then
    select count(*) into remaining_admins
    from public.profiles p
    where p.active and p.role_id = old_admin_id and p.id <> new.id;
    if remaining_admins = 0 then
      raise exception 'لا يمكن إزالة آخر مدير نظام نشط';
    end if;
  end if;

  if auth.uid() is not null and new.role_id is distinct from old.role_id
     and not exists (select 1 from public.roles r where r.id = new.role_id and r.base_role = 'admin') then
    for target_permission in
      select rp.permission_key
      from public.role_permissions rp
      where rp.role_id = new.role_id
    loop
      if not public.has_permission(target_permission) then
        raise exception 'لا يمكن إسناد دور يتضمن صلاحية غير مخولة للمانح: %', target_permission;
      end if;
    end loop;
  end if;

  if auth.uid() is not null and new.role_id is distinct from old.role_id
     and exists (select 1 from public.roles r where r.id = new.role_id and r.base_role = 'admin')
     and not exists (
       select 1
       from public.profiles p
       join public.roles r on r.id = p.role_id
       where p.id = auth.uid() and p.active and r.base_role = 'admin'
     ) then
    raise exception 'لا يجوز إسناد دور يتجاوز صلاحيات المانح';
  end if;

  if new.active <> old.active
     or new.employee_id is distinct from old.employee_id then
    if auth.uid() is not null and not public.has_permission('users.manage') then
      raise exception 'غير مصرح بتغيير الحالة أو الربط الوظيفي';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.guard_permission_override_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_profile_admin boolean;
  old_effective boolean;
  new_effective boolean;
begin
  if auth.uid() is not null and not public.has_permission('users.manage') then
    raise exception 'غير مصرح بتعديل استثناءات الصلاحيات';
  end if;

  select exists (
    select 1
    from public.profiles p
    join public.roles r on r.id = p.role_id
    where p.id = coalesce(new.user_id, old.user_id)
      and r.base_role = 'admin'
  ) into target_profile_admin;
  if target_profile_admin then
    raise exception 'لا يجوز تعديل استثناءات مدير النظام';
  end if;

  if tg_op in ('INSERT', 'UPDATE') and new.granted
     and auth.uid() is not null
     and not public.has_permission(new.permission_key)
     and not exists (
       select 1 from public.profiles p
       join public.roles r on r.id = p.role_id
       where p.id = auth.uid() and r.base_role = 'admin'
     ) then
    raise exception 'لا يمكن منح استثناء يتجاوز صلاحيات المانح: %', new.permission_key;
  end if;

  if auth.uid() is not null and coalesce(new.user_id, old.user_id) = auth.uid() then
    select coalesce((
      select o.granted
      from public.user_permission_overrides o
      where o.user_id = auth.uid()
        and o.permission_key = coalesce(new.permission_key, old.permission_key)
    ), exists (
      select 1
      from public.profiles p
      join public.role_permissions rp on rp.role_id = p.role_id
      where p.id = auth.uid()
        and rp.permission_key = coalesce(new.permission_key, old.permission_key)
    )) into old_effective;
    new_effective := case
      when tg_op = 'DELETE' then exists (
        select 1
        from public.profiles p
        join public.role_permissions rp on rp.role_id = p.role_id
        where p.id = auth.uid()
          and rp.permission_key = old.permission_key
      )
      else new.granted
    end;
    if new_effective and not old_effective then
      raise exception 'لا يجوز للمستخدم رفع صلاحياته لنفسه';
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    new.set_by := auth.uid();
    new.set_at := now();
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

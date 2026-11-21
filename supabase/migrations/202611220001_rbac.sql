create table public.roles (
  id bigint generated always as identity primary key,
  key text not null unique,
  name_ar text not null,
  description text,
  is_system boolean not null default false,
  base_role public.user_role not null,
  created_at timestamptz not null default now()
);

create table public.permissions (
  key text primary key,
  group_key text not null,
  label_ar text not null,
  description text,
  enforced_in_db boolean not null default false
);

create table public.role_permissions (
  role_id bigint not null references public.roles(id) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  primary key (role_id, permission_key)
);

create table public.user_permission_overrides (
  user_id uuid not null references auth.users(id) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  granted boolean not null,
  set_by uuid references auth.users(id),
  set_at timestamptz not null default now(),
  primary key (user_id, permission_key)
);

insert into public.roles (key, name_ar, description, is_system, base_role) values
  ('admin', 'مدير النظام', 'دور نظام كامل الصلاحيات', true, 'admin'),
  ('project_manager', 'مدير المشروع', 'إدارة العمليات والمشاريع', true, 'project_manager'),
  ('area_engineer', 'مهندس منطقة', 'تنفيذ ومتابعة خطط المنطقة', true, 'area_engineer'),
  ('report_follower', 'متابع التقارير', 'متابعة تسجيل الزيارات والتقارير', true, 'report_follower'),
  ('supervisor', 'مشرف', 'دور نظام للمشرفين', true, 'supervisor'),
  ('viewer', 'مستعرض', 'دور نظام للقراءة العامة', true, 'viewer');

insert into public.permissions (key, group_key, label_ar, description, enforced_in_db) values
  ('dashboard.view','dashboard','عرض لوحة التحكم','عرض لوحة التحكم',false),
  ('schools.view','schools','عرض المدارس','عرض بيانات المدارس',false),
  ('schools.edit','schools','تعديل المدارس','تعديل بيانات المدارس',false),
  ('schools.sync','schools','مزامنة المدارس','مزامنة بيانات المدارس',false),
  ('schools.cleanup','schools','تنظيف المدارس','تنظيف سجلات المدارس',false),
  ('schools.correct_size','schools','تصحيح أحجام المدارس','تصحيح حجم المدرسة',false),
  ('schools.export_csv','schools','تصدير المدارس','تصدير المدارس بصيغة CSV',false),
  ('plans.view','plans','عرض الخطط','عرض الخطط',false),
  ('plans.create_delete','plans','إنشاء وحذف الخطط','إنشاء وحذف الخطط',false),
  ('plans.edit_rows','plans','تعديل صفوف الخطط','تعديل صفوف الخطط',false),
  ('plans.undo_row_edits','plans','التراجع عن تعديلات الصفوف','التراجع عن تعديلات صفوف الخطط',false),
  ('plans.record_visit_report','plans','تسجيل الزيارة والتقرير','تسجيل الزيارة والتقرير',false),
  ('plans.bulk_update_general','plans','التحديث الجماعي للخطط العامة','تحديث صفوف الخطط العامة جماعيًا',false),
  ('plans.import','plans','استيراد الخطط','استيراد بيانات الخطط',false),
  ('plans.redistribute_remaining','plans','إعادة توزيع المتبقي','إعادة توزيع المتبقي في الخطط',false),
  ('plans.manage_types','plans','إدارة أنواع الخطط','إدارة أنواع الخطط',false),
  ('workforce.view','workforce','عرض القوى العاملة','عرض بيانات القوى العاملة',false),
  ('workforce.assign_cleaners','workforce','إسناد العاملين','إسناد العمال المنظفين',false),
  ('placement.cleaners.view','placement','عرض إسناد المنظفين','عرض إسناد المنظفين',false),
  ('placement.gatekeepers.view','placement','عرض إسناد بوابات الأمن','عرض إسناد بوابات الأمن',false),
  ('gatekeepers.manage','gatekeepers','إدارة بوابات الأمن','إدارة البوابات الأمنية',false),
  ('gatekeepers.backfill','gatekeepers','معالجة حركة البوابات','معالجة بيانات البوابات',false),
  ('gatekeepers.export_residence','gatekeepers','تصدير بيانات السكن','تصدير بيانات السكن',false),
  ('residence.reveal','residence','كشف أرقام السكن','كشف أرقام السكن الحساسة',false),
  ('staffing.rules.view','staffing','عرض قواعد التعاقد','عرض قواعد التعاقد',false),
  ('staffing.rules.edit','staffing','تعديل قواعد التعاقد','تعديل قواعد التعاقد',false),
  ('staffing.exceptions.manage','staffing','إدارة استثناءات التعاقد','إدارة استثناءات التعاقد',false),
  ('attendance.view','attendance','عرض التحضير','عرض سجلات التحضير',false),
  ('attendance.manage','attendance','إدارة التحضير','إدارة سجلات التحضير',false),
  ('attendance.import','attendance','استيراد التحضير','استيراد سجلات التحضير',false),
  ('attendance.export','attendance','تصدير التحضير','تصدير سجلات التحضير',false),
  ('kpi.view','kpi','عرض مؤشرات الأداء','عرض مؤشرات الأداء',false),
  ('kpi.edit','kpi','تعديل مؤشرات الأداء','تعديل مؤشرات الأداء',false),
  ('kpi.approve','kpi','اعتماد مؤشرات الأداء','اعتماد مؤشرات الأداء',false),
  ('deliverables.view','deliverables','عرض المخرجات','عرض المخرجات',false),
  ('deliverables.edit','deliverables','تعديل المخرجات','تعديل المخرجات',false),
  ('rewards.view','rewards','عرض المكافآت','عرض المكافآت',false),
  ('rewards.distribute','rewards','توزيع المكافآت','توزيع المكافآت',false),
  ('reports.tools','reports','عرض أدوات التقارير','عرض أدوات التقارير',false),
  ('tools.ticket_analysis','tools','تحليل التذاكر','استخدام تحليل التذاكر',false),
  ('settings.view','settings','عرض الإعدادات','عرض الإعدادات',false),
  ('users.manage','users','إدارة المستخدمين','إدارة المستخدمين',false),
  ('users.create','users','إنشاء المستخدمين','إنشاء مستخدمين',false),
  ('users.assign_roles','users','إسناد الأدوار','إسناد أدوار للمستخدمين',false),
  ('audit.view','audit','عرض سجل التدقيق','عرض سجل التدقيق',false);

alter table public.profiles
  add column role_id bigint references public.roles(id);

update public.profiles p
set role_id = r.id
from public.roles r
where r.base_role = p.role;

alter table public.profiles alter column role_id set not null;
alter table public.user_permission_overrides
  alter column set_by set default auth.uid();

create or replace function public.sync_profile_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  resulting_role_id bigint;
begin
  if tg_op = 'INSERT' then
    if new.role_id is null then
      select r.id into new.role_id
      from public.roles r
      where r.is_system and r.base_role = new.role;
      if new.role_id is null then
        raise exception 'لا يوجد دور نظام مطابق للدور %', new.role;
      end if;
    else
      select r.base_role into new.role
      from public.roles r
      where r.id = new.role_id;
      if not found then
        raise exception 'الدور المحدد غير موجود';
      end if;
    end if;
    return new;
  end if;

  resulting_role_id := new.role_id;
  if resulting_role_id is distinct from old.role_id then
    select r.base_role into new.role
    from public.roles r
    where r.id = resulting_role_id;
  elsif new.role is distinct from old.role then
    select r.id into resulting_role_id
    from public.roles r
    where r.base_role = new.role
      and r.is_system
    limit 1;
    new.role_id := resulting_role_id;
  end if;
  return new;
end;
$$;

create trigger profiles_sync_role
before insert or update of role_id, role on public.profiles
for each row execute function public.sync_profile_role();

create or replace function public.has_permission(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    case
      when auth.uid() is null then false
      when exists (
        select 1
        from public.profiles p
        join public.roles r on r.id = p.role_id
        where p.id = auth.uid() and p.active and r.base_role = 'admin'
      ) then true
      else coalesce((
        select o.granted
        from public.user_permission_overrides o
        where o.user_id = auth.uid() and o.permission_key = p_key
      ), (
        select exists (
          select 1
          from public.profiles p
          join public.role_permissions rp on rp.role_id = p.role_id
          where p.id = auth.uid() and p.active and rp.permission_key = p_key
        )
      ), false)
    end
$$;

revoke all on function public.has_permission(text) from public, anon;
grant execute on function public.has_permission(text) to authenticated;

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.key = 'admin';

-- ALL
insert into public.role_permissions
select r.id, p.key
from public.roles r join public.permissions p on p.key in (
  'dashboard.view','schools.view','schools.export_csv','plans.view','workforce.view',
  'placement.cleaners.view','placement.gatekeepers.view','kpi.view','deliverables.view','rewards.view'
)
where r.key in ('project_manager','area_engineer','report_follower','supervisor','viewer');

insert into public.role_permissions
select r.id, p.key
from public.roles r join public.permissions p on p.key in (
  'schools.edit','schools.correct_size','plans.create_delete','plans.edit_rows','plans.record_visit_report',
  'plans.bulk_update_general','plans.import','plans.redistribute_remaining','plans.manage_types',
  'workforce.assign_cleaners','gatekeepers.manage','gatekeepers.backfill','gatekeepers.export_residence','residence.reveal',
  'staffing.rules.view','staffing.exceptions.manage','attendance.view','attendance.manage','attendance.import','attendance.export',
  'kpi.edit','kpi.approve','deliverables.edit','reports.tools','tools.ticket_analysis','settings.view'
)
where r.key = 'project_manager';

insert into public.role_permissions
select r.id, p.key
from public.roles r join public.permissions p on p.key in (
  'plans.create_delete','plans.record_visit_report','plans.bulk_update_general','plans.import',
  'workforce.assign_cleaners','gatekeepers.manage','residence.reveal','rewards.distribute','reports.tools'
)
where r.key = 'area_engineer';

insert into public.role_permissions
select r.id, p.key
from public.roles r join public.permissions p on p.key in (
  'plans.record_visit_report','reports.tools'
)
where r.key = 'report_follower';

-- Admin-only and role-specific matrix entries are represented explicitly for exact behavior.
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_permission_overrides enable row level security;

grant select on public.roles, public.permissions, public.role_permissions, public.user_permission_overrides to authenticated;
grant insert, update, delete on public.roles, public.role_permissions, public.user_permission_overrides to authenticated;
grant insert, update, delete on public.permissions to authenticated;

create policy rbac_roles_read on public.roles for select to authenticated using (true);
create policy rbac_permissions_read on public.permissions for select to authenticated using (true);
create policy rbac_role_permissions_read on public.role_permissions for select to authenticated using (true);
create policy rbac_overrides_read on public.user_permission_overrides for select to authenticated using (true);

create policy rbac_roles_write on public.roles for all to authenticated
using (public.has_permission('users.manage')) with check (public.has_permission('users.manage'));
create policy rbac_permissions_write on public.permissions for all to authenticated
using (public.has_permission('users.manage')) with check (public.has_permission('users.manage'));
create policy rbac_role_permissions_write on public.role_permissions for all to authenticated
using (public.has_permission('users.manage')) with check (public.has_permission('users.manage'));
create policy rbac_overrides_write on public.user_permission_overrides for all to authenticated
using (public.has_permission('users.manage')) with check (public.has_permission('users.manage'));

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

  if auth.uid() is not null
     and new.role_id is distinct from old.role_id
     and not exists (select 1 from public.roles r where r.id = new.role_id and r.base_role = 'admin')
     and not public.has_permission('users.assign_roles') then
    raise exception 'غير مصرح بتغيير الدور';
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

  if new.active <> old.active
     or new.employee_id is distinct from old.employee_id then
    if auth.uid() is not null and not public.has_permission('users.manage') then
      raise exception 'غير مصرح بتغيير الحالة أو الربط الوظيفي';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
for each row execute function public.guard_profile_update();

create or replace function public.guard_role_permission_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_role_id bigint;
  target_permission text;
  admin_role_id bigint;
begin
  target_role_id := coalesce(new.role_id, old.role_id);
  target_permission := coalesce(new.permission_key, old.permission_key);
  select r.id into admin_role_id from public.roles r where r.key = 'admin';

  if tg_op = 'UPDATE' and old.role_id = admin_role_id then
    raise exception 'صلاحيات دور مدير النظام ثابتة ولا يجوز تعديلها';
  end if;

  if target_role_id = admin_role_id then
    raise exception 'صلاحيات دور مدير النظام ثابتة ولا يجوز تعديلها';
  end if;

  if tg_op = 'INSERT' or tg_op = 'UPDATE' then
    if auth.uid() is not null
       and not public.has_permission(target_permission)
       and not exists (
         select 1 from public.roles r
         where r.id = (select p.role_id from public.profiles p where p.id = auth.uid())
           and r.base_role = 'admin'
       ) then
      raise exception 'لا يمكن منح صلاحية غير مخولة للمانح: %', target_permission;
    end if;
  end if;

  if auth.uid() is not null and not public.has_permission('users.manage') then
    raise exception 'غير مصرح بتغيير صلاحيات الأدوار';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists role_permissions_guard on public.role_permissions;
create trigger role_permissions_guard
before insert or update or delete on public.role_permissions
for each row execute function public.guard_role_permission_change();

create or replace function public.guard_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and coalesce(old.is_system, false) then
    raise exception 'لا يمكن حذف دور نظام';
  end if;
  if tg_op in ('UPDATE', 'DELETE') and coalesce(old.is_system, false)
     and (
       tg_op = 'DELETE'
       or new.key is distinct from old.key
       or new.base_role is distinct from old.base_role
       or new.is_system is distinct from old.is_system
     ) then
    raise exception 'لا يمكن تعديل هوية أو دور نظام';
  end if;
  if tg_op = 'INSERT' and auth.uid() is not null
     and not public.has_permission('users.manage') then
    raise exception 'غير مصرح بتعديل الأدوار';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists roles_guard on public.roles;
create trigger roles_guard
before insert or update or delete on public.roles
for each row execute function public.guard_role_change();

create or replace function public.guard_permission_override_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_profile_admin boolean;
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

drop trigger if exists override_guard on public.user_permission_overrides;
create trigger override_guard
before insert or update or delete on public.user_permission_overrides
for each row execute function public.guard_permission_override_change();

create or replace function public.audit_rbac_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_data jsonb;
  row_key text;
begin
  if tg_op = 'DELETE' then
    row_data := to_jsonb(old);
  else
    row_data := to_jsonb(new);
  end if;

  if tg_table_name = 'roles' then
    row_key := row_data->>'id';
  elsif tg_table_name = 'role_permissions' then
    row_key := (row_data->>'role_id') || ':' || (row_data->>'permission_key');
  elsif tg_table_name = 'user_permission_overrides' then
    row_key := (row_data->>'user_id') || ':' || (row_data->>'permission_key');
  elsif tg_table_name = 'permissions' then
    row_key := row_data->>'key';
  else
    row_key := row_data->>'id';
  end if;

  insert into public.audit_log (actor, action, table_name, row_id, details)
  values (
    auth.uid(),
    'RBAC_' || tg_op,
    tg_table_name,
    row_key,
    case
      when tg_op = 'INSERT' then jsonb_build_object('new', row_data)
      when tg_op = 'DELETE' then jsonb_build_object('old', row_data)
      else jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new))
    end
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists audit_roles on public.roles;
create trigger audit_roles
after insert or update or delete on public.roles
for each row execute function public.audit_rbac_change();

drop trigger if exists audit_permissions on public.permissions;
create trigger audit_permissions
after insert or update or delete on public.permissions
for each row execute function public.audit_rbac_change();

drop trigger if exists audit_role_permissions on public.role_permissions;
create trigger audit_role_permissions
after insert or update or delete on public.role_permissions
for each row execute function public.audit_rbac_change();

drop trigger if exists audit_user_permission_overrides on public.user_permission_overrides;
create trigger audit_user_permission_overrides
after insert or update or delete on public.user_permission_overrides
for each row execute function public.audit_rbac_change();

create or replace function public.audit_profile_role_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (actor, action, table_name, row_id, details)
    values (
      auth.uid(),
      'PROFILE_ROLE_ASSIGN',
      'profiles',
      new.id::text,
      jsonb_build_object('new_role_id', new.role_id, 'new_role', new.role)
    );
  elsif new.role_id is distinct from old.role_id or new.role is distinct from old.role then
    insert into public.audit_log (actor, action, table_name, row_id, details)
    values (
      auth.uid(),
      'PROFILE_ROLE_ASSIGN',
      'profiles',
      new.id::text,
      jsonb_build_object(
        'old_role_id', old.role_id,
        'new_role_id', new.role_id,
        'old_role', old.role,
        'new_role', new.role
      )
    );
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists audit_profile_role_assignment on public.profiles;
create trigger audit_profile_role_assignment
after insert or update on public.profiles
for each row execute function public.audit_profile_role_assignment();
*** End Patch

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

drop trigger if exists profiles_sync_role on public.profiles;
create trigger profiles_sync_role
before insert or update of role_id, role on public.profiles
for each row execute function public.sync_profile_role();

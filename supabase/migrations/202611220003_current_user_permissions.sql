create or replace function public.current_user_permissions()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select perm.key
  from public.permissions perm
  where exists (
    select 1
    from public.profiles profile
    join public.roles r on r.id = profile.role_id
    where profile.id = auth.uid()
      and profile.active
      and r.base_role = 'admin'
  )
  or (
    exists (
      select 1
      from public.profiles profile
      where profile.id = auth.uid() and profile.active
    )
    and coalesce(
      (
        select override.granted
        from public.user_permission_overrides override
        where override.user_id = auth.uid()
          and override.permission_key = perm.key
      ),
      exists (
        select 1
        from public.profiles profile
        join public.role_permissions role_permission on role_permission.role_id = profile.role_id
        where profile.id = auth.uid()
          and profile.active
          and role_permission.permission_key = perm.key
      )
    )
  )
  order by perm.key;
$$;

revoke all on function public.current_user_permissions() from public, anon;
grant execute on function public.current_user_permissions() to authenticated;

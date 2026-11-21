delete from public.role_permissions rp
using public.roles r
where rp.role_id = r.id
  and r.key = 'project_manager'
  and rp.permission_key = 'rewards.distribute';

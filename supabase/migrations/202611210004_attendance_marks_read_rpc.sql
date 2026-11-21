create or replace function public.get_attendance_marks(p_month date)
returns table (roster_id uuid, day date)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.has_role('admin', 'project_manager') then
    raise exception 'غير مصرح بقراءة سجلات التحضير';
  end if;
  if p_month is null or p_month <> date_trunc('month', p_month)::date then
    raise exception 'يجب تحديد أول يوم من الشهر';
  end if;

  return query
  select m.roster_id, m.day
  from public.attendance_marks as m
  where m.day >= p_month
    and m.day < (p_month + interval '1 month')::date
  order by m.day, m.roster_id;
end;
$$;

revoke all on function public.get_attendance_marks(date) from public, anon, authenticated;
grant execute on function public.get_attendance_marks(date) to authenticated;

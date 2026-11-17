alter table public.monthly_plan_rows
  add column if not exists original_planned_date date,
  add column if not exists original_school_id uuid,
  add column if not exists original_supervisor_id uuid,
  add column if not exists edited_at timestamptz,
  add column if not exists edited_by uuid;

alter table public.monthly_plan_rows
  alter column school_id drop not null;

create or replace function public.require_monthly_plan_row_school()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.monthly_plan_rows
    where id = new.id and school_id is null
  ) then
    raise exception 'المدرسة مطلوبة في صف الخطة الشهرية';
  end if;
  return null;
end;
$$;

drop trigger if exists monthly_plan_rows_school_required on public.monthly_plan_rows;
create constraint trigger monthly_plan_rows_school_required
after insert or update on public.monthly_plan_rows
deferrable initially deferred
for each row execute function public.require_monthly_plan_row_school();

alter table public.general_plan_rows
  add column if not exists supervisor_id uuid references public.employees(id) on delete set null,
  add column if not exists original_planned_date date,
  add column if not exists original_school_id uuid,
  add column if not exists original_supervisor_id uuid,
  add column if not exists edited_at timestamptz,
  add column if not exists edited_by uuid;

alter table public.custom_plan_rows
  add column if not exists original_planned_date date,
  add column if not exists original_school_id uuid,
  add column if not exists original_supervisor_id uuid,
  add column if not exists edited_at timestamptz,
  add column if not exists edited_by uuid;

create or replace function public.edit_plan_row(
  p_plan_kind text,
  p_row_id uuid,
  p_changes jsonb,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row_data record;
  next_school_id uuid;
  next_supervisor_id uuid;
  next_planned_date date;
  changes_log jsonb := '{}'::jsonb;
  swap_changes_log jsonb;
  target_table text;
  swap_row_id uuid;
  swap_data record;
begin
  if not public.has_role('admin', 'project_manager') then
    raise exception 'غير مصرح بتعديل صفوف الخطط';
  end if;
  if p_plan_kind is null or p_plan_kind not in ('monthly', 'general', 'custom') then
    raise exception 'نوع الخطة غير مدعوم';
  end if;
  if p_row_id is null or p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'يجب تحديد صف وحقول التعديل';
  end if;
  if p_changes = '{}'::jsonb then
    raise exception 'يجب تحديد حقل واحد على الأقل';
  end if;
  if (p_changes - array['school_id', 'supervisor_id', 'planned_date', 'swap_row_id']) <> '{}'::jsonb then
    raise exception 'حقول التعديل المسموح بها هي المدرسة والمشرف والموعد فقط';
  end if;
  if p_changes ? 'swap_row_id' then
    if p_plan_kind <> 'monthly'
      or (p_changes - 'swap_row_id') <> '{}'::jsonb
      or jsonb_typeof(p_changes->'swap_row_id') <> 'string' then
      raise exception 'تبديل المدارس متاح لصفوف الخطة الشهرية فقط';
    end if;
    swap_row_id := (p_changes->>'swap_row_id')::uuid;
    if swap_row_id = p_row_id then
      raise exception 'لا يمكن تبديل الصف مع نفسه';
    end if;
  end if;
  if (p_changes ? 'school_id' and jsonb_typeof(p_changes->'school_id') not in ('string', 'null'))
    or (p_changes ? 'supervisor_id' and jsonb_typeof(p_changes->'supervisor_id') not in ('string', 'null'))
    or (p_changes ? 'planned_date' and jsonb_typeof(p_changes->'planned_date') not in ('string', 'null')) then
    raise exception 'صيغة حقول التعديل غير صالحة';
  end if;

  if p_plan_kind = 'monthly' then
    select r.* into row_data
    from public.monthly_plan_rows r
    where r.id = p_row_id
    for update;
    target_table := 'monthly_plan_rows';
  elsif p_plan_kind = 'general' then
    select r.* into row_data
    from public.general_plan_rows r
    where r.id = p_row_id
    for update;
    target_table := 'general_plan_rows';
  else
    select r.* into row_data
    from public.custom_plan_rows r
    where r.id = p_row_id
    for update;
    target_table := 'custom_plan_rows';
  end if;
  if not found then
    raise exception 'صف الخطة غير موجود';
  end if;

  if swap_row_id is not null then
    select r.* into swap_data
    from public.monthly_plan_rows r
    where r.id = swap_row_id and r.plan_id = row_data.plan_id
    for update;
    if not found then
      raise exception 'صف التبديل غير موجود ضمن الخطة نفسها';
    end if;

    changes_log := jsonb_build_object(
      'school_id', jsonb_build_object('old', row_data.school_id, 'new', swap_data.school_id),
      'supervisor_id', jsonb_build_object('old', row_data.supervisor_id, 'new', swap_data.supervisor_id),
      'planned_date', jsonb_build_object('old', row_data.planned_date, 'new', swap_data.planned_date)
    );
    swap_changes_log := jsonb_build_object(
      'school_id', jsonb_build_object('old', swap_data.school_id, 'new', row_data.school_id),
      'supervisor_id', jsonb_build_object('old', swap_data.supervisor_id, 'new', row_data.supervisor_id),
      'planned_date', jsonb_build_object('old', swap_data.planned_date, 'new', row_data.planned_date)
    );

    update public.monthly_plan_rows
    set original_school_id = case when edited_at is null then school_id else original_school_id end,
        original_supervisor_id = case when edited_at is null then supervisor_id else original_supervisor_id end,
        original_planned_date = case when edited_at is null then planned_date else original_planned_date end,
        edited_at = now(),
        edited_by = auth.uid(),
        school_id = null
    where id = p_row_id;

    update public.monthly_plan_rows
    set school_id = swap_data.school_id,
        supervisor_id = swap_data.supervisor_id,
        planned_date = swap_data.planned_date,
        original_school_id = case when edited_at is null then school_id else original_school_id end,
        original_supervisor_id = case when edited_at is null then supervisor_id else original_supervisor_id end,
        original_planned_date = case when edited_at is null then planned_date else original_planned_date end,
        edited_at = now(),
        edited_by = auth.uid()
    where id = p_row_id;

    update public.monthly_plan_rows
    set school_id = row_data.school_id,
        supervisor_id = row_data.supervisor_id,
        planned_date = row_data.planned_date,
        original_school_id = case when edited_at is null then school_id else original_school_id end,
        original_supervisor_id = case when edited_at is null then supervisor_id else original_supervisor_id end,
        original_planned_date = case when edited_at is null then planned_date else original_planned_date end,
        edited_at = now(),
        edited_by = auth.uid()
    where id = swap_row_id;

    insert into public.audit_log(actor, action, table_name, row_id, details)
    values
      (auth.uid(), 'edit_plan_row', target_table, p_row_id::text,
       jsonb_build_object('editor', auth.uid(), 'changes', changes_log,
         'reason', nullif(btrim(p_reason), ''), 'swap_row_id', swap_row_id)),
      (auth.uid(), 'edit_plan_row', target_table, swap_row_id::text,
       jsonb_build_object('editor', auth.uid(), 'changes', swap_changes_log,
         'reason', nullif(btrim(p_reason), ''), 'swap_row_id', p_row_id));

    return jsonb_build_object(
      'row_id', p_row_id,
      'swap_row_id', swap_row_id,
      'table_name', target_table,
      'changes', changes_log
    );
  end if;

  next_school_id := case when p_changes ? 'school_id'
    then (p_changes->>'school_id')::uuid else row_data.school_id end;
  next_supervisor_id := case when p_changes ? 'supervisor_id'
    then (p_changes->>'supervisor_id')::uuid else row_data.supervisor_id end;
  next_planned_date := case when p_changes ? 'planned_date'
    then (p_changes->>'planned_date')::date else row_data.planned_date end;

  if p_plan_kind = 'monthly' and (next_school_id is null or next_planned_date is null) then
    raise exception 'المدرسة والموعد مطلوبان للصف الشهري';
  end if;
  if row_data.school_id is distinct from next_school_id then
    changes_log := changes_log || jsonb_build_object(
      'school_id', jsonb_build_object('old', row_data.school_id, 'new', next_school_id)
    );
  end if;
  if row_data.supervisor_id is distinct from next_supervisor_id then
    changes_log := changes_log || jsonb_build_object(
      'supervisor_id', jsonb_build_object('old', row_data.supervisor_id, 'new', next_supervisor_id)
    );
  end if;
  if row_data.planned_date is distinct from next_planned_date then
    changes_log := changes_log || jsonb_build_object(
      'planned_date', jsonb_build_object('old', row_data.planned_date, 'new', next_planned_date)
    );
  end if;
  if changes_log = '{}'::jsonb then
    raise exception 'لم تتغير أي قيمة';
  end if;

  if p_plan_kind = 'monthly' then
    update public.monthly_plan_rows
    set school_id = next_school_id,
        supervisor_id = next_supervisor_id,
        planned_date = next_planned_date,
        original_school_id = case when edited_at is null then school_id else original_school_id end,
        original_supervisor_id = case when edited_at is null then supervisor_id else original_supervisor_id end,
        original_planned_date = case when edited_at is null then planned_date else original_planned_date end,
        edited_at = now(),
        edited_by = auth.uid()
    where id = p_row_id;
  elsif p_plan_kind = 'general' then
    update public.general_plan_rows
    set school_id = next_school_id,
        supervisor_id = next_supervisor_id,
        planned_date = next_planned_date,
        original_school_id = case when edited_at is null then school_id else original_school_id end,
        original_supervisor_id = case when edited_at is null then supervisor_id else original_supervisor_id end,
        original_planned_date = case when edited_at is null then planned_date else original_planned_date end,
        edited_at = now(),
        edited_by = auth.uid()
    where id = p_row_id;
  else
    update public.custom_plan_rows
    set school_id = next_school_id,
        supervisor_id = next_supervisor_id,
        planned_date = next_planned_date,
        original_school_id = case when edited_at is null then school_id else original_school_id end,
        original_supervisor_id = case when edited_at is null then supervisor_id else original_supervisor_id end,
        original_planned_date = case when edited_at is null then planned_date else original_planned_date end,
        edited_at = now(),
        edited_by = auth.uid()
    where id = p_row_id;
  end if;

  insert into public.audit_log(actor, action, table_name, row_id, details)
  values (
    auth.uid(),
    'edit_plan_row',
    target_table,
    p_row_id::text,
    jsonb_build_object(
      'editor', auth.uid(),
      'changes', changes_log,
      'reason', nullif(btrim(p_reason), '')
    )
  );

  return jsonb_build_object('row_id', p_row_id, 'table_name', target_table, 'changes', changes_log);
end;
$$;

revoke all on function public.edit_plan_row(text, uuid, jsonb, text) from public, anon;
grant execute on function public.edit_plan_row(text, uuid, jsonb, text) to authenticated;

alter table public.app_config
  drop constraint if exists app_config_key_check,
  add constraint app_config_key_check
    check (key in (
      'school_sync', 'plan_eligibility', 'staffing_rules', 'dashboard_cards',
      'use_sheet_supervisor_fallback'
    ));

insert into public.app_config (key, value, updated_by)
select 'use_sheet_supervisor_fallback', 'true'::jsonb, p.id
from public.profiles p
where p.role = 'admin'
order by p.created_at
limit 1
on conflict (key) do nothing;

drop policy if exists app_config_write on public.app_config;
create policy app_config_write on public.app_config
for all to authenticated
using (
  (key in ('staffing_rules', 'use_sheet_supervisor_fallback') and public.has_role('admin'))
  or (key not in ('staffing_rules', 'use_sheet_supervisor_fallback')
    and public.has_role('admin', 'project_manager'))
)
with check (
  updated_by = auth.uid()
  and (
    (key in ('staffing_rules', 'use_sheet_supervisor_fallback') and public.has_role('admin'))
    or (key not in ('staffing_rules', 'use_sheet_supervisor_fallback')
      and public.has_role('admin', 'project_manager'))
  )
);

drop policy if exists school_supervisor_assignments_read on public.school_supervisor_assignments;
create policy school_supervisor_assignments_read
on public.school_supervisor_assignments
for select to authenticated
using (
  public.has_permission('workforce.view')
  or public.has_permission('workforce.assign_schools')
  or public.has_permission('schools.view')
  or public.has_permission('plans.view')
  or public.has_permission('plans.import')
  or public.has_permission('tools.ticket_analysis')
);

create or replace function public.inventory_order_supervisor_name(
  p_requester_id uuid,
  p_school_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.username), ''))
      from public.profiles p
      where p.id = p_requester_id
    ),
    (
      select nullif(btrim(current_supervisors.maintenance_supervisor_name), '')
      from public.school_current_supervisors current_supervisors
      where current_supervisors.school_id = p_school_id
    ),
    '—'
  );
$$;

revoke all on function public.inventory_order_supervisor_name(uuid, uuid) from public, anon;
grant execute on function public.inventory_order_supervisor_name(uuid, uuid) to authenticated;

create or replace function public.approve_request(p_request_id uuid, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.stock_requests;
  entry jsonb;
  v_item_id uuid;
  approved_quantity numeric;
  expected_count integer;
  payload_count integer;
  stamp_path text;
  storage_object_exists boolean;
  any_approved boolean := false;
  distinct_count integer;
  approval_timestamp timestamptz;
  school_name text;
  supervisor_name text;
  engineer_name text;
  approved_items jsonb;
begin
  if auth.uid() is null or not public.has_permission('inventory.approve') then
    raise exception 'غير مصرح باعتماد طلبات المخزون';
  end if;

  select * into request_row
  from public.stock_requests
  where id = p_request_id
  for update;
  if not found or request_row.status <> 'submitted' or request_row.engineer_id <> auth.uid() then
    raise exception 'الطلب غير مسند إليك أو ليس في حالة انتظار الاعتماد';
  end if;

  select s.storage_path into stamp_path
  from public.approver_stamps s
  where s.user_id = auth.uid();
  if stamp_path is null then
    raise exception 'يجب رفع ختم الاعتماد قبل اعتماد الطلب';
  end if;
  select exists (
    select 1 from storage.objects o
    where o.bucket_id = 'inventory-private' and o.name = stamp_path
  ) into storage_object_exists;
  if not storage_object_exists then
    raise exception 'ملف ختم الاعتماد غير موجود في المخزن الخاص';
  end if;

  select count(*) into expected_count
  from public.stock_request_items
  where request_id = p_request_id;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'قائمة كميات الاعتماد غير صالحة';
  end if;
  if jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > expected_count or expected_count = 0 then
    raise exception 'أبقِ صنفًا واحدًا على الأقل في طلب الاعتماد';
  end if;
  select count(*), count(distinct value->>'item_id')
  into payload_count, distinct_count
  from jsonb_array_elements(p_items);
  if payload_count <> distinct_count then
    raise exception 'قائمة كميات الاعتماد تحتوي أصنافًا مكررة';
  end if;

  perform i.id
  from public.inventory_items i
  join public.stock_request_items ri on ri.item_id = i.id
  where ri.request_id = p_request_id
  order by i.id
  for update of i;

  for entry in select value from jsonb_array_elements(p_items)
  loop
    v_item_id := (entry->>'item_id')::uuid;
    approved_quantity := (entry->>'qty_approved')::numeric;
    if approved_quantity is null or approved_quantity <= 0 then
      raise exception 'كمية الاعتماد غير صالحة';
    end if;
    update public.stock_request_items
    set qty_approved = approved_quantity
    where request_id = p_request_id
      and stock_request_items.item_id = v_item_id
      and approved_quantity <= qty_requested;
    if not found then
      raise exception 'الصنف غير موجود في الطلب أو كمية الاعتماد تجاوزت المطلوب';
    end if;
    any_approved := true;
  end loop;
  if not any_approved then
    raise exception 'يجب اعتماد كمية موجبة لصنف واحد على الأقل';
  end if;

  delete from public.stock_request_items request_item
  where request_item.request_id = p_request_id
    and not exists (
      select 1
      from jsonb_array_elements(p_items) as parsed(value)
      where (parsed.value->>'item_id')::uuid = request_item.item_id
    );

  approval_timestamp := now();
  select s.name
  into school_name
  from public.schools s
  where s.id = request_row.school_id;
  supervisor_name := public.inventory_order_supervisor_name(request_row.requester_id, request_row.school_id);
  select coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.username), ''), '—')
  into engineer_name
  from public.profiles p
  where p.id = auth.uid();
  select jsonb_agg(
    jsonb_build_object(
      'logixCode', i.logix_code,
      'name', i.name,
      'unit', i.unit,
      'quantity', ri.qty_approved,
      'note', ri.note
    )
    order by i.name, i.id
  )
  into approved_items
  from public.stock_request_items ri
  join public.inventory_items i on i.id = ri.item_id
  where ri.request_id = p_request_id;
  if school_name is null or approved_items is null then
    raise exception 'تعذر حفظ نسخة أمر الصرف؛ بيانات المدرسة أو الأصناف غير مكتملة';
  end if;

  update public.stock_requests
  set status = 'approved',
      approved_by = auth.uid(),
      approved_at = approval_timestamp,
      approver_stamp_path = stamp_path,
      export_order_snapshot = jsonb_build_object(
        'orderDate', approval_timestamp,
        'schoolName', school_name,
        'supervisorName', supervisor_name,
        'engineerName', engineer_name,
        'stampPath', stamp_path,
        'items', approved_items
      )
  where id = p_request_id;
end;
$$;

create or replace function public.load_inventory_export_order(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.stock_requests;
  school_name text;
  supervisor_name text;
  engineer_name text;
  preview_items jsonb;
begin
  if auth.uid() is null or not public.has_permission('inventory.export_order') then
    raise exception 'غير مصرح بتصدير أمر الصرف';
  end if;

  select * into request_row
  from public.stock_requests
  where id = p_request_id;
  if not found then
    raise exception 'الطلب غير موجود';
  end if;

  if request_row.status in ('approved', 'partially_issued', 'issued') then
    if request_row.export_order_snapshot is null then
      raise exception 'لا توجد نسخة محفوظة لأمر الصرف لهذا الطلب';
    end if;
    return jsonb_build_object(
      'requestId', request_row.id,
      'number', request_row.number,
      'status', request_row.status,
      'receiverName', request_row.receiver_name,
      'snapshot', request_row.export_order_snapshot,
      'preview', null
    );
  end if;

  if request_row.requester_id <> auth.uid()
     and request_row.engineer_id is distinct from auth.uid()
     and not public.has_permission('users.manage') then
    raise exception 'لا يحق لك معاينة هذا الطلب قبل اعتماده';
  end if;

  select s.name
  into school_name
  from public.schools s
  where s.id = request_row.school_id;
  supervisor_name := public.inventory_order_supervisor_name(request_row.requester_id, request_row.school_id);
  select coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.username), ''), '—')
  into engineer_name
  from public.profiles p
  where p.id = request_row.engineer_id;
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'logixCode', i.logix_code,
      'name', i.name,
      'unit', i.unit,
      'quantity', ri.qty_requested,
      'note', ri.note
    )
    order by i.name, i.id
  ), '[]'::jsonb)
  into preview_items
  from public.stock_request_items ri
  join public.inventory_items i on i.id = ri.item_id
  where ri.request_id = p_request_id;
  if school_name is null then
    raise exception 'تعذر تحميل بيانات المدرسة لمعاينة الطلب';
  end if;

  return jsonb_build_object(
    'requestId', request_row.id,
    'number', request_row.number,
    'status', request_row.status,
    'receiverName', request_row.receiver_name,
    'snapshot', null,
    'preview', jsonb_build_object(
      'orderDate', coalesce(request_row.submitted_at, now()),
      'schoolName', school_name,
      'supervisorName', supervisor_name,
      'engineerName', coalesce(engineer_name, '—'),
      'stampPath', null,
      'items', preview_items
    )
  );
end;
$$;

notify pgrst, 'reload schema';

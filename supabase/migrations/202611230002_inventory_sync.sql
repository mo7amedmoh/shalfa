create table if not exists public.inventory_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (btrim(name) <> '')
);

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  logix_code text,
  name text not null check (btrim(name) <> ''),
  unit text not null check (btrim(unit) <> ''),
  category_id uuid not null references public.inventory_categories(id) on delete restrict,
  photo_path text,
  min_stock numeric check (min_stock is null or min_stock >= 0),
  notes text,
  is_active boolean not null default true
);



create table if not exists public.stock_request_counters (
  request_year integer primary key,
  last_number integer not null check (last_number > 0)
);

create table if not exists public.stock_requests (
  id uuid primary key default gen_random_uuid(),
  number text not null unique check (number ~ '^SR-[0-9]{4}-[0-9]{4,}$'),
  school_id uuid not null references public.schools(id) on delete restrict,
  requester_id uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  engineer_id uuid references public.profiles(id) on delete restrict,
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'approved', 'rejected', 'issued', 'partially_issued', 'cancelled')),
  notes text,
  rejected_reason text,
  submitted_at timestamptz,
  approved_by uuid references public.profiles(id) on delete restrict,
  approved_at timestamptz,
  approver_stamp_path text,
  export_order_snapshot jsonb,
  issued_by uuid references public.profiles(id) on delete restrict,
  issued_at timestamptz,
  receiver_name text,
  check (status in ('draft', 'cancelled') or engineer_id is not null)
);

create table if not exists public.stock_request_items (
  request_id uuid not null references public.stock_requests(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  qty_requested numeric not null check (qty_requested > 0),
  qty_approved numeric not null default 0 check (qty_approved >= 0),
  qty_issued numeric not null default 0 check (qty_issued >= 0 and qty_issued <= qty_approved),
  note text,
  primary key (request_id, item_id)
);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  movement_type text not null
    check (movement_type in ('opening', 'receipt', 'issue', 'adjustment')),
  quantity numeric not null,
  request_id uuid references public.stock_requests(id) on delete restrict,
  reason text,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (
    (movement_type = 'opening' and quantity >= 0 and request_id is null)
    or (movement_type = 'receipt' and quantity > 0 and request_id is null)
    or (movement_type = 'issue' and quantity < 0 and request_id is not null)
    or (movement_type = 'adjustment' and quantity <> 0 and request_id is null)
  )
);

create unique index if not exists inventory_movements_one_opening_per_item
  on public.inventory_movements (item_id)
  where movement_type = 'opening';
create index if not exists inventory_movements_item_created_idx
  on public.inventory_movements (item_id, created_at);
create index if not exists stock_requests_requester_status_idx
  on public.stock_requests (requester_id, status);
create index if not exists stock_requests_engineer_status_idx
  on public.stock_requests (engineer_id, status);
create index if not exists stock_request_items_item_idx
  on public.stock_request_items (item_id);

create table if not exists public.approver_stamps (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  storage_path text not null unique
    check (storage_path <> '' and split_part(storage_path, '/', 1) = user_id::text)
);

-- Bring tables created by the original migration up to its current column set.
alter table public.inventory_categories add column if not exists id uuid default gen_random_uuid();
alter table public.inventory_categories add column if not exists name text;
alter table public.inventory_items add column if not exists id uuid default gen_random_uuid();
alter table public.inventory_items add column if not exists logix_code text;
alter table public.inventory_items add column if not exists name text;
alter table public.inventory_items add column if not exists unit text;
alter table public.inventory_items add column if not exists category_id uuid;
alter table public.inventory_items add column if not exists photo_path text;
alter table public.inventory_items add column if not exists min_stock numeric;
alter table public.inventory_items add column if not exists notes text;
alter table public.inventory_items add column if not exists is_active boolean not null default true;
alter table public.stock_request_counters add column if not exists request_year integer;
alter table public.stock_request_counters add column if not exists last_number integer;
alter table public.stock_requests add column if not exists id uuid default gen_random_uuid();
alter table public.stock_requests add column if not exists number text;
alter table public.stock_requests add column if not exists school_id uuid;
alter table public.stock_requests add column if not exists requester_id uuid default auth.uid();
alter table public.stock_requests add column if not exists engineer_id uuid;
alter table public.stock_requests add column if not exists status text not null default 'draft';
alter table public.stock_requests add column if not exists notes text;
alter table public.stock_requests add column if not exists rejected_reason text;
alter table public.stock_requests add column if not exists submitted_at timestamptz;
alter table public.stock_requests add column if not exists approved_by uuid;
alter table public.stock_requests add column if not exists approved_at timestamptz;
alter table public.stock_requests add column if not exists approver_stamp_path text;
alter table public.stock_requests add column if not exists export_order_snapshot jsonb;
alter table public.stock_requests add column if not exists issued_by uuid;
alter table public.stock_requests add column if not exists issued_at timestamptz;
alter table public.stock_requests add column if not exists receiver_name text;
alter table public.stock_request_items add column if not exists request_id uuid;
alter table public.stock_request_items add column if not exists item_id uuid;
alter table public.stock_request_items add column if not exists qty_requested numeric;
alter table public.stock_request_items add column if not exists qty_approved numeric not null default 0;
alter table public.stock_request_items add column if not exists qty_issued numeric not null default 0;
alter table public.stock_request_items add column if not exists note text;
alter table public.inventory_movements add column if not exists id uuid default gen_random_uuid();
alter table public.inventory_movements add column if not exists item_id uuid;
alter table public.inventory_movements add column if not exists movement_type text;
alter table public.inventory_movements add column if not exists quantity numeric;
alter table public.inventory_movements add column if not exists request_id uuid;
alter table public.inventory_movements add column if not exists reason text;
alter table public.inventory_movements add column if not exists created_by uuid default auth.uid();
alter table public.inventory_movements add column if not exists created_at timestamptz not null default now();
alter table public.approver_stamps add column if not exists user_id uuid;
alter table public.approver_stamps add column if not exists storage_path text;

-- Remove every single-column unique constraint/index for Logix codes, but retain a lookup index.
alter table public.inventory_items drop constraint if exists inventory_items_logix_code_key;
do $$
declare
  v_constraint record;
  v_index record;
begin
  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.inventory_items'::regclass
      and contype = 'u'
      and cardinality(conkey) = 1
      and conkey[1] = (
        select attnum from pg_attribute
        where attrelid = 'public.inventory_items'::regclass and attname = 'logix_code'
      )
  loop
    execute format('alter table public.inventory_items drop constraint %I', v_constraint.conname);
  end loop;
  for v_index in
    select index_ns.nspname as schema_name, index_class.relname as index_name
    from pg_index ix
    join pg_class index_class on index_class.oid = ix.indexrelid
    join pg_namespace index_ns on index_ns.oid = index_class.relnamespace
    join pg_attribute att on att.attrelid = ix.indrelid and att.attnum = ix.indkey[0]
    where ix.indrelid = 'public.inventory_items'::regclass
      and ix.indisunique and not ix.indisprimary and ix.indnkeyatts = 1
      and att.attname = 'logix_code'
  loop
    execute format('drop index %I.%I', v_index.schema_name, v_index.index_name);
  end loop;
end;
$$;
drop index if exists public.inventory_items_logix_code_unique;
create index if not exists inventory_items_logix_code_idx
  on public.inventory_items (logix_code) where logix_code is not null;

alter table public.stock_requests drop constraint if exists stock_requests_status_check;
alter table public.stock_requests add constraint stock_requests_status_check
  check (status in ('draft', 'submitted', 'approved', 'rejected', 'issued', 'partially_issued', 'cancelled'));
alter table public.stock_requests drop constraint if exists stock_requests_number_check;
alter table public.stock_requests add constraint stock_requests_number_check
  check (number ~ '^SR-[0-9]{4}-[0-9]{4,}$');

alter table public.inventory_categories enable row level security;
alter table public.inventory_items enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.stock_requests enable row level security;
alter table public.stock_request_items enable row level security;
alter table public.approver_stamps enable row level security;

grant select, insert, update, delete on public.inventory_categories to authenticated;
grant select on public.inventory_items to authenticated;
grant select on public.inventory_movements to authenticated;
grant select, insert (school_id, notes), update (school_id, notes) on public.stock_requests to authenticated;
grant select, insert (request_id, item_id, qty_requested, note),
  update (qty_requested, note), delete on public.stock_request_items to authenticated;
grant select, insert (user_id, storage_path), update (storage_path) on public.approver_stamps to authenticated;
revoke all on public.stock_request_counters from public, anon, authenticated;

drop policy if exists inventory_categories_read on public.inventory_categories;
create policy inventory_categories_read on public.inventory_categories
  for select to authenticated
  using (
    public.has_permission('inventory.view')
    or public.has_permission('inventory.manage_items')
    or public.has_permission('inventory.receive_stock')
    or public.has_permission('inventory.adjust')
    or public.has_permission('inventory.approve')
    or public.has_permission('inventory.issue')
  );
drop policy if exists inventory_categories_manage on public.inventory_categories;
create policy inventory_categories_manage on public.inventory_categories
  for all to authenticated
  using (public.has_permission('inventory.manage_items'))
  with check (public.has_permission('inventory.manage_items'));

drop policy if exists inventory_items_read on public.inventory_items;
create policy inventory_items_read on public.inventory_items
  for select to authenticated
  using (
    public.has_permission('inventory.view')
    or public.has_permission('inventory.request')
    or public.has_permission('inventory.manage_items')
    or public.has_permission('inventory.receive_stock')
    or public.has_permission('inventory.adjust')
    or public.has_permission('inventory.issue')
  );
drop policy if exists inventory_movements_read on public.inventory_movements;
create policy inventory_movements_read on public.inventory_movements
  for select to authenticated
  using (
    public.has_permission('inventory.view')
    or public.has_permission('inventory.receive_stock')
    or public.has_permission('inventory.adjust')
    or public.has_permission('inventory.issue')
  );

drop policy if exists stock_requests_read on public.stock_requests;
create policy stock_requests_read on public.stock_requests
  for select to authenticated
  using (
    (
      requester_id = auth.uid()
      and (
        public.has_permission('inventory.request')
        or public.has_permission('inventory.view')
      )
    )
    or (
      engineer_id = auth.uid()
      and public.has_permission('inventory.approve')
    )
    or (
      status in ('approved', 'partially_issued', 'issued')
      and public.has_permission('inventory.issue')
    )
    or (
      public.has_permission('inventory.export_order')
      and (
        status in ('approved', 'partially_issued', 'issued')
        or requester_id = auth.uid()
        or engineer_id = auth.uid()
      )
    )
    or public.has_permission('users.manage')
  );
drop policy if exists stock_requests_create on public.stock_requests;
create policy stock_requests_create on public.stock_requests
  for insert to authenticated
  with check (
    requester_id = auth.uid()
    and status = 'draft'
    and engineer_id is null
    and public.has_permission('inventory.request')
  );
drop policy if exists stock_requests_edit_draft on public.stock_requests;
create policy stock_requests_edit_draft on public.stock_requests
  for update to authenticated
  using (
    requester_id = auth.uid()
    and status = 'draft'
    and public.has_permission('inventory.request')
  )
  with check (
    requester_id = auth.uid()
    and status = 'draft'
    and engineer_id is null
    and public.has_permission('inventory.request')
  );

drop policy if exists stock_request_items_read on public.stock_request_items;
create policy stock_request_items_read on public.stock_request_items
  for select to authenticated
  using (
    exists (
      select 1
      from public.stock_requests r
      where r.id = request_id
        and (
          (r.requester_id = auth.uid()
            and (public.has_permission('inventory.request') or public.has_permission('inventory.view')))
          or (r.engineer_id = auth.uid() and public.has_permission('inventory.approve'))
          or (r.status in ('approved', 'partially_issued', 'issued')
            and public.has_permission('inventory.issue'))
          or (public.has_permission('inventory.export_order')
            and (r.status in ('approved', 'partially_issued', 'issued')
              or r.requester_id = auth.uid()
              or r.engineer_id = auth.uid()))
          or public.has_permission('users.manage')
        )
    )
  );
drop policy if exists stock_request_items_create_draft on public.stock_request_items;
create policy stock_request_items_create_draft on public.stock_request_items
  for insert to authenticated
  with check (
    public.has_permission('inventory.request')
    and exists (
      select 1 from public.stock_requests r
      where r.id = request_id and r.requester_id = auth.uid() and r.status = 'draft'
    )
  );
drop policy if exists stock_request_items_edit_draft on public.stock_request_items;
create policy stock_request_items_edit_draft on public.stock_request_items
  for update to authenticated
  using (
    public.has_permission('inventory.request')
    and exists (
      select 1 from public.stock_requests r
      where r.id = request_id and r.requester_id = auth.uid() and r.status = 'draft'
    )
  )
  with check (
    public.has_permission('inventory.request')
    and exists (
      select 1 from public.stock_requests r
      where r.id = request_id and r.requester_id = auth.uid() and r.status = 'draft'
    )
  );
drop policy if exists stock_request_items_delete_draft on public.stock_request_items;
create policy stock_request_items_delete_draft on public.stock_request_items
  for delete to authenticated
  using (
    public.has_permission('inventory.request')
    and exists (
      select 1 from public.stock_requests r
      where r.id = request_id and r.requester_id = auth.uid() and r.status = 'draft'
    )
  );

drop policy if exists approver_stamps_read on public.approver_stamps;
create policy approver_stamps_read on public.approver_stamps
  for select to authenticated
  using (
    (user_id = auth.uid() and public.has_permission('inventory.approve'))
    or public.has_permission('users.manage')
  );
drop policy if exists approver_stamps_create on public.approver_stamps;
create policy approver_stamps_create on public.approver_stamps
  for insert to authenticated
  with check (
    (
      user_id = auth.uid()
      and public.has_permission('inventory.approve')
    )
    or public.has_permission('users.manage')
  );
drop policy if exists approver_stamps_update on public.approver_stamps;
create policy approver_stamps_update on public.approver_stamps
  for update to authenticated
  using (
    (user_id = auth.uid() and public.has_permission('inventory.approve'))
    or public.has_permission('users.manage')
  )
  with check (
    (user_id = auth.uid() and public.has_permission('inventory.approve'))
    or public.has_permission('users.manage')
  );

create or replace function public.assign_stock_request_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_year integer := extract(year from (now() at time zone 'Asia/Riyadh'))::integer;
  next_number integer;
begin
  insert into public.stock_request_counters (request_year, last_number)
  values (v_request_year, 1)
  on conflict (request_year) do update
    set last_number = public.stock_request_counters.last_number + 1
  returning last_number into next_number;

  new.number := 'SR-' || v_request_year::text || '-' || lpad(next_number::text, 4, '0');
  return new;
end;
$$;

drop trigger if exists stock_requests_assign_number on public.stock_requests;
create trigger stock_requests_assign_number
before insert on public.stock_requests
for each row execute function public.assign_stock_request_number();

create or replace function public.guard_stock_request_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if not (
      (old.status = 'draft' and new.status in ('submitted', 'cancelled'))
      or (old.status = 'submitted' and new.status in ('approved', 'rejected', 'cancelled'))
      or (old.status = 'approved' and new.status in ('partially_issued', 'issued'))
      or (old.status = 'partially_issued' and new.status = 'issued')
    ) then
      raise exception 'انتقال حالة طلب المخزون غير مسموح: % -> %', old.status, new.status;
    end if;
  end if;

  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.audit_log (actor, action, table_name, row_id, details)
    values (
      auth.uid(),
      'STOCK_REQUEST_STATUS_CHANGE',
      'stock_requests',
      new.id::text,
      jsonb_build_object(
        'number', new.number,
        'from_status', case when tg_op = 'INSERT' then null else old.status end,
        'to_status', new.status
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists stock_requests_status_audit on public.stock_requests;
create trigger stock_requests_status_audit
before insert or update of status on public.stock_requests
for each row execute function public.guard_stock_request_status();

create or replace function public.prevent_inventory_movement_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'حركات المخزون سجل غير قابل للتعديل أو الحذف';
end;
$$;

drop trigger if exists inventory_movements_immutable on public.inventory_movements;
create trigger inventory_movements_immutable
before update or delete on public.inventory_movements
for each row execute function public.prevent_inventory_movement_mutation();

create or replace function public.record_inventory_movement(
  p_item_id uuid,
  p_movement_type text,
  p_quantity numeric,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  item_row public.inventory_items;
  current_balance numeric;
  reserved_quantity numeric;
  opening_exists boolean;
  movement_id uuid;
begin
  if auth.uid() is null then
    raise exception 'يلزم تسجيل الدخول';
  end if;
  if p_movement_type is null
     or p_movement_type not in ('opening', 'receipt', 'adjustment') then
    raise exception 'نوع الحركة غير مسموح عبر هذه الدالة';
  end if;
  if p_quantity is null then
    raise exception 'كمية الحركة مطلوبة';
  end if;
  if p_movement_type = 'adjustment' and nullif(btrim(p_reason), '') is null then
    raise exception 'سبب التسوية مطلوب';
  end if;
  if p_movement_type = 'receipt' then
    if not public.has_permission('inventory.receive_stock') then
      raise exception 'غير مصرح باستلام المخزون';
    end if;
    if p_quantity <= 0 then
      raise exception 'كمية الاستلام يجب أن تكون موجبة';
    end if;
  elsif not public.has_permission('inventory.adjust') then
    raise exception 'غير مصرح بتسجيل الجرد أو التسوية';
  elsif p_movement_type = 'opening' and p_quantity < 0 then
    raise exception 'كمية الجرد الافتتاحي لا يمكن أن تكون سالبة';
  elsif p_movement_type = 'adjustment' and p_quantity = 0 then
    raise exception 'كمية التسوية لا يمكن أن تكون صفرًا';
  end if;

  select * into item_row
  from public.inventory_items
  where id = p_item_id
  for update;
  if not found then
    raise exception 'الصنف غير موجود';
  end if;
  if not item_row.is_active then
    raise exception 'لا يمكن تسجيل حركة لصنف غير نشط';
  end if;

  select exists (
    select 1 from public.inventory_movements
    where item_id = p_item_id and movement_type = 'opening'
  ) into opening_exists;

  if p_movement_type = 'opening' then
    if opening_exists then
      raise exception 'تم تسجيل الجرد الافتتاحي لهذا الصنف';
    end if;
    if exists (select 1 from public.inventory_movements where item_id = p_item_id) then
      raise exception 'يجب أن يكون الجرد الافتتاحي أول حركة للصنف';
    end if;
  else
    if not opening_exists then
      raise exception 'يجب تسجيل الجرد الافتتاحي قبل الحركات الأخرى';
    end if;
    if p_movement_type = 'adjustment' and p_quantity < 0 then
      select coalesce(sum(m.quantity), 0)
      into current_balance
      from public.inventory_movements m
      where m.item_id = p_item_id;

      select coalesce(sum(ri.qty_approved - ri.qty_issued), 0)
      into reserved_quantity
      from public.stock_request_items ri
      join public.stock_requests r on r.id = ri.request_id
      where ri.item_id = p_item_id
        and r.status in ('approved', 'partially_issued');

      if current_balance + p_quantity < reserved_quantity then
        raise exception 'التسوية ستخفض الرصيد عن الكمية المحجوزة';
      end if;
    end if;
  end if;

  insert into public.inventory_movements (
    item_id, movement_type, quantity, reason, created_by
  )
  values (p_item_id, p_movement_type, p_quantity, p_reason, auth.uid())
  returning id into movement_id;

  return movement_id;
end;
$$;

create or replace function public.save_inventory_item(
  p_item_id uuid,
  p_is_new boolean,
  p_logix_code text,
  p_name text,
  p_unit text,
  p_category_id uuid,
  p_photo_path text,
  p_min_stock numeric,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_item_id uuid;
begin
  if auth.uid() is null or not public.has_permission('inventory.manage_items') then
    raise exception 'غير مصرح بإدارة أصناف المخزون';
  end if;
  if nullif(btrim(p_name), '') is null or nullif(btrim(p_unit), '') is null then
    raise exception 'اسم الصنف والوحدة مطلوبان';
  end if;
  if p_min_stock < 0 then
    raise exception 'الحد الأدنى لا يمكن أن يكون سالبًا';
  end if;
  if p_is_new is null then
    raise exception 'يجب تحديد ما إذا كان الصنف جديدًا';
  end if;
  if not exists (
    select 1 from public.inventory_categories where id = p_category_id
  ) then
    raise exception 'قسم الصنف غير موجود';
  end if;
  saved_item_id := coalesce(p_item_id, gen_random_uuid());
  if p_photo_path is not null
     and p_photo_path !~ ('^items/' || saved_item_id::text || '/[^/]+$')
     and p_photo_path !~ '^https?://' then
    raise exception 'مسار صورة الصنف غير صالح';
  end if;

  if p_is_new then
    insert into public.inventory_items (
      id,
      logix_code, name, unit, category_id, photo_path, min_stock, notes
    )
    values (
      saved_item_id,
      nullif(btrim(p_logix_code), ''),
      btrim(p_name),
      btrim(p_unit),
      p_category_id,
      p_photo_path,
      p_min_stock,
      nullif(btrim(p_notes), '')
    );
  else
    update public.inventory_items
    set logix_code = nullif(btrim(p_logix_code), ''),
        name = btrim(p_name),
        unit = btrim(p_unit),
        category_id = p_category_id,
        photo_path = p_photo_path,
        min_stock = p_min_stock,
        notes = nullif(btrim(p_notes), '')
    where id = saved_item_id;
    if not found then
      raise exception 'الصنف المطلوب تعديله غير موجود';
    end if;
  end if;

  return saved_item_id;
end;
$$;

-- The current import_inventory_items implementation is defined after all schema and policy syncs.


-- Explicit match IDs preserve item UUID identity when Logix codes are blank or duplicated.
create or replace function public.normalize_inventory_import_text(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select btrim(regexp_replace(
    translate(
      regexp_replace(lower(coalesce(p_value, '')), U&'[\064B-\065F\0670\0640]', '', 'g'),
      'أإآٱى', 'ااااي'
    ),
    '\s+', ' ', 'g'
  ));
$$;

create or replace function public.import_inventory_items(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item_row jsonb;
  v_item_id uuid;
  v_existing_item_id uuid;
  v_requested_existing_id uuid;
  v_category_id uuid;
  v_logix_code text;
  v_item_name text;
  v_item_unit text;
  v_category_name text;
  v_photo_path text;
  v_opening_balance numeric;
  v_is_existing boolean;
  v_inserted_count integer := 0;
  v_updated_count integer := 0;
begin
  if auth.uid() is null or not public.has_permission('inventory.manage_items') then
    raise exception 'غير مصرح باستيراد أصناف المخزون';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'بيانات الاستيراد يجب أن تكون قائمة أصناف';
  end if;

  for v_item_row in select value from jsonb_array_elements(p_rows)
  loop
    v_item_id := nullif(v_item_row ->> 'item_id', '')::uuid;
    v_requested_existing_id := nullif(v_item_row ->> 'existing_item_id', '')::uuid;
    v_logix_code := nullif(btrim(v_item_row ->> 'logix_code'), '');
    v_item_name := nullif(btrim(v_item_row ->> 'name'), '');
    v_item_unit := nullif(btrim(v_item_row ->> 'unit'), '');
    v_category_name := nullif(btrim(v_item_row ->> 'category'), '');
    v_photo_path := nullif(btrim(v_item_row ->> 'photo_path'), '');
    v_opening_balance := case
      when v_item_row -> 'opening_balance' is null or v_item_row -> 'opening_balance' = 'null'::jsonb then null
      else (v_item_row ->> 'opening_balance')::numeric
    end;

    if v_item_id is null or v_item_name is null or v_item_unit is null or v_category_name is null then
      raise exception 'معرّف الصنف واسمه ووحدته وقسمه مطلوبة';
    end if;
    if v_opening_balance is not null and v_opening_balance < 0 then
      raise exception 'الرصيد الافتتاحي لا يمكن أن يكون سالبًا';
    end if;
    if v_photo_path is not null and v_photo_path !~ ('^items/' || v_item_id::text || '/[^/]+\.webp$') then
      raise exception 'مسار صورة الاستيراد غير صالح';
    end if;

    insert into public.inventory_categories (name)
    values (v_category_name)
    on conflict (name) do update set name = excluded.name
    returning id into v_category_id;

    v_existing_item_id := null;
    v_is_existing := v_requested_existing_id is not null;
    if v_is_existing then
      select id into v_existing_item_id
      from public.inventory_items
      where id = v_requested_existing_id
      for update;
      if v_existing_item_id is null then
        raise exception 'الصنف المحدد للمطابقة لم يعد موجودًا؛ أعد المراجعة';
      end if;
      if public.normalize_inventory_import_text((select name from public.inventory_items where id = v_existing_item_id))
           <> public.normalize_inventory_import_text(v_item_name) then
        raise exception 'اسم الصنف تغيّر أثناء الاستيراد؛ أعد المراجعة';
      end if;
      if v_logix_code is not null then
        if public.normalize_inventory_import_text((select logix_code from public.inventory_items where id = v_existing_item_id))
             <> public.normalize_inventory_import_text(v_logix_code) then
          raise exception 'كود الصنف تغيّر أثناء الاستيراد؛ أعد المراجعة';
        end if;
      elsif exists (
        select 1 from public.inventory_items i
        join public.inventory_categories c on c.id = i.category_id
        where i.id = v_existing_item_id
          and (nullif(btrim(i.logix_code), '') is not null
            or public.normalize_inventory_import_text(c.name) <> public.normalize_inventory_import_text(v_category_name))
      ) then
        raise exception 'بيانات الصنف تغيّرت أثناء الاستيراد؛ أعد المراجعة';
      end if;
      if v_photo_path is not null and v_photo_path !~ ('^items/' || v_existing_item_id::text || '/[^/]+\.webp$') then
        raise exception 'مسار صورة الصنف المحدد غير صالح';
      end if;

      update public.inventory_items
      set logix_code = v_logix_code,
          name = v_item_name,
          category_id = v_category_id,
          photo_path = coalesce(v_photo_path, inventory_items.photo_path)
      where id = v_existing_item_id;
      v_updated_count := v_updated_count + 1;
    else
      insert into public.inventory_items (
        id, logix_code, name, unit, category_id, photo_path, notes
      ) values (
        v_item_id, v_logix_code, v_item_name, v_item_unit, v_category_id, v_photo_path,
        nullif(btrim(v_item_row ->> 'notes'), '')
      );
      v_inserted_count := v_inserted_count + 1;
      if v_opening_balance is not null then
        insert into public.inventory_movements (
          item_id, movement_type, quantity, reason, created_by
        ) values (
          v_item_id, 'opening', v_opening_balance, 'استيراد Excel - جرد افتتاحي', auth.uid()
        );
      end if;
    end if;
  end loop;

  return jsonb_build_object('inserted', v_inserted_count, 'updated', v_updated_count);
end;
$$;

drop view if exists public.inventory_balances;
create view public.inventory_balances as
with movement_totals as (
  select
    m.item_id,
    sum(m.quantity) as balance,
    bool_or(m.movement_type = 'opening') as is_counted
  from public.inventory_movements m
  group by m.item_id
),
reservations as (
  select
    ri.item_id,
    sum(ri.qty_approved - ri.qty_issued) as reserved
  from public.stock_request_items ri
  join public.stock_requests r on r.id = ri.request_id
  where r.status in ('approved', 'partially_issued')
  group by ri.item_id
)
select
  i.id as item_id,
  i.logix_code,
  i.name,
  i.unit,
  i.category_id,
  i.photo_path,
  i.notes,
  i.min_stock,
  i.is_active,
  case when coalesce(mt.is_counted, false) then coalesce(mt.balance, 0) else null end as balance,
  coalesce(rs.reserved, 0) as reserved,
  case
    when coalesce(mt.is_counted, false)
      then coalesce(mt.balance, 0) - coalesce(rs.reserved, 0)
    else null
  end as available,
  case
    when not coalesce(mt.is_counted, false) then 'uncounted'
    when coalesce(mt.balance, 0) - coalesce(rs.reserved, 0) <= 0 then 'out'
    when i.min_stock is not null
      and coalesce(mt.balance, 0) - coalesce(rs.reserved, 0) <= i.min_stock then 'low'
    else 'available'
  end as status
from public.inventory_items i
left join movement_totals mt on mt.item_id = i.id
left join reservations rs on rs.item_id = i.id
where public.has_permission('inventory.view')
   or public.has_permission('inventory.request')
   or public.has_permission('inventory.manage_items')
   or public.has_permission('inventory.receive_stock')
   or public.has_permission('inventory.adjust')
   or public.has_permission('inventory.approve')
   or public.has_permission('inventory.issue');

grant select on public.inventory_balances to authenticated;

create or replace function public.save_stock_request_draft(
  p_school_id uuid,
  p_items jsonb,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_request_id uuid;
begin
  if auth.uid() is null or not public.has_permission('inventory.request') then
    raise exception 'غير مصرح بإنشاء طلب مخزون';
  end if;
  if p_school_id is null or not exists (
    select 1 from public.schools where id = p_school_id
  ) then
    raise exception 'المدرسة المحددة غير موجودة';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'أضف صنفًا واحدًا على الأقل إلى الطلب';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_items) as entry(value)
    where jsonb_typeof(entry.value) <> 'object'
       or jsonb_typeof(entry.value -> 'item_id') <> 'string'
       or jsonb_typeof(entry.value -> 'qty_requested') <> 'number'
  ) then
    raise exception 'بيانات أصناف الطلب غير صالحة';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_items) as entry(item_id uuid, qty_requested numeric)
    where entry.item_id is null or entry.qty_requested is null or entry.qty_requested <= 0
  ) then
    raise exception 'يجب أن تكون كميات الطلب أكبر من صفر';
  end if;
  if (
    select count(*) <> count(distinct entry.item_id)
    from jsonb_to_recordset(p_items) as entry(item_id uuid, qty_requested numeric)
  ) then
    raise exception 'لا يمكن تكرار الصنف في الطلب';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_items) as entry(item_id uuid, qty_requested numeric)
    left join public.inventory_items item on item.id = entry.item_id
    where item.id is null or not item.is_active
  ) then
    raise exception 'أحد أصناف الطلب غير موجود أو غير نشط';
  end if;

  insert into public.stock_requests (school_id, notes)
  values (p_school_id, nullif(btrim(coalesce(p_notes, '')), ''))
  returning id into saved_request_id;

  insert into public.stock_request_items (request_id, item_id, qty_requested)
  select saved_request_id, entry.item_id, entry.qty_requested
  from jsonb_to_recordset(p_items) as entry(item_id uuid, qty_requested numeric);

  return saved_request_id;
end;
$$;

create or replace function public.recent_inventory_request_items()
returns table (
  item_id uuid,
  name text,
  logix_code text,
  unit text,
  available numeric,
  last_requested_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    item.id,
    item.name,
    item.logix_code,
    item.unit,
    balance.available,
    max(request.submitted_at) as last_requested_at
  from public.stock_requests request
  join public.stock_request_items request_item on request_item.request_id = request.id
  join public.inventory_items item on item.id = request_item.item_id
  left join public.inventory_balances balance on balance.item_id = item.id
  where auth.uid() is not null
    and public.has_permission('inventory.request')
    and request.requester_id = auth.uid()
    and request.submitted_at is not null
    and item.is_active
  group by item.id, item.name, item.logix_code, item.unit, balance.available
  order by max(request.submitted_at) desc, item.name
  limit 10;
$$;

create or replace function public.submit_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.stock_requests;
  requester_employee_id uuid;
  assigned_engineer_id uuid;
begin
  if auth.uid() is null or not public.has_permission('inventory.request') then
    raise exception 'غير مصرح بتقديم طلب مخزون';
  end if;

  select * into request_row
  from public.stock_requests
  where id = p_request_id
  for update;
  if not found then
    raise exception 'طلب المخزون غير موجود';
  end if;
  if request_row.requester_id <> auth.uid() or request_row.status <> 'draft' then
    raise exception 'لا يمكن تقديم هذا الطلب';
  end if;
  if not exists (
    select 1 from public.stock_request_items
    where request_id = p_request_id
  ) then
    raise exception 'أضف صنفًا واحدًا على الأقل قبل التقديم';
  end if;

  select e.id into requester_employee_id
  from public.profiles p
  join public.employees e on e.id = p.employee_id
  where p.id = auth.uid() and p.active;
  if requester_employee_id is null then
    raise exception 'ملف المشرف غير مرتبط بسجل موظف';
  end if;

  with recursive ancestors(id, manager_id, depth, path) as (
    select e.id, e.manager_id, 0, array[e.id]::uuid[]
    from public.employees e
    where e.id = requester_employee_id
    union all
    select manager.id, manager.manager_id, ancestor.depth + 1, ancestor.path || manager.id
    from ancestors ancestor
    join public.employees manager on manager.id = ancestor.manager_id
    where ancestor.depth < 100
      and not manager.id = any(ancestor.path)
  )
  select p.id into assigned_engineer_id
  from ancestors ancestor
  join public.profiles p on p.employee_id = ancestor.id
  where ancestor.depth > 0
    and p.role = 'area_engineer'
    and p.active
  order by ancestor.depth
  limit 1;

  if assigned_engineer_id is null then
    raise exception 'لم يُعثر على مهندس منطقة مرتبط في التسلسل الإداري';
  end if;

  update public.stock_requests
  set engineer_id = assigned_engineer_id,
      status = 'submitted',
      submitted_at = now()
  where id = p_request_id;
end;
$$;

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
  select
    s.name,
    coalesce(nullif(btrim(s.extra ->> 'اسم المشرف (صيانة)'), ''), '—')
  into school_name, supervisor_name
  from public.schools s
  where s.id = request_row.school_id;
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

  select
    s.name,
    coalesce(nullif(btrim(s.extra ->> 'اسم المشرف (صيانة)'), ''), '—')
  into school_name, supervisor_name
  from public.schools s
  where s.id = request_row.school_id;
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
      'supervisorName', coalesce(supervisor_name, '—'),
      'engineerName', coalesce(engineer_name, '—'),
      'stampPath', null,
      'items', preview_items
    )
  );
end;
$$;

update public.stock_requests sr
set export_order_snapshot = jsonb_set(
  sr.export_order_snapshot,
  '{supervisorName}',
  to_jsonb(btrim(s.extra ->> 'اسم المشرف (صيانة)')),
  false
)
from public.schools s, public.profiles requester
where sr.school_id = s.id
  and sr.requester_id = requester.id
  and sr.status in ('approved', 'partially_issued', 'issued')
  and sr.export_order_snapshot is not null
  and nullif(btrim(s.extra ->> 'اسم المشرف (صيانة)'), '') is not null
  and sr.export_order_snapshot ->> 'supervisorName'
    = coalesce(nullif(btrim(requester.full_name), ''), nullif(btrim(requester.username), ''), '—')
  and sr.export_order_snapshot ->> 'supervisorName'
    is distinct from btrim(s.extra ->> 'اسم المشرف (صيانة)');

create or replace function public.reject_request(p_request_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.stock_requests;
begin
  if auth.uid() is null or not public.has_permission('inventory.approve') then
    raise exception 'غير مصرح برفض طلبات المخزون';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'سبب الرفض مطلوب';
  end if;

  select * into request_row
  from public.stock_requests
  where id = p_request_id
  for update;
  if not found or request_row.status <> 'submitted' or request_row.engineer_id <> auth.uid() then
    raise exception 'الطلب غير مسند إليك أو ليس في حالة انتظار الاعتماد';
  end if;

  update public.stock_requests
  set status = 'rejected',
      rejected_reason = btrim(p_reason)
  where id = p_request_id;
end;
$$;

create or replace function public.issue_request(
  p_request_id uuid,
  p_items jsonb,
  p_receiver_name text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.stock_requests;
  entry jsonb;
  v_item_id uuid;
  issue_quantity numeric;
  approved_quantity numeric;
  issued_quantity numeric;
  current_balance numeric;
  other_reservations numeric;
  opening_exists boolean;
  payload_count integer;
  all_issued boolean;
begin
  if auth.uid() is null or not public.has_permission('inventory.issue') then
    raise exception 'غير مصرح بصرف المخزون';
  end if;
  if nullif(btrim(p_receiver_name), '') is null then
    raise exception 'اسم المستلم مطلوب';
  end if;

  select * into request_row
  from public.stock_requests
  where id = p_request_id
  for update;
  if not found or request_row.status not in ('approved', 'partially_issued') then
    raise exception 'الطلب غير معتمد أو لا يقبل الصرف';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'قائمة الصرف غير صالحة';
  end if;
  if jsonb_array_length(p_items) = 0 then
    raise exception 'حدد كمية صنف واحد على الأقل للصرف';
  end if;
  select count(distinct value->>'item_id') into payload_count
  from jsonb_array_elements(p_items);
  if payload_count <> jsonb_array_length(p_items) then
    raise exception 'قائمة الصرف تحتوي أصنافًا مكررة';
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
    issue_quantity := (entry->>'qty_issued')::numeric;
    if issue_quantity is null or issue_quantity <= 0 then
      raise exception 'كمية الصرف يجب أن تكون موجبة';
    end if;

    select ri.qty_approved, ri.qty_issued
    into approved_quantity, issued_quantity
    from public.stock_request_items ri
    where ri.request_id = p_request_id and ri.item_id = v_item_id
    for update;
    if not found then
      raise exception 'الصنف غير موجود في الطلب';
    end if;
    if issue_quantity > approved_quantity - issued_quantity then
      raise exception 'كمية الصرف تجاوزت الكمية المعتمدة المتبقية';
    end if;

    select
      exists (
        select 1 from public.inventory_movements m
        where m.item_id = v_item_id and m.movement_type = 'opening'
      ),
      coalesce(sum(m.quantity), 0)
    into opening_exists, current_balance
    from public.inventory_movements m
    where m.item_id = v_item_id;
    if not opening_exists then
      raise exception 'لا يمكن الصرف من صنف غير مجرود';
    end if;

    select coalesce(sum(ri.qty_approved - ri.qty_issued), 0)
    into other_reservations
    from public.stock_request_items ri
    join public.stock_requests r on r.id = ri.request_id
    where ri.item_id = v_item_id
      and r.status in ('approved', 'partially_issued')
      and r.id <> p_request_id;

    if current_balance - other_reservations < issue_quantity then
      raise exception 'الرصيد المتاح لا يكفي للصرف';
    end if;

    insert into public.inventory_movements (
      item_id, movement_type, quantity, request_id, reason, created_by
    )
    values (
      v_item_id,
      'issue',
      -issue_quantity,
      p_request_id,
      'صرف طلب ' || request_row.number,
      auth.uid()
    );
    update public.stock_request_items
    set qty_issued = qty_issued + issue_quantity
    where request_id = p_request_id and stock_request_items.item_id = v_item_id;
  end loop;

  select not exists (
    select 1 from public.stock_request_items ri
    where ri.request_id = p_request_id and ri.qty_issued < ri.qty_approved
  ) into all_issued;
  update public.stock_requests
  set status = case when all_issued then 'issued' else 'partially_issued' end,
      issued_by = auth.uid(),
      issued_at = now(),
      receiver_name = btrim(p_receiver_name)
  where id = p_request_id;
end;
$$;

create or replace function public.cancel_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.stock_requests;
begin
  if auth.uid() is null or not public.has_permission('inventory.request') then
    raise exception 'غير مصرح بإلغاء طلب المخزون';
  end if;

  select * into request_row
  from public.stock_requests
  where id = p_request_id
  for update;
  if not found
     or request_row.requester_id <> auth.uid()
     or request_row.status not in ('draft', 'submitted') then
    raise exception 'يمكن للمنشئ إلغاء الطلب قبل اعتماده فقط';
  end if;

  update public.stock_requests
  set status = 'cancelled'
  where id = p_request_id;
end;
$$;

revoke all on function public.save_stock_request_draft(uuid, jsonb, text) from public, anon;
revoke all on function public.recent_inventory_request_items() from public, anon;
revoke all on function public.record_inventory_movement(uuid, text, numeric, text) from public, anon;
revoke all on function public.save_inventory_item(uuid, boolean, text, text, text, uuid, text, numeric, text) from public, anon;
revoke all on function public.import_inventory_items(jsonb) from public, anon;
revoke all on function public.submit_request(uuid) from public, anon;
revoke all on function public.approve_request(uuid, jsonb) from public, anon;
revoke all on function public.load_inventory_export_order(uuid) from public, anon;
revoke all on function public.reject_request(uuid, text) from public, anon;
revoke all on function public.issue_request(uuid, jsonb, text) from public, anon;
revoke all on function public.cancel_request(uuid) from public, anon;
grant execute on function public.save_stock_request_draft(uuid, jsonb, text) to authenticated;
grant execute on function public.recent_inventory_request_items() to authenticated;
grant execute on function public.record_inventory_movement(uuid, text, numeric, text) to authenticated;
grant execute on function public.save_inventory_item(uuid, boolean, text, text, text, uuid, text, numeric, text) to authenticated;
grant execute on function public.import_inventory_items(jsonb) to authenticated;
grant execute on function public.submit_request(uuid) to authenticated;
grant execute on function public.approve_request(uuid, jsonb) to authenticated;
grant execute on function public.load_inventory_export_order(uuid) to authenticated;
grant execute on function public.reject_request(uuid, text) to authenticated;
grant execute on function public.issue_request(uuid, jsonb, text) to authenticated;
grant execute on function public.cancel_request(uuid) to authenticated;

insert into public.permissions (key, group_key, label_ar, description, enforced_in_db) values
  ('inventory.view', 'inventory', 'عرض المخزون', 'عرض الأصناف والأرصدة والطلبات المسموح بها', true),
  ('inventory.manage_items', 'inventory', 'إدارة الأصناف', 'إدارة تصنيفات وأصناف المخزون', true),
  ('inventory.receive_stock', 'inventory', 'استلام المخزون', 'تسجيل حركات استلام المخزون', true),
  ('inventory.adjust', 'inventory', 'جرد وتسوية المخزون', 'تسجيل الجرد الافتتاحي وتسويات الأرصدة', true),
  ('inventory.request', 'inventory', 'طلب مخزون', 'إنشاء الطلبات وتقديمها وإلغاؤها قبل الاعتماد', true),
  ('inventory.approve', 'inventory', 'اعتماد طلبات المخزون', 'اعتماد أو رفض الطلبات المسندة إلى مهندس المنطقة', true),
  ('inventory.issue', 'inventory', 'صرف المخزون', 'صرف الطلبات المعتمدة من المستودع', true),
  ('inventory.export_order', 'inventory', 'تصدير أمر الصرف', 'تصدير أو طباعة أمر الصرف', true)
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
join public.permissions p on p.key in (
  'inventory.view',
  'inventory.manage_items',
  'inventory.receive_stock',
  'inventory.adjust',
  'inventory.export_order'
)
where r.key = 'project_manager'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
join public.permissions p on p.key in (
  'inventory.view',
  'inventory.approve',
  'inventory.export_order'
)
where r.key = 'area_engineer'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
join public.permissions p on p.key in ('inventory.view', 'inventory.request')
where r.key = 'supervisor'
on conflict do nothing;

insert into storage.buckets (id, name, public)
values ('inventory-private', 'inventory-private', false)
on conflict (id) do nothing;

drop policy if exists inventory_private_stamp_read on storage.objects;
create policy inventory_private_stamp_read on storage.objects
for select to authenticated
using (
  bucket_id = 'inventory-private'
  and (
    (
      split_part(name, '/', 1) = auth.uid()::text
      and public.has_permission('inventory.approve')
    )
    or (
      public.has_permission('inventory.issue')
      and exists (
        select 1
        from public.stock_requests request
        where request.approver_stamp_path = storage.objects.name
          and request.status in ('approved', 'partially_issued', 'issued')
      )
    )
    or (
      public.has_permission('inventory.export_order')
      and exists (
        select 1
        from public.stock_requests request
        where request.approver_stamp_path = storage.objects.name
          and request.status in ('approved', 'partially_issued', 'issued')
      )
    )
    or public.has_permission('users.manage')
  )
);

drop policy if exists inventory_private_stamp_upload on storage.objects;
create policy inventory_private_stamp_upload on storage.objects
for insert to authenticated
with check (
  bucket_id = 'inventory-private'
  and split_part(name, '/', 1) = auth.uid()::text
  and public.has_permission('inventory.approve')
);

drop policy if exists inventory_private_stamp_update on storage.objects;
create policy inventory_private_stamp_update on storage.objects
for update to authenticated
using (
  bucket_id = 'inventory-private'
  and split_part(name, '/', 1) = auth.uid()::text
  and public.has_permission('inventory.approve')
)
with check (
  bucket_id = 'inventory-private'
  and split_part(name, '/', 1) = auth.uid()::text
  and public.has_permission('inventory.approve')
);

drop policy if exists inventory_private_stamp_delete on storage.objects;
create policy inventory_private_stamp_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'inventory-private'
  and split_part(name, '/', 1) = auth.uid()::text
  and public.has_permission('inventory.approve')
);

drop policy if exists inventory_private_item_photo_read on storage.objects;
create policy inventory_private_item_photo_read on storage.objects
for select to authenticated
using (
  bucket_id = 'inventory-private'
  and split_part(name, '/', 1) = 'items'
  and (
    public.has_permission('inventory.view')
    or public.has_permission('inventory.manage_items')
  )
);

drop policy if exists inventory_private_item_photo_upload on storage.objects;
create policy inventory_private_item_photo_upload on storage.objects
for insert to authenticated
with check (
  bucket_id = 'inventory-private'
  and split_part(name, '/', 1) = 'items'
  and public.has_permission('inventory.manage_items')
);

drop policy if exists inventory_private_item_photo_update on storage.objects;
create policy inventory_private_item_photo_update on storage.objects
for update to authenticated
using (
  bucket_id = 'inventory-private'
  and split_part(name, '/', 1) = 'items'
  and public.has_permission('inventory.manage_items')
)
with check (
  bucket_id = 'inventory-private'
  and split_part(name, '/', 1) = 'items'
  and public.has_permission('inventory.manage_items')
);

drop policy if exists inventory_private_item_photo_delete on storage.objects;
create policy inventory_private_item_photo_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'inventory-private'
  and split_part(name, '/', 1) = 'items'
  and public.has_permission('inventory.manage_items')
);

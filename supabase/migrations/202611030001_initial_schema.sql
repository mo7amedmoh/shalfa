create extension if not exists pgcrypto;

create type public.app_role as enum (
  'admin',
  'project_manager',
  'area_engineer',
  'report_follower',
  'supervisor',
  'viewer'
);

create table public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-zA-Z0-9._-]{3,40}$'),
  role public.app_role not null default 'viewer',
  display_name text not null,
  manager_id uuid references public.user_profiles(id),
  phone text,
  created_at timestamptz not null default now()
);

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  ministry_number text not null unique,
  school_name text not null,
  source_fields jsonb not null default '{}'::jsonb,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.school_overrides (
  school_id uuid primary key references public.schools(id) on delete cascade,
  corrected_size text,
  staffing_exception jsonb,
  updated_by uuid not null references public.user_profiles(id),
  updated_at timestamptz not null default now()
);

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  employee_number text not null unique,
  job_title text not null,
  employee_category text not null check (employee_category in ('engineer', 'supervisor', 'administrator', 'technician', 'driver', 'cleaner', 'gatekeeper')),
  department text not null,
  nationality text,
  id_type text,
  hire_date date,
  employment_status text not null default 'active' check (employment_status in ('active', 'inactive')),
  phone text,
  manager_id uuid references public.employees(id),
  created_at timestamptz not null default now()
);

alter table public.user_profiles
  add column employee_id uuid references public.employees(id);

create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.user_profiles where id = (select auth.uid())
$$;

create or replace function public.is_privileged()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_app_role() in ('admin', 'project_manager'), false)
$$;

create or replace function public.prevent_profile_identity_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.username is distinct from old.username then
    raise exception 'Username is immutable';
  end if;
  if (
    new.role is distinct from old.role
    or new.employee_id is distinct from old.employee_id
    or new.manager_id is distinct from old.manager_id
    or new.created_at is distinct from old.created_at
  )
    and public.current_app_role() <> 'admin' then
    raise exception 'Only administrators may change profile roles or employee links';
  end if;
  return new;
end;
$$;

create trigger user_profiles_identity_guard
before update on public.user_profiles
for each row execute function public.prevent_profile_identity_changes();

create table public.employee_private (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  residence_number text,
  updated_at timestamptz not null default now()
);

create table public.employee_ratings (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  rating numeric(5,2) check (rating between 0 and 100),
  updated_by uuid not null references public.user_profiles(id),
  updated_at timestamptz not null default now()
);

create table public.monthly_plans (
  id uuid primary key default gen_random_uuid(),
  plan_month date not null check (extract(day from plan_month) = 1),
  plan_type text not null check (plan_type in ('maintenance', 'cleaning', 'security_safety', 'elevators')),
  created_by uuid not null references public.user_profiles(id),
  created_at timestamptz not null default now(),
  unique (plan_month, plan_type)
);

create table public.monthly_plan_rows (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.monthly_plans(id) on delete cascade,
  school_id uuid not null references public.schools(id),
  planned_date date not null,
  visited_at date,
  report_completed_at date,
  supervisor_id uuid references public.employees(id),
  unique (plan_id, school_id)
);

create table public.general_plan_rows (
  id uuid primary key default gen_random_uuid(),
  plan_type text not null check (plan_type in ('gardening', 'landscaping', 'sewage_waste', 'tank_washing', 'pest_control', 'annual_readiness')),
  school_id uuid not null references public.schools(id),
  planned_date date not null,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'complete')),
  completed_at date,
  notes text,
  created_by uuid not null references public.user_profiles(id),
  unique (plan_type, school_id, planned_date)
);

create table public.cleaner_assignments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  employee_id uuid not null references public.employees(id),
  labour_source text,
  unique (school_id, employee_id)
);

create table public.gatekeeper_assignments (
  school_id uuid primary key references public.schools(id),
  employee_id uuid references public.employees(id),
  phone text
);

create table public.reward_pools (
  id uuid primary key default gen_random_uuid(),
  reward_month date not null,
  engineer_id uuid not null references public.user_profiles(id),
  amount numeric(12,2) not null check (amount >= 0),
  locked_at timestamptz,
  approved_by uuid references public.user_profiles(id),
  unique (reward_month, engineer_id)
);

create table public.reward_distributions (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null references public.reward_pools(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  amount numeric(12,2) not null check (amount >= 0),
  note text,
  created_by uuid not null references public.user_profiles(id),
  created_at timestamptz not null default now(),
  unique (pool_id, employee_id)
);

create or replace function public.enforce_reward_pool_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  pool_amount numeric(12,2);
  pool_locked_at timestamptz;
  pool_engineer_id uuid;
  already_allocated numeric(12,2);
  employee_manager_id uuid;
begin
  select amount, locked_at, engineer_id
  into pool_amount, pool_locked_at, pool_engineer_id
  from public.reward_pools
  where id = new.pool_id
  for update;
  if not found then raise exception 'Reward pool was not found'; end if;
  if pool_locked_at is not null then raise exception 'Reward pool is locked'; end if;
  if public.current_app_role() = 'area_engineer' and pool_engineer_id <> (select auth.uid()) then
    raise exception 'Engineer cannot allocate another engineer''s reward pool';
  end if;
  if new.amount = 0 and coalesce(trim(new.note), '') = '' then
    raise exception 'A note is required for a zero-value reward';
  end if;
  if public.current_app_role() = 'area_engineer' then
    select manager_id into employee_manager_id
    from public.employees
    where id = new.employee_id
      and employee_category in ('technician', 'supervisor');
    if employee_manager_id is distinct from (
      select employee_id from public.user_profiles where id = (select auth.uid())
    ) then
      raise exception 'Engineer may only allocate rewards to direct reports';
    end if;
  end if;
  select coalesce(sum(amount), 0) into already_allocated
  from public.reward_distributions
  where pool_id = new.pool_id and id is distinct from new.id;
  if already_allocated + new.amount > pool_amount then
    raise exception 'Reward allocations exceed the approved pool';
  end if;
  return new;
end;
$$;

create trigger reward_distribution_limit_guard
before insert or update on public.reward_distributions
for each row execute function public.enforce_reward_pool_limit();

create or replace function public.prevent_reward_pool_unlock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.locked_at is not null
    and (new.locked_at is distinct from old.locked_at or new.amount is distinct from old.amount)
    and public.current_app_role() <> 'admin' then
    raise exception 'An approved reward pool cannot be changed or unlocked';
  end if;
  if new.locked_at is not null and new.approved_by is null then
    raise exception 'A locked reward pool must record its approver';
  end if;
  return new;
end;
$$;

create trigger reward_pool_lock_guard
before update on public.reward_pools
for each row execute function public.prevent_reward_pool_unlock();

create table public.kpi_scorecards (
  id uuid primary key default gen_random_uuid(),
  score_month date not null,
  region text not null,
  work_order text not null,
  card_code text not null check (card_code in ('CM', 'OM', 'HS', 'SS')),
  source_data jsonb not null default '{}'::jsonb,
  approved_at timestamptz,
  approved_by uuid references public.user_profiles(id),
  unique (score_month, region, work_order, card_code)
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.user_profiles(id),
  action text not null,
  entity text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_row jsonb;
  after_row jsonb;
  record_id text;
begin
  if tg_op <> 'INSERT' then
    before_row := to_jsonb(old) - 'source_fields' - 'residence_number' - 'phone' - 'rating';
  end if;
  if tg_op <> 'DELETE' then
    after_row := to_jsonb(new) - 'source_fields' - 'residence_number' - 'phone' - 'rating';
  end if;
  record_id := coalesce(after_row->>'id', after_row->>'employee_id', after_row->>'school_id',
                        after_row->>'user_id', before_row->>'id', before_row->>'employee_id',
                        before_row->>'school_id', before_row->>'user_id');
  insert into public.audit_log(actor_id, action, entity, entity_id, details)
  values (
    (select auth.uid()),
    tg_op,
    tg_table_name,
    record_id,
    jsonb_build_object('before', before_row, 'after', after_row)
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger audit_user_profiles after insert or update or delete on public.user_profiles
  for each row execute function public.audit_row_change();
create trigger audit_school_overrides after insert or update or delete on public.school_overrides
  for each row execute function public.audit_row_change();
create trigger audit_employees after insert or update or delete on public.employees
  for each row execute function public.audit_row_change();
create trigger audit_employee_private after insert or update or delete on public.employee_private
  for each row execute function public.audit_row_change();
create trigger audit_employee_ratings after insert or update or delete on public.employee_ratings
  for each row execute function public.audit_row_change();
create trigger audit_monthly_plans after insert or update or delete on public.monthly_plans
  for each row execute function public.audit_row_change();
create trigger audit_monthly_plan_rows after insert or update or delete on public.monthly_plan_rows
  for each row execute function public.audit_row_change();
create trigger audit_general_plan_rows after insert or update or delete on public.general_plan_rows
  for each row execute function public.audit_row_change();
create trigger audit_cleaner_assignments after insert or update or delete on public.cleaner_assignments
  for each row execute function public.audit_row_change();
create trigger audit_gatekeeper_assignments after insert or update or delete on public.gatekeeper_assignments
  for each row execute function public.audit_row_change();
create trigger audit_reward_pools after insert or update or delete on public.reward_pools
  for each row execute function public.audit_row_change();
create trigger audit_reward_distributions after insert or update or delete on public.reward_distributions
  for each row execute function public.audit_row_change();
create trigger audit_kpi_scorecards after insert or update or delete on public.kpi_scorecards
  for each row execute function public.audit_row_change();

create or replace function public.audit_school_sync(p_record_count integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.current_app_role() <> 'admin' then
    raise exception 'Only administrators may record school synchronization';
  end if;
  if p_record_count < 0 then raise exception 'Record count must not be negative'; end if;
  insert into public.audit_log(actor_id, action, entity, details)
  values ((select auth.uid()), 'sync', 'schools', jsonb_build_object('record_count', p_record_count));
end;
$$;

revoke all on function public.audit_school_sync(integer) from public;
grant execute on function public.audit_school_sync(integer) to authenticated;

create or replace function public.reveal_employee_residence(p_employee_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  residence text;
begin
  if not public.is_privileged() then
    raise exception 'Insufficient privilege to reveal employee identity';
  end if;
  select residence_number into residence
  from public.employee_private where employee_id = p_employee_id;
  if not found then
    raise exception 'Employee identity data was not found';
  end if;
  insert into public.audit_log(actor_id, action, entity, entity_id, details)
  values ((select auth.uid()), 'reveal', 'employee_private', p_employee_id::text, '{"field":"residence_number"}'::jsonb);
  return residence;
end;
$$;

revoke all on function public.reveal_employee_residence(uuid) from public;
grant execute on function public.reveal_employee_residence(uuid) to authenticated;

create or replace function public.set_employee_residence(p_employee_id uuid, p_residence_number text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.current_app_role() <> 'admin' then
    raise exception 'Only administrators may update employee identity data';
  end if;
  insert into public.employee_private(employee_id, residence_number, updated_at)
  values (p_employee_id, p_residence_number, now())
  on conflict (employee_id) do update
  set residence_number = excluded.residence_number, updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.set_employee_residence(uuid, text) from public;
grant execute on function public.set_employee_residence(uuid, text) to authenticated;

create or replace function public.audit_employee_export(p_record_count integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_privileged() then
    raise exception 'Only privileged staff may export employee data';
  end if;
  if p_record_count < 0 then
    raise exception 'Record count must not be negative';
  end if;
  insert into public.audit_log(actor_id, action, entity, details)
  values ((select auth.uid()), 'export', 'employees', jsonb_build_object('record_count', p_record_count));
end;
$$;

revoke all on function public.audit_employee_export(integer) from public;
grant execute on function public.audit_employee_export(integer) to authenticated;

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.user_profiles(id),
  updated_at timestamptz not null default now()
);

create table public.user_preferences (
  user_id uuid primary key references public.user_profiles(id) on delete cascade,
  numerals text not null default 'latin' check (numerals in ('latin', 'arabic_indic')),
  date_format text not null default 'dd/mm/yyyy' check (date_format in ('dd/mm/yyyy', 'yyyy/mm/dd')),
  rows_per_page integer not null default 25 check (rows_per_page in (10, 25, 50, 100)),
  updated_at timestamptz not null default now()
);

create trigger audit_app_settings after insert or update or delete on public.app_settings
  for each row execute function public.audit_row_change();
create trigger audit_user_preferences after insert or update or delete on public.user_preferences
  for each row execute function public.audit_row_change();

alter table public.user_profiles enable row level security;
alter table public.schools enable row level security;
alter table public.school_overrides enable row level security;
alter table public.employees enable row level security;
alter table public.employee_private enable row level security;
alter table public.employee_ratings enable row level security;
alter table public.monthly_plans enable row level security;
alter table public.monthly_plan_rows enable row level security;
alter table public.general_plan_rows enable row level security;
alter table public.cleaner_assignments enable row level security;
alter table public.gatekeeper_assignments enable row level security;
alter table public.reward_pools enable row level security;
alter table public.reward_distributions enable row level security;
alter table public.kpi_scorecards enable row level security;
alter table public.audit_log enable row level security;
alter table public.app_settings enable row level security;
alter table public.user_preferences enable row level security;

create policy "users read own profile" on public.user_profiles
  for select to authenticated using (id = (select auth.uid()) or public.is_privileged());
create policy "admins manage profiles" on public.user_profiles
  for all to authenticated using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');
create policy "users update own contact details" on public.user_profiles
  for update to authenticated using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "authenticated read schools" on public.schools
  for select to authenticated using (true);
create policy "admins manage schools" on public.schools
  for all to authenticated using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy "authenticated read school overrides" on public.school_overrides
  for select to authenticated using (true);
create policy "authorized staff manage overrides" on public.school_overrides
  for all to authenticated using (public.current_app_role() in ('admin', 'project_manager', 'area_engineer'))
  with check (public.current_app_role() in ('admin', 'project_manager', 'area_engineer'));

create policy "authenticated read employees" on public.employees
  for select to authenticated using (
    public.current_app_role() in ('admin', 'project_manager')
    or (
      public.current_app_role() = 'area_engineer'
      and manager_id = (select employee_id from public.user_profiles where id = (select auth.uid()))
    )
    or (
      public.current_app_role() = 'supervisor'
      and id = (select employee_id from public.user_profiles where id = (select auth.uid()))
    )
  );
create policy "managers maintain employees" on public.employees
  for all to authenticated using (public.current_app_role() in ('admin', 'project_manager'))
  with check (public.current_app_role() in ('admin', 'project_manager'));
create policy "ratings only privileged" on public.employee_ratings
  for all to authenticated using (public.is_privileged())
  with check (public.is_privileged());

create policy "authenticated read monthly plans" on public.monthly_plans
  for select to authenticated using (true);
create policy "plan creators manage plans" on public.monthly_plans
  for all to authenticated using (
    (created_by = (select auth.uid()) and public.current_app_role() = 'area_engineer')
    or public.current_app_role() in ('admin', 'project_manager')
  )
  with check (
    (created_by = (select auth.uid()) and public.current_app_role() = 'area_engineer')
    or public.current_app_role() in ('admin', 'project_manager')
  );
create policy "authenticated read monthly rows" on public.monthly_plan_rows
  for select to authenticated using (true);
create policy "authorized staff update monthly rows" on public.monthly_plan_rows
  for all to authenticated using (
    public.current_app_role() in ('admin', 'project_manager', 'report_follower')
    or exists (
      select 1 from public.monthly_plans p
      where p.id = plan_id and p.created_by = (select auth.uid())
    )
  )
  with check (
    public.current_app_role() in ('admin', 'project_manager', 'report_follower')
    or exists (
      select 1 from public.monthly_plans p
      where p.id = plan_id and p.created_by = (select auth.uid())
    )
  );

create policy "authenticated read general plans" on public.general_plan_rows
  for select to authenticated using (true);
create policy "authorized staff manage general plans" on public.general_plan_rows
  for all to authenticated using (
    created_by = (select auth.uid())
    or public.current_app_role() in ('admin', 'project_manager')
  )
  with check (
    created_by = (select auth.uid())
    or public.current_app_role() in ('admin', 'project_manager')
  );

create policy "authenticated read cleaner assignments" on public.cleaner_assignments
  for select to authenticated using (true);
create policy "authorized staff manage cleaner assignments" on public.cleaner_assignments
  for all to authenticated using (public.current_app_role() in ('admin', 'project_manager', 'area_engineer'))
  with check (public.current_app_role() in ('admin', 'project_manager', 'area_engineer'));
create policy "authenticated read gatekeepers" on public.gatekeeper_assignments
  for select to authenticated using (true);
create policy "authorized staff manage gatekeepers" on public.gatekeeper_assignments
  for all to authenticated using (public.current_app_role() in ('admin', 'project_manager', 'area_engineer'))
  with check (public.current_app_role() in ('admin', 'project_manager', 'area_engineer'));

create policy "users read reward pools by role" on public.reward_pools
  for select to authenticated using (
    public.is_privileged() or engineer_id = (select auth.uid())
  );
create policy "pm sets reward pools" on public.reward_pools
  for all to authenticated using (public.current_app_role() in ('admin', 'project_manager'))
  with check (public.current_app_role() in ('admin', 'project_manager'));
create policy "users read their distributions" on public.reward_distributions
  for select to authenticated using (
    public.is_privileged() or exists (
      select 1 from public.reward_pools p
      where p.id = pool_id and p.engineer_id = (select auth.uid())
    )
  );
create policy "engineers manage own distributions" on public.reward_distributions
  for all to authenticated using (
    public.current_app_role() in ('admin', 'project_manager')
    or exists (select 1 from public.reward_pools p where p.id = pool_id and p.engineer_id = (select auth.uid()) and p.locked_at is null)
  )
  with check (
    public.current_app_role() in ('admin', 'project_manager')
    or (
      created_by = (select auth.uid())
      and exists (select 1 from public.reward_pools p where p.id = pool_id and p.engineer_id = (select auth.uid()) and p.locked_at is null)
    )
  );

create policy "authenticated read scorecards" on public.kpi_scorecards
  for select to authenticated using (true);
create policy "authorized staff manage scorecards" on public.kpi_scorecards
  for all to authenticated using (public.current_app_role() in ('admin', 'project_manager', 'area_engineer'))
  with check (public.current_app_role() in ('admin', 'project_manager', 'area_engineer'));

create policy "privileged read audit log" on public.audit_log
  for select to authenticated using (public.is_privileged());
create policy "admin manage settings" on public.app_settings
  for all to authenticated using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');
create policy "authenticated read plan eligibility" on public.app_settings
  for select to authenticated using (key = 'plan_eligibility');
create policy "users manage own preferences" on public.user_preferences
  for all to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

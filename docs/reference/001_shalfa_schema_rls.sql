-- =====================================================================
-- منصة إدارة مشروع إدارة المرافق المدرسية | شركة شلفا لإدارة المرافق
-- Migration 001: schema + Row Level Security (Supabase / PostgreSQL 15+)
--
-- Run once in Supabase SQL Editor (or as supabase/migrations/001_*.sql).
-- Principles:
--   * Default deny: RLS enabled on every table, anon has no access at all.
--   * Roles live in public.profiles.role (never trust the client).
--   * Sensitive columns (residence numbers) are NOT selectable by the API;
--     they are revealed only through reveal_residence() which audits access.
--   * Employee ratings live in their own table, PM/admin only.
--
-- IMPORTANT for the frontend: never use select('*') on employees or
-- gatekeepers; list the columns explicitly (residence_no is column-protected).
--
-- First admin: sign up the user, then in the SQL Editor run:
--   update public.profiles set role = 'admin' where username = 'your_username';
-- (the guard trigger allows this because auth.uid() is null in the editor)
-- =====================================================================

-- ---------- 0. Enums --------------------------------------------------
create type public.user_role as enum
  ('admin','project_manager','area_engineer','report_follower','supervisor','viewer');
create type public.employee_category as enum
  ('engineer','supervisor','admin_staff','technician','driver','cleaner');
create type public.labour_source as enum ('org_structure','ajeer');
create type public.plan_type as enum
  ('maintenance','cleaning','security_safety','elevators');
create type public.general_plan_type as enum
  ('gardening','landscaping','sewage_removal','tank_washing','pest_control','annual_readiness');
create type public.work_status as enum ('planned','in_progress','done','cancelled');
create type public.reward_status as enum ('open','approved');
create type public.kpi_card as enum ('CM','OM','HS','SS');
create type public.kpi_month_status as enum ('draft','submitted','approved');
create type public.checklist_status as enum ('done','in_progress','not_started','not_applicable');
create type public.deliverable_status as enum ('not_delivered','delivered_pending','approved');

-- ---------- 1. Generic helpers ----------------------------------------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- ---------- 2. Profiles (1:1 with auth.users) -------------------------
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      text not null unique
                  check (username ~ '^[a-z0-9._-]{3,32}$'),
  full_name     text,
  role          public.user_role not null default 'viewer',
  active        boolean not null default true,
  employee_id   uuid,                       -- FK added after employees exists
  phone         text,
  contact_email text,
  prefs         jsonb not null default '{"numerals":"latin","date_format":"gregorian","page_size":25}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Create the profile automatically; username comes from sign-up metadata.
-- The app signs users up with email  <username>@shalfa.local  (never shown).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, full_name)
  values (
    new.id,
    lower(coalesce(new.raw_user_meta_data->>'username', split_part(new.email,'@',1))),
    new.raw_user_meta_data->>'full_name'
  );
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 3. Role helpers (SECURITY DEFINER, no RLS recursion) ------
create or replace function public.current_user_role() returns public.user_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.has_role(variadic roles public.user_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_user_role() = any(roles), false)
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_user_role() is not null
$$;

create or replace function public.my_employee_id() returns uuid
language sql stable security definer set search_path = public as $$
  select employee_id from public.profiles where id = auth.uid() and active
$$;

-- ---------- 4. App settings (single row) ------------------------------
create table public.app_settings (
  id                     int primary key default 1 check (id = 1),
  contract_signing_date  date not null default '2026-07-01',
  site_handover_date     date not null default '2026-07-01',
  contract_start_date    date not null default '2026-07-01',
  kpi_grace_months       int  not null default 3,
  sheet_id               text not null default '1RQo06DqRHv24M8bh1CmJbOl4c_GmoLPXKkHK_sVIoI8',
  sheet_tab              text,
  sync_interval_minutes  int  not null default 60 check (sync_interval_minutes >= 5),
  schools_last_synced_at timestamptz,
  default_work_order     text default 'TBC005754 & TBC006484',
  default_region         text default 'المنطقة الوسطى',
  default_contractor     text default 'شركة شلفا لادارة المرافق',
  updated_at             timestamptz not null default now()
);
insert into public.app_settings (id) values (1);
create trigger app_settings_touch before update on public.app_settings
  for each row execute function public.touch_updated_at();

-- ---------- 5. Schools (mirror of the Google Sheet) -------------------
create table public.schools (
  id                      uuid primary key default gen_random_uuid(),
  ministry_no             text not null unique,            -- الرقم الوزاري
  name                    text not null,
  region                  text,
  neighbourhood           text,                            -- الحي
  building_type           text,        -- raw value from the sheet (independent / shared ...)
  plan_scope              boolean not null default true,   -- independent + primary shared => true
  class_count             int check (class_count is null or class_count >= 0),
  size_source             text check (size_source in ('small','medium','large')), -- normalised from the sheet by the sync
  size_calc               text generated always as (
                            case when class_count is null then null
                                 when class_count <= 12 then 'small'
                                 when class_count <= 21 then 'medium'
                                 else 'large' end) stored,
  lat                     numeric(9,6) check (lat between -90 and 90),
  lng                     numeric(9,6) check (lng between -180 and 180),
  has_elevator_contractor boolean not null default false,
  extra                   jsonb not null default '{}',     -- every other sheet column, shown in the map popup
  synced_at               timestamptz not null default now(),
  created_at              timestamptz not null default now()
);
create index schools_neigh_idx on public.schools (neighbourhood);

-- ---------- 6. Employees (+ protected columns) ------------------------
create table public.employees (
  id           uuid primary key default gen_random_uuid(),
  full_name    text not null,
  employee_no  text unique,                  -- الرقم الوظيفي
  residence_no text,                         -- رقم الإقامة  (column-protected, see §17)
  job_title    text,
  department   text,
  category     public.employee_category not null,
  manager_id   uuid references public.employees(id) on delete set null,
  phone        text,
  nationality  text,
  hire_date    date,
  status       text not null default 'active' check (status in ('active','inactive','terminated')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (manager_id is distinct from id)
);
create index employees_manager_idx on public.employees (manager_id);
create trigger employees_touch before update on public.employees
  for each row execute function public.touch_updated_at();

alter table public.profiles
  add constraint profiles_employee_fk
  foreign key (employee_id) references public.employees(id) on delete set null;

-- Team = me + everyone below me in the manager_id tree (cycle-safe).
create or replace function public.is_in_my_team(emp uuid) returns boolean
language sql stable security definer set search_path = public as $$
  with recursive team(id) as (
    select public.my_employee_id()
    union
    select e.id from public.employees e join team t on e.manager_id = t.id
  )
  select exists (select 1 from team where id = emp)
$$;

-- Ratings: PM / admin only (separate table = enforced isolation)
create table public.employee_ratings (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  rating      numeric(5,2) check (rating between 0 and 100),
  notes       text,
  updated_by  uuid references auth.users(id),
  updated_at  timestamptz not null default now()
);

-- ---------- 7. Workforce placement ------------------------------------
create table public.cleaner_assignments (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools(id) on delete cascade,
  employee_id   uuid not null unique references public.employees(id) on delete cascade, -- a cleaner serves one school
  labour_source public.labour_source not null default 'org_structure',
  assigned_on   date not null default current_date,
  created_at    timestamptz not null default now()
);
create index cleaner_assign_school_idx on public.cleaner_assignments (school_id);

create or replace function public.check_cleaner_category() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.employees where id = new.employee_id and category = 'cleaner') then
    raise exception 'الموظف المختار ليس عامل نظافة';
  end if;
  return new;
end $$;
create trigger cleaner_assign_check before insert or update on public.cleaner_assignments
  for each row execute function public.check_cleaner_category();

-- Occasional per-school exceptions (the contract standard itself is not editable)
create table public.staffing_exceptions (
  school_id      uuid primary key references public.schools(id) on delete cascade,
  required_count int not null check (required_count between 0 and 10),
  reason         text not null check (length(btrim(reason)) > 0),
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now()
);

create table public.gatekeepers (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null unique references public.schools(id) on delete cascade,
  full_name    text not null,
  phone        text,
  residence_no text,                          -- column-protected, see §17
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger gatekeepers_touch before update on public.gatekeepers
  for each row execute function public.touch_updated_at();

-- Required vs assigned cleaners.  1-12 => 1, 13-21 => 2, >21 => 3.
create view public.school_staffing with (security_invoker = true) as
select s.id as school_id, s.ministry_no, s.name, s.neighbourhood, s.class_count,
       s.size_source, s.size_calc,
       (s.size_source is not null and s.size_calc is not null and s.size_source <> s.size_calc) as size_corrected,
       coalesce(x.required_count,
                case s.size_calc when 'small' then 1 when 'medium' then 2 when 'large' then 3 end) as required,
       x.required_count is not null as has_exception,
       count(a.id)::int as assigned,
       greatest(coalesce(x.required_count,
                case s.size_calc when 'small' then 1 when 'medium' then 2 when 'large' then 3 end) - count(a.id), 0)::int as shortage,
       greatest(count(a.id) - coalesce(x.required_count,
                case s.size_calc when 'small' then 1 when 'medium' then 2 when 'large' then 3 end), 0)::int as surplus
from public.schools s
left join public.staffing_exceptions x on x.school_id = s.id
left join public.cleaner_assignments a on a.school_id = s.id
where s.plan_scope
group by s.id, x.required_count;

-- ---------- 8. Monthly plans ------------------------------------------
create table public.monthly_plans (
  id         uuid primary key default gen_random_uuid(),
  plan_type  public.plan_type not null,
  month      date not null check (month = date_trunc('month', month)::date),
  created_by uuid references auth.users(id) default auth.uid(),
  notes      text,
  created_at timestamptz not null default now(),
  unique (plan_type, month)
);

create table public.monthly_plan_rows (
  id               uuid primary key default gen_random_uuid(),
  plan_id          uuid not null references public.monthly_plans(id) on delete cascade,
  school_id        uuid not null references public.schools(id) on delete restrict,
  planned_date     date not null,
  engineer_id      uuid references public.employees(id) on delete set null,
  supervisor_id    uuid references public.employees(id) on delete set null,
  visited          boolean not null default false,
  visited_date     date,
  report_done      boolean not null default false,
  report_done_date date,
  notes            text,
  updated_at       timestamptz not null default now(),
  unique (plan_id, school_id),
  check (visited or visited_date is null),
  check (report_done or report_done_date is null)
);
create index plan_rows_plan_idx on public.monthly_plan_rows (plan_id, planned_date);
create index plan_rows_sup_idx on public.monthly_plan_rows (supervisor_id);
create trigger plan_rows_touch before update on public.monthly_plan_rows
  for each row execute function public.touch_updated_at();

-- report_follower may only tick visited / report fields
create or replace function public.guard_plan_row_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.current_user_role() = 'report_follower' then
    if (new.plan_id, new.school_id, new.planned_date, new.engineer_id, new.supervisor_id)
       is distinct from (old.plan_id, old.school_id, old.planned_date, old.engineer_id, old.supervisor_id) then
      raise exception 'غير مصرح: متابع التقارير يستطيع تحديث حالة الزيارة والتقرير فقط';
    end if;
  end if;
  return new;
end $$;
create trigger plan_rows_guard before update on public.monthly_plan_rows
  for each row execute function public.guard_plan_row_update();

create view public.plan_row_status with (security_invoker = true) as
select r.*, p.plan_type, p.month,
       (r.planned_date < current_date and not (r.visited and r.report_done)) as is_overdue
from public.monthly_plan_rows r join public.monthly_plans p on p.id = r.plan_id;

-- Per supervisor ranking (most late / most compliant)
create view public.supervisor_plan_stats with (security_invoker = true) as
select p.plan_type, p.month, r.supervisor_id,
       count(*)::int as total,
       count(*) filter (where r.visited)::int as visited,
       count(*) filter (where r.report_done)::int as reports_done,
       count(*) filter (where r.planned_date < current_date and not (r.visited and r.report_done))::int as overdue
from public.monthly_plan_rows r join public.monthly_plans p on p.id = r.plan_id
group by p.plan_type, p.month, r.supervisor_id;

-- ---------- 9. General plans ------------------------------------------
create table public.general_plans (
  id         uuid primary key default gen_random_uuid(),
  plan_type  public.general_plan_type not null,
  year       int not null check (year between 2024 and 2100),
  title      text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique (plan_type, year)
);
create table public.general_plan_rows (
  id             uuid primary key default gen_random_uuid(),
  plan_id        uuid not null references public.general_plans(id) on delete cascade,
  school_id      uuid references public.schools(id) on delete restrict,
  planned_date   date,
  execution_date date,
  status         public.work_status not null default 'planned',
  notes          text,
  updated_at     timestamptz not null default now()
);
create index gp_rows_plan_idx on public.general_plan_rows (plan_id);
create trigger gp_rows_touch before update on public.general_plan_rows
  for each row execute function public.touch_updated_at();

-- ---------- 10. Technician rewards ------------------------------------
create table public.reward_pools (
  id          uuid primary key default gen_random_uuid(),
  engineer_id uuid not null references public.employees(id) on delete cascade,
  month       date not null check (month = date_trunc('month', month)::date),
  amount      numeric(12,2) not null check (amount >= 0),
  status      public.reward_status not null default 'open',
  set_by      uuid references auth.users(id) default auth.uid(),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  unique (engineer_id, month)
);
create table public.reward_allocations (
  id          uuid primary key default gen_random_uuid(),
  pool_id     uuid not null references public.reward_pools(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  amount      numeric(12,2) not null check (amount >= 0),
  note        text,
  updated_at  timestamptz not null default now(),
  unique (pool_id, employee_id)
);
create trigger reward_alloc_touch before update on public.reward_allocations
  for each row execute function public.touch_updated_at();

-- Block over-allocation, locked months, and people outside the engineer's team
create or replace function public.guard_reward_allocation() returns trigger
language plpgsql security definer set search_path = public as $$
declare p public.reward_pools; allocated numeric;
begin
  select * into p from public.reward_pools where id = new.pool_id;
  if p.status = 'approved' and not public.has_role('admin','project_manager') then
    raise exception 'الشهر معتمد ومقفل';
  end if;
  if not exists (
    with recursive team(id) as (
      select p.engineer_id
      union select e.id from public.employees e join team t on e.manager_id = t.id)
    select 1 from team where id = new.employee_id) then
    raise exception 'الفني ليس ضمن فريق هذا المهندس';
  end if;
  select coalesce(sum(amount),0) into allocated
    from public.reward_allocations where pool_id = new.pool_id and id is distinct from new.id;
  if allocated + new.amount > p.amount then
    raise exception 'إجمالي التوزيع (%) يتجاوز المبلغ المتاح (%)', allocated + new.amount, p.amount;
  end if;
  return new;
end $$;
create trigger reward_alloc_guard before insert or update on public.reward_allocations
  for each row execute function public.guard_reward_allocation();

create or replace function public.guard_reward_pool() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.amount < (select coalesce(sum(amount),0) from public.reward_allocations where pool_id = new.id) then
    raise exception 'المبلغ أقل من المُوزَّع فعليًا';
  end if;
  if tg_op = 'UPDATE' and new.status = 'approved' and old.status <> 'approved' then
    new.approved_by := auth.uid(); new.approved_at := now();
  end if;
  return new;
end $$;
create trigger reward_pool_guard before insert or update on public.reward_pools
  for each row execute function public.guard_reward_pool();

-- ---------- 11. KPI reference + monthly scorecards --------------------
create table public.kpi_card_weights (
  card   public.kpi_card primary key,
  weight numeric(4,3) not null check (weight between 0 and 1)
);
insert into public.kpi_card_weights values ('CM',0.10),('OM',0.15),('HS',0.30),('SS',0.45);

-- Filled by scripts/seed-kpi.ts from the official workbook
create table public.kpi_indicators (
  code               text primary key,                 -- e.g. HS.4
  card               public.kpi_card not null,
  seq                int not null,
  name               text not null,
  importance         text,
  frequency          text not null default 'monthly' check (frequency in ('monthly','quarterly','annual')),
  description        text,
  formula_text       text,
  target_text        text,
  source_ref         text,
  required_data      text,
  default_applicable boolean not null default true,
  unique (card, seq)
);

create table public.kpi_months (
  id             uuid primary key default gen_random_uuid(),
  month          date not null check (month = date_trunc('month', month)::date),
  work_order     text not null,
  project_no     text default 'All',
  region         text,
  contractor     text,
  contract_month int check (contract_month >= 1),
  invoice_value  numeric(14,2) check (invoice_value is null or invoice_value >= 0),
  status         public.kpi_month_status not null default 'draft',
  approved_by    uuid references auth.users(id),
  approved_at    timestamptz,
  created_at     timestamptz not null default now(),
  unique (month, work_order)
);

create table public.kpi_entries (
  id             uuid primary key default gen_random_uuid(),
  kpi_month_id   uuid not null references public.kpi_months(id) on delete cascade,
  indicator_code text not null references public.kpi_indicators(code),
  applicable     boolean not null default true,
  numerator      numeric,
  denominator    numeric,
  extra          jsonb not null default '{}',         -- indicator-specific inputs (e.g. NCR count)
  score          numeric(6,5) check (score between 0 and 1),   -- computed by the tested formula registry
  notes          text,
  updated_at     timestamptz not null default now(),
  unique (kpi_month_id, indicator_code)
);
create trigger kpi_entries_touch before update on public.kpi_entries
  for each row execute function public.touch_updated_at();

create table public.kpi_penalty_types (
  code        text primary key,
  card        public.kpi_card not null,
  title       text not null,
  rule_text   text,
  unit_amount numeric(12,2)                           -- from the workbook; null = variable rule
);
create table public.kpi_penalty_entries (
  id            uuid primary key default gen_random_uuid(),
  kpi_month_id  uuid not null references public.kpi_months(id) on delete cascade,
  penalty_code  text not null references public.kpi_penalty_types(code),
  cases         int not null default 0 check (cases >= 0),
  amount        numeric(14,2) not null default 0 check (amount >= 0),
  notes         text,
  unique (kpi_month_id, penalty_code)
);

-- Discount matrix (مصفوفة الخصومات): payable factor by contract month bucket and score band
create table public.kpi_discount_matrix (
  bucket   text not null check (bucket in ('m1','m2','m3','m4_6','m7_plus')),
  band_min numeric(4,3) not null check (band_min between 0 and 1),
  factor   numeric(4,3) not null check (factor between 0 and 1),
  primary key (bucket, band_min)
);
insert into public.kpi_discount_matrix (bucket, band_min, factor) values
 ('m1',0.95,1),('m1',0.90,1),('m1',0.85,1),('m1',0.80,1),('m1',0.75,1),('m1',0.70,1),('m1',0,1),
 ('m2',0.95,1),('m2',0.90,1),('m2',0.85,1),('m2',0.80,1),('m2',0.75,1),('m2',0.70,0.975),('m2',0,0.975),
 ('m3',0.95,1),('m3',0.90,1),('m3',0.85,1),('m3',0.80,0.95),('m3',0.75,0.95),('m3',0.70,0.95),('m3',0,0.95),
 ('m4_6',0.95,1),('m4_6',0.90,1),('m4_6',0.85,0.98),('m4_6',0.80,0.95),('m4_6',0.75,0.94),('m4_6',0.70,0.92),('m4_6',0,0.90),
 ('m7_plus',0.95,1),('m7_plus',0.90,0.99),('m7_plus',0.85,0.96),('m7_plus',0.80,0.94),('m7_plus',0.75,0.90),('m7_plus',0.70,0.85),('m7_plus',0,0.80);

create or replace function public.kpi_month_bucket(p_contract_month int) returns text
language sql immutable as $$
  select case when p_contract_month <= 1 then 'm1' when p_contract_month = 2 then 'm2'
              when p_contract_month = 3 then 'm3' when p_contract_month <= 6 then 'm4_6'
              else 'm7_plus' end
$$;

-- p_score is a fraction (0.9286 = 92.86%)
create or replace function public.kpi_discount_factor(p_contract_month int, p_score numeric) returns numeric
language sql stable as $$
  select factor from public.kpi_discount_matrix
  where bucket = public.kpi_month_bucket(p_contract_month) and band_min <= p_score
  order by band_min desc limit 1
$$;

-- Contract month number from a calendar month (1 = first month of the contract)
create or replace function public.contract_month_of(p_month date) returns int
language sql stable as $$
  select ((extract(year from p_month)::int - extract(year from s.contract_start_date)::int) * 12
        + extract(month from p_month)::int - extract(month from s.contract_start_date)::int + 1)
  from public.app_settings s
$$;

-- Card scores = average of applicable indicator scores; total = sum(card score * weight).
-- VERIFY against the official workbook before relying on it (cards with no applicable
-- indicator return null and are skipped in the sum).
create view public.kpi_card_scores with (security_invoker = true) as
select e.kpi_month_id, i.card, w.weight,
       avg(e.score) filter (where e.applicable) as card_score,
       avg(e.score) filter (where e.applicable) * w.weight as weighted
from public.kpi_entries e
join public.kpi_indicators i on i.code = e.indicator_code
join public.kpi_card_weights w on w.card = i.card
group by e.kpi_month_id, i.card, w.weight;

create view public.kpi_month_totals with (security_invoker = true) as
select m.id as kpi_month_id, m.month, m.work_order, m.status,
       coalesce(m.contract_month, public.contract_month_of(m.month)) as contract_month,
       sum(c.weighted) as total_score,
       public.kpi_discount_factor(coalesce(m.contract_month, public.contract_month_of(m.month)), sum(c.weighted)) as payable_factor,
       m.invoice_value,
       (select coalesce(sum(p.amount),0) from public.kpi_penalty_entries p where p.kpi_month_id = m.id) as direct_penalties
from public.kpi_months m
left join public.kpi_card_scores c on c.kpi_month_id = m.id
group by m.id;

-- Approved months are frozen
create or replace function public.guard_kpi_month_lock() returns trigger
language plpgsql security definer set search_path = public as $$
declare mid uuid; st public.kpi_month_status;
begin
  mid := case when tg_op = 'DELETE' then old.kpi_month_id else new.kpi_month_id end;
  select status into st from public.kpi_months where id = mid;
  if st = 'approved' and not public.has_role('admin') then
    raise exception 'بطاقة الشهر معتمدة ومقفلة';
  end if;
  return coalesce(new, old);
end $$;
create trigger kpi_entries_lock before insert or update or delete on public.kpi_entries
  for each row execute function public.guard_kpi_month_lock();
create trigger kpi_penalty_lock before insert or update or delete on public.kpi_penalty_entries
  for each row execute function public.guard_kpi_month_lock();

-- ---------- 12. Checklist CM/OM + 28 contractual deliverables ---------
create table public.checklist_items (
  id              uuid primary key default gen_random_uuid(),
  domain          text not null check (domain in ('CM','OM')),
  seq             int  not null,
  axis            text not null,
  item            text not null,
  contract_ref    text,
  evidence        text,
  frequency       text,
  owner           text,
  status          public.checklist_status not null default 'not_started',
  last_update     date,
  notes           text,
  is_recommendation boolean generated always as (contract_ref = 'توصية') stored,
  updated_at      timestamptz not null default now(),
  unique (domain, seq)
);
create trigger checklist_touch before update on public.checklist_items
  for each row execute function public.touch_updated_at();

create table public.deliverables (
  id            uuid primary key default gen_random_uuid(),
  seq           int not null unique,
  clause        text,
  title         text not null,
  due_basis     text,                 -- signing / site handover
  duration_days int,
  review_cycle  text,
  due_date      date,                 -- computed from app_settings dates + duration by the app
  status        public.deliverable_status not null default 'not_delivered',
  delivered_on  date,
  approved_on   date,
  notes         text,
  updated_at    timestamptz not null default now()
);
create trigger deliverables_touch before update on public.deliverables
  for each row execute function public.touch_updated_at();

create view public.deliverables_v with (security_invoker = true) as
select d.*, (d.due_date is not null and d.due_date < current_date and d.status = 'not_delivered') as is_late
from public.deliverables d;

-- ---------- 13. Attachments (evidence files) --------------------------
create table public.attachments (
  id           uuid primary key default gen_random_uuid(),
  entity       text not null check (entity in ('kpi_entry','checklist_item','deliverable','plan_row','general_plan_row','employee')),
  entity_id    uuid not null,
  storage_path text not null unique,
  file_name    text not null,
  mime_type    text not null check (mime_type in ('application/pdf','image/jpeg','image/png','image/webp',
                 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  size_bytes   int  not null check (size_bytes between 1 and 10485760),
  uploaded_by  uuid references auth.users(id) default auth.uid(),
  created_at   timestamptz not null default now()
);
create index attachments_entity_idx on public.attachments (entity, entity_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidence','evidence', false, 10485760,
  array['application/pdf','image/jpeg','image/png','image/webp',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;

-- ---------- 14. Audit log ---------------------------------------------
create table public.audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor      uuid default auth.uid(),
  action     text not null,
  table_name text,
  row_id     text,
  details    jsonb
);
create index audit_log_at_idx on public.audit_log (at desc);

create or replace function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare j jsonb := to_jsonb(coalesce(new, old));
begin
  insert into public.audit_log (action, table_name, row_id, details)
  values (tg_op, tg_table_name, coalesce(j->>'id', j->>'employee_id'),
          case tg_op when 'UPDATE' then jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new))
                     when 'DELETE' then jsonb_build_object('old', to_jsonb(old))
                     else jsonb_build_object('new', to_jsonb(new)) end);
  return coalesce(new, old);
end $$;

create trigger audit_profiles   after insert or update or delete on public.profiles
  for each row execute function public.audit_row_change();
create trigger audit_ratings    after insert or update or delete on public.employee_ratings
  for each row execute function public.audit_row_change();
create trigger audit_pools      after insert or update or delete on public.reward_pools
  for each row execute function public.audit_row_change();
create trigger audit_allocs     after insert or update or delete on public.reward_allocations
  for each row execute function public.audit_row_change();
create trigger audit_kpi_months after insert or update or delete on public.kpi_months
  for each row execute function public.audit_row_change();
create trigger audit_settings   after update on public.app_settings
  for each row execute function public.audit_row_change();

-- ---------- 15. Profile guard (username immutable, no self-promotion) -
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.username <> old.username then
    raise exception 'اسم المستخدم غير قابل للتغيير';
  end if;
  -- SQL editor / service role (auth.uid() is null) may bootstrap roles
  if auth.uid() is not null and not public.has_role('admin') then
    if new.role <> old.role or new.active <> old.active
       or new.employee_id is distinct from old.employee_id then
      raise exception 'غير مصرح بتغيير الدور أو الحالة أو الربط الوظيفي';
    end if;
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- ---------- 16. Reveal sensitive residence numbers (audited) ----------
create or replace function public.reveal_residence(p_kind text, p_ids uuid[])
returns table (id uuid, residence_no text)
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('admin','project_manager','area_engineer') then
    raise exception 'غير مصرح';
  end if;
  if coalesce(array_length(p_ids,1),0) > 500 then
    raise exception 'عدد كبير جدًا';
  end if;
  insert into public.audit_log (action, table_name, details)
  values ('REVEAL_RESIDENCE', p_kind, jsonb_build_object('count', coalesce(array_length(p_ids,1),0), 'ids', p_ids));

  if p_kind = 'employees' then
    return query select e.id, e.residence_no from public.employees e
      where e.id = any(p_ids)
        and (public.has_role('admin','project_manager') or public.is_in_my_team(e.id) or e.category = 'cleaner');
  elsif p_kind = 'gatekeepers' then
    return query select g.id, g.residence_no from public.gatekeepers g where g.id = any(p_ids);
  else
    raise exception 'نوع غير معروف';
  end if;
end $$;

-- ---------- 17. Privileges (default deny, column protection) ----------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- append-only audit log
revoke insert, update, delete on public.audit_log from authenticated;
-- profiles are created by trigger only
revoke insert on public.profiles from authenticated;
-- app_settings: never insert/delete from the API
revoke insert, delete on public.app_settings from authenticated;

-- Residence numbers: not readable through the API (use reveal_residence)
revoke select on public.employees from authenticated;
grant select (id, full_name, employee_no, job_title, department, category, manager_id,
              phone, nationality, hire_date, status, created_at, updated_at)
  on public.employees to authenticated;
revoke select on public.gatekeepers from authenticated;
grant select (id, school_id, full_name, phone, notes, created_at, updated_at)
  on public.gatekeepers to authenticated;

-- RLS helper functions + RPCs callable by signed-in users only
grant execute on function
  public.current_user_role(), public.has_role(public.user_role[]), public.is_member(),
  public.my_employee_id(), public.is_in_my_team(uuid),
  public.kpi_month_bucket(int), public.kpi_discount_factor(int, numeric), public.contract_month_of(date),
  public.reveal_residence(text, uuid[])
to authenticated;

-- ---------- 18. Row Level Security ------------------------------------
do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- profiles
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_role('admin','project_manager'));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.has_role('admin'))
  with check (id = auth.uid() or public.has_role('admin'));
create policy profiles_delete on public.profiles for delete to authenticated
  using (public.has_role('admin'));

-- app_settings
create policy settings_select on public.app_settings for select to authenticated using (public.is_member());
create policy settings_update on public.app_settings for update to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

-- schools (read: any member; write/sync: admin + PM)
create policy schools_select on public.schools for select to authenticated using (public.is_member());
create policy schools_write  on public.schools for all to authenticated
  using (public.has_role('admin','project_manager')) with check (public.has_role('admin','project_manager'));

-- employees: admin/PM all; others see their team; cleaners are visible to every member (placement view)
create policy employees_select on public.employees for select to authenticated
  using (public.has_role('admin','project_manager')
         or public.is_in_my_team(id)
         or (category = 'cleaner' and public.is_member()));
create policy employees_write on public.employees for all to authenticated
  using (public.has_role('admin','project_manager')) with check (public.has_role('admin','project_manager'));

-- ratings: PM + admin only
create policy ratings_all on public.employee_ratings for all to authenticated
  using (public.has_role('admin','project_manager')) with check (public.has_role('admin','project_manager'));

-- placement
create policy cleaner_assign_select on public.cleaner_assignments for select to authenticated using (public.is_member());
create policy cleaner_assign_write  on public.cleaner_assignments for all to authenticated
  using (public.has_role('admin','project_manager','area_engineer'))
  with check (public.has_role('admin','project_manager','area_engineer'));
create policy staff_exc_select on public.staffing_exceptions for select to authenticated using (public.is_member());
create policy staff_exc_write  on public.staffing_exceptions for all to authenticated
  using (public.has_role('admin','project_manager')) with check (public.has_role('admin','project_manager'));
create policy gatekeepers_select on public.gatekeepers for select to authenticated using (public.is_member());
create policy gatekeepers_write  on public.gatekeepers for all to authenticated
  using (public.has_role('admin','project_manager','area_engineer'))
  with check (public.has_role('admin','project_manager','area_engineer'));

-- monthly plans
create policy plans_select on public.monthly_plans for select to authenticated using (public.is_member());
create policy plans_write  on public.monthly_plans for all to authenticated
  using (public.has_role('admin','project_manager','area_engineer'))
  with check (public.has_role('admin','project_manager','area_engineer'));
create policy plan_rows_select on public.monthly_plan_rows for select to authenticated using (public.is_member());
create policy plan_rows_write  on public.monthly_plan_rows for insert to authenticated
  with check (public.has_role('admin','project_manager','area_engineer'));
create policy plan_rows_update on public.monthly_plan_rows for update to authenticated
  using (public.has_role('admin','project_manager','area_engineer','report_follower'))
  with check (public.has_role('admin','project_manager','area_engineer','report_follower'));
create policy plan_rows_delete on public.monthly_plan_rows for delete to authenticated
  using (public.has_role('admin','project_manager','area_engineer'));

-- general plans
create policy gplans_select on public.general_plans for select to authenticated using (public.is_member());
create policy gplans_write  on public.general_plans for all to authenticated
  using (public.has_role('admin','project_manager','area_engineer'))
  with check (public.has_role('admin','project_manager','area_engineer'));
create policy gp_rows_select on public.general_plan_rows for select to authenticated using (public.is_member());
create policy gp_rows_write  on public.general_plan_rows for all to authenticated
  using (public.has_role('admin','project_manager','area_engineer','report_follower'))
  with check (public.has_role('admin','project_manager','area_engineer','report_follower'));

-- rewards: engineer sees only his own pool and allocations
create policy pools_select on public.reward_pools for select to authenticated
  using (public.has_role('admin','project_manager') or engineer_id = public.my_employee_id());
create policy pools_write on public.reward_pools for all to authenticated
  using (public.has_role('admin','project_manager')) with check (public.has_role('admin','project_manager'));
create policy alloc_select on public.reward_allocations for select to authenticated
  using (public.has_role('admin','project_manager')
         or exists (select 1 from public.reward_pools p where p.id = pool_id and p.engineer_id = public.my_employee_id()));
create policy alloc_write on public.reward_allocations for all to authenticated
  using (public.has_role('admin','project_manager')
         or (public.has_role('area_engineer')
             and exists (select 1 from public.reward_pools p
                         where p.id = pool_id and p.engineer_id = public.my_employee_id() and p.status = 'open')))
  with check (public.has_role('admin','project_manager')
         or (public.has_role('area_engineer')
             and exists (select 1 from public.reward_pools p
                         where p.id = pool_id and p.engineer_id = public.my_employee_id() and p.status = 'open')));

-- KPI: admin + PM only (contains invoice values and penalties)
create policy kpi_weights_read on public.kpi_card_weights for select to authenticated using (public.has_role('admin','project_manager'));
create policy kpi_weights_write on public.kpi_card_weights for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));
create policy kpi_ind_read on public.kpi_indicators for select to authenticated using (public.has_role('admin','project_manager'));
create policy kpi_ind_write on public.kpi_indicators for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));
create policy kpi_matrix_read on public.kpi_discount_matrix for select to authenticated using (public.has_role('admin','project_manager'));
create policy kpi_matrix_write on public.kpi_discount_matrix for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));
create policy kpi_ptypes_read on public.kpi_penalty_types for select to authenticated using (public.has_role('admin','project_manager'));
create policy kpi_ptypes_write on public.kpi_penalty_types for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));
create policy kpi_months_all on public.kpi_months for all to authenticated
  using (public.has_role('admin','project_manager')) with check (public.has_role('admin','project_manager'));
create policy kpi_entries_all on public.kpi_entries for all to authenticated
  using (public.has_role('admin','project_manager')) with check (public.has_role('admin','project_manager'));
create policy kpi_pentries_all on public.kpi_penalty_entries for all to authenticated
  using (public.has_role('admin','project_manager')) with check (public.has_role('admin','project_manager'));

-- checklist + deliverables: read admin/PM/engineer, write admin/PM
create policy checklist_read on public.checklist_items for select to authenticated
  using (public.has_role('admin','project_manager','area_engineer'));
create policy checklist_write on public.checklist_items for all to authenticated
  using (public.has_role('admin','project_manager')) with check (public.has_role('admin','project_manager'));
create policy deliv_read on public.deliverables for select to authenticated
  using (public.has_role('admin','project_manager','area_engineer'));
create policy deliv_write on public.deliverables for all to authenticated
  using (public.has_role('admin','project_manager')) with check (public.has_role('admin','project_manager'));

-- attachments
create policy attach_select on public.attachments for select to authenticated
  using (public.has_role('admin','project_manager','area_engineer'));
create policy attach_insert on public.attachments for insert to authenticated
  with check (public.has_role('admin','project_manager','area_engineer') and uploaded_by = auth.uid());
create policy attach_delete on public.attachments for delete to authenticated
  using (public.has_role('admin','project_manager') or uploaded_by = auth.uid());

-- audit log: read only for admin + PM (no insert policy => only triggers/RPCs write)
create policy audit_select on public.audit_log for select to authenticated
  using (public.has_role('admin','project_manager'));

-- Storage: private bucket 'evidence'
create policy evidence_select on storage.objects for select to authenticated
  using (bucket_id = 'evidence' and public.has_role('admin','project_manager','area_engineer'));
create policy evidence_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'evidence' and public.has_role('admin','project_manager','area_engineer'));
create policy evidence_delete on storage.objects for delete to authenticated
  using (bucket_id = 'evidence' and public.has_role('admin','project_manager'));

-- =====================================================================
-- End of migration 001
-- Next: scripts/seed-kpi.ts fills kpi_indicators, kpi_penalty_types,
-- checklist_items and deliverables from the two reference workbooks.
-- =====================================================================

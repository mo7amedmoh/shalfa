-- Re-applies all employee_import functions from 202611280003_secure_employee_import.sql
-- with fix for: column reference "service" is ambiguous in employee_import_metrics().
-- Run this migration if 202611280003 was already applied to the database but had the
-- ambiguous-column bug, OR if 202611280003 was never applied (this file recreates all
-- functions safely using CREATE OR REPLACE).

create or replace function public.employee_import_digits(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select translate(
    coalesce(p_value, ''),
    '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
    '01234567890123456789'
  );
$$;

create or replace function public.employee_import_normalize_name(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select public.normalise_plan_name(
    regexp_replace(coalesce(p_value, ''), '[ًٌٍَُِّْٰـ]', '', 'g')
  );
$$;

create or replace function public.employee_import_is_true(p_value text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(btrim(coalesce(p_value, ''))) = any(array['yes', 'true', '1', 'نعم', 'ن'])
$$;

create or replace function public.employee_import_contains_words(p_short_name text, p_full_name text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select not exists (
    select 1
    from regexp_split_to_table(btrim(coalesce(p_short_name, '')), '[[:space:]]+') as short_words(short_word)
    where short_word <> ''
      and not exists (
        select 1
        from regexp_split_to_table(btrim(coalesce(p_full_name, '')), '[[:space:]]+') as full_words(full_word)
        where full_word = short_word
      )
  );
$$;

-- Fixed: qualify `service` with `services.service` to resolve ambiguity
create or replace function public.employee_import_metrics()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_object_agg(counts.service, jsonb_build_object(
    'supervisors', supervisor_count,
    'schools', school_count
  ))
  from (
    select services.service,
      count(distinct case when e.category = 'supervisor' then a.employee_id end)::integer as supervisor_count,
      count(distinct a.school_id)::integer as school_count
    from (values ('maintenance'::text), ('cleaning'::text)) services(service)
    left join public.school_supervisor_assignments a
      on a.service = services.service
      and a.valid_to is null
    left join public.employees e on e.id = a.employee_id
    group by services.service
  ) counts;
$$;

create or replace function public.employee_import_preview_row(
  p_row jsonb,
  p_ordinal integer,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee_no text := nullif(btrim(coalesce(p_row->>'employee_no', p_row->>'employee_number', '')), '');
  v_residence_raw text := nullif(btrim(coalesce(p_row->>'residence_no', p_row->>'residenceNumber', '')), '');
  v_residence text := public.employee_import_digits(v_residence_raw);
  v_phone_raw text := nullif(btrim(coalesce(p_row->>'phone', '')), '');
  v_phone text := public.employee_import_digits(v_phone_raw);
  v_name text := nullif(btrim(coalesce(p_row->>'full_name', '')), '');
  v_job_title text := nullif(btrim(coalesce(p_row->>'job_title', '')), '');
  v_category text := nullif(btrim(coalesce(p_row->>'category', p_row->>'employee_category', '')), '');
  v_department text := nullif(btrim(coalesce(p_row->>'department', '')), '');
  v_nationality text := nullif(btrim(coalesce(p_row->>'nationality', '')), '');
  v_status text := nullif(btrim(coalesce(p_row->>'status', '')), '');
  v_hire_date_text text := nullif(btrim(coalesce(p_row->>'hire_date', p_row->>'hireDate', '')), '');
  v_hire_date date;
  v_project_name text := nullif(btrim(coalesce(p_row->>'project_name', '')), '');
  v_manager_number text := nullif(btrim(coalesce(p_row->>'manager_number', p_row->>'managerNumber', '')), '');
  v_rating_text text := nullif(btrim(coalesce(p_row->>'rating', '')), '');
  v_rating numeric;
  v_review_name boolean := public.employee_import_is_true(p_row->>'review_name');
  v_errors jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_employee_ids uuid[] := '{}';
  v_residence_ids uuid[] := '{}';
  v_candidates jsonb := '[]'::jsonb;
  v_employee public.employees%rowtype;
  v_employee_id uuid;
  v_match_method text := null;
  v_name_kind text := 'same';
  v_name_default text;
  v_phone_valid boolean := false;
  v_residence_valid boolean := false;
  v_category_valid boolean := false;
  v_status_valid boolean := false;
  v_has_assignment boolean := false;
  v_has_profile boolean := false;
  v_role_confirmation boolean := false;
  v_name_changed boolean := false;
  v_name_default_changed boolean := false;
  v_title_changed boolean := false;
  v_category_changed boolean := false;
  v_department_changed boolean := false;
  v_phone_changed boolean := false;
  v_residence_changed boolean := false;
  v_status_changed boolean := false;
  v_nationality_changed boolean := false;
  v_hire_date_changed boolean := false;
  v_project_changed boolean := false;
  v_manager_changed boolean := false;
  v_rating_changed boolean := false;
  v_manager_old_employee_no text;
  v_field_diff jsonb := '{}'::jsonb;
  v_status_result text;
  v_fingerprint text;
  v_imported_name_normalized text;
  v_current_name_normalized text;
  v_duplicate_key boolean := false;
  v_duplicate_residence boolean := false;
begin
  if jsonb_typeof(p_row) is distinct from 'object' then
    v_errors := jsonb_build_array('صيغة الصف غير صالحة');
  end if;

  if v_name is null or length(v_name) < 2 or length(v_name) > 120 then
    v_errors := v_errors || jsonb_build_array('اسم الموظف مطلوب ويجب أن يكون بين حرفين و120 حرفًا');
  end if;
  if v_employee_no is not null and length(v_employee_no) > 60 then
    v_errors := v_errors || jsonb_build_array('الرقم الوظيفي يتجاوز 60 حرفًا');
  end if;
  if v_job_title is not null and length(v_job_title) > 120 then
    v_errors := v_errors || jsonb_build_array('المسمى الوظيفي يتجاوز 120 حرفًا');
  end if;
  if v_department is not null and length(v_department) > 120 then
    v_errors := v_errors || jsonb_build_array('القسم يتجاوز 120 حرفًا');
  end if;
  if v_category is null then
    v_errors := v_errors || jsonb_build_array('الفئة الوظيفية مطلوبة');
  else
    v_category_valid := v_category = any(array[
      'engineer', 'supervisor', 'admin_staff', 'technician', 'driver', 'cleaner', 'gatekeeper'
    ]);
    if not v_category_valid then
      v_errors := v_errors || jsonb_build_array('الفئة الوظيفية غير معروفة');
    end if;
  end if;
  if v_status is not null then
    v_status_valid := v_status = any(array['active', 'inactive', 'terminated']);
    if not v_status_valid then
      v_errors := v_errors || jsonb_build_array('حالة الموظف غير معروفة');
    end if;
  end if;
  if v_hire_date_text is not null then
    begin
      v_hire_date := v_hire_date_text::date;
      if to_char(v_hire_date, 'YYYY-MM-DD') <> v_hire_date_text then
        raise exception 'invalid date';
      end if;
    exception when others then
      v_errors := v_errors || jsonb_build_array('تاريخ التعيين غير صالح');
      v_hire_date := null;
    end;
  end if;
  if v_rating_text is not null then
    begin
      v_rating := v_rating_text::numeric;
      if v_rating < 0 or v_rating > 100 then
        raise exception 'invalid rating';
      end if;
    exception when others then
      v_errors := v_errors || jsonb_build_array('التقييم يجب أن يكون بين 0 و100');
      v_rating := null;
    end;
  end if;

  v_phone_valid := v_phone is not null and v_phone ~ '^05[0-9]{8}$';
  if v_phone_raw is not null and not v_phone_valid then
    v_warnings := v_warnings || jsonb_build_array('تم تجاهل رقم جوال غير صالح');
  end if;
  v_residence_valid := v_residence is not null and v_residence ~ '^[0-9]{10}$';
  if v_residence_raw is not null and not v_residence_valid then
    v_warnings := v_warnings || jsonb_build_array('تم تجاهل رقم إقامة غير صالح');
  end if;

  if v_employee_no is not null and exists (
    select 1
    from jsonb_array_elements(p_rows) with ordinality input_row(value, ordinal)
    where input_row.ordinal <> p_ordinal
      and nullif(btrim(coalesce(input_row.value->>'employee_no', input_row.value->>'employee_number', '')), '') = v_employee_no
  ) then
    v_duplicate_key := true;
  end if;
  if v_residence_valid and exists (
    select 1
    from jsonb_array_elements(p_rows) with ordinality input_row(value, ordinal)
    where input_row.ordinal <> p_ordinal
      and public.employee_import_digits(nullif(btrim(coalesce(input_row.value->>'residence_no', input_row.value->>'residenceNumber', '')), '')) = v_residence
  ) then
    v_duplicate_residence := true;
  end if;
  if v_duplicate_key or v_duplicate_residence then
    v_errors := v_errors || jsonb_build_array('مفتاح موظف مكرر داخل الملف');
  end if;

  if v_employee_no is not null then
    select coalesce(array_agg(e.id), '{}')
    into v_employee_ids
    from public.employees e
    where e.employee_no = v_employee_no;
  end if;
  if v_residence_valid then
    select coalesce(array_agg(e.id), '{}')
    into v_residence_ids
    from public.employees e
    where public.employee_import_digits(e.residence_no) = v_residence;
  end if;

  if cardinality(v_employee_ids) > 1 or cardinality(v_residence_ids) > 1
     or (cardinality(v_employee_ids) = 1 and cardinality(v_residence_ids) = 1
         and v_employee_ids[1] <> v_residence_ids[1]) then
    v_errors := v_errors || jsonb_build_array('مفتاح الرقم الوظيفي أو الإقامة يشير إلى سجلات متعارضة');
  elsif cardinality(v_employee_ids) = 1 then
    v_employee_id := v_employee_ids[1];
    v_match_method := 'employee_no';
  elsif cardinality(v_residence_ids) = 1 then
    v_employee_id := v_residence_ids[1];
    v_match_method := 'residence_no';
  end if;

  if v_employee_id is not null then
    select e.* into v_employee from public.employees e where e.id = v_employee_id;
    if v_match_method = 'residence_no'
       and v_employee_no is not null
       and v_employee.employee_no is distinct from v_employee_no then
      v_match_method := 'residence_no_needs_link';
      v_candidates := jsonb_build_array(jsonb_build_object(
        'id', v_employee.id,
        'full_name', v_employee.full_name,
        'employee_no', v_employee.employee_no,
        'job_title', v_employee.job_title,
        'category', v_employee.category
      ));
    end if;
  elsif jsonb_array_length(v_errors) = 0 and v_name is not null then
    v_imported_name_normalized := public.employee_import_normalize_name(v_name);
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', matches.id,
      'full_name', matches.full_name,
      'employee_no', matches.employee_no,
      'job_title', matches.job_title,
      'category', matches.category
    ) order by matches.full_name), '[]'::jsonb)
    into v_candidates
    from (
      select e.id, e.full_name, e.employee_no, e.job_title, e.category
      from public.employees e
      where (
        e.employee_no is null
        or upper(e.employee_no) like 'TEMP-%'
        or upper(e.employee_no) like 'Z6-%'
        or public.employee_import_digits(e.employee_no) ~ '^[0-9]{10}$'
      )
      and v_imported_name_normalized <> ''
      and public.employee_import_contains_words(
        v_imported_name_normalized,
        public.employee_import_normalize_name(e.full_name)
      )
    ) matches;
  end if;

  if v_employee_id is null and nullif(btrim(p_row->>'decision_employee_id'), '') is not null then
    begin
      v_employee_id := (p_row->>'decision_employee_id')::uuid;
    exception when others then
      v_employee_id := null;
      v_errors := v_errors || jsonb_build_array('معرّف المرشح المختار غير صالح');
    end;
    if v_employee_id is not null then
      if not exists (
        select 1
        from jsonb_array_elements(v_candidates) candidate(value)
        where candidate.value->>'id' = v_employee_id::text
      ) then
        v_employee_id := null;
        v_errors := v_errors || jsonb_build_array('الموظف المختار ليس من المرشحين');
      else
        v_match_method := 'name_candidate_link';
        select e.* into v_employee from public.employees e where e.id = v_employee_id;
      end if;
    end if;
  end if;

  if v_manager_number is not null then
    if not exists (
      select 1 from public.employees e where e.employee_no = v_manager_number
    ) and not exists (
      select 1
      from jsonb_array_elements(p_rows) input_row(value)
      where nullif(btrim(coalesce(input_row.value->>'employee_no', input_row.value->>'employee_number', '')), '') = v_manager_number
    ) then
      v_errors := v_errors || jsonb_build_array('تعذر العثور على المدير المرتبط بالرقم الوظيفي');
    end if;
  end if;

  if jsonb_array_length(v_errors) > 0 then
    v_status_result := 'conflict';
  elsif v_employee_id is null and jsonb_array_length(v_candidates) > 0 then
    v_status_result := 'needs_decision';
  elsif v_employee_id is null then
    v_status_result := 'new';
  else
    v_current_name_normalized := public.employee_import_normalize_name(v_employee.full_name);
    v_imported_name_normalized := public.employee_import_normalize_name(v_name);
    if v_current_name_normalized = v_imported_name_normalized then
      v_name_kind := 'same';
    elsif public.employee_import_contains_words(v_current_name_normalized, v_imported_name_normalized) then
      v_name_kind := 'completion';
    else
      v_name_kind := 'different';
    end if;

    v_name_changed := v_current_name_normalized is distinct from v_imported_name_normalized;
    v_name_default := v_employee.full_name;
    if not v_name_changed then
      v_name_default := v_employee.full_name;
    elsif v_review_name then
      if nullif(btrim(v_employee.full_name), '') is null or v_employee.full_name ~ '[A-Za-z]' then
        if v_name ~ '[ء-ي]' then v_name_default := v_name; end if;
      end if;
    elsif v_name_kind = 'completion' then
      v_name_default := v_name;
    end if;
    v_name_default_changed := v_name_default is distinct from v_employee.full_name;

    v_title_changed := v_job_title is not null and v_employee.job_title is distinct from v_job_title;
    v_category_changed := v_category is not null and v_employee.category::text is distinct from v_category;
    v_department_changed := v_department is not null and nullif(btrim(v_employee.department), '') is null;
    v_phone_changed := v_phone_valid and v_employee.phone is distinct from v_phone;
    v_residence_changed := v_residence_valid
      and public.employee_import_digits(v_employee.residence_no) is distinct from v_residence;
    v_status_changed := v_status is not null and v_employee.status is distinct from v_status;
    v_nationality_changed := v_nationality is not null and v_employee.nationality is distinct from v_nationality;
    v_hire_date_changed := v_hire_date is not null and v_employee.hire_date is distinct from v_hire_date;
    v_project_changed := v_project_name is not null and v_employee.project_name is distinct from v_project_name;

    select p.employee_no into v_manager_old_employee_no
    from public.employees p where p.id = v_employee.manager_id;
    v_manager_changed := v_manager_number is not null
      and v_manager_old_employee_no is distinct from v_manager_number;
    v_rating_changed := v_rating is not null and exists (
      select 1 from public.employee_ratings r
      where r.employee_id = v_employee.id and r.rating is distinct from v_rating
    );
    if v_rating is not null and not exists (
      select 1 from public.employee_ratings r where r.employee_id = v_employee.id
    ) then
      v_rating_changed := true;
    end if;

    v_has_assignment := exists (
      select 1 from public.school_supervisor_assignments a
      where a.employee_id = v_employee.id and a.valid_to is null
    );
    v_has_profile := exists (
      select 1 from public.profiles p where p.employee_id = v_employee.id
    );
    v_role_confirmation := (v_title_changed or v_category_changed) and (v_has_assignment or v_has_profile);

    v_field_diff := jsonb_build_object(
      'full_name', jsonb_build_object(
        'old', v_employee.full_name, 'new', v_name, 'changed', v_name_changed,
        'classification', v_name_kind,
        'default_action', case when v_name_default_changed then 'apply' else 'keep' end,
        'review_name', v_review_name
      ),
      'employee_no', jsonb_build_object(
        'old', v_employee.employee_no, 'new', v_employee_no,
        'changed', v_employee_no is not null and v_match_method in ('residence_no_needs_link', 'name_candidate_link'),
        'default_action', case when v_match_method in ('residence_no_needs_link', 'name_candidate_link') then 'link' else 'keep' end
      ),
      'job_title', jsonb_build_object(
        'old', v_employee.job_title, 'new', v_job_title, 'changed', v_title_changed,
        'has_active_school_assignment', v_has_assignment,
        'requires_confirmation', v_title_changed and (v_has_assignment or v_has_profile)
      ),
      'category', jsonb_build_object(
        'old', v_employee.category::text, 'new', v_category, 'changed', v_category_changed,
        'has_active_school_assignment', v_has_assignment,
        'requires_confirmation', v_category_changed and (v_has_assignment or v_has_profile)
      ),
      'department', jsonb_build_object(
        'old', v_employee.department, 'new', v_department,
        'changed', v_department_changed, 'default_action', 'fill_empty_only'
      ),
      'phone', jsonb_build_object('changed', v_phone_changed, 'valid', v_phone_valid),
      'residence_no', jsonb_build_object('changed', v_residence_changed, 'valid', v_residence_valid),
      'status', jsonb_build_object('old', v_employee.status, 'new', v_status, 'changed', v_status_changed),
      'nationality', jsonb_build_object('old', v_employee.nationality, 'new', v_nationality, 'changed', v_nationality_changed),
      'hire_date', jsonb_build_object('old', v_employee.hire_date, 'new', v_hire_date, 'changed', v_hire_date_changed),
      'project_name', jsonb_build_object('old', v_employee.project_name, 'new', v_project_name, 'changed', v_project_changed),
      'manager_id', jsonb_build_object(
        'old_employee_no', v_manager_old_employee_no, 'new_employee_no', v_manager_number,
        'changed', v_manager_changed
      ),
      'rating', jsonb_build_object(
        'old', (select r.rating from public.employee_ratings r where r.employee_id = v_employee.id),
        'new', v_rating, 'changed', v_rating_changed
      )
    );

    if v_match_method = 'name_candidate_link'
       or (v_name_kind = 'different' and not v_review_name)
       or (v_match_method = 'residence_no_needs_link')
       or v_role_confirmation then
      v_status_result := 'needs_decision';
    elsif v_name_default_changed or v_title_changed or v_category_changed
       or v_department_changed or v_phone_changed or v_residence_changed
       or v_status_changed or v_nationality_changed or v_hire_date_changed
       or v_project_changed or v_manager_changed or v_rating_changed then
      v_status_result := 'update';
    else
      v_status_result := 'no_change';
    end if;
  end if;

  if v_employee_id is null and v_status_result in ('new', 'needs_decision') then
    v_field_diff := jsonb_build_object(
      'full_name', jsonb_build_object('old', null, 'new', v_name, 'changed', v_name is not null, 'classification', 'new'),
      'employee_no', jsonb_build_object('old', null, 'new', v_employee_no, 'changed', v_employee_no is not null),
      'job_title', jsonb_build_object('old', null, 'new', v_job_title, 'changed', v_job_title is not null),
      'category', jsonb_build_object('old', null, 'new', v_category, 'changed', v_category is not null),
      'department', jsonb_build_object('old', null, 'new', v_department, 'changed', v_department is not null),
      'phone', jsonb_build_object('changed', v_phone_valid, 'valid', v_phone_valid),
      'residence_no', jsonb_build_object('changed', v_residence_valid, 'valid', v_residence_valid),
      'status', jsonb_build_object('old', null, 'new', coalesce(v_status, 'active'), 'changed', true),
      'nationality', jsonb_build_object('old', null, 'new', v_nationality, 'changed', v_nationality is not null),
      'hire_date', jsonb_build_object('old', null, 'new', v_hire_date, 'changed', v_hire_date is not null),
      'project_name', jsonb_build_object('old', null, 'new', 'الرياض', 'changed', true),
      'manager_id', jsonb_build_object('old_employee_no', null, 'new_employee_no', v_manager_number, 'changed', v_manager_number is not null),
      'rating', jsonb_build_object('old', null, 'new', v_rating, 'changed', v_rating is not null)
    );
  end if;

  if v_field_diff = '{}'::jsonb then
    v_field_diff := jsonb_build_object(
      'full_name', jsonb_build_object('changed', false),
      'employee_no', jsonb_build_object('changed', false),
      'job_title', jsonb_build_object('changed', false),
      'category', jsonb_build_object('changed', false),
      'department', jsonb_build_object('changed', false),
      'phone', jsonb_build_object('changed', v_phone_valid, 'valid', v_phone_valid),
      'residence_no', jsonb_build_object('changed', v_residence_valid, 'valid', v_residence_valid),
      'status', jsonb_build_object('changed', false),
      'nationality', jsonb_build_object('changed', false),
      'hire_date', jsonb_build_object('changed', false),
      'project_name', jsonb_build_object('changed', false),
      'manager_id', jsonb_build_object('changed', false),
      'rating', jsonb_build_object('changed', false)
    );
  end if;

  v_fingerprint := md5(jsonb_build_object(
    'ordinal', p_ordinal,
    'input', p_row - 'phone' - 'residence_no' - 'residenceNumber',
    'status', v_status_result,
    'employee_id', v_employee_id,
    'match_method', v_match_method,
    'candidates', v_candidates,
    'diff', v_field_diff,
    'errors', v_errors
  )::text);

  return jsonb_build_object(
    'row', p_ordinal,
    'fingerprint', v_fingerprint,
    'status', v_status_result,
    'match_method', v_match_method,
    'employee_id', v_employee_id,
    'employee_name', case when v_employee_id is not null then v_employee.full_name else null end,
    'employee_no', v_employee_no,
    'candidates', v_candidates,
    'diff', v_field_diff,
    'errors', v_errors,
    'warnings', v_warnings
  );
end;
$$;

create or replace function public.employee_import_preview(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb := '[]'::jsonb;
  v_row jsonb;
  v_result jsonb;
  v_ordinal integer;
  v_employee_id uuid;
begin
  if auth.uid() is null or not public.has_permission('workforce.import_employees') then
    raise exception 'غير مصرح بمعاينة استيراد الموظفين';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'بيانات الاستيراد يجب أن تكون قائمة صفوف';
  end if;
  if jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 2000 then
    raise exception 'ملف الاستيراد يجب أن يحتوي من صف واحد إلى 2000 صف';
  end if;

  for v_row, v_ordinal in
    select input_row.value, input_row.ordinal::integer
    from jsonb_array_elements(p_rows) with ordinality input_row(value, ordinal)
  loop
    v_result := public.employee_import_preview_row(v_row, v_ordinal, p_rows);
    v_rows := v_rows || jsonb_build_array(v_result);
  end loop;

  for v_ordinal in 0..(jsonb_array_length(v_rows) - 1) loop
    v_result := v_rows->v_ordinal;
    v_employee_id := nullif(v_result->>'employee_id', '')::uuid;
    if v_employee_id is not null and exists (
      select 1
      from jsonb_array_elements(v_rows) other_row(value)
      where other_row.value->>'employee_id' = v_employee_id::text
        and (other_row.value->>'row')::integer <> (v_result->>'row')::integer
    ) then
      v_result := jsonb_set(v_result, '{status}', to_jsonb('conflict'::text));
      v_result := jsonb_set(
        v_result,
        '{errors}',
        coalesce(v_result->'errors', '[]'::jsonb) || jsonb_build_array('أكثر من صف يطابق الموظف نفسه')
      );
      v_result := jsonb_set(
        v_result,
        '{fingerprint}',
        to_jsonb(md5((v_result->>'fingerprint') || ':duplicate_employee'))
      );
      v_rows := jsonb_set(v_rows, array[v_ordinal::text], v_result);
    end if;
  end loop;
  return jsonb_build_object('rows', v_rows);
end;
$$;

-- Grants
revoke all on function public.employee_import_digits(text) from public, anon, authenticated;
revoke all on function public.employee_import_normalize_name(text) from public, anon, authenticated;
revoke all on function public.employee_import_is_true(text) from public, anon, authenticated;
revoke all on function public.employee_import_contains_words(text, text) from public, anon, authenticated;
revoke all on function public.employee_import_metrics() from public, anon, authenticated;
revoke all on function public.employee_import_preview_row(jsonb, integer, jsonb) from public, anon, authenticated;
revoke all on function public.employee_import_preview(jsonb) from public, anon;
grant execute on function public.employee_import_preview(jsonb) to authenticated;

-- Ensure permission exists
insert into public.permissions (key, group_key, label_ar, description, enforced_in_db)
values (
  'workforce.import_employees',
  'workforce',
  'استيراد الموظفين',
  'معاينة وتطبيق استيراد بيانات الموظفين بأمان',
  true
)
on conflict (key) do update
set group_key = excluded.group_key,
    label_ar = excluded.label_ar,
    description = excluded.description,
    enforced_in_db = true;

insert into public.role_permissions(role_id, permission_key)
select r.id, 'workforce.import_employees'
from public.roles r
where r.key = 'project_manager'  -- admin role permissions are immutable (guarded by trigger)
on conflict do nothing;

notify pgrst, 'reload schema';

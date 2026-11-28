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
    regexp_replace(coalesce(p_value, ''), '[ًٌٍَُِّْٰـ]', '', 'g')
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

create or replace function public.employee_import_metrics()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_object_agg(service, jsonb_build_object(
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

create or replace function public.employee_import_apply(p_rows jsonb, p_decisions jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_preview jsonb;
  v_row_preview jsonb;
  v_input jsonb;
  v_decision jsonb;
  v_status text;
  v_action text;
  v_employee_id uuid;
  v_employee_no text;
  v_residence text;
  v_phone text;
  v_name text;
  v_job_title text;
  v_category text;
  v_department text;
  v_nationality text;
  v_hire_date date;
  v_status_value text;
  v_project_name text;
  v_manager_number text;
  v_manager_id uuid;
  v_rating numeric;
  v_review_name boolean;
  v_confirm_job_title boolean;
  v_confirm_category boolean;
  v_use_imported_name boolean;
  v_preview_diff jsonb;
  v_current public.employees%rowtype;
  v_updated public.employees%rowtype;
  v_target_ids uuid[] := array[]::uuid[];
  v_included boolean[] := array[]::boolean[];
  v_new_rows boolean[] := array[]::boolean[];
  v_row_changed_flags boolean[] := array[]::boolean[];
  v_old_names text[] := array[]::text[];
  v_decision_fingerprint text;
  v_ordinal integer := 0;
  v_created integer := 0;
  v_updated_count integer := 0;
  v_skipped integer := 0;
  v_changed_fields jsonb := '{}'::jsonb;
  v_field text;
  v_backup_name text;
  v_metrics_before jsonb;
  v_metrics_after jsonb;
  v_alias_conflicts jsonb := '[]'::jsonb;
  v_alias text;
  v_existing_alias_employee uuid;
  v_row_changed boolean;
  v_changed boolean;
  v_old_manager_id uuid;
begin
  if auth.uid() is null or not public.has_permission('workforce.import_employees') then
    raise exception 'غير مصرح بتطبيق استيراد الموظفين';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array'
     or jsonb_typeof(p_decisions) is distinct from 'array' then
    raise exception 'بيانات القرارات لا تطابق صفوف المعاينة';
  end if;
  if jsonb_array_length(p_rows) < 1
     or jsonb_array_length(p_rows) > 2000
     or jsonb_array_length(p_rows) <> jsonb_array_length(p_decisions) then
    raise exception 'بيانات القرارات لا تطابق صفوف المعاينة';
  end if;

  lock table public.employees in share row exclusive mode;
  lock table public.school_supervisor_assignments in share mode;
  lock table public.profiles in share mode;
  lock table public.supervisor_aliases in share row exclusive mode;
  lock table public.employee_ratings in share row exclusive mode;

  v_preview := public.employee_import_preview(p_rows);
  v_metrics_before := public.employee_import_metrics();

  v_backup_name := '_bak_employees_' || to_char(current_date, 'YYYYMMDD');
  execute format('create table if not exists public.%I (like public.employees including all)', v_backup_name);
  execute format('alter table public.%I enable row level security', v_backup_name);
  execute format('revoke all on table public.%I from public, anon, authenticated', v_backup_name);
  execute format(
    'insert into public.%I select e.* from public.employees e on conflict (id) do nothing',
    v_backup_name
  );

  for v_row_preview, v_input, v_decision in
    select preview_row.value, input_row.value, decision_row.value
    from jsonb_array_elements(v_preview->'rows') with ordinality preview_row(value, ordinal)
    join jsonb_array_elements(p_rows) with ordinality input_row(value, ordinal)
      on input_row.ordinal = preview_row.ordinal
    join jsonb_array_elements(p_decisions) with ordinality decision_row(value, ordinal)
      on decision_row.ordinal = preview_row.ordinal
    order by preview_row.ordinal
  loop
    v_ordinal := v_ordinal + 1;
    v_status := v_row_preview->>'status';
    v_action := v_decision->>'action';
    v_decision_fingerprint := v_decision->>'fingerprint';
    if (v_decision->>'row')::integer is distinct from v_ordinal
       or v_decision_fingerprint is distinct from v_row_preview->>'fingerprint' then
      raise exception 'تغيرت بيانات الصف % منذ المعاينة؛ أعد المعاينة', v_ordinal;
    end if;
    if v_action is null or v_action not in ('create', 'link', 'update', 'skip') then
      raise exception 'قرار الصف % غير صالح', v_ordinal;
    end if;

    if v_status = 'conflict' then
      if v_action <> 'skip' then
        raise exception 'الصف % متعارض ويجب استبعاده أو تصحيح بياناته ثم إعادة المعاينة', v_ordinal;
      end if;
      v_skipped := v_skipped + 1;
      v_target_ids := array_append(v_target_ids, null);
      v_included := array_append(v_included, false);
      v_new_rows := array_append(v_new_rows, false);
      v_row_changed_flags := array_append(v_row_changed_flags, false);
      v_old_names := array_append(v_old_names, null);
      continue;
    elsif v_action = 'skip' then
      v_skipped := v_skipped + 1;
      v_target_ids := array_append(v_target_ids, null);
      v_included := array_append(v_included, false);
      v_new_rows := array_append(v_new_rows, false);
      v_row_changed_flags := array_append(v_row_changed_flags, false);
      v_old_names := array_append(v_old_names, null);
      continue;
    end if;

    v_employee_id := nullif(v_row_preview->>'employee_id', '')::uuid;
    if v_status = 'new' and v_action <> 'create' then
      raise exception 'إنشاء الموظف في الصف % يتطلب قرار إنشاء صريح', v_ordinal;
    end if;
    if v_status = 'needs_decision' and v_row_preview->>'match_method' is null then
      if v_action = 'link' then
        v_employee_id := nullif(v_decision->>'employee_id', '')::uuid;
        if not exists (
          select 1 from jsonb_array_elements(v_row_preview->'candidates') candidate(value)
          where candidate.value->>'id' = v_employee_id::text
        ) then
          raise exception 'الموظف المختار في الصف % ليس من المرشحين المعروضين', v_ordinal;
        end if;
      elsif v_action <> 'create' then
        raise exception 'الصف % يحتاج إلى اختيار ربط أو إنشاء صريح', v_ordinal;
      end if;
    elsif v_status = 'needs_decision' and v_row_preview->>'match_method' = 'name_candidate_link' then
      if v_action <> 'link'
         or v_decision->>'employee_id' is distinct from v_row_preview->>'employee_id' then
        raise exception 'ربط الموظف في الصف % يتطلب اختيار المرشح المعروض', v_ordinal;
      end if;
    elsif v_status = 'needs_decision' and v_row_preview->>'match_method' = 'residence_no_needs_link' then
      if v_action <> 'link' then
        raise exception 'تغيير الرقم الوظيفي المطابق للإقامة في الصف % يتطلب قرار ربط صريح', v_ordinal;
      end if;
      if v_decision->>'employee_id' is distinct from v_row_preview->>'employee_id' then
        raise exception 'الموظف المختار في الصف % لا يطابق سجل الإقامة', v_ordinal;
      end if;
      v_employee_id := nullif(v_row_preview->>'employee_id', '')::uuid;
    elsif v_status = 'needs_decision' and v_action not in ('update', 'skip') then
      raise exception 'قرار الصف % غير صالح', v_ordinal;
    elsif v_status in ('update', 'no_change') and v_action <> 'update' then
      raise exception 'قرار الصف % غير صالح', v_ordinal;
    end if;

    if v_action = 'create' then
      if v_status not in ('new', 'needs_decision') then
        raise exception 'لا يمكن إنشاء موظف من الصف % بهذا القرار', v_ordinal;
      end if;
      if v_status = 'needs_decision' and jsonb_array_length(v_row_preview->'candidates') = 0 then
        raise exception 'الصف % لا يحتوي مرشحين صالحين للإنشاء', v_ordinal;
      end if;
      v_employee_no := nullif(btrim(coalesce(v_input->>'employee_no', v_input->>'employee_number', '')), '');
      v_residence := public.employee_import_digits(nullif(btrim(coalesce(v_input->>'residence_no', v_input->>'residenceNumber', '')), ''));
      v_phone := public.employee_import_digits(nullif(btrim(coalesce(v_input->>'phone', '')), ''));
      v_name := nullif(btrim(v_input->>'full_name'), '');
      v_employee_no := nullif(btrim(coalesce(v_input->>'employee_no', v_input->>'employee_number', '')), '');
      v_job_title := nullif(btrim(v_input->>'job_title'), '');
      v_category := nullif(btrim(coalesce(v_input->>'category', v_input->>'employee_category', '')), '');
      v_department := nullif(btrim(v_input->>'department'), '');
      v_nationality := nullif(btrim(v_input->>'nationality'), '');
      v_status_value := nullif(btrim(v_input->>'status'), '');
      v_hire_date := nullif(btrim(coalesce(v_input->>'hire_date', v_input->>'hireDate', '')), '')::date;
      v_project_name := 'الرياض';
      v_manager_number := nullif(btrim(coalesce(v_input->>'manager_number', v_input->>'managerNumber', '')), '');
      v_rating := nullif(btrim(v_input->>'rating'), '')::numeric;
      insert into public.employees (
        full_name, employee_no, residence_no, job_title, category, department,
        phone, nationality, hire_date, status, project_name
      ) values (
        v_name, v_employee_no,
        case when v_residence ~ '^[0-9]{10}$' then v_residence else null end,
        v_job_title, v_category::public.employee_category, v_department,
        case when v_phone ~ '^05[0-9]{8}$' then v_phone else null end,
        v_nationality, v_hire_date, coalesce(v_status_value, 'active'), v_project_name
      ) returning id into v_employee_id;
      v_created := v_created + 1;
      foreach v_field in array array['full_name', 'category', 'status', 'project_name']
      loop
        v_changed_fields := jsonb_set(
          v_changed_fields,
          array[v_field],
          to_jsonb(coalesce((v_changed_fields->>v_field)::integer, 0) + 1),
          true
        );
      end loop;
      if v_employee_no is not null then
        v_changed_fields := jsonb_set(v_changed_fields, array['employee_no'],
          to_jsonb(coalesce((v_changed_fields->>'employee_no')::integer, 0) + 1), true);
      end if;
      if v_job_title is not null then
        v_changed_fields := jsonb_set(v_changed_fields, array['job_title'],
          to_jsonb(coalesce((v_changed_fields->>'job_title')::integer, 0) + 1), true);
      end if;
      if v_department is not null then
        v_changed_fields := jsonb_set(v_changed_fields, array['department'],
          to_jsonb(coalesce((v_changed_fields->>'department')::integer, 0) + 1), true);
      end if;
      if v_phone ~ '^05[0-9]{8}$' then
        v_changed_fields := jsonb_set(v_changed_fields, array['phone'],
          to_jsonb(coalesce((v_changed_fields->>'phone')::integer, 0) + 1), true);
      end if;
      if v_residence ~ '^[0-9]{10}$' then
        v_changed_fields := jsonb_set(v_changed_fields, array['residence_no'],
          to_jsonb(coalesce((v_changed_fields->>'residence_no')::integer, 0) + 1), true);
      end if;
      if v_nationality is not null then
        v_changed_fields := jsonb_set(v_changed_fields, array['nationality'],
          to_jsonb(coalesce((v_changed_fields->>'nationality')::integer, 0) + 1), true);
      end if;
      if v_hire_date is not null then
        v_changed_fields := jsonb_set(v_changed_fields, array['hire_date'],
          to_jsonb(coalesce((v_changed_fields->>'hire_date')::integer, 0) + 1), true);
      end if;
      if v_rating is not null then
        insert into public.employee_ratings(employee_id, rating, updated_by)
        values (v_employee_id, v_rating, auth.uid())
        on conflict (employee_id) do update
          set rating = excluded.rating, updated_by = excluded.updated_by, updated_at = now();
        v_changed_fields := jsonb_set(v_changed_fields, array['rating'],
          to_jsonb(coalesce((v_changed_fields->>'rating')::integer, 0) + 1), true);
      end if;
      v_target_ids := array_append(v_target_ids, v_employee_id);
      v_included := array_append(v_included, true);
      v_new_rows := array_append(v_new_rows, true);
      v_row_changed_flags := array_append(v_row_changed_flags, false);
      v_old_names := array_append(v_old_names, null);
      continue;
    end if;

    if v_employee_id is null then
      raise exception 'تعذر تحديد الموظف في الصف %', v_ordinal;
    end if;
    select e.* into v_current
    from public.employees e
    where e.id = v_employee_id
    for update;
    if not found then
      raise exception 'تغير سجل الموظف في الصف % منذ المعاينة؛ أعد المعاينة', v_ordinal;
    end if;
    v_old_names := array_append(v_old_names, v_current.full_name);
    v_employee_no := nullif(btrim(coalesce(v_input->>'employee_no', v_input->>'employee_number', '')), '');
    v_preview_diff := v_row_preview->'diff';
    v_name := nullif(btrim(v_input->>'full_name'), '');
    v_review_name := public.employee_import_is_true(v_input->>'review_name');
    v_use_imported_name := coalesce((v_decision->>'use_imported_name')::boolean, false);
    v_confirm_job_title := coalesce((v_decision->>'confirm_job_title')::boolean, false);
    v_confirm_category := coalesce((v_decision->>'confirm_category')::boolean, false);
    v_job_title := nullif(btrim(v_input->>'job_title'), '');
    v_category := nullif(btrim(coalesce(v_input->>'category', v_input->>'employee_category', '')), '');
    v_department := nullif(btrim(v_input->>'department'), '');
    v_phone := public.employee_import_digits(nullif(btrim(v_input->>'phone'), ''));
    v_residence := public.employee_import_digits(nullif(btrim(coalesce(v_input->>'residence_no', v_input->>'residenceNumber', '')), ''));
    v_nationality := nullif(btrim(v_input->>'nationality'), '');
    v_status_value := nullif(btrim(v_input->>'status'), '');
    v_hire_date := nullif(btrim(coalesce(v_input->>'hire_date', v_input->>'hireDate', '')), '')::date;
    v_project_name := nullif(btrim(v_input->>'project_name'), '');
    v_manager_number := nullif(btrim(coalesce(v_input->>'manager_number', v_input->>'managerNumber', '')), '');
    v_rating := nullif(btrim(v_input->>'rating'), '')::numeric;

    update public.employees e
    set     full_name = case
      when v_name is not null and (
        (v_use_imported_name and not v_review_name)
        or (v_preview_diff->'full_name'->>'default_action') = 'apply'
      ) then v_name else e.full_name end,
        employee_no = case
          when v_action = 'link' and v_employee_no is not null and v_employee_no is distinct from e.employee_no then v_employee_no
          else e.employee_no end,
        job_title = case
          when v_job_title is not null
            and (not coalesce((v_preview_diff->'job_title'->>'requires_confirmation')::boolean, false)
                 or v_confirm_job_title)
          then v_job_title else e.job_title end,
        category = case
          when v_category is not null
            and (not coalesce((v_preview_diff->'category'->>'requires_confirmation')::boolean, false)
                 or v_confirm_category)
          then v_category::public.employee_category else e.category end,
        department = case when nullif(btrim(e.department), '') is null and v_department is not null then v_department else e.department end,
        phone = case when v_phone ~ '^05[0-9]{8}$' then v_phone else e.phone end,
        residence_no = case when v_residence ~ '^[0-9]{10}$' then v_residence else e.residence_no end,
        status = coalesce(v_status_value, e.status),
        nationality = coalesce(v_nationality, e.nationality),
        hire_date = coalesce(v_hire_date, e.hire_date),
        project_name = coalesce(v_project_name, e.project_name)
    where e.id = v_employee_id
      and (
        (v_name is not null and (
          ((v_use_imported_name and not v_review_name)
           or (v_preview_diff->'full_name'->>'default_action') = 'apply')
          and e.full_name is distinct from v_name
        ))
        or (v_action = 'link' and v_employee_no is not null and e.employee_no is distinct from v_employee_no)
        or (v_job_title is not null
            and (not coalesce((v_preview_diff->'job_title'->>'requires_confirmation')::boolean, false)
                 or v_confirm_job_title)
            and e.job_title is distinct from v_job_title)
        or (v_category is not null
            and (not coalesce((v_preview_diff->'category'->>'requires_confirmation')::boolean, false)
                 or v_confirm_category)
            and e.category::text is distinct from v_category)
        or (nullif(btrim(e.department), '') is null and v_department is not null)
        or (v_phone ~ '^05[0-9]{8}$' and e.phone is distinct from v_phone)
        or (v_residence ~ '^[0-9]{10}$'
            and public.employee_import_digits(e.residence_no) is distinct from v_residence)
        or (v_status_value is not null and e.status is distinct from v_status_value)
        or (v_nationality is not null and e.nationality is distinct from v_nationality)
        or (v_hire_date is not null and e.hire_date is distinct from v_hire_date)
        or (v_project_name is not null and e.project_name is distinct from v_project_name)
      )
    returning e.* into v_updated;
    if not found then
      v_updated := v_current;
    end if;

    v_row_changed := false;
    for v_field in
      select unnest(array[
        'full_name','employee_no','job_title','category','department','phone',
        'residence_no','status','nationality','hire_date','project_name'
      ])
    loop
      v_changed := case v_field
        when 'full_name' then v_current.full_name is distinct from v_updated.full_name
        when 'employee_no' then v_current.employee_no is distinct from v_updated.employee_no
        when 'job_title' then v_current.job_title is distinct from v_updated.job_title
        when 'category' then v_current.category is distinct from v_updated.category
        when 'department' then v_current.department is distinct from v_updated.department
        when 'phone' then v_current.phone is distinct from v_updated.phone
        when 'residence_no' then v_current.residence_no is distinct from v_updated.residence_no
        when 'status' then v_current.status is distinct from v_updated.status
        when 'nationality' then v_current.nationality is distinct from v_updated.nationality
        when 'hire_date' then v_current.hire_date is distinct from v_updated.hire_date
        when 'project_name' then v_current.project_name is distinct from v_updated.project_name
        else false
      end;
      if v_changed then
        v_row_changed := true;
        v_changed_fields := jsonb_set(
          v_changed_fields,
          array[v_field],
          to_jsonb(coalesce((v_changed_fields->>v_field)::integer, 0) + 1),
          true
        );
      end if;
    end loop;

    if v_rating is not null then
      insert into public.employee_ratings(employee_id, rating, updated_by)
      values (v_employee_id, v_rating, auth.uid())
      on conflict (employee_id) do update
        set rating = excluded.rating, updated_by = excluded.updated_by, updated_at = now()
        where public.employee_ratings.rating is distinct from excluded.rating;
      if found then
        v_changed_fields := jsonb_set(
          v_changed_fields, array['rating'],
          to_jsonb(coalesce((v_changed_fields->>'rating')::integer, 0) + 1), true
        );
        v_row_changed := true;
      end if;
    end if;

    if v_row_changed then v_updated_count := v_updated_count + 1; end if;

    if v_current.full_name is distinct from v_updated.full_name then
      foreach v_alias in array array[
        public.normalise_plan_name(v_current.full_name),
        public.normalise_plan_name(v_updated.full_name)
      ]
      loop
        if v_alias = '' then continue; end if;
        select a.employee_id into v_existing_alias_employee
        from public.supervisor_aliases a
        where a.alias_normalised = v_alias;
        if v_existing_alias_employee is null then
          insert into public.supervisor_aliases(alias_normalised, employee_id)
          values (v_alias, v_employee_id)
          on conflict (alias_normalised) do nothing;
          select a.employee_id into v_existing_alias_employee
          from public.supervisor_aliases a
          where a.alias_normalised = v_alias;
        end if;
        if v_existing_alias_employee is distinct from v_employee_id then
          v_alias_conflicts := v_alias_conflicts || jsonb_build_array(v_alias);
        end if;
      end loop;
    end if;

    v_target_ids := array_append(v_target_ids, v_employee_id);
    v_included := array_append(v_included, true);
    v_new_rows := array_append(v_new_rows, false);
    v_row_changed_flags := array_append(v_row_changed_flags, v_row_changed);
  end loop;

  for v_ordinal in 1..cardinality(v_target_ids) loop
    if not v_included[v_ordinal] then continue; end if;
    v_input := p_rows->(v_ordinal - 1);
    v_manager_number := nullif(btrim(coalesce(v_input->>'manager_number', v_input->>'managerNumber', '')), '');
    if v_manager_number is null then continue; end if;
    select e.id into v_manager_id
    from public.employees e
    where e.employee_no = v_manager_number;
    if v_manager_id is null then
      raise exception 'تعذر العثور على المدير في الصف %', v_ordinal;
    end if;
    if v_manager_id = v_target_ids[v_ordinal] then
      raise exception 'لا يمكن تعيين الموظف مديراً مباشراً لنفسه في الصف %', v_ordinal;
    end if;
    select e.manager_id into v_old_manager_id
    from public.employees e where e.id = v_target_ids[v_ordinal];
    if v_old_manager_id is distinct from v_manager_id then
      update public.employees set manager_id = v_manager_id where id = v_target_ids[v_ordinal];
      v_changed_fields := jsonb_set(
        v_changed_fields, array['manager_id'],
        to_jsonb(coalesce((v_changed_fields->>'manager_id')::integer, 0) + 1), true
      );
      if not v_new_rows[v_ordinal] and not v_row_changed_flags[v_ordinal] then
        v_updated_count := v_updated_count + 1;
      end if;
      v_row_changed_flags[v_ordinal] := true;
    end if;
  end loop;

  v_metrics_after := public.employee_import_metrics();
  if v_metrics_before is distinct from v_metrics_after then
    raise exception 'أُوقف الاستيراد لأن أعداد المشرفين أو المدارس المسندة تغيرت';
  end if;

  perform public.relink_plan_names();
  insert into public.audit_log(actor, action, table_name, details)
  values (
    auth.uid(),
    'IMPORT_EMPLOYEES',
    'employees',
    jsonb_build_object(
      'created', v_created,
      'updated', v_updated_count,
      'skipped', v_skipped,
      'changed_fields', v_changed_fields,
      'alias_conflicts', jsonb_array_length(v_alias_conflicts),
      'school_assignments_before', v_metrics_before,
      'school_assignments_after', v_metrics_after
    )
  );

  return jsonb_build_object(
    'created', v_created,
    'updated', v_updated_count,
    'skipped', v_skipped,
    'alias_conflicts', v_alias_conflicts,
    'school_assignments_before', v_metrics_before,
    'school_assignments_after', v_metrics_after
  );
end;
$$;

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

revoke all on function public.employee_import_digits(text) from public, anon, authenticated;
revoke all on function public.employee_import_normalize_name(text) from public, anon, authenticated;
revoke all on function public.employee_import_is_true(text) from public, anon, authenticated;
revoke all on function public.employee_import_contains_words(text, text) from public, anon, authenticated;
revoke all on function public.employee_import_metrics() from public, anon, authenticated;
revoke all on function public.employee_import_preview_row(jsonb, integer, jsonb) from public, anon, authenticated;
revoke all on function public.employee_import_preview(jsonb) from public, anon;
revoke all on function public.employee_import_apply(jsonb, jsonb) from public, anon;
grant execute on function public.employee_import_preview(jsonb) to authenticated;
grant execute on function public.employee_import_apply(jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';

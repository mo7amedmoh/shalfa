import { useMemo, useState } from 'react';
import type { InputHTMLAttributes } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { loadXlsx } from '../../lib/xlsx';
import { z } from 'zod';
import { FileDown, Eye, EyeOff, Search, Upload } from 'lucide-react';
import type { UserProfile } from '../../lib/auth';
import { useDisplayFormat } from '../../app/useDisplayFormat';
import { supabase } from '../../lib/supabase';
import { APP_SCHEMA_SELECT } from '../../lib/schemaColumns';
import { analyzeResidenceNumbers, employeeCategorySchema, type ResidenceEmployee } from '../../domain/workforce';

const employeeSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  employee_number: z.string().nullable(),
  job_title: z.string().nullable(),
  employee_category: employeeCategorySchema,
  department: z.string().nullable(),
  nationality: z.string().nullable(),
  hire_date: z.string().nullable(),
  employment_status: z.enum(['active', 'inactive', 'terminated']),
  phone: z.string().nullable(),
  manager_id: z.string().uuid().nullable(),
});
const ratingSchema = z.object({ employee_id: z.string().uuid(), rating: z.number().nullable() });
const residenceEmployeeSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  employee_number: z.string().nullable(),
});
const residenceRowSchema = z.object({ id: z.string().uuid(), residence_no: z.string().nullable() });
const residenceAssignmentSchema = z.object({
  employee_id: z.string().uuid().nullable(),
  school: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
});
const employeeInputSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  employee_number: z.string().trim().min(1).max(60),
  job_title: z.string().trim().min(1).max(120),
  employee_category: z.enum(['engineer', 'supervisor', 'admin_staff', 'technician', 'driver', 'cleaner']),
  department: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(30),
  manager_id: z.string().uuid().nullable(),
});
type Employee = z.infer<typeof employeeSchema>;
type EmployeeInput = z.infer<typeof employeeInputSchema>;
type EmployeeImportRow = EmployeeInput & {
  residenceNumber: string;
  nationality: string;
  hireDate: string | null;
  status: 'active' | 'inactive';
  managerNumber: string;
  rating: number | null;
};

const employeeCategories = [
  ['engineer', 'مهندس'],
  ['supervisor', 'مشرف'],
  ['admin_staff', 'إداري'],
  ['technician', 'فني'],
  ['driver', 'سائق'],
  ['cleaner', 'عامل نظافة'],
] as const;
const employeeCategoryLabels: Record<z.infer<typeof employeeCategorySchema>, string> = {
  engineer: 'مهندس',
  supervisor: 'مشرف',
  admin_staff: 'إداري',
  technician: 'فني',
  driver: 'سائق',
  cleaner: 'عامل نظافة',
  gatekeeper: 'حارس مدرسة',
};

function categoryFromArabic(value: string) {
  return employeeCategories.find(([, label]) => label === value)?.[0];
}

async function loadEmployees(): Promise<Employee[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('employees')
    .select(APP_SCHEMA_SELECT.employeesCleaner)
    .order('full_name');
  if (error) throw error;
  return z.array(employeeSchema).parse(data);
}

async function loadRatings(): Promise<Map<string, number | null>> {
  if (!supabase) return new Map();
  const { data, error } = await supabase.from('employee_ratings').select(APP_SCHEMA_SELECT.employeeRatings);
  if (error) throw error;
  const ratings = z.array(ratingSchema).parse(data);
  return new Map(ratings.map((item) => [item.employee_id, item.rating]));
}

async function loadResidenceQuality() {
  if (!supabase) return analyzeResidenceNumbers([]);
  const [employeesResult, cleanerAssignmentsResult, gatekeepersResult] = await Promise.all([
    supabase.from('employees').select('id,full_name,employee_number:employee_no').order('full_name'),
    supabase.from('cleaner_assignments').select('employee_id,school:schools(id,name)'),
    supabase.from('gatekeepers').select('employee_id,school:schools(id,name)'),
  ]);
  for (const result of [employeesResult, cleanerAssignmentsResult, gatekeepersResult]) {
    if (result.error) throw result.error;
  }
  const employees = z.array(residenceEmployeeSchema).parse(employeesResult.data);
  const schoolNames = new Map<string, Map<string, string>>();
  const assignments = [
    ...z.array(residenceAssignmentSchema).parse(cleanerAssignmentsResult.data),
    ...z.array(residenceAssignmentSchema).parse(gatekeepersResult.data),
  ];
  for (const assignment of assignments) {
    if (!assignment.employee_id || !assignment.school) continue;
    const employeeSchools = schoolNames.get(assignment.employee_id) ?? new Map<string, string>();
    employeeSchools.set(assignment.school.id, assignment.school.name);
    schoolNames.set(assignment.employee_id, employeeSchools);
  }
  const residenceById = new Map<string, string | null>();
  for (let index = 0; index < employees.length; index += 500) {
    const ids = employees.slice(index, index + 500).map(({ id }) => id);
    const { data, error } = await supabase.rpc('reveal_residence', { p_kind: 'employees', p_ids: ids });
    if (error) throw error;
    for (const row of z.array(residenceRowSchema).parse(data)) {
      residenceById.set(row.id, row.residence_no);
    }
  }
  const records: ResidenceEmployee[] = employees.map((employee) => ({
    id: employee.id,
    fullName: employee.full_name,
    employeeNumber: employee.employee_number,
    residenceNumber: residenceById.get(employee.id) ?? null,
    schools: [...(schoolNames.get(employee.id) ?? new Map())]
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name, 'ar')),
  }));
  return analyzeResidenceNumbers(records);
}

function cellText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function importHeader(row: Record<string, unknown>, labels: readonly string[]): string {
  const key = labels.find((label) => Object.hasOwn(row, label));
  return key ? cellText(row[key]) : '';
}

function parseImportRows(fileRows: Record<string, unknown>[]): EmployeeImportRow[] {
  return fileRows.map((row, index) => {
    const rawStatus = importHeader(row, ['الحالة', 'حالة الموظف']);
    const status = rawStatus === '' || rawStatus === 'نشط' ? 'active' : rawStatus === 'غير نشط' ? 'inactive' : rawStatus;
    const ratingText = importHeader(row, ['التقييم']);
    const raw = {
      full_name: importHeader(row, ['اسم', 'الاسم', 'اسم الموظف']),
      employee_number: importHeader(row, ['الرقم الوظيفي']),
      job_title: importHeader(row, ['الوظيفة', 'المسمى الوظيفي']),
      employee_category: categoryFromArabic(importHeader(row, ['الفئة الوظيفية'])) ?? '',
      department: importHeader(row, ['القسم', 'الإدارة']),
      phone: importHeader(row, ['رقم التواصل', 'رقم الجوال']),
      manager_id: null,
      residenceNumber: importHeader(row, ['رقم الإقامة', 'رقم الاقامة']),
      nationality: importHeader(row, ['الجنسية']),
      hireDate: importHeader(row, ['تاريخ التعيين']) || null,
      status,
      managerNumber: importHeader(row, ['الرقم الوظيفي للمدير']),
      rating: ratingText === '' ? null : Number(ratingText),
    };
    const parsed = z.object({
      full_name: z.string().min(2),
      employee_number: z.string().min(1),
      job_title: z.string().min(1),
      employee_category: z.enum(['engineer', 'supervisor', 'admin_staff', 'technician', 'driver', 'cleaner']),
      department: z.string().min(1),
      phone: z.string(),
      manager_id: z.null(),
      residenceNumber: z.string(),
      nationality: z.string(),
      hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
      status: z.enum(['active', 'inactive']),
      managerNumber: z.string(),
      rating: z.number().min(0).max(100).nullable(),
    }).safeParse(raw);
    if (!parsed.success) {
      throw new Error(`تعذر التحقق من الصف ${index + 2} في ملف الاستيراد: ${parsed.error.issues[0]?.message ?? 'بيانات غير صالحة'}`);
    }
    return parsed.data;
  });
}

export function WorkforcePage({ profile }: { profile: UserProfile | null }) {
  const queryClient = useQueryClient();
  const { formatNumber } = useDisplayFormat();
  const [search, setSearch] = useState('');
  const [revealedIds, setRevealedIds] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const isPrivileged = profile?.role === 'admin' || profile?.role === 'project_manager';
  const canManage = Boolean(isPrivileged);
  const employees = useQuery({ queryKey: ['employees'], queryFn: loadEmployees, enabled: Boolean(profile) });
  const ratings = useQuery({ queryKey: ['employee-ratings'], queryFn: loadRatings, enabled: Boolean(profile && isPrivileged) });
  const residenceQuality = useQuery({
    queryKey: ['workforce-residence-quality'],
    queryFn: loadResidenceQuality,
    enabled: Boolean(profile && isPrivileged),
    refetchInterval: 30_000,
  });
  const { register, handleSubmit, reset, formState: { isSubmitting } } = useForm<EmployeeInput>({
    defaultValues: { full_name: '', employee_number: '', job_title: '', employee_category: 'technician', department: '', phone: '', manager_id: null },
  });
  const visibleEmployees = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return (employees.data ?? []).filter((employee) =>
      `${employee.full_name} ${employee.employee_number ?? ''} ${employee.job_title ?? ''} ${employee.department ?? ''}`.toLocaleLowerCase().includes(query),
    );
  }, [employees.data, search]);

  async function saveEmployee(values: EmployeeInput) {
    setMessage('');
    if (!supabase || !profile || !canManage) return setMessage('لا تملك صلاحية إدارة سجل الموظفين.');
    const parsed = employeeInputSchema.safeParse(values);
    if (!parsed.success) return setMessage('تحقق من الاسم والرقم الوظيفي والوظيفة والفئة والقسم.');
    const { error } = await supabase.from('employees').insert({
      full_name: parsed.data.full_name,
      employee_no: parsed.data.employee_number,
      job_title: parsed.data.job_title,
      category: parsed.data.employee_category,
      department: parsed.data.department,
      manager_id: parsed.data.manager_id,
      phone: parsed.data.phone || null,
      nationality: null,
      hire_date: null,
      status: 'active',
    });
    if (error) return setMessage(`تعذر حفظ الموظف: ${error.message}`);
    reset();
    setMessage('تم حفظ بيانات الموظف.');
    await queryClient.invalidateQueries({ queryKey: ['employees'] });
  }

  async function importWorkbook(file: File) {
    setMessage('');
    if (!supabase || !profile || !canManage) return setMessage('لا تملك صلاحية استيراد الموظفين.');
    if (file.size > 5 * 1024 * 1024) return setMessage('الحد الأقصى لحجم الملف 5 ميجابايت.');
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) return setMessage('الصيغ المسموحة: XLSX وXLS وCSV.');
    try {
      const XLSX = await loadXlsx();
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const firstSheet = workbook.SheetNames[0];
      if (!firstSheet) throw new Error('الملف لا يحتوي على ورقة بيانات.');
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[firstSheet], { defval: '', raw: false });
      if (!rawRows.length) throw new Error('ورقة البيانات فارغة.');
      const rows = parseImportRows(rawRows);
      if (rows.some((row) => row.residenceNumber)) {
        throw new Error('لا يمكن استيراد أرقام الإقامة من الواجهة؛ استخدم الإجراء الآمن المعتمد.');
      }
      if (rows.some((row) => row.rating !== null) && !isPrivileged) {
        throw new Error('استيراد التقييم متاح لمدير المشروع ومدير النظام فقط.');
      }

      const employeeNumbers = new Map((employees.data ?? []).flatMap((employee) => employee.employee_number ? [[employee.employee_number, employee.id] as const] : []));
      let completed = 0;
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        const managerId = row.managerNumber ? employeeNumbers.get(row.managerNumber) : null;
        if (row.managerNumber && !managerId) throw new Error(`تعذر العثور على المدير المرتبط بالصف ${index + 2}.`);
        const { data, error } = await supabase.from('employees').upsert({
          full_name: row.full_name,
          employee_no: row.employee_number,
          job_title: row.job_title,
          category: row.employee_category,
          department: row.department,
          phone: row.phone || null,
          nationality: row.nationality || null,
          hire_date: row.hireDate,
          status: row.status,
          manager_id: managerId,
        }, { onConflict: 'employee_no' }).select(APP_SCHEMA_SELECT.id).single();
        if (error) throw new Error(`تعذر حفظ الموظف في الصف ${index + 2}: ${error.message}`);
        employeeNumbers.set(row.employee_number, data.id);
        if (row.rating !== null) {
          const { error: ratingError } = await supabase.from('employee_ratings').upsert({
            employee_id: data.id,
            rating: row.rating,
            updated_by: profile.id,
          });
          if (ratingError) throw new Error(`حُفظ سجل الصف ${index + 2} لكن تعذر حفظ التقييم: ${ratingError.message}`);
        }
        completed += 1;
      }
      const { error: relinkError } = await supabase.rpc('relink_plan_names');
      if (relinkError) throw new Error(`تم استيراد الموظفين لكن تعذر إعادة ربط أسماء الخطط: ${relinkError.message}`);
      setMessage(`اكتمل استيراد ${completed} سجلاً.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['employees'] }),
        queryClient.invalidateQueries({ queryKey: ['employee-ratings'] }),
      ]);
    } catch (error) {
      setMessage(error instanceof Error ? `تعذر إكمال الاستيراد: ${error.message}` : 'تعذر قراءة ملف الاستيراد.');
    }
  }

  async function toggleResidence(employeeId: string) {
    if (revealedIds[employeeId]) {
      setRevealedIds((current) => { const next = { ...current }; delete next[employeeId]; return next; });
      return;
    }
    if (!supabase || !profile || !['admin', 'project_manager', 'area_engineer'].includes(profile.role)) return;
    const { data, error } = await supabase.rpc('reveal_residence', { p_kind: 'employees', p_ids: [employeeId] });
    if (error) return setMessage(`تعذر إظهار رقم الهوية: ${error.message}`);
    const parsed = z.array(z.object({ id: z.string().uuid(), residence_no: z.string().nullable() })).length(1).safeParse(data);
    if (!parsed.success) return setMessage('لم يُرجع النظام رقم هوية صالحاً.');
    const residenceNumber = parsed.data[0].residence_no;
    if (!residenceNumber) return setMessage('لا يوجد رقم إقامة مسجل لهذا الموظف.');
    setRevealedIds((current) => ({ ...current, [employeeId]: residenceNumber }));
  }

  async function exportEmployees() {
    if (!visibleEmployees.length) return setMessage('لا توجد سجلات مطابقة للتصدير.');
    const XLSX = await loadXlsx();
    const records = visibleEmployees.map((employee) => ({
        الاسم: employee.full_name,
        'الرقم الوظيفي': employee.employee_number,
        الوظيفة: employee.job_title,
        القسم: employee.department,
        'رقم التواصل': employee.phone ?? '',
        ...(isPrivileged ? { التقييم: ratings.data?.get(employee.id) ?? '' } : {}),
      }));
    const sheet = XLSX.utils.json_to_sheet(records);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'القوى العاملة');
    XLSX.writeFile(workbook, 'القوى-العاملة.xlsx');
    setMessage('تم تصدير البيانات المعروضة دون أرقام الإقامة.');
  }

  async function exportResidenceQuality() {
    const report = residenceQuality.data;
    if (!report) return setMessage('لا توجد بيانات جودة أرقام الإقامة للتصدير.');
    const XLSX = await loadXlsx();
    const protectCell = (value: string | null) => {
      const text = value ?? '';
      return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    };
    const issueRows = report.issues.map((employee) => ({
      'نوع التنبيه': employee.issue === 'missing'
        ? 'رقم غير مسجل'
        : employee.issue === 'passport-like'
          ? 'رقم شبيه بجواز السفر'
          : 'رقم ليس من 10 خانات',
      'اسم الموظف': protectCell(employee.fullName),
      'الرقم الوظيفي': protectCell(employee.employeeNumber),
      'رقم الإقامة/الوثيقة': protectCell(employee.residenceNumber),
      'المدارس': protectCell(employee.schools.map(({ name }) => name).join('، ')),
    }));
    const sharedRows = report.shared.flatMap(({ residenceNumber, employees: matched }) => matched.map((employee) => ({
      'رقم الإقامة/الوثيقة': protectCell(residenceNumber),
      'اسم الموظف': protectCell(employee.fullName),
      'الرقم الوظيفي': protectCell(employee.employeeNumber),
      'المدارس': protectCell(employee.schools.map(({ name }) => name).join('، ')),
    })));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(issueRows), 'أرقام تحتاج مراجعة');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(sharedRows), 'أرقام مشتركة');
    XLSX.writeFile(workbook, 'جودة-أرقام-الإقامة.xlsx');
    setMessage('تم تصدير تقرير جودة أرقام الإقامة.');
  }

  return (
    <div className="grid gap-5">
      <section><p className="text-sm text-slate-500">سجل الموظفين والصلاحيات</p><h2 className="mt-1 text-2xl font-bold text-brand-900">القوى العاملة</h2></section>
      {(employees.error || (isPrivileged && ratings.error)) && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
        تعذر تحميل بيانات القوى العاملة: {employees.error ? `سجل الموظفين: ${employees.error.message}` : `التقييمات: ${ratings.error instanceof Error ? ratings.error.message : String(ratings.error)}`}
      </div>}
      {canManage && <section className="card grid gap-4 p-5">
        <h3 className="font-bold">إضافة موظف أو استيراد ملف</h3>
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={handleSubmit(saveEmployee)}>
          <Input label="اسم الموظف" {...register('full_name', { required: true })} />
          <Input label="الرقم الوظيفي" {...register('employee_number', { required: true })} />
          <Input label="الوظيفة" {...register('job_title', { required: true })} />
          <label className="grid gap-1 text-sm font-semibold">الفئة الوظيفية
            <select {...register('employee_category', { required: true })} className="rounded-lg border border-slate-300 px-3 py-2 font-normal"><option value="">اختر الفئة</option>{employeeCategories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          </label>
          <Input label="القسم" {...register('department', { required: true })} />
          <Input label="رقم التواصل" type="tel" {...register('phone')} />
          <label className="grid gap-1 text-sm font-semibold">المسؤول المباشر
            <select {...register('manager_id', { setValueAs: (value) => value || null })} className="rounded-lg border border-slate-300 px-3 py-2 font-normal"><option value="">بدون مسؤول محدد</option>{(employees.data ?? []).map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name} · {employee.job_title}</option>)}</select>
          </label>
          <div className="workforce-employee-form-actions">
            <button type="submit" disabled={isSubmitting} className="workforce-save-employee-button">
              {isSubmitting ? 'جارٍ الحفظ…' : 'حفظ الموظف'}
            </button>
          </div>
        </form>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold"><Upload size={16} /> استيراد Excel أو CSV<input type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importWorkbook(file); event.currentTarget.value = ''; }} /></label>
          <button type="button" onClick={() => void exportEmployees()} disabled={!employees.data?.length} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50"><FileDown size={16} /> تصدير البيانات</button>
          <span className="text-xs text-slate-500">يجب أن تتضمن الأعمدة: اسم، الرقم الوظيفي، الوظيفة، الفئة الوظيفية، القسم. التقييم منفصل، ورقم الإقامة لا يُخزّن في جدول الموظفين.</span>
        </div>
        {message && <p role="status" className="text-sm text-slate-700">{message}</p>}
      </section>}

      {isPrivileged && <section className="card grid gap-4 p-5" aria-labelledby="residence-quality-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 id="residence-quality-title" className="font-bold">جودة أرقام الإقامة والوثائق</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">الأرقام الظاهرة تُقرأ عبر الإجراء الآمن المسجل في سجل التدقيق. تُحدّث القائمة تلقائياً كل 30 ثانية.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void residenceQuality.refetch()} disabled={residenceQuality.isFetching} className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-50">
              {residenceQuality.isFetching ? 'جارٍ التحديث…' : 'تحديث'}
            </button>
            <button type="button" onClick={() => void exportResidenceQuality()} disabled={!residenceQuality.data} className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-50">تصدير Excel</button>
          </div>
        </div>
        {residenceQuality.error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">تعذر تحميل بيانات الجودة: {residenceQuality.error.message}</p>}
        {residenceQuality.isLoading ? <p role="status">جارٍ فحص أرقام الإقامة…</p> : residenceQuality.data && <>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ['أرقام غير قياسية / شبيهة بجواز', residenceQuality.data.issues.filter(({ issue }) => issue !== 'missing').length],
              ['أرقام غير مسجلة', residenceQuality.data.issues.filter(({ issue }) => issue === 'missing').length],
              ['مجموعات أرقام مشتركة', residenceQuality.data.shared.length],
            ].map(([label, count]) => <article key={label} className="rounded-xl border border-slate-100 p-4">
              <p className="text-xs text-slate-500">{label}</p>
              <p className="mt-1 text-2xl font-bold text-brand-900">{formatNumber(Number(count))}</p>
            </article>)}
          </div>
          {residenceQuality.data.issues.length > 0 && <div>
            <h4 className="mb-2 text-sm font-bold text-amber-900">أرقام تحتاج مراجعة</h4>
            <div className="table-scroll"><table className="text-sm">
              <thead><tr><th>التنبيه</th><th>الموظف</th><th>الرقم الوظيفي</th><th>رقم الإقامة/الوثيقة</th><th>المدارس</th></tr></thead>
              <tbody>{residenceQuality.data.issues.map((employee) => <tr key={employee.id}>
                <td>{employee.issue === 'missing' ? 'غير مسجل' : employee.issue === 'passport-like' ? 'شبيه بجواز سفر' : 'ليس 10 خانات'}</td>
                <td>{employee.fullName}</td>
                <td>{employee.employeeNumber ?? '—'}</td>
                <td dir="ltr" className="font-mono">{employee.residenceNumber ?? '—'}</td>
                <td>{employee.schools.map(({ name }) => name).join('، ') || '—'}</td>
              </tr>)}</tbody>
            </table></div>
          </div>}
          {residenceQuality.data.shared.length > 0 && <div>
            <h4 className="mb-2 text-sm font-bold text-rose-900">أرقام مستخدمة لموظفين متعددين والمدارس المسندة لهم</h4>
            <div className="table-scroll"><table className="text-sm">
              <thead><tr><th>رقم الإقامة/الوثيقة</th><th>الموظفون والمدارس</th></tr></thead>
              <tbody>{residenceQuality.data.shared.map(({ residenceNumber, employees: matched }) => <tr key={residenceNumber}>
                <td dir="ltr" className="font-mono">{residenceNumber}</td>
                <td>{matched.map((employee) => `${employee.fullName} (${employee.schools.map(({ name }) => name).join('، ') || 'دون مدرسة مسندة'})`).join('؛ ')}</td>
              </tr>)}</tbody>
            </table></div>
          </div>}
          {!residenceQuality.data.issues.length && !residenceQuality.data.shared.length && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">لا توجد مشكلات في أرقام الإقامة أو الوثائق.</p>}
        </>}
      </section>}

      <section className="card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
          <label className="relative min-w-0 flex-1"><Search size={17} className="absolute inset-inline-start-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث بالاسم أو الرقم الوظيفي أو الوظيفة" className="w-full rounded-lg border border-slate-300 py-2 pe-3 ps-10" /></label>
          <span className="text-sm text-slate-500">عدد الموظفين: {formatNumber(visibleEmployees.length)}</span>
        </div>
        {employees.isLoading ? <p role="status" className="p-8 text-center text-slate-500">جارٍ تحميل السجل…</p> : visibleEmployees.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">لا توجد سجلات مطابقة.</p> : (
          <div className="table-scroll"><table>
            <thead><tr><th>الاسم</th><th>الرقم الوظيفي</th><th>الوظيفة</th><th>الفئة الوظيفية</th><th>القسم</th><th>رقم الإقامة</th>{isPrivileged && <th>التقييم</th>}</tr></thead>
            <tbody>{visibleEmployees.map((employee) => <tr key={employee.id}>
              <td className="font-semibold">{employee.full_name}</td><td>{employee.employee_number ?? '—'}</td><td>{employee.job_title ?? '—'}</td><td>{employeeCategoryLabels[employee.employee_category] ?? '—'}</td><td>{employee.department ?? '—'}</td>
              <td><span>{revealedIds[employee.id] ?? '••••••'}</span>{profile && ['admin', 'project_manager', 'area_engineer'].includes(profile.role) && <button type="button" onClick={() => void toggleResidence(employee.id)} aria-label={revealedIds[employee.id] ? 'إخفاء رقم الإقامة' : 'إظهار رقم الإقامة'} className="me-2 rounded p-1 text-brand-700">{revealedIds[employee.id] ? <EyeOff size={16} /> : <Eye size={16} />}</button>}</td>
              {isPrivileged && <td>{ratings.data?.get(employee.id) ?? '—'}</td>}
            </tr>)}</tbody>
          </table></div>
        )}
      </section>
      {message && !canManage && <p role="status" className="text-sm text-slate-700">{message}</p>}
    </div>
  );
}

function Input({ label, type = 'text', ...props }: { label: string; type?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return <label className="grid gap-1 text-sm font-semibold">{label}<input type={type} {...props} className="rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label>;
}

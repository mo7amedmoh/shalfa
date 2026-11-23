import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, InputHTMLAttributes } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { loadXlsx } from '../../lib/xlsx';
import { exportBrandedXlsx } from '../../lib/brandedXlsx';
import { revealResidenceNumbers } from '../../lib/residence';
import { z } from 'zod';
import { FileDown, Eye, EyeOff, Search, Upload, X } from 'lucide-react';
import type { UserProfile } from '../../lib/auth';
import { useDisplayFormat } from '../../app/useDisplayFormat';
import { supabase } from '../../lib/supabase';
import { APP_SCHEMA_SELECT } from '../../lib/schemaColumns';
import { analyzeResidenceNumbers, employeeCategorySchema, type ResidenceEmployee } from '../../domain/workforce';
import { paginateRows, TABLE_PAGE_SIZE } from '../../lib/pagination';
import { TablePagination } from '../../components/TablePagination';
import { usePermission } from '../../app/permissionContext';

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
  project_name: z.string().nullable(),
  identity_card_path: z.string().nullable(),
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
  project_name: z.string().trim().max(120),
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
  const normalized = value.trim().replace(/تكيف/g, 'تكييف');
  if (/مشرف/.test(normalized)) return 'supervisor';
  if (/كهرب/.test(normalized)) return 'technician';
  if (/سباك|مبلط|دهان|نجار|بلاط|مكيف|تكييف|اعمال مدنيه/.test(normalized)) return 'technician';
  if (/مهندس/.test(normalized)) return 'engineer';
  if (/إداري|اداري/.test(normalized)) return 'admin_staff';
  if (/سائق/.test(normalized)) return 'driver';
  return employeeCategories.find(([, label]) => label === normalized)?.[0];
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
    const profession = importHeader(row, ['الوظيفة', 'المسمى الوظيفي', 'المهنه']);
    const company = importHeader(row, ['الشركة', 'الشركه', 'القسم', 'الإدارة']);
    const importedEmployeeNumber = importHeader(row, ['الرقم الوظيفي', 'رقم الموظف'])
      || importHeader(row, ['الهويه', 'رقم الهوية']);
    const normalizedEmployeeNumber = importedEmployeeNumber && importedEmployeeNumber !== '-' ? importedEmployeeNumber : `TEMP-${index + 1}`;
    const raw = {
      full_name: importHeader(row, ['اسم', 'الاسم', 'اسم الموظف']),
      employee_number: normalizedEmployeeNumber,
      job_title: profession || 'غير محدد',
      employee_category: categoryFromArabic(importHeader(row, ['الفئة الوظيفية', 'المهنه'])) ?? 'technician',
      department: company || 'غير محدد',
      phone: importHeader(row, ['رقم التواصل', 'رقم الجوال']),
      manager_id: null,
      residenceNumber: importHeader(row, ['رقم الإقامة', 'رقم الاقامة']),
      nationality: importHeader(row, ['الجنسية']),
      hireDate: importHeader(row, ['تاريخ التعيين']) || null,
      status,
      managerNumber: importHeader(row, ['الرقم الوظيفي للمدير']),
      rating: ratingText === '' ? null : Number(ratingText),
      project_name: importHeader(row, ['المشروع', 'الشركه']),
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
      project_name: z.string(),
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
  const [employeePage, setEmployeePage] = useState(1);
  const [issuesPage, setIssuesPage] = useState(1);
  const [sharedPage, setSharedPage] = useState(1);
  const [revealedIds, setRevealedIds] = useState<Record<string, string>>({});
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [identityCardUrl, setIdentityCardUrl] = useState('');
  const [identityCardFile, setIdentityCardFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');
  const isPrivileged = usePermission('settings.view');
  const canManage = Boolean(isPrivileged);
  const canRevealResidence = usePermission('residence.reveal');
  const employees = useQuery({ queryKey: ['employees'], queryFn: loadEmployees, enabled: Boolean(profile) });
  const ratings = useQuery({ queryKey: ['employee-ratings'], queryFn: loadRatings, enabled: Boolean(profile && isPrivileged) });
  const residenceQuality = useQuery({
    queryKey: ['workforce-residence-quality'],
    queryFn: loadResidenceQuality,
    enabled: Boolean(profile && isPrivileged),
    refetchInterval: 30_000,
  });
  const { register, handleSubmit, reset, formState: { isSubmitting } } = useForm<EmployeeInput>({
    defaultValues: { full_name: '', employee_number: '', job_title: '', employee_category: 'technician', department: '', phone: '', manager_id: null, project_name: '' },
  });
  const visibleEmployees = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return (employees.data ?? []).filter((employee) => employee.employee_category !== 'cleaner'
      && (!categoryFilter || employee.employee_category === categoryFilter)
      && (!statusFilter || employee.employment_status === statusFilter)
      && (!projectFilter || (employee.project_name ?? '').toLocaleLowerCase().includes(projectFilter.toLocaleLowerCase()))
      && `${employee.full_name} ${employee.employee_number ?? ''} ${employee.job_title ?? ''} ${employee.department ?? ''}`.toLocaleLowerCase().includes(query));
  }, [employees.data, search, categoryFilter, statusFilter, projectFilter]);
  const pagedEmployees = paginateRows(visibleEmployees, employeePage);
  const selectedEmployee = (employees.data ?? []).find((employee) => employee.id === selectedEmployeeId) ?? null;
  const projectNames = useMemo(() => [...new Set((employees.data ?? [])
    .map((employee) => employee.project_name?.trim())
    .filter((project): project is string => Boolean(project)))]
    .sort((left, right) => left.localeCompare(right, 'ar')), [employees.data]);
  useEffect(() => {
    setIdentityCardUrl('');
    if (!supabase || !selectedEmployee?.identity_card_path) return;
    let cancelled = false;
    void supabase.storage.from('employee-identity').createSignedUrl(selectedEmployee.identity_card_path, 600)
      .then(({ data }) => { if (!cancelled) setIdentityCardUrl(data?.signedUrl ?? ''); });
    return () => { cancelled = true; };
  }, [selectedEmployeeId, selectedEmployee?.identity_card_path]);
  const residenceIssues = residenceQuality.data?.issues ?? [];
  const sharedResidenceRecords = residenceQuality.data?.shared ?? [];
  const pagedResidenceIssues = paginateRows(residenceIssues, issuesPage);
  const pagedSharedResidenceRecords = paginateRows(sharedResidenceRecords, sharedPage);

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
      project_name: parsed.data.project_name || null,
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
          project_name: row.project_name || null,
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
      setMessage(relinkError
        ? `تم استيراد ${completed} سجلاً، لكن تعذر إعادة ربط أسماء الخطط: ${relinkError.message}. يمكنك إعادة المحاولة من شاشة ربط الأسماء.`
        : `اكتمل استيراد ${completed} سجلاً.`);
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
    if (!supabase || !profile || !canRevealResidence) return;
    const { data, error } = await supabase.rpc('reveal_residence', { p_kind: 'employees', p_ids: [employeeId] });
    if (error) return setMessage(`تعذر إظهار رقم الهوية: ${error.message}`);
    const parsed = z.array(z.object({ id: z.string().uuid(), residence_no: z.string().nullable() })).length(1).safeParse(data);
    if (!parsed.success) return setMessage('لم يُرجع النظام رقم هوية صالحاً.');
    const residenceNumber = parsed.data[0].residence_no;
    if (!residenceNumber) return setMessage('لا يوجد رقم إقامة مسجل لهذا الموظف.');
    setRevealedIds((current) => ({ ...current, [employeeId]: residenceNumber }));
  }

  async function updateEmployeeProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !selectedEmployee || !canManage) return;
    const form = new FormData(event.currentTarget);
    const getText = (key: string) => String(form.get(key) ?? '').trim();
    try {
      let identityCardPath = selectedEmployee.identity_card_path;
      if (identityCardFile) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(identityCardFile.type)
          || identityCardFile.size < 1
          || identityCardFile.size > 5 * 1024 * 1024) {
          throw new Error('اختر صورة JPG أو PNG أو WebP لا يتجاوز حجمها 5 ميجابايت.');
        }
        const extension = identityCardFile.type === 'image/png' ? 'png' : identityCardFile.type === 'image/webp' ? 'webp' : 'jpg';
        identityCardPath = `employees/${selectedEmployee.id}/${crypto.randomUUID()}.${extension}`;
        const { error } = await supabase.storage.from('employee-identity').upload(identityCardPath, identityCardFile, {
          contentType: identityCardFile.type,
          upsert: false,
        });
        if (error) throw error;
      }
      const { error } = await supabase.rpc('update_employee_profile', {
        p_employee_id: selectedEmployee.id,
        p_full_name: getText('full_name'),
        p_employee_no: getText('employee_number'),
        p_job_title: getText('job_title'),
        p_category: getText('category'),
        p_department: getText('department'),
        p_phone: getText('phone'),
        p_project_name: getText('project_name'),
        p_manager_id: getText('manager_id') || null,
        p_nationality: getText('nationality'),
        p_hire_date: getText('hire_date'),
        p_status: getText('status'),
        p_identity_card_path: identityCardPath,
      });
      if (error) throw error;
      setIdentityCardFile(null);
      setEditMode(false);
      setMessage('تم تعديل بيانات الموظف.');
      await queryClient.invalidateQueries({ queryKey: ['employees'] });
    } catch (error) {
      setMessage(error instanceof Error ? `تعذر تعديل بيانات الموظف: ${error.message}` : 'تعذر تعديل بيانات الموظف.');
    }
  }

  async function exportEmployees() {
    if (!visibleEmployees.length) return setMessage('لا توجد سجلات مطابقة للتصدير.');
    if (isPrivileged && ratings.isLoading) return setMessage('انتظر اكتمال تحميل تقييمات الموظفين قبل التصدير.');
    if (isPrivileged && ratings.error) return setMessage(`تعذر تصدير التقييمات: ${ratings.error instanceof Error ? ratings.error.message : String(ratings.error)}`);
    if (isPrivileged && !ratings.data) return setMessage('تعذر تصدير البيانات: لم تُحمّل تقييمات الموظفين.');
    try {
      const residenceNumbers = canRevealResidence
        ? await revealResidenceNumbers('employees', visibleEmployees.map(({ id }) => id))
        : new Map<string, string>();
      await exportBrandedXlsx('القوى-العاملة.xlsx', [{
        name: 'القوى العاملة',
        title: 'القوى العاملة',
        columns: ['الاسم', 'الرقم الوظيفي', 'الوظيفة', 'الفئة الوظيفية', 'القسم', 'رقم الإقامة', 'التقييم'],
        rows: visibleEmployees.map((employee) => [
          employee.full_name,
          employee.employee_number ?? '',
          employee.job_title ?? '',
          employeeCategoryLabels[employee.employee_category],
          employee.department ?? '',
          canRevealResidence ? residenceNumbers.get(employee.id) ?? '' : '••••••',
          isPrivileged ? ratings.data?.get(employee.id) ?? '' : '',
        ]),
      }]);
      setMessage(canRevealResidence
        ? 'تم تصدير بيانات القوى العاملة بالأعمدة الأساسية وأرقام الإقامة المتاحة.'
        : 'تم تصدير بيانات القوى العاملة؛ أرقام الإقامة مقنعة لعدم توفر الصلاحية.');
    } catch (error) {
      setMessage(`تعذر تصدير بيانات القوى العاملة: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function exportResidenceQuality() {
    const report = residenceQuality.data;
    if (!report) return setMessage('لا توجد بيانات جودة أرقام الإقامة للتصدير.');
    try {
      const protectCell = (value: string | null) => {
        const text = value ?? '';
        return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
      };
      const issueRows = report.issues.map((employee) => [
        employee.issue === 'missing'
          ? 'رقم غير مسجل'
          : employee.issue === 'passport-like'
            ? 'رقم شبيه بجواز السفر'
            : 'رقم ليس من 10 خانات',
        protectCell(employee.fullName),
        protectCell(employee.employeeNumber),
        protectCell(employee.residenceNumber),
        protectCell(employee.schools.map(({ name }) => name).join('، ')),
      ]);
      const sharedRows = report.shared.flatMap(({ residenceNumber, employees: matched }) => matched.map((employee) => [
        protectCell(residenceNumber),
        protectCell(employee.fullName),
        protectCell(employee.employeeNumber),
        protectCell(employee.schools.map(({ name }) => name).join('، ')),
      ]));
      await exportBrandedXlsx('جودة-أرقام-الإقامة.xlsx', [
        {
          name: 'أرقام تحتاج مراجعة',
          title: 'أرقام تحتاج مراجعة',
          columns: ['نوع التنبيه', 'اسم الموظف', 'الرقم الوظيفي', 'رقم الإقامة/الوثيقة', 'المدارس'],
          rows: issueRows,
        },
        {
          name: 'أرقام مشتركة',
          title: 'أرقام إقامة مشتركة',
          columns: ['رقم الإقامة/الوثيقة', 'اسم الموظف', 'الرقم الوظيفي', 'المدارس'],
          rows: sharedRows,
        },
      ]);
      setMessage('تم تصدير تقرير جودة أرقام الإقامة.');
    } catch (error) {
      setMessage(`تعذر تصدير تقرير جودة أرقام الإقامة: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return (
    <div className="workforce-page grid min-w-0 gap-5">
      <section className="min-w-0"><p className="text-xs text-slate-500 sm:text-sm">طاقم الشركة الداخلي؛ لا يشمل عمال النظافة بعقد أجير</p><h2 className="mt-1 text-xl font-bold text-brand-900 sm:text-2xl">القوى العاملة</h2></section>
      {(employees.error || (isPrivileged && ratings.error)) && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
        تعذر تحميل بيانات القوى العاملة: {employees.error ? `سجل الموظفين: ${employees.error.message}` : `التقييمات: ${ratings.error instanceof Error ? ratings.error.message : String(ratings.error)}`}
      </div>}
      {canManage && <section className="card grid min-w-0 gap-4 p-4 sm:p-5">
        <h3 className="font-bold">إضافة موظف أو استيراد ملف</h3>
        <form className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={handleSubmit(saveEmployee)}>
          <Input label="اسم الموظف" {...register('full_name', { required: true })} />
          <Input label="الرقم الوظيفي" {...register('employee_number', { required: true })} />
          <Input label="الوظيفة" {...register('job_title', { required: true })} />
          <label className="grid min-w-0 gap-1 text-sm font-semibold">الفئة الوظيفية
            <select {...register('employee_category', { required: true })} className="w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"><option value="">اختر الفئة</option>{employeeCategories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          </label>
          <Input label="القسم" {...register('department', { required: true })} />
          <Input label="رقم التواصل" type="tel" {...register('phone')} />
          <Input label="المشروع" {...register('project_name')} />
          <label className="grid min-w-0 gap-1 text-sm font-semibold">المسؤول المباشر
            <select {...register('manager_id', { setValueAs: (value) => value || null })} className="w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"><option value="">بدون مسؤول محدد</option>{(employees.data ?? []).map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name} · {employee.job_title}</option>)}</select>
          </label>
          <div className="workforce-employee-form-actions">
            <button type="submit" disabled={isSubmitting} className="workforce-save-employee-button">
              {isSubmitting ? 'جارٍ الحفظ…' : 'حفظ الموظف'}
            </button>
          </div>
        </form>
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold"><Upload size={16} /> استيراد Excel أو CSV<input type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importWorkbook(file); event.currentTarget.value = ''; }} /></label>
          <button type="button" onClick={() => void exportEmployees()} disabled={!employees.data?.length} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50"><FileDown size={16} /> تصدير البيانات</button>
          <span className="min-w-0 flex-1 text-xs leading-5 text-slate-500">يجب أن تتضمن الأعمدة: اسم، الرقم الوظيفي، الوظيفة، الفئة الوظيفية، القسم. التقييم منفصل، ورقم الإقامة لا يُخزّن في جدول الموظفين.</span>
        </div>
        {message && <p role="status" className="text-sm text-slate-700">{message}</p>}
      </section>}

      {isPrivileged && <section className="card grid min-w-0 gap-4 p-4 sm:p-5" aria-labelledby="residence-quality-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 id="residence-quality-title" className="font-bold">جودة أرقام الإقامة والوثائق</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">الأرقام الظاهرة تُقرأ عبر الإجراء الآمن المسجل في سجل التدقيق. تُحدّث القائمة تلقائياً كل 30 ثانية.</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button type="button" onClick={() => void residenceQuality.refetch()} disabled={residenceQuality.isFetching} className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-50">
              {residenceQuality.isFetching ? 'جارٍ التحديث…' : 'تحديث'}
            </button>
            <button type="button" onClick={() => void exportResidenceQuality()} disabled={!residenceQuality.data} className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-50">تصدير Excel</button>
          </div>
        </div>
        {residenceQuality.error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">تعذر تحميل بيانات الجودة: {residenceQuality.error.message}</p>}
        {residenceQuality.isLoading ? <p role="status">جارٍ فحص أرقام الإقامة…</p> : residenceQuality.data && <>
          <div className="grid min-w-0 gap-3 sm:grid-cols-3">
            {[
              ['أرقام غير قياسية / شبيهة بجواز', residenceQuality.data.issues.filter(({ issue }) => issue !== 'missing').length],
              ['أرقام غير مسجلة', residenceQuality.data.issues.filter(({ issue }) => issue === 'missing').length],
              ['مجموعات أرقام مشتركة', residenceQuality.data.shared.length],
            ].map(([label, count]) => <article key={label} className="min-w-0 rounded-xl border border-slate-100 p-3 sm:p-4">
              <p className="text-xs leading-5 text-slate-500">{label}</p>
              <p className="mt-1 text-2xl font-bold text-brand-900">{formatNumber(Number(count))}</p>
            </article>)}
          </div>
          {residenceQuality.data.issues.length > 0 && <div>
            <h4 className="mb-2 text-sm font-bold text-amber-900">أرقام تحتاج مراجعة</h4>
            <div className="grid gap-3">
              <div className="table-scroll workforce-table-scroll" role="region" aria-label="جدول أرقام الإقامة والوثائق التي تحتاج مراجعة" tabIndex={0}><table className="workforce-table workforce-quality-table">
                <thead><tr><th scope="col">التنبيه</th><th scope="col">الموظف</th><th scope="col">الرقم الوظيفي</th><th scope="col">رقم الإقامة/الوثيقة</th><th scope="col">المدارس</th></tr></thead>
                <tbody>{pagedResidenceIssues.rows.map((employee) => <tr key={employee.id}>
                  <td data-label="التنبيه">{employee.issue === 'missing' ? 'غير مسجل' : employee.issue === 'passport-like' ? 'شبيه بجواز سفر' : 'ليس 10 خانات'}</td>
                  <td data-label="الموظف">{employee.fullName}</td>
                  <td data-label="الرقم الوظيفي">{employee.employeeNumber ?? '—'}</td>
                  <td data-label="رقم الإقامة/الوثيقة"><span dir="ltr" className="font-mono">{employee.residenceNumber ?? '—'}</span></td>
                  <td data-label="المدارس">{employee.schools.map(({ name }) => name).join('، ') || '—'}</td>
                </tr>)}</tbody>
              </table></div>
              <TablePagination
                label="جدول أرقام الإقامة التي تحتاج مراجعة"
                totalRows={residenceIssues.length}
                pageSize={TABLE_PAGE_SIZE}
                currentPage={pagedResidenceIssues.currentPage}
                pageCount={pagedResidenceIssues.pageCount}
                onPageChange={setIssuesPage}
                formatNumber={formatNumber}
              />
            </div>
          </div>}
          {residenceQuality.data.shared.length > 0 && <div>
            <h4 className="mb-2 text-sm font-bold text-rose-900">أرقام مستخدمة لموظفين متعددين والمدارس المسندة لهم</h4>
            <div className="grid gap-3">
              <div className="table-scroll workforce-table-scroll" role="region" aria-label="جدول أرقام الإقامة المشتركة" tabIndex={0}><table className="workforce-table workforce-shared-table">
                <thead><tr><th scope="col">رقم الإقامة/الوثيقة</th><th scope="col">الموظفون والمدارس</th></tr></thead>
                <tbody>{pagedSharedResidenceRecords.rows.map(({ residenceNumber, employees: matched }) => <tr key={residenceNumber}>
                  <td data-label="رقم الإقامة/الوثيقة"><span dir="ltr" className="font-mono">{residenceNumber}</span></td>
                  <td data-label="الموظفون والمدارس">{matched.map((employee) => `${employee.fullName} (${employee.schools.map(({ name }) => name).join('، ') || 'دون مدرسة مسندة'})`).join('؛ ')}</td>
                </tr>)}</tbody>
              </table></div>
              <TablePagination
                label="جدول أرقام الإقامة المشتركة"
                totalRows={sharedResidenceRecords.length}
                pageSize={TABLE_PAGE_SIZE}
                currentPage={pagedSharedResidenceRecords.currentPage}
                pageCount={pagedSharedResidenceRecords.pageCount}
                onPageChange={setSharedPage}
                formatNumber={formatNumber}
              />
            </div>
          </div>}
          {!residenceQuality.data.issues.length && !residenceQuality.data.shared.length && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">لا توجد مشكلات في أرقام الإقامة أو الوثائق.</p>}
        </>}
      </section>}

      <section className="card min-w-0 overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
          <label className="relative min-w-0 flex-1"><Search size={17} className="absolute inset-inline-start-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => { setSearch(event.target.value); setEmployeePage(1); }} placeholder="ابحث بالاسم أو الرقم الوظيفي أو الوظيفة" className="w-full min-w-0 rounded-lg border border-slate-300 py-2 pe-3 ps-10 text-sm" /></label>
          <span className="shrink-0 text-xs text-slate-500 sm:text-sm">عدد الموظفين: {formatNumber(visibleEmployees.length)}</span>
        </div>
        <div className="grid gap-3 border-b border-slate-100 bg-slate-50/70 p-4 sm:grid-cols-3">
          <label className="grid gap-1 text-xs font-semibold text-slate-600">الفئة الوظيفية
            <select value={categoryFilter} onChange={(event) => { setCategoryFilter(event.target.value); setEmployeePage(1); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
              <option value="">كل الفئات</option>{employeeCategories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-600">الحالة
            <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setEmployeePage(1); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
              <option value="">كل الحالات</option><option value="active">نشط</option><option value="inactive">غير نشط</option><option value="terminated">منتهي الخدمة</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-600">المشروع
            <select value={projectFilter} onChange={(event) => { setProjectFilter(event.target.value); setEmployeePage(1); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
              <option value="">كل المشاريع</option>{projectNames.map((project) => <option key={project} value={project}>{project}</option>)}
            </select>
          </label>
        </div>
        {employees.isLoading ? <p role="status" className="p-8 text-center text-slate-500">جارٍ تحميل السجل…</p> : visibleEmployees.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">لا توجد سجلات مطابقة.</p> : (
          <div className="grid gap-3 p-3 sm:p-4">
            <div className="table-scroll workforce-table-scroll" role="region" aria-label="جدول الموظفين" tabIndex={0}><table className="workforce-table workforce-employee-table">
              <thead><tr><th scope="col">الاسم</th><th scope="col">الرقم الوظيفي</th><th scope="col">الوظيفة</th><th scope="col">الفئة الوظيفية</th><th scope="col">القسم</th><th scope="col">رقم الإقامة</th>{isPrivileged && <th scope="col">التقييم</th>}</tr></thead>
              <tbody>{pagedEmployees.rows.map((employee) => <tr key={employee.id}>
                <td data-label="الاسم" className="font-semibold"><button type="button" onClick={() => { setSelectedEmployeeId(employee.id); setEditMode(false); setIdentityCardFile(null); }} className="text-brand-800 underline decoration-brand-200 underline-offset-4 hover:text-brand-950">{employee.full_name}</button></td>
                <td data-label="الرقم الوظيفي">{employee.employee_number ?? '—'}</td>
                <td data-label="الوظيفة">{employee.job_title ?? '—'}</td>
                <td data-label="الفئة الوظيفية">{employeeCategoryLabels[employee.employee_category] ?? '—'}</td>
                <td data-label="القسم">{employee.department ?? '—'}</td>
                <td data-label="رقم الإقامة">
                  <span className="workforce-identity-value">
                    <span dir="ltr" className="font-mono">{revealedIds[employee.id] ?? '••••••'}</span>
                    {profile && canRevealResidence && <button type="button" onClick={() => void toggleResidence(employee.id)} aria-label={revealedIds[employee.id] ? 'إخفاء رقم الإقامة' : 'إظهار رقم الإقامة'} className="rounded p-1 text-brand-700">{revealedIds[employee.id] ? <EyeOff size={16} /> : <Eye size={16} />}</button>}
                  </span>
                </td>
                {isPrivileged && <td data-label="التقييم">{ratings.data?.get(employee.id) ?? '—'}</td>}
              </tr>)}</tbody>
            </table></div>
            <TablePagination
              label="جدول الموظفين"
              totalRows={visibleEmployees.length}
              pageSize={TABLE_PAGE_SIZE}
              currentPage={pagedEmployees.currentPage}
              pageCount={pagedEmployees.pageCount}
              onPageChange={setEmployeePage}
              formatNumber={formatNumber}
            />
          </div>
        )}
      </section>
      {selectedEmployee && <div className="fixed inset-0 z-40 grid place-items-center bg-slate-950/40 p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="employee-profile-title">
        <article className="card max-h-[90vh] w-full max-w-3xl overflow-y-auto p-4 sm:p-6">
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <p className="text-xs text-slate-500">بطاقة موظف</p>
              <h3 id="employee-profile-title" className="mt-1 text-xl font-bold text-brand-900">{selectedEmployee.full_name}</h3>
            </div>
            <button type="button" onClick={() => { setSelectedEmployeeId(null); setEditMode(false); setIdentityCardFile(null); }} className="rounded-lg border border-slate-300 p-2 text-slate-600" aria-label="إغلاق بطاقة الموظف"><X size={18} /></button>
          </div>
          {!editMode ? <>
            <div className="grid gap-5 py-5 sm:grid-cols-[minmax(0,1fr)_220px]">
              <dl className="grid gap-3 sm:grid-cols-2">
                {[
                  ['الاسم', selectedEmployee.full_name],
                  ['الرقم الوظيفي', selectedEmployee.employee_number ?? '—'],
                  ['رقم الإقامة', revealedIds[selectedEmployee.id] ?? '••••••'],
                  ['رقم الجوال', selectedEmployee.phone ?? '—'],
                  ['المشروع', selectedEmployee.project_name ?? 'غير مسجل'],
                  ['القسم', selectedEmployee.department ?? '—'],
                  ['الوظيفة', selectedEmployee.job_title ?? '—'],
                  ['الفئة الوظيفية', employeeCategoryLabels[selectedEmployee.employee_category]],
                  ['الحالة', selectedEmployee.employment_status === 'active' ? 'نشط' : selectedEmployee.employment_status === 'inactive' ? 'غير نشط' : 'منتهي الخدمة'],
                  ['الجنسية', selectedEmployee.nationality ?? '—'],
                ].map(([label, value]) => <div key={label} className="rounded-xl border border-slate-100 p-3"><dt className="text-xs text-slate-500">{label}</dt><dd dir={label === 'رقم الإقامة' ? 'ltr' : undefined} className="mt-1 font-semibold">{value}</dd></div>)}
              </dl>
              <div className="grid content-start gap-2">
                <p className="text-sm font-bold">صورة الهوية</p>
                {identityCardUrl
                  ? <img src={identityCardUrl} alt={`هوية ${selectedEmployee.full_name}`} className="max-h-64 w-full rounded-xl border border-slate-200 object-contain" />
                  : <div className="grid min-h-40 place-items-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-xs text-slate-500">لا توجد صورة بطاقة هوية مرفوعة</div>}
                {profile && canRevealResidence && <button type="button" onClick={() => void toggleResidence(selectedEmployee.id)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold">{revealedIds[selectedEmployee.id] ? 'إخفاء رقم الإقامة' : 'إظهار رقم الإقامة'}</button>}
              </div>
            </div>
            <div className="border-t border-slate-100 pt-4">
              <p className="mb-3 text-sm font-bold">التدرج الإداري وصولاً إلى مدير المشروع</p>
              <ol className="grid gap-2">
                {(() => {
                  const chain: Employee[] = [];
                  let current = selectedEmployee.manager_id ? (employees.data ?? []).find((item) => item.id === selectedEmployee.manager_id) : undefined;
                  const visited = new Set([selectedEmployee.id]);
                  while (current && !visited.has(current.id)) {
                    chain.push(current);
                    visited.add(current.id);
                    current = current.manager_id ? (employees.data ?? []).find((item) => item.id === current!.manager_id) : undefined;
                  }
                  if (!chain.length) return <li className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">لم يُسند مدير مباشر بعد.</li>;
                  return chain.map((manager, index) => <li key={manager.id} className="flex items-center gap-3 rounded-lg border border-slate-100 p-3">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-bold text-brand-800">{formatNumber(index + 1)}</span>
                    <span className="min-w-0 flex-1"><strong>{manager.full_name}</strong><small className="block text-slate-500">{manager.job_title ?? employeeCategoryLabels[manager.employee_category]}</small></span>
                  </li>);
                })()}
              </ol>
            </div>
            {canManage && <div className="mt-5 flex justify-end"><button type="button" onClick={() => setEditMode(true)} className="rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-bold text-white">تعديل بيانات الموظف</button></div>}
          </> : <form className="grid gap-3 py-5 sm:grid-cols-2" onSubmit={updateEmployeeProfile}>
            <label className="grid gap-1 text-sm font-semibold">اسم الموظف<input name="full_name" defaultValue={selectedEmployee.full_name} required className="rounded-lg border border-slate-300 px-3 py-2" /></label>
            <label className="grid gap-1 text-sm font-semibold">الرقم الوظيفي<input name="employee_number" defaultValue={selectedEmployee.employee_number ?? ''} className="rounded-lg border border-slate-300 px-3 py-2" /></label>
            <label className="grid gap-1 text-sm font-semibold">الوظيفة<input name="job_title" defaultValue={selectedEmployee.job_title ?? ''} className="rounded-lg border border-slate-300 px-3 py-2" /></label>
            <label className="grid gap-1 text-sm font-semibold">الفئة<select name="category" defaultValue={selectedEmployee.employee_category} className="rounded-lg border border-slate-300 px-3 py-2">{employeeCategories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="grid gap-1 text-sm font-semibold">القسم<input name="department" defaultValue={selectedEmployee.department ?? ''} className="rounded-lg border border-slate-300 px-3 py-2" /></label>
            <label className="grid gap-1 text-sm font-semibold">رقم الجوال<input name="phone" defaultValue={selectedEmployee.phone ?? ''} className="rounded-lg border border-slate-300 px-3 py-2" /></label>
            <label className="grid gap-1 text-sm font-semibold">المشروع<input name="project_name" defaultValue={selectedEmployee.project_name ?? ''} className="rounded-lg border border-slate-300 px-3 py-2" /></label>
            <label className="grid gap-1 text-sm font-semibold">الجنسية<input name="nationality" defaultValue={selectedEmployee.nationality ?? ''} className="rounded-lg border border-slate-300 px-3 py-2" /></label>
            <label className="grid gap-1 text-sm font-semibold">تاريخ التعيين<input name="hire_date" type="date" defaultValue={selectedEmployee.hire_date ?? ''} className="rounded-lg border border-slate-300 px-3 py-2" /></label>
            <label className="grid gap-1 text-sm font-semibold">الحالة<select name="status" defaultValue={selectedEmployee.employment_status} className="rounded-lg border border-slate-300 px-3 py-2"><option value="active">نشط</option><option value="inactive">غير نشط</option><option value="terminated">منتهي الخدمة</option></select></label>
            <label className="grid gap-1 text-sm font-semibold sm:col-span-2">المدير المباشر<select name="manager_id" defaultValue={selectedEmployee.manager_id ?? ''} className="rounded-lg border border-slate-300 px-3 py-2"><option value="">بدون مدير مباشر</option>{(employees.data ?? []).filter((employee) => employee.id !== selectedEmployee.id).map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name} · {employee.job_title ?? employeeCategoryLabels[employee.employee_category]}</option>)}</select></label>
            <label className="grid gap-1 text-sm font-semibold sm:col-span-2">صورة بطاقة الهوية<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setIdentityCardFile(event.target.files?.[0] ?? null)} className="rounded-lg border border-slate-300 px-3 py-2" /><span className="text-xs font-normal text-slate-500">JPG أو PNG أو WebP بحد أقصى 5 ميجابايت</span></label>
            <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" onClick={() => setEditMode(false)} className="rounded-lg border border-slate-300 px-4 py-2">إلغاء</button><button type="submit" className="rounded-lg bg-brand-700 px-5 py-2 font-bold text-white">حفظ التعديلات</button></div>
          </form>}
        </article>
      </div>}
      {message && !canManage && <p role="status" className="text-sm text-slate-700">{message}</p>}
    </div>
  );
}

function Input({ label, type = 'text', ...props }: { label: string; type?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return <label className="grid min-w-0 gap-1 text-sm font-semibold">{label}<input type={type} {...props} className="w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" /></label>;
}

import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, InputHTMLAttributes } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { loadXlsx } from '../../lib/xlsx';
import { exportBrandedXlsx } from '../../lib/brandedXlsx';
import { revealResidenceNumbers } from '../../lib/residence';
import { z } from 'zod';
import { AlertTriangle, ArrowLeft, ChevronDown, FileDown, Eye, EyeOff, MessageCircle, Phone, Search, Upload, X } from 'lucide-react';
import type { UserProfile } from '../../lib/auth';
import { useDisplayFormat } from '../../app/useDisplayFormat';
import { fetchAllPages, supabase } from '../../lib/supabase';
import { APP_SCHEMA_SELECT } from '../../lib/schemaColumns';
import { analyzeResidenceNumbers, effectiveEmployeeCategory, employeeCategorySchema, isSupervisorEligibleEmployee, matchesWorkforceCategoryFilter, type ResidenceEmployee } from '../../domain/workforce';
import { paginateRows, TABLE_PAGE_SIZE } from '../../lib/pagination';
import { TablePagination } from '../../components/TablePagination';
import { usePermission } from '../../app/permissionContext';
import { useSearchParams } from 'react-router-dom';
import { SupervisorSchoolAssignmentsPanel } from './SupervisorSchoolAssignmentsPanel';
import {
  employeeImportColumnDefinitions,
  parseEmployeeImportRows,
  suggestEmployeeImportColumnMap,
  type EmployeeImportColumnKey,
  type EmployeeImportColumnMap,
  type EmployeeImportRow,
} from '../../domain/employeeImport';

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const dbError = error as { code?: unknown; message: unknown; details?: unknown };
    const code = typeof dbError.code === 'string' ? ` (${dbError.code})` : '';
    const message = String(dbError.message);
    const details = typeof dbError.details === 'string' && dbError.details ? ` — ${dbError.details}` : '';
    return `${message}${code}${details}`;
  }
  return error instanceof Error ? error.message : String(error);
}

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
  phone: z.string().nullable().optional(),
  manager_id: z.string().uuid().nullable(),
  project_name: z.string().nullable(),
  identity_card_path: z.string().nullable().optional(),
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
  employee_category: employeeCategorySchema,
  department: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(30),
  manager_id: z.string().uuid().nullable(),
  project_name: z.string().trim().max(120),
});
type Employee = z.infer<typeof employeeSchema>;
const employeeImportPreviewRowSchema = z.object({
  row: z.number().int().positive(),
  fingerprint: z.string().min(1),
  status: z.enum(['new', 'update', 'no_change', 'conflict', 'needs_decision']),
  match_method: z.string().nullable(),
  employee_id: z.string().uuid().nullable(),
  employee_name: z.string().nullable(),
  employee_no: z.string().nullable(),
  candidates: z.array(z.object({
    id: z.string().uuid(),
    full_name: z.string(),
    employee_no: z.string().nullable(),
    job_title: z.string().nullable(),
    category: z.string(),
  })),
  diff: z.record(z.string(), z.object({
    old: z.unknown().optional(),
    new: z.unknown().optional(),
    changed: z.boolean().optional(),
    classification: z.string().optional(),
    default_action: z.string().optional(),
    requires_confirmation: z.boolean().optional(),
    has_active_school_assignment: z.boolean().optional(),
    valid: z.boolean().optional(),
    review_name: z.boolean().optional(),
    old_employee_no: z.string().nullable().optional(),
    new_employee_no: z.string().nullable().optional(),
  })),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
});
type EmployeeImportPreviewRow = z.infer<typeof employeeImportPreviewRowSchema>;
type EmployeeImportAction = 'pending' | 'create' | 'link' | 'update' | 'skip';
type EmployeeImportTab = 'new' | 'updates' | 'decisions' | 'conflicts' | 'unchanged' | 'missing';
type EmployeeImportDecision = {
  action: EmployeeImportAction;
  employeeId: string;
  useImportedName: boolean;
  confirmJobTitle: boolean;
  confirmCategory: boolean;
};
const employeeImportApplyResultSchema = z.object({
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  alias_conflicts: z.array(z.string()),
  school_assignments_before: z.object({
    maintenance: z.object({ supervisors: z.number().int().nonnegative(), schools: z.number().int().nonnegative() }),
    cleaning: z.object({ supervisors: z.number().int().nonnegative(), schools: z.number().int().nonnegative() }),
  }),
  school_assignments_after: z.object({
    maintenance: z.object({ supervisors: z.number().int().nonnegative(), schools: z.number().int().nonnegative() }),
    cleaning: z.object({ supervisors: z.number().int().nonnegative(), schools: z.number().int().nonnegative() }),
  }),
});
type EmployeeImportApplyResult = z.infer<typeof employeeImportApplyResultSchema>;

const employeeCategories = [
  ['engineer', 'مهندس'],
  ['supervisor', 'مشرف'],
  ['admin_staff', 'إداري'],
  ['technician', 'فني'],
  ['driver', 'سائق'],
  ['cleaner', 'عامل نظافة'],
  ['gatekeeper', 'حارس مدرسة'],
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
const employeeImportFieldLabels: Record<string, string> = {
  full_name: 'الاسم',
  employee_no: 'الرقم الوظيفي',
  job_title: 'المسمى الوظيفي',
  category: 'الفئة',
  department: 'القسم',
  phone: 'الجوال',
  residence_no: 'الإقامة',
  status: 'الحالة',
  nationality: 'الجنسية',
  hire_date: 'تاريخ التعيين',
  project_name: 'المشروع',
  manager_id: 'المدير المباشر',
  rating: 'التقييم',
};
const employeeImportStatusLabels: Record<EmployeeImportPreviewRow['status'], string> = {
  new: 'جديد',
  update: 'تحديث',
  no_change: 'بلا تغيير',
  conflict: 'تعارض',
  needs_decision: 'يحتاج قرارًا',
};

function employeeImportValueText(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'category' && typeof value === 'string') {
    return employeeCategoryLabels[value as keyof typeof employeeCategoryLabels] ?? value;
  }
  if (field === 'status' && typeof value === 'string') {
    return value === 'active' ? 'نشط' : value === 'inactive' ? 'غير نشط' : value === 'terminated' ? 'منتهي الخدمة' : value;
  }
  return String(value);
}

async function loadEmployees({
  canViewContacts,
  canViewIdImage,
}: {
  canViewContacts: boolean;
  canViewIdImage: boolean;
}): Promise<Employee[]> {
  if (!supabase) return [];
  const columns = [
    APP_SCHEMA_SELECT.employeesWorkforce,
    ...(canViewContacts ? ['phone'] : []),
    ...(canViewIdImage ? ['identity_card_path'] : []),
  ].join(',');
  const data = await fetchAllPages((from, to) => supabase!.from('employees')
    .select(columns)
    .order('full_name')
    .order('id')
    .range(from, to));
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

export function WorkforcePage({ profile }: { profile: UserProfile | null }) {
  const [searchParams] = useSearchParams();
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
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(() => searchParams.get('employeeId'));
  const [activeCardTab, setActiveCardTab] = useState<'profile' | 'schools'>('profile');
  const [editMode, setEditMode] = useState(false);
  const [identityCardUrl, setIdentityCardUrl] = useState('');
  const [identityCardError, setIdentityCardError] = useState('');
  const [identityViewerOpen, setIdentityViewerOpen] = useState(false);
  const [openingIdentityCard, setOpeningIdentityCard] = useState(false);
  const [identityCardFile, setIdentityCardFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');
  const [savingEmployee, setSavingEmployee] = useState(false);
  const isPrivileged = usePermission('settings.view');
  const canManage = Boolean(isPrivileged);
  const canImportEmployees = usePermission('workforce.import_employees');
  const [importFileName, setImportFileName] = useState('');
  const [importSourceRows, setImportSourceRows] = useState<Record<string, unknown>[] | null>(null);
  const [importHeaders, setImportHeaders] = useState<string[]>([]);
  const [importColumnMap, setImportColumnMap] = useState<EmployeeImportColumnMap>({});
  const [importRows, setImportRows] = useState<EmployeeImportRow[] | null>(null);
  const [importPreviewRows, setImportPreviewRows] = useState<EmployeeImportPreviewRow[] | null>(null);
  const [importDecisions, setImportDecisions] = useState<Record<number, EmployeeImportDecision>>({});
  const [activeImportTab, setActiveImportTab] = useState<EmployeeImportTab>('new');
  const [loadingImport, setLoadingImport] = useState(false);
  const [previewingImport, setPreviewingImport] = useState(false);
  const [applyingImport, setApplyingImport] = useState(false);
  const [confirmImportOpen, setConfirmImportOpen] = useState(false);
  const [confirmImportText, setConfirmImportText] = useState('');
  const [lastImportResult, setLastImportResult] = useState<EmployeeImportApplyResult | null>(null);
  const [expandedAbsenceCategories, setExpandedAbsenceCategories] = useState<Record<string, boolean>>({
    engineer: true,
    supervisor: true,
    admin_staff: true,
    technician: true,
    driver: true,
    cleaner: false,
    gatekeeper: false,
  });
  const canViewContacts = usePermission('workforce.view_contacts');
  const canViewIdImage = usePermission('workforce.view_id_image');
  const canManageSchoolAssignments = usePermission('workforce.assign_schools');
  const canRevealResidence = usePermission('residence.reveal');
  const employees = useQuery({
    queryKey: ['employees', canViewContacts, canViewIdImage],
    queryFn: () => loadEmployees({ canViewContacts, canViewIdImage }),
    enabled: Boolean(profile),
  });
  const ratings = useQuery({ queryKey: ['employee-ratings'], queryFn: loadRatings, enabled: Boolean(profile && isPrivileged) });
  const residenceQuality = useQuery({
    queryKey: ['workforce-residence-quality'],
    queryFn: loadResidenceQuality,
    enabled: Boolean(profile && isPrivileged),
    refetchInterval: 30_000,
  });
  const visibleEmployees = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return (employees.data ?? []).filter((employee) => employee.employee_category !== 'cleaner'
      && matchesWorkforceCategoryFilter(
        { category: employee.employee_category, jobTitle: employee.job_title },
        categoryFilter,
      )
      && (!statusFilter || employee.employment_status === statusFilter)
      && (!projectFilter || (employee.project_name ?? '').toLocaleLowerCase().includes(projectFilter.toLocaleLowerCase()))
      && `${employee.full_name} ${employee.employee_number ?? ''} ${employee.job_title ?? ''} ${employee.department ?? ''}`.toLocaleLowerCase().includes(query));
  }, [employees.data, search, categoryFilter, statusFilter, projectFilter]);
  const pagedEmployees = paginateRows(visibleEmployees, employeePage);
  const selectedEmployee = (employees.data ?? []).find((employee) => employee.id === selectedEmployeeId) ?? null;
  const importedEmployeeIds = useMemo(
    () => new Set((importPreviewRows ?? []).flatMap((row) => row.employee_id ? [row.employee_id] : [])),
    [importPreviewRows],
  );
  const employeesNotInFile = useMemo(
    () => (employees.data ?? []).filter((employee) => !importedEmployeeIds.has(employee.id)),
    [employees.data, importedEmployeeIds],
  );
  const employeesNotInFileByCategory = useMemo(() => employeesNotInFile.reduce<Record<string, Employee[]>>(
    (groups, employee) => {
      (groups[employee.employee_category] ??= []).push(employee);
      return groups;
    },
    {},
  ), [employeesNotInFile]);
  useEffect(() => {
    const employeeId = searchParams.get('employeeId');
    if (employeeId) setSelectedEmployeeId(employeeId);
  }, [searchParams]);
  const projectNames = useMemo(() => [...new Set((employees.data ?? [])
    .map((employee) => employee.project_name?.trim())
    .filter((project): project is string => Boolean(project)))]
    .sort((left, right) => left.localeCompare(right, 'ar')), [employees.data]);
  useEffect(() => {
    setIdentityCardUrl('');
    setIdentityCardError('');
    setIdentityViewerOpen(false);
    const identityCardPath = selectedEmployee?.identity_card_path;
    if (!supabase || !canViewIdImage || !identityCardPath) return;
    let cancelled = false;
    void (async () => {
      try {
        const { data, error } = await supabase.storage.from('employee-identity')
          .createSignedUrl(identityCardPath, 600);
        if (error) throw error;
        if (!data?.signedUrl) throw new Error('لم يُنشأ رابط مؤقت لصورة الهوية.');
        if (!cancelled) setIdentityCardUrl(data.signedUrl);
      } catch (error) {
        if (!cancelled) setIdentityCardError(`تعذر فتح صورة الهوية: ${errorMessage(error)}`);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedEmployeeId, selectedEmployee?.id, selectedEmployee?.identity_card_path, canViewIdImage]);
  const residenceIssues = residenceQuality.data?.issues ?? [];
  const sharedResidenceRecords = residenceQuality.data?.shared ?? [];
  const pagedResidenceIssues = paginateRows(residenceIssues, issuesPage);
  const pagedSharedResidenceRecords = paginateRows(sharedResidenceRecords, sharedPage);

  async function previewEmployeeImport(rows: EmployeeImportRow[]) {
    if (!supabase || !canImportEmployees) return setMessage('لا تملك صلاحية استيراد الموظفين.');
    setMessage('');
    setPreviewingImport(true);
    try {
      const { data, error } = await supabase.rpc('employee_import_preview', { p_rows: rows });
      if (error) throw error;
      const preview = z.object({ rows: z.array(employeeImportPreviewRowSchema) }).parse(data);
      setImportRows(rows);
      setImportPreviewRows(preview.rows);
      setImportDecisions(Object.fromEntries(preview.rows.map((row) => {
        const action: EmployeeImportAction = row.status === 'conflict' ? 'skip'
          : row.status === 'new' ? 'pending'
            : row.status === 'no_change' ? 'skip'
              : row.status === 'needs_decision' && (row.match_method === 'residence_no_needs_link' || row.match_method === 'name_candidate_link') ? 'link'
                : row.status === 'needs_decision' && row.employee_id ? 'update'
                    : row.status === 'update' ? 'update' : 'pending';
        return [row.row, {
          action,
          employeeId: row.employee_id ?? '',
          useImportedName: false,
          confirmJobTitle: false,
          confirmCategory: false,
        }];
      })));
    } catch (error) {
      setImportRows(null);
      setImportPreviewRows(null);
      setImportDecisions({});
      setMessage(`تعذرت معاينة الاستيراد: ${errorMessage(error)}`);
    } finally {
      setPreviewingImport(false);
    }
  }

  async function chooseImportCandidate(rowNumber: number, employeeId: string) {
    if (!importRows) return;
    const updatedRows = importRows.map((row, index) => index === rowNumber - 1
      ? { ...row, decision_employee_id: employeeId || undefined }
      : row);
    await previewEmployeeImport(updatedRows);
  }

  async function chooseImportAction(row: EmployeeImportPreviewRow, action: EmployeeImportAction) {
    if (!importRows) return;
    const storedRow = importRows[row.row - 1];
    if (action === 'create' && storedRow?.decision_employee_id) {
      const updatedRows = importRows.map((item, index) => index === row.row - 1
        ? { ...item, decision_employee_id: undefined }
        : item);
      await previewEmployeeImport(updatedRows);
    }
    setImportDecisions((current) => ({
      ...current,
      [row.row]: {
        action,
        employeeId: current[row.row]?.employeeId ?? row.employee_id ?? '',
        useImportedName: current[row.row]?.useImportedName ?? false,
        confirmJobTitle: current[row.row]?.confirmJobTitle ?? false,
        confirmCategory: current[row.row]?.confirmCategory ?? false,
      },
    }));
  }

  async function openIdentityCard() {
    if (!supabase || !selectedEmployee || !canViewIdImage || !selectedEmployee.identity_card_path) return;
    setOpeningIdentityCard(true);
    setIdentityCardError('');
    try {
      const { error } = await supabase.rpc('log_employee_identity_open', {
        p_employee_id: selectedEmployee.id,
      });
      if (error) throw error;
      if (!identityCardUrl) throw new Error('تعذر تجهيز صورة الهوية للعرض.');
      setIdentityViewerOpen(true);
    } catch (error) {
      setIdentityCardError(`تعذر فتح صورة الهوية: ${errorMessage(error)}`);
    } finally {
      setOpeningIdentityCard(false);
    }
  }

  async function saveEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    if (!supabase || !profile || !canManage) return setMessage('لا تملك صلاحية إدارة سجل الموظفين.');
    const form = event.currentTarget;
    const formData = new FormData(form);
    const parsed = employeeInputSchema.safeParse({
      full_name: formData.get('full_name'),
      employee_number: formData.get('employee_number'),
      job_title: formData.get('job_title'),
      employee_category: formData.get('employee_category'),
      department: formData.get('department'),
      phone: formData.get('phone'),
      manager_id: String(formData.get('manager_id') ?? '') || null,
      project_name: formData.get('project_name'),
    });
    if (!parsed.success) return setMessage('تحقق من الاسم والرقم الوظيفي والوظيفة والفئة والقسم.');
    setSavingEmployee(true);
    try {
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
      form.reset();
    } catch (error) {
      return setMessage(`تعذر حفظ الموظف: ${errorMessage(error)}`);
    } finally {
      setSavingEmployee(false);
    }
    setMessage('تم حفظ بيانات الموظف.');
    await queryClient.invalidateQueries({ queryKey: ['employees'] });
  }

  async function importWorkbook(file: File) {
    setMessage('');
    if (!supabase || !profile || !canImportEmployees) return setMessage('لا تملك صلاحية استيراد الموظفين.');
    setImportFileName('');
    setImportSourceRows(null);
    setImportHeaders([]);
    setImportColumnMap({});
    setImportRows(null);
    setImportPreviewRows(null);
    setImportDecisions({});
    setLastImportResult(null);
    setConfirmImportOpen(false);
    if (file.size > 5 * 1024 * 1024) return setMessage('الحد الأقصى لحجم الملف 5 ميجابايت.');
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) return setMessage('الصيغ المسموحة: XLSX وXLS وCSV.');
    setLoadingImport(true);
    try {
      const XLSX = await loadXlsx();
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const firstSheet = workbook.SheetNames[0];
      if (!firstSheet) throw new Error('الملف لا يحتوي على ورقة بيانات.');
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[firstSheet], { defval: '', raw: false });
      if (!rawRows.length) throw new Error('ورقة البيانات فارغة.');
      const headers = Object.keys(rawRows[0]);
      if (!headers.length) throw new Error('لم يتم العثور على عناوين أعمدة في الورقة الأولى.');
      setImportFileName(file.name);
      setImportSourceRows(rawRows);
      setImportHeaders(headers);
      setImportColumnMap(suggestEmployeeImportColumnMap(headers));
      setMessage('تحقق من مطابقة عناوين الأعمدة ثم اعرض المعاينة.');
    } catch (error) {
      setImportSourceRows(null);
      setMessage(error instanceof Error ? `تعذر إكمال الاستيراد: ${error.message}` : 'تعذر قراءة ملف الاستيراد.');
    } finally {
      setLoadingImport(false);
    }
  }

  async function previewMappedEmployeeRows() {
    if (!importSourceRows) return;
    if (!importColumnMap.full_name) return setMessage('حدد العمود المقابل للاسم قبل المعاينة.');
    if (!importColumnMap.category) return setMessage('حدد العمود المقابل للفئة الوظيفية قبل المعاينة.');
    const mappedRows = parseEmployeeImportRows(importSourceRows, importColumnMap);
    setLastImportResult(null);
    setActiveImportTab('new');
    await previewEmployeeImport(mappedRows);
  }

  function updateEmployeeImportColumn(field: EmployeeImportColumnKey, header: string) {
    setImportColumnMap((current) => ({ ...current, [field]: header || undefined }));
    setImportRows(null);
    setImportPreviewRows(null);
    setImportDecisions({});
    setLastImportResult(null);
    setMessage('تغيرت مطابقة الأعمدة؛ أعد المعاينة قبل التطبيق.');
  }

  function requestEmployeeImportApply() {
    if (!supabase || !importRows || !importPreviewRows || !canImportEmployees) {
      return setMessage('تعذر تطبيق الاستيراد؛ أعد معاينة الملف وتحقق من الصلاحية.');
    }
    if (importPreviewRows.some((row) => {
      const decision = importDecisions[row.row];
      return !decision || decision.action === 'pending'
        || (decision.action === 'link' && !decision.employeeId);
    })) {
      return setMessage('اتخذ قرارًا صريحًا لكل صف جديد أو يحتاج إلى قرار.');
    }
    setMessage('');
    setConfirmImportText('');
    setConfirmImportOpen(true);
  }

  async function applyEmployeeImport() {
    if (!supabase || !importRows || !importPreviewRows || !canImportEmployees) {
      return setMessage('تعذر تطبيق الاستيراد؛ أعد معاينة الملف وتحقق من الصلاحية.');
    }
    const decisions = importPreviewRows.map((row) => {
      const decision = importDecisions[row.row];
      return {
        row: row.row,
        fingerprint: row.fingerprint,
        action: decision.action,
        employee_id: decision.employeeId || row.employee_id,
        use_imported_name: decision.useImportedName,
        confirm_job_title: decision.confirmJobTitle,
        confirm_category: decision.confirmCategory,
      };
    });
    setApplyingImport(true);
    setMessage('');
    try {
      const { data, error } = await supabase.rpc('employee_import_apply', {
        p_rows: importRows,
        p_decisions: decisions,
      });
      if (error) throw error;
      const result = employeeImportApplyResultSchema.parse(data);
      setLastImportResult(result);
      const assignmentsUnchanged = (['maintenance', 'cleaning'] as const).every((service) =>
        result.school_assignments_before[service]?.supervisors === result.school_assignments_after[service]?.supervisors
        && result.school_assignments_before[service]?.schools === result.school_assignments_after[service]?.schools);
      if (!assignmentsUnchanged) {
        throw new Error('أعاد الخادم أعداد إسنادات مختلفة قبل التطبيق وبعده.');
      }
      const maintenance = result.school_assignments_after.maintenance;
      const cleaning = result.school_assignments_after.cleaning;
      setMessage(`اكتمل الاستيراد: ${result.created} جديد، ${result.updated} محدّث، ${result.skipped} مستبعد. الإسنادات بقيت كما هي: صيانة ${maintenance.supervisors} مشرف و${maintenance.schools} مدرسة، ونظافة ${cleaning.supervisors} مشرف و${cleaning.schools} مدرسة.`);
      if (result.alias_conflicts.length) {
        setMessage((current) => `${current} تعذر ربط ${result.alias_conflicts.length} اسمًا بديلًا لتعارضه مع موظف آخر.`);
      }
      setImportRows(null);
      setImportPreviewRows(null);
      setImportDecisions({});
      setImportSourceRows(null);
      setImportHeaders([]);
      setImportColumnMap({});
      setConfirmImportOpen(false);
      setConfirmImportText('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['employees'] }),
        queryClient.invalidateQueries({ queryKey: ['employee-ratings'] }),
        queryClient.invalidateQueries({ queryKey: ['workforce-residence-quality'] }),
      ]);
    } catch (error) {
      setConfirmImportOpen(false);
      setMessage(`تعذر تطبيق الاستيراد: ${errorMessage(error)}`);
    } finally {
      setApplyingImport(false);
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
      let identityCardPath = selectedEmployee.identity_card_path ?? null;
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
      setMessage(`تعذر تصدير بيانات القوى العاملة: ${errorMessage(error)}`);
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
      setMessage(`تعذر تصدير تقرير جودة أرقام الإقامة: ${errorMessage(error)}`);
    }
  }

  const importPreviewSource = importPreviewRows ?? [];
  const importTabCounts: Record<EmployeeImportTab, number> = {
    new: importPreviewSource.filter((row) => row.status === 'new').length,
    updates: importPreviewSource.filter((row) => row.status === 'update').length,
    decisions: importPreviewSource.filter((row) => row.status === 'needs_decision').length,
    conflicts: importPreviewSource.filter((row) => row.status === 'conflict').length,
    unchanged: importPreviewSource.filter((row) => row.status === 'no_change').length,
    missing: employeesNotInFile.length,
  };
  const importTabLabels: Record<EmployeeImportTab, string> = {
    new: 'جديد',
    updates: 'تحديثات',
    decisions: 'يحتاج قرارًا',
    conflicts: 'تعارضات',
    unchanged: 'بلا تغيير',
    missing: 'في التطبيق وليس بالملف',
  };
  const activePreviewRows = importPreviewSource.filter((row) => {
    if (activeImportTab === 'new') return row.status === 'new';
    if (activeImportTab === 'updates') return row.status === 'update';
    if (activeImportTab === 'decisions') return row.status === 'needs_decision';
    if (activeImportTab === 'conflicts') return row.status === 'conflict';
    if (activeImportTab === 'unchanged') return row.status === 'no_change';
    return false;
  });

  return (
    <div className="workforce-page grid min-w-0 gap-5">
      <section className="min-w-0"><p className="text-xs text-slate-500 sm:text-sm">طاقم الشركة الداخلي؛ لا يشمل عمال النظافة بعقد أجير</p><h2 className="mt-1 text-xl font-bold text-brand-900 sm:text-2xl">القوى العاملة</h2></section>
      {(employees.error || (isPrivileged && ratings.error)) && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
        تعذر تحميل بيانات القوى العاملة: {employees.error ? `سجل الموظفين: ${employees.error.message}` : `التقييمات: ${ratings.error instanceof Error ? ratings.error.message : String(ratings.error)}`}
      </div>}
      {(canManage || canImportEmployees) && <section className="card grid min-w-0 gap-4 p-4 sm:p-5">
        <h3 className="font-bold">{canManage ? 'إضافة موظف أو استيراد ملف' : 'استيراد الموظفين'}</h3>
        {canManage && <form
          noValidate
          className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3"
          onSubmit={saveEmployee}
        >
          <Input label="اسم الموظف" name="full_name" required />
          <Input label="الرقم الوظيفي" name="employee_number" required />
          <Input label="الوظيفة" name="job_title" required />
          <label className="grid min-w-0 gap-1 text-sm font-semibold">الفئة الوظيفية
            <select name="employee_category" defaultValue="technician" required className="w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"><option value="">اختر الفئة</option>{employeeCategories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          </label>
          <Input label="القسم" name="department" required />
          <Input label="رقم التواصل" type="tel" name="phone" />
          <Input label="المشروع" name="project_name" />
          <label className="grid min-w-0 gap-1 text-sm font-semibold">المسؤول المباشر
            <select name="manager_id" defaultValue="" className="w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"><option value="">بدون مسؤول محدد</option>{(employees.data ?? []).map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name} · {employee.job_title}</option>)}</select>
          </label>
          <div className="workforce-employee-form-actions">
            <button type="submit" disabled={savingEmployee} className="workforce-save-employee-button">
              {savingEmployee ? 'جارٍ الحفظ…' : 'حفظ الموظف'}
            </button>
          </div>
        </form>}
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          {canImportEmployees && <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold"><Upload size={16} />{loadingImport ? 'جارٍ قراءة الملف…' : 'استيراد الموظفين من Excel'}<input type="file" accept=".xlsx,.xls,.csv" className="sr-only" disabled={loadingImport || previewingImport || applyingImport} onChange={(event) => { const file = event.target.files?.[0]; if (file) void importWorkbook(file); event.currentTarget.value = ''; }} /></label>}
          {canManage && <button type="button" onClick={() => void exportEmployees()} disabled={!employees.data?.length} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50"><FileDown size={16} /> تصدير البيانات</button>}
          <span className="min-w-0 flex-1 text-xs leading-5 text-slate-500">تُراجع الصفوف قبل الحفظ؛ إنشاء الموظف أو ربط الاسم يتطلب قرارًا صريحًا. الجوال والإقامة لا تظهر قيمتهما في الفروقات.</span>
        </div>
        {importSourceRows && <section className="grid min-w-0 gap-4 rounded-xl border border-blue-200 bg-blue-50/60 p-4" aria-labelledby="employee-import-map-title">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 id="employee-import-map-title" className="font-bold">مطابقة أعمدة الملف</h4>
              <p className="mt-1 text-sm text-slate-600">{importFileName} · {importSourceRows.length} صفًا · راجع التخمينات وعدّلها قبل المعاينة.</p>
            </div>
            <button type="button" disabled={loadingImport || previewingImport || applyingImport} onClick={() => {
              setImportSourceRows(null);
              setImportHeaders([]);
              setImportColumnMap({});
              setImportFileName('');
              setMessage('');
            }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-50">إلغاء الملف</button>
          </div>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {employeeImportColumnDefinitions.map((definition) => {
              const field: EmployeeImportColumnKey = definition.key;
              return <label key={field} className="grid min-w-0 gap-1 text-sm font-semibold">
                <span>{definition.label}{'required' in definition && definition.required && <span className="ms-1 text-rose-700">*</span>}</span>
                <select
                  value={importColumnMap[field] ?? ''}
                  onChange={(event) => updateEmployeeImportColumn(field, event.target.value)}
                  disabled={previewingImport || applyingImport}
                  className="w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
                >
                  <option value="">لا يوجد عمود</option>
                  {importHeaders.map((header) => <option key={header} value={header}>{header}</option>)}
                </select>
              </label>;
            })}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => void previewMappedEmployeeRows()} disabled={loadingImport || previewingImport || applyingImport} className="rounded-lg bg-brand-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {previewingImport ? 'جارٍ تجهيز المعاينة…' : 'معاينة البيانات'}
            </button>
            <span className="text-xs text-slate-600">الاسم والفئة الوظيفية مطلوبان؛ الأعمدة الاختيارية يمكن تركها بلا مطابقة.</span>
          </div>
        </section>}
        {importPreviewRows && <section className="grid min-w-0 gap-4 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 className="font-bold">معاينة استيراد الموظفين ({importPreviewRows.length} صف)</h4>
              <p className="mt-1 text-xs leading-5 text-slate-600">المطابقة بالرقم الوظيفي ثم الإقامة؛ الاسم يقترح مرشحين فقط ولا يطابق تلقائيًا. الأرقام الحساسة لا تُعرض.</p>
            </div>
            <button type="button" disabled={previewingImport || applyingImport} onClick={() => {
              setImportRows(null);
              setImportPreviewRows(null);
              setImportDecisions({});
              setImportSourceRows(null);
              setImportHeaders([]);
              setImportColumnMap({});
            }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-50">إلغاء المعاينة</button>
          </div>
          <div role="tablist" aria-label="تصنيفات معاينة استيراد الموظفين" className="flex min-w-0 gap-2 overflow-x-auto pb-1">
            {(Object.keys(importTabLabels) as EmployeeImportTab[]).map((tab) => <button
              key={tab}
              type="button"
              role="tab"
              id={`employee-import-tab-${tab}`}
              aria-controls="employee-import-tabpanel"
              aria-selected={activeImportTab === tab}
              onClick={() => setActiveImportTab(tab)}
              className={`shrink-0 rounded-lg border px-3 py-2 text-sm font-semibold ${
                activeImportTab === tab
                  ? 'border-brand-700 bg-brand-800 text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
              }`}
            >{importTabLabels[tab]} ({importTabCounts[tab]})</button>)}
          </div>
          <div id="employee-import-tabpanel" role="tabpanel" aria-labelledby={`employee-import-tab-${activeImportTab}`} className="grid min-w-0 gap-3">
            {activeImportTab === 'missing' ? (
              <section className="grid gap-3" aria-label="الموظفون غير الموجودين في الملف">
                {employees.isLoading && <p role="status" className="text-sm text-slate-600">جارٍ تحميل سجل الموظفين لمقارنته بالملف…</p>}
                {employees.error && <p role="alert" className="text-sm text-rose-700">تعذر تحميل سجل الموظفين: {employees.error.message}</p>}
                {!employees.isLoading && employeesNotInFile.length === 0 && <p className="rounded-lg bg-white p-4 text-sm text-slate-600">كل سجلات التطبيق موجودة ضمن المطابقات في هذا الملف.</p>}
                {employeeCategories.map(([category, label]) => {
                  const group = employeesNotInFileByCategory[category] ?? [];
                  if (group.length === 0) return null;
                  const expanded = expandedAbsenceCategories[category] ?? true;
                  const emphasizedCategory = category === 'supervisor' || category === 'engineer';
                  return <section key={category} className={`min-w-0 overflow-hidden rounded-xl border ${
                    emphasizedCategory ? 'border-rose-300 bg-rose-50/60' : 'border-slate-200 bg-white'
                  }`}>
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => setExpandedAbsenceCategories((current) => ({ ...current, [category]: !expanded }))}
                      className="flex w-full min-w-0 items-center justify-between gap-3 p-3 text-start"
                    >
                      <span className="flex min-w-0 flex-wrap items-center gap-2">
                        <strong>{label}</strong>
                        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs">{group.length}</span>
                        {emphasizedCategory && <span className="rounded-full bg-rose-200 px-2 py-0.5 text-xs font-bold text-rose-900">مراجعة مهمة</span>}
                      </span>
                      <ChevronDown size={18} className={`shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                    </button>
                    {expanded && <div className="grid gap-2 border-t border-slate-200 p-3 sm:grid-cols-2 xl:grid-cols-3">
                      {group.map((employee) => {
                        const flaggedEmployeeNo = !employee.employee_number || /^(TEMP-|Z6-)/i.test(employee.employee_number);
                        return <article
                          key={employee.id}
                          className={`min-w-0 rounded-lg border p-3 ${
                            flaggedEmployeeNo ? 'border-amber-400 bg-amber-50 ring-1 ring-amber-300' : 'border-slate-200 bg-white'
                          }`}
                        >
                          <strong className="block break-words text-sm">{employee.full_name}</strong>
                          <span className="mt-1 block break-words text-xs text-slate-600">{employee.job_title || 'دون مسمى'} · {employee.employee_number || 'الرقم الوظيفي فارغ'}</span>
                          {flaggedEmployeeNo && <span className="mt-2 inline-flex rounded-full bg-amber-200 px-2 py-1 text-xs font-bold text-amber-950">
                            {!employee.employee_number ? 'رقم وظيفي فارغ' : `رقم مؤقت: ${employee.employee_number}`}
                          </span>}
                        </article>;
                      })}
                    </div>}
                  </section>;
                })}
              </section>
            ) : activePreviewRows.length === 0 ? (
              <p className="rounded-lg bg-white p-4 text-sm text-slate-600">لا توجد صفوف في هذا التبويب.</p>
            ) : activePreviewRows.map((row) => {
              const decision = importDecisions[row.row];
              const sourceRow = importRows?.[row.row - 1];
              const changedFields = Object.entries(row.diff).filter(([, diff]) => diff.changed);
              const hasCandidates = row.status === 'needs_decision'
                && (row.match_method === null || row.match_method === 'name_candidate_link' || row.match_method === 'residence_no_needs_link');
              const hasNameChangeDecision = row.diff.full_name?.changed
                && row.diff.full_name.classification === 'different'
                && !row.diff.full_name.review_name;
              const hasActiveAssignmentChange = ['job_title', 'category'].some((field) =>
                row.diff[field]?.changed && row.diff[field]?.has_active_school_assignment);
              const missingPhone = !sourceRow?.phone?.trim();
              const missingResidence = !sourceRow?.residence_no?.trim();
              const reviewNameFlagged = Boolean(row.diff.full_name?.review_name)
                || ['yes', 'true', '1', 'نعم', 'ن'].includes(sourceRow?.review_name.trim().toLocaleLowerCase() ?? '');
              const nameClassification = row.diff.full_name?.classification;
              const nameClassificationLabel = nameClassification === 'same' ? 'نفس الاسم'
                : nameClassification === 'completion' ? 'إكمال الاسم'
                  : nameClassification === 'different' ? 'اسم مختلف' : '';
              return <article key={row.row} className="grid min-w-0 gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong>صف {row.row}</strong>
                      <span className={`rounded-full px-2 py-1 text-xs font-bold ${
                        row.status === 'conflict' ? 'bg-rose-100 text-rose-800'
                          : row.status === 'needs_decision' ? 'bg-amber-100 text-amber-900'
                            : row.status === 'new' ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-slate-100 text-slate-700'
                      }`}>{employeeImportStatusLabels[row.status]}</span>
                      {reviewNameFlagged && <span className="rounded-full bg-yellow-200 px-2 py-1 text-xs font-bold text-yellow-950">مراجعة الاسم: نعم</span>}
                      {missingPhone && <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-bold text-amber-900">الجوال: ناقص</span>}
                      {missingResidence && <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-bold text-amber-900">الإقامة: ناقص</span>}
                    </div>
                    {row.employee_name && <p className="mt-1 break-words text-sm font-semibold">{row.employee_name} · {row.employee_no ?? 'دون رقم وظيفي'}</p>}
                    {nameClassificationLabel && <p className="mt-1 text-xs text-slate-600">تصنيف الاسم: <strong>{nameClassificationLabel}</strong></p>}
                  </div>
                  {decision?.action === 'update' && <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-800">قرار التحديث: {changedFields.length} حقل</span>}
                </div>
                {hasActiveAssignmentChange && <div role="alert" className="flex min-w-0 items-start gap-2 rounded-lg border-2 border-amber-400 bg-amber-50 p-3 text-sm font-bold text-amber-950">
                  <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                  <span>تنبيه: تغيير الفئة أو الوظيفة لموظف لديه مدارس مسندة نشطة يتطلب تأكيدًا مستقلًا؛ عدد المشرفين والمدارس المسندة لن يتغير.</span>
                </div>}
                <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                  <div className="min-w-0">
                    {row.errors.map((error) => <p key={error} className="mb-1 break-words text-xs text-rose-700">{error}</p>)}
                    {row.warnings.map((warning) => <p key={warning} className="mb-1 break-words text-xs text-amber-800">{warning}</p>)}
                    {changedFields.length === 0 ? <p className="text-sm text-slate-500">لا توجد فروقات.</p> : <ul className="grid gap-2 sm:grid-cols-2">
                      {changedFields.map(([field, diff]) => <li key={field} className="min-w-0 rounded-lg bg-slate-50 p-2 text-xs">
                        <strong>{employeeImportFieldLabels[field] ?? field}</strong>
                        <span className="mt-1 block break-words">
                          {field === 'phone' || field === 'residence_no'
                            ? 'قيمة صالحة مختلفة (مخفية)'
                            : <>قبل: {employeeImportValueText(field, diff.old)} <span aria-hidden="true">←</span> بعد: {employeeImportValueText(field, diff.new)}</>}
                        </span>
                        {diff.requires_confirmation && <span className="mt-1 block font-bold text-amber-800">يتطلب تأكيدًا مستقلًا</span>}
                      </li>)}
                    </ul>}
                  </div>
                  <div className="grid min-w-0 content-start gap-3">
                    {hasCandidates && row.candidates.length > 0 && <div className="grid gap-2">
                      <h5 className="text-sm font-bold">مرشحو الربط بالاسم — اختر قرارًا صريحًا</h5>
                      {row.candidates.map((candidate) => <article key={candidate.id} className={`grid min-w-0 gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center ${
                        decision?.employeeId === candidate.id && decision.action === 'link' ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 bg-slate-50'
                      }`}>
                        <div className="min-w-0">
                          <strong className="block break-words text-sm">{candidate.full_name}</strong>
                          <span className="mt-1 block break-words text-xs text-slate-600">{candidate.employee_no ?? 'دون رقم'} · {candidate.job_title ?? employeeCategoryLabels[candidate.category as keyof typeof employeeCategoryLabels] ?? ''}</span>
                        </div>
                        <button
                          type="button"
                          disabled={previewingImport || applyingImport || (decision?.employeeId === candidate.id && decision.action === 'link')}
                          onClick={() => void chooseImportCandidate(row.row, candidate.id)}
                          className="rounded-lg border border-emerald-700 bg-white px-3 py-2 text-xs font-bold text-emerald-800 disabled:opacity-50"
                        >{decision?.employeeId === candidate.id && decision.action === 'link' ? 'مرتبط بهذا الموظف' : 'ربط بهذا الموظف'}</button>
                      </article>)}
                    </div>}
                    {row.status === 'conflict' && <button type="button" disabled={previewingImport || applyingImport} onClick={() => void chooseImportAction(row, 'skip')} className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800 disabled:opacity-50">
                      {decision?.action === 'skip' ? 'تم اختيار تجاهل التعارض' : 'تجاهل التعارض'}
                    </button>}
                    {row.status === 'new' && <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={previewingImport || applyingImport} onClick={() => void chooseImportAction(row, 'create')} className={`rounded-lg px-3 py-2 text-sm font-bold disabled:opacity-50 ${decision?.action === 'create' ? 'bg-emerald-700 text-white' : 'border border-emerald-700 bg-white text-emerald-800'}`}>إنشاء موظف</button>
                      <button type="button" disabled={previewingImport || applyingImport} onClick={() => void chooseImportAction(row, 'skip')} className={`rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50 ${decision?.action === 'skip' ? 'bg-slate-700 text-white' : 'border border-slate-300 bg-white text-slate-700'}`}>تجاهل</button>
                    </div>}
                    {hasCandidates && <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={previewingImport || applyingImport} onClick={() => void chooseImportAction(row, 'create')} className={`rounded-lg px-3 py-2 text-sm font-bold disabled:opacity-50 ${decision?.action === 'create' ? 'bg-emerald-700 text-white' : 'border border-emerald-700 bg-white text-emerald-800'}`}>إنشاء جديد</button>
                      <button type="button" disabled={previewingImport || applyingImport} onClick={() => void chooseImportAction(row, 'skip')} className={`rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50 ${decision?.action === 'skip' ? 'bg-slate-700 text-white' : 'border border-slate-300 bg-white text-slate-700'}`}>تجاهل</button>
                    </div>}
                    {row.status === 'needs_decision' && !hasCandidates && <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={previewingImport || applyingImport} onClick={() => void chooseImportAction(row, 'update')} className={`rounded-lg px-3 py-2 text-sm font-bold disabled:opacity-50 ${decision?.action === 'update' ? 'bg-blue-800 text-white' : 'border border-blue-700 bg-white text-blue-800'}`}>تطبيق التحديثات الافتراضية</button>
                      <button type="button" disabled={previewingImport || applyingImport} onClick={() => void chooseImportAction(row, 'skip')} className={`rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50 ${decision?.action === 'skip' ? 'bg-slate-700 text-white' : 'border border-slate-300 bg-white text-slate-700'}`}>تجاهل</button>
                    </div>}
                    {row.status === 'update' && <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={previewingImport || applyingImport} onClick={() => void chooseImportAction(row, 'update')} className={`rounded-lg px-3 py-2 text-sm font-bold disabled:opacity-50 ${decision?.action === 'update' ? 'bg-blue-800 text-white' : 'border border-blue-700 bg-white text-blue-800'}`}>تطبيق التحديث</button>
                      <button type="button" disabled={previewingImport || applyingImport} onClick={() => void chooseImportAction(row, 'skip')} className={`rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50 ${decision?.action === 'skip' ? 'bg-slate-700 text-white' : 'border border-slate-300 bg-white text-slate-700'}`}>تجاهل</button>
                    </div>}
                    {decision?.action === 'update' && hasNameChangeDecision && <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-2 text-xs">
                      <input type="checkbox" disabled={previewingImport || applyingImport} checked={decision.useImportedName} onChange={(event) => setImportDecisions((current) => ({
                        ...current,
                        [row.row]: { ...decision, useImportedName: event.target.checked },
                      }))} />
                      استبدال الاسم المختلف بالاسم الوارد
                    </label>}
                    {decision?.action === 'update' && row.diff.job_title?.requires_confirmation && <label className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs font-semibold">
                      <input type="checkbox" disabled={previewingImport || applyingImport} checked={decision.confirmJobTitle} onChange={(event) => setImportDecisions((current) => ({
                        ...current,
                        [row.row]: { ...decision, confirmJobTitle: event.target.checked },
                      }))} />
                      أؤكد تحديث الوظيفة
                    </label>}
                    {decision?.action === 'update' && row.diff.category?.requires_confirmation && <label className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs font-semibold">
                      <input type="checkbox" disabled={previewingImport || applyingImport} checked={decision.confirmCategory} onChange={(event) => setImportDecisions((current) => ({
                        ...current,
                        [row.row]: { ...decision, confirmCategory: event.target.checked },
                      }))} />
                      أؤكد تحديث الفئة
                    </label>}
                    {row.match_method === 'residence_no_needs_link' && decision?.action === 'link' && <p className="text-xs font-semibold text-amber-800">سيُحدّث الرقم الوظيفي للسجل المختار.</p>}
                  </div>
                </div>
              </article>;
            })}
          </div>
          {activeImportTab !== 'missing' && <button
            type="button"
            onClick={requestEmployeeImportApply}
            disabled={previewingImport || applyingImport || importPreviewRows.some((row) => {
              const decision = importDecisions[row.row];
              return !decision || decision.action === 'pending'
                || (decision.action === 'link' && !decision.employeeId);
            })}
            className="justify-self-start rounded-lg bg-brand-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >تطبيق القرارات</button>}
        </section>}
        {lastImportResult && <section className="grid min-w-0 gap-3 rounded-xl border border-emerald-300 bg-emerald-50 p-4" aria-labelledby="employee-import-result-title">
          <div>
            <h4 id="employee-import-result-title" className="font-bold text-emerald-950">نتيجة استيراد الموظفين</h4>
            <p className="mt-1 text-sm text-emerald-900">{lastImportResult.created} جديد · {lastImportResult.updated} محدّث · {lastImportResult.skipped} متجاهل</p>
          </div>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            {([
              ['maintenance', 'الصيانة'],
              ['cleaning', 'النظافة'],
            ] as const).map(([service, label]) => <article key={service} className="rounded-lg border border-emerald-200 bg-white p-3">
              <h5 className="font-bold">{label}</h5>
              <div className="mt-2 grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1 text-xs">
                <span className="font-semibold">قبل / بعد</span><strong>قبل</strong><strong>بعد</strong>
                <span>المشرفون ذوو المدارس</span>
                <span>{lastImportResult.school_assignments_before[service].supervisors}</span>
                <span>{lastImportResult.school_assignments_after[service].supervisors}</span>
                <span>المدارس المسندة</span>
                <span>{lastImportResult.school_assignments_before[service].schools}</span>
                <span>{lastImportResult.school_assignments_after[service].schools}</span>
              </div>
            </article>)}
          </div>
        </section>}
        {confirmImportOpen && importRows && <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/50 p-4">
          <section role="dialog" aria-modal="true" aria-labelledby="employee-import-confirm-title" className="grid w-full max-w-md gap-4 rounded-2xl bg-white p-5 shadow-2xl">
            <div>
              <h4 id="employee-import-confirm-title" className="text-lg font-bold">تأكيد تطبيق الاستيراد</h4>
              <p className="mt-1 text-sm leading-6 text-slate-600">سيتم تطبيق القرارات على {importRows.length} صفًا في عملية واحدة. اكتب العدد للتأكيد.</p>
            </div>
            <label className="grid gap-1 text-sm font-semibold">
              اكتب {importRows.length}
              <input
                autoFocus
                inputMode="numeric"
                value={confirmImportText}
                onChange={(event) => setConfirmImportText(event.target.value)}
                disabled={applyingImport}
                className="rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" disabled={applyingImport} onClick={() => setConfirmImportOpen(false)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-50">إلغاء</button>
              <button type="button" disabled={applyingImport || confirmImportText.trim() !== String(importRows.length)} onClick={() => void applyEmployeeImport()} className="rounded-lg bg-brand-800 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">
                {applyingImport ? 'جارٍ التطبيق…' : 'تأكيد التطبيق'}
              </button>
            </div>
          </section>
        </div>}
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
                <td data-label="الاسم" className="font-semibold"><button type="button" onClick={() => { setSelectedEmployeeId(employee.id); setActiveCardTab('profile'); setEditMode(false); setIdentityCardFile(null); }} className="text-brand-800 underline decoration-brand-200 underline-offset-4 hover:text-brand-950">{employee.full_name}</button></td>
                <td data-label="الرقم الوظيفي">{employee.employee_number ?? '—'}</td>
                <td data-label="الوظيفة">{employee.job_title ?? '—'}</td>
                <td data-label="الفئة الوظيفية">{employeeCategoryLabels[effectiveEmployeeCategory({ category: employee.employee_category, jobTitle: employee.job_title }) as keyof typeof employeeCategoryLabels] ?? '—'}</td>
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
        <article className="card flex max-h-[90vh] w-full max-w-[720px] flex-col overflow-hidden p-4 sm:p-5">
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 pb-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 id="employee-profile-title" className="text-2xl font-bold leading-tight text-brand-900">{selectedEmployee.full_name}</h3>
                <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${selectedEmployee.employment_status === 'active' ? 'bg-emerald-50 text-emerald-700' : selectedEmployee.employment_status === 'inactive' ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>
                  {selectedEmployee.employment_status === 'active' ? 'نشط' : selectedEmployee.employment_status === 'inactive' ? 'غير نشط' : 'منتهي الخدمة'}
                </span>
                {isSupervisorEligibleEmployee({
                  category: selectedEmployee.employee_category,
                  jobTitle: selectedEmployee.job_title,
                })
                  && (!selectedEmployee.employee_number || !selectedEmployee.job_title || !selectedEmployee.phone || !selectedEmployee.nationality || !selectedEmployee.hire_date)
                  && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800">بيانات ناقصة</span>}
              </div>
              <p className="mt-1 text-sm leading-5 text-slate-500">
                {[selectedEmployee.job_title, selectedEmployee.department, selectedEmployee.project_name].filter(Boolean).join(' · ') || '—'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {canViewContacts && selectedEmployee.phone && <>
                <a href={`tel:${selectedEmployee.phone}`} aria-label="اتصال بالموظف" title="اتصال" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"><Phone size={18} /></a>
                <a href={`https://wa.me/${selectedEmployee.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" aria-label="مراسلة الموظف عبر واتساب" title="واتساب" className="rounded-lg p-2 text-emerald-700 hover:bg-emerald-50"><MessageCircle size={18} /></a>
              </>}
              <button type="button" onClick={() => { setSelectedEmployeeId(null); setActiveCardTab('profile'); setEditMode(false); setIdentityCardFile(null); setIdentityViewerOpen(false); }} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="إغلاق بطاقة الموظف"><X size={18} /></button>
            </div>
          </div>
          {!editMode && isSupervisorEligibleEmployee({
            category: selectedEmployee.employee_category,
            jobTitle: selectedEmployee.job_title,
          }) && <div role="tablist" aria-label="تبويبات بطاقة الموظف" className="mt-2 flex shrink-0 gap-1 border-b border-slate-100">
            <button type="button" role="tab" aria-selected={activeCardTab === 'profile'} onClick={() => setActiveCardTab('profile')} className={`border-b-2 px-3 py-1.5 text-xs font-semibold ${activeCardTab === 'profile' ? 'border-brand-700 text-brand-800' : 'border-transparent text-slate-500'}`}>البيانات</button>
            <button type="button" role="tab" aria-selected={activeCardTab === 'schools'} onClick={() => setActiveCardTab('schools')} className={`border-b-2 px-3 py-1.5 text-xs font-semibold ${activeCardTab === 'schools' ? 'border-brand-700 text-brand-800' : 'border-transparent text-slate-500'}`}>المدارس المسندة</button>
          </div>}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!editMode && activeCardTab === 'schools' && isSupervisorEligibleEmployee({
              category: selectedEmployee.employee_category,
              jobTitle: selectedEmployee.job_title,
            })
              ? <SupervisorSchoolAssignmentsPanel
                employee={{ id: selectedEmployee.id, full_name: selectedEmployee.full_name }}
                supervisors={(employees.data ?? [])
                  .filter((employee) => employee.employment_status === 'active' && isSupervisorEligibleEmployee({
                    category: employee.employee_category,
                    jobTitle: employee.job_title,
                  }))
                  .map(({ id, full_name }) => ({ id, full_name }))}
                canManage={canManageSchoolAssignments}
              />
              : !editMode ? <>
                <dl className="grid grid-cols-2 gap-x-5 gap-y-3 py-3 sm:grid-cols-3">
                  <EmployeeDetail label="الرقم الوظيفي" value={selectedEmployee.employee_number ?? '—'} />
                  <div className="min-w-0">
                    <dt className="text-[11px] text-slate-500">رقم الإقامة</dt>
                    <dd dir="ltr" className="mt-0.5 flex items-center gap-1 text-sm font-semibold">
                      <span className="font-mono">{revealedIds[selectedEmployee.id] ?? '••••••'}</span>
                      {profile && canRevealResidence && <button type="button" onClick={() => void toggleResidence(selectedEmployee.id)} aria-label={revealedIds[selectedEmployee.id] ? 'إخفاء رقم الإقامة' : 'إظهار رقم الإقامة'} className="rounded p-1 text-brand-700">{revealedIds[selectedEmployee.id] ? <EyeOff size={15} /> : <Eye size={15} />}</button>}
                    </dd>
                  </div>
                  <EmployeeDetail label="رقم الجوال" value={canViewContacts ? selectedEmployee.phone ?? 'غير مسجل' : 'غير متاح لصلاحيتك'} />
                  <EmployeeDetail label="الجنسية" value={selectedEmployee.nationality ?? '—'} />
                  <EmployeeDetail label="تاريخ التعيين" value={selectedEmployee.hire_date ?? '—'} />
                  <div className="min-w-0">
                    <dt className="text-[11px] text-slate-500">صورة الهوية</dt>
                    <dd className="mt-1 flex min-h-16 items-center gap-2">
                      {!canViewIdImage
                        ? <span className="text-xs text-slate-400">غير متاح لصلاحيتك</span>
                        : selectedEmployee.identity_card_path
                        ? <>
                          {identityCardUrl
                            ? <img src={identityCardUrl} alt="" className="h-16 w-24 rounded-md bg-slate-100 object-cover" />
                            : <span className="grid h-16 w-24 place-items-center rounded-md bg-slate-100 text-[11px] text-slate-500">جارٍ التحميل…</span>}
                          <button type="button" onClick={() => void openIdentityCard()} disabled={!identityCardUrl || openingIdentityCard} className="text-xs font-semibold text-brand-700 disabled:opacity-50">
                            {openingIdentityCard ? 'جارٍ الفتح…' : 'عرض'}
                          </button>
                        </>
                        : canManage
                        ? <button type="button" onClick={() => { setEditMode(true); setIdentityCardFile(null); }} className="text-xs font-semibold text-brand-700">رفع صورة</button>
                        : <span className="text-xs text-slate-500">لا توجد صورة مرفوعة</span>}
                    </dd>
                    {identityCardError && <p role="alert" className="mt-1 text-[11px] text-rose-700">{identityCardError}</p>}
                  </div>
                </dl>
                <div className="border-t border-slate-100 pt-2">
                  <p className="mb-2 text-xs font-semibold text-slate-500">التدرج الإداري وصولاً إلى مدير المشروع</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(() => {
                      const chain: Employee[] = [];
                      let current = selectedEmployee.manager_id ? (employees.data ?? []).find((item) => item.id === selectedEmployee.manager_id) : undefined;
                      const visited = new Set([selectedEmployee.id]);
                      while (current && !visited.has(current.id)) {
                        chain.push(current);
                        visited.add(current.id);
                        current = current.manager_id ? (employees.data ?? []).find((item) => item.id === current!.manager_id) : undefined;
                      }
                      if (!chain.length) return <span className="text-xs text-slate-500">لم يُسند مدير مباشر بعد.</span>;
                      return chain.flatMap((manager, index) => [
                        ...(index > 0 ? [<ArrowLeft key={`arrow-${manager.id}`} size={14} className="shrink-0 text-slate-400" aria-hidden="true" />] : []),
                        <span key={manager.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-slate-50 px-3 py-1.5 text-xs">
                          <strong className="truncate">{manager.full_name}</strong>
                          <span className="shrink-0 text-slate-500">{manager.job_title ?? employeeCategoryLabels[manager.employee_category]}</span>
                        </span>,
                      ]);
                    })()}
                  </div>
                </div>
              </> : <form id="employee-profile-edit-form" className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-3 py-4 sm:grid-cols-2" onSubmit={updateEmployeeProfile}>
                <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-slate-600">اسم الموظف<input name="full_name" defaultValue={selectedEmployee.full_name} required className="h-10 w-full min-w-0 rounded-lg border border-slate-200 px-3 text-sm font-normal text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100" /></label>
                <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-slate-600">الرقم الوظيفي<input name="employee_number" defaultValue={selectedEmployee.employee_number ?? ''} className="h-10 w-full min-w-0 rounded-lg border border-slate-200 px-3 text-sm font-normal text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100" /></label>
                <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-slate-600">الوظيفة<input name="job_title" defaultValue={selectedEmployee.job_title ?? ''} className="h-10 w-full min-w-0 rounded-lg border border-slate-200 px-3 text-sm font-normal text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100" /></label>
                <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-slate-600">الفئة<select name="category" defaultValue={selectedEmployee.employee_category} className="h-10 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100">{employeeCategories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-slate-600">القسم<input name="department" defaultValue={selectedEmployee.department ?? ''} className="h-10 w-full min-w-0 rounded-lg border border-slate-200 px-3 text-sm font-normal text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100" /></label>
                {canViewContacts ? <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-slate-600">رقم الجوال<input name="phone" defaultValue={selectedEmployee.phone ?? ''} dir="ltr" className="h-10 w-full min-w-0 rounded-lg border border-slate-200 px-3 text-sm font-normal text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100" /></label> : <p className="self-end pb-3 text-xs text-slate-400">رقم الجوال: غير متاح لصلاحيتك</p>}
                <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-slate-600">المشروع<input name="project_name" defaultValue={selectedEmployee.project_name ?? ''} className="h-10 w-full min-w-0 rounded-lg border border-slate-200 px-3 text-sm font-normal text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100" /></label>
                <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-slate-600">الجنسية<input name="nationality" defaultValue={selectedEmployee.nationality ?? ''} className="h-10 w-full min-w-0 rounded-lg border border-slate-200 px-3 text-sm font-normal text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100" /></label>
                <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-slate-600">تاريخ التعيين<input name="hire_date" type="date" defaultValue={selectedEmployee.hire_date ?? ''} className="h-10 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100" /></label>
                <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-slate-600">الحالة<select name="status" defaultValue={selectedEmployee.employment_status} className="h-10 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"><option value="active">نشط</option><option value="inactive">غير نشط</option><option value="terminated">منتهي الخدمة</option></select></label>
                <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-slate-600">المدير المباشر<select name="manager_id" defaultValue={selectedEmployee.manager_id ?? ''} className="h-10 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"><option value="">بدون مدير مباشر</option>{(employees.data ?? []).filter((employee) => employee.id !== selectedEmployee.id).map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name} · {employee.job_title ?? employeeCategoryLabels[employee.employee_category]}</option>)}</select></label>
                {canViewIdImage && <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-slate-600">صورة بطاقة الهوية
                  <span className="relative flex h-10 min-w-0 items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 text-sm font-normal text-slate-600 focus-within:ring-2 focus-within:ring-brand-100">
                    <Upload size={16} className="shrink-0 text-brand-700" />
                    <span className="truncate">{identityCardFile?.name ?? (selectedEmployee.identity_card_path ? 'استبدال الصورة الحالية' : 'اختيار صورة')}</span>
                    <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setIdentityCardFile(event.target.files?.[0] ?? null)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
                  </span>
                  <span className="text-[11px] font-normal text-slate-500">JPG أو PNG أو WebP، بحد أقصى 5 ميجابايت</span>
                </label>}
              </form>}
          </div>
          {canManage && <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 pt-3">
            {editMode
              ? <>
                <button type="button" onClick={() => { setEditMode(false); setIdentityCardFile(null); }} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">إلغاء</button>
                <button type="submit" form="employee-profile-edit-form" className="rounded-lg bg-brand-700 px-5 py-2 text-sm font-bold text-white">حفظ التعديلات</button>
              </>
              : <button type="button" onClick={() => setEditMode(true)} className="rounded-lg bg-brand-700 px-5 py-2 text-sm font-bold text-white">تعديل بيانات الموظف</button>}
          </div>}
        </article>
        {identityViewerOpen && identityCardUrl && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4" role="dialog" aria-modal="true" aria-label="صورة بطاقة الهوية">
          <button type="button" onClick={() => setIdentityViewerOpen(false)} aria-label="إغلاق صورة الهوية" className="absolute end-4 top-4 rounded-full bg-white/10 p-2 text-white"><X size={22} /></button>
          <img src={identityCardUrl} alt={`هوية ${selectedEmployee.full_name}`} className="max-h-[85vh] max-w-full rounded-lg object-contain" />
        </div>}
      </div>}
      {message && !canManage && <p role="status" className="text-sm text-slate-700">{message}</p>}
    </div>
  );
}

function Input({ label, type = 'text', ...props }: { label: string; type?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return <label className="grid min-w-0 gap-1 text-sm font-semibold">{label}<input type={type} {...props} className="w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" /></label>;
}

function EmployeeDetail({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0">
    <dt className="text-[11px] text-slate-500">{label}</dt>
    <dd dir={label === 'رقم الجوال' && value !== 'غير متاح لصلاحيتك' ? 'ltr' : undefined} className="mt-0.5 truncate text-sm font-semibold" title={value}>{value}</dd>
  </div>;
}

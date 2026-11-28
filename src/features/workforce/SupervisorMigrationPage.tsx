import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { normalizeImportName } from '../../domain/imports';
import { isSupervisorEligibleEmployee } from '../../domain/workforce';
import {
  isKnownGatekeeperName,
  resolveSupervisorMigrationName,
  type SupervisorMigrationStatus,
} from '../../domain/supervisorMigration';
import { useDisplayFormat } from '../../app/useDisplayFormat';
import { usePermission } from '../../app/permissionContext';
import { supabase } from '../../lib/supabase';

type Service = 'maintenance' | 'cleaning';
type MigrationEmployee = {
  id: string;
  full_name: string;
  category: string;
  job_title: string | null;
  status: string;
  department: string | null;
  project_name: string | null;
  manager_id: string | null;
};
type SourceRow = {
  school_id: string;
  ministry_number: string;
  school_name: string;
  service: Service;
  source_name: string;
  employee_id: string | null;
  employee_name: string | null;
  match_status: SupervisorMigrationStatus;
  outcome: 'proposed' | 'assigned' | 'already_assigned' | 'conflict' | 'unmatched' | 'ambiguous';
};
type Alias = { alias_normalised: string; employee_id: string };
type MigrationData = { rows: SourceRow[]; employees: MigrationEmployee[]; aliases: Alias[]; gatekeeperNames: string[] };
type SupervisorGroup = {
  key: string;
  service: Service;
  name: string;
  rows: SourceRow[];
  status: SupervisorMigrationStatus;
  employeeId: string | null;
  employeeName: string | null;
};

const employeeSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  category: z.string(),
  job_title: z.string().nullable(),
  status: z.string(),
  department: z.string().nullable(),
  project_name: z.string().nullable(),
  manager_id: z.string().uuid().nullable(),
});
const aliasSchema = z.object({ alias_normalised: z.string(), employee_id: z.string().uuid() });
const sourceRowSchema = z.object({
  school_id: z.string().uuid(),
  ministry_number: z.string(),
  school_name: z.string(),
  service: z.enum(['maintenance', 'cleaning']),
  source_name: z.string(),
  employee_id: z.string().uuid().nullable(),
  employee_name: z.string().nullable(),
  match_status: z.enum(['employee', 'alias', 'unmatched', 'ambiguous']),
  outcome: z.enum(['proposed', 'assigned', 'already_assigned', 'conflict', 'unmatched', 'ambiguous']),
});
const labelByStatus: Record<SupervisorMigrationStatus, string> = {
  employee: 'مطابق لموظف',
  alias: 'مطابق باسم بديل',
  unmatched: 'غير مطابق',
  ambiguous: 'غامض',
};
const inputClass = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>;
    const fields = [
      record.message,
      record.details,
      record.hint,
      typeof record.code === 'string' ? `(${record.code})` : null,
    ].filter((value): value is string => typeof value === 'string' && Boolean(value.trim()));
    if (fields.length) return fields.join(' — ');
  }
  return typeof error === 'string' ? error : 'حدث خطأ غير معروف.';
}

async function loadMigrationData(): Promise<MigrationData> {
  if (!supabase) throw new Error('يلزم إعداد Supabase.');
  const [rows, employees, aliases, gatekeepers] = await Promise.all([
    loadSourceRows(),
    loadRows((start, end) => supabase!.from('employees')
      .select('id,full_name,category,job_title,status,department,project_name,manager_id')
      .order('full_name')
      .range(start, end), employeeSchema),
    loadRows((start, end) => supabase!.from('supervisor_aliases')
      .select('alias_normalised,employee_id')
      .range(start, end), aliasSchema),
    loadRows((start, end) => supabase!.from('gatekeepers')
      .select('full_name')
      .range(start, end), z.object({ full_name: z.string() })),
  ]);
  return {
    rows,
    employees,
    aliases,
    gatekeeperNames: gatekeepers.map(({ full_name }) => full_name),
  };
}

async function loadSourceRows(): Promise<SourceRow[]> {
  if (!supabase) throw new Error('يلزم إعداد Supabase.');
  const rows: SourceRow[] = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabase.rpc('preview_school_supervisor_assignments', { p_apply: false })
      .range(start, start + 999);
    if (error) throw error;
    const page = z.array(sourceRowSchema).parse(data);
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

async function loadRows<T>(
  fetchPage: (start: number, end: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  schema: z.ZodType<T>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await fetchPage(start, start + 999);
    if (error) throw new Error(error.message);
    const page = z.array(schema).parse(data);
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

function supervisorGroups(data: MigrationData): SupervisorGroup[] {
  const grouped = new Map<string, SourceRow[]>();
  for (const row of data.rows) {
    const normalized = normalizeImportName(row.source_name);
    if (!normalized) continue;
    const key = `${row.service}:${normalized}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  const activeSupervisors = data.employees.filter((employee) =>
    employee.status === 'active' && isSupervisorEligibleEmployee({
      category: employee.category,
      jobTitle: employee.job_title,
    }));
  return [...grouped].map(([key, rows]) => {
    const result = resolveSupervisorMigrationName(rows[0].source_name, activeSupervisors, data.aliases);
    const serverStatus = rows[0].match_status;
    const isGatekeeper = rows[0].service === 'maintenance'
      && isKnownGatekeeperName(rows[0].source_name, data.gatekeeperNames);
    const status: SupervisorMigrationStatus = isGatekeeper
      ? 'ambiguous'
      : serverStatus === 'ambiguous' || result.status === 'ambiguous'
      ? 'ambiguous'
      : serverStatus === 'unmatched' || result.status === 'unmatched'
        ? 'unmatched'
        : result.status;
    const matchedEmployee = isGatekeeper ? null : result.employee
      ?? activeSupervisors.find((employee) => employee.id === rows[0].employee_id)
      ?? null;
    return {
      key,
      service: rows[0].service,
      name: rows[0].source_name,
      rows,
      status,
      employeeId: matchedEmployee?.id ?? null,
      employeeName: matchedEmployee?.full_name ?? null,
    };
  }).sort((left, right) => left.service.localeCompare(right.service)
    || left.name.localeCompare(right.name, 'ar'));
}

export function SupervisorMigrationPage() {
  const queryClient = useQueryClient();
  const { formatNumber } = useDisplayFormat();
  const canManage = usePermission('workforce.assign_schools');
  const [message, setMessage] = useState('');
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Record<string, string>>({});
  const [employeeSearches, setEmployeeSearches] = useState<Record<string, string>>({});
  const [creatingKey, setCreatingKey] = useState('');
  const [projectName, setProjectName] = useState('');
  const [managerId, setManagerId] = useState('');
  const [previewed, setPreviewed] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyReport, setApplyReport] = useState<SourceRow[] | null>(null);
  const migration = useQuery({
    queryKey: ['supervisor-migration'],
    queryFn: loadMigrationData,
    enabled: canManage,
  });
  const groups = useMemo(() => migration.data ? supervisorGroups(migration.data) : [], [migration.data]);
  const activeSupervisors = (migration.data?.employees ?? []).filter((employee) =>
    employee.status === 'active' && isSupervisorEligibleEmployee({
      category: employee.category,
      jobTitle: employee.job_title,
    }));
  const projectNames = [...new Set((migration.data?.employees ?? [])
    .map((employee) => employee.project_name?.trim())
    .filter((name): name is string => Boolean(name)))].sort((left, right) => left.localeCompare(right, 'ar'));
  const rowForAction = (group: SupervisorGroup) => group.status === 'ambiguous' || group.status === 'unmatched';
  const progressRows = applyReport;

  async function refreshData() {
    await queryClient.invalidateQueries({ queryKey: ['supervisor-migration'] });
    setApplyReport(null);
    setPreviewed(false);
  }

  async function saveAlias(group: SupervisorGroup) {
    if (!supabase) return;
    const employeeId = selectedEmployeeIds[group.key];
    if (!employeeId) {
      setMessage('اختر مشرفاً نشطاً أولاً.');
      return;
    }
    setMessage('');
    try {
      const { error } = await supabase.from('supervisor_aliases').upsert({
        alias_normalised: normalizeImportName(group.name),
        employee_id: employeeId,
      }, { onConflict: 'alias_normalised' });
      if (error) throw error;
      setMessage(`تم ربط «${group.name}» بالموظف المختار.`);
      await refreshData();
    } catch (error) {
      setMessage(`تعذر حفظ الاسم البديل: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function createSupervisor(group: SupervisorGroup) {
    if (!supabase || !managerId || !projectName) {
      setMessage('اختر المشروع والمدير المباشر لإكمال إنشاء المشرف.');
      return;
    }
    setMessage('');
    try {
      const { error } = await supabase.rpc('create_school_supervisor_for_assignment', {
        p_full_name: group.name,
        p_department: group.service === 'maintenance' ? 'صيانة' : 'نظافة',
        p_project_name: projectName,
        p_manager_id: managerId,
        p_alias_normalised: normalizeImportName(group.name),
      });
      if (error) throw error;
      setCreatingKey('');
      setProjectName('');
      setManagerId('');
      setMessage(`تم إنشاء مشرف «${group.name}» وربط الاسم الوارد في الشيت به.`);
      await refreshData();
    } catch (error) {
      setMessage(`تعذر إنشاء المشرف: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function previewAssignments() {
    setMessage('');
    setLoadingPreview(true);
    try {
      await migration.refetch({ throwOnError: true });
      setPreviewed(true);
      setApplyReport(null);
    } catch (error) {
      setMessage(`تعذرت معاينة الإسناد: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoadingPreview(false);
    }
  }

  async function applyAssignments() {
    if (!supabase || !window.confirm('سيُنشئ هذا الإجراء إسنادات المدارس للمطابقين فقط. سيتجاوز المدارس المسندة بالفعل وأي تعارض أو اسم غير محسوم، ولن يغيّر أي قيمة في schools.extra. هل تريد المتابعة؟')) return;
    setMessage('');
    setApplying(true);
    try {
      const before = await loadMigrationData();
      const { error } = await supabase.rpc('preview_school_supervisor_assignments', { p_apply: true });
      if (error) throw error;
      const after = await loadSourceRows();
      setApplyReport(after);
      const beforeOutcomes = new Map(before.rows.map((row) => [`${row.school_id}:${row.service}`, row.outcome]));
      const assigned = after.filter((row) => row.outcome === 'assigned'
        && beforeOutcomes.get(`${row.school_id}:${row.service}`) === 'proposed').length;
      const alreadyAssigned = after.filter((row) => row.outcome === 'already_assigned').length;
      const conflicts = after.filter((row) => row.outcome === 'conflict').length;
      const unresolved = after.filter((row) => row.outcome === 'unmatched' || row.outcome === 'ambiguous').length;
      setMessage(`اكتمل التطبيق: أُنشئ ${formatNumber(assigned)} إسناد، وتُرك ${formatNumber(alreadyAssigned)} إسناد قائم، و${formatNumber(conflicts)} تعارض، و${formatNumber(unresolved)} اسم غير محسوم.`);
      setPreviewed(true);
      await queryClient.setQueryData(['supervisor-migration'], { ...before, rows: after });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['employee-school-assignments'] }),
        queryClient.invalidateQueries({ queryKey: ['monthly-plan-rows'] }),
      ]);
    } catch (error) {
      setMessage(`تعذر تطبيق الإسناد: ${errorMessage(error)}`);
    } finally {
      setApplying(false);
    }
  }

  if (!canManage) return <section className="card p-6">هذه الصفحة متاحة لمن يملك صلاحية إسناد المدارس للمشرفين.</section>;

  return (
    <div className="grid min-w-0 gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-brand-900">ترحيل المشرفين من الشيت</h2>
          <p className="mt-1 text-sm text-slate-500">مطابقة أسماء المشرفين في المدارس وربطها بموظفي الصيانة والنظافة.</p>
        </div>
        <Link to="/workforce" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold">العودة للقوى العاملة</Link>
      </header>

      <section className="card grid gap-3 p-4 sm:p-5">
        <p className="text-sm text-slate-600">تُقرأ أسماء المشرفين من المدارس غير المفقودة فقط. لا تُعدّل هذه الصفحة أي قيمة في schools.extra.</p>
        {migration.isLoading && <p role="status">جارٍ تحميل الأسماء…</p>}
        {migration.error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">تعذر تحميل بيانات الترحيل: {migration.error.message}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void previewAssignments()} disabled={loadingPreview || migration.isLoading || !migration.data} className="rounded-lg border border-brand-700 px-4 py-2 text-sm font-semibold text-brand-800 disabled:opacity-50">
            {loadingPreview ? 'جارٍ تحديث المعاينة…' : 'معاينة الإسناد'}
          </button>
          <button type="button" onClick={() => void applyAssignments()} disabled={!previewed || applying || !groups.length} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
            {applying ? 'جارٍ تطبيق الإسناد…' : 'تطبيق'}
          </button>
        </div>

        {migration.data && <div className="table-scroll workforce-table-scroll" role="region" aria-label="أسماء المشرفين المراد ترحيلها" tabIndex={0}>
          <table className="workforce-table min-w-[980px]">
            <thead><tr>
              <th scope="col">اسم الشيت</th><th scope="col">الخدمة</th><th scope="col">عدد المدارس</th>
              <th scope="col">المطابقة</th><th scope="col">الموظف</th><th scope="col">التعارضات</th><th scope="col">الإجراء</th>
            </tr></thead>
            <tbody>{groups.map((group) => {
              const conflicts = group.rows.filter((row) => row.outcome === 'conflict').length;
              const selectedTarget = selectedEmployeeIds[group.key] ?? '';
              const employeeSearch = employeeSearches[group.key] ?? '';
              const matchingEmployees = activeSupervisors.filter((employee) =>
                employee.full_name.toLocaleLowerCase().includes(employeeSearch.trim().toLocaleLowerCase()));
              return <tr key={group.key}>
                <td data-label="اسم الشيت">{group.name}</td>
                <td data-label="الخدمة">{group.service === 'maintenance' ? 'صيانة' : 'نظافة'}</td>
                <td data-label="عدد المدارس">{formatNumber(group.rows.length)}</td>
                <td data-label="المطابقة"><span className={group.status === 'unmatched' || group.status === 'ambiguous' ? 'text-amber-800' : 'text-emerald-800'}>{labelByStatus[group.status]}</span></td>
                <td data-label="الموظف">{group.employeeName ?? '—'}</td>
                <td data-label="التعارضات">{previewed ? formatNumber(conflicts) : '—'}</td>
                <td data-label="الإجراء" className="min-w-[320px]">
                  {rowForAction(group) ? <div className="grid gap-2">
                    <div className="flex flex-wrap gap-2">
                      <div className="grid gap-1">
                        <input type="search" aria-label={`بحث عن موظف للاسم ${group.name}`} placeholder="ابحث عن موظف" value={employeeSearch} onChange={(event) => setEmployeeSearches((current) => ({ ...current, [group.key]: event.target.value }))} className="max-w-[220px] rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
                        <select aria-label={`موظف بديل للاسم ${group.name}`} value={selectedTarget} onChange={(event) => setSelectedEmployeeIds((current) => ({ ...current, [group.key]: event.target.value }))} className="max-w-[220px] rounded-lg border border-slate-300 px-2 py-1.5 text-xs">
                          <option value="">اختر مشرفاً نشطاً</option>
                          {matchingEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name}</option>)}
                        </select>
                      </div>
                      <button type="button" onClick={() => void saveAlias(group)} disabled={!selectedTarget} className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-semibold disabled:opacity-50">حفظ الاسم البديل</button>
                      {group.status === 'unmatched' && <button type="button" onClick={() => { setCreatingKey(creatingKey === group.key ? '' : group.key); setProjectName(''); setManagerId(''); }} className="rounded-lg border border-brand-700 px-2 py-1.5 text-xs font-semibold text-brand-800">إنشاء مشرف</button>}
                    </div>
                    {creatingKey === group.key && <div className="grid gap-2 rounded-lg bg-slate-50 p-3">
                      <p className="text-xs font-semibold">إنشاء الحد الأدنى فقط؛ ستبقى بقية البيانات فارغة وتظهر عليها شارة «بيانات ناقصة» في سجل الموظف.</p>
                      <label className="grid gap-1 text-xs font-semibold">المشروع
                        <input list="supervisor-migration-projects" value={projectName} onChange={(event) => setProjectName(event.target.value)} className={inputClass} placeholder="اختر أو أدخل اسم المشروع" />
                        <datalist id="supervisor-migration-projects">{projectNames.map((project) => <option key={project} value={project} />)}</datalist>
                      </label>
                      <label className="grid gap-1 text-xs font-semibold">المدير المباشر
                        <select value={managerId} onChange={(event) => setManagerId(event.target.value)} className={inputClass}>
                          <option value="">اختر موظفاً</option>{(migration.data?.employees ?? []).map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name}</option>)}
                        </select>
                      </label>
                      <p className="text-xs text-slate-600">الفئة: مشرف · القسم: {group.service === 'maintenance' ? 'صيانة' : 'نظافة'} · الحالة: نشط · الاسم: {group.name}</p>
                      <button type="button" onClick={() => void createSupervisor(group)} disabled={!projectName.trim() || !managerId} className="justify-self-start rounded-lg bg-brand-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">إنشاء المشرف وربط الاسم</button>
                    </div>}
                  </div> : <span className="text-xs text-slate-500">لا يلزم إجراء</span>}
                </td>
              </tr>;
            })}
              {!groups.length && <tr><td colSpan={7} className="py-5 text-center text-sm text-slate-500">لا توجد أسماء مشرفين في المدارس غير المفقودة.</td></tr>}
            </tbody>
          </table>
        </div>}
      </section>

      {progressRows && <section className="card grid gap-4 p-4 sm:p-5" aria-label="تقدم إسناد المدارس">
        {(['maintenance', 'cleaning'] as const).map((service) => {
          const serviceRows = progressRows.filter((row) => row.service === service);
          const total = serviceRows.length;
          const complete = serviceRows.filter((row) => row.outcome === 'assigned' || row.outcome === 'already_assigned').length;
          const label = service === 'maintenance' ? 'صيانة' : 'نظافة';
          const percent = total ? Math.round((complete / total) * 100) : 0;
          return <div key={service} className="grid gap-1">
            <p className="text-sm font-semibold">{formatNumber(complete)} من {formatNumber(total)} مدرسة مسنّدة {label}</p>
            <div className="h-3 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label={`تقدم إسناد ${label}`} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${percent}%` }} />
            </div>
          </div>;
        })}
      </section>}

      {message && <p role="status" className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{message}</p>}
    </div>
  );
}

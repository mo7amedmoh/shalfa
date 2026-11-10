import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { normalizeImportName, resolvePlanPerson } from '../../domain/imports';
import {
  schedulePlan,
  summarizePlanSchedule,
  type PlanScheduleOptions,
  type ScheduleAssignment,
  type SchedulerSchool,
  type SchedulerSupervisor,
} from '../../domain/planScheduler';
import { APP_SCHEMA_SELECT } from '../../lib/schemaColumns';
import { supabase } from '../../lib/supabase';

type Employee = { id: string; full_name: string };
type Alias = { alias_normalised: string; employee_id: string };
type References = { employees: Employee[]; aliases: Alias[] };
type GeneratorSchool = SchedulerSchool & { ministryNumber: string };
type Props = {
  schools: readonly GeneratorSchool[];
  initialSchoolIds: readonly string[];
  lockedSelection?: boolean;
  startDate: string;
  endDate: string;
  minDate?: string;
  maxDate?: string;
  disabled: boolean;
  saving: boolean;
  onSave: (assignments: ScheduleAssignment[]) => void;
};

const employeeSchema = z.object({ id: z.string().uuid(), full_name: z.string() });
const aliasSchema = z.object({ alias_normalised: z.string(), employee_id: z.string().uuid() });
const inputClass = 'rounded-lg border border-slate-300 px-3 py-2 text-sm';
const emptyReferences: References = { employees: [], aliases: [] };
const weekdays = [
  { day: 0, label: 'الأحد' },
  { day: 1, label: 'الإثنين' },
  { day: 2, label: 'الثلاثاء' },
  { day: 3, label: 'الأربعاء' },
  { day: 4, label: 'الخميس' },
  { day: 5, label: 'الجمعة' },
  { day: 6, label: 'السبت' },
];

async function loadReferences(): Promise<References> {
  if (!supabase) return { employees: [], aliases: [] };
  const [employeesResult, aliasesResult] = await Promise.all([
    supabase.from('employees')
      .select(APP_SCHEMA_SELECT.employeesForImport)
      .eq('category', 'supervisor')
      .eq('status', 'active')
      .order('full_name'),
    supabase.from('supervisor_aliases').select(APP_SCHEMA_SELECT.supervisorAliases),
  ]);
  if (employeesResult.error) throw employeesResult.error;
  if (aliasesResult.error) throw aliasesResult.error;
  return {
    employees: z.array(employeeSchema).parse(employeesResult.data),
    aliases: z.array(aliasSchema).parse(aliasesResult.data),
  };
}

function optionForName(name: string, references: References): SchedulerSupervisor {
  const person = resolvePlanPerson(name, references.employees, references.aliases);
  return { id: person.employee?.id ?? `name:${normalizeImportName(person.name)}`, name: person.name };
}

export function SupervisorPlanGenerator({
  schools,
  initialSchoolIds,
  lockedSelection = false,
  startDate: initialStartDate,
  endDate: initialEndDate,
  minDate,
  maxDate,
  disabled,
  saving,
  onSave,
}: Props) {
  const references = useQuery({ queryKey: ['plan-supervisor-references'], queryFn: loadReferences });
  const [selectedIds, setSelectedIds] = useState<string[]>([...initialSchoolIds]);
  const [startDate, setStartDate] = useState(initialStartDate);
  const [endDate, setEndDate] = useState(initialEndDate);
  const [weekendDays, setWeekendDays] = useState<number[]>([5, 6]);
  const [defaultCap, setDefaultCap] = useState('5');
  const [assignmentMode, setAssignmentMode] = useState<PlanScheduleOptions['assignmentMode']>('keep');
  const [clusterBy, setClusterBy] = useState<PlanScheduleOptions['clusterBy']>('none');
  const [supervisors, setSupervisors] = useState<SchedulerSupervisor[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [typedName, setTypedName] = useState('');
  const [preview, setPreview] = useState<ScheduleAssignment[] | null>(null);
  const [message, setMessage] = useState('');
  const referencesData = references.data ?? emptyReferences;

  useEffect(() => {
    setSelectedIds([...initialSchoolIds]);
    setPreview(null);
  }, [initialSchoolIds]);

  const sourceSupervisors = useMemo(() => {
    const seen = new Set<string>();
    return schools.flatMap((school) => {
      if (!school.supervisorName?.trim()) return [];
      const option = optionForName(school.supervisorName, referencesData);
      const key = normalizeImportName(option.name);
      if (!key || seen.has(key)) return [];
      seen.add(key);
      return [option];
    });
  }, [schools, referencesData]);
  useEffect(() => {
    if (!sourceSupervisors.length) return;
    setSupervisors((current) => {
      const existing = new Set(current.map((item) => normalizeImportName(item.name)));
      return [...current, ...sourceSupervisors.filter((item) => !existing.has(normalizeImportName(item.name)))];
    });
  }, [sourceSupervisors]);

  const selectedSchools = useMemo(() => {
    const selected = new Set(selectedIds);
    return schools.filter((school) => selected.has(school.id));
  }, [schools, selectedIds]);
  const currentCap = Number(defaultCap);
  const scheduleOptions = useMemo<PlanScheduleOptions>(() => ({
    startDate,
    endDate,
    weekendDays,
    defaultMaxSchoolsPerDay: currentCap,
    supervisors,
    assignmentMode,
    clusterBy,
  }), [startDate, endDate, weekendDays, currentCap, supervisors, assignmentMode, clusterBy]);
  const summaryOptions = useMemo(() => ({
    ...scheduleOptions,
    supervisors: scheduleOptions.assignmentMode === 'balanced'
      ? scheduleOptions.supervisors
      : scheduleOptions.supervisors.filter((supervisor) => preview?.some((assignment) =>
        assignment.supervisorId === supervisor.id
        || normalizeImportName(assignment.supervisorName ?? '') === normalizeImportName(supervisor.name))),
  }), [scheduleOptions, preview]);

  const summaryState = useMemo(() => {
    if (!preview) return null;
    try {
      return { summary: summarizePlanSchedule(preview, summaryOptions), error: '' };
    } catch (error) {
      return { summary: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, [preview, summaryOptions]);
  const referenceError = references.error instanceof Error ? references.error.message : '';

  function invalidatePreview() {
    setPreview(null);
    setMessage('');
  }

  function changeSelection(next: string[]) {
    setSelectedIds(next);
    invalidatePreview();
  }

  function addSupervisor(name: string, id?: string) {
    const resolved = resolvePlanPerson(name, referencesData.employees, referencesData.aliases);
    const cleanName = resolved.name.trim();
    if (!cleanName) return;
    if (supervisors.some((item) => normalizeImportName(item.name) === normalizeImportName(cleanName))) {
      setMessage('هذا المشرف موجود بالفعل.');
      return;
    }
    setSupervisors((current) => [...current, {
      id: resolved.employee?.id ?? id ?? `name:${normalizeImportName(cleanName)}`,
      name: cleanName,
    }]);
    setTypedName('');
    setEmployeeId('');
    invalidatePreview();
  }

  function generate() {
    try {
      if (!Number.isInteger(currentCap) || currentCap <= 0) throw new RangeError('الحد اليومي الافتراضي يجب أن يكون عدداً صحيحاً موجباً.');
      const preparedSchools = selectedSchools.map((school) => ({
        ...school,
        supervisorName: school.supervisorName
          ? resolvePlanPerson(school.supervisorName, referencesData.employees, referencesData.aliases).name
          : null,
      }));
      const result = schedulePlan(preparedSchools, scheduleOptions);
      setPreview(result.assignments);
      setMessage('تم إنشاء المعاينة. يمكنك تعديل الموعد والمشرف لكل مدرسة قبل الحفظ.');
    } catch (error) {
      setPreview(null);
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  function updateAssignment(schoolId: string, patch: Partial<ScheduleAssignment>) {
    setPreview((current) => current?.map((row) => row.schoolId === schoolId
      ? { ...row, ...patch }
      : row) ?? null);
  }

  function save() {
    if (!preview || !summaryState?.summary || summaryState.summary.hasInvalidDates || referenceError) return;
    onSave(preview.map((assignment) => {
      const person = resolvePlanPerson(assignment.supervisorName ?? '', referencesData.employees, referencesData.aliases);
      return {
        ...assignment,
        supervisorId: person.employee?.id ?? assignment.supervisorId,
        supervisorName: person.name || null,
      };
    }));
  }

  const allSelected = selectedIds.length === schools.length && schools.length > 0;
  const availableEmployeeId = referencesData.employees.some((employee) => employee.id === employeeId) ? employeeId : '';

  return <section className="grid gap-4 rounded-xl border border-slate-200 p-4">
    <div>
      <h3 className="font-bold text-slate-900">توزيع المشرفين والمواعيد</h3>
      <p className="mt-1 text-sm text-slate-500">اختر المشرفين وسعة كل مشرف، ثم راجع توزيع المدارس وحمّله بعد التعديل.</p>
    </div>
    {referenceError && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">تعذر تحميل المشرفين وأسمائهم المعتمدة: {referenceError}</p>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="grid gap-1 text-sm font-semibold">من تاريخ
        <input type="date" min={minDate} max={maxDate} value={startDate} onChange={(event) => { setStartDate(event.target.value); invalidatePreview(); }} className={inputClass} />
      </label>
      <label className="grid gap-1 text-sm font-semibold">إلى تاريخ
        <input type="date" min={minDate} max={maxDate} value={endDate} onChange={(event) => { setEndDate(event.target.value); invalidatePreview(); }} className={inputClass} />
      </label>
      <label className="grid gap-1 text-sm font-semibold">الحد الافتراضي للمدارس لكل مشرف يومياً
        <input type="number" min="1" step="1" value={defaultCap} onChange={(event) => { setDefaultCap(event.target.value); invalidatePreview(); }} className={inputClass} />
      </label>
      <label className="grid gap-1 text-sm font-semibold">طريقة الإسناد
        <select value={assignmentMode} onChange={(event) => { setAssignmentMode(event.target.value as PlanScheduleOptions['assignmentMode']); invalidatePreview(); }} className={inputClass}>
          <option value="keep">الإبقاء على مشرف سجل المدرسة</option>
          <option value="balanced">توزيع متوازن على المشرفين</option>
        </select>
      </label>
    </div>
    <fieldset className="grid gap-2">
      <legend className="text-sm font-semibold">أيام العطلة</legend>
      <div className="flex flex-wrap gap-3">
        {weekdays.map(({ day, label }) => <label key={day} className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={weekendDays.includes(day)} onChange={(event) => {
            setWeekendDays((current) => event.target.checked ? [...current, day].sort() : current.filter((value) => value !== day));
            invalidatePreview();
          }} />
          {label}
        </label>)}
      </div>
    </fieldset>
    <div className="grid gap-3 rounded-lg bg-slate-50 p-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <label className="grid gap-1 text-sm font-semibold">اختيار موظف مشرف
          <select value={availableEmployeeId} onChange={(event) => setEmployeeId(event.target.value)} className={inputClass}>
            <option value="">اختر موظفاً</option>
            {referencesData.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold">أو اكتب اسماً
          <input value={typedName} onChange={(event) => setTypedName(event.target.value)} className={inputClass} />
        </label>
        <button type="button" disabled={disabled || (!availableEmployeeId && !typedName.trim())} onClick={() => {
          if (availableEmployeeId) {
            const employee = referencesData.employees.find((item) => item.id === availableEmployeeId);
            if (employee) addSupervisor(employee.full_name, employee.id);
          } else addSupervisor(typedName);
        }} className="self-end rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-50">إضافة مشرف</button>
      </div>
      {supervisors.length > 0 && <div className="grid gap-2 sm:grid-cols-2">
        {supervisors.map((supervisor) => <div key={supervisor.id} className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-2">
          <strong className="min-w-32 flex-1 text-sm">{supervisor.name}</strong>
          <label className="grid gap-1 text-xs">حد يومي خاص (اختياري)
            <input type="number" min="1" step="1" value={supervisor.maxSchoolsPerDay ?? ''} placeholder={String(currentCap || 5)} onChange={(event) => {
              const value = event.target.value === '' ? null : Number(event.target.value);
              setSupervisors((current) => current.map((item) => item.id === supervisor.id ? { ...item, maxSchoolsPerDay: value } : item));
              invalidatePreview();
            }} className="w-28 rounded border border-slate-300 px-2 py-1.5" />
          </label>
          <button type="button" onClick={() => {
            setSupervisors((current) => current.filter((item) => item.id !== supervisor.id));
            invalidatePreview();
          }} className="text-xs text-rose-700 underline">إزالة</button>
        </div>)}
      </div>}
    </div>
    <label className="grid max-w-md gap-1 text-sm font-semibold">ترتيب المدارس المتجاورة
      <select value={clusterBy} onChange={(event) => { setClusterBy(event.target.value as PlanScheduleOptions['clusterBy']); invalidatePreview(); }} className={inputClass}>
        <option value="none">بدون تجميع</option>
        <option value="neighbourhood">تجميع حسب الحي</option>
        <option value="coordinates">تجميع حسب الإحداثيات</option>
      </select>
    </label>
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span>المدارس المحددة: {selectedIds.length} / {schools.length}</span>
      {!lockedSelection && <div className="flex gap-2">
        <button type="button" onClick={() => changeSelection(allSelected ? [] : schools.map((school) => school.id))} className="rounded-lg border border-slate-300 px-3 py-1.5">
          {allSelected ? 'إلغاء تحديد المدارس' : 'تحديد كل المدارس'}
        </button>
      </div>}
    </div>
    {schools.length === 0 ? <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">لا توجد مدارس متاحة للتوزيع.</p> : (
      <div className="max-h-52 overflow-y-auto rounded-lg border border-slate-200 p-2">
        {schools.map((school) => <label key={school.id} className="flex items-center gap-2 border-b border-slate-100 py-1.5 text-sm last:border-0">
          <input type="checkbox" checked={selectedIds.includes(school.id)} disabled={disabled || lockedSelection} onChange={(event) => changeSelection(event.target.checked
            ? [...selectedIds, school.id]
            : selectedIds.filter((id) => id !== school.id))} />
          <span>{school.name}</span><span className="text-slate-400">{school.ministryNumber}</span>
          {school.supervisorName && <span className="ms-auto text-slate-500">المشرف الحالي: {school.supervisorName}</span>}
        </label>)}
      </div>
    )}
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={disabled || references.isLoading || !selectedIds.length} onClick={generate} className="rounded-lg border border-brand-700 px-4 py-2 text-sm font-semibold text-brand-800 disabled:opacity-50">إنشاء المعاينة</button>
      <button type="button" disabled={disabled || references.isLoading || saving || !preview?.length || !summaryState?.summary || summaryState.summary.hasInvalidDates || Boolean(referenceError)} onClick={save} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
        {saving ? 'جارٍ الحفظ…' : 'حفظ الخطة'}
      </button>
      <span className="self-center text-xs text-slate-500">السعة الافتراضية: {defaultCap || '—'} مدارس يومياً</span>
    </div>
    {preview && summaryState?.summary && <>
      {summaryState.summary.warnings.length > 0 && <ul className="grid gap-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        {summaryState.summary.warnings.map((warning, index) => <li key={`${warning}-${index}`}>تنبيه: {warning}</li>)}
      </ul>}
      {summaryState.error && <p role="alert" className="text-sm text-rose-700">{summaryState.error}</p>}
      <div className="overflow-x-auto">
        <table className="min-w-full text-start text-sm">
          <thead className="bg-slate-100"><tr><th className="p-2">المدرسة</th><th className="p-2">الرقم الوزاري</th><th className="p-2">الموعد</th><th className="p-2">المشرف</th></tr></thead>
          <tbody>{preview.map((assignment) => {
            const school = schools.find((item) => item.id === assignment.schoolId);
            return <tr key={assignment.schoolId} className="border-b border-slate-100">
              <td className="p-2">{school?.name ?? assignment.schoolId}</td>
              <td className="p-2">{school?.ministryNumber}</td>
              <td className="p-2"><input type="date" min={minDate ?? startDate} max={maxDate ?? endDate} value={assignment.plannedDate} onChange={(event) => updateAssignment(assignment.schoolId, { plannedDate: event.target.value })} className="rounded border border-slate-300 px-2 py-1" /></td>
              <td className="p-2"><input value={assignment.supervisorName ?? ''} onChange={(event) => updateAssignment(assignment.schoolId, {
                supervisorName: event.target.value || null,
                supervisorId: event.target.value === assignment.supervisorName ? assignment.supervisorId : null,
              })} className="min-w-40 rounded border border-slate-300 px-2 py-1" /></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-center text-sm">
          <thead className="bg-slate-100"><tr><th className="p-2 text-start">المشرف / اليوم</th>{summaryState.summary.days.map((day) => <th key={day} className="p-2">{day}</th>)}</tr></thead>
          <tbody>{summaryState.summary.matrix.map((row) => <tr key={row.supervisorId ?? '__unassigned__'} className="border-b border-slate-100">
            <th className="p-2 text-start">{row.supervisorName} (حد {row.maxSchoolsPerDay})</th>
            {summaryState.summary?.days.map((day) => <td key={day} className={`p-2 ${row.counts[day] > row.maxSchoolsPerDay ? 'font-bold text-rose-700' : ''}`}>{row.counts[day]}</td>)}
          </tr>)}</tbody>
        </table>
      </div>
    </>}
    {summaryState?.error && preview && <p role="alert" className="text-sm text-rose-700">{summaryState.error}</p>}
    {message && <p role="status" className="text-sm text-slate-700">{message}</p>}
  </section>;
}

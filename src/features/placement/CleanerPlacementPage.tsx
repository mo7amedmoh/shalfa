import { useContext, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff } from 'lucide-react';
import { z } from 'zod';
import { loadXlsx } from '../../lib/xlsx';
import { eligibleSchoolIds, type PlanEligibilityConfig } from '../../domain/planEligibility';
import { calculateStaffing, parseClassCount, type StaffingResult } from '../../domain/staffing';
import type { UserProfile } from '../../lib/auth';
import { useDisplayFormat } from '../../app/useDisplayFormat';
import { supabase } from '../../lib/supabase';
import { APP_SCHEMA_SELECT } from '../../lib/schemaColumns';
import { preferencesContext } from '../../app/preferencesContext';
import { ImportWizardLauncher } from '../imports/ImportWizard';

const configSchema = z.object({
  buildingTypeHeader: z.string(),
  independentBuildingValues: z.array(z.string()),
  primarySharedValues: z.array(z.string()),
  elevatorContractorHeader: z.string(),
  noElevatorValues: z.array(z.string()),
  classCountHeader: z.string().default('عدد الفصول'),
  schoolSizeHeader: z.string().default(''),
});
const schoolSchema = z.object({
  id: z.string().uuid(),
  school_name: z.string(),
  ministry_number: z.string(),
  source_fields: z.record(z.string(), z.unknown()),
  size_source: z.enum(['small', 'medium', 'large']).nullable(),
});
const employeeSchema = z.object({ id: z.string().uuid(), full_name: z.string(), employee_number: z.string().nullable(), job_title: z.string().nullable(), phone: z.string().nullable() });
const assignmentSchema = z.object({
  id: z.string().uuid(),
  school_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  labour_source: z.string().nullable(),
  employee: z.object({ full_name: z.string(), employee_number: z.string().nullable() }).nullable(),
});
const schoolSizeSchema = z.object({
  school_id: z.string().uuid(),
  corrected_size: z.string(),
});
const exceptionRowSchema = z.object({ school_id: z.string().uuid(), required_count: z.number().int(), reason: z.string() });
const exceptionSchema = z.object({ requiredCleaners: z.number().int().min(0), reason: z.string().trim().min(1) });
type School = z.infer<typeof schoolSchema>;
type Assignment = z.infer<typeof assignmentSchema>;
type StaffingConfig = PlanEligibilityConfig & { classCountHeader: string; schoolSizeHeader: string };
type SchoolData = {
  schools: School[];
  employees: z.infer<typeof employeeSchema>[];
  assignments: Assignment[];
  overrides: Map<string, { correctedSize: string | null; exception: z.infer<typeof exceptionSchema> | null }>;
  config: StaffingConfig | null;
};
type SchoolSummary = { school: School; staffing: StaffingResult; neighborhood: string; exception: z.infer<typeof exceptionSchema> | null };

async function loadPlacementData(): Promise<SchoolData> {
  if (!supabase) return { schools: [], employees: [], assignments: [], overrides: new Map(), config: null };
  const [schoolsResult, employeeResult, assignmentResult, sizesResult, exceptionResult, configResult] = await Promise.all([
    supabase.from('schools').select(APP_SCHEMA_SELECT.schoolsWithSize).order('name'),
    supabase.from('employees').select(APP_SCHEMA_SELECT.employeesBasic).eq('category', 'cleaner').order('full_name'),
    supabase.from('cleaner_assignments').select(APP_SCHEMA_SELECT.cleanerAssignments),
    supabase.from('school_size_corrections').select(APP_SCHEMA_SELECT.schoolSizeCorrection),
    supabase.from('staffing_exceptions').select(APP_SCHEMA_SELECT.staffingException),
    supabase.from('app_config').select(APP_SCHEMA_SELECT.appConfigValue).eq('key', 'plan_eligibility').maybeSingle(),
  ]);
  for (const result of [schoolsResult, employeeResult, assignmentResult, sizesResult, exceptionResult, configResult]) {
    if (result.error) throw result.error;
  }
  const overrides = new Map<string, { correctedSize: string | null; exception: z.infer<typeof exceptionSchema> | null }>();
  const sizeRows = z.array(schoolSizeSchema).parse(sizesResult.data);
  const exceptions = new Map(z.array(exceptionRowSchema).parse(exceptionResult.data)
    .map((item) => [item.school_id, { requiredCleaners: item.required_count, reason: item.reason }]));
  for (const item of sizeRows) {
    overrides.set(item.school_id, {
      correctedSize: item.corrected_size,
      exception: exceptions.get(item.school_id) ?? null,
    });
  }
  for (const [schoolId, exception] of exceptions) {
    if (!overrides.has(schoolId)) overrides.set(schoolId, { correctedSize: null, exception });
  }
  return {
    schools: z.array(schoolSchema).parse(schoolsResult.data),
    employees: z.array(employeeSchema).parse(employeeResult.data),
    assignments: z.array(assignmentSchema).parse(assignmentResult.data),
    overrides,
    config: configResult.data ? configSchema.parse(configResult.data.value) : null,
  };
}

export function CleanerPlacementPage({ profile }: { profile: UserProfile | null }) {
  const client = useQueryClient();
  const { formatNumber } = useDisplayFormat();
  const preferences = useContext(preferencesContext);
  const [viewMode, setViewMode] = useState(preferences.cleaner_placement_view);
  const [search, setSearch] = useState('');
  const [newCleaner, setNewCleaner] = useState<Record<string, string>>({});
  const [labourSource, setLabourSource] = useState<Record<string, string>>({});
  const [exceptions, setExceptions] = useState<Record<string, { requiredCleaners: string; reason: string }>>({});
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const data = useQuery({ queryKey: ['cleaner-placement-data'], queryFn: loadPlacementData, enabled: Boolean(profile) });
  const canManage = Boolean(profile && ['admin', 'project_manager', 'area_engineer'].includes(profile.role));
  const canManageStaffingRules = Boolean(profile && ['admin', 'project_manager'].includes(profile.role));
  useEffect(() => setViewMode(preferences.cleaner_placement_view), [preferences.cleaner_placement_view]);
  const eligibleIds = useMemo(() => {
    if (!data.data?.config) return [];
    return eligibleSchoolIds(data.data.schools.map((school) => ({ id: school.id, sourceFields: school.source_fields })), 'maintenance', data.data.config);
  }, [data.data]);
  const summaries = useMemo(() => {
    if (!data.data?.config) return [];
    const eligible = new Set(eligibleIds);
    return data.data.schools.filter((school) => eligible.has(school.id)).map((school): SchoolSummary => {
      const currentAssignments = data.data!.assignments.filter((item) => item.school_id === school.id);
      const override = data.data!.overrides.get(school.id);
      const classes = parseClassCount(school.source_fields[data.data!.config!.classCountHeader]);
      const sourceDeclaredSize = school.size_source ?? (data.data!.config!.schoolSizeHeader
        ? String(school.source_fields[data.data!.config!.schoolSizeHeader] ?? '')
        : null);
      const sourceStaffing = classes === null
        ? {
            size: null, requiredCleaners: null, assignedCleaners: currentAssignments.length,
            shortage: 0, surplus: 0, sizeCorrected: false, exceptionApplied: Boolean(override?.exception),
          } satisfies StaffingResult
        : calculateStaffing({
            classes,
            declaredSize: sourceDeclaredSize,
            assignedCleaners: currentAssignments.length,
            exception: override?.exception,
          });
      const staffing = classes === null || !override?.correctedSize
        ? sourceStaffing
        : calculateStaffing({
            classes,
            declaredSize: override.correctedSize,
            assignedCleaners: currentAssignments.length,
            exception: override.exception,
          });
      staffing.sizeCorrected = sourceStaffing.sizeCorrected || Boolean(override?.correctedSize && override.correctedSize === staffing.size);
      return {
        school,
        staffing,
        neighborhood: String(school.source_fields['الحي'] ?? 'غير محدد'),
        exception: override?.exception ?? null,
      };
    });
  }, [data.data, eligibleIds]);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return summaries.filter(({ school, neighborhood }) =>
      `${school.school_name} ${school.ministry_number} ${neighborhood}`.toLocaleLowerCase().includes(query),
    );
  }, [summaries, search]);

  const persistAssignment = useMutation({
    mutationFn: async ({ schoolId, employeeId, source }: { schoolId: string; employeeId: string; source: string }) => {
      if (!supabase || !canManage) throw new Error('لا تملك صلاحية تعديل التسكين.');
      if (!employeeId) throw new Error('اختر عاملاً أولاً.');
      const { error } = await supabase.from('cleaner_assignments').insert({ school_id: schoolId, employee_id: employeeId, labour_source: source.trim() || 'org_structure' });
      if (error) throw error;
    },
    onSuccess: async () => {
      setMessage('تم تحديث التسكين.');
      await client.invalidateQueries({ queryKey: ['cleaner-placement-data'] });
    },
    onError: (error: Error) => setMessage(`تعذر تحديث التسكين: ${error.message}`),
  });

  const deleteAssignment = useMutation({
    mutationFn: async (id: string) => {
      if (!supabase || !canManage) throw new Error('لا تملك صلاحية تعديل التسكين.');
      const { error } = await supabase.from('cleaner_assignments').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: async () => {
      setMessage('تم حذف التعيين.');
      await client.invalidateQueries({ queryKey: ['cleaner-placement-data'] });
    },
    onError: (error: Error) => setMessage(`تعذر حذف التعيين: ${error.message}`),
  });

  const saveException = useMutation({
    mutationFn: async ({ schoolId, required, reason }: { schoolId: string; required: string; reason: string }) => {
      if (!supabase || !profile || !canManageStaffingRules) throw new Error('لا تملك صلاحية حفظ الاستثناء.');
      const parsed = /^\d+$/.test(required) ? exceptionSchema.safeParse({ requiredCleaners: Number(required), reason }) : null;
      if (!parsed?.success) throw new Error('يتطلب الاستثناء عدداً صحيحاً وسبباً واضحاً.');
      const { error } = await supabase.from('staffing_exceptions').upsert({
        school_id: schoolId,
        created_by: profile.id,
        required_count: parsed.data.requiredCleaners,
        reason: parsed.data.reason,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setMessage('تم حفظ الاستثناء وسبب التعديل.');
      await client.invalidateQueries({ queryKey: ['cleaner-placement-data'] });
    },
    onError: (error: Error) => setMessage(`تعذر حفظ الاستثناء: ${error.message}`),
  });

  const saveCorrection = useMutation({
    mutationFn: async ({ schoolId, correctedSize }: { schoolId: string; correctedSize: string }) => {
      if (!supabase || !profile || !canManageStaffingRules) throw new Error('لا تملك صلاحية تصحيح الحجم.');
      const { error } = await supabase.from('school_size_corrections').upsert({
        school_id: schoolId,
        corrected_size: correctedSize,
        updated_by: profile.id,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setMessage('تم حفظ تصحيح حجم المدرسة.');
      await client.invalidateQueries({ queryKey: ['cleaner-placement-data'] });
    },
    onError: (error: Error) => setMessage(`تعذر تصحيح الحجم: ${error.message}`),
  });

  async function revealResidence(employeeId: string) {
    if (!supabase || !profile || !['admin', 'project_manager', 'area_engineer'].includes(profile.role)) return;
    if (revealed[employeeId]) {
      setRevealed((current) => { const next = { ...current }; delete next[employeeId]; return next; });
      return;
    }
    const { data: value, error } = await supabase.rpc('reveal_residence', { p_kind: 'employees', p_ids: [employeeId] });
    if (error) return setMessage(`تعذر إظهار رقم الإقامة: ${error.message}`);
    const parsed = z.array(z.object({ id: z.string().uuid(), residence_no: z.string().nullable() })).length(1).safeParse(value);
    if (!parsed.success) return setMessage('لم يُرجع النظام رقم إقامة صالحاً.');
    const residenceNumber = parsed.data[0].residence_no;
    if (!residenceNumber) return setMessage('لا يوجد رقم إقامة مسجل لهذا الموظف.');
    setRevealed((current) => ({ ...current, [employeeId]: residenceNumber }));
  }

  async function exportSummary() {
    const XLSX = await loadXlsx();
    const rows = filtered.map(({ school, staffing, neighborhood }) => ({
      'الرقم الوزاري': school.ministry_number,
      'اسم المدرسة': school.school_name,
      'الحي': neighborhood,
      'الحجم المحسوب': staffing.size ?? '',
      'عدد الفصول': parseClassCount(school.source_fields[data.data?.config?.classCountHeader ?? '']) ?? '',
      'المطلوب': staffing.requiredCleaners ?? '',
      'المسند': staffing.assignedCleaners,
      'العجز': staffing.shortage,
      'الفائض': staffing.surplus,
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'تسكين العمالة');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(groupedBySize.map((row) => ({
      'الحجم': sizeLabel(row.label === 'small' ? 'small' : row.label === 'medium' ? 'medium' : row.label === 'large' ? 'large' : null),
      'المطلوب': row.required, 'المسند': row.assigned, 'العجز': row.shortage, 'الفائض': row.surplus,
    }))), 'حسب الحجم');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(groupedByNeighborhood.map((row) => ({
      'الحي': row.label, 'المطلوب': row.required, 'المسند': row.assigned, 'العجز': row.shortage, 'الفائض': row.surplus,
    }))), 'حسب الحي');
    XLSX.writeFile(workbook, 'تسكين-العمالة.xlsx');
  }

  const totals = filtered.reduce((result, row) => ({
    required: result.required + (row.staffing.requiredCleaners ?? 0),
    assigned: result.assigned + row.staffing.assignedCleaners,
    shortage: result.shortage + row.staffing.shortage,
    surplus: result.surplus + row.staffing.surplus,
  }), { required: 0, assigned: 0, shortage: 0, surplus: 0 });
  const groupedBySize = groupTotal(filtered, (row) => row.staffing.size ?? 'غير محدد');
  const groupedByNeighborhood = groupTotal(filtered, (row) => row.neighborhood);
  const saveViewMode = useMutation({
    mutationFn: async (next: 'editable' | 'compact') => {
      if (!supabase || !profile) throw new Error('يلزم تسجيل الدخول لحفظ تفضيل العرض.');
      const { error } = await supabase.from('profiles').update({
        prefs: { ...preferences, cleaner_placement_view: next },
      }).eq('id', profile.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['user-preferences', profile?.id] });
    },
    onError: (error: Error) => {
      setMessage(`تعذر حفظ طريقة العرض: ${error.message}`);
      setViewMode(preferences.cleaner_placement_view);
    },
  });

  return (
    <div className="grid gap-5">
      <section className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm text-slate-500">الاحتياج حسب الفصول والاستثناءات المعتمدة</p><h2 className="mt-1 text-2xl font-bold text-brand-900">تسكين العمالة</h2></div><ImportWizardLauncher target={{ kind: 'cleaners' }} profile={profile} /></section>
      {data.error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">تعذر تحميل بيانات التسكين: {data.error.message}</div>}
      {!data.data?.config && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-7 text-amber-950">يلزم إعداد مطابقة أهلية المدارس في إعدادات النظام قبل عرض المدارس المستقلة والمشترك الأساسي.</div>}
      <section className="grid gap-3 sm:grid-cols-4">
        <Metric label="المطلوب" value={totals.required} formatNumber={formatNumber} />
        <Metric label="المسند" value={totals.assigned} formatNumber={formatNumber} />
        <Metric label="العجز" value={totals.shortage} formatNumber={formatNumber} />
        <Metric label="الفائض" value={totals.surplus} formatNumber={formatNumber} />
      </section>
      <section className="card grid gap-4 p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="min-w-60 flex-1 text-sm font-semibold">بحث باسم المدرسة أو الرقم الوزاري أو الحي<input value={search} onChange={(event) => setSearch(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
          <div className="flex flex-wrap gap-2">
            <label className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <span>طريقة العرض</span>
              <select value={viewMode} disabled={saveViewMode.isPending} onChange={(event) => {
                const next = event.target.value === 'compact' ? 'compact' : 'editable';
                setViewMode(next);
                saveViewMode.mutate(next);
              }} className="rounded border border-slate-300 px-2 py-1">
                <option value="editable">تفصيلي قابل للتعديل</option>
                <option value="compact">مختصر</option>
              </select>
            </label>
            <button type="button" onClick={exportSummary} disabled={!filtered.length} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50">تصدير Excel</button>
          </div>
        </div>
        {data.isLoading ? <p role="status">جارٍ تحميل السجلات…</p> : filtered.length === 0 ? <p className="rounded-lg bg-slate-50 p-5 text-center text-sm text-slate-500">لا توجد مدارس مؤهلة أو سجلات مطابقة.</p> : (
          viewMode === 'compact' ? (
            <div className="table-scroll">
              <table className="min-w-full text-start text-sm">
                <thead><tr><th>الرقم الوزاري</th><th>المدرسة</th><th>الحجم</th><th>مطلوب / مسند</th><th>أسماء العمال</th><th>الحالة</th></tr></thead>
                <tbody>{filtered.map(({ school, staffing }) => {
                  const assignments = data.data?.assignments.filter((item) => item.school_id === school.id) ?? [];
                  const balance = staffing.requiredCleaners === null
                    ? { label: 'الاحتياج غير محدد', style: 'bg-slate-100 text-slate-700' }
                    : staffing.shortage > 0
                      ? { label: `عجز ${staffing.shortage}`, style: 'bg-rose-50 text-rose-800' }
                      : staffing.surplus > 0
                        ? { label: `فائض ${staffing.surplus}`, style: 'bg-amber-50 text-amber-900' }
                        : { label: 'مكتمل', style: 'bg-emerald-50 text-emerald-800' };
                  return <tr key={school.id} className="border-t border-slate-100">
                    <td dir="ltr">{school.ministry_number}</td>
                    <td>{school.school_name}</td>
                    <td>{sizeLabel(staffing.size)}</td>
                    <td>{staffing.requiredCleaners ?? '—'} / {staffing.assignedCleaners}</td>
                    <td className="min-w-56">{assignments.map((item) => item.employee?.full_name ?? item.employee_id).join('، ') || '—'}</td>
                    <td><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${balance.style}`}>{balance.label}</span></td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
          ) : <div className="grid gap-3">
            {filtered.map(({ school, staffing, neighborhood, exception }) => <article key={school.id} className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h3 className="font-bold">{school.school_name}</h3><p className="mt-1 text-xs text-slate-500">الرقم الوزاري: {school.ministry_number} · الحي: {neighborhood}</p></div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full bg-brand-50 px-2.5 py-1 text-brand-900">الحجم: {sizeLabel(staffing.size)}</span>
                  {staffing.sizeCorrected && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-900">تم تصحيح الحجم</span>}
                  {exception && <span className="rounded-full bg-violet-50 px-2.5 py-1 text-violet-900">استثناء معتمد</span>}
                </div>
              </div>
              <div className="mt-3 grid gap-2 text-sm sm:grid-cols-4">
                <p>الفصول: {parseClassCount(school.source_fields[data.data?.config?.classCountHeader ?? '']) ?? 'غير متاح'}</p>
                <p>المطلوب: {staffing.requiredCleaners ?? 'غير محدد'}</p><p>المسند: {staffing.assignedCleaners}</p><p>العجز: {staffing.shortage} · الفائض: {staffing.surplus}</p>
              </div>
              <div className="mt-3 grid gap-2">
                {(data.data?.assignments.filter((item) => item.school_id === school.id) ?? []).map((assignment) => <div key={assignment.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <span className="font-semibold">{assignment.employee?.full_name ?? assignment.employee_id}</span>
                  <span className="text-xs text-slate-500">{assignment.labour_source === 'ajeer' ? 'أجير' : assignment.labour_source === 'org_structure' ? 'الهيكل التنظيمي' : 'مصدر العمالة غير محدد'}</span>
                  <span className="text-xs text-slate-600">{revealed[assignment.employee_id] ?? '••••••'}</span>
                  {['admin', 'project_manager'].includes(profile?.role ?? '') && <button type="button" onClick={() => void revealResidence(assignment.employee_id)} aria-label={revealed[assignment.employee_id] ? 'إخفاء رقم الإقامة' : 'إظهار رقم الإقامة'} className="rounded p-1 text-brand-700">{revealed[assignment.employee_id] ? <EyeOff size={15} /> : <Eye size={15} />}</button>}
                  {canManage && <button type="button" onClick={() => deleteAssignment.mutate(assignment.id)} className="me-auto text-xs text-rose-700">إزالة</button>}
                </div>)}
              </div>
              {canManage && <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <select value={newCleaner[school.id] ?? ''} onChange={(event) => setNewCleaner((current) => ({ ...current, [school.id]: event.target.value }))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">اختر عاملاً</option>{(data.data?.employees ?? []).map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name} · {employee.job_title}</option>)}</select>
                <select value={labourSource[school.id] ?? 'org_structure'} onChange={(event) => setLabourSource((current) => ({ ...current, [school.id]: event.target.value }))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="org_structure">الهيكل التنظيمي</option><option value="ajeer">أجير</option></select>
                <button type="button" onClick={() => persistAssignment.mutate({ schoolId: school.id, employeeId: newCleaner[school.id] ?? '', source: labourSource[school.id] ?? '' })} disabled={persistAssignment.isPending} className="rounded-lg border border-brand-700 px-3 py-2 text-sm font-semibold text-brand-800 disabled:opacity-50">إضافة عامل</button>
              </div>}
              {canManageStaffingRules && staffing.sizeCorrected && staffing.size && <button type="button" onClick={() => saveCorrection.mutate({ schoolId: school.id, correctedSize: staffing.size! })} disabled={saveCorrection.isPending} className="mt-3 rounded-lg border border-amber-300 px-3 py-2 text-sm text-amber-900 disabled:opacity-50">حفظ تصحيح الحجم</button>}
              {canManageStaffingRules && staffing.requiredCleaners !== null && <details className="mt-3 rounded-lg border border-slate-200 p-3">
                <summary className="cursor-pointer text-sm font-semibold">استثناء لهذه المدرسة</summary>
                <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
                  <input aria-label="العدد المطلوب بعد الاستثناء" type="number" min="0" value={exceptions[school.id]?.requiredCleaners ?? String(exception?.requiredCleaners ?? staffing.requiredCleaners)} onChange={(event) => setExceptions((current) => ({ ...current, [school.id]: { requiredCleaners: event.target.value, reason: current[school.id]?.reason ?? exception?.reason ?? '' } }))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                  <input aria-label="سبب الاستثناء" value={exceptions[school.id]?.reason ?? exception?.reason ?? ''} onChange={(event) => setExceptions((current) => ({ ...current, [school.id]: { requiredCleaners: current[school.id]?.requiredCleaners ?? String(exception?.requiredCleaners ?? staffing.requiredCleaners), reason: event.target.value } }))} placeholder="سبب الاستثناء" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                  <button type="button" onClick={() => saveException.mutate({ schoolId: school.id, required: exceptions[school.id]?.requiredCleaners ?? String(exception?.requiredCleaners ?? staffing.requiredCleaners), reason: exceptions[school.id]?.reason ?? exception?.reason ?? '' })} disabled={saveException.isPending} className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-50">حفظ الاستثناء</button>
                </div>
              </details>}
            </article>)}
          </div>
        )}
        {message && <p role="status" className="text-sm text-slate-700">{message}</p>}
      </section>
      <section className="grid gap-4 md:grid-cols-2">
        <TotalsTable title="الملخص حسب حجم المدرسة" rows={groupedBySize} formatNumber={formatNumber} />
        <TotalsTable title="الملخص حسب الحي" rows={groupedByNeighborhood} formatNumber={formatNumber} />
      </section>
    </div>
  );
}

function sizeLabel(size: StaffingResult['size']): string {
  return size === 'small' ? 'صغير' : size === 'medium' ? 'متوسط' : size === 'large' ? 'كبير' : 'غير محدد';
}

function groupTotal(rows: SchoolSummary[], key: (row: SchoolSummary) => string) {
  const groups = new Map<string, { required: number; assigned: number; shortage: number; surplus: number }>();
  for (const row of rows) {
    const label = key(row);
    const current = groups.get(label) ?? { required: 0, assigned: 0, shortage: 0, surplus: 0 };
    current.required += row.staffing.requiredCleaners ?? 0;
    current.assigned += row.staffing.assignedCleaners;
    current.shortage += row.staffing.shortage;
    current.surplus += row.staffing.surplus;
    groups.set(label, current);
  }
  return [...groups.entries()].map(([label, values]) => ({ label, ...values }));
}

function Metric({ label, value, formatNumber }: { label: string; value: number; formatNumber: (value: string | number) => string }) {
  return <article className="card p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold text-brand-900">{formatNumber(value)}</p></article>;
}

function TotalsTable({ title, rows, formatNumber }: { title: string; rows: ReturnType<typeof groupTotal>; formatNumber: (value: string | number) => string }) {
  return <section className="card p-4"><h3 className="font-bold">{title}</h3><div className="mt-3 table-scroll"><table><thead><tr><th>التصنيف</th><th>مطلوب</th><th>مسند</th><th>عجز</th><th>فائض</th></tr></thead><tbody>{rows.map((row) => <tr key={row.label}><td>{row.label}</td><td>{formatNumber(row.required)}</td><td>{formatNumber(row.assigned)}</td><td>{formatNumber(row.shortage)}</td><td>{formatNumber(row.surplus)}</td></tr>)}</tbody></table></div></section>;
}

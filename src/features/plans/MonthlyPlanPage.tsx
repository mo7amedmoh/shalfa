import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { loadXlsx } from '../../lib/xlsx';
import { isPlanRowOverdue } from '../../domain/plans';
import { eligibleSchoolIds, type PlanEligibilityConfig } from '../../domain/planEligibility';
import { schoolPersonDefault } from '../../domain/imports';
import type { ScheduleAssignment } from '../../domain/planScheduler';
import type { PlanType } from '../../domain/types';
import type { UserProfile } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { APP_SCHEMA_SELECT } from '../../lib/schemaColumns';
import { useDisplayFormat } from '../../app/useDisplayFormat';
import { ImportWizardLauncher } from '../imports/ImportWizard';
import { BulkPlanUpdates } from './BulkPlanUpdates';
import { SupervisorPlanGenerator } from './SupervisorPlanGenerator';

const sourceSchoolSchema = z.object({
  id: z.string().uuid(),
  school_name: z.string(),
  ministry_number: z.string(),
  ministry_key: z.string(),
  source_fields: z.record(z.string(), z.unknown()),
  neighbourhood: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
});
const eligibilitySchema = z.object({
  buildingTypeHeader: z.string(),
  independentBuildingValues: z.array(z.string()),
  primarySharedValues: z.array(z.string()),
  elevatorContractorHeader: z.string(),
  noElevatorValues: z.array(z.string()),
});
const planSchema = z.object({
  id: z.string().uuid(),
  plan_month: z.string(),
});
const rowSchema = z.object({
  id: z.string().uuid(),
  school_id: z.string().uuid(),
  planned_date: z.string(),
  visited: z.boolean(),
  visited_at: z.string().nullable(),
  report_completed_at: z.string().nullable(),
  engineer_id: z.string().uuid().nullable(),
  supervisor_id: z.string().uuid().nullable(),
  supervisor_name: z.string().nullable(),
  engineer_name: z.string().nullable(),
  contractor_name: z.string().nullable(),
  school: z.object({ school_name: z.string(), ministry_number: z.string(), ministry_key: z.string() }).nullable(),
});
type PlanRow = z.infer<typeof rowSchema>;
type CandidateData = { schools: z.infer<typeof sourceSchoolSchema>[]; eligibility: PlanEligibilityConfig | null };

const planTitles: Record<PlanType, string> = {
  maintenance: 'الصيانة',
  cleaning: 'النظافة',
  security_safety: 'الأمن والسلامة',
  elevators: 'المصاعد',
};

async function loadCandidates(): Promise<CandidateData> {
  if (!supabase) return { schools: [], eligibility: null };
  const [schoolsResult, settingsResult] = await Promise.all([
    supabase.from('schools').select(APP_SCHEMA_SELECT.schoolsPlanGenerator).order('name'),
    supabase.from('app_config').select(APP_SCHEMA_SELECT.appConfigValue).eq('key', 'plan_eligibility').maybeSingle(),
  ]);
  if (schoolsResult.error) throw schoolsResult.error;
  if (settingsResult.error) throw settingsResult.error;
  const schools = z.array(sourceSchoolSchema).parse(schoolsResult.data);
  const eligibility = settingsResult.data
    ? eligibilitySchema.parse(settingsResult.data.value)
    : null;
  return { schools, eligibility };
}

async function loadPlans(planType: PlanType) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('monthly_plans')
    .select(APP_SCHEMA_SELECT.monthlyPlanList)
    .eq('plan_type', planType)
    .order('month', { ascending: false });
  if (error) throw error;
  return z.array(planSchema).parse(data);
}

async function loadPlanRows(planId: string): Promise<PlanRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('monthly_plan_rows')
    .select(APP_SCHEMA_SELECT.monthlyPlanRows)
    .eq('plan_id', planId)
    .order('planned_date');
  if (error) throw error;
  return z.array(rowSchema).parse(data);
}

function localDate(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function currentMonth(): string {
  return localDate().slice(0, 7);
}

export function MonthlyPlanPage({ planType, profile }: { planType: PlanType; profile: UserProfile | null }) {
  const queryClient = useQueryClient();
  const { formatNumber, formatDate } = useDisplayFormat();
  const [month, setMonth] = useState(currentMonth());
  const [activePlanId, setActivePlanId] = useState('');
  const [actualDates, setActualDates] = useState<Record<string, { visited: string; report: string }>>({});
  const [message, setMessage] = useState('');
  const candidates = useQuery({ queryKey: ['monthly-plan-candidates'], queryFn: loadCandidates });
  const plans = useQuery({ queryKey: ['monthly-plans', planType], queryFn: () => loadPlans(planType) });
  const eligibleIds = useMemo(() => {
    if (!candidates.data?.eligibility) return [];
    return eligibleSchoolIds(
      candidates.data.schools.map((school) => ({ id: school.id, sourceFields: school.source_fields })),
      planType,
      candidates.data.eligibility,
    );
  }, [candidates.data, planType]);
  const eligibleSchools = useMemo(() => {
    const eligible = new Set(eligibleIds);
    return candidates.data?.schools.filter((school) => eligible.has(school.id)) ?? [];
  }, [candidates.data, eligibleIds]);
  const activePlan = plans.data?.find((plan) => plan.id === activePlanId);
  const rows = useQuery({
    queryKey: ['monthly-plan-rows', activePlanId],
    queryFn: () => loadPlanRows(activePlanId),
    enabled: Boolean(activePlanId),
  });
  const canCreate = Boolean(profile && ['admin', 'project_manager', 'area_engineer'].includes(profile.role));
  const canUpdate = Boolean(profile && ['admin', 'project_manager', 'area_engineer', 'report_follower'].includes(profile.role));
  const loadError = candidates.error ?? plans.error ?? rows.error;
  const loadErrorMessage = loadError instanceof Error ? loadError.message : String(loadError ?? '');
  const loadErrorDetails = /ministry_key/i.test(loadErrorMessage)
    ? `طبّق الترحيل 202611070001_ministry_key.sql. ${loadErrorMessage}`
    : loadErrorMessage;

  useEffect(() => {
    if (plans.data?.length && !plans.data.some((plan) => plan.id === activePlanId)) setActivePlanId(plans.data[0].id);
  }, [plans.data, activePlanId]);
  useEffect(() => {
    if (!rows.data) return;
    setActualDates(Object.fromEntries(rows.data.map((row) => [row.id, {
      visited: row.visited_at ?? '',
      report: row.report_completed_at ?? '',
    }])));
  }, [rows.data]);

  const createPlan = useMutation({
    mutationFn: async (assignments: ScheduleAssignment[]) => {
      if (!supabase || !profile) throw new Error('يلزم تسجيل الدخول لإنشاء الخطة.');
      if (!canCreate) throw new Error('لا تملك صلاحية إنشاء الخطط.');
      if (!candidates.data?.eligibility) throw new Error('يلزم اعتماد قواعد أهلية المدارس أولاً.');
      const currentEligible = new Set(eligibleIds);
      if (!assignments.length || assignments.some((assignment) => !currentEligible.has(assignment.schoolId))) {
        throw new Error('اختر مدرسة واحدة على الأقل من المدارس المؤهلة.');
      }
      if (new Set(assignments.map((assignment) => assignment.schoolId)).size !== assignments.length
        || assignments.some((assignment) => {
        const parsed = new Date(`${assignment.plannedDate}T00:00:00.000Z`);
        return !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== assignment.plannedDate || assignment.plannedDate.slice(0, 7) !== month;
      })) {
        throw new Error('تأكد من عدم تكرار المدارس، وأن جميع المواعيد تقع ضمن الشهر المحدد.');
      }
      const { data: createdPlan, error: createError } = await supabase
        .from('monthly_plans')
        .insert({ month: `${month}-01`, plan_type: planType, created_by: profile.id })
        .select(APP_SCHEMA_SELECT.id)
        .single();
      if (createError) throw createError;
      const { error: rowsError } = await supabase.from('monthly_plan_rows').insert(
        assignments.map((assignment) => ({
          plan_id: createdPlan.id,
          school_id: assignment.schoolId,
          planned_date: assignment.plannedDate,
          supervisor_id: assignment.supervisorId,
          supervisor_name: assignment.supervisorName,
        })),
      );
      if (rowsError) {
        const { error: rollbackError } = await supabase.from('monthly_plans').delete().eq('id', createdPlan.id);
        if (rollbackError) throw new Error(`تعذر حفظ صفوف الخطة، كما تعذر حذف الخطة الفارغة: ${rowsError.message}; ${rollbackError.message}`);
        throw rowsError;
      }
      return createdPlan.id as string;
    },
    onSuccess: async (createdPlanId) => {
      setActivePlanId(createdPlanId);
      setMessage('تم إنشاء الخطة وحفظ مواعيد المدارس.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['monthly-plans', planType] }),
        queryClient.invalidateQueries({ queryKey: ['monthly-plan-rows', createdPlanId] }),
      ]);
    },
    onError: (error: Error) => setMessage(`تعذر إنشاء الخطة: ${error.message}`),
  });

  const updateRow = useMutation({
    mutationFn: async ({ rowId, field, value }: { rowId: string; field: 'visited_at' | 'report_completed_at'; value: string | null }) => {
      if (!supabase) throw new Error('يلزم إعداد Supabase.');
      if (field === 'report_completed_at' && value && !rows.data?.find((row) => row.id === rowId)?.visited_at) {
        throw new Error('لا يمكن إكمال التقرير قبل تسجيل الزيارة.');
      }
      const { error } = await supabase.from('monthly_plan_rows').update({
        [field === 'visited_at' ? 'visited_date' : 'report_done_date']: value || null,
        [field === 'visited_at' ? 'visited' : 'report_done']: Boolean(value),
      }).eq('id', rowId);
      if (error) throw error;
    },
    onSuccess: async () => {
      setMessage('تم تحديث تاريخ التنفيذ.');
      await queryClient.invalidateQueries({ queryKey: ['monthly-plan-rows', activePlanId] });
    },
    onError: (error: Error) => setMessage(`تعذر تحديث السجل: ${error.message}`),
  });

  const deletePlan = useMutation({
    mutationFn: async ({ rowsOnly }: { rowsOnly: boolean }) => {
      if (!supabase || !profile || !activePlan) throw new Error('اختر خطة أولاً.');
      if (!['admin', 'project_manager', 'area_engineer'].includes(profile.role)) throw new Error('لا تملك صلاحية الحذف.');
      const currentRows = rows.data ?? [];
      const visited = currentRows.filter((row) => row.visited_at).length;
      const reports = currentRows.filter((row) => row.report_completed_at).length;
      const answer = window.prompt(`سيتم حذف ${currentRows.length} صفاً، ${visited} زيارة، ${reports} تقريراً. اكتب حذف للتأكيد.`);
      if (answer !== 'حذف') throw new Error('لم يتم تأكيد الحذف.');
      const XLSX = await loadXlsx();
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(currentRows), 'نسخة احتياطية');
      XLSX.writeFile(book, `نسخة-خطة-${planType}-${activePlan.plan_month.slice(0, 7)}.xlsx`);
      const { error: rowError } = await supabase.from('monthly_plan_rows').delete().eq('plan_id', activePlan.id);
      if (rowError) throw rowError;
      if (!rowsOnly) {
        const { error } = await supabase.from('monthly_plans').delete().eq('id', activePlan.id);
        if (error) throw error;
      }
    },
    onSuccess: async () => {
      setMessage('تم الحذف وتحديث الصفحة.');
      setActivePlanId('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['monthly-plans', planType] }),
        queryClient.invalidateQueries({ queryKey: ['monthly-plan-rows', activePlanId] }),
      ]);
    },
    onError: (error: Error) => setMessage(error.message),
  });
  const deleteRow = useMutation({
    mutationFn: async (rowId: string) => {
      if (!supabase || !canCreate) throw new Error('لا تملك صلاحية الحذف.');
      const answer = window.prompt('اكتب حذف لتأكيد حذف هذا الصف.');
      if (answer !== 'حذف') throw new Error('لم يتم تأكيد الحذف.');
      const { error } = await supabase.from('monthly_plan_rows').delete().eq('id', rowId);
      if (error) throw error;
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['monthly-plan-rows', activePlanId] }); },
    onError: (error: Error) => setMessage(error.message),
  });

  const today = localDate();
  const completedVisits = rows.data?.filter((row) => row.visited_at).length ?? 0;
  const completedReports = rows.data?.filter((row) => row.report_completed_at).length ?? 0;
  const monthEnd = month && /^\d{4}-\d{2}$/.test(month)
    ? new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10)
    : '';
  const schedulerSchools = eligibleSchools.map((school) => ({
    id: school.id,
    name: school.school_name,
    ministryNumber: school.ministry_number,
    supervisorName: schoolPersonDefault({ source_fields: school.source_fields }, 'supervisor', planType) || null,
    neighbourhood: school.neighbourhood,
    latitude: school.latitude,
    longitude: school.longitude,
  }));

  return (
    <div className="monthly-plan-page grid gap-5">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-sm text-slate-500">الخطط الشهرية · متابعة المدارس والإنجاز</p>
        <h2 className="mt-1 text-2xl font-bold text-brand-900">خطة {planTitles[planType]}</h2></div>
        <div className="flex flex-wrap gap-2"><ImportWizardLauncher target={{ kind: 'monthly', planType }} profile={profile} />
          {activePlan && canCreate && <><button type="button" onClick={() => deletePlan.mutate({ rowsOnly: true })} className="rounded-lg border border-rose-300 px-3 py-2 text-sm text-rose-800">مسح صفوف الخطة</button><button type="button" onClick={() => deletePlan.mutate({ rowsOnly: false })} className="rounded-lg bg-rose-700 px-3 py-2 text-sm text-white">حذف الخطة</button></>}</div>
      </section>
      {loadError && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">تعذر تحميل بيانات الخطط أو المدارس: {loadErrorDetails}</div>}

      <section className="card grid gap-4 p-5">
        <div>
          <h3 className="font-bold text-slate-900">إنشاء خطة وتوزيع المواعيد</h3>
          <p className="mt-1 text-sm text-slate-500">المدارس المؤهلة تُحدد من قواعد المدير. لا تُستخدم قيم مصدر غير معتمدة.</p>
        </div>
        {!candidates.data?.eligibility ? (
          <div className="rounded-lg bg-amber-50 p-4 text-sm leading-7 text-amber-950">لم تُعتمد مطابقة أهلية المدارس. اطلب من مدير النظام ضبطها في «المزامنة والإعدادات» قبل إنشاء الخطة.</div>
        ) : <>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-semibold">الشهر<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2" /></label>
          </div>
          {candidates.isLoading ? <p role="status">جارٍ تحميل المدارس…</p> : !monthEnd ? <p role="alert" className="text-sm text-rose-700">اختر شهراً صالحاً.</p> : eligibleSchools.length === 0 ? <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">لا توجد مدارس مؤهلة وفق المطابقة الحالية.</p> : (
            <SupervisorPlanGenerator
              key={`${planType}-${month}`}
              schools={schedulerSchools}
              initialSchoolIds={eligibleIds}
              startDate={`${month}-01`}
              endDate={monthEnd}
              minDate={`${month}-01`}
              maxDate={monthEnd}
              disabled={!canCreate}
              saving={createPlan.isPending}
              onSave={(assignments) => createPlan.mutate(assignments)}
            />
          )}
        </>}
        {!canCreate && <p className="text-xs text-slate-500">إنشاء الخطة متاح لمهندس المنطقة أو مدير المشروع أو مدير النظام.</p>}
        {message && <p role="status" className="text-sm text-slate-700">{message}</p>}
      </section>

      <section className="card grid gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h3 className="font-bold text-slate-900">الخطط المنشأة</h3><p className="mt-1 text-sm text-slate-500">زيارة: {formatNumber(completedVisits)} · تقرير مكتمل: {formatNumber(completedReports)}</p></div>
          <select aria-label="اختر خطة للشهر" value={activePlanId} onChange={(event) => setActivePlanId(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2">
            {(plans.data ?? []).map((plan) => <option key={plan.id} value={plan.id}>{plan.plan_month.slice(0, 7)}</option>)}
            {!plans.data?.length && <option value="">لا توجد خطط</option>}
          </select>
        </div>
        {rows.isLoading ? <p role="status">جارٍ تحميل صفوف الخطة…</p> : !activePlan ? <p className="rounded-lg bg-slate-50 p-5 text-center text-sm text-slate-500">لا توجد خطة من هذا النوع بعد.</p> : (
          <>
            <details className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <summary className="cursor-pointer text-sm font-bold text-brand-900">جودة بيانات الخطة</summary>
              <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                <QualityBadge label="صفوف دون مشرف" count={(rows.data ?? []).filter((row) => !row.supervisor_id && planType !== 'elevators' && planType !== 'security_safety').length} />
                <QualityBadge label="صفوف دون موعد مخطط" count={(rows.data ?? []).filter((row) => !row.planned_date).length} />
                <QualityBadge label="تقارير مرفوعة دون زيارة" count={(rows.data ?? []).filter((row) => Boolean(row.report_completed_at) && !row.visited_at).length} />
              </div>
            </details>
            <BulkPlanUpdates
              key={activePlan.id}
              planKind="monthly"
              planId={activePlan.id}
              disabled={!canUpdate}
              rows={(rows.data ?? []).map((row) => ({
                id: row.id,
                schoolName: row.school?.school_name ?? row.school_id,
                ministryNumber: row.school?.ministry_number ?? '',
                ministryKey: row.school?.ministry_key ?? '',
                supervisorName: row.supervisor_name,
                visited: row.visited,
                visitedAt: row.visited_at,
                reportAt: row.report_completed_at,
              }))}
              allSchools={(candidates.data?.schools ?? []).map((school) => ({
                schoolName: school.school_name,
                ministryNumber: school.ministry_number,
                ministryKey: school.ministry_key,
              }))}
              onUpdated={() => queryClient.invalidateQueries({ queryKey: ['monthly-plan-rows', activePlanId] }).then(() => undefined)}
            />
            <div className="table-scroll monthly-plan-table-scroll">
              <table className="monthly-plan-table">
                <thead><tr><th>المدرسة</th><th>الموعد المخطط</th>{planType === 'security_safety' || planType === 'elevators' ? <th>الشركة</th> : null}<th>تاريخ الزيارة</th><th>تاريخ إنجاز التقرير</th><th>الحالة</th></tr></thead>
                <tbody>{(rows.data ?? []).map((row) => {
                  const dates = actualDates[row.id] ?? { visited: row.visited_at ?? '', report: row.report_completed_at ?? '' };
                  const overdue = isPlanRowOverdue({
                    plannedDate: row.planned_date,
                    visitedAt: row.visited_at,
                    reportCompletedAt: row.report_completed_at,
                  }, today);
                  return <tr key={row.id}>
                    <td>{row.school?.school_name ?? row.school_id}<small className="block text-xs text-slate-400">{row.school?.ministry_number}</small>{row.supervisor_name && <small className="block text-xs text-slate-500">المشرف: {row.supervisor_name}</small>}</td>
                    <td>{formatDate(row.planned_date)}</td>
                    {(planType === 'security_safety' || planType === 'elevators') && <td>{row.contractor_name ?? '—'}</td>}
                    <td><DateEditor value={dates.visited} onChange={(value) => setActualDates((current) => ({ ...current, [row.id]: { ...dates, visited: value } }))} onSave={() => updateRow.mutate({ rowId: row.id, field: 'visited_at', value: dates.visited || null })} label="حفظ الزيارة" disabled={!canUpdate || updateRow.isPending} /></td>
                    <td><DateEditor value={dates.report} onChange={(value) => setActualDates((current) => ({ ...current, [row.id]: { ...dates, report: value } }))} onSave={() => updateRow.mutate({ rowId: row.id, field: 'report_completed_at', value: dates.report || null })} label="حفظ التقرير" disabled={!canUpdate || updateRow.isPending} /></td>
                    <td>{overdue ? <span className="rounded-full bg-rose-50 px-2 py-1 text-xs text-rose-800">متأخر</span> : row.visited_at && row.report_completed_at ? 'مكتمل' : 'قيد المتابعة'}{canCreate && <button type="button" className="ms-2 text-xs text-rose-700 underline" onClick={() => deleteRow.mutate(row.id)}>حذف الصف</button>}</td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
            {rows.data?.length === 0 && <p className="text-sm text-slate-500">لا توجد مدارس في هذه الخطة.</p>}
          </>
        )}
      </section>
      <p className="text-xs leading-6 text-slate-400">تُستثنى الجمعة والسبت افتراضياً ويمكن تعديل أيام العطلة عند التوزيع. قواعد الأهلية قابلة للتهيئة؛ راجع <Link to="/schools" className="text-brand-700 underline">بيانات المدارس</Link>.</p>
    </div>
  );
}

function DateEditor({ value, onChange, onSave, label, disabled }: { value: string; onChange: (value: string) => void; onSave: () => void; label: string; disabled: boolean }) {
  return <div className="flex items-center gap-2">
    <input type="date" value={value} onChange={(event) => onChange(event.target.value)} className="rounded border border-slate-300 px-2 py-1" />
    <button type="button" onClick={onSave} disabled={disabled} className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50">{label}</button>
  </div>;
}

function QualityBadge({ label, count }: { label: string; count: number }) {
  return <div className={`flex items-center justify-between rounded-lg border px-3 py-2 ${count ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>
    <span>{label}</span><strong>{count}</strong>
  </div>;
}

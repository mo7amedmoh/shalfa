import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { distributePlanDates, isPlanRowOverdue } from '../../domain/plans';
import { eligibleSchoolIds, type PlanEligibilityConfig } from '../../domain/planEligibility';
import type { PlanType } from '../../domain/types';
import type { UserProfile } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { useDisplayFormat } from '../../app/useDisplayFormat';

const sourceSchoolSchema = z.object({
  id: z.string().uuid(),
  school_name: z.string(),
  ministry_number: z.string(),
  source_fields: z.record(z.string(), z.unknown()),
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
  created_by: z.string().uuid(),
});
const rowSchema = z.object({
  id: z.string().uuid(),
  school_id: z.string().uuid(),
  planned_date: z.string(),
  visited_at: z.string().nullable(),
  report_completed_at: z.string().nullable(),
  school: z.object({ school_name: z.string(), ministry_number: z.string() }).nullable(),
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
    supabase.from('schools').select('id,school_name:name,ministry_number:ministry_no,source_fields:extra').order('name'),
    supabase.from('app_config').select('value').eq('key', 'plan_eligibility').maybeSingle(),
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
    .select('id,plan_month:month,created_by')
    .eq('plan_type', planType)
    .order('month', { ascending: false });
  if (error) throw error;
  return z.array(planSchema).parse(data);
}

async function loadPlanRows(planId: string): Promise<PlanRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('monthly_plan_rows')
    .select('id,school_id,planned_date,visited_at:visited_date,report_completed_at:report_done_date,school:schools(school_name:name,ministry_number:ministry_no)')
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
  const [startDate, setStartDate] = useState(`${currentMonth()}-01`);
  const [schoolsPerDay, setSchoolsPerDay] = useState('5');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [generatedDates, setGeneratedDates] = useState<Record<string, string>>({});
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

  useEffect(() => {
    setSelectedIds(eligibleIds);
  }, [eligibleIds]);
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
    mutationFn: async () => {
      if (!supabase || !profile) throw new Error('يلزم تسجيل الدخول لإنشاء الخطة.');
      if (!canCreate) throw new Error('لا تملك صلاحية إنشاء الخطط.');
      if (!candidates.data?.eligibility) throw new Error('يلزم اعتماد قواعد أهلية المدارس أولاً.');
      const currentEligible = new Set(eligibleIds);
      if (selectedIds.length === 0 || selectedIds.some((id) => !currentEligible.has(id))) {
        throw new Error('اختر مدرسة واحدة على الأقل من المدارس المؤهلة.');
      }
      const distribution = distributePlanDates(selectedIds, {
        startDate,
        schoolsPerDay: Number(schoolsPerDay),
      });
      const finalDates = distribution.map((visit) => ({
        ...visit,
        plannedDate: generatedDates[visit.schoolId] ?? visit.plannedDate,
      }));
      if (finalDates.some((visit) => {
        const parsed = new Date(`${visit.plannedDate}T00:00:00.000Z`);
        return !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== visit.plannedDate || visit.plannedDate.slice(0, 7) !== month;
      })) {
        throw new Error('توزيع المواعيد يتجاوز الشهر المحدد. قلل عدد المدارس أو غيّر تاريخ البداية.');
      }
      const { data: createdPlan, error: createError } = await supabase
        .from('monthly_plans')
        .insert({ month: `${month}-01`, plan_type: planType, created_by: profile.id })
        .select('id')
        .single();
      if (createError) throw createError;
      const { error: rowsError } = await supabase.from('monthly_plan_rows').insert(
        finalDates.map((visit) => ({ plan_id: createdPlan.id, school_id: visit.schoolId, planned_date: visit.plannedDate })),
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

  function prepareDates() {
    try {
      const dates = distributePlanDates(selectedIds, { startDate, schoolsPerDay: Number(schoolsPerDay) });
      setGeneratedDates(Object.fromEntries(dates.map((item) => [item.schoolId, item.plannedDate])));
      setMessage(`تم توزيع المواعيد على ${dates.length} مدرسة. يمكنك تعديل كل تاريخ قبل الحفظ.`);
    } catch (error) {
      setMessage(error instanceof Error ? `تحقق من مدخلات التوزيع: ${error.message}` : 'تعذر توزيع المواعيد.');
    }
  }

  const today = localDate();
  const completedVisits = rows.data?.filter((row) => row.visited_at).length ?? 0;
  const completedReports = rows.data?.filter((row) => row.report_completed_at).length ?? 0;

  return (
    <div className="grid gap-5">
      <section>
        <p className="text-sm text-slate-500">الخطط الشهرية · متابعة المدارس والإنجاز</p>
        <h2 className="mt-1 text-2xl font-bold text-brand-900">خطة {planTitles[planType]}</h2>
      </section>
      {(candidates.error || plans.error || rows.error) && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">تعذر تحميل بيانات الخطط أو المدارس. تحقق من اتصال Supabase وسياسات الوصول.</div>}

      <section className="card grid gap-4 p-5">
        <div>
          <h3 className="font-bold text-slate-900">إنشاء خطة وتوزيع المواعيد</h3>
          <p className="mt-1 text-sm text-slate-500">المدارس المؤهلة تُحدد من قواعد المدير. لا تُستخدم قيم مصدر غير معتمدة.</p>
        </div>
        {!candidates.data?.eligibility ? (
          <div className="rounded-lg bg-amber-50 p-4 text-sm leading-7 text-amber-950">لم تُعتمد مطابقة أهلية المدارس. اطلب من مدير النظام ضبطها في «المزامنة والإعدادات» قبل إنشاء الخطة.</div>
        ) : <>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1 text-sm font-semibold">الشهر<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2" /></label>
            <label className="grid gap-1 text-sm font-semibold">تاريخ بداية التوزيع<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2" /></label>
            <label className="grid gap-1 text-sm font-semibold">مدارس لكل يوم<input type="number" min="1" value={schoolsPerDay} onChange={(event) => setSchoolsPerDay(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2" /></label>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>المدارس المؤهلة: {eligibleSchools.length} · المحددة: {selectedIds.length}</span>
            <div className="flex gap-2">
              <button type="button" onClick={() => setSelectedIds(eligibleIds)} className="rounded-lg border border-slate-300 px-3 py-1.5">تحديد المؤهلة</button>
              <button type="button" onClick={() => setSelectedIds([])} className="rounded-lg border border-slate-300 px-3 py-1.5">إلغاء التحديد</button>
            </div>
          </div>
          {candidates.isLoading ? <p role="status">جارٍ تحميل المدارس…</p> : eligibleSchools.length === 0 ? <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">لا توجد مدارس مؤهلة وفق المطابقة الحالية.</p> : (
            <div className="max-h-52 overflow-y-auto rounded-lg border border-slate-200 p-3">
              {eligibleSchools.map((school) => <label key={school.id} className="flex items-center gap-2 py-1.5 text-sm">
                <input type="checkbox" checked={selectedIds.includes(school.id)} onChange={(event) => setSelectedIds((ids) => event.target.checked ? [...ids, school.id] : ids.filter((id) => id !== school.id))} />
                <span>{school.school_name}</span><span className="text-slate-400">{school.ministry_number}</span>
                {generatedDates[school.id] && <input aria-label={`موعد ${school.school_name}`} type="date" value={generatedDates[school.id]} onChange={(event) => setGeneratedDates((dates) => ({ ...dates, [school.id]: event.target.value }))} className="me-auto rounded border border-slate-300 px-2 py-1" />}
              </label>)}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={prepareDates} disabled={!selectedIds.length || !canCreate} className="rounded-lg border border-brand-700 px-4 py-2 text-sm font-semibold text-brand-800 disabled:opacity-50">توزيع المواعيد</button>
            <button type="button" onClick={() => createPlan.mutate()} disabled={!Object.keys(generatedDates).length || createPlan.isPending || !canCreate} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{createPlan.isPending ? 'جارٍ الحفظ…' : 'إنشاء الخطة'}</button>
          </div>
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
            <div className="table-scroll">
              <table>
                <thead><tr><th>المدرسة</th><th>الموعد المخطط</th><th>تاريخ الزيارة</th><th>تاريخ إنجاز التقرير</th><th>الحالة</th></tr></thead>
                <tbody>{(rows.data ?? []).map((row) => {
                  const dates = actualDates[row.id] ?? { visited: row.visited_at ?? '', report: row.report_completed_at ?? '' };
                  const overdue = isPlanRowOverdue({
                    plannedDate: row.planned_date,
                    visitedAt: row.visited_at,
                    reportCompletedAt: row.report_completed_at,
                  }, today);
                  return <tr key={row.id}>
                    <td>{row.school?.school_name ?? row.school_id}<small className="block text-xs text-slate-400">{row.school?.ministry_number}</small></td>
                    <td>{formatDate(row.planned_date)}</td>
                    <td><DateEditor value={dates.visited} onChange={(value) => setActualDates((current) => ({ ...current, [row.id]: { ...dates, visited: value } }))} onSave={() => updateRow.mutate({ rowId: row.id, field: 'visited_at', value: dates.visited || null })} label="حفظ الزيارة" disabled={!canUpdate || updateRow.isPending} /></td>
                    <td><DateEditor value={dates.report} onChange={(value) => setActualDates((current) => ({ ...current, [row.id]: { ...dates, report: value } }))} onSave={() => updateRow.mutate({ rowId: row.id, field: 'report_completed_at', value: dates.report || null })} label="حفظ التقرير" disabled={!canUpdate || updateRow.isPending} /></td>
                    <td>{overdue ? <span className="rounded-full bg-rose-50 px-2 py-1 text-xs text-rose-800">متأخر</span> : row.visited_at && row.report_completed_at ? 'مكتمل' : 'قيد المتابعة'}</td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
            {rows.data?.length === 0 && <p className="text-sm text-slate-500">لا توجد مدارس في هذه الخطة.</p>}
          </>
        )}
      </section>
      <p className="text-xs leading-6 text-slate-400">تجاوز الجمعة والسبت تلقائي في توزيع المواعيد. قواعد الأهلية قابلة للتهيئة؛ راجع <Link to="/schools" className="text-brand-700 underline">بيانات المدارس</Link>.</p>
    </div>
  );
}

function DateEditor({ value, onChange, onSave, label, disabled }: { value: string; onChange: (value: string) => void; onSave: () => void; label: string; disabled: boolean }) {
  return <div className="flex items-center gap-2">
    <input type="date" value={value} onChange={(event) => onChange(event.target.value)} className="rounded border border-slate-300 px-2 py-1" />
    <button type="button" onClick={onSave} disabled={disabled} className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50">{label}</button>
  </div>;
}

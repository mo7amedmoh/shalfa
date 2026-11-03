import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpLeft, ArrowUpRight, CalendarCheck, ChartNoAxesCombined, ExternalLink, UsersRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { staffingRowsForEligibleSchools, summarizeDashboardPlans, summarizeDashboardStaffing, summarizeDashboardVisits } from '../../domain/dashboard';
import type { PlanEligibilityConfig } from '../../domain/planEligibility';
import { supabase } from '../../lib/supabase';
import { useDisplayFormat } from '../../app/useDisplayFormat';

const planTypeSchema = z.enum(['maintenance', 'cleaning', 'security_safety', 'elevators']);
const planSchema = z.object({
  plan_type: planTypeSchema,
  monthly_plan_rows: z.array(z.object({ visited_at: z.string().nullable(), report_completed_at: z.string().nullable() })),
});
const sourceSchoolSchema = z.object({ id: z.string().uuid(), source_fields: z.record(z.string(), z.unknown()) });
const assignmentSchema = z.object({ school_id: z.string().uuid() });
const sizeCorrectionSchema = z.object({ school_id: z.string().uuid(), corrected_size: z.string() });
const exceptionSchemaRow = z.object({ school_id: z.string().uuid(), required_count: z.number().int(), reason: z.string() });
const eligibilitySchema = z.object({
  buildingTypeHeader: z.string(),
  independentBuildingValues: z.array(z.string()),
  primarySharedValues: z.array(z.string()),
  elevatorContractorHeader: z.string(),
  noElevatorValues: z.array(z.string()),
  classCountHeader: z.string().default('عدد الفصول'),
  schoolSizeHeader: z.string().default(''),
});
const exceptionSchema = z.object({ requiredCleaners: z.number().int().min(0), reason: z.string().trim().min(1) });
type EligibilitySettings = PlanEligibilityConfig & { classCountHeader: string; schoolSizeHeader: string };
type SchoolData = {
  schools: z.infer<typeof sourceSchoolSchema>[];
  assignmentCounts: Map<string, number>;
  overrides: Map<string, { correctedSize: string | null; exception: z.infer<typeof exceptionSchema> | null }>;
  config: EligibilitySettings | null;
};

function currentMonth(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

async function loadCurrentPlanRows() {
  if (!supabase) return [];
  const { data, error } = await supabase.from('monthly_plans')
    .select('plan_type,monthly_plan_rows(visited_at:visited_date,report_completed_at:report_done_date)')
    .eq('month', `${currentMonth()}-01`);
  if (error) throw error;
  return z.array(planSchema).parse(data).flatMap((plan) =>
    plan.monthly_plan_rows.map((row) => ({
      planType: plan.plan_type,
      visitedAt: row.visited_at,
      reportCompletedAt: row.report_completed_at,
    })),
  );
}

async function loadStaffingSchools(): Promise<SchoolData> {
  if (!supabase) return { schools: [], assignmentCounts: new Map(), overrides: new Map(), config: null };
  const [schoolsResult, assignmentsResult, overridesResult, exceptionsResult, configResult] = await Promise.all([
    supabase.from('schools').select('id,source_fields:extra'),
    supabase.from('cleaner_assignments').select('school_id'),
    supabase.from('school_size_corrections').select('school_id,corrected_size'),
    supabase.from('staffing_exceptions').select('school_id,required_count,reason'),
    supabase.from('app_config').select('value').eq('key', 'plan_eligibility').maybeSingle(),
  ]);
  for (const result of [schoolsResult, assignmentsResult, overridesResult, exceptionsResult, configResult]) {
    if (result.error) throw result.error;
  }
  const assignmentCounts = new Map<string, number>();
  for (const { school_id } of z.array(assignmentSchema).parse(assignmentsResult.data)) {
    assignmentCounts.set(school_id, (assignmentCounts.get(school_id) ?? 0) + 1);
  }
  const overrides = new Map<string, { correctedSize: string | null; exception: z.infer<typeof exceptionSchema> | null }>();
  for (const row of z.array(sizeCorrectionSchema).parse(overridesResult.data)) {
    overrides.set(row.school_id, { correctedSize: row.corrected_size, exception: null });
  }
  for (const row of z.array(exceptionSchemaRow).parse(exceptionsResult.data)) {
    const current = overrides.get(row.school_id) ?? { correctedSize: null, exception: null };
    current.exception = exceptionSchema.parse({ requiredCleaners: row.required_count, reason: row.reason });
    overrides.set(row.school_id, current);
  }
  return {
    schools: z.array(sourceSchoolSchema).parse(schoolsResult.data),
    assignmentCounts,
    overrides,
    config: configResult.data ? eligibilitySchema.parse(configResult.data.value) : null,
  };
}

export function DashboardPage() {
  const { formatNumber } = useDisplayFormat();
  const plans = useQuery({ queryKey: ['dashboard-current-plan-rows', currentMonth()], queryFn: loadCurrentPlanRows });
  const staffingData = useQuery({ queryKey: ['dashboard-staffing-schools'], queryFn: loadStaffingSchools });
  const planProgress = useMemo(() => summarizeDashboardPlans(plans.data ?? []), [plans.data]);
  const staffing = useMemo(() => {
    const data = staffingData.data;
    if (!data?.config) return null;
    const dashboardSchools = data.schools.map((school) => {
      const override = data.overrides.get(school.id);
      return {
        id: school.id,
        sourceFields: school.source_fields,
        assignedCleaners: data.assignmentCounts.get(school.id) ?? 0,
        declaredSize: override?.correctedSize ?? (data.config!.schoolSizeHeader ? String(school.source_fields[data.config!.schoolSizeHeader] ?? '') : null),
        exception: override?.exception,
      };
    });
    return summarizeDashboardStaffing(staffingRowsForEligibleSchools(dashboardSchools, data.config));
  }, [staffingData.data]);
  const visitSummary = summarizeDashboardVisits(planProgress);
  const lastKpiScore = '—';

  return (
    <div className="grid gap-6">
      <section className="flex flex-col justify-between gap-5 rounded-2xl bg-gradient-to-l from-brand-950 to-brand-700 p-6 text-white md:flex-row md:items-center md:p-8">
        <div>
          <p className="text-sm text-brand-100">منصة إدارة مشروع إدارة المرافق المدرسية</p>
          <h2 className="mt-2 text-2xl font-bold md:text-3xl">مرحباً بك في منصة شلفا</h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-brand-100">مساحة موحدة لمتابعة المدارس والخطط والقوى العاملة ومؤشرات الأداء.</p>
        </div>
        <a href="https://rifad-three.vercel.app/" target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 font-bold text-brand-900 transition hover:bg-brand-50">منصة رِفاد <ExternalLink size={17} /></a>
      </section>

      <section aria-label="ملخص المشروع" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <article className="card p-5"><MetricHead title="إنجاز الخطط الشهرية" value={plans.error ? 'تعذر التحميل' : plans.isLoading ? '…' : `${formatNumber(visitSummary.visited)} / ${formatNumber(visitSummary.total)}`} icon={CalendarCheck} /><p className="mt-4 text-xs text-slate-500">الزيارات المسجلة للشهر الحالي</p></article>
        <article className="card p-5"><MetricHead title="العجز في القوى العاملة" value={staffingData.error ? 'تعذر التحميل' : staffingData.isLoading ? '…' : staffing ? formatNumber(staffing.shortage) : '—'} icon={UsersRound} /><p className="mt-4 text-xs text-slate-500">{staffing ? `المطلوب ${formatNumber(staffing.required)} · المسند ${formatNumber(staffing.assigned)}${staffing.missingClassCount ? ` · مدارس بلا عدد فصول ${formatNumber(staffing.missingClassCount)}` : ''}` : staffingData.data?.config ? 'لا توجد مدارس مؤهلة' : 'اضبط مطابقة أهلية المدارس وأعداد الفصول'}</p></article>
        <article className="card p-5"><MetricHead title="آخر نتيجة أداء" value={lastKpiScore} icon={ChartNoAxesCombined} /><p className="mt-4 text-xs text-slate-500">تتطلب اعتماد نتائج المصنف الرسمي</p></article>
      </section>

      {plans.error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">تعذر تحميل تقدم الخطط الشهرية: {plans.error.message}</p>}
      {staffingData.error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">تعذر تحميل ملخص التسكين: {staffingData.error.message}</p>}
      <section className="grid gap-4 lg:grid-cols-2">
        <article className="card p-5">
          <div className="flex items-center justify-between gap-3"><div><h2 className="font-bold text-slate-900">تقدم الخطط الحالية</h2><p className="mt-1 text-sm text-slate-500">نسبة الزيارات المسجلة من إجمالي المدارس في الخطة.</p></div><Link to="/plans/report" aria-label="عرض التقرير العام" className="rounded-lg p-2 text-brand-700 hover:bg-brand-50"><ArrowUpLeft size={20} /></Link></div>
          <div className="mt-6 grid gap-4">{planProgress.map((progress) => <div key={progress.planType} className="grid grid-cols-[96px_1fr_48px] items-center gap-3 text-sm"><span>{planLabels[progress.planType]}</span><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-600" style={{ width: `${progress.visitPercent}%` }} /></div><span className="text-xs text-slate-500">{formatNumber(progress.visitPercent.toFixed(0))}%</span></div>)}</div>
        </article>
        <article className="card flex flex-col justify-between p-5"><div><h2 className="font-bold text-slate-900">ملخص القوى العاملة</h2><p className="mt-1 text-sm text-slate-500">الاحتياج وفق قواعد الفصول للمدارس المؤهلة.</p><div className="mt-6 rounded-xl bg-slate-50 p-5 text-center"><p className="text-sm text-slate-500">إجمالي العجز المسجل</p><p className="mt-2 text-3xl font-bold text-brand-900">{staffing ? formatNumber(staffing.shortage) : '—'}</p></div></div><Link to="/placement/cleaners" className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-brand-700 hover:text-brand-900">عرض تسكين العمالة <ArrowUpRight size={17} /></Link></article>
      </section>
    </div>
  );
}

const planLabels = { maintenance: 'الصيانة', cleaning: 'النظافة', security_safety: 'الأمن والسلامة', elevators: 'المصاعد' };

function MetricHead({ title, value, icon: Icon }: { title: string; value: string; icon: typeof CalendarCheck }) {
  return <div className="flex items-start justify-between gap-3"><div><p className="text-sm text-slate-500">{title}</p><p className="mt-3 text-3xl font-bold text-brand-900">{value}</p></div><span className="rounded-xl bg-brand-50 p-3 text-brand-700"><Icon size={21} /></span></div>;
}

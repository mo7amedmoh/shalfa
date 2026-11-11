import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarClock, ClipboardList, FileCheck2, UsersRound } from 'lucide-react';
import type { PlanType } from '../../domain/types';
import type { UserProfile } from '../../lib/auth';
import { useDisplayFormat } from '../../app/useDisplayFormat';
import { useDashboardData } from './useDashboardData';

const serviceLabels: Record<PlanType, string> = {
  maintenance: 'الصيانة والتكييف',
  cleaning: 'النظافة',
  security_safety: 'الأمن والسلامة',
  elevators: 'المصاعد',
};

const serviceOrder: readonly PlanType[] = ['maintenance', 'cleaning', 'security_safety', 'elevators'];

function currentMonth(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function validMonth(value: string | null): string {
  if (!value || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return currentMonth();
  const date = new Date(`${value}-01T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 7) === value ? value : currentMonth();
}

function validService(value: string | null): PlanType | 'all' {
  return value === 'maintenance' || value === 'cleaning' || value === 'security_safety' || value === 'elevators'
    ? value
    : 'all';
}

export function DashboardPage({ profile = null }: { profile?: UserProfile | null }) {
  const { formatDate, formatDateTime, formatNumber } = useDisplayFormat();
  const [searchParams, setSearchParams] = useSearchParams();
  const month = validMonth(searchParams.get('month'));
  const supervisorId = searchParams.get('supervisor') ?? '';
  const serviceType = validService(searchParams.get('service'));
  const dashboard = useDashboardData(profile, { month, supervisorId, serviceType });
  const updateFilter = (key: 'month' | 'service' | 'supervisor', value: string, defaultValue: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === defaultValue) next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  };
  const resetFilters = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('month');
    next.delete('service');
    next.delete('supervisor');
    setSearchParams(next, { replace: true });
  };
  const verdictTone = dashboard.verdict.status === 'on-track'
    ? 'border-emerald-500'
    : dashboard.verdict.status === 'slightly-behind'
      ? 'border-amber-500'
      : dashboard.verdict.status === 'far-behind'
        ? 'border-rose-600'
        : 'border-slate-300';
  const statusLabel = dashboard.verdict.status === 'on-track'
    ? 'على المسار'
    : dashboard.verdict.status === 'slightly-behind'
      ? 'متأخرون قليلاً'
      : dashboard.verdict.status === 'far-behind'
        ? 'متأخرون عن الخطة'
        : 'لا توجد خطة';
  const monthLabel = `${new Intl.DateTimeFormat('ar-SA', { month: 'long' }).format(new Date(`${dashboard.month}-01T00:00:00Z`))} ${formatNumber(dashboard.month.slice(0, 4))}`;
  const reportFilters = new URLSearchParams({
    month: dashboard.month,
    service: serviceType,
  });
  if (supervisorId) reportFilters.set('supervisor', supervisorId);
  const reportUrl = `/plans/report?${reportFilters.toString()}`;
  const counts = dashboard.actionCounts;
  const workforce = dashboard.workforce;
  const value = (count: number | undefined, loading = false) => count === undefined
    ? loading ? '…' : '—'
    : formatNumber(count);
  const serviceProgress = new Map(dashboard.services.map((service) => [service.planType, service]));

  return (
    <div className="grid gap-5" dir="rtl">
      <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-2xl font-extrabold text-brand-900">لوحة التحكم</h2>
          <p className="mt-1 text-sm text-slate-500">
            {monthLabel} · حتى يوم {formatDate(dashboard.asOf)}
            {dashboard.access.syncTime && (
              <>
                <span className="mx-2 text-slate-300">·</span>
                آخر مزامنة للمدارس: {dashboard.syncTimeError
                  ? 'تعذر التحميل'
                  : dashboard.syncTimeLoading
                    ? 'جارٍ التحميل…'
                  : dashboard.lastSchoolSyncAt
                    ? `${formatDate(dashboard.lastSchoolSyncAt.slice(0, 10))} ${dashboard.lastSchoolSyncAt.slice(11, 16)}`
                    : 'غير متاح'}
              </>
            )}
          </p>
        </div>
        <div className="grid w-full grid-cols-1 gap-2 sm:w-auto sm:grid-cols-2 xl:grid-cols-4">
          <label className="grid min-w-0 gap-1 text-xs font-semibold text-slate-500">
            الشهر
            <input
              aria-label="تصفية حسب الشهر"
              type="month"
              value={dashboard.month}
              onChange={(event) => updateFilter('month', event.target.value, currentMonth())}
              className="w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
            />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            المشرف
            <select
              aria-label="تصفية حسب المشرف"
              value={supervisorId}
              onChange={(event) => updateFilter('supervisor', event.target.value, '')}
              className="w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
            >
              <option value="">كل المشرفين</option>
              {dashboard.supervisors.map((supervisor) => (
                <option key={supervisor.id} value={supervisor.id}>{supervisor.name}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            الخدمة
            <select
              aria-label="تصفية حسب الخدمة"
              value={serviceType}
              onChange={(event) => updateFilter('service', event.target.value, 'all')}
              className="w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
            >
              <option value="all">كل الخدمات</option>
              {serviceOrder.map((type) => <option key={type} value={type}>{serviceLabels[type]}</option>)}
            </select>
          </label>
          <button type="button" onClick={resetFilters} className="self-end rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            إعادة ضبط الفلاتر
          </button>
        </div>
      </section>

      {dashboard.access.reportFollowerView && (
        <ReportFollowerDashboard
          month={dashboard.month}
          serviceType={serviceType}
          supervisorId={supervisorId}
          lateItems={dashboard.lateItems}
          lateCount={dashboard.lateVisitCount}
          loading={dashboard.plansLoading}
          error={dashboard.plansError}
          formatDate={formatDate}
          formatNumber={formatNumber}
        />
      )}

      {dashboard.access.plans && !dashboard.access.reportFollowerView && (
      <section className={`card border-t-4 p-5 sm:p-6 ${verdictTone}`} aria-labelledby="dashboard-verdict-title">
        {dashboard.plansLoading ? <CardSkeleton /> : dashboard.plansError
          ? <CardError title="تعذر تحميل ملخص الخطة" message={dashboard.plansError.message} />
          : dashboard.verdict.status === 'no-plan' ? (
          <div>
            <p id="dashboard-verdict-title" className="text-sm font-bold text-slate-500">هل نمشي مع الخطة؟</p>
            <p className="mt-2 text-lg font-bold text-slate-800">لا توجد خطة شهرية لهذه التصفية.</p>
          </div>
        ) : (
          <div className="flex flex-col justify-between gap-6 xl:flex-row xl:items-center">
            <div className="min-w-0">
              <p id="dashboard-verdict-title" className="text-sm font-bold text-slate-500">هل نمشي مع الخطة؟</p>
              <h3 className="mt-1 text-2xl font-extrabold text-slate-900">
                {dashboard.verdict.status === 'on-track'
                  ? statusLabel
                  : `متأخرون ${formatNumber(dashboard.verdict.behind)} زيارة عن المتوقع`}
              </h3>
              <p className="mt-2 text-sm leading-7 text-slate-600">
                {dashboard.verdict.firstSlipDay
                  ? <>بدأ التأخر يوم <b>{formatDate(dashboard.verdict.firstSlipDay)}</b></>
                  : 'لا يوجد يوم تأخر مسجل حتى الآن'}
                {' · '}
                {dashboard.verdict.requiredDailyPace === null
                  ? 'لا توجد أيام عمل متبقية'
                  : <>المطلوب <b>{formatNumber(dashboard.verdict.requiredDailyPace.toFixed(1))}</b> زيارة يوميًا لإنجاز المتبقي</>}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 xl:min-w-[520px]">
              <Metric label="المنجز حتى اليوم" value={formatNumber(dashboard.verdict.done)} tone="text-emerald-700" />
              <Metric label="المتوقع حتى اليوم" value={formatNumber(dashboard.verdict.expected)} tone="text-brand-900" />
              <div className="col-span-2 sm:col-span-1">
                <div className="flex justify-between gap-2 text-xs text-slate-500">
                  <span>تقدم الشهر</span>
                  <span>{formatNumber(dashboard.verdict.elapsedWorkingDays)} من {formatNumber(dashboard.verdict.totalWorkingDays)} يوم عمل</span>
                </div>
                <div
                  className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-100"
                  role="progressbar"
                  aria-label="تقدم أيام العمل في الشهر"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={dashboard.verdict.monthProgressPercent}
                >
                  <div className="h-full rounded-full bg-brand-800" style={{ width: `${dashboard.verdict.monthProgressPercent}%` }} />
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
      )}

      {dashboard.access.actions && (
      <section aria-labelledby="dashboard-actions-title">
        <h3 id="dashboard-actions-title" className="mb-3 text-base font-extrabold text-brand-900">يحتاج إجراء حتى التاريخ المحدد</h3>
        {dashboard.plansLoading ? <CardSkeleton /> : dashboard.plansError
          ? <CardError title="تعذر تحميل الإجراءات المرتبطة بالخطط" message={dashboard.plansError.message} />
          : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <ActionTile
            to={`${reportUrl}&action=late-visits`}
            title="زيارات متأخرة"
            value={value(counts?.lateVisits)}
            action="عرض القائمة"
            icon={<CalendarClock size={18} />}
            tone="text-rose-700"
          />
          <ActionTile
            to={`${reportUrl}&action=visit-no-report`}
            title="تمت بدون تقرير"
            value={value(counts?.visitedWithoutReport)}
            action="تحديث التقارير"
            icon={<FileCheck2 size={18} />}
            tone="text-amber-700"
          />
          <ActionTile
            to="/placement/cleaners?shortage=true"
            title="عجز عمالة نظافة"
            value={dashboard.staffingConfigured ? value(counts?.cleanerShortage, dashboard.staffingLoading) : '—'}
            action="فتح التسكين"
            icon={<UsersRound size={18} />}
            tone="text-amber-700"
            detail={dashboard.staffingError?.message
            ?? (!dashboard.staffingConfigured
              ? 'إعدادات الاحتياج غير متاحة'
              : 'إجمالي التغطية الحالية لجميع الخدمات')}
          />
          {dashboard.access.deliverables && (
            <ActionTile
              to="/kpi/deliverables?filter=due-soon"
              title="مخرجات تستحق خلال 14 يومًا"
              value={value(counts?.deliverablesDueSoon, dashboard.deliverablesLoading)}
              action="عرض المخرجات"
              icon={<ClipboardList size={18} />}
              tone="text-brand-800"
              detail={dashboard.deliverablesError?.message}
            />
          )}
          {dashboard.access.kpi && (
            <ActionTile
              to={`/kpi/scorecards?month=${previousMonth(dashboard.month)}`}
              title={`بطاقة ${new Intl.DateTimeFormat('ar-SA', { month: 'long' }).format(new Date(`${previousMonth(dashboard.month)}-01T00:00:00Z`))} غير معتمدة`}
              value={value(counts?.previousKpiNotApproved, dashboard.previousKpiLoading)}
              action="فتح البطاقة"
              icon={<FileCheck2 size={18} />}
              tone="text-brand-800"
              detail={dashboard.previousKpiError?.message}
            />
          )}
        </div>
          )}
      </section>
      )}

      {dashboard.access.plans && !dashboard.access.reportFollowerView && (
      <section aria-label="تقدم الخدمات الشهرية" className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {dashboard.plansLoading ? <CardSkeleton /> : dashboard.plansError
          ? <CardError title="تعذر تحميل تقدم الخدمات" message={dashboard.plansError.message} />
          : serviceOrder.filter((type) => serviceType === 'all' || type === serviceType).map((type) => {
          const progress = serviceProgress.get(type);
          if (!progress || !progress.planned) {
            return (
              <article key={type} className="card p-4 sm:p-5">
                <h3 className="font-bold text-slate-800">{serviceLabels[type]}</h3>
                <p className="mt-4 text-sm font-semibold text-slate-500">لا توجد خطة</p>
              </article>
            );
          }
          const chip = progress.status === 'on-track'
            ? { label: 'على المسار', tone: 'bg-emerald-100 text-emerald-800' }
            : {
              label: `متأخر ${formatNumber(progress.behind)}`,
              tone: progress.status === 'far-behind' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800',
            };
          return (
            <article key={type} className="card p-4 sm:p-5">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-bold text-slate-800">{serviceLabels[type]}</h3>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${chip.tone}`}>{chip.label}</span>
              </div>
              <p className="mt-4 text-3xl font-extrabold text-slate-900">{formatNumber(progress.overallPercent.toFixed(1))}%</p>
              <p className="mt-1 text-xs text-slate-500">
                زيارات {formatNumber(progress.visited)}/{formatNumber(progress.planned)}
                {' · '}
                تقارير {formatNumber(progress.reportsDone)}/{formatNumber(progress.planned)}
              </p>
              <div
                className="relative mt-4 h-2.5 rounded-full bg-slate-100"
                role="progressbar"
                aria-label={`نسبة إنجاز ${serviceLabels[type]}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress.overallPercent}
              >
                <div className="absolute inset-y-0 start-0 rounded-full bg-emerald-600" style={{ width: `${progress.overallPercent}%` }} />
                <span
                  className="absolute -top-1 -bottom-1 z-10 w-0.5 bg-brand-900"
                  style={{ insetInlineStart: `${progress.expectedPercent}%` }}
                  title={`المتوقع ${formatNumber(progress.expectedPercent.toFixed(1))}%`}
                />
              </div>
              <p className="mt-2 text-[11px] text-slate-400">العلامة: المتوقع حتى اليوم</p>
            </article>
          );
        })}
      </section>
      )}

      {dashboard.access.workforce && !dashboard.access.reportFollowerView && (
      <section className="grid gap-4 xl:grid-cols-2" aria-label="التزام المشرفين والقوى العاملة">
        <article className="card p-5">
          <h3 className="font-extrabold text-brand-900">التزام مشرفي الصيانة</h3>
          {dashboard.plansLoading ? <CardSkeleton /> : dashboard.plansError
            ? <CardError title="تعذر تحميل التزام المشرفين" message={dashboard.plansError.message} />
            : dashboard.compliance.length ? (
            <div className="mt-4 grid gap-3">
              {dashboard.compliance.map((supervisor) => {
                const band = supervisor.percent >= 70
                  ? 'bg-emerald-500'
                  : supervisor.percent >= 40 ? 'bg-amber-500' : 'bg-rose-500';
                return (
                  <div key={supervisor.id}>
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="font-semibold text-slate-700">{supervisor.name}</span>
                      <span className="shrink-0 text-slate-500">
                        {formatNumber(supervisor.completedOnTime)}/{formatNumber(supervisor.planned)}
                        {' · '}
                        {formatNumber(supervisor.percent.toFixed(0))}%
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
                      <div className={`h-full rounded-full ${band}`} style={{ width: `${supervisor.percent}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-500">لا توجد زيارات صيانة مستحقة حتى اليوم.</p>
          )}
          <p className="mt-4 border-t border-slate-100 pt-3 text-xs leading-6 text-slate-500">
            الالتزام = الزيارات المكتملة في موعدها (تاريخ الزيارة ≤ التاريخ المخطط) ÷ صفوف الصيانة المستحقة حتى اليوم. الزيارة المتأخرة لا تُحسب في البسط.
          </p>
        </article>

        <article className="card p-5">
          <h3 className="font-extrabold text-brand-900">تغطية القوى العاملة</h3>
          <p className="mt-1 text-xs text-slate-500">الحالة الحالية للمدارس المؤهلة؛ لا تتغير بفلاتر الخدمة أو المشرف.</p>
          {dashboard.staffingLoading ? <CardSkeleton /> : dashboard.staffingError
            ? <CardError title="تعذر تحميل تغطية القوى العاملة" message={dashboard.staffingError.message} />
            : !dashboard.staffingConfigured ? (
            <p className="mt-4 text-sm text-slate-500">إعدادات احتياج القوى العاملة غير متاحة.</p>
          ) : workforce ? (
            <div className="mt-4 grid gap-4">
              <CoverageLine label="البوابون" assigned={workforce.gatekeepers.assigned} required={workforce.gatekeepers.required} formatNumber={formatNumber} />
              <CoverageLine label="عمال النظافة" assigned={workforce.cleaners.assigned} required={workforce.cleaners.required} formatNumber={formatNumber} />
              <p className="text-xs font-semibold text-slate-600">
                عجز في {formatNumber(workforce.cleaners.shortageSchools)} مدرسة
                {workforce.cleaners.netBalance > 0
                  ? ` · عجز صافي ${formatNumber(workforce.cleaners.netBalance)}`
                  : workforce.cleaners.netBalance < 0
                    ? ` · فائض صافي ${formatNumber(Math.abs(workforce.cleaners.netBalance))}`
                    : ' · التوازن الصافي مكتمل'}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-slate-500">
                    <tr>
                      <th scope="col" className="py-1 text-start font-semibold">حجم المدرسة</th>
                      <th scope="col" className="px-2 py-1 text-center font-semibold">المطلوب</th>
                      <th scope="col" className="py-1 text-center font-semibold">المعيّن</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {([
                      ['small', 'صغيرة'],
                      ['medium', 'متوسطة'],
                      ['large', 'كبيرة'],
                    ] as const).map(([size, label]) => (
                      <tr key={size}>
                        <th scope="row" className="py-1 text-start font-medium">{label}</th>
                        <td className="px-2 py-1 text-center">{formatNumber(workforce.cleaners.bySize[size].required)}</td>
                        <td className="py-1 text-center">{formatNumber(workforce.cleaners.bySize[size].assigned)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <CoverageLine label="الإجمالي" assigned={workforce.total.assigned} required={workforce.total.required} formatNumber={formatNumber} />
                <p className={`mt-2 text-xs font-bold ${workforce.total.netBalance > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                  {workforce.total.netBalance > 0
                    ? `عجز صافي ${formatNumber(workforce.total.netBalance)}`
                    : workforce.total.netBalance < 0
                      ? `فائض صافي ${formatNumber(Math.abs(workforce.total.netBalance))}`
                      : 'التغطية مكتملة'}
                </p>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-500">لا توجد بيانات تغطية.</p>
          )}
        </article>
        {dashboard.access.rewardsShortcut && (
          <Link to={`/rewards?month=${encodeURIComponent(dashboard.month)}`} className="card flex min-h-32 items-center justify-between gap-4 p-5 transition hover:border-brand-300">
            <span>
              <span className="block font-extrabold text-brand-900">مكافآت الفنيين</span>
              <span className="mt-1 block text-sm text-slate-500">فتح بيانات المكافآت المتاحة لدورك</span>
            </span>
            <span aria-hidden="true" className="text-xl text-brand-700">←</span>
          </Link>
        )}
      </section>
      )}

      {dashboard.access.kpi && (
        <section className="grid gap-4 lg:grid-cols-2" aria-label="مؤشرات الأداء والمخرجات">
          <article className="card p-5">
            <h3 className="font-extrabold text-brand-900">بطاقة أداء الشهر المحدد</h3>
            {dashboard.kpiLoading ? <CardSkeleton /> : dashboard.kpiError
              ? <CardError title="تعذر تحميل بطاقة الأداء" message={dashboard.kpiError.message} />
              : dashboard.latestKpi ? (
              <>
                <p className="mt-2 text-sm text-slate-500">
                  {dashboard.latestKpi.month.slice(0, 7) === dashboard.month
                    ? dashboard.month
                    : `آخر بطاقة: ${formatNumber(dashboard.latestKpi.month.slice(0, 7))}`}
                  {dashboard.latestKpi.contractMonth !== null && ` · الشهر التعاقدي ${formatNumber(dashboard.latestKpi.contractMonth)}`}
                </p>
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <Metric label="النتيجة" value={dashboard.latestKpi.scorePercent === null
                    ? '—'
                    : `${formatNumber(dashboard.latestKpi.scorePercent.toFixed(1))}%`} tone="text-brand-900" />
                  <Metric label="معامل الاستحقاق" value={dashboard.latestKpi.payablePercent === null
                    ? '—'
                    : `${formatNumber(dashboard.latestKpi.payablePercent.toFixed(1))}%`} tone="text-emerald-700" />
                </div>
                <p className="mt-3 text-sm text-slate-600">
                  التصنيف: <b>{dashboard.latestKpi.rating === 'excellent'
                    ? 'ممتاز'
                    : dashboard.latestKpi.rating === 'average'
                      ? 'جيد'
                      : dashboard.latestKpi.rating === 'weak' ? 'ضعيف' : 'غير متاح'}</b>
                </p>
              </>
            ) : (
              <p className="mt-4 text-sm text-slate-500">لا توجد بطاقة أداء مسجلة.</p>
            )}
          </article>

          <article className="card p-5">
            <h3 className="font-extrabold text-brand-900">المخرجات التعاقدية</h3>
            <p className="mt-1 text-xs text-slate-500">إجمالي المخرجات التعاقدية؛ يحسب التأخر حتى تاريخ التصفية المحدد.</p>
            {dashboard.deliverablesLoading ? <CardSkeleton /> : dashboard.deliverablesError
              ? <CardError title="تعذر تحميل المخرجات" message={dashboard.deliverablesError.message} />
              : dashboard.deliverableSummary ? (
              <>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <DeliverableCount label="معتمد" value={dashboard.deliverableSummary.approved} formatNumber={formatNumber} />
                  <DeliverableCount label="بانتظار الاعتماد" value={dashboard.deliverableSummary.delivered - dashboard.deliverableSummary.approved} formatNumber={formatNumber} />
                  <DeliverableCount label="غير مسلّم" value={dashboard.deliverableSummary.total - dashboard.deliverableSummary.delivered} formatNumber={formatNumber} />
                  <DeliverableCount label="متأخر" value={dashboard.deliverableSummary.late} formatNumber={formatNumber} />
                </div>
                <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-slate-100" role="progressbar"
                  aria-label="نسبة المخرجات المسلّمة" aria-valuemin={0} aria-valuemax={100}
                  aria-valuenow={dashboard.deliverableSummary.progressPercent}>
                  <div className="h-full rounded-full bg-emerald-600" style={{ width: `${dashboard.deliverableSummary.progressPercent}%` }} />
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  {formatNumber(dashboard.deliverableSummary.delivered)} من {formatNumber(dashboard.deliverableSummary.total)} مخرج مسلّم
                </p>
              </>
            ) : (
              <p className="mt-4 text-sm text-slate-500">جارٍ تحميل ملخص المخرجات…</p>
            )}
          </article>

          {dashboard.access.activity && (
            <article className="card p-5 lg:col-span-2">
              <h3 className="font-extrabold text-brand-900">آخر النشاطات خلال الشهر المحدد</h3>
              <p className="mt-1 text-xs text-slate-500">سجل التدقيق لا يصنف الأحداث حسب الخدمة أو المشرف.</p>
              {dashboard.activityLoading ? <CardSkeleton /> : dashboard.activityError
                ? <CardError title="تعذر تحميل النشاطات" message={dashboard.activityError.message} />
                : dashboard.recentActivity.length ? (
                <ol className="mt-4 grid gap-3">
                  {dashboard.recentActivity.map((event) => (
                    <li key={event.id} className="flex flex-col justify-between gap-1 border-b border-slate-100 pb-3 text-sm sm:flex-row sm:items-center">
                      <span className="font-medium text-slate-700">{event.message}</span>
                      <time className="shrink-0 text-xs text-slate-400" dateTime={event.at}><bdi dir="ltr">{formatDateTime(event.at)}</bdi></time>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-4 text-sm text-slate-500">لا توجد نشاطات مهمة مسجلة.</p>
              )}
            </article>
          )}
        </section>
      )}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return <div><p className="text-xs text-slate-500">{label}</p><p className={`mt-1 text-3xl font-extrabold ${tone}`}>{value}</p></div>;
}

function CardSkeleton() {
  return (
    <div role="status" aria-label="جارٍ التحميل" className="grid gap-3 py-2">
      <span className="h-4 w-2/5 animate-pulse rounded bg-slate-200" />
      <span className="h-8 w-3/5 animate-pulse rounded bg-slate-100" />
      <span className="h-3 w-full animate-pulse rounded bg-slate-100" />
    </div>
  );
}

function CardError({ title, message }: { title: string; message: string }) {
  return (
    <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
      <p className="font-bold">{title}</p>
      <p className="mt-1 break-words">{message}</p>
    </div>
  );
}

function ReportFollowerDashboard({
  month,
  serviceType,
  supervisorId,
  lateItems,
  lateCount,
  loading,
  error,
  formatDate,
  formatNumber,
}: {
  month: string;
  serviceType: PlanType | 'all';
  supervisorId: string;
  lateItems: readonly { id: string; planType: PlanType; schoolName: string; plannedDate: string; supervisorName: string | null }[];
  lateCount: number;
  loading: boolean;
  error: Error | null;
  formatDate: (value: string) => string;
  formatNumber: (value: number) => string;
}) {
  const planType = serviceType === 'all' ? 'maintenance' : serviceType;
  const bulkUpdateUrl = `/plans/${planType}?month=${encodeURIComponent(month)}`;
  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <Link to={bulkUpdateUrl} className="card flex min-h-40 flex-col justify-between gap-5 p-5 transition hover:border-brand-300">
        <div>
          <h3 className="font-extrabold text-brand-900">التحديث الجماعي للخطة</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">افتح خطة الشهر والخدمة المحددين للوصول إلى أداة التحديث الجماعي.</p>
        </div>
        <span className="text-sm font-bold text-brand-800">فتح أداة التحديث ←</span>
      </Link>
      <article className="card min-w-0 p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-extrabold text-brand-900">زيارات متأخرة</h3>
          <span className="rounded-full bg-rose-50 px-3 py-1 text-sm font-bold text-rose-700">
            {loading ? '…' : error ? '—' : formatNumber(lateCount)}
          </span>
        </div>
        {loading ? <CardSkeleton />
          : error ? <CardError title="تعذر تحميل الزيارات المتأخرة" message={error.message} />
            : lateItems.length ? (
              <ul className="mt-4 grid gap-2">
                {lateItems.map((item) => (
                  <li key={item.id} className="border-b border-slate-100 pb-2 text-sm">
                    <Link
                      to={`/plans/report?${new URLSearchParams({
                        month,
                        service: item.planType,
                        action: 'late-visits',
                        ...(supervisorId ? { supervisor: supervisorId } : {}),
                      }).toString()}`}
                      className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 hover:text-brand-800"
                    >
                      <span className="min-w-0 truncate font-semibold text-slate-700">{item.schoolName}</span>
                      <span className="text-slate-500">{serviceLabels[item.planType]} · {formatDate(item.plannedDate)}</span>
                      {item.supervisorName && <span className="w-full truncate text-xs text-slate-400">{item.supervisorName}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-slate-500">لا توجد زيارات متأخرة ضمن هذه التصفية.</p>
            )}
      </article>
    </section>
  );
}

function CoverageLine({ label, assigned, required, formatNumber }: {
  label: string;
  assigned: number;
  required: number;
  formatNumber: (value: number) => string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      <span className="text-sm text-slate-600">{formatNumber(assigned)} / {formatNumber(required)} مكلّف / مطلوب</span>
    </div>
  );
}

function DeliverableCount({ label, value, formatNumber }: {
  label: string;
  value: number;
  formatNumber: (value: number) => string;
}) {
  return <div><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold text-slate-800">{formatNumber(value)}</p></div>;
}

function ActionTile({
  to, title, value, action, icon, tone, detail,
}: {
  to: string;
  title: string;
  value: string;
  action: string;
  icon: ReactNode;
  tone: string;
  detail?: string;
}) {
  return (
    <Link to={to} className="card group block min-h-32 p-4 transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold leading-5 text-slate-500">{title}</p>
        <span className={`shrink-0 ${tone}`}>{icon}</span>
      </div>
      <p className={`mt-2 text-3xl font-extrabold ${tone}`}>{value}</p>
      {detail && <p className="mt-1 text-[11px] text-slate-500">{detail}</p>}
      <span className="mt-2 inline-flex text-xs font-bold text-brand-800 group-hover:text-brand-950">{action} ←</span>
    </Link>
  );
}

function previousMonth(month: string): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
}

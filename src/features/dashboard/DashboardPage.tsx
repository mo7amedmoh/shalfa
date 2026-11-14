import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarClock, ClipboardList, FileCheck2, UsersRound } from 'lucide-react';
import type { PlanType } from '../../domain/types';
import { formatArabicCount, type ArabicCountForms } from '../../domain/arabicCount';
import type { UserProfile } from '../../lib/auth';
import { useDisplayFormat } from '../../app/useDisplayFormat';
import { useDashboardData } from './useDashboardData';
import { SCHOOL_SIZE_LABELS, SCHOOL_SIZES } from '../../domain/staffing';

const serviceLabels: Record<PlanType, string> = {
  maintenance: 'الصيانة والتكييف',
  cleaning: 'النظافة',
  security_safety: 'الأمن والسلامة',
  elevators: 'المصاعد',
};

const serviceOrder: readonly PlanType[] = ['maintenance', 'cleaning', 'security_safety', 'elevators'];
const visitCountForms: ArabicCountForms = { one: 'زيارة', two: 'زيارتين', few: 'زيارات', many: 'زيارة' };
const workingDayCountForms: ArabicCountForms = { one: 'يوم عمل', two: 'يومي عمل', few: 'أيام عمل', many: 'يوم عمل' };
const schoolShortageCountForms: ArabicCountForms = {
  one: 'مدرسة لديها عجز في عمال النظافة',
  two: 'مدرستان لديهما عجز في عمال النظافة',
  few: 'مدارس لديها عجز في عمال النظافة',
  many: 'مدرسة لديها عجز في عمال النظافة',
};
const gatekeeperCountForms: ArabicCountForms = { one: 'بواب', two: 'بوابين', few: 'بوابين', many: 'بواب' };
const cleanerShortageCountForms: ArabicCountForms = {
  one: 'عامل نظافة',
  two: 'عاملان نظافة',
  few: 'عمال نظافة',
  many: 'عامل نظافة',
};
const overdueVisitCountForms: ArabicCountForms = {
  one: 'زيارة فات موعدها',
  two: 'زيارتان فات موعدهما',
  few: 'زيارات فات موعدها',
  many: 'زيارة فات موعدها',
};
const dueDeliverableCountForms: ArabicCountForms = {
  one: 'مخرج يستحق خلال 14 يومًا',
  two: 'مخرجان يستحقان خلال 14 يومًا',
  few: 'مخرجات تستحق خلال 14 يومًا',
  many: 'مخرج يستحق خلال 14 يومًا',
};
const visitWithoutReportCountForms: ArabicCountForms = {
  one: 'زيارة تمت دون تقرير',
  two: 'زيارتان تمت دون تقرير',
  few: 'زيارات تمت دون تقرير',
  many: 'زيارة تمت دون تقرير',
};
const overdueReportCountForms: ArabicCountForms = {
  one: 'زيارة متأخرة',
  two: 'زيارتان متأخرتان',
  few: 'زيارات متأخرة',
  many: 'زيارة متأخرة',
};

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
  const monthLabel = `${new Intl.DateTimeFormat('ar-SA', { month: 'long' }).format(new Date(`${dashboard.month}-01T00:00:00Z`))} ${formatNumber(dashboard.month.slice(0, 4))}`;
  const reportFilters = new URLSearchParams({
    month: dashboard.month,
    service: serviceType,
  });
  if (supervisorId) reportFilters.set('supervisor', supervisorId);
  const reportUrl = `/plans/report?${reportFilters.toString()}`;
  const counts = dashboard.actionCounts;
  const workforce = dashboard.workforce;
  const largestCleanerShortages = workforce
    ? [...workforce.cleanerShortageSchools]
      .sort((left, right) => right.shortage - left.shortage)
      .slice(0, 4)
    : [];
  const serviceProgress = new Map(dashboard.services.map((service) => [service.planType, service]));

  return (
    <div className="dashboard-page grid gap-5" dir="rtl">
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
      <section className={`card dashboard-glass dashboard-card-enter border-t-4 p-5 sm:p-6 ${verdictTone}`} aria-labelledby="dashboard-verdict-title">
        {dashboard.plansLoading ? <CardSkeleton /> : dashboard.plansError
          ? <CardError title="تعذر تحميل ملخص الخطة" message={dashboard.plansError.message} />
          : dashboard.verdict.status === 'no-plan' ? (
          <div>
            <p id="dashboard-verdict-title" className="text-sm font-bold text-slate-500">هل نمشي مع الخطة؟</p>
            <p className="mt-2 text-lg font-bold text-slate-800">لا توجد خطة شهرية لهذه التصفية.</p>
          </div>
        ) : (
          <div className="dashboard-content-enter flex flex-col justify-between gap-6 xl:flex-row xl:items-center">
            <div className="min-w-0">
              <p id="dashboard-verdict-title" className="text-sm font-bold text-slate-500">هل نمشي مع الخطة؟</p>
              <h3 className="mt-1 text-2xl font-extrabold text-slate-900">
                {dashboard.verdict.done >= dashboard.verdict.expected
                  ? `متقدمون بـ ${formatArabicCount(dashboard.verdict.ahead, formatNumber, visitCountForms)} عن المتوقع`
                  : `متأخرون بـ ${formatArabicCount(dashboard.verdict.behind, formatNumber, visitCountForms)} عن المتوقع`}
              </h3>
              {dashboard.verdict.done < dashboard.verdict.expected && (
                <p className="mt-2 text-sm leading-7 text-slate-600">
                  {dashboard.verdict.firstSlipDay
                    ? <>بدأ التأخر يوم <b>{formatDate(dashboard.verdict.firstSlipDay)}</b></>
                    : 'لا يوجد يوم تأخر مسجل حتى الآن'}
                  {' · '}
                  {dashboard.verdict.requiredDailyPace === null
                    ? 'لا توجد أيام عمل متبقية'
                    : <>المطلوب <b>{formatNumber(dashboard.verdict.requiredDailyPace.toFixed(1))}</b> زيارة يوميًا لإنجاز المتبقي</>}
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 xl:min-w-[520px]">
              <Metric label="المنجز حتى اليوم" value={dashboard.verdict.done} formatNumber={formatNumber} tone="text-emerald-700" />
              <Metric label="المتوقع حتى اليوم" value={dashboard.verdict.expected} formatNumber={formatNumber} tone="text-brand-900" />
              <div className="col-span-2 sm:col-span-1">
                <div className="flex justify-between gap-2 text-xs text-slate-500">
                  <span>تقدم الشهر</span>
                  <span>
                    {formatArabicCount(dashboard.verdict.elapsedWorkingDays, formatNumber, workingDayCountForms)}
                    {' من '}
                    {formatArabicCount(dashboard.verdict.totalWorkingDays, formatNumber, workingDayCountForms)}
                  </span>
                </div>
                <div
                  className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-100"
                  role="progressbar"
                  aria-label="تقدم أيام العمل في الشهر"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={dashboard.verdict.monthProgressPercent}
                >
                  <div className="dashboard-progress-fill h-full rounded-full bg-brand-800" style={{ width: `${dashboard.verdict.monthProgressPercent}%` }} />
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
        <div className="dashboard-content-enter dashboard-stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <ActionTile
            to={`${reportUrl}&action=late-visits`}
            title="زيارات فاتها موعدها"
            titleForms={overdueVisitCountForms}
            value={counts?.lateVisits}
            loading={dashboard.plansLoading}
            formatNumber={formatNumber}
            action="عرض القائمة"
            icon={<CalendarClock size={18} />}
            tone="text-rose-700"
            tooltip="لم تُنجز الزيارة حتى تاريخها المخطط."
          />
          <ActionTile
            to={`${reportUrl}&action=visit-no-report`}
            title="تمت بدون تقرير"
            titleForms={visitWithoutReportCountForms}
            value={counts?.visitedWithoutReport}
            loading={dashboard.plansLoading}
            formatNumber={formatNumber}
            action="تحديث التقارير"
            icon={<FileCheck2 size={18} />}
            tone="text-amber-700"
          />
          <ActionTile
            to="/placement/cleaners?shortage=true"
            title="عجز عمالة نظافة"
            titleForms={cleanerShortageCountForms}
            titlePrefix="العجز: "
            value={dashboard.staffingConfigured ? counts?.cleanerShortage : undefined}
            loading={dashboard.staffingConfigured && dashboard.staffingLoading}
            formatNumber={formatNumber}
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
              titleForms={dueDeliverableCountForms}
              value={counts?.deliverablesDueSoon}
              loading={dashboard.deliverablesLoading}
              formatNumber={formatNumber}
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
              value={counts?.previousKpiNotApproved}
              loading={dashboard.previousKpiLoading}
              formatNumber={formatNumber}
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
      <section aria-label="تقدم الخدمات الشهرية" className="dashboard-stagger grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {dashboard.plansLoading ? <CardSkeleton /> : dashboard.plansError
          ? <CardError title="تعذر تحميل تقدم الخدمات" message={dashboard.plansError.message} />
          : serviceOrder.filter((type) => serviceType === 'all' || type === serviceType).map((type) => {
          const progress = serviceProgress.get(type);
          if (!progress || !progress.planned) {
            return (
              <article key={type} className="card dashboard-card-enter p-4 sm:p-5">
                <h3 className="font-bold text-slate-800">{serviceLabels[type]}</h3>
                <p className="mt-4 text-sm font-semibold text-slate-500">لا توجد خطة</p>
              </article>
            );
          }
          const chip = progress.behind === 0
            ? { label: 'على المسار', tone: 'bg-emerald-100 text-emerald-800' }
            : {
              label: `أقل من المتوقع بـ ${formatArabicCount(progress.behind, formatNumber, visitCountForms)}`,
              tone: progress.status === 'far-behind' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800',
            };
          return (
            <article key={type} className="card dashboard-card-enter p-4 sm:p-5">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-bold text-slate-800">{serviceLabels[type]}</h3>
                {progress.behind > 0 ? (
                  <Link
                    to={`/plans/report?${new URLSearchParams({
                      month: dashboard.month,
                      service: type,
                      ...(supervisorId ? { supervisor: supervisorId } : {}),
                      action: 'below-expected',
                    }).toString()}`}
                    title="المنجز أقل من المتوقع حتى التاريخ المحدد."
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${chip.tone}`}
                  >{chip.label}</Link>
                ) : (
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${chip.tone}`} title="المنجز بلغ المتوقع حتى التاريخ المحدد.">{chip.label}</span>
                )}
              </div>
              <p className="mt-4 text-3xl font-extrabold text-slate-900">{formatNumber(progress.overallPercent.toFixed(1))}%</p>
              <p className="mt-1 text-xs text-slate-500">
                الزيارات: {formatNumber(progress.visited)} من {formatNumber(progress.planned)}
                {' · '}
                التقارير: {formatNumber(progress.reportsDone)} من {formatNumber(progress.planned)}
              </p>
              <div
                className="relative mt-4 h-2.5 rounded-full bg-slate-100"
                role="progressbar"
                aria-label={`نسبة إنجاز ${serviceLabels[type]}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress.overallPercent}
              >
                <div className="dashboard-progress-fill absolute inset-y-0 start-0 rounded-full bg-emerald-600" style={{ width: `${progress.overallPercent}%` }} />
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
      <section className="dashboard-stagger grid gap-4 xl:grid-cols-2" aria-label="التزام المشرفين والقوى العاملة">
        <article className="card dashboard-card-enter p-5">
          <h3 className="font-extrabold text-brand-900">التزام مشرفي الصيانة</h3>
          {dashboard.plansLoading ? <CardSkeleton /> : dashboard.plansError
            ? <CardError title="تعذر تحميل التزام المشرفين" message={dashboard.plansError.message} />
            : dashboard.compliance.length ? (
            <div className="dashboard-content-enter mt-4 grid gap-3">
              {dashboard.compliance.map((supervisor) => {
                const band = supervisor.percent >= 70
                  ? 'bg-emerald-500'
                  : supervisor.percent >= 40 ? 'bg-amber-500' : 'bg-rose-500';
                return (
                  <div key={supervisor.id}>
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="font-semibold text-slate-700">{supervisor.name}</span>
                      <span className="shrink-0 text-slate-500">
                        {formatNumber(supervisor.completedOnTime)} من {formatNumber(supervisor.planned)}
                        {' · '}
                        {formatNumber(supervisor.percent.toFixed(0))}%
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
                      <div className={`dashboard-progress-fill h-full rounded-full ${band}`} style={{ width: `${supervisor.percent}%` }} />
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

        <article className="card dashboard-glass dashboard-card-enter dashboard-workforce-card p-5">
          <h3 className="font-extrabold text-brand-900">تغطية القوى العاملة</h3>
          {dashboard.staffingLoading ? <CardSkeleton /> : dashboard.staffingError
            ? <CardError title="تعذر تحميل تغطية القوى العاملة" message={dashboard.staffingError.message} />
            : !dashboard.staffingConfigured ? (
            <p className="mt-4 text-sm text-slate-500">إعدادات احتياج القوى العاملة غير متاحة.</p>
          ) : workforce ? (
            <div className="dashboard-content-enter mt-4 grid gap-1">
              <WorkforceProgressLine label="البوابون" assigned={workforce.gatekeepers.assigned}
                required={workforce.gatekeepers.required} formatNumber={formatNumber}
                tone={workforce.gatekeepers.assigned >= workforce.gatekeepers.required ? 'emerald' : 'amber'} />
              <WorkforceProgressLine label="عمال النظافة" assigned={workforce.cleaners.assigned}
                required={workforce.cleaners.required} formatNumber={formatNumber}
                tone={workforce.cleaners.assigned >= workforce.cleaners.required ? 'emerald' : 'amber'} />
              <WorkforceProgressLine label="الإجمالي المطلوب" assigned={workforce.total.assigned}
                required={workforce.total.required} formatNumber={formatNumber} tone="brand" />
              <p className="mt-1 text-xs text-slate-500">
                <Link to="/placement/cleaners?shortage=true" className="font-semibold text-brand-800 underline">
                  {formatArabicCount(workforce.cleaners.shortageSchools, formatNumber, schoolShortageCountForms)}
                </Link>
                {' · '}
                {workforce.gatekeepers.shortage > 0
                  ? `عجز ${formatArabicCount(workforce.gatekeepers.shortage, formatNumber, gatekeeperCountForms)}`
                  : 'لا عجز في البوابين'}
              </p>
              <p className={`text-xs font-bold ${workforce.total.netBalance < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                {workforce.total.netBalance < 0
                  ? `عجز صافي ${formatNumber(Math.abs(workforce.total.netBalance))}`
                  : workforce.total.netBalance > 0
                    ? `فائض صافي ${formatNumber(workforce.total.netBalance)}`
                    : 'التغطية مكتملة'}
              </p>
              <div className="mt-2 table-scroll">
                <table className="w-full text-xs">
                  <thead><tr className="text-slate-500"><th className="py-1 text-start">حجم المدرسة</th><th className="py-1 text-start">مطلوب</th><th className="py-1 text-start">مسند</th></tr></thead>
                  <tbody>
                    {SCHOOL_SIZES.map((size) => (
                      <tr key={size} className="border-t border-slate-100">
                        <th scope="row" className="py-1 text-start font-semibold text-slate-700">{SCHOOL_SIZE_LABELS[size]}</th>
                        <td className="py-1">{formatNumber(workforce.cleaners.bySize[size].required)}</td>
                        <td className="py-1">{formatNumber(workforce.cleaners.bySize[size].assigned)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-amber-800">
                <Link to="/schools?sizeDiff=true" className="font-semibold underline">
                  {formatNumber(workforce.sizeMismatchSchools.length)} مدرسة يختلف مؤشر حجمها عن عدد الفصول
                </Link>
              </p>
              <section className="mt-2 grid gap-2" aria-label="المدارس التي لديها عجز في عمال النظافة">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-xs font-bold text-slate-700">أكثر المدارس عجزًا</h4>
                  {workforce.cleanerShortageSchools.length > 0 && (
                    <Link to="/placement/cleaners?shortage=true" className="shrink-0 text-xs font-semibold text-brand-800 underline">
                      عرض الكل ({formatNumber(workforce.cleanerShortageSchools.length)})
                    </Link>
                  )}
                </div>
                {workforce.cleanerShortageSchools.length ? (
                  <ul className="grid gap-1 text-xs">
                    {largestCleanerShortages.map((school) => (
                      <li key={school.id} className="flex min-w-0 items-center justify-between gap-2 border-b border-slate-100 py-1">
                        <Link
                          to="/placement/cleaners?shortage=true"
                          className="min-w-0 truncate font-medium text-brand-800 hover:underline"
                          title={school.name}
                        >
                          {school.name}
                        </Link>
                        <span className="shrink-0 font-bold text-rose-700">عجز {formatNumber(school.shortage)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-xs text-slate-500">لا توجد مدارس لديها عجز.</p>
                )}
              </section>
              {workforce.missingClassCountSchools.length > 0 && (
                <p className="mt-2 text-xs leading-5 text-amber-800">
                  لا يمكن حساب احتياج عمال النظافة لغياب عدد الفصول:
                  {' '}
                  {workforce.missingClassCountSchools.map((school) => school.name).join('، ')}
                </p>
              )}
              <p className="dashboard-workforce-note text-xs text-slate-500">
                الحالة الحالية للمدارس المؤهلة؛ لا تتغير بفلاتر الخدمة أو المشرف.
              </p>
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-500">لا توجد بيانات تغطية.</p>
          )}
        </article>
        {dashboard.access.rewardsShortcut && (
          <Link to={`/rewards?month=${encodeURIComponent(dashboard.month)}`} className="card dashboard-card-enter flex min-h-32 items-center justify-between gap-4 p-5 transition-transform hover:border-brand-300">
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
        <section
          className={`dashboard-stagger grid gap-4 lg:grid-cols-2 ${dashboard.access.activity ? 'xl:grid-cols-3' : ''}`}
          aria-label="مؤشرات الأداء والمخرجات"
        >
          <article className="card dashboard-glass dashboard-card-enter dashboard-scorecard-card p-5">
            <h3 className="font-extrabold text-brand-900">بطاقة أداء الشهر المحدد</h3>
            {dashboard.kpiLoading ? <CardSkeleton /> : dashboard.kpiError
              ? <CardError title="تعذر تحميل بطاقة الأداء" message={dashboard.kpiError.message} />
              : dashboard.latestKpi ? (
              <div className="dashboard-content-enter">
                <p className="mt-2 text-sm text-slate-500">
                  {dashboard.latestKpi.month.slice(0, 7) === dashboard.month
                    ? dashboard.month
                    : `آخر بطاقة: ${formatNumber(dashboard.latestKpi.month.slice(0, 7))}`}
                  {dashboard.latestKpi.contractMonth !== null && ` · الشهر التعاقدي ${formatNumber(dashboard.latestKpi.contractMonth)}`}
                </p>
                <div className="dashboard-scorecard-summary mt-4">
                  <ScoreRing value={dashboard.latestKpi.scorePercent} formatNumber={formatNumber} />
                  <div className="grid gap-2">
                    <span className={`dashboard-rating-chip ${dashboard.latestKpi.rating ?? 'unavailable'}`}>
                      {dashboard.latestKpi.rating === 'excellent'
                        ? 'تقييم: ممتاز'
                        : dashboard.latestKpi.rating === 'average'
                          ? 'تقييم: متوسط'
                          : dashboard.latestKpi.rating === 'weak' ? 'تقييم: يحتاج إلى تحسين' : 'التقييم غير متاح'}
                    </span>
                    <p className="text-xs text-slate-500">
                      المستحق من الفاتورة: <b className="text-slate-700">
                        {dashboard.latestKpi.payablePercent === null
                          ? '—'
                          : `${formatNumber(dashboard.latestKpi.payablePercent.toFixed(0))}%`}
                      </b>
                    </p>
                    <p className="text-xs text-slate-500">
                      {dashboard.latestKpi.payablePercent === null
                        ? 'الخصم: غير متاح'
                        : <>
                            {dashboard.latestKpi.contractMonth !== null
                              && `الشهر التعاقدي ${formatNumber(dashboard.latestKpi.contractMonth)} `}
                            (خصم {formatNumber((100 - dashboard.latestKpi.payablePercent).toFixed(0))}%)
                          </>}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-500">لا توجد بطاقة أداء مسجلة.</p>
            )}
          </article>

          <article className="card dashboard-card-enter p-5">
            <h3 className="font-extrabold text-brand-900">المخرجات التعاقدية</h3>
            <p className="mt-1 text-xs text-slate-500">إجمالي المخرجات التعاقدية؛ يحسب التأخر حتى تاريخ التصفية المحدد.</p>
            {dashboard.deliverablesLoading ? <CardSkeleton /> : dashboard.deliverablesError
              ? <CardError title="تعذر تحميل المخرجات" message={dashboard.deliverablesError.message} />
              : dashboard.deliverableSummary ? (
              <div className="dashboard-content-enter">
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <DeliverableCount
                    label="معتمد"
                    value={dashboard.deliverableSummary.approved}
                    formatNumber={formatNumber}
                  />
                  <DeliverableCount
                    label="بانتظار الاعتماد"
                    value={dashboard.deliverableSummary.delivered - dashboard.deliverableSummary.approved}
                    formatNumber={formatNumber}
                  />
                  <DeliverableCount
                    label="غير مسلّم"
                    value={dashboard.deliverableSummary.total - dashboard.deliverableSummary.delivered}
                    formatNumber={formatNumber}
                  />
                  <DeliverableCount
                    label="متأخر"
                    value={dashboard.deliverableSummary.late}
                    formatNumber={formatNumber}
                  />
                </div>
                <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-slate-100" role="progressbar"
                  aria-label="نسبة المخرجات المسلّمة" aria-valuemin={0} aria-valuemax={100}
                  aria-valuenow={dashboard.deliverableSummary.progressPercent}>
                  <div className="dashboard-progress-fill h-full rounded-full bg-emerald-600" style={{ width: `${dashboard.deliverableSummary.progressPercent}%` }} />
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  المخرجات المسلّمة: {formatNumber(dashboard.deliverableSummary.delivered)} من {formatNumber(dashboard.deliverableSummary.total)}
                </p>
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-500">جارٍ تحميل ملخص المخرجات…</p>
            )}
          </article>

          {dashboard.access.activity && (
            <article className="card dashboard-card-enter p-5 lg:col-span-2 xl:col-span-1">
              <h3 className="font-extrabold text-brand-900">آخر النشاطات خلال الشهر المحدد</h3>
              <p className="mt-1 text-xs text-slate-500">سجل التدقيق لا يصنف الأحداث حسب الخدمة أو المشرف.</p>
              {dashboard.activityLoading ? <CardSkeleton /> : dashboard.activityError
                ? <CardError title="تعذر تحميل النشاطات" message={dashboard.activityError.message} />
                : dashboard.recentActivity.length ? (
                <ol className="dashboard-content-enter mt-3 grid gap-2">
                  {dashboard.recentActivity.map((event) => (
                    <li key={event.id} className="flex flex-col justify-between gap-1 border-b border-slate-100 pb-2 text-xs sm:flex-row sm:items-center sm:gap-3">
                      <span className="min-w-0 truncate font-medium text-slate-700 sm:flex-1" title={event.message}>{event.message}</span>
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

function Metric({
  label, value, tone, formatNumber, decimals = 0, suffix = '',
}: {
  label: string;
  value: number | undefined;
  tone: string;
  formatNumber: (value: number) => string;
  decimals?: number;
  suffix?: string;
}) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-3xl font-extrabold ${tone}`}>
        {value === undefined
          ? '—'
          : <AnimatedNumber value={value} formatNumber={formatNumber} decimals={decimals} suffix={suffix} />}
      </p>
    </div>
  );
}

function AnimatedNumber({
  value, formatNumber, decimals = 0, suffix = '',
}: {
  value: number;
  formatNumber: (value: number) => string;
  decimals?: number;
  suffix?: string;
}) {
  const [displayValue, setDisplayValue] = useState(value);

  useEffect(() => {
    let frame = 0;
    let startTime: number | undefined;
    const duration = 700;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const finish = () => setDisplayValue(value);
    const onBeforePrint = () => {
      window.cancelAnimationFrame(frame);
      finish();
    };

    window.addEventListener('beforeprint', onBeforePrint);
    if (reducedMotion || window.matchMedia('print').matches) {
      finish();
    } else {
      setDisplayValue(0);
      const animate = (now: number) => {
        startTime ??= now;
        const progress = Math.min((now - startTime) / duration, 1);
        const eased = 1 - ((1 - progress) ** 3);
        setDisplayValue(value * eased);
        if (progress < 1) frame = window.requestAnimationFrame(animate);
      };
      frame = window.requestAnimationFrame(animate);
    }

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('beforeprint', onBeforePrint);
    };
  }, [value]);

  return <>{formatNumber(Number(displayValue.toFixed(decimals)))}{suffix}</>;
}

function CardSkeleton() {
  return (
    <div role="status" aria-label="جارٍ التحميل" className="dashboard-skeleton grid gap-3 py-2">
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
    <section className="dashboard-stagger grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <Link to={bulkUpdateUrl} className="card dashboard-glass dashboard-card-enter flex min-h-40 flex-col justify-between gap-5 p-5 transition-transform hover:border-brand-300">
        <div>
          <h3 className="font-extrabold text-brand-900">التحديث الجماعي للخطة</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">افتح خطة الشهر والخدمة المحددين للوصول إلى أداة التحديث الجماعي.</p>
        </div>
        <span className="text-sm font-bold text-brand-800">فتح أداة التحديث ←</span>
      </Link>
      <article className="card dashboard-glass dashboard-card-enter min-w-0 p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-extrabold text-brand-900">
            {loading || error
              ? 'زيارات متأخرة'
              : formatArabicCount(lateCount, formatNumber, overdueReportCountForms)}
          </h3>
        </div>
        {loading ? <CardSkeleton />
          : error ? <CardError title="تعذر تحميل الزيارات المتأخرة" message={error.message} />
            : lateItems.length ? (
              <ul className="dashboard-content-enter mt-4 grid gap-2">
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
              <p className="dashboard-content-enter mt-4 text-sm text-slate-500">لا توجد زيارات متأخرة ضمن هذه التصفية.</p>
            )}
      </article>
    </section>
  );
}

function WorkforceProgressLine({ label, assigned, required, formatNumber, tone }: {
  label: string;
  assigned: number;
  required: number;
  formatNumber: (value: number) => string;
  tone: 'emerald' | 'amber' | 'brand';
}) {
  const percent = required > 0 ? Math.min(100, Math.max(0, (assigned / required) * 100)) : 100;
  return (
    <div className="dashboard-workforce-row">
      <div className="flex items-center justify-between gap-3 text-sm font-semibold text-slate-700">
        <span>{label}</span>
        <span className="shrink-0 text-slate-500">مسند {formatNumber(assigned)} · مطلوب {formatNumber(required)}</span>
      </div>
      <div className="dashboard-workforce-track" role="progressbar" aria-label={label}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
        aria-valuetext={`مسند ${formatNumber(assigned)} من مطلوب ${formatNumber(required)}`}>
        <div className={`dashboard-progress-fill ${tone}`} style={{ width: `${percent}%` }} />
        {required > 0 && <span className="dashboard-workforce-required-marker" title={`مستوى المطلوب: ${formatNumber(required)}`} />}
      </div>
    </div>
  );
}

function ScoreRing({ value, formatNumber }: {
  value: number | null;
  formatNumber: (value: number) => string;
}) {
  const normalized = value === null ? 0 : Math.min(100, Math.max(0, value));
  const circumference = 2 * Math.PI * 44;
  const stroke = value === null ? '#cbd5e1' : value >= 95 ? '#17825a' : value >= 85 ? '#d79527' : '#c0392b';
  return (
    <div className="dashboard-score-ring" role="img"
      aria-label={value === null ? 'نتيجة الأداء غير متاحة' : `نتيجة الأداء ${formatNumber(Number(value.toFixed(1)))}%`}>
      <svg className="dashboard-score-ring-svg" viewBox="0 0 110 110" aria-hidden="true">
        <circle cx="55" cy="55" r="44" fill="none" stroke="#e8ecf5" strokeWidth="12" />
        <circle cx="55" cy="55" r="44" fill="none" stroke={stroke} strokeWidth="12"
          strokeDasharray={`${circumference * normalized / 100} ${circumference}`}
          transform="rotate(-90 55 55)" strokeLinecap="round" />
      </svg>
      <span aria-hidden="true">
        {value === null
          ? '—'
          : <AnimatedNumber value={value} formatNumber={formatNumber} decimals={1} suffix="%" />}
      </span>
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
  to, title, titleForms, titlePrefix, value, loading = false, formatNumber, action, icon, tone, detail, tooltip,
}: {
  to: string;
  title: string;
  titleForms?: ArabicCountForms;
  titlePrefix?: string;
  value: number | undefined;
  loading?: boolean;
  formatNumber: (value: number) => string;
  action: string;
  icon: ReactNode;
  tone: string;
  detail?: string;
  tooltip?: string;
}) {
  return (
    <Link to={to} title={tooltip} className="card dashboard-glass dashboard-card-enter group block min-h-32 p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold leading-5 text-slate-500">
          {titleForms && value !== undefined
            ? `${titlePrefix ?? ''}${formatArabicCount(value, formatNumber, titleForms)}`
            : title}
        </p>
        <span className={`shrink-0 ${tone}`}>{icon}</span>
      </div>
      <p className={`mt-2 text-3xl font-extrabold ${tone}`}>
        {value === undefined
          ? loading ? '…' : '—'
          : <AnimatedNumber value={value} formatNumber={formatNumber} />}
      </p>
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

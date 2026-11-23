import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarClock, ClipboardList, FileCheck2, UsersRound } from 'lucide-react';
import type { PlanType } from '../../domain/types';
import { formatArabicCount, type ArabicCountForms } from '../../domain/arabicCount';
import type { UserProfile } from '../../lib/auth';
import { useDisplayFormat } from '../../app/useDisplayFormat';
import { usePermission } from '../../app/permissionContext';
import { InventoryShortageCard } from '../inventory/InventoryShortageCard';
import { useDashboardData } from './useDashboardData';

const serviceLabels: Record<PlanType, string> = {
  maintenance: 'الصيانة والتكييف',
  cleaning: 'النظافة',
  security_safety: 'الأمن والسلامة',
  elevators: 'المصاعد',
};

const serviceOrder: readonly PlanType[] = ['maintenance', 'cleaning', 'security_safety', 'elevators'];
const visitCountForms: ArabicCountForms = { one: 'زيارة', two: 'زيارتين', few: 'زيارات', many: 'زيارة' };
const schoolCountForms: ArabicCountForms = { one: 'مدرسة', two: 'مدرستين', few: 'مدارس', many: 'مدرسة' };
const workingDayCountForms: ArabicCountForms = { one: 'يوم عمل', two: 'يومي عمل', few: 'أيام عمل', many: 'يوم عمل' };
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

function monthOptions(selectedMonth: string): Array<{ value: string; label: string }> {
  const currentYear = new Date().getFullYear();
  const months = Array.from({ length: 12 }, (_, index) =>
    `${currentYear}-${String(index + 1).padStart(2, '0')}`,
  );
  if (!months.includes(selectedMonth)) months.push(selectedMonth);
  return months.sort().map((value) => ({
    value,
    label: `${new Intl.DateTimeFormat('ar-SA-u-ca-gregory', { month: 'long', timeZone: 'UTC' }).format(new Date(`${value}-01T00:00:00Z`))} ${value.slice(0, 4)}`,
  }));
}

function validService(value: string | null): PlanType | 'all' {
  return value === 'maintenance' || value === 'cleaning' || value === 'security_safety' || value === 'elevators'
    ? value
    : 'all';
}

function formatSyncDateTime(value: string): string {
  return `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)} ${value.slice(11, 16)}`;
}

export function DashboardPage({ profile = null }: { profile?: UserProfile | null }) {
  const { formatDate, formatDateTime, formatNumber } = useDisplayFormat();
  const canViewAudit = usePermission('audit.view');
  const [searchParams, setSearchParams] = useSearchParams();
  const [filtersOpen, setFiltersOpen] = useState(() => window.matchMedia('(min-width: 640px)').matches);
  const month = validMonth(searchParams.get('month'));
  const supervisorId = searchParams.get('supervisor') ?? '';
  const serviceType = validService(searchParams.get('service'));
  const dashboard = useDashboardData(profile, { month, supervisorId, serviceType });
  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 640px)');
    const syncFiltersToViewport = (event: MediaQueryListEvent) => setFiltersOpen(event.matches);
    mediaQuery.addEventListener('change', syncFiltersToViewport);
    return () => mediaQuery.removeEventListener('change', syncFiltersToViewport);
  }, []);
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
  const plannedServices = dashboard.services.filter((service) => service.planned > 0);
  const lateServices = plannedServices.filter((service) => service.status !== 'on-track');
  const allServicesOnTrack = plannedServices.length > 0 && lateServices.length === 0;
  const onTrackServiceCount = plannedServices.length - lateServices.length;
  const serviceCount = (count: number) => count === 0
    ? 'لا توجد خدمات'
    : count === 1 ? 'خدمة واحدة' : count === 2 ? 'خدمتان' : `${formatNumber(count)} خدمات`;
  const lateServiceCount = (count: number) => count === 1
    ? 'خدمة واحدة متأخرة'
    : count === 2 ? 'خدمتان متأخرتان' : `${formatNumber(count)} خدمات متأخرة`;
  const expectedServiceCount = (service: (typeof plannedServices)[number]) =>
    Math.round(service.planned * service.expectedPercent / 100);
  const lateVisitDeficit = lateServices
    .reduce(
      (total, service) => total + Math.max(0, expectedServiceCount(service) - service.visited),
      0,
    );
  const lateReportDeficit = lateServices.reduce(
    (total, service) => total + Math.max(0, expectedServiceCount(service) - service.reportsDone),
    0,
  );
  const totalVisitDifference = dashboard.verdict.done - dashboard.verdict.expected;
  const totalVisitSummary = totalVisitDifference > 0
    ? `الإجمالي متقدم بـ ${formatNumber(dashboard.verdict.ahead)} زيارة عن المستهدف`
    : totalVisitDifference < 0
      ? `الإجمالي متأخر بـ ${formatNumber(dashboard.verdict.behind)} زيارة عن المستهدف`
      : 'الإجمالي على المستهدف دون فرق';
  const verdictTone = allServicesOnTrack
    ? 'border-emerald-500'
    : lateServices.some((service) => service.status === 'far-behind')
      ? 'border-rose-600'
      : lateServices.length
        ? 'border-amber-500'
        : dashboard.verdict.status === 'no-plan'
          ? 'border-slate-300'
          : dashboard.verdict.status === 'far-behind'
            ? 'border-rose-600'
            : 'border-amber-500';
  const monthLabel = `${new Intl.DateTimeFormat('ar-SA-u-ca-gregory', { month: 'long', timeZone: 'UTC' }).format(new Date(`${dashboard.month}-01T00:00:00Z`))} ${formatNumber(dashboard.month.slice(0, 4))}`;
  const reportFilters = new URLSearchParams({
    month: dashboard.month,
    service: serviceType,
  });
  if (supervisorId) reportFilters.set('supervisor', supervisorId);
  const reportUrl = `/plans/report?${reportFilters.toString()}`;
  const counts = dashboard.actionCounts;
  const mobileActionValues = [
    counts?.lateVisits,
    counts?.visitedWithoutReport,
    dashboard.staffingConfigured ? counts?.cleanerShortage : undefined,
    dashboard.access.deliverables ? counts?.deliverablesDueSoon : undefined,
    dashboard.access.kpi ? counts?.previousKpiNotApproved : undefined,
  ].filter((value): value is number => value !== undefined);
  const allMobileActionsClear = mobileActionValues.length > 0
    && mobileActionValues.every((value) => value === 0);
  const workforce = dashboard.workforce;
  const largestCleanerShortages = workforce
    ? [...workforce.cleanerShortageSchools]
      .sort((left, right) => right.shortage - left.shortage)
      .slice(0, 6)
    : [];
  const serviceProgress = new Map(dashboard.services.map((service) => [service.planType, service]));
  const monthlyVisitPercent = dashboard.verdict.planned
    ? Math.min(100, dashboard.verdict.done / dashboard.verdict.planned * 100)
    : 0;
  const availableMonths = monthOptions(dashboard.month);
  const renderComplianceRow = (supervisor: (typeof dashboard.compliance)[number]) => {
    const band = supervisor.percent >= 80
      ? 'bg-emerald-500'
      : supervisor.percent >= 60 ? 'bg-amber-500' : 'bg-rose-500';
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
  };
  const renderActivityRow = (event: (typeof dashboard.recentActivity)[number]) => (
    <li key={event.id} className="flex flex-col justify-between gap-1 border-b border-slate-100 pb-2 text-xs sm:flex-row sm:items-center sm:gap-3">
      <span className="min-w-0 break-words font-medium text-slate-700 sm:flex-1">{event.message}</span>
      <time className="shrink-0 text-xs text-slate-400" dateTime={event.at}><bdi dir="ltr">{formatDateTime(event.at)}</bdi></time>
    </li>
  );

  return (
    <div className="dashboard-page grid gap-5" dir="rtl">
      <section className="dashboard-top flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-2xl font-extrabold text-brand-900">{monthLabel}</h2>
          <p className="dashboard-top-meta mt-1 text-sm text-slate-500">
            حتى يوم {formatDate(dashboard.asOf)}
            {dashboard.access.syncTime && (
              <>
                <span className="mx-2 text-slate-300">·</span>
                آخر مزامنة للمدارس: {dashboard.syncTimeError
                  ? 'تعذر التحميل'
                  : dashboard.syncTimeLoading
                    ? 'جارٍ التحميل…'
                  : dashboard.lastSchoolSyncAt
                    ? formatSyncDateTime(dashboard.lastSchoolSyncAt)
                    : 'غير متاح'}
              </>
            )}
          </p>
        </div>
      </section>

      <InventoryShortageCard />

      <section className="dashboard-filterbar card">
        <div className="dashboard-filter-disclosure">
          <div className="dashboard-filter-heading">
            <button
              type="button"
              className="dashboard-filter-toggle"
              aria-expanded={filtersOpen}
              aria-controls="dashboard-extra-filters"
              onClick={() => setFiltersOpen((open) => !open)}
            >
              <span>الفلاتر</span>
              <span className="dashboard-filter-chevron" aria-hidden="true">{filtersOpen ? '−' : '+'}</span>
            </button>
            <label className="dashboard-filter-month text-xs font-semibold text-slate-500">
              <span>الشهر</span>
              <select
                aria-label="تصفية حسب الشهر"
                value={dashboard.month}
                onChange={(event) => updateFilter('month', event.target.value, currentMonth())}
                className="dashboard-filter"
              >
                {availableMonths.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </div>
          {filtersOpen && (
          <div id="dashboard-extra-filters" className="dashboard-filter-fields">
            <label className="grid min-w-0 gap-1 text-xs font-semibold text-slate-500">
              المشرف
              <select
                aria-label="تصفية حسب المشرف"
                value={supervisorId}
                onChange={(event) => updateFilter('supervisor', event.target.value, '')}
                className="dashboard-filter"
              >
                <option value="">كل المشرفين</option>
                {dashboard.supervisors.map((supervisor) => (
                  <option key={supervisor.id} value={supervisor.id}>{supervisor.name}</option>
                ))}
              </select>
            </label>
            <label className="grid min-w-0 gap-1 text-xs font-semibold text-slate-500">
              الخدمة
              <select
                aria-label="تصفية حسب الخدمة"
                value={serviceType}
                onChange={(event) => updateFilter('service', event.target.value, 'all')}
                className="dashboard-filter"
              >
                <option value="all">كل الخدمات</option>
                {serviceOrder.map((type) => <option key={type} value={type}>{serviceLabels[type]}</option>)}
              </select>
            </label>
            <button type="button" onClick={resetFilters} className="dashboard-filter-reset">
              إعادة ضبط الفلاتر
            </button>
          </div>
          )}
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
      <section className={`dashboard-hero card dashboard-card-enter ${verdictTone}`} aria-label="ملخص أداء الخطة">
        {dashboard.plansLoading ? <CardSkeleton /> : dashboard.plansError
          ? <CardError title="تعذر تحميل ملخص الخطة" message={dashboard.plansError.message} />
          : dashboard.verdict.status === 'no-plan' ? (
          <div className="dashboard-hero-empty">
            <span className="dashboard-status-pill neutral">لا توجد خطة</span>
            <h2>لا توجد خطة شهرية لهذه التصفية.</h2>
          </div>
        ) : (
          <>
            <div className="dashboard-hero-main">
              <div className="dashboard-hero-copy">
                <span className={`dashboard-status-pill ${allServicesOnTrack ? 'good' : lateServices.some((service) => service.status === 'far-behind') ? 'critical' : 'warning'}`}>
                  {allServicesOnTrack ? 'على المسار' : 'تحتاج متابعة'}
                </span>
                <h2>
                  {allServicesOnTrack
                    ? 'متقدمون على الخطة'
                    : `${serviceCount(onTrackServiceCount)} على المسار · ${lateServiceCount(lateServices.length)}`}
                </h2>
                {lateServices.length > 0 && (
                  <>
                    <p className="dashboard-hero-reason">
                      متأخر: {formatNumber(lateVisitDeficit)} زيارة · {formatNumber(lateReportDeficit)} تقرير
                    </p>
                    <p className="dashboard-hero-total">{totalVisitSummary}</p>
                    <p>الخدمات المتأخرة: {lateServices.map((service) => serviceLabels[service.planType]).join('، ')}</p>
                  </>
                )}
                <p>تم تنفيذ {formatNumber(dashboard.verdict.done)} من أصل {formatNumber(dashboard.verdict.planned)} زيارة مخططة حتى اليوم.</p>
                {dashboard.verdict.done < dashboard.verdict.expected && (
                  <p className="dashboard-hero-note">
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
              <div
                className="dashboard-gauge"
                role="progressbar"
                aria-label="نسبة الزيارات المنجزة من الخطة الشهرية"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={monthlyVisitPercent}
                style={{
                  background: `conic-gradient(#13865e 0 ${monthlyVisitPercent}%, #e8edf2 ${monthlyVisitPercent}% 100%)`,
                }}
              >
                <span>
                  {formatNumber(monthlyVisitPercent.toFixed(1))}%
                </span>
              </div>
            </div>
            <div className="dashboard-hero-stats">
              <Metric label="المنجز حتى اليوم" value={dashboard.verdict.done} formatNumber={formatNumber} tone="text-emerald-700" />
              <Metric label="المتوقع حتى اليوم" value={dashboard.verdict.expected} formatNumber={formatNumber} tone="text-brand-900" />
              <p className="dashboard-mini-note">
                الفارق عن المستهدف:{' '}
                <b className={dashboard.verdict.done >= dashboard.verdict.expected ? 'text-emerald-700' : 'text-rose-700'}>
                  {dashboard.verdict.done > dashboard.verdict.expected ? '+' : dashboard.verdict.done < dashboard.verdict.expected ? '−' : ''}
                  {formatArabicCount(dashboard.verdict.done > dashboard.verdict.expected
                    ? dashboard.verdict.ahead
                    : dashboard.verdict.behind, formatNumber, visitCountForms)}
                </b>
                {' · '}
                {formatArabicCount(dashboard.verdict.elapsedWorkingDays, formatNumber, workingDayCountForms)}
                {' من '}
                {formatArabicCount(dashboard.verdict.totalWorkingDays, formatNumber, workingDayCountForms)}
              </p>
            </div>
          </>
        )}
      </section>
      )}

      {dashboard.access.actions && (
      <section className="dashboard-section" aria-labelledby="dashboard-actions-title">
        <div className="dashboard-section-head">
          <h2 id="dashboard-actions-title">متابعة اليوم</h2>
          <p>الإجراءات التي تحتاج انتباهك</p>
        </div>
        {dashboard.plansLoading ? <CardSkeleton /> : dashboard.plansError
          ? <CardError title="تعذر تحميل الإجراءات المرتبطة بالخطط" message={dashboard.plansError.message} />
          : (
        <div className={`dashboard-content-enter dashboard-stagger dashboard-issues${allMobileActionsClear ? ' dashboard-issues-all-clear' : ''}`}>
          {allMobileActionsClear && (
            <p className="dashboard-mobile-clear" aria-live="polite">لا شيء يحتاج انتباهًا ✓</p>
          )}
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
      <section className="dashboard-section" aria-labelledby="dashboard-services-title">
        <div className="dashboard-section-head">
          <h2 id="dashboard-services-title">أداء الخدمات</h2>
          <p>المنجز مقارنة بمستهدف الشهر</p>
        </div>
        <div className="dashboard-stagger dashboard-service-grid">
        {dashboard.plansLoading ? <CardSkeleton /> : dashboard.plansError
          ? <CardError title="تعذر تحميل تقدم الخدمات" message={dashboard.plansError.message} />
          : serviceOrder.filter((type) => serviceType === 'all' || type === serviceType).map((type) => {
          const progress = serviceProgress.get(type);
          if (!progress || !progress.planned) {
            return (
              <article key={type} className="card dashboard-card-enter dashboard-service-card">
                <h3 className="font-bold text-slate-800">{serviceLabels[type]}</h3>
                <p className="mt-4 text-sm font-semibold text-slate-500">لا توجد خطة</p>
              </article>
            );
          }
          const lateReason = progress.visitStatus !== 'on-track' && progress.reportStatus !== 'on-track'
            ? 'الزيارات والتقارير'
            : progress.visitStatus !== 'on-track' ? 'الزيارات' : 'التقارير';
          const chip = progress.status === 'on-track'
            ? { label: 'على المسار', reason: '', tone: 'good' }
            : {
              label: 'متأخر',
              reason: lateReason,
              tone: progress.status === 'far-behind' ? 'critical' : 'warning',
            };
          const pillContent = (
            <>
              <span className="dashboard-service-pill-status">{chip.label}</span>
              {chip.reason && <span className="dashboard-service-pill-reason">{chip.reason}</span>}
            </>
          );
          const metrics = progress.visited === progress.reportsDone
            ? [{ label: 'الزيارات والتقارير', actual: progress.visited }]
            : [
              { label: 'الزيارات', actual: progress.visited },
              { label: 'التقارير', actual: progress.reportsDone },
            ];
          return (
            <article key={type} className="card dashboard-card-enter dashboard-service-card">
              <div className="dashboard-service-top">
                <h3>{serviceLabels[type]}</h3>
                {progress.visitStatus !== 'on-track' && progress.behind > 0 ? (
                  <Link
                    to={`/plans/report?${new URLSearchParams({
                      month: dashboard.month,
                      service: type,
                      ...(supervisorId ? { supervisor: supervisorId } : {}),
                      action: 'below-expected',
                    }).toString()}`}
                    title={chip.reason ? `متأخر · ${chip.reason}` : chip.label}
                    className={`dashboard-service-pill ${chip.tone}`}
                  >{pillContent}</Link>
                ) : (
                  <span className={`dashboard-service-pill ${chip.tone}`}>{pillContent}</span>
                )}
              </div>
              {metrics.map(({ label, actual }) => {
                const percent = progress.planned ? actual / progress.planned * 100 : 0;
                return (
                  <div key={label} className="dashboard-service-metric">
                    <div className="dashboard-service-data" dir="rtl">
                      <b>{label}</b>
                      <span className="dashboard-service-values">
                        <span>الفعلي <bdi dir="ltr">{formatNumber(percent.toFixed(1))}%</bdi></span>
                        <span>المستهدف <bdi dir="ltr">{formatNumber(progress.expectedPercent.toFixed(1))}%</bdi></span>
                      </span>
                    </div>
                    <div
                      className="dashboard-service-track"
                      role="progressbar"
                      aria-label={`نسبة ${label} المنجزة من خطة ${serviceLabels[type]}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.min(100, percent)}
                    >
                      <span className="dashboard-progress-fill" style={{ width: `${Math.min(100, percent)}%` }} />
                      <span
                        className="dashboard-service-target"
                        style={{ insetInlineStart: `${progress.expectedPercent}%` }}
                        title={`مستهدف ${label}: ${formatNumber(progress.expectedPercent.toFixed(1))}%`}
                      />
                    </div>
                    <div className="dashboard-service-counts">
                      <bdi dir="ltr">{formatNumber(actual)} / {formatNumber(progress.planned)}</bdi>
                    </div>
                  </div>
                );
              })}
            </article>
          );
        })}
        </div>
      </section>
      )}

      {dashboard.access.workforce && !dashboard.access.reportFollowerView && (
      <section className="dashboard-operations dashboard-stagger items-stretch" aria-label="الأداء التشغيلي">
        <article className="card dashboard-card-enter dashboard-panel dashboard-supervisor-panel">
          <div className="dashboard-panel-head">
            <div>
              <h2>التزام مشرفي الصيانة</h2>
              <p>الأعلى إنجازًا حتى اليوم</p>
            </div>
          </div>
          <div className="dashboard-panel-content">
            {dashboard.plansLoading ? <CardSkeleton /> : dashboard.plansError
              ? <CardError title="تعذر تحميل التزام المشرفين" message={dashboard.plansError.message} />
              : dashboard.compliance.length ? (
              <div className="dashboard-people">
                {dashboard.compliance.slice(0, 7).map(renderComplianceRow)}
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-500">لا توجد زيارات صيانة مستحقة حتى اليوم.</p>
            )}
          </div>
          <Link
            to={`/plans/report?${new URLSearchParams({ month: dashboard.month, service: 'maintenance', ...(supervisorId ? { supervisor: supervisorId } : {}) }).toString()}`}
            className="dashboard-panel-link mt-auto pt-3"
          >
            عرض الجميع ←
          </Link>
        </article>

        <article className="card dashboard-card-enter dashboard-panel dashboard-workforce-panel">
          <div className="dashboard-panel-head">
            <div>
              <h2>تغطية القوى العاملة</h2>
              <p>التوزيع الحالي والاحتياج</p>
            </div>
          </div>
          <div className="dashboard-panel-content">
            {dashboard.staffingLoading ? <CardSkeleton /> : dashboard.staffingError
              ? <CardError title="تعذر تحميل تغطية القوى العاملة" message={dashboard.staffingError.message} />
              : !dashboard.staffingConfigured ? (
              <p className="mt-4 text-sm text-slate-500">إعدادات احتياج القوى العاملة غير متاحة.</p>
            ) : workforce ? (
              <>
                <div className="dashboard-labor">
                  <div className="dashboard-labor-stat">
                    <span>المطلوب</span><b>{formatNumber(workforce.total.required)}</b>
                  </div>
                  <div className="dashboard-labor-stat">
                    <span>المسند</span><b>{formatNumber(workforce.total.assigned)}</b>
                  </div>
                  <div className="dashboard-labor-stat is-short">
                    <span>العجز</span>
                    <b>{formatNumber(workforce.total.shortage)}</b>
                    {workforce.total.shortageSchools !== null && (
                      <small>في {formatArabicCount(workforce.total.shortageSchools, formatNumber, schoolCountForms)}</small>
                    )}
                  </div>
                </div>
                <div className="dashboard-workforce-lines">
                  <WorkforceProgressLine label="عمال النظافة" assigned={workforce.cleaners.assigned}
                    required={workforce.cleaners.required} formatNumber={formatNumber}
                    tone={workforce.cleaners.assigned >= workforce.cleaners.required ? 'emerald' : 'amber'} />
                  <WorkforceProgressLine label="البوابون" assigned={workforce.gatekeepers.assigned}
                    required={workforce.gatekeepers.required} formatNumber={formatNumber}
                    tone={workforce.gatekeepers.assigned >= workforce.gatekeepers.required ? 'emerald' : 'amber'} />
                </div>
                <p className="dashboard-workforce-balance">
                  عمال النظافة:{' '}
                  {workforce.cleaners.shortage === 0 && workforce.cleaners.surplus === 0
                    ? 'مغطّى بالكامل ✓'
                    : <>عجز {formatNumber(workforce.cleaners.shortage)} في {formatNumber(workforce.cleaners.shortageSchools)} مدرسة · زيادة {formatNumber(workforce.cleaners.surplus)} في {formatNumber(workforce.cleaners.surplusSchools)} مدرسة</>}
                  <br />
                  البوابون:{' '}
                  {workforce.gatekeepers.shortage === 0 && workforce.gatekeepers.surplus === 0
                    ? 'مغطّى بالكامل ✓'
                    : <>عجز {formatNumber(workforce.gatekeepers.shortage)} في {formatNumber(workforce.gatekeepers.shortageSchools)} مدرسة · زيادة {formatNumber(workforce.gatekeepers.surplus)} في {formatNumber(workforce.gatekeepers.surplusSchools)} مدرسة</>}
                </p>
                <p className="dashboard-workforce-note">
                  الحالة الحالية للمدارس المؤهلة، مستقلة عن الفلاتر.
                </p>
              </>
            ) : (
              <p className="mt-4 text-sm text-slate-500">لا توجد بيانات تغطية.</p>
            )}
          </div>
          <Link to="/workforce" className="dashboard-panel-link dashboard-workforce-link mt-auto pt-3">
            تفصيل الاحتياج حسب حجم المدرسة ←
          </Link>
        </article>
      </section>
      )}

      {dashboard.access.rewardsShortcut && (
        <Link to={`/rewards?month=${encodeURIComponent(dashboard.month)}`} className="card dashboard-rewards-link">
          <span>
            <b>مكافآت الفنيين</b>
            <span>فتح بيانات المكافآت المتاحة لدورك</span>
          </span>
          <span aria-hidden="true">←</span>
        </Link>
      )}

      {(dashboard.access.workforce || dashboard.access.deliverables || dashboard.access.kpi) && (
        <section className="dashboard-lower items-stretch">
          {dashboard.access.workforce && !dashboard.access.reportFollowerView && (
            <article className="card dashboard-panel dashboard-schools-panel">
              <div className="dashboard-panel-head">
                <div>
                  <h2>المدارس التي تحتاج دعمًا</h2>
                  <p>
                    {workforce
                      ? `${formatNumber(workforce.cleaners.shortageSchools)} مدرسة لديها عجز · إجمالي النقص ${formatNumber(workforce.cleaners.shortage)}`
                      : 'أعلى المدارس عجزًا في عمال النظافة'}
                  </p>
                </div>
              </div>
              <div className="dashboard-panel-content">
                {dashboard.staffingLoading ? <CardSkeleton /> : dashboard.staffingError
                  ? <CardError title="تعذر تحميل المدارس ذات العجز" message={dashboard.staffingError.message} />
                  : !dashboard.staffingConfigured
                    ? <p className="mt-4 text-sm text-slate-500">إعدادات احتياج القوى العاملة غير متاحة.</p>
                    : largestCleanerShortages.length ? (
                      <ul className="dashboard-shortage-list">
                        {largestCleanerShortages.map((school) => (
                          <li key={school.id}>
                            <Link to="/placement/cleaners?shortage=true" title={school.name}>{school.name}</Link>
                            <b>عجز {formatNumber(school.shortage)}</b>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-4 text-sm text-slate-500">لا توجد مدارس لديها عجز.</p>
                    )}
              </div>
              <Link to="/placement/cleaners?shortage=true" className="dashboard-panel-link mt-auto pt-3">كل المدارس ←</Link>
            </article>
          )}

          {(dashboard.access.deliverables || dashboard.access.kpi) && (
            <article className="card dashboard-panel dashboard-contract-panel">
              <div className="dashboard-panel-head">
                <div>
                  <h2>العقود والمخرجات</h2>
                  <p>
                    {dashboard.latestKpi?.contractMonth !== null && dashboard.latestKpi?.contractMonth !== undefined
                      ? `نظرة سريعة على الشهر التعاقدي ${formatNumber(dashboard.latestKpi.contractMonth)}`
                      : 'ملخص المخرجات التعاقدية وبطاقة الأداء'}
                  </p>
                </div>
              </div>
              <div className="dashboard-panel-content">
                {dashboard.access.deliverables && (
                  dashboard.deliverablesLoading ? <CardSkeleton /> : dashboard.deliverablesError
                    ? <CardError title="تعذر تحميل المخرجات" message={dashboard.deliverablesError.message} />
                    : dashboard.deliverableSummary ? (
                      <div className="dashboard-contractbody">
                        <div>
                          <div className="dashboard-contractnums">
                            <DeliverableCount label="معتمد" value={dashboard.deliverableSummary.approved} formatNumber={formatNumber} />
                            <DeliverableCount label="بانتظار" value={dashboard.deliverableSummary.delivered - dashboard.deliverableSummary.approved} formatNumber={formatNumber} />
                            <DeliverableCount label="غير مستلم" value={dashboard.deliverableSummary.total - dashboard.deliverableSummary.delivered} formatNumber={formatNumber} />
                            <DeliverableCount label="متأخر" value={dashboard.deliverableSummary.late} formatNumber={formatNumber} />
                          </div>
                          <p className="dashboard-deliverables-note">
                            المخرجات المسلّمة {formatNumber(dashboard.deliverableSummary.delivered)} من {formatNumber(dashboard.deliverableSummary.total)}
                          </p>
                        </div>
                        <div
                          className="dashboard-contract-donut"
                          role="progressbar"
                          aria-label="نسبة المخرجات المسلّمة"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={dashboard.deliverableSummary.progressPercent}
                          style={{
                            background: `conic-gradient(#13865e 0 ${dashboard.deliverableSummary.progressPercent}%, #e9eef3 ${dashboard.deliverableSummary.progressPercent}% 100%)`,
                          }}
                        >
                          <span>{formatNumber(dashboard.deliverableSummary.progressPercent.toFixed(1))}%</span>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-4 text-sm text-slate-500">لا توجد مخرجات تعاقدية.</p>
                    )
                )}
                {dashboard.access.kpi && (
                  <div className="dashboard-contract-kpi">
                    {dashboard.kpiLoading ? <CardSkeleton /> : dashboard.kpiError
                      ? <CardError title="تعذر تحميل بطاقة الأداء" message={dashboard.kpiError.message} />
                      : dashboard.latestKpi ? (
                        <>
                          <p className="dashboard-contract-kpi-month">
                            بطاقة {dashboard.latestKpi.month.slice(0, 7) === dashboard.month
                              ? dashboard.month
                              : `آخر بطاقة: ${formatNumber(dashboard.latestKpi.month.slice(0, 7))}`}
                          </p>
                          <p>
                            تقييم الشهر:{' '}
                            <b className={`dashboard-rating-text ${dashboard.latestKpi.rating ?? 'unavailable'}`}>
                              {dashboard.latestKpi.rating === 'excellent'
                                ? 'ممتاز'
                                : dashboard.latestKpi.rating === 'average'
                                  ? 'متوسط'
                                  : dashboard.latestKpi.rating === 'weak' ? 'يحتاج إلى تحسين' : 'غير متاح'}
                            </b>
                            {' · '}
                            نتيجة البطاقة {dashboard.latestKpi.scorePercent === null
                              ? '—'
                              : `${formatNumber(dashboard.latestKpi.scorePercent.toFixed(1))}%`}
                            {' · '}
                            استحقاق الفاتورة {dashboard.latestKpi.payablePercent === null
                              ? '—'
                              : `${formatNumber(dashboard.latestKpi.payablePercent.toFixed(0))}%`}
                          </p>
                        </>
                      ) : (
                        <p>لا توجد بطاقة أداء مسجلة.</p>
                      )}
                  </div>
                )}
              </div>
              {dashboard.access.kpi && dashboard.latestKpi && (
                <div className="dashboard-panel-actions">
                  <Link to={`/kpi/scorecards?month=${encodeURIComponent(dashboard.month)}`} className="dashboard-panel-link">
                    فتح بطاقة الأداء ←
                  </Link>
                </div>
              )}
            </article>
          )}
        </section>
      )}

      {dashboard.access.activity && (
        <section className="card dashboard-activity">
          <div className="dashboard-panel-head">
            <div>
              <h2>آخر النشاطات</h2>
              <p>أحدث التحديثات على الخطط والتقارير خلال الشهر المحدد</p>
            </div>
            {canViewAudit && dashboard.recentActivity.length > 3 && (
              <Link to="/admin/audit" className="dashboard-panel-link">عرض الكل ←</Link>
            )}
          </div>
          {dashboard.activityLoading ? <CardSkeleton /> : dashboard.activityError
            ? <CardError title="تعذر تحميل النشاطات" message={dashboard.activityError.message} />
            : dashboard.recentActivity.length ? (
              <>
                <ol className="dashboard-activity-list">
                  {dashboard.recentActivity.slice(0, 3).map(renderActivityRow)}
                </ol>
              </>
            ) : (
              <p className="mt-4 text-sm text-slate-500">لا توجد نشاطات مهمة مسجلة.</p>
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
                      <span className="min-w-0 break-words font-semibold text-slate-700">{item.schoolName}</span>
                      <span className="text-slate-500">{serviceLabels[item.planType]} · {formatDate(item.plannedDate)}</span>
                      {item.supervisorName && <span className="w-full break-words text-xs text-slate-400">{item.supervisorName}</span>}
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
  const clear = value === 0 && !loading;
  return (
    <Link to={to} title={tooltip} className={`card dashboard-glass dashboard-card-enter group dashboard-action-tile${clear ? ' dashboard-action-clear' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold leading-5 text-slate-500">
          {titleForms && value !== undefined
            ? `${titlePrefix ?? ''}${formatArabicCount(value, formatNumber, titleForms)}`
            : title}
        </p>
        <span className={`shrink-0 ${clear ? 'text-slate-400' : tone}`}>
          {clear ? <span aria-hidden="true">✓</span> : icon}
        </span>
      </div>
      {detail && <p className="dashboard-action-detail">{detail}</p>}
      <div className="dashboard-action-footer">
        <p className={`dashboard-action-value ${clear ? 'text-slate-400' : tone}`}>
          {value === undefined
            ? loading ? '…' : '—'
            : clear
              ? <span aria-label="لا توجد عناصر تحتاج متابعة">✓</span>
              : <AnimatedNumber value={value} formatNumber={formatNumber} />}
        </p>
        <span className="dashboard-action-link">{action} ←</span>
      </div>
    </Link>
  );
}

function previousMonth(month: string): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
}

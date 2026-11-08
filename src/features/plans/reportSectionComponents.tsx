import type { ReactNode } from 'react';
import type { CSSProperties } from 'react';
import type { ReportData, ReportService, ReportSupervisor } from './reportData';

export type ReportSectionProps = ReportData;

const number = (value: number, format: (value: string | number) => string) => format(value);
const percent = (value: number, format: (value: string | number) => string) => `${format(value.toFixed(1))}%`;

function SectionCard({ title, children, className = '' }: { title: string; children: ReactNode; className?: string }) {
  return <section className={`report-design-card ${className}`}><h2 className="report-design-title">{title}</h2>{children}</section>;
}

function ProgressBar({ value, tone = 'green' }: { value: number; tone?: 'green' | 'navy' | 'red' }) {
  return <div className="report-design-bar"><i className={`report-design-fill ${tone}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></div>;
}

function ServiceRow({ service, formatNumber }: { service: ReportService; formatNumber: ReportData['formatNumber'] }) {
  if (service.id !== 'total' && service.planned === 0) {
    return <div className="report-service-row report-service-no-plan">
      <div className="report-service-name"><strong>{service.label}</strong><small>لا توجد خطة</small></div>
      <div className="report-service-empty">لا توجد خطة</div>
      <div className="report-service-empty">لا توجد خطة</div>
      <span className="report-percent neutral">—</span>
    </div>;
  }
  return <div className={`report-service-row ${service.id === 'total' ? 'report-service-total' : ''}`}>
    <div className="report-service-name"><strong>{service.label}</strong><small>{number(service.planned, formatNumber)} زيارة مخططة</small></div>
    <div><div className="report-numbers"><b className="green-text">{number(service.visited, formatNumber)}</b> منجز <b>{number(service.visitRemaining, formatNumber)}</b> متبقي</div><ProgressBar value={service.visitPercent} /></div>
    <div><div className="report-numbers"><b className="green-text">{number(service.reportsDone, formatNumber)}</b> منجز <b>{number(service.reportRemaining, formatNumber)}</b> متبقي</div><ProgressBar value={service.reportPercent} tone="navy" /></div>
    <span className={`report-percent ${service.pillTone}`}>{percent(service.overallPercent, formatNumber)}</span>
  </div>;
}

export function HeaderSection({ monthLabel, asOfLabel, lastUpdate, logoPath }: ReportData) {
  return <header className="report-design-header report-keep">
    <div className="report-header-content">
      <img className="report-design-logo" src={logoPath} alt="شلفا" />
      <div><div className="report-header-kicker">تقرير متابعة الخطة الشهرية</div><h1>{monthLabel}</h1><p>مدارس الرياض · حتى يوم {asOfLabel}</p></div>
      <div className="report-last-update">آخر تحديث للبيانات<strong><bdi dir="ltr">{lastUpdate}</bdi></strong></div>
    </div>
  </header>;
}

export function ServicesSection({ services, totalService, formatNumber }: ReportData) {
  return <SectionCard title="ملخص الخدمات">
    <div className="report-service-row report-service-heading"><div>الخدمة</div><div>الزيارات (منجز / متبقي)</div><div>التقارير (منجز / متبقي)</div><div>الإنجاز العام</div></div>
    {services.map((service) => <ServiceRow key={service.id} service={service} formatNumber={formatNumber} />)}
    <ServiceRow service={totalService} formatNumber={formatNumber} />
    <div className="report-legend"><span><i className="green" /> الزيارات</span><span><i className="navy" /> التقارير</span></div>
    <p className="report-formula">الإنجاز العام = (الزيارات + التقارير) ÷ (2 × المخطط)</p>
  </SectionCard>;
}

export function SummarySection({ summaryCards, formatNumber }: ReportData) {
  return <div className="report-summary-grid">{summaryCards.map((card) => <article key={card.label} className={`report-summary-card ${card.tone}`}><span>{card.label}</span><b>{number(card.value, formatNumber)}</b></article>)}</div>;
}

export function SupervisorsSection({ supervisors, formatNumber }: ReportData) {
  return <SectionCard title="الزيارات حسب المشرف — الصيانة" className="report-supervisors-card">
    <div className="report-supervisor-legend"><span><i className="green" /> منجز</span><span><i className="red" /> متأخر</span><span><i className="empty" /> متبقي</span></div>
    {supervisors.length ? supervisors.map((supervisor) => <SupervisorRow key={supervisor.id} supervisor={supervisor} formatNumber={formatNumber} />) : <p className="report-empty">لا توجد بيانات مشرفين للصيانة.</p>}
  </SectionCard>;
}

function SupervisorRow({ supervisor, formatNumber }: { supervisor: ReportSupervisor; formatNumber: ReportData['formatNumber'] }) {
  return <div className="report-supervisor-row"><strong>{supervisor.name}</strong><div className="report-supervisor-track"><i className="green" style={{ width: `${supervisor.donePercent}%` }} /><i className="red" style={{ width: `${supervisor.latePercent}%` }} /></div><small dir="ltr">{number(supervisor.visited, formatNumber)} / {number(supervisor.planned, formatNumber)}</small></div>;
}

export function CumulativeSection({ chart }: ReportData) {
  const actualPoints = chart.points.filter((point) => point.actualVisible).map((point) => `${point.x},${point.yActual}`).join(' ');
  const plannedPoints = chart.points.map((point) => `${point.x},${point.yPlanned}`).join(' ');
  return <SectionCard title="تراكمي الزيارات — الصيانة" className="report-cumulative-card">
    <div className="report-legend report-chart-legend"><span><i className="navy" /> المخطط</span><span><i className="green" /> الفعلي</span><span><i className="dash" /> التوقع</span></div>
    <svg className="report-line-chart" viewBox="0 0 1000 310" preserveAspectRatio="none" role="img" aria-label="تراكمي الزيارات">
      <g fill="none" stroke="#e5eaf2" strokeWidth="1">{chart.yTicks.map((tick) => <line key={tick.y} x1="70" y1={tick.y} x2="950" y2={tick.y} fill="none" stroke="#e5eaf2" />)}</g>
      <polyline points={plannedPoints} fill="none" stroke="#21366a" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      <polyline points={actualPoints} fill="none" stroke="#2f9b72" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      {chart.forecastPoints && <line x1={chart.todayX} y1={chart.todayY} x2="950" y2={chart.forecastY} fill="none" stroke="#8390a7" strokeWidth="2" strokeDasharray="7 6" />}
      <line x1={chart.todayX} y1="30" x2={chart.todayX} y2="260" fill="none" stroke="#b7c1d3" strokeWidth="1.5" strokeDasharray="4 4" />
      <rect x={chart.todayX - 95} y="2" width="190" height="42" rx="21" fill="#21366a" />
      <text x={chart.todayX} y="30" textAnchor="middle" fill="#ffffff" fontSize="22" fontFamily="Cairo, sans-serif">اليوم {chart.todayLabel}</text>
      {chart.yTicks.map((tick) => <text key={`y-${tick.y}`} x="58" y={tick.y + 7} textAnchor="end" fill="#68728a" fontSize="22" fontFamily="Cairo, sans-serif">{tick.label}</text>)}
      {chart.xLabels.map((label) => <text key={label.x} x={label.x} y="294" textAnchor="middle" fill="#68728a" fontSize="22" fontFamily="Cairo, sans-serif">{label.label}</text>)}
    </svg>
  </SectionCard>;
}

export function ReportsSection({ reports, formatNumber }: ReportData) {
  return <SectionCard title="ملخص التقارير — كل الخدمات" className="report-reports-card">
    <div className="report-donut-layout"><div className="report-donut-summary"><div className="report-donut" style={{ '--report-pct': `${reports.percent}%` } as CSSProperties}><strong>{percent(reports.percent, formatNumber)}</strong><span>تم رفعها</span></div><div className="report-donut-key"><div><i className="green" /> تم الرفع <b>{number(reports.uploaded, formatNumber)}</b></div><div><i className="empty" /> لم يتم الرفع <b>{number(reports.remaining, formatNumber)}</b></div><small>من إجمالي {number(reports.total, formatNumber)} تقرير مخطط</small></div></div><div className="report-service-report-list">{reports.byService.map((service) => <div key={service.id}><span>{service.label}</span><b>{number(service.uploaded, formatNumber)} / {number(service.planned, formatNumber)}</b></div>)}</div></div>
  </SectionCard>;
}

export function LateItemsSection({ lateItems, formatNumber }: ReportData) {
  const visibleItems = lateItems.slice(0, 30);
  const remaining = Math.max(0, lateItems.length - visibleItems.length);
  return <SectionCard title="متابعة المتأخرات">
    {visibleItems.length ? <div className="report-export-table"><table className="w-full text-sm"><colgroup><col className="report-late-school-column" /><col className="report-late-kind-column" /><col className="report-late-date-column" /><col className="report-late-days-column" /><col className="report-late-supervisor-column" /></colgroup><thead><tr><th>المدرسة</th><th>النوع</th><th>التاريخ</th><th>التأخر</th><th>المشرف</th></tr></thead><tbody>{visibleItems.map((item) => <tr key={item.id}><td>{item.schoolName}</td><td>{item.kind}</td><td><bdi dir="ltr">{formatNumber(`${item.plannedDate.slice(8, 10)}/${item.plannedDate.slice(5, 7)}/${item.plannedDate.slice(0, 4)}`)}</bdi></td><td>{formatNumber(item.daysLate)} يوم</td><td>{item.supervisorName}</td></tr>)}</tbody></table>{remaining > 0 && <p className="report-export-more">+{formatNumber(remaining)} أخرى</p>}</div> : <p className="report-empty">لا توجد عناصر متأخرة.</p>}
  </SectionCard>;
}

export function CleaningSupervisorsSection({ cleaningSupervisors, formatNumber }: ReportData) {
  return <SectionCard title="زيارات مشرفي النظافة">
    {cleaningSupervisors.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th>المشرف</th><th>المخطط</th><th>الزيارات</th><th>التقارير</th></tr></thead><tbody>{cleaningSupervisors.map((item) => <tr key={item.id}><td>{item.name}</td><td>{formatNumber(item.planned)}</td><td>{formatNumber(item.visited)}</td><td>{formatNumber(item.reportsDone)}</td></tr>)}</tbody></table></div> : <p className="report-empty">لا توجد بيانات لمشرفي النظافة.</p>}
  </SectionCard>;
}

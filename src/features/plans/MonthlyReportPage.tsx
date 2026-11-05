import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Printer } from 'lucide-react';
import { loadXlsx } from '../../lib/xlsx';
import { z } from 'zod';
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  buildPlanReportView, filterPlanReportRows, type ReportAxisFilter, type ReportPlanRow,
} from '../../domain/planReport';
import { useDisplayFormat } from '../../app/useDisplayFormat';
import { supabase } from '../../lib/supabase';
import { APP_SCHEMA_SELECT } from '../../lib/schemaColumns';

const planHeaderSchema = z.object({ id: z.string().uuid(), plan_type: z.enum(['maintenance', 'cleaning', 'elevators', 'security_safety']), month: z.string() });
const reportRowSchema = z.object({
  id: z.string().uuid(), plan_id: z.string().uuid(), school_id: z.string().uuid(), planned_date: z.string(),
  visited: z.boolean(), visited_date: z.string().nullable(), report_done: z.boolean(), report_done_date: z.string().nullable(),
  engineer_id: z.string().uuid().nullable(), engineer_name: z.string().nullable(), supervisor_id: z.string().uuid().nullable(), supervisor_name: z.string().nullable(), contractor_name: z.string().nullable(),
  school: z.object({ name: z.string(), ministry_no: z.string(), neighbourhood: z.string().nullable() }).nullable(),
});
const employeeSchema = z.object({ id: z.string().uuid(), full_name: z.string() });
const cleanerSchema = z.object({ school_id: z.string().uuid() });
type LoadedReport = { current: ReportPlanRow[]; previous: ReportPlanRow[] };
type ReportView = ReturnType<typeof buildPlanReportView>;
type Card = { label: string; value: number; unit?: '%' | ''; tone: string; delta?: number | null };
const axes = [
  { value: 'maintenance', label: 'الصيانة والتكييف' }, { value: 'cleaning', label: 'النظافة' },
  { value: 'elevators', label: 'المصاعد' }, { value: 'security_safety', label: 'الأمن والسلامة' },
] as const;
const axisOptions: Array<{ value: ReportAxisFilter; label: string }> = [{ value: 'all', label: 'جميع المحاور' }, ...axes];

function monthNow() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function todayLocal() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function previousMonth(month: string) { const d = new Date(`${month}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); }
const EMPTY_ROWS: ReportPlanRow[] = [];

async function fetchMonthRows(month: string): Promise<ReportPlanRow[]> {
  if (!supabase) throw new Error('إعداد الاتصال بقاعدة البيانات غير مكتمل.');
  const { data: plansData, error: plansError } = await supabase.from('monthly_plans').select(APP_SCHEMA_SELECT.monthlyReportPlanHeaders).eq('month', `${month}-01`);
  if (plansError) throw plansError;
  const plans = z.array(planHeaderSchema).parse(plansData);
  if (!plans.length) return [];
  const { data, error } = await supabase.from('monthly_plan_rows').select(APP_SCHEMA_SELECT.monthlyReportPlanRows).in('plan_id', plans.map((p) => p.id));
  if (error) throw error;
  const rows = z.array(reportRowSchema).parse(data);
  const ids = [...new Set(rows.flatMap((r) => [r.engineer_id, r.supervisor_id].filter((id): id is string => Boolean(id))))];
  const schoolIds = [...new Set(rows.map((r) => r.school_id))];
  const [employees, cleaners] = await Promise.all([
    ids.length ? supabase.from('employees').select(APP_SCHEMA_SELECT.reportEmployees).in('id', ids) : Promise.resolve({ data: [], error: null }),
    schoolIds.length ? supabase.from('cleaner_assignments').select(APP_SCHEMA_SELECT.cleanerAssignmentSchool).in('school_id', schoolIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (employees.error) throw employees.error;
  if (cleaners.error) throw cleaners.error;
  const names = new Map(z.array(employeeSchema).parse(employees.data).map((e) => [e.id, e.full_name]));
  const cleanerIds = new Set(z.array(cleanerSchema).parse(cleaners.data).map((r) => r.school_id));
  return rows.map((row) => ({
    id: row.id, month, planType: plans.find((p) => p.id === row.plan_id)!.plan_type, plannedDate: row.planned_date,
    visited: row.visited, visitedDate: row.visited_date, reportDone: row.report_done, reportCompletedDate: row.report_done_date,
    engineerId: row.engineer_id, engineerName: row.engineer_id ? names.get(row.engineer_id) ?? row.engineer_name : row.engineer_name,
    supervisorId: row.supervisor_id, supervisorName: row.supervisor_id ? names.get(row.supervisor_id) ?? row.supervisor_name : row.supervisor_name,
    contractorName: row.contractor_name, schoolId: row.school_id, schoolName: row.school?.name ?? 'مدرسة غير معروفة',
    ministryNumber: row.school?.ministry_no ?? '', neighbourhood: row.school?.neighbourhood ?? 'غير محدد', hasCleaner: cleanerIds.has(row.school_id),
  }));
}
async function loadReport(month: string): Promise<LoadedReport> {
  const [current, previous] = await Promise.all([fetchMonthRows(month), fetchMonthRows(previousMonth(month))]);
  return { current, previous };
}
async function exportWorkbook(view: ReportView) {
  const XLSX = await loadXlsx();
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['المؤشر', 'القيمة'], ...view.cards.map((c) => [c.label, c.value]),
  ]), 'ملخص');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['المحور', 'المخطط', 'تمت الزيارة', 'تم الرفع', 'مكتملة', 'نسبة الزيارات', 'نسبة التقارير'],
    ...view.axes.map((a) => [a.label, a.planned, a.visited, a.reportsDone, a.completed, a.visitPercent, a.reportPercent]),
  ]), 'المحاور');
  XLSX.writeFile(book, 'تقرير-الخطة-الشهرية.xlsx');
}
function pct(value: number, format: (v: string | number) => string) { return `${format(value.toFixed(1))}%`; }
function formatMonth(month: string) { return new Intl.DateTimeFormat('ar-SA', { month: 'long', year: 'numeric' }).format(new Date(`${month}-01T00:00:00Z`)); }

export function MonthlyReportPage({ fixture }: { fixture?: LoadedReport } = {}) {
  const { formatNumber, formatDate } = useDisplayFormat();
  const [month, setMonth] = useState(monthNow);
  const [asOf, setAsOf] = useState(todayLocal);
  const [axis, setAxis] = useState<ReportAxisFilter>('all');
  const [engineerId, setEngineerId] = useState('');
  const [supervisorId, setSupervisorId] = useState('');
  const [neighbourhood, setNeighbourhood] = useState('');
  const [showDailyTable, setShowDailyTable] = useState(false);
  const report = useQuery({ queryKey: ['monthly-report', month, Boolean(fixture)], queryFn: () => fixture ?? loadReport(month) });
  const rows = report.data?.current ?? EMPTY_ROWS;
  const filtered = useMemo(() => filterPlanReportRows(rows, { month, axis, engineerId, supervisorId, neighbourhood }), [rows, month, axis, engineerId, supervisorId, neighbourhood]);
  const previous = useMemo(() => filterPlanReportRows(report.data?.previous ?? [], { month: previousMonth(month), axis, engineerId, supervisorId, neighbourhood }), [report.data, month, axis, engineerId, supervisorId, neighbourhood]);
  const view = useMemo(() => buildPlanReportView(filtered, month, asOf, previous), [filtered, month, asOf, previous]);
  const engineers = useMemo(() => uniqueOptions(rows, 'engineerId', 'engineerName'), [rows]);
  const supervisors = useMemo(() => uniqueOptions(rows.filter((r) => r.planType === 'maintenance' || r.planType === 'cleaning'), 'supervisorId', 'supervisorName'), [rows]);
  const neighbourhoods = useMemo(() => [...new Set(rows.map((r) => r.neighbourhood))].sort((a, b) => a.localeCompare(b, 'ar')), [rows]);
  const summary = `حتى ${formatDate(asOf)} أُنجز ${pct(view.metrics.visitPercent, formatNumber)} من الزيارات المخططة مقابل ${pct(view.metrics.expectedPercent, formatNumber)} المتوقع حتى هذا اليوم، واكتمل ${pct(view.metrics.completionPercent, formatNumber)} من الزيارات والتقارير معاً.`;
  const cards: Card[] = [
    { label: 'المدارس في الخطة', value: view.metrics.planned, tone: 'navy' },
    { label: 'إجمالي الزيارات المخططة', value: view.metrics.planned, tone: 'navy' },
    { label: 'الزيارات المنجزة', value: view.metrics.visited, tone: 'green', delta: view.metrics.visitGap },
    { label: 'نسبة إنجاز الزيارات', value: view.metrics.visitPercent, unit: '%', tone: 'green' },
    { label: 'نسبة رفع التقارير', value: view.metrics.reportPercent, unit: '%', tone: 'blue' },
    { label: 'نسبة الاكتمال (زيارة + تقرير)', value: view.metrics.completionPercent, unit: '%', tone: 'green' },
    { label: 'التقارير المرفوعة', value: view.metrics.reportsDone, tone: 'blue' },
    { label: 'الزيارات قيد التنفيذ', value: view.metrics.inProgress, tone: 'amber' },
    { label: 'الزيارات المتبقية', value: Math.max(0, view.metrics.planned - view.metrics.visited), tone: 'amber' },
    { label: 'التقارير المتبقية', value: Math.max(0, view.metrics.planned - view.metrics.reportsDone), tone: 'amber' },
    { label: 'زيارات متأخرة عن موعدها', value: view.metrics.lateVisits, tone: 'red' },
    { label: 'تمت ولم يُرفع تقريرها', value: view.metrics.inProgress, tone: 'red' },
  ];
  return <div className="monthly-report-print report-shell min-w-0" dir="rtl">
    <FilterBar {...{ month, setMonth, asOf, setAsOf, axis, setAxis, engineerId, setEngineerId, supervisorId, setSupervisorId, neighbourhood, setNeighbourhood, engineers, supervisors, neighbourhoods, formatDate }} onExcel={() => exportWorkbook(view)} onPrint={() => window.print()} />
    {report.error && <StateBox tone="error">تعذر تحميل التقرير: {report.error.message}</StateBox>}
    {report.isLoading && <ReportSkeleton />}
    {!report.isLoading && !report.error && !rows.length && <StateBox>لا توجد خطط شهرية مسجلة لهذا الشهر.</StateBox>}
    {!report.isLoading && !report.error && rows.length > 0 && <>
      <ReportHeader month={month} asOf={asOf} summary={summary} formatDate={formatDate} />
      <section className="report-section"><SectionTitle title="الإنجاز العام" /><div className="metric-grid">{cards.map((card) => <MetricCard key={card.label} card={card} formatNumber={formatNumber} />)}</div></section>
      <AxisSummary view={view} formatNumber={formatNumber} />
      <div className="report-two-col"><StatusPanel title="حالة الزيارات" axes={view.axes} kind="visit" formatNumber={formatNumber} /><StatusPanel title="حالة التقارير" axes={view.axes} kind="report" formatNumber={formatNumber} /></div>
      <SupervisorTable supervisors={view.supervisors} formatNumber={formatNumber} />
      <SupervisorBars supervisors={view.supervisors} formatNumber={formatNumber} />
      <CumulativeChart view={view} axisRows={axis === 'all' ? rows : filtered} axis={axis} setAxis={setAxis} showTable={showDailyTable} setShowTable={setShowDailyTable} formatNumber={formatNumber} formatDate={formatDate} />
      <DailySupervisorCharts supervisors={view.supervisors} formatNumber={formatNumber} />
      <LateTracker view={view} formatNumber={formatNumber} formatDate={formatDate} />
    </>}
  </div>;
}


function uniqueOptions(rows: ReportPlanRow[], idKey: 'engineerId' | 'supervisorId', nameKey: 'engineerName' | 'supervisorName') {
  return [...new Map(rows.filter((r) => r[idKey]).map((r) => [r[idKey]!, { id: r[idKey]!, name: r[nameKey] ?? 'غير محدد' }])).values()].sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}
function FilterBar(p: { month: string; setMonth: (v: string) => void; asOf: string; setAsOf: (v: string) => void; axis: ReportAxisFilter; setAxis: (v: ReportAxisFilter) => void; engineerId: string; setEngineerId: (v: string) => void; supervisorId: string; setSupervisorId: (v: string) => void; neighbourhood: string; setNeighbourhood: (v: string) => void; engineers: { id: string; name: string }[]; supervisors: { id: string; name: string }[]; neighbourhoods: string[]; formatDate: (v: string) => string; onExcel: () => void; onPrint: () => void }) {
  return <section className="no-print report-filter-bar"><label>الشهر<input type="month" value={p.month} onChange={(e) => p.setMonth(e.target.value)} /></label><label>كما في<input type="date" value={p.asOf} onChange={(e) => p.setAsOf(e.target.value)} /></label><Select label="المحور" value={p.axis} options={axisOptions} onChange={(v) => p.setAxis(v as ReportAxisFilter)} /><Select label="المهندس" value={p.engineerId} options={p.engineers.map((x) => ({ value: x.id, label: x.name }))} onChange={p.setEngineerId} empty="كل المهندسين" /><Select label="المشرف" value={p.supervisorId} options={p.supervisors.map((x) => ({ value: x.id, label: x.name }))} onChange={p.setSupervisorId} empty="كل المشرفين" /><Select label="الحي" value={p.neighbourhood} options={p.neighbourhoods.map((x) => ({ value: x, label: x }))} onChange={p.setNeighbourhood} empty="كل الأحياء" /><div className="filter-actions"><button type="button" onClick={p.onExcel}><Download size={15} /> Excel</button><button type="button" className="primary" onClick={p.onPrint}><Printer size={15} /> تصدير PDF</button></div></section>;
}
function Select({ label, value, options, onChange, empty }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; empty?: string }) { return <label>{label}<select value={value} onChange={(e) => onChange(e.target.value)}>{empty && <option value="">{empty}</option>}{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>; }
function ReportHeader({ month, asOf, summary, formatDate }: { month: string; asOf: string; summary: string; formatDate: (v: string) => string }) { return <header className="report-header report-keep"><div className="report-header-main"><img src="/brand/logo.png" alt="شلفا لإدارة المرافق" /><div><h1>متابعة خطة {formatMonth(month)} حتى يوم {formatDate(asOf)}</h1><p>مدارس الرياض</p></div></div><p className="report-summary">{summary}</p></header>; }
function SectionTitle({ title }: { title: string }) { return <div className="section-title"><h2>{title}</h2></div>; }
function StateBox({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) { return <div className={`state-box ${tone}`}>{children}</div>; }
function ReportSkeleton() { return <div className="report-skeleton"><span /><span /><span /><span /></div>; }
function MetricCard({ card, formatNumber }: { card: Card; formatNumber: (v: string | number) => string }) { return <article className={`metric-card tone-${card.tone}`}><span>{card.label}</span><strong>{formatNumber(card.value.toFixed(card.unit ? 1 : 0))}{card.unit}</strong>{card.delta !== undefined && card.delta !== null && <small>{card.delta >= 0 ? '+' : ''}{formatNumber(card.delta)} عن المتوقع</small>}</article>; }
function percentClass(v: number) { return v >= 80 ? 'pct-good' : v >= 50 ? 'pct-mid' : 'pct-low'; }
function AxisSummary({ view, formatNumber }: { view: ReportView; formatNumber: (v: string | number) => string }) { return <section className="report-section report-keep"><SectionTitle title="ملخص الإنجاز" /><div className="table-scroll"><table className="report-table axis-table"><thead><tr><th>المحور</th><th>الزيارات المخططة</th><th>تمت الزيارة</th><th>الزيارات المتبقية</th><th>نسبة الإنجاز</th><th>التقارير المخططة</th><th>تم الرفع</th><th>التقارير المتبقية</th><th>نسبة الرفع</th><th>مكتملة</th><th>نسبة الاكتمال</th></tr></thead><tbody>{view.axes.map((a) => <tr key={a.axis}><th>{a.label}</th><td>{formatNumber(a.planned)}</td><td>{formatNumber(a.visited)}</td><td>{formatNumber(a.planned - a.visited)}</td><td className={percentClass(a.visitPercent)}>{pct(a.visitPercent, formatNumber)}</td><td>{formatNumber(a.planned)}</td><td>{formatNumber(a.reportsDone)}</td><td>{formatNumber(a.planned - a.reportsDone)}</td><td className={percentClass(a.reportPercent)}>{pct(a.reportPercent, formatNumber)}</td><td>{formatNumber(a.completed)}</td><td className={percentClass(a.completionPercent)}>{pct(a.completionPercent, formatNumber)}</td></tr>)}</tbody></table></div></section>; }
function StatusPanel({ title, axes, kind, formatNumber }: { title: string; axes: ReportView['axes']; kind: 'visit' | 'report'; formatNumber: (v: string | number) => string }) { return <section className="report-section report-keep status-panel"><SectionTitle title={title} /><div className="legend"><i className="done" /> تم <i className="pending" /> قيد التنفيذ <i className="late" /> متأخر <i className="empty" /> لم يبدأ</div>{axes.map((a) => { const s = kind === 'visit' ? a.visitStack : a.reportStack; const total = s.done + s.pending + s.late; return <div className="status-row" key={a.axis}><b>{a.label}</b><div className="stack-bar"><span className="done" style={{ width: `${s.donePercent}%` }}>{s.done > 0 && formatNumber(s.done)}</span><span className="pending" style={{ width: `${s.pendingPercent}%` }}>{s.pending > 0 && formatNumber(s.pending)}</span><span className="late" style={{ width: `${s.latePercent}%` }}>{s.late > 0 && formatNumber(s.late)}</span>{!total && <span className="empty" style={{ width: '100%' }}>0</span>}</div></div>; })}</section>; }
function SupervisorTable({ supervisors, formatNumber }: { supervisors: ReportView['supervisors']; formatNumber: (v: string | number) => string }) { return <section className="report-section report-keep"><SectionTitle title="إنجاز المشرفين (نسبة الزيارات المنجزة / التقارير المرفوعة)" /><div className="table-scroll"><table className="report-table supervisor-table"><thead><tr><th rowSpan={2}>المشرف</th>{axes.map((a) => <th colSpan={2} key={a.value}>{a.label}</th>)}<th rowSpan={2}>إنجاز الزيارات (الكل)</th><th rowSpan={2}>الاكتمال (الكل)</th></tr><tr>{axes.flatMap((a) => [<th key={`${a.value}-v`}>زيارات</th>, <th key={`${a.value}-r`}>تقارير</th>])}</tr></thead><tbody>{supervisors.map((s) => <tr key={s.id}><th>{s.name}</th>{axes.flatMap((a) => { const applies = a.value === 'maintenance' || a.value === 'cleaning'; return applies ? [<td key={`${a.value}-v`} className={percentClass(s.visitPercent)}>{pct(s.visitPercent, formatNumber)}</td>, <td key={`${a.value}-r`} className={percentClass(s.reportPercent)}>{pct(s.reportPercent, formatNumber)}</td>] : [<td key={`${a.value}-v`} className="not-applicable">—</td>, <td key={`${a.value}-r`} className="not-applicable">—</td>]; })}<td className={percentClass(s.visitPercent)}>{pct(s.visitPercent, formatNumber)}</td><td className={percentClass(s.completionPercent)}>{pct(s.completionPercent, formatNumber)}</td></tr>)}</tbody></table></div></section>; }
function SupervisorBars({ supervisors, formatNumber }: { supervisors: ReportView['supervisors']; formatNumber: (v: string | number) => string }) { return <section className="report-section report-keep"><SectionTitle title="توزيع الزيارات حسب المشرف" />{supervisors.map((s) => <div className="supervisor-bar-row" key={s.id}><b>{s.name} ({formatNumber(s.planned)})</b><div className="supervisor-bar"><span style={{ width: `${s.visitPercent}%` }}>{formatNumber(s.visited)}</span><em>{formatNumber(s.planned - s.visited)}</em></div></div>)}</section>; }
function CumulativeChart({ view, axis, setAxis, showTable, setShowTable, formatNumber, formatDate }: { view: ReportView; axisRows: ReportPlanRow[]; axis: ReportAxisFilter; setAxis: (v: ReportAxisFilter) => void; showTable: boolean; setShowTable: (v: boolean) => void; formatNumber: (v: string | number) => string; formatDate: (v: string) => string }) { const asOfPoint = view.daily.find((d) => d.isAsOfDate)?.date; return <section className="report-section report-keep cumulative"><div className="section-title"><h2>التقدم التراكمي: المخطط مقابل المنجز</h2><div className="chart-controls no-print"><Select label="المحور" value={axis} options={axisOptions} onChange={(v) => setAxis(v as ReportAxisFilter)} /><button type="button" onClick={() => setShowTable(!showTable)}>{showTable ? 'إخفاء الجدول' : 'عرض الجدول'}</button></div></div><div className="line-chart" role="img" aria-label="مخطط التقدم التراكمي"><ResponsiveContainer width="100%" height="100%"><LineChart data={view.daily} margin={{ top: 12, right: 12, left: 0, bottom: 8 }}><CartesianGrid stroke="#edf0f5" vertical={false} /><XAxis dataKey="date" tickFormatter={(value: string) => value.slice(-2)} tick={{ fontSize: 9 }} interval={2} /><YAxis tick={{ fontSize: 9 }} width={28} /><Tooltip labelFormatter={(value) => formatDate(String(value))} formatter={(value: number, name: string) => [formatNumber(value), name === 'planned' ? 'المخطط' : 'المنجز']} /><Legend formatter={(value) => value === 'planned' ? 'المخطط' : 'المنجز'} /><Line type="monotone" dataKey="planned" name="planned" stroke="#21366a" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="actual" name="actual" stroke="#16835d" strokeWidth={2} dot={false} />{asOfPoint && <ReferenceLine x={asOfPoint} stroke="#d79527" strokeDasharray="4 4" label={{ value: 'اليوم', fill: '#986316', fontSize: 10 }} />}</LineChart></ResponsiveContainer></div>{showTable && <div className="table-scroll"><table className="report-table"><thead><tr><th>اليوم</th><th>المخطط التراكمي</th><th>المنجز التراكمي</th></tr></thead><tbody>{view.daily.map((d) => <tr key={d.date}><td>{formatDate(d.date)}</td><td>{formatNumber(d.planned)}</td><td>{formatNumber(d.actual)}</td></tr>)}</tbody></table></div>}</section>; }
function DailySupervisorCharts({ supervisors, formatNumber }: { supervisors: ReportView['supervisors']; formatNumber: (v: string | number) => string }) { return <section className="report-section report-keep"><SectionTitle title="المطلوب مقابل المنجز لكل مشرف (يومياً)" /><div className="small-chart-grid">{supervisors.map((s) => <article className="small-chart" key={s.id}><h3>{s.name} <small>| مخطط {formatNumber(s.planned)} • تم {formatNumber(s.visited)} • متأخر {formatNumber(s.lateVisits)}</small></h3><div className="bars"><ResponsiveContainer width="100%" height="100%"><BarChart data={s.daily} margin={{ top: 4, right: 0, left: -20, bottom: 0 }}><CartesianGrid stroke="#edf0f5" vertical={false} /><XAxis dataKey="date" tickFormatter={(value: string) => value.slice(-2)} tick={{ fontSize: 8 }} interval={4} /><YAxis allowDecimals={false} tick={{ fontSize: 8 }} /><Tooltip labelFormatter={(value) => value} formatter={(value: number, name: string) => [formatNumber(value), name === 'planned' ? 'مطلوب' : 'تم']} /><Bar dataKey="planned" name="planned" fill="#aeb8c7" radius={[2, 2, 0, 0]} /><Bar dataKey="actual" name="actual" fill="#16835d" radius={[2, 2, 0, 0]} /></BarChart></ResponsiveContainer></div></article>)}</div></section>; }
function LateTracker({ view, formatNumber, formatDate }: { view: ReportView; formatNumber: (v: string | number) => string; formatDate: (v: string) => string }) { return <section className="report-section report-keep"><SectionTitle title="متابعة العناصر المتأخرة وأعمارها" /><div className="aging-grid">{(['1–2', '3–5', '6+'] as const).map((b) => <div key={b}>تأخير {b} يوم<strong>{formatNumber(view.aging[b])}</strong></div>)}</div>{view.lateItems.length ? <div className="table-scroll"><table className="report-table"><thead><tr><th>المدرسة</th><th>المحور</th><th>العنصر</th><th>التاريخ</th><th>الأيام</th><th>المسؤول</th></tr></thead><tbody>{view.lateItems.map((i) => <tr key={i.id}><td>{i.schoolName}</td><td>{i.axis}</td><td>{i.kind === 'visit' ? 'زيارة' : 'تقرير'}</td><td>{formatDate(i.plannedDate)}</td><td>{formatNumber(i.daysLate)}</td><td>{i.supervisorName || i.engineerName || '—'}</td></tr>)}</tbody></table></div> : <StateBox>لا توجد زيارات أو تقارير متأخرة.</StateBox>}</section>; }

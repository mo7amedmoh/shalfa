import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Printer, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import { z } from 'zod';
import {
  axisLabel,
  buildPlanReportView,
  filterPlanReportRows,
  rankSupervisorsByLateness,
  rowsForAxisStatus,
  type ReportAxisFilter,
  type ReportPlanRow,
} from '../../domain/planReport';
import { useDisplayFormat } from '../../app/useDisplayFormat';
import { supabase } from '../../lib/supabase';
import { APP_SCHEMA_SELECT } from '../../lib/schemaColumns';

const planHeaderSchema = z.object({
  id: z.string().uuid(),
  plan_type: z.enum(['maintenance', 'cleaning', 'elevators', 'security_safety']),
  month: z.string(),
});
const reportRowSchema = z.object({
  id: z.string().uuid(),
  plan_id: z.string().uuid(),
  school_id: z.string().uuid(),
  planned_date: z.string(),
  visited: z.boolean(),
  visited_date: z.string().nullable(),
  report_done: z.boolean(),
  report_done_date: z.string().nullable(),
  engineer_id: z.string().uuid().nullable(),
  supervisor_id: z.string().uuid().nullable(),
  contractor_name: z.string().nullable(),
  school: z.object({
    name: z.string(),
    ministry_no: z.string(),
    neighbourhood: z.string().nullable(),
  }).nullable(),
});
const reportEmployeeSchema = z.object({ id: z.string().uuid(), full_name: z.string() });
const cleanerSchema = z.object({ school_id: z.string().uuid() });

type DetailDialog = { title: string; rows: ReportPlanRow[] };
type LoadedReport = { current: ReportPlanRow[]; previous: ReportPlanRow[] };

const EMPTY_REPORT_ROWS: ReportPlanRow[] = [];

const axisOptions: Array<{ value: ReportAxisFilter; label: string }> = [
  { value: 'all', label: 'جميع المحاور' },
  { value: 'maintenance', label: 'الصيانة والتكييف' },
  { value: 'cleaning', label: 'النظافة' },
  { value: 'elevators', label: 'المصاعد' },
  { value: 'security_safety', label: 'الأمن والسلامة' },
];

function monthNow(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function responsiblePartyName(row: ReportPlanRow): string {
  const usesExternalCompany = row.planType === 'elevators' || row.planType === 'security_safety';
  return (usesExternalCompany
    ? row.contractorName ?? row.engineerName
    : row.engineerName ?? row.contractorName) ?? 'غير محدد';
}

function todayLocal(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

function previousMonth(month: string): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
}

async function fetchMonthRows(month: string) {
  if (!supabase) throw new Error('إعداد الاتصال بقاعدة البيانات غير مكتمل.');
  const { data: plansData, error: plansError } = await supabase.from('monthly_plans')
    .select(APP_SCHEMA_SELECT.monthlyReportPlanHeaders)
    .eq('month', `${month}-01`);
  if (plansError) throw plansError;
  const plans = z.array(planHeaderSchema).parse(plansData);
  if (!plans.length) return [];
  const { data, error } = await supabase.from('monthly_plan_rows')
    .select(APP_SCHEMA_SELECT.monthlyReportPlanRows)
    .in('plan_id', plans.map(({ id }) => id));
  if (error) throw error;
  return z.array(reportRowSchema).parse(data).map((row) => ({
    ...row,
    planType: plans.find((plan) => plan.id === row.plan_id)!.plan_type,
    month: month.slice(0, 7),
  }));
}

async function loadMonthlyReport(month: string): Promise<LoadedReport> {
  if (!supabase) throw new Error('إعداد الاتصال بقاعدة البيانات غير مكتمل.');
  const prevMonth = previousMonth(month);
  const [currentRaw, previousRaw] = await Promise.all([fetchMonthRows(month), fetchMonthRows(prevMonth)]);
  const allRaw = [...currentRaw, ...previousRaw];
  const employeeIds = [...new Set(allRaw.flatMap((row) => [row.engineer_id, row.supervisor_id].filter((id): id is string => Boolean(id))))];
  const schoolIds = [...new Set(allRaw.map((row) => row.school_id))];
  const [employees, cleanerAssignments] = await Promise.all([
    employeeIds.length
      ? supabase.from('employees').select(APP_SCHEMA_SELECT.reportEmployees).in('id', employeeIds)
      : Promise.resolve({ data: [], error: null }),
    schoolIds.length
      ? supabase.from('cleaner_assignments').select(APP_SCHEMA_SELECT.cleanerAssignmentSchool).in('school_id', schoolIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (employees.error) throw employees.error;
  if (cleanerAssignments.error) throw cleanerAssignments.error;
  const employeeNames = new Map(z.array(reportEmployeeSchema).parse(employees.data).map((employee) => [employee.id, employee.full_name]));
  const schoolWithCleaner = new Set(z.array(cleanerSchema).parse(cleanerAssignments.data).map(({ school_id }) => school_id));
  const mapRows = (rawRows: typeof currentRaw): ReportPlanRow[] => rawRows.map((row) => ({
    id: row.id,
    month: row.month,
    planType: row.planType,
    plannedDate: row.planned_date,
    visited: row.visited,
    visitedDate: row.visited_date,
    reportDone: row.report_done,
    reportCompletedDate: row.report_done_date,
    engineerId: row.engineer_id,
    engineerName: row.engineer_id ? employeeNames.get(row.engineer_id) ?? null : null,
    supervisorId: row.supervisor_id,
    supervisorName: row.supervisor_id ? employeeNames.get(row.supervisor_id) ?? null : null,
    contractorName: row.contractor_name,
    schoolId: row.school_id,
    schoolName: row.school?.name ?? 'مدرسة غير معروفة',
    ministryNumber: row.school?.ministry_no ?? '',
    neighbourhood: row.school?.neighbourhood ?? 'غير محدد',
    hasCleaner: schoolWithCleaner.has(row.school_id),
  }));
  return { current: mapRows(currentRaw), previous: mapRows(previousRaw) };
}

function exportWorkbook(view: ReturnType<typeof buildPlanReportView>, rows: readonly ReportPlanRow[]) {
  const workbook = XLSX.utils.book_new();
  const addSheet = (name: string, values: unknown[][]) =>
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(values), name);
  addSheet('ملخص', [
    ['المؤشر', 'القيمة', 'التغير عن الشهر السابق'],
    ...view.cards.map((card) => [card.label, card.value, card.delta ?? 'غير متاح']),
  ]);
  addSheet('المحاور', [
    ['المحور', 'المخطط', 'الزيارات', 'التقارير', 'المكتمل', 'متأخر الزيارة', 'متأخر التقرير'],
    ...view.axes.map((axis) => [axis.label, axis.planned, axis.visited, axis.reportsDone, axis.completed, axis.lateVisits, axis.lateReports]),
  ]);
  addSheet('التراكمي اليومي', [
    ['التاريخ', 'المخطط التراكمي', 'الزيارات الفعلية التراكمية'],
    ...view.daily.map((day) => [day.date, day.planned, day.actual]),
  ]);
  addSheet('المشرفون', [
    ['المشرف', 'المخطط', 'الزيارات %', 'التقارير %', 'الاكتمال %', 'زيارات متأخرة', 'تقارير متأخرة', 'درجة الالتزام'],
    ...view.supervisors.map((supervisor) => [
      supervisor.name, supervisor.planned, supervisor.visitPercent, supervisor.reportPercent,
      supervisor.completionPercent, supervisor.lateVisits, supervisor.lateReports, supervisor.complianceScore,
    ]),
  ]);
  addSheet('المتابعة المتأخرة', [
    ['المدرسة', 'الرقم الوزاري', 'المحور', 'نوع التأخير', 'التاريخ المخطط', 'الأيام', 'الشريحة', 'المشرف', 'المهندس/المقاول', 'الحي'],
    ...view.lateItems.map((item) => [
      item.schoolName, item.ministryNumber, item.axis, item.kind === 'visit' ? 'زيارة' : 'تقرير',
      item.plannedDate, item.daysLate, item.agingBucket, item.supervisorName, item.engineerName, item.neighbourhood,
    ]),
  ]);
  addSheet('الأحياء', [
    ['الحي', 'المخطط', 'الزيارات', 'التقارير', 'المكتمل', 'المتأخر', 'الاكتمال %'],
    ...view.neighbourhoods.map((item) => [item.label, item.planned, item.visited, item.reportsDone, item.completed, item.late, item.completionPercent]),
  ]);
  addSheet('المهندسون والمقاولون', [
    ['المهندس/المقاول', 'المخطط', 'الزيارات', 'التقارير', 'المكتمل', 'المتأخر', 'الاكتمال %'],
    ...view.engineers.map((item) => [item.label, item.planned, item.visited, item.reportsDone, item.completed, item.late, item.completionPercent]),
  ]);
  addSheet('جودة البيانات', [
    ['نوع الملاحظة', 'عدد الصفوف'],
    ['دون مشرف', view.quality.missingSupervisor.length],
    ['دون تاريخ مخطط', view.quality.missingPlannedDate.length],
    ['تقرير دون زيارة', view.quality.reportWithoutVisit.length],
    ['تاريخ زيارة أسبق من المخطط بسبعة أيام فأكثر', view.quality.visitDateBeforePlan.length],
    ['مدرسة دون عامل نظافة مسكن', view.quality.schoolsWithoutCleaners.length],
  ]);
  addSheet('صفوف الخطة', [
    ['المدرسة', 'الرقم الوزاري', 'المحور', 'التاريخ المخطط', 'الزيارة', 'تاريخ الزيارة', 'التقرير', 'تاريخ التقرير', 'المشرف', 'المهندس/المقاول', 'الحي'],
    ...rows.map((row) => [
      row.schoolName, row.ministryNumber, axisLabel(row.planType), row.plannedDate,
      row.visited ? 'منفذة' : 'غير منفذة', row.visitedDate ?? '',
      row.reportDone ? 'منجز' : 'غير منجز', row.reportCompletedDate ?? '',
      row.supervisorName ?? '', responsiblePartyName(row), row.neighbourhood,
    ]),
  ]);
  XLSX.writeFile(workbook, 'التقرير-العام-للخطط-الشهرية.xlsx');
}

function metricCardTone(status: 'positive' | 'warning' | 'neutral'): string {
  if (status === 'positive') return 'border-emerald-200 bg-emerald-50';
  if (status === 'warning') return 'border-amber-200 bg-amber-50';
  return 'border-slate-200 bg-white';
}

export function MonthlyReportPage() {
  const { formatNumber, formatDate } = useDisplayFormat();
  const [month, setMonth] = useState(monthNow);
  const [asOf, setAsOf] = useState(todayLocal);
  const [axis, setAxis] = useState<ReportAxisFilter>('all');
  const [engineerId, setEngineerId] = useState('');
  const [supervisorId, setSupervisorId] = useState('');
  const [neighbourhood, setNeighbourhood] = useState('');
  const [generatedAt, setGeneratedAt] = useState('');
  const [detail, setDetail] = useState<DetailDialog | null>(null);
  const report = useQuery({ queryKey: ['monthly-report', month], queryFn: () => loadMonthlyReport(month) });
  const rows = report.data?.current ?? EMPTY_REPORT_ROWS;
  const filteredRows = useMemo(() => filterPlanReportRows(rows, {
    month, axis, engineerId, supervisorId, neighbourhood,
  }), [rows, month, axis, engineerId, supervisorId, neighbourhood]);
  const axisRows = useMemo(() => filterPlanReportRows(rows, {
    month, axis: 'all', engineerId, supervisorId, neighbourhood,
  }), [rows, month, engineerId, supervisorId, neighbourhood]);
  const previousRows = useMemo(() => filterPlanReportRows(report.data?.previous ?? [], {
    month: previousMonth(month), axis, engineerId, supervisorId, neighbourhood,
  }), [report.data, month, axis, engineerId, supervisorId, neighbourhood]);
  const view = useMemo(() => buildPlanReportView(filteredRows, month, asOf, previousRows), [filteredRows, month, asOf, previousRows]);
  const axisView = useMemo(() => buildPlanReportView(axisRows, month, asOf), [axisRows, month, asOf]);
  const engineers = useMemo(() => [...new Map(rows
    .filter((row) => row.engineerId)
    .map((row) => [row.engineerId!, { id: row.engineerId!, name: row.engineerName ?? 'مهندس غير محدد' }])).values()]
    .sort((left, right) => left.name.localeCompare(right.name, 'ar')), [rows]);
  const supervisors = useMemo(() => [...new Map(rows
    .filter((row) => row.supervisorId && (row.planType === 'maintenance' || row.planType === 'cleaning'))
    .map((row) => [row.supervisorId!, { id: row.supervisorId!, name: row.supervisorName ?? 'مشرف غير محدد' }])).values()]
    .sort((left, right) => left.name.localeCompare(right.name, 'ar')), [rows]);
  const neighbourhoods = useMemo(() => [...new Set(rows.map((row) => row.neighbourhood))]
    .sort((left, right) => left.localeCompare(right, 'ar')), [rows]);
  const activeFilters = [
    `الشهر: ${month}`,
    `كما في: ${formatDate(asOf)}`,
    `المحور: ${axisOptions.find((option) => option.value === axis)?.label ?? axis}`,
    `المهندس: ${engineers.find((item) => item.id === engineerId)?.name ?? 'الكل'}`,
    `المشرف: ${supervisors.find((item) => item.id === supervisorId)?.name ?? 'الكل'}`,
    `الحي: ${neighbourhood || 'الكل'}`,
  ];
  const summaryText = `حتى ${formatDate(asOf)} أُنجز ${formatNumber(view.metrics.visitPercent.toFixed(1))}% من الزيارات المخططة مقابل ${formatNumber(view.metrics.expectedPercent.toFixed(1))}% المتوقع، بفارق ${formatNumber(view.metrics.visitGap)} زيارة؛ واكتمل ${formatNumber(view.metrics.completionPercent.toFixed(1))}% من الزيارات والتقارير معاً.`;
  const supervisorLateRank = useMemo(() => rankSupervisorsByLateness(view.supervisors), [view.supervisors]);
  const visibleAxes = axis === 'all' ? axisView.axes : axisView.axes.filter((item) => item.axis === axis);

  function showAxisDetail(axisId: typeof view.axes[number]['axis'], status: Parameters<typeof rowsForAxisStatus>[2], title: string) {
    setDetail({ title, rows: rowsForAxisStatus(axisRows, axisId, status, asOf) });
  }

  function printReport() {
    setGeneratedAt(new Date().toLocaleString('ar-SA'));
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => window.print()));
  }

  return (
    <div className="monthly-report-print grid min-w-0 grid-cols-1 gap-5">
      <section className="no-print flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">مؤشرات الزيارة وإنجاز التقارير ومتابعة المشرفين</p>
          <h2 className="mt-1 text-2xl font-bold text-brand-900">التقرير العام</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => exportWorkbook(view, filteredRows)} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold">
            <Download size={16} /> تصدير Excel
          </button>
          <button type="button" onClick={printReport} className="inline-flex items-center gap-2 rounded-lg bg-brand-700 px-4 py-2 text-sm font-bold text-white">
            <Printer size={16} /> تصدير PDF / طباعة
          </button>
        </div>
      </section>

      <header className="print-only report-keep border-b border-slate-300 pb-3">
        <div className="flex items-center justify-between gap-4">
          <img src="/brand/logo.png" alt="شلفا لإدارة المرافق" className="h-12 w-auto" />
          <div className="text-end">
            <h2 className="text-xl font-bold">التقرير العام للخطط الشهرية</h2>
            <p className="mt-1 text-sm">تاريخ الإنشاء: {generatedAt}</p>
          </div>
        </div>
        <p className="mt-2 text-sm">تاريخ التقرير: {formatDate(asOf)} · الشهر: {month}</p>
        <p className="text-xs leading-6">{activeFilters.join(' · ')}</p>
      </header>

      <section className="no-print card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="grid gap-1 text-sm font-semibold">الشهر
          <input type="month" value={month} onChange={(event) => setMonth(event.target.value || monthNow())} className="rounded-lg border border-slate-300 px-3 py-2" />
        </label>
        <label className="grid gap-1 text-sm font-semibold">كما في
          <input type="date" value={asOf} onChange={(event) => { if (event.target.value) setAsOf(event.target.value); }} className="rounded-lg border border-slate-300 px-3 py-2" />
        </label>
        <label className="grid gap-1 text-sm font-semibold">المحور
          <select value={axis} onChange={(event) => setAxis(event.target.value as ReportAxisFilter)} className="rounded-lg border border-slate-300 px-3 py-2">
            {axisOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold">المهندس
          <select value={engineerId} onChange={(event) => setEngineerId(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2">
            <option value="">جميع المهندسين</option>
            {engineers.map((engineer) => <option key={engineer.id} value={engineer.id}>{engineer.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold">المشرف
          <select value={supervisorId} onChange={(event) => setSupervisorId(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2">
            <option value="">جميع المشرفين</option>
            {supervisors.map((supervisor) => <option key={supervisor.id} value={supervisor.id}>{supervisor.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold">الحي
          <select value={neighbourhood} onChange={(event) => setNeighbourhood(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2">
            <option value="">جميع الأحياء</option>
            {neighbourhoods.map((area) => <option key={area} value={area}>{area}</option>)}
          </select>
        </label>
      </section>

      {report.error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">تعذر تحميل التقرير: {report.error.message}</div>}
      {report.isLoading && <p role="status" className="card p-5 text-center">جارٍ تحميل التقرير…</p>}
      {!report.isLoading && !report.error && !rows.length && <p className="card p-5 text-center text-sm text-slate-500">لا توجد خطط شهرية مسجلة لهذا الشهر.</p>}

      {!report.isLoading && !report.error && rows.length > 0 && <>
        <section className="report-keep grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {view.cards.map((card) => (
            <article key={card.key} className={`card border p-4 ${metricCardTone(card.status)}`}>
              <p className="text-xs text-slate-600">{card.label}</p>
              <p className="mt-1 text-2xl font-bold text-brand-900">
                {formatNumber(card.value.toFixed(card.unit === 'percent' ? 1 : 0))}{card.unit === 'percent' ? '%' : ''}
              </p>
              <p className="mt-1 text-xs text-slate-600">
                {card.delta === null
                  ? 'لا تتوفر مقارنة للشهر السابق'
                  : `التغير عن اليوم المناظر من الشهر السابق: ${card.delta > 0 ? '+' : ''}${formatNumber(card.delta.toFixed(card.unit === 'percent' ? 1 : 0))}${card.unit === 'percent' ? ' نقطة مئوية' : ''}`}
              </p>
            </article>
          ))}
        </section>

        <section className="report-keep card border-s-4 border-brand-600 p-4">
          <h3 className="font-bold">الملخص التنفيذي</h3>
          <p className="mt-2 text-sm leading-7">{summaryText}</p>
        </section>

        <section className="report-keep card grid gap-4 p-4 sm:grid-cols-3">
          <div><p className="text-xs text-slate-500">المتوقع حتى تاريخ التقرير</p><p className="mt-1 text-xl font-bold">{formatNumber(view.metrics.expectedPercent.toFixed(1))}%</p></div>
          <div><p className="text-xs text-slate-500">المنفذ فعلياً</p><p className="mt-1 text-xl font-bold">{formatNumber(view.metrics.visitPercent.toFixed(1))}% · {formatNumber(view.metrics.visited)} من {formatNumber(view.metrics.planned)}</p></div>
          <div>
            <p className="text-xs text-slate-500">الفارق عن المتوقع</p>
            <p className="mt-1 text-xl font-bold">{formatNumber(view.metrics.visitGap)} زيارة</p>
            <span className={`mt-1 inline-flex rounded-full px-3 py-1 text-xs font-bold ${view.metrics.paceStatus === 'ahead' ? 'bg-emerald-100 text-emerald-800' : view.metrics.paceStatus === 'behind' ? 'bg-rose-100 text-rose-800' : view.metrics.paceStatus === 'no_plan' ? 'bg-slate-100 text-slate-700' : 'bg-sky-100 text-sky-800'}`}>
              {view.metrics.paceStatus === 'ahead' ? 'متقدم' : view.metrics.paceStatus === 'behind' ? 'متأخر' : view.metrics.paceStatus === 'no_plan' ? 'لا توجد خطة' : 'وفق الخطة'}
            </span>
          </div>
        </section>

        <section className="report-keep card grid gap-4 p-4">
          <div>
            <h3 className="font-bold">ملخص المحاور وحالة الزيارات والتقارير</h3>
            <p className="mt-1 text-xs text-slate-500">اختر أي شريحة أو رقم لعرض المدارس الداخلة في الحساب.</p>
          </div>
          <div className="table-scroll">
            <table className="min-w-[900px]">
              <thead><tr><th>المحور</th><th>المخطط</th><th>الزيارات / الحالات</th><th>التقارير / الحالات</th><th>الاكتمال</th></tr></thead>
              <tbody>{visibleAxes.map((item) => <tr key={item.axis}>
                <th scope="row" className="text-start">{item.label}</th>
                <td><button type="button" onClick={() => setDetail({ title: `${item.label} · جميع المدارس`, rows: axisRows.filter((row) => row.planType === item.axis) })} className="font-bold underline">{formatNumber(item.planned)}</button></td>
                <td>
                  <StackedStatusBar stack={item.visitStack} labels={['زيارات منفذة', 'زيارات بانتظار موعدها', 'زيارات متأخرة']} onSelect={(index) => showAxisDetail(item.axis, (['visit-done', 'visit-pending', 'visit-late'] as const)[index], `${item.label} · الزيارات`)} />
                  <p className="mt-1 text-xs">منفذ {formatNumber(item.visited)} · {formatNumber(item.visitPercent.toFixed(1))}%</p>
                </td>
                <td>
                  <StackedStatusBar stack={item.reportStack} labels={['تقارير منجزة', 'تقارير مستحقة بنهاية الشهر', 'تقارير متأخرة']} onSelect={(index) => showAxisDetail(item.axis, (['report-done', 'report-pending', 'report-late'] as const)[index], `${item.label} · التقارير`)} />
                  <p className="mt-1 text-xs">منجز {formatNumber(item.reportsDone)} · {formatNumber(item.reportPercent.toFixed(1))}%</p>
                </td>
                <td><button type="button" onClick={() => setDetail({ title: `${item.label} · الزيارات والتقارير المكتملة`, rows: axisRows.filter((row) => row.planType === item.axis && row.visited && row.reportDone) })} className="font-bold underline">{formatNumber(item.completed)} · {formatNumber(item.completionPercent.toFixed(1))}%</button></td>
              </tr>)}</tbody>
            </table>
          </div>
          <p className={`rounded-lg p-3 text-sm ${view.metrics.reportRisk === 'high' ? 'bg-rose-50 text-rose-800' : 'bg-sky-50 text-sky-900'}`}>
            {view.metrics.reportsDueByMonthEnd
              ? `تقارير مستحقة بنهاية الشهر: ${formatNumber(view.metrics.reportsDueByMonthEnd)} · أيام العمل الباقية: ${formatNumber(view.metrics.workingDaysLeft)} · ${view.metrics.reportRisk === 'high' ? 'مؤشر خطر: عدد التقارير المتبقية يتجاوز أيام العمل' : 'ضمن أيام العمل الباقية'}`
              : 'لا توجد تقارير متأخرة حالياً؛ يصبح التقرير متأخراً بعد نهاية شهر الخطة.'}
          </p>
        </section>

        <section className="report-keep card grid gap-4 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div><h3 className="font-bold">الإنجاز التراكمي: المخطط مقابل الزيارات الفعلية</h3><p className="mt-1 text-xs text-slate-500">يشير الإطار الكهرماني إلى تاريخ التقرير.</p></div>
            <p className="text-sm font-bold">توقع نهاية الشهر (تقديري): {view.forecast.estimate === null ? 'غير متاح قبل أول يوم عمل' : `${formatNumber(view.forecast.estimate)} من ${formatNumber(view.forecast.total)}`}</p>
          </div>
          <div className="table-scroll">
            <table className="min-w-[760px]">
              <thead><tr><th>اليوم</th><th>المخطط التراكمي</th><th>الزيارات الفعلية التراكمية</th><th>الرسم</th></tr></thead>
              <tbody>{view.daily.map((day) => <tr key={day.date} className={day.isAsOfDate ? 'bg-amber-50' : ''}>
                <th scope="row" className="text-start">{formatDate(day.date)}{day.isAsOfDate ? ' · كما في' : ''}</th>
                <td>{formatNumber(day.planned)}</td><td>{formatNumber(day.actual)}</td>
                <td><div className="grid min-w-48 gap-1" aria-hidden="true">
                  <div className="h-2 rounded bg-slate-200"><div className="h-full rounded bg-slate-400" style={{ width: `${day.plannedWidth}%` }} /></div>
                  <div className="h-2 rounded bg-slate-100"><div className="h-full rounded bg-brand-700" style={{ width: `${day.actualWidth}%` }} /></div>
                </div></td>
              </tr>)}</tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">التوقع تقدير خطي من الزيارات المسجلة حتى التاريخ نسبةً إلى أيام العمل المنقضية، ومحدود بإجمالي الزيارات المخططة.</p>
        </section>

        {(axis === 'all' || axis === 'maintenance' || axis === 'cleaning') && <SupervisorSection
          supervisors={view.supervisors}
          lateRank={supervisorLateRank}
          formatNumber={formatNumber}
          formatDate={formatDate}
        />}

        <section className="grid min-w-0 gap-4 lg:grid-cols-2">
          <BreakdownSection title="الأحياء" rows={view.neighbourhoods} formatNumber={formatNumber} />
          <BreakdownSection title="المهندسون / المقاولون" rows={view.engineers} formatNumber={formatNumber} />
        </section>

        <section className="report-keep card grid gap-3 p-4">
          <h3 className="font-bold">جودة البيانات والعمالة</h3>
          <QualityRow label="صفوف دون مشرف" rows={view.quality.missingSupervisor} onClick={() => setDetail({ title: 'صفوف دون مشرف', rows: view.quality.missingSupervisor })} formatNumber={formatNumber} />
          <QualityRow label="صفوف دون تاريخ مخطط" rows={view.quality.missingPlannedDate} onClick={() => setDetail({ title: 'صفوف دون تاريخ مخطط', rows: view.quality.missingPlannedDate })} formatNumber={formatNumber} />
          <QualityRow label="تقرير منجز دون زيارة" rows={view.quality.reportWithoutVisit} onClick={() => setDetail({ title: 'تقرير منجز دون زيارة', rows: view.quality.reportWithoutVisit })} formatNumber={formatNumber} />
          <QualityRow label="تاريخ الزيارة أسبق من المخطط بسبعة أيام أو أكثر" rows={view.quality.visitDateBeforePlan} onClick={() => setDetail({ title: 'تاريخ الزيارة أسبق من المخطط بسبعة أيام أو أكثر', rows: view.quality.visitDateBeforePlan })} formatNumber={formatNumber} />
          <QualityRow label="مدارس الصيانة والنظافة دون عامل نظافة مسكن" rows={view.quality.schoolsWithoutCleaners} onClick={() => setDetail({ title: 'مدارس دون عامل نظافة مسكن', rows: view.quality.schoolsWithoutCleaners })} formatNumber={formatNumber} />
        </section>

        <section className="report-keep card grid gap-3 p-4">
          <div><h3 className="font-bold">متابعة العناصر المتأخرة</h3><p className="mt-1 text-xs text-slate-500">يصدر التأخير لكل زيارة أو تقرير على حدة؛ تقارير الشهر لا تتأخر قبل انقضاء الشهر.</p></div>
          <div className="grid gap-2 sm:grid-cols-3">
            {(['1–2', '3–5', '6+'] as const).map((bucket) => <p key={bucket} className="rounded-lg bg-slate-50 p-3 text-sm">تأخير {bucket} يوم: <strong>{formatNumber(view.aging[bucket])}</strong></p>)}
          </div>
          {view.lateItems.length ? <div className="table-scroll"><table className="min-w-[900px]">
            <thead><tr><th>المدرسة</th><th>الرقم الوزاري</th><th>المحور / العنصر</th><th>التاريخ المخطط</th><th>الأيام</th><th>المشرف</th><th>المهندس / المقاول</th><th>الحي</th></tr></thead>
            <tbody>{view.lateItems.map((item) => <tr key={item.id}>
              <td>{item.schoolName}</td><td>{item.ministryNumber}</td>
              <td>{item.axis} · {item.kind === 'visit' ? 'زيارة' : 'تقرير'}</td>
              <td>{formatDate(item.plannedDate)}</td><td>{formatNumber(item.daysLate)}</td>
              <td>{item.supervisorName}</td><td>{item.engineerName}</td><td>{item.neighbourhood}</td>
            </tr>)}</tbody>
          </table></div> : <p className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">لا توجد زيارات أو تقارير متأخرة ضمن المرشحات الحالية.</p>}
        </section>
      </>}

      {detail && <div className="no-print fixed inset-0 z-[1000] overflow-y-auto bg-slate-950/50 p-3 sm:p-8" role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setDetail(null);
      }}>
        <section role="dialog" aria-modal="true" aria-labelledby="report-details-title" className="mx-auto grid max-w-5xl gap-4 rounded-2xl bg-white p-5 shadow-2xl">
          <header className="flex items-center justify-between gap-3">
            <div><h3 id="report-details-title" className="text-lg font-bold">{detail.title}</h3><p className="text-sm text-slate-500">عدد الصفوف: {formatNumber(detail.rows.length)}</p></div>
            <button type="button" onClick={() => setDetail(null)} aria-label="إغلاق" className="rounded-lg p-2 hover:bg-slate-100"><X size={20} /></button>
          </header>
          {!detail.rows.length ? <p className="rounded-lg bg-slate-50 p-4 text-sm">لا توجد مدارس لهذه الحالة.</p> : <div className="table-scroll">
            <table className="min-w-[800px]"><thead><tr><th>المدرسة</th><th>الرقم الوزاري</th><th>المحور</th><th>التاريخ المخطط</th><th>المشرف</th><th>المهندس / المقاول</th><th>الحي</th></tr></thead>
              <tbody>{detail.rows.map((row) => <tr key={row.id}><td>{row.schoolName}</td><td>{row.ministryNumber}</td><td>{axisLabel(row.planType)}</td><td>{formatDate(row.plannedDate)}</td><td>{row.planType === 'elevators' || row.planType === 'security_safety' ? '—' : row.supervisorName ?? 'غير محدد'}</td><td>{responsiblePartyName(row)}</td><td>{row.neighbourhood}</td></tr>)}</tbody>
            </table>
          </div>}
        </section>
      </div>}
    </div>
  );
}

function StackedStatusBar({ stack, labels, onSelect }: {
  stack: { done: number; pending: number; late: number; donePercent: number; pendingPercent: number; latePercent: number };
  labels: [string, string, string];
  onSelect: (index: number) => void;
}) {
  const segments = [
    { value: stack.done, width: stack.donePercent, color: 'bg-emerald-600', label: labels[0] },
    { value: stack.pending, width: stack.pendingPercent, color: 'bg-sky-500', label: labels[1] },
    { value: stack.late, width: stack.latePercent, color: 'bg-rose-600', label: labels[2] },
  ];
  return <div className="grid min-w-52 gap-1">
    <div className="flex h-5 overflow-hidden rounded bg-slate-100" role="group" aria-label="شرائح حالة الإنجاز">
      {segments.map((segment, index) => <button key={segment.label} type="button" title={`${segment.label}: ${segment.value}`} aria-label={`${segment.label}: ${segment.value}`} onClick={() => onSelect(index)} className={`${segment.color} min-w-0 border-e border-white/60 text-[10px] font-bold text-white`} style={{ flexBasis: `${segment.width}%` }}>
        {segment.width > 12 ? segment.value : ''}
      </button>)}
    </div>
    <div className="flex flex-wrap gap-x-3 text-[10px] text-slate-600">{segments.map((segment) => <span key={segment.label}>{segment.label}: {segment.value}</span>)}</div>
  </div>;
}

function SupervisorSection({ supervisors, lateRank, formatNumber, formatDate }: {
  supervisors: ReturnType<typeof buildPlanReportView>['supervisors'];
  lateRank: ReturnType<typeof buildPlanReportView>['supervisors'];
  formatNumber: (value: string | number) => string;
  formatDate: (value: string) => string;
}) {
  return <section className="report-keep card grid gap-4 p-4">
    <div><h3 className="font-bold">أداء المشرفين · الصيانة والنظافة</h3><p className="mt-1 text-xs text-slate-500">درجة الالتزام: 50% اكتمال + 25% زيارات + 25% تقارير.</p></div>
    <div className="grid gap-4 md:grid-cols-2">
      <RankingList title="الأكثر التزاماً" rows={supervisors.slice(0, 5)} formatNumber={formatNumber} />
      <RankingList title="الأكثر تأخراً" rows={lateRank.slice(0, 5)} formatNumber={formatNumber} />
    </div>
    <div className="table-scroll">
      <table className="min-w-[1100px]">
        <thead><tr><th>المشرف</th><th>الزيارات %</th><th>التقارير %</th><th>الاكتمال %</th><th>زيارات متأخرة</th><th>تقارير متأخرة</th><th>درجة الالتزام</th></tr></thead>
        <tbody>{supervisors.map((item) => <tr key={item.id}>
          <th scope="row" className="text-start">{item.name}</th>
          <td>{formatNumber(item.visitPercent.toFixed(1))}%</td><td>{formatNumber(item.reportPercent.toFixed(1))}%</td>
          <td>{formatNumber(item.completionPercent.toFixed(1))}%</td><td>{formatNumber(item.lateVisits)}</td>
          <td>{formatNumber(item.lateReports)}</td><td className={item.complianceScore >= 80 ? 'bg-emerald-50 font-bold' : item.complianceScore < 50 ? 'bg-rose-50 font-bold' : 'bg-amber-50 font-bold'}>{formatNumber(item.complianceScore.toFixed(1))}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <div>
      <h4 className="font-semibold">مصفوفة إنجاز المشرف × اليوم</h4>
      <p className="mt-1 text-xs text-slate-500">الخلية تعرض الزيارات المخططة لذلك اليوم. الأحمر: متأخر، الأخضر: مكتمل زيارةً وتقريراً، الأزرق: مستحق/قيد الإجراء.</p>
      <div className="table-scroll mt-2">
        <table className="supervisor-heatmap min-w-[1200px]">
          <thead><tr><th>المشرف</th>{supervisors[0]?.daily.map((day) => <th key={day.date}>{day.date.slice(-2)}</th>)}</tr></thead>
          <tbody>{supervisors.map((item) => <tr key={item.id}>
            <th scope="row" className="text-start">{item.name}</th>
            {item.daily.map((day) => <td key={day.date} title={`${formatDate(day.date)} · مخطط: ${day.planned} · منفذ: ${day.actual} · ${day.state}`} className={day.state === 'late' ? 'bg-rose-100 text-rose-900' : day.state === 'done' ? 'bg-emerald-100 text-emerald-900' : 'bg-sky-50 text-sky-900'}>
              {day.planned ? `${day.actual}/${day.planned}` : '·'}
            </td>)}
          </tr>)}</tbody>
        </table>
      </div>
    </div>
    <div>
      <h4 className="font-semibold">مخططات صغيرة لكل مشرف · المخطط مقابل الزيارات الفعلية يومياً</h4>
      <div className="mt-2 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {supervisors.map((item) => <details key={item.id} className="rounded-lg border border-slate-200 p-3">
          <summary className="cursor-pointer text-sm font-semibold">{item.name}</summary>
          <div className="table-scroll mt-2">
            <table className="min-w-[620px] text-xs"><thead><tr><th>اليوم</th><th>المخطط</th><th>المنفذ</th><th>الرسم</th></tr></thead>
              <tbody>{item.daily.map((day) => <tr key={day.date}>
                <th scope="row" className="text-start">{day.date.slice(-2)}</th><td>{day.planned}</td><td>{day.actual}</td>
                <td><div className="grid min-w-40 gap-1" aria-hidden="true">
                  <div className="h-2 rounded bg-slate-200"><div className="h-full rounded bg-slate-500" style={{ width: `${day.plannedWidth}%` }} /></div>
                  <div className="h-2 rounded bg-slate-100"><div className="h-full rounded bg-brand-700" style={{ width: `${day.actualWidth}%` }} /></div>
                </div></td>
              </tr>)}</tbody>
            </table>
          </div>
        </details>)}
      </div>
    </div>
  </section>;
}

function RankingList({ title, rows, formatNumber }: {
  title: string;
  rows: ReturnType<typeof buildPlanReportView>['supervisors'];
  formatNumber: (value: string | number) => string;
}) {
  return <div className="rounded-lg bg-slate-50 p-3">
    <h4 className="text-sm font-bold">{title}</h4>
    {rows.length ? <ol className="mt-2 grid gap-1 text-sm">{rows.map((row, index) =>
      <li key={row.id} className="flex justify-between gap-2"><span>{formatNumber(index + 1)}. {row.name}</span><span>{formatNumber(row.complianceScore.toFixed(1))}</span></li>,
    )}</ol> : <p className="mt-2 text-sm text-slate-500">لا توجد سجلات مشرفين ضمن المرشحات.</p>}
  </div>;
}

function BreakdownSection({ title, rows, formatNumber }: {
  title: string;
  rows: ReturnType<typeof buildPlanReportView>['neighbourhoods'];
  formatNumber: (value: string | number) => string;
}) {
  const best = rows.slice(0, 5);
  const worst = rows.slice(-5).reverse();
  return <section className="report-keep card grid gap-3 p-4">
    <h3 className="font-bold">التوزيع حسب {title}</h3>
    {!rows.length ? <p className="text-sm text-slate-500">لا توجد بيانات ضمن المرشحات.</p> : <>
      <BreakdownTable title="الأفضل إنجازاً" rows={best} formatNumber={formatNumber} />
      <BreakdownTable title="الأقل إنجازاً" rows={worst} formatNumber={formatNumber} />
    </>}
  </section>;
}

function BreakdownTable({ title, rows, formatNumber }: {
  title: string;
  rows: ReturnType<typeof buildPlanReportView>['neighbourhoods'];
  formatNumber: (value: string | number) => string;
}) {
  return <div><h4 className="text-sm font-semibold">{title}</h4><div className="table-scroll mt-1">
    <table className="min-w-[440px] text-xs"><thead><tr><th>الاسم</th><th>المخطط</th><th>الزيارات</th><th>التقارير</th><th>المكتمل</th><th>الاكتمال</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.id}><th scope="row" className="text-start">{row.label}</th><td>{formatNumber(row.planned)}</td><td>{formatNumber(row.visited)}</td><td>{formatNumber(row.reportsDone)}</td><td>{formatNumber(row.completed)}</td><td>{formatNumber(row.completionPercent.toFixed(1))}%</td></tr>)}</tbody>
    </table>
  </div></div>;
}

function QualityRow({ label, rows, onClick, formatNumber }: {
  label: string;
  rows: readonly ReportPlanRow[];
  onClick: () => void;
  formatNumber: (value: string | number) => string;
}) {
  return <button type="button" onClick={onClick} className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-start text-sm hover:bg-slate-50">
    <span>{label}</span><strong>{formatNumber(rows.length)}</strong>
  </button>;
}

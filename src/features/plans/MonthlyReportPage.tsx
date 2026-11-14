import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Download, Printer, Settings, X } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { buildPlanReportView, filterPlanReportActionRows, filterPlanReportRows, type ReportActionFilter, type ReportAxisFilter, type ReportPlanRow } from '../../domain/planReport';
import { useDisplayFormat } from '../../app/useDisplayFormat';
import { supabase } from '../../lib/supabase';
import { APP_SCHEMA_SELECT } from '../../lib/schemaColumns';
import { loadXlsx } from '../../lib/xlsx';
import { exportReportPdf } from '../../lib/reportPdf';
import { useReportData } from './reportData';
import { defaultReportLayout, getReportLayout, normalizeReportLayout, reportSections, type ReportLayoutItem } from './reportSections';

const planHeaderSchema = z.object({ id: z.string().uuid(), plan_type: z.enum(['maintenance', 'cleaning', 'elevators', 'security_safety']), month: z.string(), late_by_planned_date: z.boolean() });
const reportRowSchema = z.object({
  id: z.string().uuid(), plan_id: z.string().uuid(), school_id: z.string().uuid(), planned_date: z.string(), updated_at: z.string().nullable().optional(), visited: z.boolean(), visited_date: z.string().nullable(), report_done: z.boolean(), report_done_date: z.string().nullable(),
  engineer_id: z.string().uuid().nullable(), engineer_name: z.string().nullable(), supervisor_id: z.string().uuid().nullable(), supervisor_name: z.string().nullable(), contractor_name: z.string().nullable(),
  school: z.object({ name: z.string(), ministry_no: z.string(), neighbourhood: z.string().nullable() }).nullable(),
});
const employeeSchema = z.object({ id: z.string().uuid(), full_name: z.string() });
const cleanerSchema = z.object({ school_id: z.string().uuid() });
type LoadedReport = { current: ReportPlanRow[]; previous: ReportPlanRow[] };
const axes = [
  { value: 'maintenance', label: 'الصيانة والتكييف' }, { value: 'cleaning', label: 'النظافة' },
  { value: 'elevators', label: 'المصاعد' }, { value: 'security_safety', label: 'الأمن والسلامة' },
] as const;
const axisOptions: Array<{ value: ReportAxisFilter; label: string }> = [{ value: 'all', label: 'جميع الخدمات' }, ...axes];
const EMPTY_ROWS: ReportPlanRow[] = [];

function monthNow() { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; }
function todayLocal() { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function previousMonth(month: string) { const date = new Date(`${month}-01T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() - 1); return date.toISOString().slice(0, 7); }
function initialReportMonth(value: string | null): string {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return monthNow();
  const parsed = new Date(`${value}-01T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 7) === value ? value : monthNow();
}
function initialReportAxis(value: string | null): ReportAxisFilter {
  return value === 'maintenance' || value === 'cleaning' || value === 'elevators' || value === 'security_safety'
    ? value
    : 'all';
}
function reportActionFilter(value: string | null): ReportActionFilter {
  return value === 'late-visits' || value === 'visit-no-report' || value === 'below-expected' ? value : null;
}

async function fetchMonthRows(month: string): Promise<ReportPlanRow[]> {
  if (!supabase) throw new Error('إعداد الاتصال بقاعدة البيانات غير مكتمل.');
  const { data: plansData, error: plansError } = await supabase.from('monthly_plans').select(APP_SCHEMA_SELECT.monthlyReportPlanHeaders).eq('month', `${month}-01`);
  if (plansError) throw plansError;
  const plans = z.array(planHeaderSchema).parse(plansData);
  if (!plans.length) return [];
  const { data, error } = await supabase.from('monthly_plan_rows').select(APP_SCHEMA_SELECT.monthlyReportPlanRows).in('plan_id', plans.map((plan) => plan.id));
  if (error) throw error;
  const rows = z.array(reportRowSchema).parse(data);
  const ids = [...new Set(rows.flatMap((row) => [row.engineer_id, row.supervisor_id].filter((id): id is string => Boolean(id))))];
  const schoolIds = [...new Set(rows.map((row) => row.school_id))];
  const [employees, cleaners] = await Promise.all([
    ids.length ? supabase.from('employees').select(APP_SCHEMA_SELECT.reportEmployees).in('id', ids) : Promise.resolve({ data: [], error: null }),
    schoolIds.length ? supabase.from('cleaner_assignments').select(APP_SCHEMA_SELECT.cleanerAssignmentSchool).in('school_id', schoolIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (employees.error) throw employees.error;
  if (cleaners.error) throw cleaners.error;
  const names = new Map(z.array(employeeSchema).parse(employees.data).map((employee) => [employee.id, employee.full_name]));
  const cleanerIds = new Set(z.array(cleanerSchema).parse(cleaners.data).map((row) => row.school_id));
  return rows.map((row) => ({
    id: row.id, planId: row.plan_id, lateByPlannedDate: plans.find((plan) => plan.id === row.plan_id)!.late_by_planned_date, month, planType: plans.find((plan) => plan.id === row.plan_id)!.plan_type, plannedDate: row.planned_date, visited: row.visited, visitedDate: row.visited_date, reportDone: row.report_done, reportCompletedDate: row.report_done_date, updatedAt: row.updated_at ?? null,
    engineerId: row.engineer_id, engineerName: row.engineer_id ? names.get(row.engineer_id) ?? row.engineer_name : row.engineer_name, supervisorId: row.supervisor_id, supervisorName: row.supervisor_id ? names.get(row.supervisor_id) ?? row.supervisor_name : row.supervisor_name, contractorName: row.contractor_name,
    schoolId: row.school_id, schoolName: row.school?.name ?? 'مدرسة غير معروفة', ministryNumber: row.school?.ministry_no ?? '', neighbourhood: row.school?.neighbourhood ?? 'غير محدد', hasCleaner: cleanerIds.has(row.school_id),
  }));
}
async function loadReport(month: string): Promise<LoadedReport> {
  const [current, previous] = await Promise.all([fetchMonthRows(month), fetchMonthRows(previousMonth(month))]);
  return { current, previous };
}
async function exportWorkbook(view: ReturnType<typeof buildPlanReportView>) {
  const XLSX = await loadXlsx();
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['المؤشر', 'القيمة'], ...view.cards.map((card) => [card.label, card.value])]), 'ملخص');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['الخدمة', 'المخطط', 'تمت الزيارة', 'تم الرفع'], ...view.axes.map((axis) => [axis.label, axis.planned, axis.visited, axis.reportsDone])]), 'الخدمات');
  XLSX.writeFile(book, 'تقرير-الخطة-الشهرية.xlsx');
}

export function MonthlyReportPage({ fixture }: { fixture?: LoadedReport } = {}) {
  const { formatNumber } = useDisplayFormat();
  const [searchParams] = useSearchParams();
  const [month, setMonth] = useState(() => initialReportMonth(searchParams.get('month')));
  const [asOf, setAsOf] = useState(todayLocal);
  const [axis, setAxis] = useState<ReportAxisFilter>(() => initialReportAxis(searchParams.get('service')));
  const [engineerId, setEngineerId] = useState('');
  const [supervisorId, setSupervisorId] = useState(() => searchParams.get('supervisor') ?? '');
  const [neighbourhood, setNeighbourhood] = useState('');
  const actionFilter = reportActionFilter(searchParams.get('action'));
  const reportElementRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [layout, setLayout] = useState<ReportLayoutItem[]>([...defaultReportLayout]);
  const [draftLayout, setDraftLayout] = useState<ReportLayoutItem[]>([...defaultReportLayout]);
  const [customizing, setCustomizing] = useState(false);
  const report = useQuery({ queryKey: ['monthly-report', month, Boolean(fixture)], queryFn: () => fixture ?? loadReport(month) });
  const rows = report.data?.current ?? EMPTY_ROWS;
  const filtered = useMemo(() => filterPlanReportActionRows(
    filterPlanReportRows(rows, { month, axis, engineerId, supervisorId, neighbourhood }),
    actionFilter,
    asOf,
  ), [rows, month, axis, engineerId, supervisorId, neighbourhood, actionFilter, asOf]);
  const previous = useMemo(() => actionFilter
    ? []
    : filterPlanReportRows(report.data?.previous ?? [], { month: previousMonth(month), axis, engineerId, supervisorId, neighbourhood }),
  [report.data, month, axis, engineerId, supervisorId, neighbourhood, actionFilter]);
  const view = useMemo(() => buildPlanReportView(filtered, month, asOf, previous), [filtered, month, asOf, previous]);
  const data = useReportData(view, filtered, month, asOf, formatNumber);
  useEffect(() => {
    let active = true;
    void supabase?.auth.getUser().then(async ({ data: auth }) => {
      if (!auth.user) return;
      const { data: profile } = await supabase!.from('profiles').select('prefs').eq('id', auth.user.id).maybeSingle();
      const next = normalizeReportLayout((profile?.prefs as { report_layout?: unknown } | null)?.report_layout);
      if (active) { setLayout(next); setDraftLayout(next); }
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const element = reportElementRef.current;
    if (!element) return;
    const height = element.scrollHeight;
    const pageHeightPx = ((297 - 16) / 25.4) * 96;
    const pageWidthPx = ((210 - 16) / 25.4) * 96;
    const scale = Math.min(1, pageHeightPx / Math.max(height, 1), pageWidthPx / 1100);
    element.style.setProperty('--report-print-scale', String(scale));
    element.style.setProperty('--report-print-height', `${height}px`);
  }, [data]);
  const engineers = uniqueOptions(rows, 'engineerId', 'engineerName');
  const supervisors = uniqueOptions(rows.filter((row) => row.planType === 'maintenance'), 'supervisorId', 'supervisorName');
  const neighbourhoods = [...new Set(rows.map((row) => row.neighbourhood))].sort((a, b) => a.localeCompare(b, 'ar'));
  return <div className="monthly-report-print report-shell min-w-0" dir="rtl">
    <FilterBar {...{ month, setMonth, asOf, setAsOf, axis, setAxis, engineerId, setEngineerId, supervisorId, setSupervisorId, neighbourhood, setNeighbourhood, engineers, supervisors, neighbourhoods }} onExcel={() => void exportWorkbook(view)} onPrint={() => window.print()} onCustomize={() => { setDraftLayout(layout); setCustomizing(true); }} onPdf={() => {
      if (!reportElementRef.current || isExporting) return;
      setIsExporting(true);
      void exportReportPdf(reportElementRef.current, `تقرير-متابعة-الخطة-${month.slice(0, 4)}-${month.slice(5, 7)}.pdf`)
        .finally(() => setIsExporting(false));
    }} isExporting={isExporting} />
    {actionFilter && <div role="status" className="card flex flex-wrap items-center justify-between gap-2 p-3 text-sm text-brand-900">
      <span>
        {actionFilter === 'late-visits'
          ? 'قائمة الزيارات التي فاتها موعدها'
          : actionFilter === 'below-expected'
            ? 'الزيارات غير المنجزة ضمن العجز عن المتوقع'
            : 'قائمة الزيارات المنفذة دون تقرير'} · {filtered.length}
      </span>
      <Link to={`/plans/report?month=${month}&service=${axis}`} className="font-bold underline">إزالة تصفية الإجراء</Link>
    </div>}
    {report.error && <StateBox tone="error">تعذر تحميل التقرير: {report.error.message}</StateBox>}
    {report.isLoading && <StateBox>جارٍ تحميل التقرير…</StateBox>}
    {!report.isLoading && !report.error && !rows.length && <StateBox>لا توجد خطط شهرية مسجلة لهذا الشهر.</StateBox>}
    {!report.isLoading && !report.error && rows.length > 0 && <div ref={reportElementRef} className="report-design-page">{getReportLayout(layout).map(({ id, component: Section }) => <div key={id} data-section-id={id} className="report-section-wrapper"><Section {...data} /></div>)}</div>}
    {customizing && <ReportCustomization layout={draftLayout} setLayout={setDraftLayout} onClose={() => setCustomizing(false)} onSave={async () => {
      const user = (await supabase?.auth.getUser())?.data.user;
      if (user && supabase) {
        const { data: profile } = await supabase.from('profiles').select('prefs').eq('id', user.id).maybeSingle();
        const prefs = (profile?.prefs && typeof profile.prefs === 'object') ? profile.prefs : {};
        const { error: saveError } = await supabase.from('profiles').update({ prefs: { ...prefs, report_layout: draftLayout } }).eq('id', user.id);
        if (saveError) throw saveError;
      }
      setLayout(draftLayout); setCustomizing(false);
    }} />}
  </div>;
}

function uniqueOptions(rows: ReportPlanRow[], idKey: 'engineerId' | 'supervisorId', nameKey: 'engineerName' | 'supervisorName') {
  return [...new Map(rows.filter((row) => row[idKey] || (idKey === 'supervisorId' && row[nameKey]))
    .map((row) => {
      const id = row[idKey] ?? `name:${row[nameKey] ?? ''}`;
      return [id, { id, name: row[nameKey] ?? 'غير محدد' }] as const;
    })).values()].sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}
function FilterBar(p: { month: string; setMonth: (value: string) => void; asOf: string; setAsOf: (value: string) => void; axis: ReportAxisFilter; setAxis: (value: ReportAxisFilter) => void; engineerId: string; setEngineerId: (value: string) => void; supervisorId: string; setSupervisorId: (value: string) => void; neighbourhood: string; setNeighbourhood: (value: string) => void; engineers: { id: string; name: string }[]; supervisors: { id: string; name: string }[]; neighbourhoods: string[]; onExcel: () => void; onPrint: () => void; onCustomize: () => void; onPdf: () => void; isExporting: boolean }) {
  return <section className="no-print report-filter-bar"><label>الشهر<input type="month" value={p.month} onChange={(event) => p.setMonth(event.target.value)} /></label><label>كما في<input type="date" value={p.asOf} onChange={(event) => p.setAsOf(event.target.value)} /></label><Select label="الخدمة" value={p.axis} options={axisOptions} onChange={(value) => p.setAxis(value as ReportAxisFilter)} /><Select label="المهندس" value={p.engineerId} options={p.engineers.map((item) => ({ value: item.id, label: item.name }))} onChange={p.setEngineerId} empty="كل المهندسين" /><Select label="المشرف" value={p.supervisorId} options={p.supervisors.map((item) => ({ value: item.id, label: item.name }))} onChange={p.setSupervisorId} empty="كل المشرفين" /><Select label="الحي" value={p.neighbourhood} options={p.neighbourhoods.map((item) => ({ value: item, label: item }))} onChange={p.setNeighbourhood} empty="كل الأحياء" /><div className="filter-actions"><button type="button" onClick={p.onCustomize}><Settings size={15} /> تخصيص التقرير</button><button type="button" onClick={p.onExcel}><Download size={15} /> Excel</button><button type="button" className="primary" disabled={p.isExporting} onClick={p.onPdf}><Download size={15} /> {p.isExporting ? 'جارٍ التصدير…' : 'تصدير PDF'}</button><button type="button" onClick={p.onPrint}><Printer size={15} /> طباعة</button></div></section>;
}
function Select({ label, value, options, onChange, empty }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void; empty?: string }) { return <label>{label}<select value={value} onChange={(event) => onChange(event.target.value)}>{empty && <option value="">{empty}</option>}{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>; }
function ReportCustomization({ layout, setLayout, onClose, onSave }: { layout: ReportLayoutItem[]; setLayout: (value: ReportLayoutItem[]) => void; onClose: () => void; onSave: () => Promise<void> }) {
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= layout.length) return;
    const next = [...layout]; [next[index], next[target]] = [next[target], next[index]]; setLayout(next);
  };
  return <div className="fixed inset-0 z-50 bg-slate-900/30" role="dialog" aria-label="تخصيص التقرير"><aside className="ms-auto flex h-full w-full max-w-md flex-col bg-white p-5 shadow-xl" dir="rtl">
    <header className="flex items-center justify-between border-b pb-4"><h2 className="text-lg font-bold">تخصيص التقرير</h2><button type="button" onClick={onClose} aria-label="إغلاق"><X /></button></header>
    <div className="grid gap-3 overflow-y-auto py-5">{layout.map((item, index) => {
      const section = reportSections.find((candidate) => candidate.id === item.id);
      return <div key={item.id} className="flex items-center gap-2 rounded-lg border p-3"><input type="checkbox" checked={item.visible} onChange={(event) => setLayout(layout.map((entry) => entry.id === item.id ? { ...entry, visible: event.target.checked } : entry))} /><span className="flex-1 font-semibold">{section?.title}</span><button type="button" onClick={() => move(index, -1)} aria-label="تحريك لأعلى"><ChevronUp size={17} /></button><button type="button" onClick={() => move(index, 1)} aria-label="تحريك لأسفل"><ChevronDown size={17} /></button></div>;
    })}</div>
    <div className="mt-auto flex gap-2 border-t pt-4"><button type="button" className="primary flex-1 rounded-lg bg-brand-700 px-4 py-2 font-bold text-white" onClick={() => void onSave()}>حفظ</button><button type="button" className="rounded-lg border px-4 py-2" onClick={() => setLayout([...defaultReportLayout])}>إعادة الافتراضي</button></div>
  </aside></div>;
}
function StateBox({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) { return <div className={`state-box ${tone}`}>{children}</div>; }

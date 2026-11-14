import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode, type RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Download, FileSpreadsheet, Settings, X } from 'lucide-react';
import { z } from 'zod';
import { useDisplayFormat } from '../../app/useDisplayFormat';
import {
  analyzeTickets,
  attachSchoolSupervisors,
  parseTicketRows,
  type TicketAnalysis,
  type TicketDataWarnings,
  type TicketSchoolSupervisorSource,
} from '../../domain/ticketAnalysis';
import { APP_SCHEMA_SELECT } from '../../lib/schemaColumns';
import { supabase } from '../../lib/supabase';
import { exportReportPdf } from '../../lib/reportPdf';
import { loadXlsx } from '../../lib/xlsx';
import {
  defaultTicketReportLayout,
  getTicketReportLayout,
  normalizeTicketReportLayout,
  ticketReportSections,
  type TicketReportLayoutItem,
  type TicketReportSectionId,
} from './ticketReportLayout';

interface TicketReportData {
  analyzedAt: Date;
  analysis: TicketAnalysis;
  warnings: TicketDataWarnings;
  unmatchedSupervisorTickets: number;
  supervisorLookupUnavailable: boolean;
}

const ticketReportCoreSections = ['header', 'summary'];
const schoolSupervisorSchema = z.object({
  ministry_number: z.string(),
  ministry_key: z.string().nullable(),
  source_fields: z.record(z.string(), z.unknown()).nullable(),
});

async function loadSchoolSupervisorSources(): Promise<TicketSchoolSupervisorSource[]> {
  if (!supabase) throw new Error('إعداد الاتصال بقاعدة البيانات غير مكتمل.');
  const sources: TicketSchoolSupervisorSource[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from('schools')
      .select(APP_SCHEMA_SELECT.schoolsTicketSupervisors)
      .order('ministry_no')
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = z.array(schoolSupervisorSchema).parse(data);
    sources.push(...page.map((school) => ({
      ministryNumber: school.ministry_number,
      ministryKey: school.ministry_key,
      sourceFields: school.source_fields,
    })));
    if (page.length < pageSize) return sources;
  }
}

async function analyzeSpreadsheet(
  file: File,
  schoolSources: readonly TicketSchoolSupervisorSource[],
  supervisorLookupUnavailable: boolean,
): Promise<TicketReportData> {
  if (!/\.(csv|xls|xlsx)$/i.test(file.name)) {
    throw new Error('اختر ملف Excel بامتداد .xlsx أو .xls أو ملف CSV.');
  }
  const XLSX = await loadXlsx();
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) throw new Error('ملف Excel لا يحتوي على ورقة عمل.');
  const worksheet = workbook.Sheets[firstSheetName];
  if (!worksheet) throw new Error('تعذر قراءة ورقة العمل الأولى في الملف.');
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: '',
    raw: false,
    blankrows: false,
  });
  const parsed = parseTicketRows(rows);
  const tickets = attachSchoolSupervisors(parsed.tickets, schoolSources);
  return {
    analyzedAt: new Date(),
    analysis: analyzeTickets(tickets, parsed.hasSupervisorColumn || tickets.some((ticket) => Boolean(ticket.supervisor))),
    warnings: parsed.warnings,
    unmatchedSupervisorTickets: tickets.filter((ticket) => !ticket.supervisor).length,
    supervisorLookupUnavailable,
  };
}

export function TicketAnalysisPage() {
  const { formatDate, formatDateTime, formatNumber } = useDisplayFormat();
  const fileInput = useRef<HTMLInputElement>(null);
  const reportElement = useRef<HTMLDivElement>(null);
  const schoolSourcesQuery = useQuery({
    queryKey: ['ticket-analysis-school-supervisors'],
    queryFn: loadSchoolSupervisorSources,
    staleTime: 5 * 60 * 1000,
  });
  const [report, setReport] = useState<TicketReportData | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [layout, setLayout] = useState<TicketReportLayoutItem[]>([...defaultTicketReportLayout]);
  const [draftLayout, setDraftLayout] = useState<TicketReportLayoutItem[]>([...defaultTicketReportLayout]);
  const [customizing, setCustomizing] = useState(false);
  const [isSavingLayout, setIsSavingLayout] = useState(false);
  const [error, setError] = useState('');
  const [pdfError, setPdfError] = useState('');
  const [layoutError, setLayoutError] = useState('');

  useEffect(() => {
    let active = true;
    async function loadLayout() {
      if (!supabase) return;
      try {
        const { data: auth, error: authError } = await supabase.auth.getUser();
        if (authError) throw authError;
        if (!auth.user) return;
        const { data: profile, error: profileError } = await supabase.from('profiles')
          .select('prefs')
          .eq('id', auth.user.id)
          .maybeSingle();
        if (profileError) throw profileError;
        const prefs = profile?.prefs;
        const savedLayout = prefs && typeof prefs === 'object' && !Array.isArray(prefs)
          ? (prefs as Record<string, unknown>).ticket_analysis_report_layout
          : undefined;
        const next = normalizeTicketReportLayout(savedLayout);
        if (active) {
          setLayout(next);
          setDraftLayout(next);
        }
      } catch {
        if (active) setLayoutError('تعذر تحميل تخصيص التقرير؛ ستُستخدم الأقسام الافتراضية.');
      }
    }
    void loadLayout();
    return () => { active = false; };
  }, []);

  async function onFileSelected(file: File) {
    setError('');
    setPdfError('');
    setReport(null);
    setIsAnalyzing(true);
    try {
      setReport(await analyzeSpreadsheet(
        file,
        schoolSourcesQuery.data ?? [],
        Boolean(schoolSourcesQuery.error),
      ));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'تعذر تحليل ملف البلاغات.');
    } finally {
      setIsAnalyzing(false);
    }
  }

  function onUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) void onFileSelected(file);
  }

  function onExportPdf() {
    if (!reportElement.current || !report || isExporting) return;
    setPdfError('');
    setIsExporting(true);
    void exportReportPdf(reportElement.current, 'تقرير-تحليل-البلاغات.pdf', ticketReportCoreSections)
      .catch((reason: unknown) => {
        setPdfError(reason instanceof Error ? reason.message : 'تعذر تصدير التقرير إلى PDF.');
      })
      .finally(() => setIsExporting(false));
  }

  async function onSaveLayout() {
    setLayoutError('');
    setIsSavingLayout(true);
    try {
      if (!supabase) throw new Error('إعداد الاتصال بقاعدة البيانات غير مكتمل.');
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!auth.user) throw new Error('انتهت جلسة المستخدم؛ سجّل الدخول ثم أعد المحاولة.');
      const { data: profile, error: profileError } = await supabase.from('profiles')
        .select('prefs')
        .eq('id', auth.user.id)
        .maybeSingle();
      if (profileError) throw profileError;
      const prefs = profile?.prefs && typeof profile.prefs === 'object' && !Array.isArray(profile.prefs)
        ? profile.prefs as Record<string, unknown>
        : {};
      const { error: saveError } = await supabase.from('profiles')
        .update({ prefs: { ...prefs, ticket_analysis_report_layout: draftLayout } })
        .eq('id', auth.user.id);
      if (saveError) throw saveError;
      setLayout(draftLayout);
      setCustomizing(false);
    } catch (reason) {
      setLayoutError(reason instanceof Error ? reason.message : 'تعذر حفظ تخصيص التقرير.');
    } finally {
      setIsSavingLayout(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-5">
      <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm text-slate-500">رفع ملف البلاغات وتحليل الحالة والمهلة والمدارس والفئات والتكرار</p>
          <h2 className="mt-1 text-2xl font-bold text-brand-900">تحليل البلاغات</h2>
        </div>
      </section>

      <section className="no-print card grid gap-3 p-4 sm:flex sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="font-bold text-brand-900">ملف البلاغات</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            يدعم ملفات Excel وCSV المتوافقة مع أعمدة نموذج البلاغات. تتم المعالجة محليًا في المتصفح.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,.xls,.csv"
            aria-label="رفع ملف البلاغات"
            disabled={isAnalyzing || schoolSourcesQuery.isLoading}
            onChange={onUpload}
            className="block max-w-full text-xs file:me-2 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:font-semibold file:text-brand-800 disabled:opacity-50"
          />
          {report && (
            <>
              <button
                type="button"
                onClick={() => { setDraftLayout(layout); setCustomizing(true); }}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-brand-800"
              >
                <Settings size={16} />
                تخصيص التقرير
              </button>
              <button
                type="button"
                onClick={onExportPdf}
                disabled={isExporting}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                <Download size={16} />
                {isExporting ? 'جارٍ التصدير…' : 'تصدير PDF'}
              </button>
            </>
          )}
        </div>
        {schoolSourcesQuery.isLoading && <p role="status" className="text-sm text-brand-800">جارٍ تحميل بيانات المباني لمطابقة المشرفين…</p>}
        {schoolSourcesQuery.error && <p role="alert" className="text-sm text-amber-800">تعذر تحميل المشرفين من قاعدة بيانات المباني؛ سيُستخدم عمود المشرف في الملف إن وُجد.</p>}
        {layoutError && !customizing && <p role="alert" className="text-sm text-amber-800">{layoutError}</p>}
        {isAnalyzing && <p role="status" className="text-sm text-brand-800">جارٍ تحليل الملف…</p>}
        {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
        {pdfError && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{pdfError}</p>}
      </section>

      {!report && !isAnalyzing && !error && (
        <section className="card grid justify-items-center gap-2 p-8 text-center text-slate-500">
          <FileSpreadsheet size={28} className="text-brand-600" />
          <p className="font-semibold">ارفع ملف البلاغات لعرض التحليل.</p>
          <p className="text-xs">يتضمن التقرير ملخص الحالة والمهلة، وأعلى المدارس والفئات، والبلاغات المتكررة.</p>
        </section>
      )}

      {report && (
        <TicketReport
          reportRef={reportElement}
          report={report}
          formatDate={formatDate}
          formatDateTime={formatDateTime}
          formatNumber={formatNumber}
          layout={layout}
        />
      )}
      {customizing && (
        <TicketReportCustomization
          layout={draftLayout}
          setLayout={setDraftLayout}
          isSaving={isSavingLayout}
          error={layoutError}
          onClose={() => setCustomizing(false)}
          onSave={() => void onSaveLayout()}
          onReset={() => setDraftLayout([...defaultTicketReportLayout])}
        />
      )}
    </div>
  );
}

function TicketReport({
  reportRef,
  report,
  formatDate,
  formatDateTime,
  formatNumber,
  layout,
}: {
  reportRef: RefObject<HTMLDivElement>;
  report: TicketReportData;
  formatDate: (value: string) => string;
  formatDateTime: (value: string) => string;
  formatNumber: (value: string | number) => string;
  layout: readonly TicketReportLayoutItem[];
}) {
  const analysis = report.analysis;
  const qualityWarnings = useMemo(() => [
    ['معرّف البلاغ', report.warnings.missingIdentifiers],
    ['الأولوية', report.warnings.missingPriorities],
    ['الحالة', report.warnings.missingStatuses],
    ['حالة SLA', report.warnings.missingSlaStatuses],
    ['الفئة', report.warnings.missingCategories],
    ['المدرسة', report.warnings.missingSchools],
    ['تاريخ الإنشاء الفارغ', report.warnings.missingCreatedDates],
    ['تاريخ الإنشاء غير الصالح', report.warnings.invalidCreatedDates],
  ].filter(([, count]) => Number(count) > 0), [report.warnings]);
  const period = analysis.firstCreatedAt && analysis.lastCreatedAt
    ? analysis.firstCreatedAt.toDateString() === analysis.lastCreatedAt.toDateString()
      ? formatDate(analysis.firstCreatedAt.toISOString().slice(0, 10))
      : `${formatDate(analysis.firstCreatedAt.toISOString().slice(0, 10))} – ${formatDate(analysis.lastCreatedAt.toISOString().slice(0, 10))}`
    : 'التواريخ غير متاحة';
  const sectionContent: Record<TicketReportSectionId, ReactNode> = {
    header: (
      <header className="report-design-header">
        <div className="report-header-content">
          <img src="/brand/logo.png" alt="شلفا" className="report-design-logo" />
          <div className="min-w-0">
            <div className="report-header-kicker">تقرير متابعة البلاغات</div>
            <h1>تحليل البلاغات المستلمة</h1>
            <p>الفترة: {period} · عدد البلاغات: {formatNumber(analysis.total)}</p>
          </div>
          <div className="report-last-update">
            تاريخ التحليل
            <strong>{formatDateTime(report.analyzedAt.toISOString())}</strong>
          </div>
        </div>
      </header>
    ),
    summary: (
      <>
        <div className="report-summary-grid">
          <SummaryCard label="إجمالي البلاغات" value={formatNumber(analysis.total)} />
          <SummaryCard label="تم حلها / إغلاقها" value={formatNumber(analysis.resolved)} tone="green" />
          <SummaryCard label="البلاغات المفتوحة" value={formatNumber(analysis.open)} tone="amber" />
          <SummaryCard label="البلاغات الملغاة" value={formatNumber(analysis.cancelled)} tone="red" />
          <SummaryCard label="البلاغات الحرجة" value={formatNumber(analysis.critical)} tone="red" />
        </div>
        <div className="report-summary-grid">
          <SummaryCard label="ضمن المهلة" value={formatNumber(analysis.sla.within)} tone="green" />
          <SummaryCard label="تحذير SLA" value={formatNumber(analysis.sla.warning)} tone="amber" />
          <SummaryCard label="تجاوزت المهلة" value={formatNumber(analysis.sla.breached)} tone="red" />
          <SummaryCard label="بلاغات حرجة مفتوحة" value={formatNumber(analysis.criticalOpen)} tone="red" />
          <SummaryCard
            label="متوسط زمن الحل (ساعة)"
            value={analysis.averageResolutionHours === null ? '—' : formatNumber(analysis.averageResolutionHours.toFixed(1))}
            tone="amber"
          />
        </div>

        <section className="report-design-card">
          <h2 className="report-design-title">الحالة والالتزام بالمهلة</h2>
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="min-w-0">
              <h3 className="mb-2 text-sm font-bold text-brand-900">حالة البلاغات</h3>
              <div className="table-scroll">
                <table className="w-full text-xs">
                  <thead className="bg-[#e7ecf7] text-[#21366a]">
                    <tr>
                      <th className="p-2 text-start">الحالة</th>
                      <th className="p-2 text-center">الإجمالي</th>
                      <th className="p-2 text-center">محلولة</th>
                      <th className="p-2 text-center">مفتوحة</th>
                      <th className="p-2 text-center">ملغاة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.statuses.map((status) => (
                      <tr key={status.label} className="border-t border-slate-100">
                        <th className="p-2 text-start font-semibold text-slate-700">{status.label}</th>
                        <td className="p-2 text-center">{formatNumber(status.count)}</td>
                        <td className="p-2 text-center text-emerald-700">{formatNumber(status.resolved)}</td>
                        <td className="p-2 text-center text-amber-700">{formatNumber(status.open)}</td>
                        <td className="p-2 text-center text-rose-700">{formatNumber(status.cancelled)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="grid content-start gap-4">
              <div>
                <h3 className="mb-2 text-sm font-bold text-brand-900">مؤشرات SLA</h3>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <MiniMetric label="نسبة عدم اختراق المهلة" value={formatPercent(analysis.sla.compliancePercent, formatNumber)} tone="text-emerald-700" />
                  <MiniMetric label="نسبة اختراق المهلة" value={formatPercent(analysis.sla.breachPercent, formatNumber)} tone="text-rose-700" />
                  <MiniMetric label="متوسط زمن الحل" value={analysis.averageResolutionHours === null ? 'غير متاح' : `${formatNumber(analysis.averageResolutionHours.toFixed(1))} ساعة`} />
                  <MiniMetric label="محلولة بتاريخين صالحين" value={formatNumber(analysis.resolvedWithDuration)} />
                </div>
                <p className="mt-2 text-[11px] leading-5 text-slate-500">
                  نسبة عدم الاختراق تشمل البلاغات ضمن المهلة والتحذير، وتستثني الحالات التي لم يحدد لها SLA.
                </p>
              </div>
              <BreakdownBars title="الأولوية" items={analysis.priorities} formatNumber={formatNumber} />
            </div>
          </div>
          {qualityWarnings.length > 0 && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <h3 className="mb-1 font-bold">تنبيهات جودة البيانات</h3>
              <p>{qualityWarnings.map(([label, count]) => `${label}: ${formatNumber(Number(count))}`).join(' · ')}</p>
            </div>
          )}
        </section>
      </>
    ),
    supervisors: (
      <section className="report-design-card">
        <h2 className="report-design-title">حالة البلاغات وSLA حسب المشرف</h2>
        {report.unmatchedSupervisorTickets > 0 && (
          <p className="mb-3 text-xs text-amber-800">
            لم يُحدد مشرف لـ {formatNumber(report.unmatchedSupervisorTickets)} بلاغًا بسبب نقص بيانات المشرف أو عدم تطابق رقم المدرسة.
          </p>
        )}
        {report.supervisorLookupUnavailable && (
          <p className="mb-3 text-xs text-amber-800">تعذر تحميل بيانات المباني؛ عُرضت أسماء المشرفين الموجودة في ملف البلاغات فقط.</p>
        )}
        {analysis.supervisors.length > 0 ? (
          <div className="table-scroll">
            <table className="w-full text-xs">
              <thead className="bg-[#e7ecf7] text-[#21366a]">
                <tr>
                  <th className="p-2 text-start">المشرف</th>
                  <th className="p-2 text-center">الإجمالي</th>
                  <th className="p-2 text-center">تم حلها</th>
                  <th className="p-2 text-center">مفتوحة</th>
                  <th className="p-2 text-center">ملغاة</th>
                  <th className="p-2 text-center">ضمن المهلة</th>
                  <th className="p-2 text-center">تحذير</th>
                  <th className="p-2 text-center">مخترقة</th>
                  <th className="p-2 text-center">حرجة قائمة</th>
                </tr>
              </thead>
              <tbody>
                {analysis.supervisors.map((supervisor) => (
                  <tr key={supervisor.name} className="border-t border-slate-100">
                    <th className="p-2 text-start font-semibold text-slate-700">{supervisor.name}</th>
                    <td className="p-2 text-center">{formatNumber(supervisor.total)}</td>
                    <td className="p-2 text-center text-emerald-700">{formatNumber(supervisor.resolved)}</td>
                    <td className="p-2 text-center text-amber-700">{formatNumber(supervisor.open)}</td>
                    <td className="p-2 text-center">{formatNumber(supervisor.cancelled)}</td>
                    <td className="p-2 text-center">{formatNumber(supervisor.withinSla)}</td>
                    <td className="p-2 text-center text-amber-700">{formatNumber(supervisor.warningSla)}</td>
                    <td className="p-2 text-center text-rose-700">{formatNumber(supervisor.breachedSla)}</td>
                    <td className="p-2 text-center text-rose-700">{formatNumber(supervisor.criticalOpen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="report-empty text-sm leading-7">
            {analysis.hasSupervisorData
              ? 'لا توجد أسماء مشرفين صالحة في البيانات المتاحة لتحليل البلاغات حسب المشرف.'
              : 'لم يُعثر على أسماء مشرفين مطابقة لأرقام المدارس في الملف أو قاعدة بيانات المباني.'}
          </p>
        )}
      </section>
    ),
    schools: (
      <section className="report-design-card">
        <h2 className="report-design-title">المدارس الأعلى في عدد البلاغات</h2>
        <p className="mb-3 text-xs text-slate-500">
          أعلى 15 مدرسة من أصل {formatNumber(analysis.schoolsCount)} مدرسة لديها بلاغات.
        </p>
        <SchoolTable rows={analysis.schoolsByTotal} formatNumber={formatNumber} showStatus />
        <h3 className="mb-2 mt-6 text-sm font-bold text-brand-900">أكثر المدارس فتحًا للبلاغات</h3>
        <SchoolTable rows={analysis.schoolsByOpen} formatNumber={formatNumber} showStatus={false} />
      </section>
    ),
    categories: (
      <section className="report-design-card">
        <h2 className="report-design-title">تصنيف البلاغات</h2>
        {analysis.categoryGroupAvailable ? (
          <BreakdownBars title="حسب الطبقة الثانية للفئة" items={analysis.categoryGroups} formatNumber={formatNumber} />
        ) : (
          <p className="mb-4 text-xs text-slate-500">الملف لا يتضمن تصنيف الطبقة الثانية؛ يعرض التقرير التصنيف المتاح في الطبقة الثالثة.</p>
        )}
        <BreakdownBars title="عدد البلاغات حسب الطبقة الثالثة للفئة" items={analysis.categories} formatNumber={formatNumber} />
      </section>
    ),
    repeats: (
      <section className="report-design-card">
        <h2 className="report-design-title">البلاغات المتكررة</h2>
        <p className="mb-3 text-xs leading-5 text-slate-500">
          يُعد البلاغ متكررًا عند اجتماع المدرسة نفسها والفئة نفسها (الطبقة الثالثة) في بلاغين أو أكثر.
        </p>
        <div className="report-summary-grid">
          <SummaryCard label="مدارس بها تكرار" value={formatNumber(analysis.repeats.schools)} />
          <SummaryCard label="مجموعات متكررة" value={formatNumber(analysis.repeats.groups)} tone="amber" />
          <SummaryCard label="بلاغات ضمن التكرار" value={formatNumber(analysis.repeats.tickets)} tone="red" />
          <SummaryCard label="بلاغات إضافية مكررة" value={formatNumber(analysis.repeats.additionalTickets)} />
          <SummaryCard label="المفتوحة ضمن التكرار" value={formatNumber(analysis.repeats.openTickets)} tone="amber" />
        </div>
        {analysis.repeats.top.length > 0 ? (
          <div className="mt-5 table-scroll">
            <table className="w-full text-xs">
              <thead className="bg-[#e7ecf7] text-[#21366a]">
                <tr>
                  <th className="p-2 text-start">المدرسة</th>
                  <th className="p-2 text-start">الفئة (الطبقة 3)</th>
                  {analysis.hasSupervisorData && <th className="p-2 text-start">المشرف</th>}
                  <th className="p-2 text-center">عدد التكرار</th>
                  <th className="p-2 text-center">مفتوح</th>
                </tr>
              </thead>
              <tbody>
                {analysis.repeats.top.map((repeat, index) => (
                  <tr key={`${repeat.schoolName}-${repeat.category}-${index}`} className="border-t border-slate-100">
                    <td className="p-2 font-semibold">{repeat.schoolName}</td>
                    <td className="p-2">{repeat.category}</td>
                    {analysis.hasSupervisorData && <td className="p-2">{repeat.supervisor || 'غير محدد'}</td>}
                    <td className="p-2 text-center font-bold text-rose-700">{formatNumber(repeat.count)}</td>
                    <td className="p-2 text-center">{formatNumber(repeat.open)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="report-empty mt-4 text-sm">لا توجد مجموعات متكررة حسب المدرسة والفئة في هذا الملف.</p>
        )}
      </section>
    ),
  };

  return (
    <div ref={reportRef} className="report-design-page min-w-0" dir="rtl">
      {getTicketReportLayout(layout).map(({ id }) => (
        <div key={id} data-section-id={id} className="report-section-wrapper">
          {sectionContent[id]}
        </div>
      ))}
    </div>
  );
}

function TicketReportCustomization({
  layout,
  setLayout,
  isSaving,
  error,
  onClose,
  onSave,
  onReset,
}: {
  layout: TicketReportLayoutItem[];
  setLayout: (value: TicketReportLayoutItem[]) => void;
  isSaving: boolean;
  error: string;
  onClose: () => void;
  onSave: () => void;
  onReset: () => void;
}) {
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= layout.length) return;
    const next = [...layout];
    [next[index], next[target]] = [next[target], next[index]];
    setLayout(next);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/30" role="dialog" aria-label="تخصيص التقرير">
      <aside className="ms-auto flex h-full w-full max-w-md flex-col bg-white p-5 shadow-xl" dir="rtl">
        <header className="flex items-center justify-between border-b pb-4">
          <h2 className="text-lg font-bold">تخصيص التقرير</h2>
          <button type="button" onClick={onClose} aria-label="إغلاق"><X /></button>
        </header>
        <div className="grid gap-3 overflow-y-auto py-5">
          {layout.map((item, index) => {
            const section = ticketReportSections.find((candidate) => candidate.id === item.id);
            return (
              <div key={item.id} className="flex items-center gap-2 rounded-lg border p-3">
                <input
                  type="checkbox"
                  checked={item.visible}
                  aria-label={`إظهار ${section?.title ?? item.id}`}
                  onChange={(event) => setLayout(layout.map((entry) => (
                    entry.id === item.id ? { ...entry, visible: event.target.checked } : entry
                  )))}
                />
                <span className="flex-1 font-semibold">{section?.title}</span>
                <button type="button" onClick={() => move(index, -1)} aria-label="تحريك لأعلى"><ChevronUp size={17} /></button>
                <button type="button" onClick={() => move(index, 1)} aria-label="تحريك لأسفل"><ChevronDown size={17} /></button>
              </div>
            );
          })}
        </div>
        {error && <p role="alert" className="mb-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
        <div className="mt-auto flex gap-2 border-t pt-4">
          <button
            type="button"
            className="flex-1 rounded-lg bg-brand-700 px-4 py-2 font-bold text-white disabled:opacity-50"
            disabled={isSaving}
            onClick={onSave}
          >
            {isSaving ? 'جارٍ الحفظ…' : 'حفظ'}
          </button>
          <button type="button" className="rounded-lg border px-4 py-2" onClick={onReset}>إعادة الافتراضي</button>
        </div>
      </aside>
    </div>
  );
}

function SummaryCard({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return <div className={`report-summary-card ${tone}`}><span>{label}</span><b>{value}</b></div>;
}

function MiniMetric({ label, value, tone = 'text-slate-800' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 p-2">
      <span className="text-slate-500">{label}</span>
      <strong className={`shrink-0 ${tone}`}>{value}</strong>
    </div>
  );
}

function BreakdownBars({
  title,
  items,
  formatNumber,
}: {
  title: string;
  items: Array<{ label: string; count: number; percent: number }>;
  formatNumber: (value: string | number) => string;
}) {
  const maxCount = Math.max(...items.map((item) => item.count), 1);
  return (
    <div>
      <h3 className="mb-3 text-sm font-bold text-brand-900">{title}</h3>
      {items.length ? (
        <div className="grid gap-3">
          {items.map((item) => (
            <div key={item.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
              <span className="truncate text-xs font-semibold text-slate-700" title={item.label}>{item.label}</span>
              <span className="text-xs text-slate-500">{formatNumber(item.count)} · {formatNumber(item.percent.toFixed(1))}%</span>
              <div className="report-design-bar col-span-2 mt-0">
                <span className="report-design-fill navy" style={{ width: `${(item.count / maxCount) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="report-empty text-xs">لا توجد بيانات مصنفة.</p>
      )}
    </div>
  );
}

function SchoolTable({
  rows,
  formatNumber,
  showStatus,
}: {
  rows: TicketAnalysis['schoolsByTotal'];
  formatNumber: (value: string | number) => string;
  showStatus: boolean;
}) {
  if (!rows.length) return <p className="report-empty text-xs">لا توجد بيانات مدارس.</p>;
  return (
    <div className="table-scroll">
      <table className="w-full text-xs">
        <thead className="bg-[#e7ecf7] text-[#21366a]">
          <tr>
            <th className="p-2 text-start">المدرسة</th>
            <th className="p-2 text-center">الإجمالي</th>
            {showStatus
              ? <>
                  <th className="p-2 text-center">تم حلها</th>
                  <th className="p-2 text-center">مفتوحة</th>
                  <th className="p-2 text-center">ملغاة</th>
                </>
              : <th className="p-2 text-center">مفتوحة</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((school) => (
            <tr key={school.key} className="border-t border-slate-100">
              <th className="p-2 text-start font-semibold text-slate-700">
                {school.name}
                {school.schoolNumber && <small className="ms-2 text-slate-400">{school.schoolNumber}</small>}
              </th>
              <td className="p-2 text-center">{formatNumber(school.total)}</td>
              {showStatus
                ? <>
                    <td className="p-2 text-center text-emerald-700">{formatNumber(school.resolved)}</td>
                    <td className="p-2 text-center text-amber-700">{formatNumber(school.open)}</td>
                    <td className="p-2 text-center text-rose-700">{formatNumber(school.cancelled)}</td>
                  </>
                : <td className="p-2 text-center text-amber-700">{formatNumber(school.open)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatPercent(value: number | null, formatNumber: (value: string | number) => string): string {
  return value === null ? '—' : `${formatNumber(value.toFixed(1))}%`;
}

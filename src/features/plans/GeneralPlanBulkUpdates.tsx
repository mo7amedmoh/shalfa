import { useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { normalizeImportName, normalizeMinistryNumber, parseImportDate } from '../../domain/imports';
import {
  previewGeneralPlanIdentifiers,
  type GeneralPlanBulkSchool,
  type GeneralPlanIdentifierPreviewRow,
} from '../../domain/generalPlanBulkUpdates';
import { loadXlsx } from '../../lib/xlsx';
import { supabase } from '../../lib/supabase';

type PlanStatus = 'planned' | 'in_progress' | 'done' | 'cancelled';
type PlanUpdate = {
  plan_id: string;
  row_id: string;
  status?: PlanStatus;
  execution_date?: string | null;
  report_done?: boolean;
  report_done_date?: string | null;
};
export type GeneralPlanBulkRow = GeneralPlanBulkSchool & {
  planId: string;
  status: PlanStatus;
  executionDate: string | null;
  reportDone: boolean;
  reportDoneDate: string | null;
};
type PreviewRow = {
  line: number;
  identifier: string;
  status: 'matched' | 'unmatched' | 'not_in_plan' | 'duplicate' | 'ambiguous' | 'invalid' | 'applied' | 'failed';
  note: string;
  update?: PlanUpdate;
};
type Props = {
  rows: readonly GeneralPlanBulkRow[];
  allSchools: readonly GeneralPlanBulkSchool[];
  selectedRows: readonly GeneralPlanBulkRow[];
  disabled: boolean;
  onUpdated: () => void | Promise<void>;
  onClearSelected: () => void;
};

const headers = ['الرقم الوزاري', 'حالة التنفيذ', 'تاريخ التنفيذ', 'حالة التقرير', 'تاريخ التقرير'];
const inputClass = 'rounded-lg border border-slate-300 px-3 py-2 text-sm';
const buttonClass = 'rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-50';
function today(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const databaseError = error as { code?: unknown; message: unknown; details?: unknown; hint?: unknown };
    const code = typeof databaseError.code === 'string' ? ` (${databaseError.code})` : '';
    const details = typeof databaseError.details === 'string' && databaseError.details ? ` — ${databaseError.details}` : '';
    const hint = typeof databaseError.hint === 'string' && databaseError.hint ? ` (${databaseError.hint})` : '';
    return `${String(databaseError.message)}${code}${details}${hint}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function migrationHint(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('code' in error)) return '';
  return error.code === 'PGRST202' || error.code === '42883'
    ? 'طبّق الترحيل 202611150002_general_plan_bulk_updates.sql. '
    : '';
}

function parseStatus(value: unknown): PlanStatus | null | undefined {
  const normalized = normalizeImportName(String(value ?? ''));
  if (!normalized) return undefined;
  if (['لم يبدا', 'planned'].includes(normalized)) return 'planned';
  if (['جار', 'جاري', 'in_progress'].includes(normalized)) return 'in_progress';
  if (['مكتمل', 'منجز', 'done', 'complete'].includes(normalized)) return 'done';
  if (['ملغي', 'ملغى', 'cancelled'].includes(normalized)) return 'cancelled';
  return null;
}

function parseReportStatus(value: unknown): boolean | null | undefined {
  const normalized = normalizeImportName(String(value ?? ''));
  if (!normalized) return undefined;
  if (['تم', 'تم انجازه', 'نعم', 'yes', 'y', 'true', '1'].includes(normalized)) return true;
  if (['لم يتم', 'لا', 'no', 'n', 'false', '0'].includes(normalized)) return false;
  return null;
}

function dateCell(value: unknown): { value: string | null; provided: boolean; valid: boolean } {
  if (value === '' || value === null || value === undefined) return { value: null, provided: false, valid: true };
  const date = parseImportDate(value);
  return { value: date, provided: true, valid: date !== null };
}

function matchedPreviewRows(rows: readonly GeneralPlanIdentifierPreviewRow[]): PreviewRow[] {
  return rows.map((row) => ({
    ...row,
    ...(row.rowId && row.planId ? { update: { row_id: row.rowId, plan_id: row.planId } } : {}),
  }));
}

export function GeneralPlanBulkUpdates({
  rows,
  allSchools,
  selectedRows,
  disabled,
  onUpdated,
  onClearSelected,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [statusChange, setStatusChange] = useState<'' | PlanStatus>('');
  const [executionDate, setExecutionDate] = useState(today);
  const [reportChange, setReportChange] = useState<'' | 'done' | 'pending'>('');
  const [reportDate, setReportDate] = useState(today);
  const [numbersDialogOpen, setNumbersDialogOpen] = useState(false);
  const [pastedIdentifiers, setPastedIdentifiers] = useState('');
  const [numbersPreview, setNumbersPreview] = useState<PreviewRow[] | null>(null);
  const [filePreview, setFilePreview] = useState<PreviewRow[] | null>(null);

  function uniformUpdate(rowId: string, planId: string): PlanUpdate {
    return {
      plan_id: planId,
      row_id: rowId,
      ...(statusChange ? {
        status: statusChange,
        execution_date: statusChange === 'done' ? executionDate : null,
      } : {}),
      ...(reportChange ? {
        report_done: reportChange === 'done',
        report_done_date: reportChange === 'done' ? reportDate : null,
      } : {}),
    };
  }

  const hasUniformChange = Boolean(statusChange || reportChange);

  async function applyUpdates(updates: readonly PlanUpdate[], description: string, previewSource?: 'file' | 'numbers') {
    if (!supabase) {
      setMessage('اختر خطة عامة أولاً.');
      return;
    }
    if (disabled) {
      setMessage('لا تملك صلاحية التحديث الجماعي.');
      return;
    }
    if (!updates.length) {
      setMessage('لم يتم تحديد صفوف صالحة للتحديث.');
      return;
    }
    if (!window.confirm(`سيتم تطبيق التحديث على ${updates.length} صفاً ${description}. هل تريد المتابعة؟`)) return;

    setBusy(true);
    setMessage('');
    let updated = 0;
    try {
      for (let offset = 0; offset < updates.length; offset += 100) {
        const batch = updates.slice(offset, offset + 100);
        const { data, error } = await supabase.rpc('bulk_update_general_plan_rows', {
          p_updates: batch,
        });
        if (error) throw new Error(`تعذر تحديث الدفعة ${Math.floor(offset / 100) + 1}. ${migrationHint(error)}${errorMessage(error)}`);
        const returnedRows = typeof data === 'object' && data !== null && 'rows' in data
          ? (data as { rows?: unknown }).rows
          : null;
        if (typeof returnedRows !== 'number' || returnedRows !== batch.length) {
          throw new Error(`أعاد الخادم عدد تحديثات غير متوقع: ${String(returnedRows)} من ${batch.length}.`);
        }

        const { data: savedRows, error: verifyError } = await supabase.from('general_plan_rows')
          .select('id,status,execution_date,report_done,report_done_date')
          .in('id', batch.map(({ row_id }) => row_id));
        if (verifyError) throw new Error(`تم إرسال الدفعة لكن تعذر التحقق من القيم المحفوظة. ${errorMessage(verifyError)}`);
        const savedById = new Map((savedRows ?? []).map((row) => [row.id, row]));
        const mismatched = batch.filter((update) => {
          const saved = savedById.get(update.row_id);
          if (!saved) return true;
          if ('status' in update && saved.status !== update.status) return true;
          if ('execution_date' in update && saved.execution_date !== update.execution_date) return true;
          if ('report_done' in update && saved.report_done !== update.report_done) return true;
          if ('report_done_date' in update && saved.report_done_date !== update.report_done_date) return true;
          return false;
        });
        if (mismatched.length) throw new Error(`لم تُحفظ القيم المطلوبة لبعض الصفوف (${mismatched.length}). أعد تحميل الخطة وتحقق من صلاحيات قاعدة البيانات.`);
        updated += returnedRows;
        setMessage(`جارٍ تحديث ${updated} من ${updates.length} صفاً…`);
        if (previewSource === 'file') {
          const batchIds = new Set(batch.map(({ row_id }) => row_id));
          setFilePreview((current) => current?.map((row) => row.update && batchIds.has(row.update.row_id)
            ? { ...row, status: 'applied', note: 'تم تطبيق التحديث.' }
            : row) ?? null);
        }
      }

      setMessage(`تم تحديث ${updated} صفاً.`);
      await onUpdated();
      onClearSelected();
      if (previewSource === 'numbers') {
        setNumbersPreview(null);
        setNumbersDialogOpen(false);
        setPastedIdentifiers('');
      }
      if (previewSource === 'file') setFilePreview(null);
    } catch (error) {
      const partial = updated ? `تم تحديث ${updated} صفاً قبل حدوث الخطأ. ` : '';
      setMessage(`${partial}${errorMessage(error)}`);
      if (previewSource === 'file') {
        const failedIds = new Set(updates.slice(updated).map(({ row_id }) => row_id));
        setFilePreview((current) => current?.map((row) => row.update && failedIds.has(row.update.row_id) && row.status !== 'applied'
          ? { ...row, status: 'failed', note: errorMessage(error) }
          : row) ?? null);
      }
    } finally {
      setBusy(false);
    }
  }

  function applySelected() {
    const updates = selectedRows.map((row) => uniformUpdate(row.id, row.planId));
    void applyUpdates(updates, 'للصفوف المحددة');
  }

  function prepareNumberPreview() {
    const preview = previewGeneralPlanIdentifiers(
      pastedIdentifiers,
      rows,
      allSchools,
    );
    if (!preview.rows.length) {
      setMessage('أدخل رقماً وزارياً أو اسم مدرسة واحداً على الأقل.');
      setNumbersPreview(null);
      return;
    }
    setMessage('');
    setNumbersPreview(matchedPreviewRows(preview.rows));
  }

  function applyNumberPreview() {
    const matched = (numbersPreview ?? []).filter((row) => row.status === 'matched' && row.update);
    if (!hasUniformChange) {
      setMessage('اختر حالة تنفيذ أو تقرير قبل تطبيق التحديث.');
      return;
    }
    void applyUpdates(matched.map((row) => ({
      ...uniformUpdate(row.update!.row_id, row.update!.plan_id),
    })), 'للصفوف المطابقة', 'numbers');
  }

  function buildFilePreview(matrix: unknown[][]): PreviewRow[] {
    const sourceHeaders = (matrix[0] ?? []).map((value) => String(value ?? '').trim());
    const columns = headers.map((header) => sourceHeaders.indexOf(header));
    if (columns.some((column) => column < 0)) throw new Error(`القالب يتطلب الأعمدة: ${headers.join('، ')}`);

    const planByNumber = new Map<string, GeneralPlanBulkRow[]>();
    for (const row of rows) {
      const number = normalizeMinistryNumber(row.ministryNumber);
      if (number) planByNumber.set(number, [...(planByNumber.get(number) ?? []), row]);
    }
    const allNumbers = new Set(allSchools.map((school) => normalizeMinistryNumber(school.ministryNumber)).filter(Boolean));
    const usedRows = new Set<string>();
    const result: PreviewRow[] = [];

    matrix.slice(1).forEach((source, index) => {
      if (!source.some((value) => String(value ?? '').trim())) return;
      const line = index + 2;
      const identifier = String(source[columns[0]] ?? '').trim();
      const number = normalizeMinistryNumber(identifier);
      if (!number) {
        result.push({ line, identifier, status: 'invalid', note: 'أدخل رقماً وزارياً صالحاً.' });
        return;
      }
      const matches = planByNumber.get(number) ?? [];
      if (!matches.length) {
        result.push({
          line, identifier,
          status: allNumbers.has(number) ? 'not_in_plan' : 'unmatched',
          note: allNumbers.has(number) ? 'المدرسة موجودة، لكنها ليست ضمن هذه الخطة.' : 'لا توجد مدرسة بهذا الرقم الوزاري.',
        });
        return;
      }
      if (matches.length > 1) {
        result.push({ line, identifier, status: 'ambiguous', note: 'الرقم يطابق أكثر من صف في الخطة.' });
        return;
      }

      const row = matches[0];
      if (usedRows.has(row.id)) {
        result.push({ line, identifier, status: 'duplicate', note: 'تكرر الرقم الوزاري في الملف.' });
        return;
      }

      const rawStatus = source[columns[1]];
      const status = parseStatus(rawStatus);
      const execution = dateCell(source[columns[2]]);
      const reportDone = parseReportStatus(source[columns[3]]);
      const report = dateCell(source[columns[4]]);
      let note = '';
      if (status === null || reportDone === null) note = 'حالة التنفيذ أو التقرير غير معروفة.';
      else if (!execution.valid || !report.valid) note = 'تاريخ غير صالح.';
      else if (status === 'done' && !execution.provided) note = 'أدخل تاريخ التنفيذ عند تحديد الحالة «مكتمل».';
      else if (reportDone === true && !report.provided) note = 'أدخل تاريخ التقرير عند تحديد الحالة «تم».';
      else if (reportDone === false && report.provided) note = 'امسح تاريخ التقرير عند تحديد الحالة «لم يتم».';
      else if (report.provided && reportDone === undefined && !row.reportDone) note = 'حدّد حالة التقرير «تم» قبل إدخال تاريخه.';

      const update: PlanUpdate = { row_id: row.id, plan_id: row.planId };
      if (status !== undefined && status !== null) {
        update.status = status;
        if (status !== 'done' && !execution.provided) update.execution_date = null;
      }
      if (execution.provided) update.execution_date = execution.value;
      if (reportDone !== undefined && reportDone !== null) {
        update.report_done = reportDone;
        if (!reportDone && !report.provided) update.report_done_date = null;
      }
      if (report.provided) update.report_done_date = report.value;
      if (Object.keys(update).length === 1 && !note) note = 'أدخل قيمة واحدة على الأقل للتحديث.';

      if (note) {
        result.push({ line, identifier, status: 'invalid', note });
        return;
      }
      usedRows.add(row.id);
      result.push({ line, identifier, status: 'matched', note: row.schoolName, update });
    });

    if (!result.length) throw new Error('لا توجد صفوف بيانات في الملف.');
    return result;
  }

  async function previewWorkbook(file: File | undefined) {
    if (!file) return;
    setMessage('');
    setFilePreview(null);
    try {
      if (file.size < 1 || file.size > 5 * 1024 * 1024) throw new Error('يجب ألا يتجاوز حجم ملف Excel خمسة ميغابايت.');
      const XLSX = await loadXlsx();
      const workbook = XLSX.read(await file.arrayBuffer(), { cellDates: false });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) throw new Error('لا توجد ورقة بيانات في الملف.');
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' });
      setFilePreview(buildFilePreview(matrix));
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function downloadTemplate() {
    try {
      const XLSX = await loadXlsx();
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headers]), 'تحديث الخطط العامة');
      XLSX.writeFile(workbook, 'قالب-تحديث-الخطط-العامة.xlsx');
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  function applyFilePreview() {
    const updates = (filePreview ?? [])
      .filter((row) => row.status === 'matched' && row.update)
      .map((row) => row.update!);
    void applyUpdates(updates, 'للصفوف المطابقة من الملف', 'file');
  }

  const fileMatchedCount = filePreview?.filter((row) => row.status === 'matched').length ?? 0;
  const numberMatchedCount = numbersPreview?.filter((row) => row.status === 'matched').length ?? 0;

  return (
    <details className="general-plan-bulk">
      <summary>تحديث جماعي · المحدد {selectedRows.length}</summary>
      <div className="general-plan-bulk-content">
        <p className="text-xs text-slate-500">حدّد صفوفاً من الجدول أو طابقها بالأرقام/الأسماء أو ملف Excel. في القالب، الخلايا الفارغة لا تغيّر الحقل؛ تُعرض المعاينة قبل الحفظ.</p>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1 text-xs font-semibold">حالة التنفيذ
            <select value={statusChange} onChange={(event) => setStatusChange(event.target.value as '' | PlanStatus)} className={inputClass}>
              <option value="">دون تغيير</option>
              <option value="planned">لم يبدأ</option>
              <option value="in_progress">جارٍ</option>
              <option value="done">مكتمل</option>
              <option value="cancelled">ملغى</option>
            </select>
          </label>
          {statusChange === 'done' && <label className="grid gap-1 text-xs font-semibold">تاريخ التنفيذ
            <input type="date" value={executionDate} onChange={(event) => setExecutionDate(event.target.value)} className={inputClass} />
          </label>}
          <label className="grid gap-1 text-xs font-semibold">حالة التقرير
            <select value={reportChange} onChange={(event) => setReportChange(event.target.value as '' | 'done' | 'pending')} className={inputClass}>
              <option value="">دون تغيير</option>
              <option value="done">تم إنجازه</option>
              <option value="pending">لم ينجز</option>
            </select>
          </label>
          {reportChange === 'done' && <label className="grid gap-1 text-xs font-semibold">تاريخ التقرير
            <input type="date" value={reportDate} onChange={(event) => setReportDate(event.target.value)} className={inputClass} />
          </label>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={disabled || busy || !selectedRows.length || !hasUniformChange} onClick={applySelected} className="rounded-lg bg-brand-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">
            تطبيق على المحدد ({selectedRows.length})
          </button>
          {selectedRows.length > 0 && <button type="button" disabled={busy} onClick={onClearSelected} className={buttonClass}>إلغاء التحديد</button>}
          <button type="button" disabled={disabled || busy} onClick={() => { setNumbersDialogOpen(true); setNumbersPreview(null); }} className={buttonClass}>تحديث بالأرقام أو الأسماء</button>
          <button type="button" disabled={busy} onClick={() => void downloadTemplate()} className={buttonClass}><Download size={15} className="me-1 inline" />قالب Excel</button>
          <label className={`cursor-pointer ${buttonClass} ${disabled || busy ? 'pointer-events-none opacity-50' : ''}`}><Upload size={15} className="me-1 inline" />معاينة ملف Excel<input className="hidden" type="file" accept=".xlsx" disabled={disabled || busy} onChange={(event) => { void previewWorkbook(event.target.files?.[0]); event.currentTarget.value = ''; }} /></label>
        </div>
        {numbersDialogOpen && <div className="general-plan-bulk-dialog" role="dialog" aria-modal="true" aria-labelledby="general-plan-bulk-numbers-title">
          <div className="general-plan-bulk-dialog-card">
            <div className="flex items-start justify-between gap-3">
              <div><h4 id="general-plan-bulk-numbers-title" className="font-bold">التحديث بالأرقام أو الأسماء</h4>
                <p className="mt-1 text-xs text-slate-500">تُطبّق الحالة والتواريخ المحددة أعلاه على المدارس المطابقة فقط.</p></div>
              <button type="button" onClick={() => setNumbersDialogOpen(false)} className="text-sm text-slate-600 underline">إغلاق</button>
            </div>
            <label className="grid gap-1 text-sm font-semibold">الأرقام الوزارية أو أسماء المدارس
              <textarea rows={5} value={pastedIdentifiers} onChange={(event) => { setPastedIdentifiers(event.target.value); setNumbersPreview(null); }} className={`${inputClass} w-full`} placeholder={'M010801 ٩٥١٨٣\nمدرسة أولى، مدرسة ثانية'} />
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={prepareNumberPreview} className={buttonClass}>معاينة المطابقة</button>
              {numbersPreview && <button type="button" disabled={disabled || busy || !numberMatchedCount || !hasUniformChange} onClick={applyNumberPreview} className="rounded-lg bg-brand-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">
                تأكيد التحديث ({numberMatchedCount})
              </button>}
            </div>
            {numbersPreview && <div className="max-h-56 overflow-auto rounded border text-xs">
              <table className="min-w-full text-start">
                <thead className="sticky top-0 bg-slate-100"><tr><th className="p-2">المدخل</th><th className="p-2">الحالة</th><th className="p-2">التفاصيل</th></tr></thead>
                <tbody>{numbersPreview.map((row) => <tr key={`${row.line}-${row.identifier}`} className="border-t border-slate-100">
                  <td className="p-2">{row.identifier}</td>
                  <td className="p-2">{row.status === 'matched' ? 'مطابق' : row.status === 'not_in_plan' ? 'خارج الخطة' : row.status === 'ambiguous' ? 'ملتبس' : row.status === 'duplicate' ? 'مكرر' : 'غير مطابق'}</td>
                  <td className="p-2">{row.note}</td>
                </tr>)}</tbody>
              </table>
            </div>}
          </div>
        </div>}
        {filePreview && <div className="grid gap-2">
          <p className="text-xs text-slate-600">المطابق: {fileMatchedCount} · غير صالح/غير مطابق: {filePreview.length - fileMatchedCount}</p>
          <div className="max-h-56 overflow-auto rounded border text-xs">
            <table className="min-w-full text-start">
              <thead className="sticky top-0 bg-slate-100"><tr><th className="p-2">الصف</th><th className="p-2">الرقم الوزاري</th><th className="p-2">الحالة</th><th className="p-2">التفاصيل</th></tr></thead>
              <tbody>{filePreview.map((row) => <tr key={row.line} className="border-t border-slate-100">
                <td className="p-2">{row.line}</td><td className="p-2">{row.identifier}</td>
                <td className="p-2">{row.status === 'matched' ? 'مطابق' : row.status === 'applied' ? 'تم' : row.status === 'failed' ? 'فشل' : row.status === 'not_in_plan' ? 'خارج الخطة' : row.status === 'ambiguous' ? 'ملتبس' : row.status === 'duplicate' ? 'مكرر' : row.status === 'invalid' ? 'غير صالح' : 'غير مطابق'}</td>
                <td className="p-2">{row.note}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <button type="button" disabled={disabled || busy || !fileMatchedCount} onClick={applyFilePreview} className="w-fit rounded-lg bg-brand-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">
            تطبيق الصفوف المطابقة فقط
          </button>
        </div>}
        {message && <p role="status" className="text-sm text-slate-700">{message}</p>}
      </div>
    </details>
  );
}

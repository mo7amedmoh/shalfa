import { useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { normalizeMinistryNumber, parseImportDate } from '../../domain/imports';
import {
  previewPlanIdentifierUpdates,
  getUnpersistedPlanUpdateIds,
  type MinistryIndexSchool,
  type PlanBulkUpdate,
  type PlanBulkAction,
  type PlanBulkPreviewCounts,
  type PlanBulkPreviewRow,
} from '../../domain/planBulkUpdates';
import { loadXlsx } from '../../lib/xlsx';
import { supabase } from '../../lib/supabase';

export type BulkPlanRow = {
  id: string;
  schoolName: string;
  ministryNumber: string;
  ministryKey: string;
  supervisorName: string | null;
  visited: boolean;
  visitedAt: string | null;
  reportAt: string | null;
};

type PlanKind = 'monthly' | 'custom';
type UpdateValues = PlanBulkUpdate;
type PreviewRow = {
  line: number;
  ministry: string;
  status: 'matched' | 'unmatched' | 'invalid' | 'applied' | 'failed';
  note: string;
  update?: UpdateValues;
  schoolName?: string;
};
type Props = {
  planKind: PlanKind;
  planId: string;
  rows: readonly BulkPlanRow[];
  disabled: boolean;
  onUpdated: () => void | Promise<void>;
  allSchools: readonly MinistryIndexSchool[];
};

const headers = ['الرقم الوزاري', 'تمت الزيارة (نعم/لا)', 'تاريخ الزيارة', 'تم التقرير (نعم/لا)', 'تاريخ التقرير'];
const inputClass = 'rounded-lg border border-slate-300 px-3 py-2 text-sm';
const buttonClass = 'rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-50';

function auditCountsPayload(counts: PlanBulkPreviewCounts, rowsInBatch: number, includePreviewTotals: boolean) {
  return {
    input_count: includePreviewTotals ? counts.input : 0,
    matched_count: rowsInBatch,
    unmatched_count: includePreviewTotals ? counts.unmatched : 0,
    not_in_plan_count: includePreviewTotals ? counts.notInPlan : 0,
    duplicate_count: includePreviewTotals ? counts.duplicate : 0,
    ambiguous_count: includePreviewTotals ? counts.ambiguous : 0,
    invalid_count: includePreviewTotals ? counts.invalid : 0,
  };
}

function databaseErrorDetails(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const databaseError = error as { code?: unknown; message: unknown; details?: unknown; hint?: unknown };
    const code = typeof databaseError.code === 'string' ? ` (${databaseError.code})` : '';
    const details = typeof databaseError.details === 'string' && databaseError.details ? ` — ${databaseError.details}` : '';
    const hint = typeof databaseError.hint === 'string' && databaseError.hint ? ` (${databaseError.hint})` : '';
    return `${String(databaseError.message)}${code}${details}${hint}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function parseYesNo(value: unknown): boolean | null {
  const normalized = String(value ?? '').trim().toLocaleLowerCase();
  if (['نعم', 'yes', 'y', 'true', '1'].includes(normalized)) return true;
  if (['لا', 'no', 'n', 'false', '0'].includes(normalized)) return false;
  return null;
}

function dateCell(value: unknown): { value: string | null; valid: boolean } {
  if (value === '' || value === null || value === undefined) return { value: null, valid: true };
  const date = parseImportDate(value);
  return { value: date, valid: date !== null };
}

export function BulkPlanUpdates({ planKind, planId, rows, disabled, onUpdated, allSchools }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [numbersDialogOpen, setNumbersDialogOpen] = useState(false);
  const [pastedNumbers, setPastedNumbers] = useState('');
  const [numberAction, setNumberAction] = useState<PlanBulkAction>('visit');
  const [numberVisitDate, setNumberVisitDate] = useState('');
  const [numberReportDate, setNumberReportDate] = useState('');
  const [numberPreview, setNumberPreview] = useState<PlanBulkPreviewRow[] | null>(null);
  const [numberPreviewCounts, setNumberPreviewCounts] = useState<PlanBulkPreviewCounts | null>(null);

  async function sendUpdates(
    updates: readonly UpdateValues[],
    sourceLines?: readonly number[],
    onChunkResult?: (offset: number, count: number, error: string | null) => void,
    auditCounts?: PlanBulkPreviewCounts,
  ) {
    if (!supabase || !planId) throw new Error('اختر فترة خطة أولاً.');
    if (disabled) throw new Error('لا تملك صلاحية التحديث الجماعي.');
    if (!updates.length) throw new Error('لم يتم تحديد صفوف صالحة للتحديث.');
    const table = planKind === 'monthly' ? 'monthly_plan_rows' : 'custom_plan_rows';
    const { error: schemaError } = await supabase.from(table).select('id,visited,visited_date,report_done,report_done_date').limit(0);
    if (schemaError) {
      throw new Error(`طبّق الترحيل 202611070002_bulk_plan_updates.sql قبل التحديث. ${databaseErrorDetails(schemaError)}`);
    }
    const { error: functionError } = await supabase.rpc('bulk_update_plan_rows', {
      p_plan_kind: planKind,
      p_plan_id: planId,
      p_updates: [],
      p_counts: {},
    });
    if (functionError) {
      throw new Error(`تعذر فحص التحديث الجماعي؛ طبّق الترحيل 202611070002_bulk_plan_updates.sql. ${databaseErrorDetails(functionError)}`);
    }
    let updated = 0;
    for (let offset = 0; offset < updates.length; offset += 100) {
      const batch = updates.slice(offset, offset + 100);
      const { data, error } = await supabase.rpc('bulk_update_plan_rows', {
        p_plan_kind: planKind,
        p_plan_id: planId,
        p_updates: batch,
        p_counts: auditCounts ? auditCountsPayload(auditCounts, batch.length, offset === 0) : {},
      });
      if (error) {
        const details = databaseErrorDetails(error);
        onChunkResult?.(offset, batch.length, details);
        const lineRange = sourceLines
          ? ` صفوف الملف ${sourceLines[offset]}–${sourceLines[Math.min(offset + batch.length - 1, sourceLines.length - 1)]}.`
          : '';
        throw new Error(`تعذر تحديث الدفعة ${Math.floor(offset / 100) + 1}${lineRange} ${details}`);
      }
      const result = typeof data === 'object' && data !== null && 'rows' in data
        ? (data as { rows?: unknown }).rows
        : null;
      if (typeof result !== 'number' || result !== batch.length) {
        throw new Error(`أعاد الخادم عدد تحديثات غير متوقع: ${String(result)} من ${batch.length}.`);
      }
      updated += result;
      onChunkResult?.(offset, batch.length, null);
    }
    const updatedIds = updates.map(({ row_id }) => row_id);
    const { data: savedRows, error: verifyError } = await supabase.from(table)
      .select('id,visited_date,report_done_date')
      .eq('plan_id', planId)
      .in('id', updatedIds);
    if (verifyError) throw new Error(`تم إرسال التحديث لكن تعذّر التحقق من القيم المحفوظة: ${databaseErrorDetails(verifyError)}`);
    const unpersisted = getUnpersistedPlanUpdateIds(updates, savedRows ?? []);
    if (unpersisted.length) throw new Error(`لم تُحفظ الحالة المطلوبة للصفوف: ${unpersisted.slice(0, 5).join('، ')}. أعد تحميل الخطة وتحقق من صلاحيات قاعدة البيانات.`);
    return updated;
  }

  function prepareNumberPreview() {
    try {
      const result = previewPlanIdentifierUpdates(
        pastedNumbers,
        rows.map((row) => ({
          id: row.id,
          schoolName: row.schoolName,
          ministryNumber: row.ministryNumber,
          ministryKey: row.ministryKey,
          visited: row.visited,
        })),
        allSchools,
        numberAction,
        numberVisitDate,
        numberReportDate,
      );
      if (!result.rows.length) throw new Error('أدخل رقماً وزارياً أو اسم مدرسة واحداً على الأقل.');
      setNumberPreview(result.rows);
      setNumberPreviewCounts(result.counts);
      setMessage('');
    } catch (error) {
      setNumberPreview(null);
      setNumberPreviewCounts(null);
      setMessage(databaseErrorDetails(error));
    }
  }

  async function applyNumberPreview() {
    if (!numberPreview || !numberPreviewCounts) return;
    const matched = numberPreview.filter((row) => row.status === 'matched' && row.update);
    if (!matched.length) {
      if (!supabase || !planId) {
        setMessage('اختر فترة خطة أولاً.');
        return;
      }
      if (disabled) {
        setMessage('لا تملك صلاحية التحديث الجماعي.');
        return;
      }
      if (!window.confirm('لن يتم تحديث أي صف؛ هل تريد تسجيل نتائج المعاينة في سجل التدقيق؟')) return;
      setBusy(true);
      setMessage('');
      try {
        const { error } = await supabase.rpc('bulk_update_plan_rows', {
          p_plan_kind: planKind,
          p_plan_id: planId,
          p_updates: [],
          p_counts: auditCountsPayload(numberPreviewCounts, 0, true),
        });
        if (error) throw new Error(`تعذر تسجيل المعاينة. ${databaseErrorDetails(error)}`);
        setMessage(`تم تسجيل نتائج المعاينة دون تعديل صفوف. غير مطابق: ${numberPreviewCounts.unmatched}، خارج الخطة: ${numberPreviewCounts.notInPlan}.`);
        setNumbersDialogOpen(false);
        setNumberPreview(null);
        setNumberPreviewCounts(null);
      } catch (error) {
        setMessage(databaseErrorDetails(error));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!window.confirm(`سيتم تحديث ${matched.length} صفاً موجوداً دون إنشاء صفوف. هل تريد المتابعة؟`)) return;
    setBusy(true);
    setMessage('');
    try {
      const updates = matched.map((row) => row.update!);
      const updated = await sendUpdates(updates, undefined, undefined, numberPreviewCounts);
      setMessage(`تم تحديث ${updated} صفاً. مطابق: ${numberPreviewCounts.matched}، غير مطابق: ${numberPreviewCounts.unmatched}، خارج الخطة: ${numberPreviewCounts.notInPlan}.`);
      setNumbersDialogOpen(false);
      setNumberPreview(null);
      setNumberPreviewCounts(null);
      setPastedNumbers('');
      await onUpdated();
    } catch (error) {
      setMessage(databaseErrorDetails(error));
    } finally {
      setBusy(false);
    }
  }

  async function downloadTemplate() {
    const XLSX = await loadXlsx();
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers]), 'تحديث جماعي');
    XLSX.writeFile(book, 'قالب-التحديث-الجماعي.xlsx');
  }

  async function previewWorkbook(file: File | undefined) {
    if (!file) return;
    setMessage('');
    setPreview(null);
    try {
      const XLSX = await loadXlsx();
      const workbook = XLSX.read(await file.arrayBuffer(), { cellDates: false });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) throw new Error('لا توجد ورقة بيانات في الملف.');
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' });
      const sourceHeaders = (matrix[0] ?? []).map((value) => String(value ?? '').trim());
      const columns = headers.map((header) => sourceHeaders.indexOf(header));
      if (columns.some((column) => column < 0)) throw new Error(`القالب يتطلب الأعمدة: ${headers.join('، ')}`);
      const byMinistry = new Map<string, BulkPlanRow[]>();
      for (const row of rows) {
        const matches = byMinistry.get(row.ministryKey) ?? [];
        matches.push(row);
        byMinistry.set(row.ministryKey, matches);
      }
      const usedRowIds = new Set<string>();
      const result: PreviewRow[] = [];
      matrix.slice(1).forEach((source, index) => {
        if (!source.some((value) => String(value ?? '').trim())) return;
        const line = index + 2;
        const ministry = String(source[columns[0]] ?? '');
        const key = normalizeMinistryNumber(ministry);
        const visited = parseYesNo(source[columns[1]]);
        const visitedDate = dateCell(source[columns[2]]);
        const reportDone = parseYesNo(source[columns[3]]);
        const reportDate = dateCell(source[columns[4]]);
        let note = '';
        if (!key) note = 'الرقم الوزاري مطلوب.';
        else if (visited === null || reportDone === null) note = 'يجب أن تكون حالتا الزيارة والتقرير نعم أو لا.';
        else if (!visitedDate.valid || !reportDate.valid) note = 'تاريخ غير صالح.';
        else if (visited !== Boolean(visitedDate.value) || reportDone !== Boolean(reportDate.value)) note = 'الحالة والتاريخ غير متطابقان.';
        if (note) {
          result.push({ line, ministry, status: 'invalid', note });
          return;
        }
        const matches = byMinistry.get(key) ?? [];
        if (!matches.length) {
          result.push({ line, ministry, status: 'unmatched', note: 'لا يوجد صف بهذا الرقم في الفترة المختارة.' });
          return;
        }
        if (matches.length > 1) {
          result.push({ line, ministry, status: 'invalid', note: 'الرقم الوزاري يطابق أكثر من صف في الفترة.' });
          return;
        }
        const row = matches[0];
        if (usedRowIds.has(row.id)) {
          result.push({ line, ministry, status: 'invalid', note: 'تكرر الرقم الوزاري في ملف التحديث.' });
          return;
        }
        if (reportDone && !visited) {
          result.push({ line, ministry, status: 'invalid', note: 'لا يمكن إكمال التقرير دون تسجيل زيارة في الملف.' });
          return;
        }
        usedRowIds.add(row.id);
        result.push({
          line, ministry, status: 'matched', note: row.schoolName, schoolName: row.schoolName,
          update: { row_id: row.id, visited_date: visitedDate.value, report_date: reportDate.value },
        });
      });
      if (!result.length) throw new Error('لا توجد صفوف بيانات في الملف.');
      setPreview(result);
    } catch (error) {
      setMessage(databaseErrorDetails(error));
    }
  }

  async function applyPreview() {
    if (!preview) return;
    setBusy(true);
    setMessage('');
    const matched = preview.filter((row) => row.status === 'matched' && row.update);
    try {
      const count = await sendUpdates(
        matched.map((row) => row.update!),
        matched.map((row) => row.line),
        (offset, batchSize, error) => {
          const batchLines = new Set(matched.slice(offset, offset + batchSize).map((row) => row.line));
          const lineRange = `${matched[offset].line}–${matched[offset + batchSize - 1].line}`;
          setPreview((current) => current?.map((row) => batchLines.has(row.line)
            ? {
              ...row,
              status: error ? 'failed' : 'applied',
              note: error ? `فشل الجزء الذي يضم أسطر الملف ${lineRange}: ${error}` : 'تم تطبيق التحديث.',
            }
            : row) ?? null);
        },
      );
      setMessage(`تم تحديث ${count} صفاً موجوداً. لم تُنشأ أي صفوف جديدة.`);
      setPreview(null);
      await onUpdated();
    } catch (error) {
      setMessage(databaseErrorDetails(error));
    } finally {
      setBusy(false);
    }
  }

  async function downloadPreviewReport() {
    if (!preview) return;
    const XLSX = await loadXlsx();
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
      ['صف الملف', 'الرقم الوزاري', 'الحالة', 'التفاصيل'],
      ...preview.map((row) => [row.line, row.ministry, row.status, row.note]),
    ]), 'نتيجة المعاينة');
    XLSX.writeFile(book, 'تقرير-معاينة-التحديث-الجماعي.xlsx');
  }

  return <section className="grid gap-4 rounded-xl border border-slate-200 p-4">
    <div>
      <h3 className="font-bold text-slate-900">تحديث جماعي</h3>
      <p className="mt-1 text-sm text-slate-500">اختر صفوف الفترة الحالية أو استخدم الأرقام الوزارية أو ملفاً. لا يتم إنشاء صفوف جديدة.</p>
    </div>
    <button type="button" disabled={disabled || busy} onClick={() => {
      setNumbersDialogOpen(true);
      setNumberPreview(null);
      setNumberPreviewCounts(null);
      setMessage('');
    }} className={buttonClass}>تحديث بالأرقام</button>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={() => void downloadTemplate()} className={buttonClass}><Download size={15} className="me-1 inline" />تنزيل قالب Excel</button>
      <label className={`cursor-pointer ${buttonClass} ${disabled || busy ? 'pointer-events-none opacity-50' : ''}`}><Upload size={15} className="me-1 inline" />معاينة ملف Excel<input className="hidden" type="file" accept=".xlsx" disabled={disabled || busy} onChange={(event) => { void previewWorkbook(event.target.files?.[0]); event.currentTarget.value = ''; }} /></label>
    </div>
    {preview && <div className="grid gap-3">
      <div className="flex flex-wrap gap-4 text-sm">
        <span>مطابق: {preview.filter((row) => row.status === 'matched').length}</span>
        <span>غير موجود: {preview.filter((row) => row.status === 'unmatched').length}</span>
        <span>غير صالح: {preview.filter((row) => row.status === 'invalid').length}</span>
        <span>فشل التحديث: {preview.filter((row) => row.status === 'failed').length}</span>
      </div>
      <div className="max-h-48 overflow-y-auto rounded border text-sm">
        {preview.map((row) => <div key={row.line} className="flex gap-3 border-b p-2 last:border-0">
          <span>{row.line}</span><span>{row.ministry || '—'}</span><strong>{({
            matched: 'مطابق', unmatched: 'غير موجود', invalid: 'غير صالح', applied: 'تم التحديث', failed: 'فشل',
          })[row.status]}</strong><span>{row.note}</span>
        </div>)}
      </div>
      <div className="flex gap-2">
        <button type="button" disabled={disabled || busy || !preview.some((row) => row.status === 'matched')} onClick={() => void applyPreview()} className="rounded-lg bg-brand-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">تطبيق الصفوف المطابقة فقط</button>
        <button type="button" onClick={() => void downloadPreviewReport()} className={buttonClass}>تنزيل تقرير المعاينة</button>
      </div>
    </div>}
    {numbersDialogOpen && <div className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="plan-number-update-title">
      <div className="my-4 grid max-h-[90vh] w-full max-w-4xl gap-4 overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div><h4 id="plan-number-update-title" className="font-bold text-slate-900">تحديث بالأرقام أو الأسماء</h4>
            <p className="mt-1 text-sm text-slate-500">يمكن إدخال الأرقام الوزارية مفصولة بمسافات، أو أسماء المدارس مفصولة بأسطر أو فواصل. تطابق الأسماء دقيق بعد توحيد التشكيل والمسافات. لن تُنشأ أي صفوف.</p></div>
          <button type="button" onClick={() => setNumbersDialogOpen(false)} className="text-sm text-slate-600 underline">إغلاق</button>
        </div>
        <label className="grid gap-1 text-sm font-semibold">الأرقام الوزارية أو أسماء المدارس
          <textarea rows={5} value={pastedNumbers} onChange={(event) => {
            setPastedNumbers(event.target.value);
            setNumberPreview(null);
            setNumberPreviewCounts(null);
          }} className={`${inputClass} w-full`} placeholder={'M010801 ٩٥١٨٣\nمدرسة أولى، مدرسة ثانية'} />
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1 text-sm font-semibold">الإجراء
            <select value={numberAction} onChange={(event) => {
              setNumberAction(event.target.value as PlanBulkAction);
              setNumberPreview(null);
              setNumberPreviewCounts(null);
            }} className={inputClass}>
              <option value="visit">تمت الزيارة + تاريخ</option>
              <option value="report">تم التقرير + تاريخ</option>
              <option value="both">الزيارة والتقرير + التاريخين</option>
            </select>
          </label>
          {(numberAction === 'visit' || numberAction === 'both') && <label className="grid gap-1 text-sm font-semibold">تاريخ الزيارة
            <input type="date" value={numberVisitDate} onChange={(event) => { setNumberVisitDate(event.target.value); setNumberPreview(null); }} className={inputClass} />
          </label>}
          {(numberAction === 'report' || numberAction === 'both') && <label className="grid gap-1 text-sm font-semibold">تاريخ التقرير
            <input type="date" value={numberReportDate} onChange={(event) => { setNumberReportDate(event.target.value); setNumberPreview(null); }} className={inputClass} />
          </label>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy || disabled} onClick={prepareNumberPreview} className={buttonClass}>معاينة المطابقة</button>
          {numberPreview && <button type="button" disabled={busy || disabled} onClick={() => void applyNumberPreview()} className="rounded-lg bg-brand-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">
            {numberPreview.some((row) => row.status === 'matched') ? 'تأكيد التحديث' : 'تأكيد وتسجيل المعاينة'}
          </button>}
        </div>
        {numberPreview && numberPreviewCounts && <div className="grid gap-3">
          <div className="flex flex-wrap gap-4 text-sm">
            <span>مطابق: {numberPreviewCounts.matched}</span>
            <span>غير مطابق: {numberPreviewCounts.unmatched}</span>
            <span>ليس في الخطة: {numberPreviewCounts.notInPlan}</span>
            {numberPreviewCounts.duplicate > 0 && <span>مكرر: {numberPreviewCounts.duplicate}</span>}
            {numberPreviewCounts.ambiguous > 0 && <span>ملتبس: {numberPreviewCounts.ambiguous}</span>}
            {numberPreviewCounts.invalid > 0 && <span>غير صالح: {numberPreviewCounts.invalid}</span>}
          </div>
          <div className="max-h-64 overflow-auto rounded border text-sm">
            <table className="min-w-full text-start">
              <thead className="sticky top-0 bg-slate-100"><tr><th className="p-2">#</th><th className="p-2">المدخل</th><th className="p-2">الحالة</th><th className="p-2">التفاصيل</th></tr></thead>
              <tbody>{numberPreview.map((row) => <tr key={`${row.line}-${row.identifier}`} className="border-t border-slate-100">
                <td className="p-2">{row.line}</td><td className="p-2">{row.identifier}</td>
                <td className="p-2">{({
                  matched: 'مطابق', unmatched: 'غير مطابق', not_in_plan: 'ليس في الخطة',
                  duplicate: 'مكرر', ambiguous: 'ملتبس', invalid: 'غير صالح',
                })[row.status]}</td><td className="p-2">{row.note}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </div>}
        {message && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{message}</p>}
      </div>
    </div>}
    {!numbersDialogOpen && message && <p role="status" className="text-sm text-slate-700">{message}</p>}
  </section>;
}

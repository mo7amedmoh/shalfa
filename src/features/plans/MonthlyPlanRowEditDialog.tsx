import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeftRight, History, X } from 'lucide-react';
import { z } from 'zod';
import { useDisplayFormat } from '../../app/useDisplayFormat';
import {
  buildPlanEditReason,
  getPlanEditWarnings,
  planEditWarningLabel,
  requiresVisitEditReason,
  type PlanEditWarning,
  type PlanEditScheduleRow,
} from '../../domain/planRowEdit';
import { APP_SCHEMA_SELECT } from '../../lib/schemaColumns';
import { supabase } from '../../lib/supabase';

type PlanSchool = {
  id: string;
  school_name: string;
  ministry_number: string;
  ministry_key: string;
};

type EditablePlanRow = PlanEditScheduleRow & {
  school_id: string;
  supervisor_name: string | null;
  visited: boolean;
  visited_at: string | null;
  original_planned_date: string | null;
  original_school_id: string | null;
  original_supervisor_id: string | null;
  edited_at: string | null;
  school: {
    school_name: string;
    ministry_number: string;
    ministry_key: string;
  } | null;
};

type Supervisor = { id: string; full_name: string };
type ChangeRequest = {
  rowId: string;
  changes: Record<string, string | null>;
  reason: string | null;
};

const auditEventSchema = z.object({
  id: z.number(),
  actor_id: z.string().uuid().nullable(),
  action: z.string(),
  entity: z.string().nullable(),
  entity_id: z.string().nullable(),
  details: z.record(z.string(), z.unknown()).nullable(),
  created_at: z.string(),
});

type Props = {
  row: EditablePlanRow;
  rows: readonly EditablePlanRow[];
  allSchools: readonly PlanSchool[];
  eligibleSchools: readonly PlanSchool[];
  supervisors: readonly Supervisor[];
  supervisorError?: string;
  saving: boolean;
  error?: string;
  onClose: () => void;
  onSave: (request: ChangeRequest) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function loadRowHistory(rowId: string) {
  if (!supabase) return [];
  const { data, error } = await supabase.from('audit_log')
    .select(APP_SCHEMA_SELECT.auditLog)
    .eq('action', 'edit_plan_row')
    .eq('table_name', 'monthly_plan_rows')
    .eq('row_id', rowId)
    .order('at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return z.array(auditEventSchema).parse(data);
}

function wasVisited(row: EditablePlanRow): boolean {
  return row.visited || Boolean(row.visited_at);
}

export function MonthlyPlanRowEditDialog({
  row,
  rows,
  allSchools,
  eligibleSchools,
  supervisors,
  supervisorError,
  saving,
  error,
  onClose,
  onSave,
}: Props) {
  const { formatDate, formatDateTime } = useDisplayFormat();
  const [plannedDate, setPlannedDate] = useState(row.plannedDate);
  const [supervisorId, setSupervisorId] = useState(row.supervisorId ?? '');
  const [schoolMode, setSchoolMode] = useState<'replace' | 'swap'>('replace');
  const [schoolSearch, setSchoolSearch] = useState('');
  const [schoolId, setSchoolId] = useState('');
  const [swapRowId, setSwapRowId] = useState('');
  const [reason, setReason] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const history = useQuery({
    queryKey: ['monthly-plan-row-history', row.id],
    queryFn: () => loadRowHistory(row.id),
    enabled: historyOpen,
  });
  const swapRow = rows.find((item) => item.id === swapRowId);
  const schoolsInPlan = useMemo(() => new Set(rows.map((item) => item.school_id)), [rows]);
  const replacementSchools = useMemo(() => {
    const search = schoolSearch.trim().toLocaleLowerCase();
    return eligibleSchools.filter((school) => !schoolsInPlan.has(school.id)
      && (!search
        || school.school_name.toLocaleLowerCase().includes(search)
        || school.ministry_number.toLocaleLowerCase().includes(search)
        || school.ministry_key.toLocaleLowerCase().includes(search)));
  }, [eligibleSchools, schoolSearch, schoolsInPlan]);

  const schoolChanged = schoolMode === 'swap'
    ? Boolean(swapRow && row.school_id !== swapRow.school_id)
    : Boolean(schoolId && schoolId !== row.school_id);
  const dateChanged = schoolMode === 'swap'
    ? Boolean(swapRow && row.plannedDate !== swapRow.plannedDate)
    : plannedDate !== row.plannedDate;
  const supervisorChanged = schoolMode === 'swap'
    ? Boolean(swapRow && row.supervisorId !== swapRow.supervisorId)
    : supervisorId !== (row.supervisorId ?? '');
  const scheduleChanged = dateChanged || supervisorChanged;

  const warnings = useMemo<PlanEditWarning[]>(() => {
    if (schoolMode === 'swap' && swapRow) {
      const excludedRowIds = [row.id, swapRow.id];
      const firstWarnings = getPlanEditWarnings({
        plannedDate: swapRow.plannedDate,
        supervisorId: swapRow.supervisorId,
        rows,
        excludedRowIds,
        scheduleChanged: row.plannedDate !== swapRow.plannedDate || row.supervisorId !== swapRow.supervisorId,
      });
      const secondWarnings = getPlanEditWarnings({
        plannedDate: row.plannedDate,
        supervisorId: row.supervisorId,
        rows,
        excludedRowIds,
        scheduleChanged: row.plannedDate !== swapRow.plannedDate || row.supervisorId !== swapRow.supervisorId,
      });
      return [...new Set([...firstWarnings, ...secondWarnings])];
    }
    return getPlanEditWarnings({
      plannedDate,
      supervisorId: supervisorId || null,
      rows,
      excludedRowIds: [row.id],
      scheduleChanged,
    });
  }, [plannedDate, row, rows, schoolMode, scheduleChanged, supervisorId, swapRow]);

  const requiresReason = schoolMode === 'swap'
    ? Boolean(swapRow && (
      (wasVisited(row) && (schoolChanged || dateChanged))
      || (wasVisited(swapRow) && (schoolChanged || dateChanged))
    ))
    : requiresVisitEditReason({
      visited: wasVisited(row),
      schoolChanged,
      dateChanged,
    });
  const visitedRows = schoolMode === 'swap' && swapRow
    ? [row, swapRow].filter(wasVisited)
    : wasVisited(row) ? [row] : [];

  const changes = useMemo<Record<string, string | null>>(() => {
    const nextChanges: Record<string, string | null> = {};
    if (schoolMode === 'swap') {
      if (swapRow) nextChanges.swap_row_id = swapRow.id;
      return nextChanges;
    }
    if (schoolChanged) nextChanges.school_id = schoolId;
    if (dateChanged) nextChanges.planned_date = plannedDate;
    if (supervisorChanged) nextChanges.supervisor_id = supervisorId || null;
    return nextChanges;
  }, [dateChanged, plannedDate, schoolChanged, schoolId, schoolMode, supervisorChanged, supervisorId, swapRow]);
  const hasChanges = Object.keys(changes).length > 0;
  const reasonMissing = requiresReason && !reason.trim();
  const supervisorOptions = supervisors.some((supervisor) => supervisor.id === row.supervisorId)
    || !row.supervisorId
    ? supervisors
    : [...supervisors, { id: row.supervisorId, full_name: row.supervisor_name ?? row.supervisorId }];
  const schoolNames = new Map(allSchools.map((school) => [school.id, school.school_name]));
  const supervisorNames = new Map(supervisorOptions.map((supervisor) => [supervisor.id, supervisor.full_name]));

  function submit(overrideWarnings: boolean) {
    if (saving || !hasChanges || reasonMissing || (schoolMode === 'swap' && !swapRow)) return;
    onSave({
      rowId: row.id,
      changes,
      reason: buildPlanEditReason(reason, overrideWarnings ? warnings : []),
    });
  }

  function auditValue(field: string, value: unknown): string {
    if (value === null || value === undefined || value === '') return '—';
    if (field === 'planned_date') return formatDate(String(value));
    if (field === 'school_id') return schoolNames.get(String(value)) ?? String(value);
    if (field === 'supervisor_id') return supervisorNames.get(String(value)) ?? String(value);
    return String(value);
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-5" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="monthly-plan-edit-title"
        className="flex max-h-[94vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
        dir="rtl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 p-4 sm:p-5">
          <div className="min-w-0">
            <h2 id="monthly-plan-edit-title" className="text-lg font-bold text-brand-900">تعديل صف الخطة</h2>
            <p className="mt-1 truncate text-sm text-slate-500">{row.school?.school_name ?? row.school_id}</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="إغلاق نافذة التعديل" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50">
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div className="grid gap-4 overflow-y-auto p-4 sm:p-5">
          {visitedRows.length > 0 && <div role="note" className="flex gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            <AlertTriangle className="mt-0.5 shrink-0" size={18} aria-hidden="true" />
            <p>تمت زيارة {visitedRows.length > 1 ? 'إحدى المدرستين' : 'هذه المدرسة'}. تغيير المدرسة أو الموعد يتطلب سببًا نصيًا. {visitedRows[0].visited_at ? `تاريخ الزيارة: ${formatDate(visitedRows[0].visited_at)}.` : ''}</p>
          </div>}

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-bold text-slate-800">تغيير المدرسة</legend>
            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm">
              <input type="radio" name="monthly-school-edit-mode" checked={schoolMode === 'replace'} onChange={() => {
                setSchoolMode('replace');
                setSwapRowId('');
              }} />
              <span><strong className="block">استبدال بمدرسة غير مدرجة في الخطة</strong><small className="text-slate-500">المدارس المعروضة مؤهلة لهذا النوع من الخطط.</small></span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm">
              <input type="radio" name="monthly-school-edit-mode" checked={schoolMode === 'swap'} onChange={() => {
                setSchoolMode('swap');
                setSchoolId('');
              }} />
              <span><strong className="block">تبديل مع مدرسة أخرى في الخطة</strong><small className="text-slate-500">ستتبادل المدرستان الموعد والمشرف أيضًا.</small></span>
            </label>
          </fieldset>

          {schoolMode === 'replace' ? (
            <div className="grid gap-2">
              <label htmlFor="monthly-replacement-school-search" className="text-sm font-semibold">ابحث عن مدرسة مؤهلة غير مدرجة</label>
              <input
                id="monthly-replacement-school-search"
                type="search"
                value={schoolSearch}
                onChange={(event) => setSchoolSearch(event.target.value)}
                placeholder="اسم المدرسة أو الرقم الوزاري"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <select aria-label="اختر المدرسة البديلة" value={schoolId} onChange={(event) => setSchoolId(event.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                <option value="">من دون تغيير المدرسة</option>
                {replacementSchools.map((school) => <option key={school.id} value={school.id}>{school.school_name} · {school.ministry_number}</option>)}
              </select>
              {!replacementSchools.length && <p className="text-xs text-slate-500">لا توجد مدارس مؤهلة غير مدرجة تطابق البحث.</p>}

              <label htmlFor="monthly-plan-edit-date" className="mt-2 text-sm font-semibold">الموعد</label>
              <input id="monthly-plan-edit-date" type="date" required value={plannedDate} onChange={(event) => setPlannedDate(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <label htmlFor="monthly-plan-edit-supervisor" className="mt-2 text-sm font-semibold">المشرف</label>
              <select id="monthly-plan-edit-supervisor" value={supervisorId} onChange={(event) => setSupervisorId(event.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                <option value="">دون مشرف</option>
                {supervisorOptions.map((supervisor) => <option key={supervisor.id} value={supervisor.id}>{supervisor.full_name}</option>)}
              </select>
              {supervisorError && <p role="alert" className="text-xs text-rose-700">تعذر تحميل قائمة المشرفين: {supervisorError}</p>}
            </div>
          ) : (
            <div className="grid gap-2">
              <label htmlFor="monthly-plan-swap-row" className="text-sm font-semibold">المدرسة الأخرى في الخطة</label>
              <select id="monthly-plan-swap-row" value={swapRowId} onChange={(event) => setSwapRowId(event.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                <option value="">اختر مدرسة</option>
                {rows.filter((item) => item.id !== row.id).map((item) => <option key={item.id} value={item.id}>{item.school?.school_name ?? item.school_id} · {formatDate(item.plannedDate)}</option>)}
              </select>
              {swapRow && <div className="flex items-start gap-2 rounded-lg bg-indigo-50 p-3 text-sm text-indigo-950">
                <ArrowLeftRight className="mt-0.5 shrink-0" size={18} aria-hidden="true" />
                <p>ستتبادل المدرستان الموعد والمشرف في عملية واحدة، وسيُسجل التعديل لكل صف.</p>
              </div>}
            </div>
          )}

          {warnings.length > 0 && <div role="alert" className="grid gap-1 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            <p className="font-bold">تنبيه جدولة — يمكنك المتابعة مع التجاوز:</p>
            {warnings.map((warning) => <p key={warning}>• {planEditWarningLabel(warning)}</p>)}
          </div>}

          <label htmlFor="monthly-plan-edit-reason" className="grid gap-1 text-sm font-semibold">
            سبب التعديل {requiresReason ? <span className="text-rose-700">(مطلوب)</span> : <span className="font-normal text-slate-500">(اختياري)</span>}
            <textarea
              id="monthly-plan-edit-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              required={requiresReason}
              placeholder={requiresReason ? 'اكتب سبب تعديل مدرسة تمت زيارتها' : 'يمكنك إضافة ملاحظة توضيحية'}
              className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
            />
          </label>
          {reasonMissing && <p role="alert" className="text-xs text-rose-700">أدخل سببًا قبل حفظ تعديل المدرسة أو الموعد لصف تمت زيارته.</p>}
          {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}

          <section className="border-t border-slate-200 pt-3">
            <button type="button" onClick={() => setHistoryOpen((open) => !open)} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">
              <History size={16} aria-hidden="true" />
              {historyOpen ? 'إخفاء سجل التعديلات' : 'سجل التعديلات'}
            </button>
            {historyOpen && <div className="mt-3 grid gap-3">
              {history.isLoading && <p role="status" className="text-sm text-slate-500">جارٍ تحميل السجل…</p>}
              {history.error && <p role="alert" className="text-sm text-rose-700">تعذر تحميل سجل التعديلات: {history.error.message}</p>}
              {!history.isLoading && !history.error && !history.data?.length && <p className="text-sm text-slate-500">لا توجد تعديلات مسجلة لهذا الصف.</p>}
              {history.data?.map((event) => {
                const changes = event.details?.changes;
                return <article key={event.id} className="grid gap-2 rounded-lg border border-slate-200 p-3 text-sm">
                  <div className="flex flex-wrap justify-between gap-1">
                    <strong>{formatDateTime(event.created_at)}</strong>
                    <span className="text-xs text-slate-500">المستخدم: {event.actor_id ?? 'غير محدد'}</span>
                  </div>
                  {isRecord(changes) && Object.entries(changes).map(([field, value]) => {
                    if (!isRecord(value)) return null;
                    const labels: Record<string, string> = { school_id: 'المدرسة', supervisor_id: 'المشرف', planned_date: 'الموعد' };
                    return <p key={field} className="break-words text-slate-700">
                      <strong>{labels[field] ?? field}:</strong> {auditValue(field, value.old)} ← {auditValue(field, value.new)}
                    </p>;
                  })}
                  {typeof event.details?.reason === 'string' && event.details.reason && <p className="whitespace-pre-wrap text-slate-600"><strong>السبب:</strong> {event.details.reason}</p>}
                </article>;
              })}
            </div>}
          </section>
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-slate-200 p-4 sm:flex-row sm:justify-end sm:p-5">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">إلغاء</button>
          <button
            type="button"
            onClick={() => submit(warnings.length > 0)}
            disabled={saving || !hasChanges || reasonMissing || (schoolMode === 'swap' && !swapRow) || (schoolMode === 'replace' && !plannedDate)}
            className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'جارٍ الحفظ…' : warnings.length ? 'حفظ مع التجاوز' : 'حفظ التعديلات'}
          </button>
        </footer>
      </section>
    </div>
  );
}

import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { useDisplayFormat } from '../../app/useDisplayFormat';
import { currentMonthBusinessDays, parseMinistryNumberList } from '../../domain/schoolSupervisorAssignments';
import { SCHOOL_SIZE_LABELS, SCHOOL_SIZES } from '../../domain/staffing';
import { supabase } from '../../lib/supabase';

type Service = 'maintenance' | 'cleaning';
type SupervisorOption = { id: string; full_name: string };
type AssignmentRow = {
  assignment_id: string;
  school_id: string;
  school_name: string;
  ministry_number: string;
  school_size: string | null;
  service: Service;
  valid_from: string;
};
type PreviewRow = {
  ministry_number: string;
  school_id: string | null;
  school_name: string | null;
  school_size: string | null;
  valid_from: string | null;
  assigned_employee_id: string | null;
  assigned_employee_name: string | null;
  outcome: 'matched' | 'already_assigned' | 'not_found' | 'conflict' | 'ambiguous';
};

const assignmentSchema = z.object({
  assignment_id: z.string().uuid(),
  school_id: z.string().uuid(),
  school_name: z.string(),
  ministry_number: z.string(),
  school_size: z.string().nullable(),
  service: z.enum(['maintenance', 'cleaning']),
  valid_from: z.string(),
});
const previewSchema = z.object({
  ministry_number: z.string(),
  school_id: z.string().uuid().nullable(),
  school_name: z.string().nullable(),
  school_size: z.string().nullable(),
  valid_from: z.string().nullable(),
  assigned_employee_id: z.string().uuid().nullable(),
  assigned_employee_name: z.string().nullable(),
  outcome: z.enum(['matched', 'already_assigned', 'not_found', 'conflict', 'ambiguous']),
});
const resultSchema = z.object({
  matched: z.number().int(),
  not_found: z.number().int(),
  conflicts: z.number().int(),
});
const holidaySchema = z.object({ holiday_date: z.string() });

function localDate(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function loadAssignments(employeeId: string): Promise<AssignmentRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('list_employee_school_assignments', { p_employee_id: employeeId });
  if (error) throw error;
  return z.array(assignmentSchema).parse(data);
}

async function loadMonthHolidays(month: string): Promise<string[]> {
  if (!supabase) return [];
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const { data, error } = await supabase.from('plan_holidays')
    .select('holiday_date')
    .gte('holiday_date', `${month}-01`)
    .lte('holiday_date', `${month}-${String(lastDay).padStart(2, '0')}`);
  if (error) throw error;
  return z.array(holidaySchema).parse(data).map(({ holiday_date }) => holiday_date);
}

function schoolSizeLabel(value: string | null): string {
  if (!value) return 'غير محدد';
  const size = SCHOOL_SIZES.find((candidate) => candidate === value);
  return size ? SCHOOL_SIZE_LABELS[size] : value;
}

const statusLabels: Record<PreviewRow['outcome'], string> = {
  matched: 'مطابق',
  already_assigned: 'مسندة لهذا المشرف',
  not_found: 'غير موجود',
  conflict: 'تحت مشرف آخر',
  ambiguous: 'رقم مكرر في سجل المدارس',
};

export function SupervisorSchoolAssignmentsPanel({
  employee,
  supervisors,
  canManage,
}: {
  employee: { id: string; full_name: string };
  supervisors: SupervisorOption[];
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const { formatDate, formatNumber } = useDisplayFormat();
  const today = localDate();
  const currentMonth = today.slice(0, 7);
  const [service, setService] = useState<Service>('maintenance');
  const [input, setInput] = useState('');
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [conflictActions, setConflictActions] = useState<Record<string, 'skip' | 'move'>>({});
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [savingAssignments, setSavingAssignments] = useState(false);
  const [removingSchoolId, setRemovingSchoolId] = useState('');
  const [transferringSchools, setTransferringSchools] = useState(false);
  const [transferTarget, setTransferTarget] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(today);
  const [updateFuturePlans, setUpdateFuturePlans] = useState(false);
  const [message, setMessage] = useState('');
  const assignments = useQuery({
    queryKey: ['employee-school-assignments', employee.id],
    queryFn: () => loadAssignments(employee.id),
  });
  const holidays = useQuery({
    queryKey: ['plan-holidays', currentMonth],
    queryFn: () => loadMonthHolidays(currentMonth),
  });
  const currentAssignments = useMemo(
    () => (assignments.data ?? []).filter((assignment) => assignment.service === service),
    [assignments.data, service],
  );
  const workingDays = useMemo(
    () => currentMonthBusinessDays(today, holidays.data ?? []),
    [today, holidays.data],
  );
  const normalizedNumbers = useMemo(() => parseMinistryNumberList(input), [input]);

  async function previewAssignments() {
    setMessage('');
    setPreview([]);
    if (!supabase || !normalizedNumbers.length) {
      setMessage('أدخل رقمًا وزاريًا واحدًا على الأقل.');
      return;
    }
    if (normalizedNumbers.length > 5000) {
      setMessage('الحد الأقصى 5000 رقم وزاري في كل معاينة.');
      return;
    }
    setLoadingPreview(true);
    try {
      const { data, error } = await supabase.rpc('preview_employee_school_assignments', {
        p_employee_id: employee.id,
        p_service: service,
        p_ministry_numbers: normalizedNumbers,
      });
      if (error) throw error;
      const rows = z.array(previewSchema).parse(data);
      setPreview(rows);
      setConflictActions(Object.fromEntries(rows
        .filter((row) => row.outcome === 'conflict')
        .map((row) => [row.ministry_number, 'skip'])));
    } catch (error) {
      setMessage(`تعذرت معاينة المدارس: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoadingPreview(false);
    }
  }

  async function assignSchools() {
    if (!supabase || !preview.length) return;
    const groups: Record<'skip' | 'move', string[]> = { skip: [], move: [] };
    for (const row of preview) {
      if (row.outcome === 'not_found' || row.outcome === 'ambiguous') continue;
      const action = row.outcome === 'conflict' ? conflictActions[row.ministry_number] ?? 'skip' : 'skip';
      groups[action].push(row.ministry_number);
    }
    const pending = (Object.entries(groups) as Array<['skip' | 'move', string[]]>)
      .filter(([, numbers]) => numbers.length);
    if (!pending.length) {
      setMessage('لا توجد مدارس قابلة للإسناد في المعاينة.');
      return;
    }
    setSavingAssignments(true);
    setMessage('');
    let completed = 0;
    let matched = 0;
    let conflicts = 0;
    let notFound = 0;
    try {
      for (const [action, numbers] of pending) {
        const { data, error } = await supabase.rpc('assign_schools', {
          p_employee_id: employee.id,
          p_service: service,
          p_ministry_numbers: numbers,
          p_on_conflict: action,
        });
        if (error) throw error;
        const result = resultSchema.parse(data);
        matched += result.matched;
        conflicts += result.conflicts;
        notFound += result.not_found;
        completed += 1;
      }
      setMessage(`اكتمل الإسناد: ${formatNumber(matched)} مدرسة${conflicts ? `، وتُركت ${formatNumber(conflicts)} بسبب تعارض` : ''}${notFound ? `، وتعذر العثور على ${formatNumber(notFound)}` : ''}.`);
      setInput('');
      setPreview([]);
    } catch (error) {
      setMessage(`${completed ? 'اكتمل جزء من الإسناد' : 'تعذر إسناد المدارس'}: ${error instanceof Error ? error.message : String(error)}. راجع القائمة المحدثة قبل إعادة المحاولة.`);
    } finally {
      setSavingAssignments(false);
      await queryClient.invalidateQueries({ queryKey: ['employee-school-assignments', employee.id] });
    }
  }

  async function removeSchool(schoolId: string, schoolName: string) {
    if (!supabase || !window.confirm(`إزالة إسناد «${schoolName}» من ${employee.full_name} اعتبارًا من اليوم؟`)) return;
    setMessage('');
    setRemovingSchoolId(schoolId);
    try {
      const { data, error } = await supabase.rpc('unassign_school', {
        p_school_id: schoolId,
        p_service: service,
      });
      if (error) throw error;
      const result = z.object({ unassigned: z.boolean() }).parse(data);
      setMessage(result.unassigned ? 'تمت إزالة إسناد المدرسة.' : 'لم يتغير الإسناد؛ حدّث القائمة للتحقق من الحالة الحالية.');
      await queryClient.invalidateQueries({ queryKey: ['employee-school-assignments', employee.id] });
    } catch (error) {
      setMessage(`تعذر إزالة المدرسة: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setRemovingSchoolId('');
    }
  }

  async function transferAllSchools(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !transferTarget) {
      setMessage('اختر المشرف البديل.');
      return;
    }
    setMessage('');
    setTransferringSchools(true);
    try {
      const { data, error } = await supabase.rpc('transfer_supervisor_schools', {
        p_from_employee_id: employee.id,
        p_to_employee_id: transferTarget,
        p_effective_date: effectiveDate,
        p_update_future_plans: updateFuturePlans,
      });
      if (error) throw error;
      const result = z.object({
        assignments_moved: z.number().int(),
        future_plans_updated: z.number().int(),
      }).parse(data);
      const targetName = supervisors.find(({ id }) => id === transferTarget)?.full_name ?? '';
      setMessage(`نُقلت ${formatNumber(result.assignments_moved)} إسنادات إلى ${targetName}، وتم تحديث ${formatNumber(result.future_plans_updated)} زيارة قادمة.`);
      setTransferTarget('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['employee-school-assignments', employee.id] }),
        queryClient.invalidateQueries({ queryKey: ['employee-school-assignments', transferTarget] }),
        queryClient.invalidateQueries({ queryKey: ['monthly-plan-rows'] }),
        queryClient.invalidateQueries({ queryKey: ['cleaner-placement-data'] }),
      ]);
    } catch (error) {
      setMessage(`تعذر نقل المدارس: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setTransferringSchools(false);
    }
  }

  return (
    <section className="grid gap-4 py-4" aria-labelledby="assigned-schools-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 id="assigned-schools-title" className="font-bold">المدارس المسندة</h4>
          <p className="mt-1 text-xs text-slate-500">المدارس النشطة المسندة لهذا المشرف.</p>
        </div>
        <label className="grid gap-1 text-xs font-semibold text-slate-600">الخدمة
          <select value={service} onChange={(event) => { setService(event.target.value as Service); setPreview([]); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
            <option value="maintenance">الصيانة</option>
            <option value="cleaning">النظافة</option>
          </select>
        </label>
      </div>
      {service === 'maintenance' && <div className={`rounded-xl border p-3 ${currentAssignments.length > workingDays.length ? 'border-amber-300 bg-amber-50 text-amber-950' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
        <p className="font-semibold">مؤشر السعة للصيانة · الشهر الحالي</p>
        {holidays.error
          ? <p role="alert" className="mt-1 text-sm">تعذر احتساب أيام العمل: {holidays.error.message}</p>
          : <p className="mt-1 text-sm">{formatNumber(currentAssignments.length)} مدرسة مقابل {formatNumber(workingDays.length)} يوم عمل (زيارة واحدة يوميًا).</p>}
        {!holidays.error && currentAssignments.length > workingDays.length && <p role="alert" className="mt-1 text-sm font-bold">تحذير: عدد المدارس يتجاوز أيام العمل المتاحة.</p>}
      </div>}
      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h5 className="text-sm font-bold">المدارس الحالية <span className="text-slate-500">({formatNumber(currentAssignments.length)})</span></h5>
          {assignments.isFetching && <span role="status" className="text-xs text-slate-500">جارٍ التحديث…</span>}
        </div>
        {assignments.error && <p role="alert" className="mb-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">تعذر تحميل الإسنادات: {assignments.error.message}</p>}
        <div className="table-scroll workforce-table-scroll" role="region" aria-label="المدارس الحالية المسندة" tabIndex={0}>
          <table className="workforce-table min-w-[700px]">
            <thead><tr><th scope="col">الاسم</th><th scope="col">الرقم الوزاري</th><th scope="col">الحجم</th><th scope="col">منذ تاريخ</th>{canManage && <th scope="col">إجراء</th>}</tr></thead>
            <tbody>{currentAssignments.map((school) => <tr key={school.assignment_id}>
              <td data-label="الاسم">{school.school_name}</td>
              <td data-label="الرقم الوزاري"><span dir="ltr" className="font-mono">{school.ministry_number}</span></td>
              <td data-label="الحجم">{schoolSizeLabel(school.school_size)}</td>
              <td data-label="منذ تاريخ">{formatDate(school.valid_from)}</td>
              {canManage && <td data-label="إجراء"><button type="button" onClick={() => void removeSchool(school.school_id, school.school_name)} disabled={Boolean(removingSchoolId)} className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-800 disabled:opacity-50">{removingSchoolId === school.school_id ? 'جارٍ الإزالة…' : 'إزالة المدرسة'}</button></td>}
            </tr>)}
              {!assignments.error && !assignments.isLoading && !currentAssignments.length && <tr><td colSpan={canManage ? 5 : 4} className="py-5 text-center text-sm text-slate-500">لا توجد مدارس مسندة لهذه الخدمة.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {canManage && <section className="grid gap-3 rounded-xl border border-slate-200 p-3 sm:p-4">
        <h5 className="font-bold">إضافة مدارس</h5>
        <label className="grid gap-1 text-sm font-semibold">الأرقام الوزارية
          <textarea value={input} onChange={(event) => { setInput(event.target.value); setPreview([]); }} rows={3} dir="auto" placeholder="الصق الأرقام، مفصولة بأسطر أو فواصل أو مسافات" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" />
        </label>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-500">بعد التطبيع: {formatNumber(normalizedNumbers.length)} رقمًا</p>
          <button type="button" onClick={() => void previewAssignments()} disabled={loadingPreview || !normalizedNumbers.length} className="rounded-lg border border-brand-700 px-4 py-2 text-sm font-semibold text-brand-800 disabled:opacity-50">
            {loadingPreview ? 'جارٍ المعاينة…' : 'معاينة الأرقام'}
          </button>
        </div>
        {preview.length > 0 && <>
          <div className="table-scroll workforce-table-scroll" role="region" aria-label="معاينة إسناد المدارس" tabIndex={0}>
            <table className="workforce-table min-w-[760px]">
              <thead><tr><th scope="col">الرقم الوزاري</th><th scope="col">المدرسة</th><th scope="col">الحالة</th><th scope="col">المشرف الحالي / القرار</th></tr></thead>
              <tbody>{preview.map((row) => <tr key={row.ministry_number}>
                <td data-label="الرقم الوزاري"><span dir="ltr" className="font-mono">{row.ministry_number || '—'}</span></td>
                <td data-label="المدرسة">{row.school_name ?? '—'}</td>
                <td data-label="الحالة">{statusLabels[row.outcome]}</td>
                <td data-label="المشرف الحالي / القرار">{row.outcome === 'conflict' ? <>
                  <span>{row.assigned_employee_name ?? 'غير معروف'}</span>
                  <select aria-label={`قرار تعارض الرقم ${row.ministry_number}`} value={conflictActions[row.ministry_number] ?? 'skip'} onChange={(event) => setConflictActions((current) => ({ ...current, [row.ministry_number]: event.target.value as 'skip' | 'move' }))} className="ms-2 rounded-lg border border-slate-300 px-2 py-1 text-xs">
                    <option value="skip">تجاهل</option><option value="move">نقل إلى هذا المشرف</option>
                  </select>
                </> : row.outcome === 'already_assigned' ? employee.full_name : row.assigned_employee_name ?? '—'}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <button type="button" onClick={() => void assignSchools()} disabled={savingAssignments} className="justify-self-start rounded-lg bg-brand-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
            {savingAssignments ? 'جارٍ الإسناد…' : 'تأكيد الإسناد'}
          </button>
        </>}
      </section>}

      {canManage && <form onSubmit={transferAllSchools} className="grid gap-3 rounded-xl border border-slate-200 p-3 sm:p-4">
        <h5 className="font-bold">نقل الكل إلى مشرف آخر</h5>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-semibold">المشرف البديل
            <select required value={transferTarget} onChange={(event) => setTransferTarget(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal">
              <option value="">اختر مشرفًا</option>
              {supervisors.filter(({ id }) => id !== employee.id).map((supervisor) => <option key={supervisor.id} value={supervisor.id}>{supervisor.full_name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-semibold">تاريخ السريان
            <input type="date" required min={assignments.data?.reduce((latest, item) => item.valid_from > latest ? item.valid_from : latest, '0000-01-01')} value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" />
          </label>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={updateFuturePlans} onChange={(event) => setUpdateFuturePlans(event.target.checked)} className="mt-1" />
          <span>تحديث الزيارات القادمة غير المنفذة بعد تاريخ السريان</span>
        </label>
        <button type="submit" disabled={!transferTarget || transferringSchools} className="justify-self-start rounded-lg border border-brand-700 px-4 py-2 text-sm font-semibold text-brand-800 disabled:opacity-50">{transferringSchools ? 'جارٍ النقل…' : 'نقل جميع المدارس المسندة'}</button>
      </form>}
      {message && <p role="status" className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{message}</p>}
    </section>
  );
}

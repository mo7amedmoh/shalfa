import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, X } from 'lucide-react';
import { z } from 'zod';
import {
  lastBusinessDayOfMonth,
  previewRemainingPlanRedistribution,
  type RemainingPlanVisit,
} from '../../domain/planRedistribution';
import { useDisplayFormat } from '../../app/useDisplayFormat';
import { supabase } from '../../lib/supabase';

type Holiday = { holiday_date: string; name: string };

type Props = {
  planId: string;
  planMonth: string;
  rows: readonly RemainingPlanVisit[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
};

function localDate(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function loadPlanHolidays(): Promise<Holiday[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('plan_holidays')
    .select('holiday_date,name')
    .order('holiday_date');
  if (error) throw error;
  return z.array(z.object({ holiday_date: z.string(), name: z.string() })).parse(data);
}

export function MonthlyPlanRedistribution({ planId, planMonth, rows, onClose, onSaved }: Props) {
  const queryClient = useQueryClient();
  const { formatDate } = useDisplayFormat();
  const [startDate, setStartDate] = useState(localDate);
  const [endDate, setEndDate] = useState(() => lastBusinessDayOfMonth(planMonth.slice(0, 7), []));
  const [endDateEdited, setEndDateEdited] = useState(false);
  const [dailyLimit, setDailyLimit] = useState(1);
  const [holidayDate, setHolidayDate] = useState('');
  const [holidayName, setHolidayName] = useState('');
  const [message, setMessage] = useState('');
  const holidays = useQuery({ queryKey: ['plan-holidays'], queryFn: loadPlanHolidays });
  const holidayDates = useMemo(() => (holidays.data ?? []).map((holiday) => holiday.holiday_date), [holidays.data]);
  const holidayInRange = (holidays.data ?? []).filter((holiday) =>
    holiday.holiday_date >= startDate && holiday.holiday_date <= endDate);

  const preview = useMemo(() => {
    try {
      return {
        result: previewRemainingPlanRedistribution({
          rows,
          startDate,
          endDate,
          holidays: holidayDates,
          dailyLimit,
        }),
        error: '',
      };
    } catch (reason) {
      return { result: null, error: reason instanceof Error ? reason.message : String(reason) };
    }
  }, [dailyLimit, endDate, holidayDates, rows, startDate]);

  useEffect(() => {
    if (endDateEdited) return;
    try {
      setEndDate(lastBusinessDayOfMonth(planMonth.slice(0, 7), holidayDates));
    } catch {
      setEndDate('');
    }
  }, [endDateEdited, holidayDates, planMonth]);

  const save = useMutation({
    mutationFn: async () => {
      if (!supabase || !preview.result) throw new Error('أنشئ معاينة صالحة قبل الحفظ.');
      if (preview.result.capacityIssues.length) throw new Error('السعة غير كافية؛ ارفع الحد اليومي لهذه العملية ثم أعد المعاينة.');
      const { data, error } = await supabase.rpc('redistribute_monthly_plan_rows', {
        p_plan_id: planId,
        p_start_date: startDate,
        p_end_date: endDate,
        p_daily_limit: dailyLimit,
        p_updates: preview.result.assignments.map((assignment) => ({
          row_id: assignment.rowId,
          old_planned_date: assignment.oldDate,
          planned_date: assignment.newDate,
        })),
      });
      if (error) {
        const migrationHint = error.code === 'PGRST202' || error.code === '42883'
          ? ' يلزم تطبيق ترحيل 202611170003_redistribute_monthly_plan_rows.sql.'
          : '';
        throw new Error(`${error.message}${migrationHint}`);
      }
      const result = z.object({ rows: z.number(), daily_limit: z.number() }).parse(data);
      const expectedRows = preview.result.assignments.filter((assignment) => assignment.oldDate !== assignment.newDate).length;
      if (result.rows !== expectedRows || result.daily_limit !== dailyLimit) {
        throw new Error(`أعاد الخادم نتيجة غير متوقعة: ${result.rows} صفاً بدلاً من ${expectedRows}.`);
      }
      return result.rows;
    },
    onSuccess: async (count) => {
      setMessage(count
        ? `تمت إعادة توزيع ${count} زيارة وتسجيل كل تغيير في سجل التدقيق.`
        : 'لا توجد مواعيد تحتاج إلى تغيير.');
      if (count) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['monthly-plan-rows', planId] }),
          queryClient.invalidateQueries({ queryKey: ['dashboard-plan-rows'] }),
          queryClient.invalidateQueries({ queryKey: ['monthly-report'] }),
          onSaved(),
        ]);
        onClose();
      }
    },
    onError: (reason: Error) => setMessage(`تعذر إعادة توزيع المتبقي: ${reason.message}`),
  });

  const saveHoliday = useMutation({
    mutationFn: async () => {
      if (!supabase) throw new Error('يلزم إعداد الاتصال بقاعدة البيانات.');
      if (!holidayDate || !holidayName.trim()) throw new Error('أدخل تاريخ الإجازة واسمها.');
      const { error } = await supabase.from('plan_holidays').insert({
        holiday_date: holidayDate,
        name: holidayName.trim(),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setHolidayDate('');
      setHolidayName('');
      setMessage('تم تسجيل الإجازة الرسمية.');
      await queryClient.invalidateQueries({ queryKey: ['plan-holidays'] });
    },
    onError: (reason: Error) => setMessage(`تعذر تسجيل الإجازة: ${reason.message}`),
  });

  const deleteHoliday = useMutation({
    mutationFn: async (date: string) => {
      if (!supabase) throw new Error('يلزم إعداد الاتصال بقاعدة البيانات.');
      const { error } = await supabase.from('plan_holidays').delete().eq('holiday_date', date);
      if (error) throw error;
    },
    onSuccess: async () => {
      setMessage('تم حذف الإجازة من السجل.');
      await queryClient.invalidateQueries({ queryKey: ['plan-holidays'] });
    },
    onError: (reason: Error) => setMessage(`تعذر حذف الإجازة: ${reason.message}`),
  });

  const assignmentsById = new Map((preview.result?.assignments ?? []).map((item) => [item.rowId, item]));
  const eligibleRows = rows.filter((row) => !row.visited && row.plannedDate >= startDate);
  const changedRows = preview.result?.assignments.filter((item) => item.oldDate !== item.newDate).length ?? 0;
  const hasCapacityErrors = Boolean(preview.result?.capacityIssues.length);

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-5" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !save.isPending && !saveHoliday.isPending && !deleteHoliday.isPending) onClose();
    }}>
      <section role="dialog" aria-modal="true" aria-labelledby="redistribute-title" dir="rtl" className="flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 p-4 sm:p-5">
          <div>
            <h2 id="redistribute-title" className="inline-flex items-center gap-2 text-lg font-bold text-brand-900">
              <CalendarClock size={20} aria-hidden="true" /> إعادة توزيع المتبقي
            </h2>
            <p className="mt-1 text-sm text-slate-500">الزيارات غير المنجزة ابتداءً من تاريخ البداية فقط؛ لا تتغير المدرسة أو المشرف.</p>
          </div>
          <button type="button" aria-label="إغلاق نافذة إعادة التوزيع" disabled={save.isPending} onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50">
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div className="grid gap-4 overflow-y-auto p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-semibold">تاريخ البداية
              <input type="date" required value={startDate} onChange={(event) => setStartDate(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <label className="grid gap-1 text-sm font-semibold">تاريخ النهاية
              <input type="date" required value={endDate} onChange={(event) => {
                setEndDate(event.target.value);
                setEndDateEdited(true);
              }} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
              <span className="text-xs font-normal text-slate-500">افتراضيًا آخر يوم عمل في شهر الخطة، بعد استثناء الإجازات المسجلة.</span>
            </label>
          </div>

          <section className="grid gap-3 rounded-xl border border-slate-200 p-3 sm:p-4">
            <div>
              <h3 className="font-bold text-slate-800">الإجازات الرسمية المسجلة</h3>
              <p className="text-xs text-slate-500">تُستثنى من أيام العمل. يمكن لمدير النظام أو مدير المشروع إدارة سجل الإجازات.</p>
            </div>
            {holidays.error && <p role="alert" className="text-sm text-rose-700">تعذر تحميل سجل الإجازات: {holidays.error.message}</p>}
            {holidays.isLoading && <p role="status" className="text-sm text-slate-500">جارٍ تحميل الإجازات…</p>}
            {!holidays.isLoading && !holidays.error && <ul className="grid gap-2 sm:grid-cols-2">
              {holidayInRange.map((holiday) => <li key={holiday.holiday_date} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <span>{holiday.name} · {formatDate(holiday.holiday_date)}</span>
                <button type="button" disabled={deleteHoliday.isPending} onClick={() => deleteHoliday.mutate(holiday.holiday_date)} className="shrink-0 text-xs text-rose-700 underline disabled:opacity-50">حذف</button>
              </li>)}
              {!holidayInRange.length && <li className="text-sm text-slate-500">لا توجد إجازات مسجلة ضمن الفترة.</li>}
            </ul>}
            <div className="grid gap-2 sm:grid-cols-[1fr_1.5fr_auto]">
              <label className="grid gap-1 text-xs font-semibold">تاريخ الإجازة
                <input type="date" value={holidayDate} onChange={(event) => setHolidayDate(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </label>
              <label className="grid gap-1 text-xs font-semibold">اسم الإجازة
                <input value={holidayName} onChange={(event) => setHolidayName(event.target.value)} placeholder="مثال: إجازة رسمية" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </label>
              <button type="button" disabled={!holidayDate || !holidayName.trim() || saveHoliday.isPending} onClick={() => saveHoliday.mutate()} className="self-end rounded-lg border border-brand-300 px-3 py-2 text-sm font-semibold text-brand-800 disabled:opacity-50">تسجيل الإجازة</button>
            </div>
          </section>

          {hasCapacityErrors && <section role="alert" className="grid gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 sm:p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 shrink-0" size={18} aria-hidden="true" />
              <div>
                <p className="font-bold">السعة الحالية لا تكفي. ارفع الحد لهذه العملية فقط ثم راجع المعاينة.</p>
                {preview.result?.capacityIssues.map((issue) => <p key={issue.supervisorName} className="mt-1">
                  المشرف {issue.supervisorName}: {issue.visits} زيارة متبقية و {issue.availableDays} يوم عمل فقط
                </p>)}
              </div>
            </div>
            <label className="grid max-w-sm gap-1 font-semibold">الحد اليومي المؤقت لكل مشرف
              <input type="number" min={1} max={20} step={1} value={dailyLimit} onChange={(event) => setDailyLimit(Number(event.target.value))} className="w-full rounded-lg border border-amber-400 bg-white px-3 py-2" />
              <span className="font-normal text-amber-800">الحد الافتراضي زيارة واحدة. هذا التغيير لهذه العملية فقط، وسيُحفظ مع كل سجل تعديل.</span>
            </label>
          </section>}

          <section className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold text-slate-800">معاينة قبل الحفظ</h3>
              {preview.result && <p className="text-xs text-slate-500">{eligibleRows.length} زيارة متبقية · {preview.result.days.length} أيام عمل · {changedRows} موعدًا سيتغير</p>}
            </div>
            {preview.error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{preview.error}</p>}
            {preview.result && <div className="max-h-72 overflow-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[560px] text-right text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs text-slate-600">
                  <tr><th className="p-2">المدرسة</th><th className="p-2">المشرف</th><th className="p-2">قبل</th><th className="p-2">بعد</th></tr>
                </thead>
                <tbody>{eligibleRows.map((row) => {
                  const assignment = assignmentsById.get(row.id);
                  return <tr key={row.id} className="border-t border-slate-100">
                    <td className="max-w-64 p-2">{row.schoolName}</td>
                    <td className="p-2">{row.supervisorName || 'غير محدد'}</td>
                    <td className="whitespace-nowrap p-2">{formatDate(row.plannedDate)}</td>
                    <td className="whitespace-nowrap p-2 font-semibold">{assignment
                      ? formatDate(assignment.newDate)
                      : <span className="text-amber-800">لا توجد سعة</span>}</td>
                  </tr>;
                })}
                {!eligibleRows.length && <tr><td colSpan={4} className="p-4 text-center text-slate-500">لا توجد زيارات غير منجزة ابتداءً من تاريخ البداية.</td></tr>}
                </tbody>
              </table>
            </div>}
          </section>
          {message && <p role={save.isError || saveHoliday.isError || deleteHoliday.isError ? 'alert' : 'status'} className={`rounded-lg p-3 text-sm ${save.isError || saveHoliday.isError || deleteHoliday.isError ? 'bg-rose-50 text-rose-800' : 'bg-emerald-50 text-emerald-800'}`}>{message}</p>}
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <span className="text-xs text-slate-500">لا تُعدّل الزيارات المنجزة أو المواعيد السابقة للبداية.</span>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <button type="button" onClick={onClose} disabled={save.isPending} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">إلغاء</button>
            <button
              type="button"
              onClick={() => save.mutate()}
              disabled={save.isPending || !preview.result || hasCapacityErrors || changedRows === 0 || !endDate || holidays.isLoading || Boolean(holidays.error)}
              className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {save.isPending ? 'جارٍ الحفظ…' : `حفظ إعادة التوزيع (${changedRows})`}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { z } from 'zod';
import { buildDailyProgress, rankSupervisorProgress, summarizeMonthlyProgress, type MonthlyReportRow, type MonthlyReportPlanType } from '../../domain/monthlyReport';
import { useDisplayFormat } from '../../app/useDisplayFormat';
import { supabase } from '../../lib/supabase';

const assignmentSchema = z.object({
  id: z.string().uuid(),
  planned_date: z.string(),
  visited_at: z.string().nullable(),
  report_completed_at: z.string().nullable(),
  supervisor_id: z.string().uuid().nullable(),
  school: z.object({ source_fields: z.record(z.string(), z.unknown()) }).nullable(),
  supervisor: z.object({ full_name: z.string() }).nullable(),
});
const planSchema = z.object({
  plan_type: z.enum(['maintenance', 'cleaning', 'security_safety', 'elevators']),
  monthly_plan_rows: z.array(assignmentSchema),
});

function monthNow(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function todayLocal(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

async function loadMonthlyReport(month: string): Promise<MonthlyReportRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('monthly_plans')
    .select('plan_type,monthly_plan_rows(id,planned_date,visited_at:visited_date,report_completed_at:report_done_date,supervisor_id,school:schools(source_fields:extra),supervisor:employees(full_name))')
    .eq('month', `${month}-01`);
  if (error) throw error;
  return z.array(planSchema).parse(data).flatMap((plan) => plan.monthly_plan_rows.map((row) => ({
    id: row.id,
    planType: plan.plan_type as MonthlyReportPlanType,
    plannedDate: row.planned_date,
    visitedAt: row.visited_at,
    reportCompletedAt: row.report_completed_at,
    supervisorId: row.supervisor_id,
    supervisorName: row.supervisor?.full_name ?? null,
    area: String(row.school?.source_fields['الحي'] ?? 'غير محدد'),
  })));
}

export function MonthlyReportPage() {
  const { formatNumber, formatDate } = useDisplayFormat();
  const [month, setMonth] = useState(monthNow);
  const [area, setArea] = useState('all');
  const report = useQuery({ queryKey: ['monthly-report', month], queryFn: () => loadMonthlyReport(month) });
  const areas = useMemo(() => [...new Set((report.data ?? []).map((row) => row.area))].sort((a, b) => a.localeCompare(b, 'ar')), [report.data]);
  const filtered = useMemo(() => (report.data ?? []).filter((row) => area === 'all' || row.area === area), [report.data, area]);
  const summary = summarizeMonthlyProgress(filtered);
  const dailyProgress = buildDailyProgress(filtered, month);
  const supervisors = rankSupervisorProgress(filtered, todayLocal());
  const topOverdue = supervisors.mostOverdue.slice(0, 10);
  const topCompliant = supervisors.mostCompliant.slice(0, 10);

  return (
    <div className="grid min-w-0 grid-cols-1 gap-5">
      <section className="no-print flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-sm text-slate-500">مؤشرات الزيارة وإنجاز التقارير ومتابعة المشرفين</p><h2 className="mt-1 text-2xl font-bold text-brand-900">التقرير العام</h2></div>
        <button type="button" onClick={() => window.print()} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-bold text-white">تصدير PDF / طباعة</button>
      </section>
      <header className="print-only"><img src="/brand/logo.png" alt="شلفا لإدارة المرافق" className="mb-3 h-10 w-auto" /><h2 className="text-xl font-bold">التقرير العام للخطط الشهرية</h2></header>
      {report.error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">تعذر تحميل التقرير: {report.error.message}</div>}
      <section className="no-print card flex flex-wrap gap-4 p-4">
        <label className="grid gap-1 text-sm font-semibold">الشهر<input type="month" value={month} onChange={(event) => setMonth(event.target.value || monthNow())} className="rounded-lg border border-slate-300 px-3 py-2" /></label>
        <label className="grid gap-1 text-sm font-semibold">الحي<select value={area} onChange={(event) => setArea(event.target.value)} className="min-w-40 rounded-lg border border-slate-300 px-3 py-2"><option value="all">جميع الأحياء</option>{areas.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      </section>
      <section className="grid gap-3 sm:grid-cols-3">
        <Metric label="نسبة الزيارات" value={summary.visitPercent} formatNumber={formatNumber} />
        <Metric label="اكتمال التقارير" value={summary.reportPercent} formatNumber={formatNumber} />
        <Metric label="إجمالي المدارس المخططة" value={summary.total} formatNumber={formatNumber} />
      </section>
      <section className="card grid gap-3 p-4 md:p-5">
        <div><h3 className="font-bold">الإنجاز التراكمي اليومي</h3><p className="mt-1 text-xs text-slate-500">مقارنة تراكم المدارس المجدولة بالزيارات الفعلية المسجلة.</p></div>
        <div className="h-64 w-full" aria-label="رسم الإنجاز المخطط والفعلي">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dailyProgress} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tickFormatter={(value: string) => value.slice(-2)} />
              <YAxis allowDecimals={false} />
              <Tooltip labelFormatter={(value) => formatDate(String(value))} formatter={(value) => formatNumber(Number(value))} />
              <Bar dataKey="planned" name="المخطط التراكمي" fill="#9eafd2" />
              <Bar dataKey="actual" name="الزيارات الفعلية التراكمية" fill="#21366a" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
      <section className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        <SupervisorTable title="الأكثر تأخراً" rows={topOverdue} formatNumber={formatNumber} />
        <SupervisorTable title="الأعلى التزاماً" rows={topCompliant} formatNumber={formatNumber} />
      </section>
      {report.isLoading && <p role="status">جارٍ تحميل التقرير…</p>}
      {!report.isLoading && filtered.length === 0 && <p className="card p-5 text-center text-sm text-slate-500">لا توجد خطط شهرية لهذا الشهر والحي.</p>}
    </div>
  );
}

function Metric({ label, value, formatNumber }: { label: string; value: number; formatNumber: (value: string | number) => string }) {
  return <article className="card p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold text-brand-900">{formatNumber(value)}{label.includes('نسبة') || label.includes('اكتمال') ? '%' : ''}</p></article>;
}

function SupervisorTable({ title, rows, formatNumber }: { title: string; rows: ReturnType<typeof rankSupervisorProgress>['mostOverdue']; formatNumber: (value: string | number) => string }) {
  return <section className="card p-4"><h3 className="font-bold">{title}</h3><div className="table-scroll mt-3"><table><thead><tr><th>المشرف</th><th>عدد الزيارات</th><th>التقارير</th><th>الاكتمال</th><th>حالات التأخير</th><th>أيام التأخير</th></tr></thead><tbody>
    {rows.map((row) => <tr key={row.id}><td>{row.name}</td><td>{formatNumber(row.visited)} / {formatNumber(row.total)}</td><td>{formatNumber(row.reportsCompleted)}</td><td>{formatNumber(row.reportPercent.toFixed(1))}%</td><td>{formatNumber(row.overdueCount)}</td><td>{formatNumber(row.overdueDays)}</td></tr>)}
    {rows.length === 0 && <tr><td colSpan={6} className="text-center text-slate-500">لا توجد بيانات مشرفين لخطة الصيانة أو النظافة.</td></tr>}
  </tbody></table></div></section>;
}

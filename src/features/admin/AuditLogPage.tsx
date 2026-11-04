import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { useDisplayFormat } from '../../app/useDisplayFormat';
import { supabase } from '../../lib/supabase';
import { APP_SCHEMA_SELECT } from '../../lib/schemaColumns';

const auditEventSchema = z.object({
  id: z.number(),
  actor_id: z.string().uuid().nullable(),
  action: z.string(),
  entity: z.string().nullable(),
  entity_id: z.string().nullable(),
  details: z.record(z.string(), z.unknown()).nullable(),
  created_at: z.string(),
});

const actionLabels: Record<string, string> = {
  INSERT: 'إضافة',
  UPDATE: 'تعديل',
  DELETE: 'حذف',
  REVEAL_RESIDENCE: 'إظهار بيانات حساسة',
  export: 'تصدير',
  reveal: 'إظهار بيانات حساسة',
  sync: 'مزامنة',
};

async function loadAuditEvents() {
  if (!supabase) return [];
  const { data, error } = await supabase.from('audit_log')
    .select(APP_SCHEMA_SELECT.auditLog)
    .order('at', { ascending: false })
    .limit(250);
  if (error) throw error;
  return z.array(auditEventSchema).parse(data);
}

export function AuditLogPage() {
  const { formatDateTime, formatNumber } = useDisplayFormat();
  const events = useQuery({ queryKey: ['admin-audit-log'], queryFn: loadAuditEvents });
  return (
    <div className="grid gap-5">
      <section><p className="text-sm text-slate-500">آخر 250 عملية مسجلة في النظام</p><h2 className="mt-1 text-2xl font-bold text-brand-900">سجل التدقيق</h2></section>
      {events.error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">تعذر تحميل سجل التدقيق: {events.error.message}</p>}
      {events.isLoading ? <p role="status">جارٍ تحميل سجل التدقيق…</p> : (
        <section className="card p-4">
          <div className="table-scroll">
            <table>
              <thead><tr><th>التاريخ</th><th>العملية</th><th>الجدول</th><th>معرّف السجل</th><th>المستخدم</th><th>تفاصيل</th></tr></thead>
              <tbody>
                {(events.data ?? []).map((event) => <tr key={event.id}>
                  <td>{formatDateTime(event.created_at)}</td>
                  <td>{actionLabels[event.action] ?? event.action}</td>
                  <td dir="ltr">{event.entity}</td>
                  <td dir="ltr">{event.entity_id ?? '—'}</td>
                  <td dir="ltr">{event.actor_id ?? '—'}</td>
                  <td><details><summary className="cursor-pointer">عرض</summary><pre dir="ltr" className="max-w-80 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(event.details, null, 2)}</pre></details></td>
                </tr>)}
                {!events.data?.length && <tr><td colSpan={6} className="text-center text-slate-500">لا توجد أحداث مسجلة.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-slate-400">عدد الأحداث المعروضة: {formatNumber(events.data?.length ?? 0)}</p>
        </section>
      )}
    </div>
  );
}

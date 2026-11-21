import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redo2, Undo2 } from 'lucide-react';
import { z } from 'zod';
import { useDisplayFormat } from '../../app/useDisplayFormat';
import { supabase } from '../../lib/supabase';
import { APP_SCHEMA_SELECT } from '../../lib/schemaColumns';
import { getAuditUndoState } from '../../domain/auditLog';

const auditEventSchema = z.object({
  id: z.number(),
  actor_id: z.string().uuid().nullable(),
  action: z.string(),
  entity: z.string().nullable(),
  entity_id: z.string().nullable(),
  details: z.record(z.string(), z.unknown()).nullable(),
  created_at: z.string(),
});

const profileSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string().nullable(),
});

type AuditEvent = z.infer<typeof auditEventSchema>;
type AuditData = { events: AuditEvent[]; actorNames: Record<string, string> };

const actionLabels: Record<string, string> = {
  INSERT: 'إضافة',
  UPDATE: 'تعديل',
  DELETE: 'حذف',
  edit_plan_row: 'تعديل صف خطة',
  undo_plan_row_edit: 'تراجع عن تعديل خطة',
  redo_plan_row_edit: 'إعادة تعديل خطة',
  REVEAL_RESIDENCE: 'إظهار بيانات حساسة',
  RBAC_SETTINGS_SAVE: 'حفظ الأدوار والصلاحيات',
  export: 'تصدير',
  reveal: 'إظهار بيانات حساسة',
  sync: 'مزامنة',
};

async function loadAuditEvents(): Promise<AuditData> {
  if (!supabase) return { events: [], actorNames: {} };
  const { data, error } = await supabase.from('audit_log')
    .select(APP_SCHEMA_SELECT.auditLog)
    .order('at', { ascending: false })
    .limit(250);
  if (error) throw error;
  const parsedEvents = z.array(auditEventSchema).parse(data);
  const actorIds = [...new Set(parsedEvents.flatMap((event) => event.actor_id ? [event.actor_id] : []))];
  if (!actorIds.length) return { events: parsedEvents, actorNames: {} };

  const { data: profiles, error: profilesError } = await supabase.from('profiles')
    .select('id,full_name')
    .in('id', actorIds);
  if (profilesError) throw profilesError;
  const parsedProfiles = z.array(profileSchema).parse(profiles);
  const actorNames = Object.fromEntries(parsedProfiles.map((profile) => [
    profile.id,
    profile.full_name?.trim() || 'مستخدم غير معروف',
  ]));
  return { events: parsedEvents, actorNames };
}

export function AuditLogPage() {
  const queryClient = useQueryClient();
  const { formatDateTime, formatNumber } = useDisplayFormat();
  const events = useQuery({ queryKey: ['admin-audit-log'], queryFn: loadAuditEvents });
  const changeState = useMutation({
    mutationFn: async ({ eventId, direction }: { eventId: number; direction: 'undo' | 'redo' }) => {
      if (!supabase) throw new Error('يلزم إعداد Supabase.');
      const { error } = await supabase.rpc('set_plan_row_edit_state', {
        p_audit_id: eventId,
        p_direction: direction,
      });
      if (error) {
        const migrationHint = error.code === 'PGRST202' || error.code === '42883'
          ? ' يلزم تطبيق ترحيل 202611180001_plan_row_edit_undo.sql.'
          : '';
        throw new Error(`${error.message}${migrationHint}`);
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-audit-log'] }),
        queryClient.invalidateQueries({ queryKey: ['monthly-plan-rows'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-plan-rows'] }),
        queryClient.invalidateQueries({ queryKey: ['monthly-report'] }),
      ]);
    },
  });

  return (
    <div className="grid gap-5">
      <section><p className="text-sm text-slate-500">آخر 250 عملية مسجلة في النظام</p><h2 className="mt-1 text-2xl font-bold text-brand-900">سجل التدقيق</h2></section>
      {events.error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">تعذر تحميل سجل التدقيق: {events.error.message}</p>}
      {changeState.error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">تعذر تنفيذ التراجع أو الإعادة: {changeState.error.message}</p>}
      {events.isLoading ? <p role="status">جارٍ تحميل سجل التدقيق…</p> : (
        <section className="card p-3">
          <p className="mb-2 text-xs text-slate-500">التراجع والإعادة متاحان لتعديلات صفوف الخطط المسجلة بتفاصيل قبل وبعد، بشرط عدم تغيير القيم بعدها.</p>
          <div className="table-scroll">
            <table className="text-xs">
              <thead><tr><th className="px-2 py-1.5">التاريخ</th><th className="px-2 py-1.5">العملية</th><th className="px-2 py-1.5">الجدول</th><th className="px-2 py-1.5">معرّف السجل</th><th className="px-2 py-1.5">المستخدم</th><th className="px-2 py-1.5">تفاصيل</th><th className="px-2 py-1.5">تراجع / إعادة</th></tr></thead>
              <tbody>
                {(events.data?.events ?? []).map((event) => {
                  const state = getAuditUndoState(event, events.data?.events ?? []);
                  return <tr key={event.id}>
                    <td className="whitespace-nowrap px-2 py-1">{formatDateTime(event.created_at)}</td>
                    <td className="whitespace-nowrap px-2 py-1">{actionLabels[event.action] ?? event.action}</td>
                    <td className="px-2 py-1" dir="ltr">{event.entity ?? '—'}</td>
                    <td className="px-2 py-1" dir="ltr">{event.entity_id ?? '—'}</td>
                    <td className="whitespace-nowrap px-2 py-1">{event.actor_id ? events.data?.actorNames[event.actor_id] ?? 'مستخدم غير معروف' : 'النظام'}</td>
                    <td className="px-2 py-1"><details><summary className="cursor-pointer">عرض</summary><pre dir="ltr" className="max-w-80 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(event.details, null, 2)}</pre></details></td>
                    <td className="px-2 py-1">
                      {state === 'available' || state === 'undone' ? <div className="flex items-center gap-1">
                        <button
                          type="button"
                          aria-label={`التراجع عن العملية ${event.id}`}
                          title={state === 'undone' ? 'تم التراجع عن العملية' : 'تراجع'}
                          onClick={() => changeState.mutate({ eventId: event.id, direction: 'undo' })}
                          disabled={state === 'undone' || changeState.isPending}
                          className="rounded p-1 text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
                        ><Undo2 size={16} aria-hidden="true" /></button>
                        <button
                          type="button"
                          aria-label={`إعادة العملية ${event.id}`}
                          title={state === 'available' ? 'لم يتم التراجع عن العملية' : 'إعادة'}
                          onClick={() => changeState.mutate({ eventId: event.id, direction: 'redo' })}
                          disabled={state === 'available' || changeState.isPending}
                          className="rounded p-1 text-brand-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40"
                        ><Redo2 size={16} aria-hidden="true" /></button>
                      </div> : '—'}
                    </td>
                  </tr>;
                })}
                {!events.data?.events.length && <tr><td colSpan={7} className="px-2 py-2 text-center text-slate-500">لا توجد أحداث مسجلة.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-400">عدد الأحداث المعروضة: {formatNumber(events.data?.events.length ?? 0)}</p>
        </section>
      )}
    </div>
  );
}

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, RefreshCw, Trash2 } from 'lucide-react';
import { z } from 'zod';
import { loadXlsx } from '../../lib/xlsx';
import { supabase } from '../../lib/supabase';

const linkCountSchema = z.object({
  cleaner_assignments: z.number().int(),
  school_size_corrections: z.number().int(),
  staffing_exceptions: z.number().int(),
  gatekeepers: z.number().int(),
  monthly_plan_rows: z.number().int(),
  general_plan_rows: z.number().int(),
  custom_plan_rows: z.number().int(),
});
const twinSchema = z.object({
  id: z.string().uuid(),
  ministry_no: z.string(),
  name: z.string(),
  source_row: z.number().int().nullable(),
});
const schoolSchema = z.object({
  id: z.string().uuid(),
  ministry_no: z.string(),
  ministry_key: z.string(),
  name: z.string(),
  source_key: z.string(),
  source_row: z.number().int().nullable(),
  missing_from_sheet_at: z.string(),
  link_counts: linkCountSchema,
  live_twins: z.array(twinSchema),
});
const backupRecordSchema = z.object({
  school: z.record(z.string(), z.unknown()),
  cleaner_assignments: z.array(z.record(z.string(), z.unknown())),
  school_size_corrections: z.array(z.record(z.string(), z.unknown())),
  staffing_exceptions: z.array(z.record(z.string(), z.unknown())),
  gatekeepers: z.array(z.record(z.string(), z.unknown())),
  monthly_plan_rows: z.array(z.record(z.string(), z.unknown())),
  general_plan_rows: z.array(z.record(z.string(), z.unknown())),
  custom_plan_rows: z.array(z.record(z.string(), z.unknown())),
});
type CleanupSchool = z.infer<typeof schoolSchema>;

const linkLabels: Record<keyof CleanupSchool['link_counts'], string> = {
  cleaner_assignments: 'تسكين العمالة',
  school_size_corrections: 'تصحيحات الحجم',
  staffing_exceptions: 'استثناءات العمالة',
  gatekeepers: 'البوابون',
  monthly_plan_rows: 'صفوف الخطط الشهرية',
  general_plan_rows: 'صفوف الخطط العامة',
  custom_plan_rows: 'صفوف الخطط المخصصة',
};
const confirmationPhrase = 'مع حذف البيانات المرتبطة';

async function loadMissingSchools(): Promise<CleanupSchool[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('admin_school_cleanup_list');
  if (error) throw error;
  return z.array(schoolSchema).parse(data);
}

function linkedCount(school: CleanupSchool): number {
  return Object.values(school.link_counts).reduce((sum, count) => sum + count, 0);
}

async function downloadBackup(schoolIds: string[]): Promise<void> {
  if (!supabase) throw new Error('يلزم إعداد Supabase.');
  const { data, error } = await supabase.rpc('admin_school_cleanup_backup', { p_school_ids: schoolIds });
  if (error) throw error;
  const backups = z.array(backupRecordSchema).parse(data);
  if (backups.length !== new Set(schoolIds).size) throw new Error('لم تكتمل بيانات النسخة الاحتياطية؛ أُوقف الحذف.');

  const XLSX = await loadXlsx();
  const workbook = XLSX.utils.book_new();
  const sheets: Array<[string, Array<Record<string, unknown>>]> = [
    ['المدارس', backups.map(({ school }) => school)],
    ['تسكين العمالة', backups.flatMap(({ cleaner_assignments }) => cleaner_assignments)],
    ['تصحيحات الحجم', backups.flatMap(({ school_size_corrections }) => school_size_corrections)],
    ['استثناءات العمالة', backups.flatMap(({ staffing_exceptions }) => staffing_exceptions)],
    ['البوابون', backups.flatMap(({ gatekeepers }) => gatekeepers)],
    ['الخطط الشهرية', backups.flatMap(({ monthly_plan_rows }) => monthly_plan_rows)],
    ['الخطط العامة', backups.flatMap(({ general_plan_rows }) => general_plan_rows)],
    ['الخطط المخصصة', backups.flatMap(({ custom_plan_rows }) => custom_plan_rows)],
  ];
  sheets.forEach(([name, rows]) => XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), name));
  XLSX.writeFile(workbook, `نسخة-احتياطية-تنظيف-المدارس-${new Date().toISOString().replace(/[:.]/g, '-')}.xlsx`);
}

export function SchoolCleanupPage() {
  const queryClient = useQueryClient();
  const schools = useQuery({ queryKey: ['admin-school-cleanup'], queryFn: loadMissingSchools });
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const unlinkedSchools = useMemo(() => (schools.data ?? []).filter((school) => linkedCount(school) === 0), [schools.data]);

  async function mergeSchool(school: CleanupSchool) {
    const targetId = targets[school.id];
    if (!targetId || !supabase) return;
    setBusy(true);
    setMessage('');
    try {
      await downloadBackup([school.id, targetId]);
      const { error } = await supabase.rpc('admin_cleanup_school', {
        p_action: 'merge',
        p_school_id: school.id,
        p_target_id: targetId,
        p_confirmation: null,
      });
      if (error) throw error;
      setMessage(`تم دمج "${school.name}" بعد تنزيل النسخة الاحتياطية.`);
      await queryClient.invalidateQueries({ queryKey: ['admin-school-cleanup'] });
      await queryClient.invalidateQueries({ queryKey: ['schools'] });
    } catch (error) {
      setMessage(`تعذر الدمج: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function deleteSchool(school: CleanupSchool) {
    if (!supabase) return;
    const count = linkedCount(school);
    const confirmation = count > 0 ? window.prompt(`سيحذف ${count} ارتباطاً مع المدرسة. لتنفيذ ذلك اكتب: ${confirmationPhrase}`) : null;
    if (count > 0 && confirmation !== confirmationPhrase) return;
    if (count === 0 && !window.confirm(`حذف المدرسة "${school.name}"؟`)) return;
    setBusy(true);
    setMessage('');
    try {
      await downloadBackup([school.id]);
      const { error } = await supabase.rpc('admin_cleanup_school', {
        p_action: 'delete',
        p_school_id: school.id,
        p_target_id: null,
        p_confirmation: confirmation,
      });
      if (error) throw error;
      setMessage(`تم حذف "${school.name}" بعد تنزيل النسخة الاحتياطية.`);
      await queryClient.invalidateQueries({ queryKey: ['admin-school-cleanup'] });
      await queryClient.invalidateQueries({ queryKey: ['schools'] });
    } catch (error) {
      setMessage(`تعذر الحذف: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function deleteUnlinked() {
    if (!supabase || unlinkedSchools.length === 0) return;
    if (!window.confirm(`سيتم تنزيل نسخة Excel احتياطية ثم حذف ${unlinkedSchools.length} مدرسة بلا ارتباطات. متابعة؟`)) return;
    setBusy(true);
    setMessage('');
    try {
      const ids = unlinkedSchools.map(({ id }) => id);
      await downloadBackup(ids);
      const { error } = await supabase.rpc('admin_bulk_delete_unlinked_schools', { p_school_ids: ids });
      if (error) throw error;
      setMessage(`تم حذف ${ids.length} مدرسة غير مرتبطة بعد تنزيل النسخة الاحتياطية.`);
      await queryClient.invalidateQueries({ queryKey: ['admin-school-cleanup'] });
      await queryClient.invalidateQueries({ queryKey: ['schools'] });
    } catch (error) {
      setMessage(`تعذر الحذف الجماعي: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5">
      <section>
        <p className="text-sm text-slate-500">الإعدادات</p>
        <h2 className="mt-1 text-2xl font-bold text-brand-900">تنظيف المدارس</h2>
        <p className="mt-2 text-sm leading-7 text-slate-600">تُعرض المدارس التي غابت عن آخر مزامنة مع عدد ارتباطاتها والمدرسة الحالية المطابقة. تُنزّل نسخة Excel قبل أي حذف؛ الحذف والدمج ينفذان عبر عمليات قاعدة بيانات مقيدة بمدير النظام.</p>
      </section>
      {schools.error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">تعذر تحميل بيانات التنظيف: {schools.error.message}</p>}
      {message && <p role="status" className="rounded-xl bg-slate-50 p-4 text-sm text-slate-700">{message}</p>}
      <section className="card grid gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600">السجلات المتروكة: {schools.data?.length ?? 0} · غير المرتبطة: {unlinkedSchools.length}</p>
          <button type="button" disabled={busy || unlinkedSchools.length === 0} onClick={() => void deleteUnlinked()} className="inline-flex items-center gap-2 rounded-lg bg-rose-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">
            <Trash2 size={16} /> حذف كل المتروك بلا ارتباطات
          </button>
        </div>
        {schools.isLoading ? <p role="status">جارٍ تحميل السجلات…</p> : (schools.data ?? []).map((school) => (
          <article key={school.id} className="grid gap-3 rounded-xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-bold text-brand-900">{school.name}</h3>
                <p className="mt-1 text-sm text-slate-600">الرقم الوزاري: <span dir="ltr">{school.ministry_no}</span> · صف المصدر: {school.source_row ?? '—'}</p>
                <p className="text-xs text-slate-500">آخر ظهور: {new Date(school.missing_from_sheet_at).toLocaleString('ar-SA')}</p>
              </div>
              <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-900">ارتباطات: {linkedCount(school)}</span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
              {(Object.entries(linkLabels) as Array<[keyof CleanupSchool['link_counts'], string]>).map(([key, label]) => (
                <span key={key}>{label}: {school.link_counts[key]}</span>
              ))}
            </div>
            {school.live_twins.length > 0 && (
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <select aria-label={`المدرسة الحالية لدمج ${school.name}`} value={targets[school.id] ?? ''} onChange={(event) => setTargets((current) => ({ ...current, [school.id]: event.target.value }))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                  <option value="">اختر المدرسة الحالية للدمج</option>
                  {school.live_twins.map((twin) => <option key={twin.id} value={twin.id}>{twin.name} · {twin.ministry_no} · صف {twin.source_row ?? '—'}</option>)}
                </select>
                <button type="button" disabled={busy || !targets[school.id]} onClick={() => void mergeSchool(school)} className="rounded-lg bg-brand-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">دمج مع المدرسة الحالية</button>
              </div>
            )}
            {school.live_twins.length === 0 && <p className="text-xs text-slate-500">لم يُعثر على مدرسة حالية لها الرقم الوزاري المطبع نفسه.</p>}
            <div>
              <button type="button" disabled={busy} onClick={() => void deleteSchool(school)} className="inline-flex items-center gap-2 rounded-lg border border-rose-300 px-3 py-2 text-sm font-semibold text-rose-800 disabled:opacity-50">
                <Trash2 size={15} /> حذف
              </button>
            </div>
          </article>
        ))}
        {!schools.isLoading && !schools.error && !schools.data?.length && <p className="text-center text-sm text-slate-500">لا توجد مدارس متروكة.</p>}
      </section>
      <button type="button" disabled={schools.isFetching || busy} onClick={() => void schools.refetch()} className="inline-flex w-fit items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-50"><RefreshCw size={15} /> تحديث القائمة</button>
      <p className="inline-flex items-center gap-2 text-xs text-slate-500"><Download size={14} /> لا يبدأ الحذف إذا تعذر إنشاء ملف النسخة الاحتياطية.</p>
    </div>
  );
}

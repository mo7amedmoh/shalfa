import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { z } from 'zod';
import { summarizeGeneralPlanProgress } from '../../domain/generalPlans';
import { useDisplayFormat } from '../../app/useDisplayFormat';
import type { UserProfile } from '../../lib/auth';
import { supabase } from '../../lib/supabase';

const planTypes = ['gardening', 'landscaping', 'sewage_waste', 'tank_washing', 'pest_control', 'annual_readiness'] as const;
type GeneralPlanType = (typeof planTypes)[number];
const planLabels: Record<GeneralPlanType, string> = {
  gardening: 'البستنة',
  landscaping: 'التنسيق',
  sewage_waste: 'نزح مخلفات الصرف الصحي',
  tank_washing: 'غسيل الخزانات',
  pest_control: 'مكافحة الآفات ورش المبيدات',
  annual_readiness: 'خطط الاستعداد السنوية',
};
const schoolSchema = z.object({ id: z.string().uuid(), school_name: z.string(), ministry_number: z.string() });
const rowSchema = z.object({
  id: z.string().uuid(),
  school_id: z.string().uuid(),
  planned_date: z.string(),
  status: z.enum(['pending', 'in_progress', 'complete']),
  completed_at: z.string().nullable(),
  notes: z.string().nullable(),
  school: z.object({ school_name: z.string(), ministry_number: z.string() }).nullable(),
});
type GeneralRow = z.infer<typeof rowSchema>;

async function loadSchools() {
  if (!supabase) return [];
  const { data, error } = await supabase.from('schools').select('id,school_name,ministry_number').order('school_name');
  if (error) throw error;
  return z.array(schoolSchema).parse(data);
}

async function loadGeneralRows(type: GeneralPlanType): Promise<GeneralRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('general_plan_rows')
    .select('id,school_id,planned_date,status,completed_at,notes,school:schools(school_name,ministry_number)')
    .eq('plan_type', type)
    .order('planned_date', { ascending: false });
  if (error) throw error;
  return z.array(rowSchema).parse(data);
}

export function GeneralPlansPage({ profile }: { profile: UserProfile | null }) {
  const { type } = useParams();
  const planType = planTypes.find((candidate) => candidate === type);
  const queryClient = useQueryClient();
  const { formatNumber } = useDisplayFormat();
  const [plannedDate, setPlannedDate] = useState(new Date().toISOString().slice(0, 10));
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const schools = useQuery({ queryKey: ['schools-for-general-plans'], queryFn: loadSchools, enabled: Boolean(planType) });
  const rows = useQuery({
    queryKey: ['general-plan-rows', planType],
    queryFn: () => planType ? loadGeneralRows(planType) : Promise.resolve([]),
    enabled: Boolean(planType),
  });
  const canManage = Boolean(profile && ['admin', 'project_manager', 'area_engineer'].includes(profile.role));
  const filteredSchools = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return (schools.data ?? []).filter((school) =>
      `${school.school_name} ${school.ministry_number}`.toLocaleLowerCase().includes(query),
    );
  }, [schools.data, search]);

  const createRows = useMutation({
    mutationFn: async () => {
      if (!supabase || !profile || !planType) throw new Error('يلزم تسجيل الدخول واختيار نوع الخطة.');
      if (!canManage) throw new Error('لا تملك صلاحية إدارة الخطط العامة.');
      const date = new Date(`${plannedDate}T00:00:00.000Z`);
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== plannedDate) {
        throw new Error('أدخل تاريخاً صالحاً.');
      }
      if (selectedIds.length === 0) throw new Error('اختر مدرسة واحدة على الأقل.');
      const { error } = await supabase.from('general_plan_rows').insert(
        selectedIds.map((schoolId) => ({
          plan_type: planType,
          school_id: schoolId,
          planned_date: plannedDate,
          status: 'pending',
          created_by: profile.id,
        })),
      );
      if (error) throw error;
    },
    onSuccess: async () => {
      setSelectedIds([]);
      setMessage('تمت إضافة المدارس إلى الخطة.');
      await queryClient.invalidateQueries({ queryKey: ['general-plan-rows', planType] });
    },
    onError: (error: Error) => setMessage(`تعذرت إضافة الخطة: ${error.message}`),
  });

  const updateRow = useMutation({
    mutationFn: async ({ row, status, notes }: { row: GeneralRow; status: GeneralRow['status']; notes: string }) => {
      if (!supabase) throw new Error('يلزم إعداد Supabase.');
      const parsedNotes = z.string().max(2000).safeParse(notes);
      if (!parsedNotes.success) throw new Error('يجب ألا تتجاوز الملاحظات 2000 خانة.');
      const { error } = await supabase.from('general_plan_rows').update({
        status,
        completed_at: status === 'complete' ? new Date().toISOString().slice(0, 10) : null,
        notes: notes.trim() || null,
      }).eq('id', row.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      setMessage('تم تحديث حالة التنفيذ.');
      await queryClient.invalidateQueries({ queryKey: ['general-plan-rows', planType] });
    },
    onError: (error: Error) => setMessage(`تعذر تحديث التنفيذ: ${error.message}`),
  });

  if (!planType) return <section className="card p-6 text-center">نوع الخطة غير معروف.</section>;
  const progress = summarizeGeneralPlanProgress((rows.data ?? []).map((row) => row.status));
  const { complete: completeCount, total: totalCount } = progress;

  return (
    <div className="grid gap-5">
      <section><p className="text-sm text-slate-500">الخطط العامة · متابعة التنفيذ</p><h2 className="mt-1 text-2xl font-bold text-brand-900">{planLabels[planType]}</h2></section>
      {(schools.error || rows.error) && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">تعذر تحميل بيانات الخطة أو المدارس.</div>}
      <section className="card grid gap-4 p-5">
        <div><h3 className="font-bold">إضافة مدارس إلى الخطة</h3><p className="mt-1 text-sm text-slate-500">اختر مدارس موجودة في مرآة المصدر وحدد تاريخ التنفيذ المخطط.</p></div>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <label className="grid gap-1 text-sm font-semibold">تاريخ التنفيذ<input type="date" value={plannedDate} onChange={(event) => setPlannedDate(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2" /></label>
          <label className="grid gap-1 text-sm font-semibold">بحث مدرسة<input value={search} onChange={(event) => setSearch(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2" placeholder="الاسم أو الرقم الوزاري" /></label>
          <button type="button" disabled={!selectedIds.length || !canManage || createRows.isPending} onClick={() => createRows.mutate()} className="self-end rounded-lg bg-brand-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">إضافة المحدد ({selectedIds.length})</button>
        </div>
        {schools.isLoading ? <p role="status">جارٍ تحميل المدارس…</p> : filteredSchools.length === 0 ? <p className="text-sm text-slate-500">لا توجد مدارس مطابقة.</p> : (
          <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 p-3">
            {filteredSchools.map((school) => <label key={school.id} className="flex items-center gap-2 py-1.5 text-sm">
              <input type="checkbox" checked={selectedIds.includes(school.id)} onChange={(event) => setSelectedIds((ids) => event.target.checked ? [...ids, school.id] : ids.filter((id) => id !== school.id))} />
              <span>{school.school_name}</span><span className="text-slate-400">{school.ministry_number}</span>
            </label>)}
          </div>
        )}
        {!canManage && <p className="text-xs text-slate-500">تعديل الخطط العامة متاح للإدارة ومهندس المنطقة.</p>}
        {message && <p role="status" className="text-sm text-slate-700">{message}</p>}
      </section>

      <section className="card grid gap-4 p-5">
        <div>
          <h3 className="font-bold">لوحة الإنجاز</h3>
          <p className="mt-1 text-sm text-slate-500">المكتمل: {formatNumber(completeCount)} من {formatNumber(totalCount)} · جارٍ: {formatNumber(progress.inProgress)} · لم يبدأ: {formatNumber(progress.pending)}</p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label="نسبة إنجاز الخطة" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.completionPercent}>
            <div className="h-full rounded-full bg-brand-600" style={{ width: `${progress.completionPercent}%` }} />
          </div>
          <p className="mt-1 text-xs text-slate-500">{formatNumber(progress.completionPercent.toFixed(1))}% إنجاز</p>
        </div>
        {rows.isLoading ? <p role="status">جارٍ تحميل السجلات…</p> : totalCount === 0 ? <p className="rounded-lg bg-slate-50 p-5 text-center text-sm text-slate-500">لا توجد مهام مسجلة لهذه الخطة.</p> : (
          <div className="table-scroll"><table>
            <thead><tr><th>المدرسة</th><th>التاريخ المخطط</th><th>الحالة</th><th>تاريخ الإنجاز</th><th>الملاحظات</th><th>إجراء</th></tr></thead>
            <tbody>{(rows.data ?? []).map((row) => <GeneralPlanRow key={row.id} row={row} onSave={(status, notes) => updateRow.mutate({ row, status, notes })} disabled={!canManage || updateRow.isPending} />)}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}

function GeneralPlanRow({ row, onSave, disabled }: { row: GeneralRow; onSave: (status: GeneralRow['status'], notes: string) => void; disabled: boolean }) {
  const [status, setStatus] = useState(row.status);
  const [notes, setNotes] = useState(row.notes ?? '');
  return <tr>
    <td>{row.school?.school_name ?? row.school_id}<small className="block text-xs text-slate-400">{row.school?.ministry_number}</small></td>
    <td>{row.planned_date}</td>
    <td><select value={status} onChange={(event) => { if (event.target.value === 'pending' || event.target.value === 'in_progress' || event.target.value === 'complete') setStatus(event.target.value); }} disabled={disabled} className="rounded border border-slate-300 px-2 py-1"><option value="pending">لم يبدأ</option><option value="in_progress">جارٍ</option><option value="complete">مكتمل</option></select></td>
    <td>{row.completed_at ?? '—'}</td>
    <td><input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} disabled={disabled} className="max-w-40 rounded border border-slate-300 px-2 py-1" /></td>
    <td><button type="button" onClick={() => onSave(status, notes)} disabled={disabled} className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50">حفظ</button></td>
  </tr>;
}

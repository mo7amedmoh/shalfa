import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import { eligibleCustomSchoolIds, customPlanTypeSchema, type CustomPlanType } from '../../domain/customPlans';
import type { PlanEligibilityConfig } from '../../domain/planEligibility';
import type { UserProfile } from '../../lib/auth';
import { supabase } from '../../lib/supabase';

const rowSchema = z.object({
  id: z.string().uuid(), school_id: z.string().uuid().nullable(), planned_date: z.string().nullable(),
  execution_date: z.string().nullable(), status: z.enum(['planned', 'in_progress', 'done', 'cancelled']),
  supervisor_name: z.string().nullable(), engineer_name: z.string().nullable(), visited: z.boolean().nullable(),
  report_done: z.boolean().nullable(), notes: z.string().nullable(),
  school: z.object({ name: z.string(), ministry_no: z.string() }).nullable(),
});
type School = { id: string; name: string; ministry_no: string; extra: Record<string, unknown>; plan_scope: boolean | null };
const configSchema = z.object({
  buildingTypeHeader: z.string(), independentBuildingValues: z.array(z.string()),
  primarySharedValues: z.array(z.string()), elevatorContractorHeader: z.string(), noElevatorValues: z.array(z.string()),
});
const canManage = (profile: UserProfile | null) => Boolean(profile && ['admin', 'project_manager', 'area_engineer'].includes(profile.role));
const canTypeManage = (profile: UserProfile | null) => Boolean(profile && ['admin', 'project_manager'].includes(profile.role));
const periodFor = (cadence: CustomPlanType['cadence'], value: string) => cadence === 'monthly' ? `${value}-01` : `${value}-01-01`;

async function loadType(typeId: string): Promise<CustomPlanType> {
  if (!supabase) throw new Error('يلزم إعداد Supabase.');
  const { data, error } = await supabase.from('custom_plan_types').select('id,name,cadence,scope,track_visit_report,group_key,created_at,is_active').eq('id', typeId).single();
  if (error) throw error;
  return customPlanTypeSchema.parse(data);
}

async function loadCandidates(): Promise<{ schools: School[]; config: PlanEligibilityConfig | null }> {
  if (!supabase) return { schools: [], config: null };
  const [schoolsResult, configResult] = await Promise.all([
    supabase.from('schools').select('id,name,ministry_no,extra,plan_scope').order('name'),
    supabase.from('app_config').select('value').eq('key', 'plan_eligibility').maybeSingle(),
  ]);
  if (schoolsResult.error) throw schoolsResult.error;
  if (configResult.error) throw configResult.error;
  return { schools: z.array(z.object({ id: z.string().uuid(), name: z.string(), ministry_no: z.string(), extra: z.record(z.string(), z.unknown()), plan_scope: z.boolean().nullable() })).parse(schoolsResult.data), config: configResult.data ? configSchema.parse(configResult.data.value) : null };
}

export function CustomPlanPage({ profile }: { profile: UserProfile | null }) {
  const { typeId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const typeQuery = useQuery({ queryKey: ['custom-plan-type', typeId], queryFn: () => loadType(typeId), enabled: Boolean(typeId) });
  const candidates = useQuery({ queryKey: ['custom-plan-candidates'], queryFn: loadCandidates });
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [planId, setPlanId] = useState('');
  const [message, setMessage] = useState('');
  const type = typeQuery.data;
  const plans = useQuery({
    queryKey: ['custom-plans', typeId], enabled: Boolean(typeId),
    queryFn: async () => {
      if (!supabase) return [];
      const { data, error } = await supabase.from('custom_plans').select('id,period').eq('type_id', typeId).order('period', { ascending: false });
      if (error) throw error;
      return z.array(z.object({ id: z.string().uuid(), period: z.string() })).parse(data);
    },
  });
  const rows = useQuery({
    queryKey: ['custom-plan-rows', planId], enabled: Boolean(planId),
    queryFn: async () => {
      if (!supabase) return [];
      const { data, error } = await supabase.from('custom_plan_rows').select('id,school_id,planned_date,execution_date,status,supervisor_name,engineer_name,visited,report_done,notes,school:schools(name,ministry_no)').eq('plan_id', planId).order('planned_date');
      if (error) throw error;
      return z.array(rowSchema).parse(data);
    },
  });
  const eligibleIds = useMemo(() => {
    if (!type || !candidates.data?.config) return [];
    return eligibleCustomSchoolIds(candidates.data.schools.map((school) => ({ id: school.id, sourceFields: { ...school.extra, plan_scope: school.plan_scope } })), type.scope, candidates.data.config);
  }, [type, candidates.data]);
  const createPlan = useMutation({
    mutationFn: async () => {
      if (!supabase || !type || !canManage(profile)) throw new Error('لا تملك صلاحية إدارة الخطة.');
      const parsedPeriod = periodFor(type.cadence, period);
      const { data: plan, error } = await supabase.from('custom_plans').upsert({ type_id: type.id, period: parsedPeriod }, { onConflict: 'type_id,period' }).select('id').single();
      if (error) throw error;
      setPlanId(plan.id);
      const ids = type.scope === 'all_in_scope' ? eligibleIds : selectedIds;
      if (ids.length) {
        const { error: rowError } = await supabase.from('custom_plan_rows').upsert(ids.map((school_id) => ({ plan_id: plan.id, school_id, status: 'planned' })), { onConflict: 'plan_id,school_id' });
        if (rowError) throw rowError;
      }
    },
    onSuccess: async () => { setMessage('تم إنشاء الفترة وإضافة المدارس المحددة.'); await queryClient.invalidateQueries({ queryKey: ['custom-plans', typeId] }); await queryClient.invalidateQueries({ queryKey: ['custom-plan-rows', planId] }); },
    onError: (error: Error) => setMessage(error.message),
  });
  const updateRow = useMutation({
    mutationFn: async ({ id, field, value }: { id: string; field: string; value: unknown }) => {
      if (!supabase || !canManage(profile)) throw new Error('لا تملك صلاحية تعديل الصف.');
      const { error } = await supabase.from('custom_plan_rows').update({ [field]: value }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['custom-plan-rows', planId] }),
    onError: (error: Error) => setMessage(error.message),
  });
  const deleteRows = useMutation({
    mutationFn: async ({ rowId }: { rowId?: string }) => {
      if (!supabase || !canManage(profile) || !planId) throw new Error('لا تملك صلاحية الحذف.');
      const answer = window.prompt('اكتب حذف للتأكيد:');
      if (answer !== 'حذف') throw new Error('لم يتم تأكيد الحذف.');
      const backupRows = rowId ? (rows.data ?? []).filter((row) => row.id === rowId) : (rows.data ?? []);
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(backupRows), 'نسخة احتياطية');
      XLSX.writeFile(book, `نسخة-احتياطية-${type?.name ?? 'خطة'}.xlsx`);
      const query = supabase.from('custom_plan_rows').delete();
      const result = rowId ? await query.eq('id', rowId) : await query.eq('plan_id', planId);
      if (result.error) throw result.error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['custom-plan-rows', planId] }),
    onError: (error: Error) => setMessage(error.message),
  });
  const deletePlan = useMutation({
    mutationFn: async () => {
      if (!supabase || !canManage(profile) || !planId) throw new Error('لا تملك صلاحية الحذف.');
      if (window.prompt('اكتب حذف للتأكيد على حذف فترة الخطة:') !== 'حذف') throw new Error('لم يتم تأكيد الحذف.');
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows.data ?? []), 'نسخة احتياطية');
      XLSX.writeFile(book, `نسخة-فترة-${type?.name ?? 'خطة'}.xlsx`);
      const { error } = await supabase.from('custom_plans').delete().eq('id', planId);
      if (error) throw error;
    },
    onSuccess: async () => { setPlanId(''); await queryClient.invalidateQueries({ queryKey: ['custom-plans', typeId] }); },
    onError: (error: Error) => setMessage(error.message),
  });
  const deleteType = useMutation({
    mutationFn: async (action: 'hide' | 'delete') => {
      if (!supabase || !type || !canTypeManage(profile)) throw new Error('لا تملك صلاحية إدارة قائمة الخطط.');
      const answer = window.prompt(`اكتب ${action === 'hide' ? 'إخفاء' : 'حذف'} للتأكيد:`);
      if (answer !== (action === 'hide' ? 'إخفاء' : 'حذف')) throw new Error('لم يتم تأكيد العملية.');
      if (action === 'hide') {
        const { error } = await supabase.from('custom_plan_types').update({ is_active: false }).eq('id', type.id);
        if (error) throw error;
      } else {
        const backup = [...(plans.data ?? []), ...(rows.data ?? [])];
        const book = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(backup), 'نسخة احتياطية');
        XLSX.writeFile(book, `نسخة-خطة-${type.name}.xlsx`);
        const { error } = await supabase.from('custom_plan_types').delete().eq('id', type.id);
        if (error) throw error;
      }
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['custom-plan-types'] }); navigate('/'); },
    onError: (error: Error) => setMessage(error.message),
  });
  const exportRows = () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows.data ?? []), 'الخطة');
    XLSX.writeFile(book, `خطة-${type?.name ?? 'مخصصة'}.xlsx`);
  };
  const importRows = async (file: File) => {
    if (!supabase || !planId || !canManage(profile)) return;
    const workbook = XLSX.read(await file.arrayBuffer());
    const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[workbook.SheetNames[0]]);
    const byMinistry = new Map((candidates.data?.schools ?? []).map((school) => [school.ministry_no, school.id]));
    const payload = records.map((record) => ({ plan_id: planId, school_id: byMinistry.get(String(record['الرقم الوزاري'] ?? '').trim()), planned_date: String(record['التاريخ المخطط'] ?? '').trim() || null, supervisor_name: String(record['اسم المشرف'] ?? '').trim() || null, engineer_name: String(record['اسم المهندس'] ?? '').trim() || null, status: 'planned' })).filter((row) => row.school_id && eligibleIds.includes(row.school_id));
    const { error } = await supabase.from('custom_plan_rows').upsert(payload, { onConflict: 'plan_id,school_id' });
    if (error) setMessage(error.message); else { setMessage(`تم استيراد ${payload.length} صفاً.`); await queryClient.invalidateQueries({ queryKey: ['custom-plan-rows', planId] }); }
  };

  if (typeQuery.isLoading) return <section className="card p-6 text-center">جارٍ تحميل الخطة…</section>;
  if (typeQuery.error || !type) return <section role="alert" className="card p-6 text-center text-rose-700">تعذر تحميل نوع الخطة.</section>;
  const currentPlans = plans.data ?? [];
  return <div className="grid gap-5">
    <section className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm text-slate-500">خطة مخصصة</p><h2 className="mt-1 text-2xl font-bold text-brand-900">{type.name}</h2></div><div className="flex flex-wrap gap-2">
      {canManage(profile) && <><label className="cursor-pointer rounded-lg border border-slate-300 px-3 py-2 text-sm">استيراد Excel<input className="hidden" type="file" accept=".xlsx,.xls" onChange={(event) => event.target.files?.[0] && importRows(event.target.files[0])} /></label><button type="button" onClick={() => { const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['الرقم الوزاري', 'التاريخ المخطط', 'اسم المشرف', 'اسم المهندس']]), 'قالب'); XLSX.writeFile(book, `قالب-${type.name}.xlsx`); }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">تنزيل قالب Excel</button><button type="button" onClick={exportRows} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">تصدير Excel</button></>}
      {canTypeManage(profile) && <><button type="button" onClick={() => deleteType.mutate('hide')} className="rounded-lg border border-amber-300 px-3 py-2 text-sm text-amber-800">إخفاء من القائمة</button><button type="button" onClick={() => deleteType.mutate('delete')} className="rounded-lg bg-rose-700 px-3 py-2 text-sm text-white">حذف الخطة من القائمة</button></>}</div></section>
    <section className="card grid gap-4 p-5"><div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm font-semibold">{type.cadence === 'monthly' ? 'الشهر' : 'السنة'}<input type={type.cadence === 'monthly' ? 'month' : 'number'} value={period} onChange={(event) => setPeriod(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2" /></label><label className="grid gap-1 text-sm font-semibold">الفترة المنشأة<select value={planId} onChange={(event) => setPlanId(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2"><option value="">اختر فترة</option>{currentPlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.period}</option>)}</select></label></div>
      {type.scope === 'manual' && <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 p-3">{(candidates.data?.schools ?? []).filter((school) => eligibleIds.includes(school.id)).map((school) => <label key={school.id} className="flex gap-2 py-1 text-sm"><input type="checkbox" checked={selectedIds.includes(school.id)} onChange={(event) => setSelectedIds((ids) => event.target.checked ? [...ids, school.id] : ids.filter((id) => id !== school.id))} />{school.name} <span className="text-slate-400">{school.ministry_no}</span></label>)}</div>}
      {type.scope === 'all_in_scope' && <p className="text-sm text-slate-600">ستضاف جميع المدارس المؤهلة تلقائياً، باستثناء «مشترك ملحق».</p>}
      <button type="button" disabled={createPlan.isPending || !canManage(profile)} onClick={() => createPlan.mutate()} className="w-fit rounded-lg bg-brand-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">إنشاء فترة الخطة</button>
    </section>
    {message && <p role="status" className="text-sm text-slate-700">{message}</p>}
    <section className="card p-5">{!planId ? <p className="text-center text-sm text-slate-500">اختر فترة منشأة لعرض الصفوف.</p> : rows.isLoading ? <p role="status">جارٍ تحميل الصفوف…</p> : !rows.data?.length ? <p className="text-center text-sm text-slate-500">لا توجد صفوف في هذه الفترة.</p> : <div className="table-scroll"><table><thead><tr><th>المدرسة</th><th>الموعد المخطط</th><th>التنفيذ</th><th>الحالة</th><th>المشرف</th><th>المهندس</th><th>زيارة/تقرير</th><th>حذف</th></tr></thead><tbody>{rows.data.map((row) => <tr key={row.id}><td>{row.school?.name ?? 'مدرسة محذوفة'}</td><td><input type="date" value={row.planned_date ?? ''} onChange={(event) => updateRow.mutate({ id: row.id, field: 'planned_date', value: event.target.value || null })} /></td><td><input type="date" value={row.execution_date ?? ''} onChange={(event) => updateRow.mutate({ id: row.id, field: 'execution_date', value: event.target.value || null })} /></td><td><select value={row.status} onChange={(event) => updateRow.mutate({ id: row.id, field: 'status', value: event.target.value })}><option value="planned">مخطط</option><option value="in_progress">جارٍ</option><option value="done">منجز</option><option value="cancelled">ملغى</option></select></td><td><input value={row.supervisor_name ?? ''} onChange={(event) => updateRow.mutate({ id: row.id, field: 'supervisor_name', value: event.target.value || null })} /></td><td><input value={row.engineer_name ?? ''} onChange={(event) => updateRow.mutate({ id: row.id, field: 'engineer_name', value: event.target.value || null })} /></td><td>{type.track_visit_report && <span className="flex gap-2"><label><input type="checkbox" checked={Boolean(row.visited)} onChange={(event) => updateRow.mutate({ id: row.id, field: 'visited', value: event.target.checked })} /> زيارة</label><label><input type="checkbox" checked={Boolean(row.report_done)} onChange={(event) => updateRow.mutate({ id: row.id, field: 'report_done', value: event.target.checked })} /> تقرير</label></span>}</td><td><button type="button" onClick={() => deleteRows.mutate({ rowId: row.id })} className="text-rose-700">حذف</button></td></tr>)}</tbody></table><div className="mt-4 flex gap-2"><button type="button" onClick={() => deleteRows.mutate({})} className="rounded-lg border border-rose-300 px-3 py-2 text-sm text-rose-800">مسح الصفوف</button><button type="button" onClick={() => deletePlan.mutate()} className="rounded-lg bg-rose-700 px-3 py-2 text-sm text-white">حذف الخطة</button></div></div>}</section>
  </div>;
}

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { loadXlsx } from '../../lib/xlsx';
import { describeDatabaseError, eligibleCustomSchoolIds, customPlanTypeSchema, type CustomPlanType } from '../../domain/customPlans';
import { normalizeMinistryNumber, parseImportDate, schoolPersonDefault } from '../../domain/imports';
import type { ScheduleAssignment } from '../../domain/planScheduler';
import type { PlanEligibilityConfig } from '../../domain/planEligibility';
import type { UserProfile } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { BulkPlanUpdates } from './BulkPlanUpdates';
import { SupervisorPlanGenerator } from './SupervisorPlanGenerator';

const rowSchema = z.object({
  id: z.string().uuid(), school_id: z.string().uuid().nullable(), planned_date: z.string().nullable(),
  execution_date: z.string().nullable(), status: z.enum(['planned', 'in_progress', 'done', 'cancelled']),
  supervisor_name: z.string().nullable(), engineer_name: z.string().nullable(), visited: z.boolean().nullable(),
  visited_date: z.string().nullable(), report_done: z.boolean().nullable(), report_done_date: z.string().nullable(), notes: z.string().nullable(),
  school: z.object({ name: z.string(), ministry_no: z.string(), ministry_key: z.string() }).nullable(),
});
type School = {
  id: string;
  name: string;
  ministry_no: string;
  ministry_key: string;
  extra: Record<string, unknown>;
  plan_scope: boolean | null;
  neighbourhood: string | null;
  latitude: number | null;
  longitude: number | null;
};
type CustomImportRow = {
  line: number;
  ministry: string;
  plannedDate: string | null;
  plannedDateInvalid: boolean;
  supervisorName: string | null;
  engineerName: string | null;
  candidates: School[];
  schoolId: string;
};
type CustomImportResult = { line: number; ministry: string; status: string; note: string };
const configSchema = z.object({
  buildingTypeHeader: z.string(), independentBuildingValues: z.array(z.string()),
  primarySharedValues: z.array(z.string()), elevatorContractorHeader: z.string(), noElevatorValues: z.array(z.string()),
});
const canManage = (profile: UserProfile | null) => Boolean(profile && ['admin', 'project_manager', 'area_engineer'].includes(profile.role));
const canTypeManage = (profile: UserProfile | null) => Boolean(profile && ['admin', 'project_manager'].includes(profile.role));
const periodFor = (cadence: CustomPlanType['cadence'], value: string) => cadence === 'monthly' ? `${value}-01` : `${value}-01-01`;
const noSchoolSelection: string[] = [];

async function loadType(typeId: string): Promise<CustomPlanType> {
  if (!supabase) throw new Error('يلزم إعداد Supabase.');
  const { data, error } = await supabase.from('custom_plan_types').select('id,name,cadence,scope,track_visit_report,group_key,created_at,is_active').eq('id', typeId).single();
  if (error) throw error;
  return customPlanTypeSchema.parse(data);
}

async function loadCandidates(): Promise<{ schools: School[]; config: PlanEligibilityConfig | null }> {
  if (!supabase) return { schools: [], config: null };
  const [schoolsResult, configResult] = await Promise.all([
    supabase.from('schools').select('id,name,ministry_no,ministry_key,extra,plan_scope,neighbourhood,latitude:lat,longitude:lng').order('name'),
    supabase.from('app_config').select('value').eq('key', 'plan_eligibility').maybeSingle(),
  ]);
  if (schoolsResult.error) throw schoolsResult.error;
  if (configResult.error) throw configResult.error;
  return { schools: z.array(z.object({
    id: z.string().uuid(), name: z.string(), ministry_no: z.string(), ministry_key: z.string(),
    extra: z.record(z.string(), z.unknown()), plan_scope: z.boolean().nullable(),
    neighbourhood: z.string().nullable(), latitude: z.number().nullable(), longitude: z.number().nullable(),
  })).parse(schoolsResult.data), config: configResult.data ? configSchema.parse(configResult.data.value) : null };
}

export function CustomPlanPage({ profile }: { profile: UserProfile | null }) {
  const { typeId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const typeQuery = useQuery({ queryKey: ['custom-plan-type', typeId], queryFn: () => loadType(typeId), enabled: Boolean(typeId) });
  const candidates = useQuery({ queryKey: ['custom-plan-candidates'], queryFn: loadCandidates });
  const now = new Date();
  const [period, setPeriod] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [planId, setPlanId] = useState('');
  const [message, setMessage] = useState('');
  const [importPreview, setImportPreview] = useState<CustomImportRow[] | null>(null);
  const [importResult, setImportResult] = useState<CustomImportResult[]>([]);
  const type = typeQuery.data;
  useEffect(() => {
    if (!type) return;
    if (type.cadence === 'yearly' && !/^\d{4}$/.test(period)) setPeriod(String(new Date().getFullYear()));
    if (type.cadence === 'monthly' && !/^\d{4}-\d{2}$/.test(period)) {
      const now = new Date();
      setPeriod(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
    }
  }, [type, period]);
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
      const { data, error } = await supabase.from('custom_plan_rows').select('id,school_id,planned_date,execution_date,status,supervisor_name,engineer_name,visited,visited_date,report_done,report_done_date,notes,school:schools(name,ministry_no,ministry_key)').eq('plan_id', planId).order('planned_date');
      if (error) throw error;
      return z.array(rowSchema).parse(data);
    },
  });
  const eligibleIds = useMemo(() => {
    if (!type || !candidates.data?.config) return [];
    return eligibleCustomSchoolIds(candidates.data.schools.map((school) => ({ id: school.id, sourceFields: { ...school.extra, plan_scope: school.plan_scope } })), type.scope, candidates.data.config);
  }, [type, candidates.data]);
  const schedulerSchools = useMemo(() => (candidates.data?.schools ?? [])
    .filter((school) => eligibleIds.includes(school.id))
    .map((school) => {
      const sourceFields = { ...school.extra, plan_scope: school.plan_scope };
      const planType = type?.name.includes('نظافة') ? 'cleaning' : 'maintenance';
      const knownName = schoolPersonDefault({ source_fields: sourceFields }, 'supervisor', planType);
      const anySupervisor = Object.entries(sourceFields)
        .find(([key, value]) => /مشرف/.test(key) && !/تكييف|شركة/.test(key) && String(value ?? '').trim());
      return {
        id: school.id,
        name: school.name,
        ministryNumber: school.ministry_no,
        supervisorName: knownName || String(anySupervisor?.[1] ?? '').trim() || null,
        neighbourhood: school.neighbourhood,
        latitude: school.latitude,
        longitude: school.longitude,
      };
    }), [candidates.data, eligibleIds, type]);
  const customRange = useMemo(() => {
    if (!type) return null;
    if (type.cadence === 'monthly' && /^\d{4}-\d{2}$/.test(period)) {
      const start = `${period}-01`;
      const end = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).toISOString().slice(0, 10);
      return { start, end };
    }
    if (type.cadence === 'yearly' && /^\d{4}$/.test(period)) return { start: `${period}-01-01`, end: `${period}-12-31` };
    return null;
  }, [type, period]);
  const createPlan = useMutation({
    mutationFn: async (assignments: ScheduleAssignment[]) => {
      if (!supabase || !type || !canManage(profile)) throw new Error('لا تملك صلاحية إدارة الخطة.');
      if (!assignments.length) throw new Error('اختر مدرسة واحدة على الأقل وأنشئ معاينة التوزيع.');
      const allowedIds = new Set(eligibleIds);
      if (assignments.some((assignment) => !allowedIds.has(assignment.schoolId))
        || new Set(assignments.map((assignment) => assignment.schoolId)).size !== assignments.length) {
        throw new Error('تتضمن المعاينة مدارس غير مؤهلة أو مكررة.');
      }
      const parsedPeriod = periodFor(type.cadence, period);
      if (assignments.some((assignment) => {
        const parsedDate = new Date(`${assignment.plannedDate}T00:00:00.000Z`);
        return !Number.isFinite(parsedDate.getTime())
          || parsedDate.toISOString().slice(0, 10) !== assignment.plannedDate
          || (type.cadence === 'monthly'
            ? assignment.plannedDate.slice(0, 7) !== period
            : assignment.plannedDate.slice(0, 4) !== period);
      })) throw new Error('يجب أن تقع مواعيد التوزيع ضمن فترة الخطة.');
      const { data: plan, error } = await supabase.from('custom_plans').upsert({ type_id: type.id, period: parsedPeriod }, { onConflict: 'type_id,period' }).select('id').single();
      if (error) throw error;
      const { error: rowError } = await supabase.from('custom_plan_rows').upsert(assignments.map((assignment) => ({
        plan_id: plan.id,
        school_id: assignment.schoolId,
        planned_date: assignment.plannedDate,
        supervisor_id: assignment.supervisorId,
        supervisor_name: assignment.supervisorName,
        status: 'planned',
      })), { onConflict: 'plan_id,school_id' });
      if (rowError) throw rowError;
      return plan.id as string;
    },
    onSuccess: async (createdPlanId) => {
      setPlanId(createdPlanId);
      setMessage('تم إنشاء الفترة وحفظ توزيع المدارس والمشرفين.');
      await queryClient.invalidateQueries({ queryKey: ['custom-plans', typeId] });
      await queryClient.invalidateQueries({ queryKey: ['custom-plan-rows', createdPlanId] });
    },
    onError: (error: unknown) => { console.error('Custom plan creation failed', error); setMessage(describeDatabaseError(error)); },
  });
  const updateRow = useMutation({
    mutationFn: async ({ id, field, value }: { id: string; field: string; value: unknown }) => {
      if (!supabase || !canManage(profile)) throw new Error('لا تملك صلاحية تعديل الصف.');
      if (field === 'report_done' && value === true && !rows.data?.find((row) => row.id === id)?.visited) {
        throw new Error('لا يمكن إكمال التقرير قبل تسجيل الزيارة.');
      }
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
      const XLSX = await loadXlsx();
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
      const XLSX = await loadXlsx();
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
        const XLSX = await loadXlsx();
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
  const exportRows = async () => {
    const XLSX = await loadXlsx();
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows.data ?? []), 'الخطة');
    XLSX.writeFile(book, `خطة-${type?.name ?? 'مخصصة'}.xlsx`);
  };
  const previewImportRows = async (file: File | undefined) => {
    if (!file || !canManage(profile) || !planId) return;
    setMessage('');
    setImportResult([]);
    try {
      const XLSX = await loadXlsx();
      const workbook = XLSX.read(await file.arrayBuffer(), { cellDates: false });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) throw new Error('لا توجد ورقة بيانات في الملف.');
      const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
      if (!records.length) throw new Error('لا توجد صفوف في الملف.');
      const byMinistry = new Map<string, School[]>();
      for (const school of candidates.data?.schools ?? []) {
        const current = byMinistry.get(school.ministry_key) ?? [];
        current.push(school);
        byMinistry.set(school.ministry_key, current);
      }
      setImportPreview(records.map((record, index) => {
        const ministry = String(record['الرقم الوزاري'] ?? '');
        const matching = byMinistry.get(normalizeMinistryNumber(ministry)) ?? [];
        const eligible = matching.filter((school) => eligibleIds.includes(school.id));
        const rawDate = record['التاريخ المخطط'];
        const plannedDate = parseImportDate(rawDate);
        return {
          line: index + 2,
          ministry,
          plannedDate,
          plannedDateInvalid: rawDate !== '' && rawDate !== null && rawDate !== undefined && plannedDate === null,
          supervisorName: String(record['اسم المشرف'] ?? '').trim() || null,
          engineerName: String(record['اسم المهندس'] ?? '').trim() || null,
          candidates: eligible,
          schoolId: eligible.length === 1 ? eligible[0].id : '',
        };
      }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };
  const applyImportRows = async () => {
    if (!supabase || !planId || !canManage(profile) || !importPreview) return;
    setMessage('');
    const result: CustomImportResult[] = [];
    try {
      const { error: schemaError } = await supabase.from('custom_plan_rows')
        .select('id,plan_id,school_id,planned_date,supervisor_name,engineer_name,status').limit(0);
      if (schemaError) throw new Error(`طبّق الترحيل 202611060004_plan_names_custom_plans.sql قبل الكتابة. PostgreSQL${schemaError.code ? ` (${schemaError.code})` : ''}: ${schemaError.message}`);
      const seenSchoolIds = new Set<string>();
      const ready: Array<{ source: CustomImportRow; school: School }> = [];
      for (const source of importPreview) {
        const school = source.candidates.find((candidate) => candidate.id === source.schoolId);
        if (source.plannedDateInvalid) {
          result.push({ line: source.line, ministry: source.ministry, status: 'غير صالح', note: 'التاريخ المخطط غير صالح.' });
        } else if (!source.candidates.length) {
          result.push({ line: source.line, ministry: source.ministry, status: 'غير مطابق', note: 'لا توجد مدرسة مؤهلة بهذا الرقم الوزاري.' });
        } else if (!school) {
          result.push({ line: source.line, ministry: source.ministry, status: 'يحتاج اختياراً', note: 'اختر المدرسة لهذا الصف؛ بقية الملف ستستمر.' });
        } else if (seenSchoolIds.has(school.id)) {
          result.push({ line: source.line, ministry: source.ministry, status: 'غير صالح', note: 'تكرر الصف نفسه في ملف الاستيراد.' });
        } else {
          seenSchoolIds.add(school.id);
          ready.push({ source, school });
        }
      }
      for (let offset = 0; offset < ready.length; offset += 100) {
        const batch = ready.slice(offset, offset + 100);
        const payload = batch.map(({ source, school }) => ({
          plan_id: planId, school_id: school.id, planned_date: source.plannedDate,
          supervisor_name: source.supervisorName, engineer_name: source.engineerName, status: 'planned',
        }));
        const { error } = await supabase.from('custom_plan_rows').upsert(payload, { onConflict: 'plan_id,school_id' });
        const chunkError = error
          ? `فشل الجزء الذي يضم أسطر الملف ${batch[0].source.line}–${batch[batch.length - 1].source.line}: PostgreSQL${error.code ? ` (${error.code})` : ''}: ${error.message}`
          : '';
        batch.forEach(({ source }) => result.push({
          line: source.line, ministry: source.ministry,
          status: error ? 'تحتاج مراجعة' : 'تم الاستيراد',
          note: chunkError,
        }));
      }
      setImportResult(result.sort((a, b) => a.line - b.line));
      setMessage(`تمت معالجة ${ready.length} صفاً صالحاً. راجع الصفوف غير المحسومة قبل إغلاق المعاينة.`);
      await queryClient.invalidateQueries({ queryKey: ['custom-plan-rows', planId] });
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      setImportResult(importPreview.map((row) => ({ line: row.line, ministry: row.ministry, status: 'تحتاج مراجعة', note: details })));
      setMessage(details);
    }
  };
  const downloadImportResult = async () => {
    const XLSX = await loadXlsx();
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
      ['صف الملف', 'الرقم الوزاري', 'الحالة', 'التفاصيل'],
      ...importResult.map((row) => [row.line, row.ministry, row.status, row.note]),
    ]), 'نتيجة الاستيراد');
    XLSX.writeFile(book, 'تقرير-استيراد-الخطة-المخصصة.xlsx');
  };

  if (typeQuery.isLoading) return <section className="card p-6 text-center">جارٍ تحميل الخطة…</section>;
  if (typeQuery.error || !type) return <section role="alert" className="card p-6 text-center text-rose-700">تعذر تحميل نوع الخطة.</section>;
  const currentPlans = plans.data ?? [];
  const candidateError = candidates.error
    ? /ministry_key/i.test(candidates.error.message)
      ? `طبّق الترحيل 202611070001_ministry_key.sql. PostgreSQL: ${candidates.error.message}`
      : candidates.error.message
    : '';
  return <div className="grid gap-5">
    <section className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm text-slate-500">خطة مخصصة</p><h2 className="mt-1 text-2xl font-bold text-brand-900">{type.name}</h2></div><div className="flex flex-wrap gap-2">
      {canManage(profile) && <><label className="cursor-pointer rounded-lg border border-slate-300 px-3 py-2 text-sm">معاينة استيراد Excel<input className="hidden" type="file" accept=".xlsx,.xls" disabled={!planId || candidates.isLoading || Boolean(candidateError)} onChange={(event) => { void previewImportRows(event.target.files?.[0]); event.currentTarget.value = ''; }} /></label><button type="button" onClick={async () => { const XLSX = await loadXlsx(); const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['الرقم الوزاري', 'التاريخ المخطط', 'اسم المشرف', 'اسم المهندس']]), 'قالب'); XLSX.writeFile(book, `قالب-${type.name}.xlsx`); }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">تنزيل قالب Excel</button><button type="button" onClick={exportRows} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">تصدير Excel</button></>}
      {canTypeManage(profile) && <><button type="button" onClick={() => deleteType.mutate('hide')} className="rounded-lg border border-amber-300 px-3 py-2 text-sm text-amber-800">إخفاء من القائمة</button><button type="button" onClick={() => deleteType.mutate('delete')} className="rounded-lg bg-rose-700 px-3 py-2 text-sm text-white">حذف الخطة من القائمة</button></>}</div></section>
    <section className="card grid gap-4 p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold">{type.cadence === 'monthly' ? 'الشهر' : 'السنة'}
          <input type={type.cadence === 'monthly' ? 'month' : 'number'} value={period} onChange={(event) => setPeriod(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2" />
        </label>
        <label className="grid gap-1 text-sm font-semibold">الفترة المنشأة
          <select value={planId} onChange={(event) => { setPlanId(event.target.value); setImportPreview(null); setImportResult([]); }} className="rounded-lg border border-slate-300 px-3 py-2">
            <option value="">اختر فترة</option>{currentPlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.period}</option>)}
          </select>
        </label>
      </div>
      {type.scope === 'all_in_scope' && <p className="text-sm text-slate-600">ستضاف جميع المدارس المؤهلة تلقائياً، باستثناء «مشترك ملحق».</p>}
      {customRange && <SupervisorPlanGenerator
        key={`${type.cadence}-${period}`}
        schools={schedulerSchools}
        initialSchoolIds={type.scope === 'all_in_scope' ? eligibleIds : noSchoolSelection}
        lockedSelection={type.scope === 'all_in_scope'}
        startDate={customRange.start}
        endDate={customRange.end}
        minDate={customRange.start}
        maxDate={customRange.end}
        disabled={!canManage(profile) || candidates.isLoading || Boolean(candidateError)}
        saving={createPlan.isPending}
        onSave={(assignments) => createPlan.mutate(assignments)}
      />}
    </section>
    {candidateError && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">تعذر تحميل بيانات المدارس: {candidateError}</p>}
    {importPreview && <section className="card grid gap-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-bold">معاينة استيراد الفترة المحددة</h3>
        <button type="button" onClick={() => setImportPreview(null)} className="rounded-lg border px-3 py-2 text-sm">إغلاق المعاينة</button>
      </div>
      <p className="text-sm text-slate-600">المؤهل والمطابق تلقائياً: {importPreview.filter((row) => row.schoolId && !row.plannedDateInvalid).length} · يحتاج اختيار مدرسة أو مراجعة: {importPreview.filter((row) => !row.schoolId || row.plannedDateInvalid).length}</p>
      <div className="max-h-64 overflow-auto rounded-lg border">
        <table className="min-w-full text-start text-sm">
          <thead className="bg-slate-50"><tr><th className="p-2">الصف</th><th className="p-2">الرقم الوزاري</th><th className="p-2">المدرسة</th><th className="p-2">الحالة</th></tr></thead>
          <tbody>{importPreview.map((row) => <tr key={row.line} className="border-t">
            <td className="p-2">{row.line}</td><td className="p-2">{row.ministry}</td>
            <td className="p-2"><select value={row.schoolId} onChange={(event) => setImportPreview((current) => current?.map((item) => item.line === row.line ? { ...item, schoolId: event.target.value } : item) ?? null)} className="max-w-72 rounded border px-2 py-1">
              <option value="">{row.candidates.length > 1 ? 'اختر المدرسة لهذا الصف' : 'لا توجد مدرسة مؤهلة'}</option>
              {row.candidates.map((school) => <option key={school.id} value={school.id}>{school.name} · {school.ministry_no}</option>)}
            </select></td>
            <td className="p-2">{row.plannedDateInvalid ? 'تاريخ غير صالح' : !row.candidates.length ? 'غير مطابق' : row.candidates.length > 1 && !row.schoolId ? 'اختر صفاً واحداً' : 'جاهز'}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <button type="button" disabled={!canManage(profile) || !importPreview.some((row) => row.schoolId && !row.plannedDateInvalid)} onClick={() => void applyImportRows()} className="w-fit rounded-lg bg-brand-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">استيراد الصفوف الجاهزة فقط</button>
      {importResult.length > 0 && <div className="grid gap-2"><div className="max-h-40 overflow-auto rounded border">{importResult.map((row) => <p key={`${row.line}-${row.status}`} className="border-b p-2 text-sm last:border-0">صف {row.line} · {row.status} · {row.note || '—'}</p>)}</div><button type="button" onClick={() => void downloadImportResult()} className="w-fit rounded-lg border px-3 py-2 text-sm">تنزيل تقرير الاستيراد</button></div>}
    </section>}
    {message && <p role="status" className="text-sm text-slate-700">{message}</p>}
    {planId && <BulkPlanUpdates
      key={planId}
      planKind="custom"
      planId={planId}
      disabled={!profile || !['admin', 'project_manager', 'area_engineer', 'report_follower'].includes(profile.role)}
      rows={(rows.data ?? []).map((row) => ({
        id: row.id,
        schoolName: row.school?.name ?? 'مدرسة محذوفة',
        ministryNumber: row.school?.ministry_no ?? '',
        ministryKey: row.school?.ministry_key ?? '',
        supervisorName: row.supervisor_name,
        visited: Boolean(row.visited),
        visitedAt: row.visited_date,
        reportAt: row.report_done_date,
      }))}
      allSchools={(candidates.data?.schools ?? []).map((school) => ({
        schoolName: school.name,
        ministryNumber: school.ministry_no,
        ministryKey: school.ministry_key,
      }))}
      onUpdated={() => { void queryClient.invalidateQueries({ queryKey: ['custom-plan-rows', planId] }); }}
    />}
    <section className="card p-5">{!planId ? <p className="text-center text-sm text-slate-500">اختر فترة منشأة لعرض الصفوف.</p> : rows.isLoading ? <p role="status">جارٍ تحميل الصفوف…</p> : !rows.data?.length ? <p className="text-center text-sm text-slate-500">لا توجد صفوف في هذه الفترة.</p> : <div className="table-scroll"><table><thead><tr><th>المدرسة</th><th>الموعد المخطط</th><th>التنفيذ</th><th>الحالة</th><th>المشرف</th><th>المهندس</th><th>زيارة/تقرير</th><th>حذف</th></tr></thead><tbody>{rows.data.map((row) => <tr key={row.id}><td>{row.school?.name ?? 'مدرسة محذوفة'}</td><td><input type="date" value={row.planned_date ?? ''} onChange={(event) => updateRow.mutate({ id: row.id, field: 'planned_date', value: event.target.value || null })} /></td><td><input type="date" value={row.execution_date ?? ''} onChange={(event) => updateRow.mutate({ id: row.id, field: 'execution_date', value: event.target.value || null })} /></td><td><select value={row.status} onChange={(event) => updateRow.mutate({ id: row.id, field: 'status', value: event.target.value })}><option value="planned">مخطط</option><option value="in_progress">جارٍ</option><option value="done">منجز</option><option value="cancelled">ملغى</option></select></td><td><input value={row.supervisor_name ?? ''} onChange={(event) => updateRow.mutate({ id: row.id, field: 'supervisor_name', value: event.target.value || null })} /></td><td><input value={row.engineer_name ?? ''} onChange={(event) => updateRow.mutate({ id: row.id, field: 'engineer_name', value: event.target.value || null })} /></td><td>{type.track_visit_report && <span className="flex gap-2"><label><input type="checkbox" checked={Boolean(row.visited)} onChange={(event) => updateRow.mutate({ id: row.id, field: 'visited', value: event.target.checked })} /> زيارة</label><label><input type="checkbox" checked={Boolean(row.report_done)} onChange={(event) => updateRow.mutate({ id: row.id, field: 'report_done', value: event.target.checked })} /> تقرير</label></span>}</td><td><button type="button" onClick={() => deleteRows.mutate({ rowId: row.id })} className="text-rose-700">حذف</button></td></tr>)}</tbody></table><div className="mt-4 flex gap-2"><button type="button" onClick={() => deleteRows.mutate({})} className="rounded-lg border border-rose-300 px-3 py-2 text-sm text-rose-800">مسح الصفوف</button><button type="button" onClick={() => deletePlan.mutate()} className="rounded-lg bg-rose-700 px-3 py-2 text-sm text-white">حذف الخطة</button></div></div>}</section>
  </div>;
}

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Eye, EyeOff, X } from 'lucide-react';
import { loadXlsx } from '../../lib/xlsx';
import { z } from 'zod';
import type { UserProfile } from '../../lib/auth';
import { APP_SCHEMA_SELECT } from '../../lib/schemaColumns';
import { supabase } from '../../lib/supabase';
import { ImportWizardLauncher } from '../imports/ImportWizard';

const schoolSchema = z.object({
  id: z.string().uuid(),
  school_name: z.string(),
  ministry_number: z.string(),
  neighbourhood: z.string().nullable(),
});
const employeeSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  employee_no: z.string().nullable(),
  job_title: z.string().nullable(),
  phone: z.string().nullable(),
});
const gatekeeperSchema = z.object({
  id: z.string().uuid(),
  school_id: z.string().uuid(),
  employee_id: z.string().uuid().nullable(),
  full_name: z.string(),
  employee_no: z.string().nullable(),
  phone: z.string().nullable(),
  notes: z.string().nullable(),
});
type School = z.infer<typeof schoolSchema>;
type Gatekeeper = z.infer<typeof gatekeeperSchema>;
type EditorValues = {
  employeeId: string;
  fullName: string;
  employeeNo: string;
  phone: string;
  notes: string;
  residenceNo: string;
  clearResidence: boolean;
};

async function loadGatekeeperData() {
  if (!supabase) return { schools: [], employees: [], gatekeepers: [] };
  const [schoolsResult, employeeResult, gatekeeperResult] = await Promise.all([
    supabase.from('schools')
      .select(APP_SCHEMA_SELECT.schoolsGatekeeperPlacement)
      .eq('plan_scope', true)
      .order('name'),
    supabase.from('employees')
      .select(APP_SCHEMA_SELECT.employeesForGatekeepers)
      .eq('job_title', 'حارس مدرسة')
      .order('full_name'),
    supabase.from('gatekeepers').select(APP_SCHEMA_SELECT.gatekeeperPlacement),
  ]);
  for (const result of [schoolsResult, employeeResult, gatekeeperResult]) {
    if (result.error) throw result.error;
  }
  return {
    schools: z.array(schoolSchema).parse(schoolsResult.data),
    employees: z.array(employeeSchema).parse(employeeResult.data),
    gatekeepers: z.array(gatekeeperSchema).parse(gatekeeperResult.data),
  };
}

export function GatekeeperPlacementPage({ profile }: { profile: UserProfile | null }) {
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [withoutGatekeeper, setWithoutGatekeeper] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [editingSchool, setEditingSchool] = useState<School | null>(null);
  const [editor, setEditor] = useState<EditorValues | null>(null);
  const [message, setMessage] = useState('');
  const data = useQuery({
    queryKey: ['gatekeeper-placement-data'],
    queryFn: loadGatekeeperData,
    enabled: Boolean(profile),
  });
  const canManage = Boolean(profile && ['admin', 'project_manager', 'area_engineer'].includes(profile.role));
  const rows = useMemo(() => {
    const gatekeepers = new Map((data.data?.gatekeepers ?? []).map((gatekeeper) => [gatekeeper.school_id, gatekeeper]));
    const query = search.trim().toLocaleLowerCase();
    return (data.data?.schools ?? [])
      .map((school) => ({ school, gatekeeper: gatekeepers.get(school.id) ?? null }))
      .filter(({ gatekeeper }) => !withoutGatekeeper || !gatekeeper)
      .filter(({ school, gatekeeper }) =>
        `${school.school_name} ${school.ministry_number} ${school.neighbourhood ?? ''} ${gatekeeper?.full_name ?? ''} ${gatekeeper?.employee_no ?? ''} ${gatekeeper?.phone ?? ''}`
          .toLocaleLowerCase().includes(query),
      )
      .sort((left, right) =>
        Number(Boolean(left.gatekeeper)) - Number(Boolean(right.gatekeeper))
        || left.school.school_name.localeCompare(right.school.school_name, 'ar'),
      );
  }, [data.data, search, withoutGatekeeper]);
  const totalCount = data.data?.schools.length ?? 0;
  const inScopeSchoolIds = new Set((data.data?.schools ?? []).map((school) => school.id));
  const withGatekeeperCount = data.data?.gatekeepers.filter((gatekeeper) => inScopeSchoolIds.has(gatekeeper.school_id)).length ?? 0;
  const withoutGatekeeperCount = Math.max(0, totalCount - withGatekeeperCount);

  const save = useMutation({
    mutationFn: async ({ schoolId, values }: { schoolId: string; values: EditorValues }) => {
      if (!supabase || !canManage) throw new Error('لا تملك صلاحية تعديل بيانات البوابين.');
      if (!values.fullName.trim()) throw new Error('اسم البواب مطلوب.');
      const payload: {
        school_id: string;
        employee_id: string | null;
        full_name: string;
        employee_no: string | null;
        phone: string | null;
        notes: string | null;
        residence_no?: string | null;
      } = {
        school_id: schoolId,
        employee_id: values.employeeId || null,
        full_name: values.fullName.trim(),
        employee_no: values.employeeNo.trim() || null,
        phone: values.phone.trim() || null,
        notes: values.notes.trim() || null,
      };
      if (values.clearResidence) payload.residence_no = null;
      else if (values.residenceNo.trim()) payload.residence_no = values.residenceNo.trim();
      const { error } = await supabase.from('gatekeepers').upsert(payload, { onConflict: 'school_id' });
      if (error) throw error;
    },
    onSuccess: async () => {
      setMessage('تم حفظ بيانات البواب.');
      setEditingSchool(null);
      setEditor(null);
      setRevealed({});
      await client.invalidateQueries({ queryKey: ['gatekeeper-placement-data'] });
    },
    onError: (error: Error) => setMessage(`تعذر حفظ بيانات البواب: ${error.message}`),
  });

  const remove = useMutation({
    mutationFn: async (schoolId: string) => {
      if (!supabase || !canManage) throw new Error('لا تملك صلاحية تعديل بيانات البوابين.');
      const { error } = await supabase.from('gatekeepers').delete().eq('school_id', schoolId);
      if (error) throw error;
    },
    onSuccess: async () => {
      setMessage('تم حذف سجل البواب.');
      setEditingSchool(null);
      setEditor(null);
      setRevealed({});
      await client.invalidateQueries({ queryKey: ['gatekeeper-placement-data'] });
    },
    onError: (error: Error) => setMessage(`تعذر حذف سجل البواب: ${error.message}`),
  });

  function openEditor(school: School, gatekeeper: Gatekeeper | null) {
    setEditingSchool(school);
    setEditor({
      employeeId: gatekeeper?.employee_id ?? '',
      fullName: gatekeeper?.full_name ?? '',
      employeeNo: gatekeeper?.employee_no ?? '',
      phone: gatekeeper?.phone ?? '',
      notes: gatekeeper?.notes ?? '',
      residenceNo: '',
      clearResidence: false,
    });
  }

  async function revealResidence(gatekeeper: Gatekeeper) {
    if (!supabase || !profile || !canManage) return;
    if (Object.hasOwn(revealed, gatekeeper.id)) {
      setRevealed((current) => {
        const next = { ...current };
        delete next[gatekeeper.id];
        return next;
      });
      return;
    }
    const { data: value, error } = await supabase.rpc('reveal_residence', {
      p_kind: 'gatekeepers',
      p_ids: [gatekeeper.id],
    });
    if (error) {
      setMessage(`تعذر إظهار رقم الإقامة: ${error.message}`);
      return;
    }
    const parsed = z.array(z.object({ id: z.string().uuid(), residence_no: z.string().nullable() })).length(1).safeParse(value);
    if (!parsed.success) {
      setMessage('لم يُرجع النظام رقم إقامة صالحاً.');
      return;
    }
    setRevealed((current) => ({ ...current, [gatekeeper.id]: parsed.data[0].residence_no ?? '' }));
  }

  async function exportRows() {
    const XLSX = await loadXlsx();
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['المدرسة', 'الرقم الوزاري', 'الحي', 'اسم البواب', 'الرقم الوظيفي', 'رقم الجوال', 'رقم الإقامة', 'ملاحظات'],
      ...rows.map(({ school, gatekeeper }) => [
        school.school_name,
        school.ministry_number,
        school.neighbourhood ?? '',
        gatekeeper?.full_name ?? '',
        gatekeeper?.employee_no ?? '',
        gatekeeper?.phone ?? '',
        gatekeeper ? '••••••' : '',
        gatekeeper?.notes ?? '',
      ]),
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'تسكين البوابين');
    XLSX.writeFile(workbook, 'تسكين-البوابين.xlsx');
  }

  return (
    <div className="grid gap-5">
      <section>
        <p className="text-sm text-slate-500">سجلات البوابين المسجلة للمدارس المستقلة والمشتركة الأساسية</p>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="mt-1 text-2xl font-bold text-brand-900">تسكين البوابين</h2>
          <ImportWizardLauncher target={{ kind: 'gatekeepers' }} profile={profile} />
        </div>
      </section>
      {data.error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">تعذر تحميل بيانات البوابين: {data.error.message}</div>}
      <section className="card grid gap-4 p-5">
        <div className="grid gap-3 sm:grid-cols-4">
          <Metric label="البوابون المطلوبون" value={totalCount} />
          <Metric label="البوابون المسندون" value={withGatekeeperCount} />
          <Metric label="العجز" value={withoutGatekeeperCount} />
          <Metric label="الفائض" value={Math.max(0, withGatekeeperCount - totalCount)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">مدارس لديها بواب: {withGatekeeperCount}</p>
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800">مدارس بلا بواب: {withoutGatekeeperCount}</p>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="min-w-60 flex-1 text-sm font-semibold">بحث باسم المدرسة أو الرقم الوزاري أو الحي أو بيانات البواب
            <input value={search} onChange={(event) => setSearch(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
          </label>
          <label className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <input type="checkbox" checked={withoutGatekeeper} onChange={(event) => setWithoutGatekeeper(event.target.checked)} />
            بدون بواب فقط
          </label>
          <button type="button" onClick={exportRows} disabled={!rows.length} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-50">
            <Download size={16} /> تصدير Excel
          </button>
        </div>
        <p className="text-xs text-slate-500">المعروض: {rows.length} من {totalCount} مدرسة ضمن النطاق.</p>
        {data.isLoading ? <p role="status">جارٍ تحميل السجلات…</p> : rows.length === 0 ? <p className="rounded-lg bg-slate-50 p-5 text-center text-sm text-slate-500">لا توجد مدارس مطابقة.</p> : (
          <div className="table-scroll">
            <table className="min-w-full text-start text-sm">
              <thead><tr>
                <th>المدرسة</th><th>الرقم الوزاري</th><th>الحي</th><th>اسم البواب</th>
                <th>الرقم الوظيفي</th><th>رقم الجوال</th><th>رقم الإقامة</th><th>ملاحظات</th><th>إجراء</th>
              </tr></thead>
              <tbody>{rows.map(({ school, gatekeeper }) => {
                const hasGatekeeper = Boolean(gatekeeper);
                const residence = gatekeeper && Object.hasOwn(revealed, gatekeeper.id)
                  ? revealed[gatekeeper.id] || 'غير مسجل'
                  : gatekeeper ? '••••••' : '—';
                return (
                  <tr key={school.id} className="border-t border-slate-100 align-top">
                    <td>{school.school_name}</td>
                    <td>{school.ministry_number}</td>
                    <td>{school.neighbourhood || 'غير محدد'}</td>
                    <td>{gatekeeper?.full_name ?? '—'}</td>
                    <td>{gatekeeper?.employee_no ?? '—'}</td>
                    <td>{gatekeeper?.phone ?? '—'}</td>
                    <td>
                      <span className="font-mono">{residence}</span>
                      {gatekeeper && canManage && <button type="button" onClick={() => void revealResidence(gatekeeper)} aria-label={Object.hasOwn(revealed, gatekeeper.id) ? 'إخفاء رقم الإقامة' : 'إظهار رقم الإقامة'} className="ms-2 rounded p-1 text-brand-700">
                        {Object.hasOwn(revealed, gatekeeper.id) ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>}
                    </td>
                    <td className="max-w-56 whitespace-pre-wrap">{gatekeeper?.notes || '—'}</td>
                    <td>{canManage && <button type="button" onClick={() => openEditor(school, gatekeeper)} className="rounded border border-brand-700 px-3 py-1 text-xs font-semibold text-brand-800">{hasGatekeeper ? 'تعديل' : 'إضافة'}</button>}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
        {message && <p role="status" className="text-sm text-slate-700">{message}</p>}
      </section>

      {editingSchool && editor && (
        <div className="fixed inset-0 z-[1000] overflow-y-auto bg-slate-950/50 p-3 sm:p-8" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) { setEditingSchool(null); setEditor(null); }
        }}>
          <section role="dialog" aria-modal="true" aria-labelledby="gatekeeper-dialog-title" className="mx-auto grid max-w-2xl gap-4 rounded-2xl bg-white p-5 shadow-2xl sm:p-7">
            <header className="flex items-start justify-between gap-3">
              <div>
                <h3 id="gatekeeper-dialog-title" className="text-xl font-bold text-brand-900">{editingSchool.school_name}</h3>
                <p className="mt-1 text-sm text-slate-500">الرقم الوزاري: {editingSchool.ministry_number} · الحي: {editingSchool.neighbourhood || 'غير محدد'}</p>
              </div>
              <button type="button" onClick={() => { setEditingSchool(null); setEditor(null); }} aria-label="إغلاق" className="rounded-lg p-2 hover:bg-slate-100"><X size={20} /></button>
            </header>
            <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => {
              event.preventDefault();
              save.mutate({ schoolId: editingSchool.id, values: editor });
            }}>
              <label className="grid gap-1 text-sm font-semibold">ربط بموظف (اختياري)
                <select value={editor.employeeId} onChange={(event) => {
                  const employeeId = event.target.value;
                  const selected = data.data?.employees.find((employee) => employee.id === employeeId);
                  setEditor((current) => current && ({
                    ...current,
                    employeeId,
                    ...(selected ? {
                      fullName: selected.full_name,
                      employeeNo: selected.employee_no ?? current.employeeNo,
                      phone: selected.phone ?? current.phone,
                    } : {}),
                  }));
                }} className="rounded-lg border border-slate-300 px-3 py-2">
                  <option value="">دون ربط بموظف</option>
                  {(data.data?.employees ?? []).map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name} · {employee.employee_no ?? 'دون رقم وظيفي'}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-sm font-semibold">اسم البواب
                <input required value={editor.fullName} onChange={(event) => setEditor((current) => current && ({ ...current, fullName: event.target.value }))} className="rounded-lg border border-slate-300 px-3 py-2" />
              </label>
              <label className="grid gap-1 text-sm font-semibold">الرقم الوظيفي
                <input value={editor.employeeNo} onChange={(event) => setEditor((current) => current && ({ ...current, employeeNo: event.target.value }))} className="rounded-lg border border-slate-300 px-3 py-2" />
              </label>
              <label className="grid gap-1 text-sm font-semibold">رقم الجوال
                <input type="tel" inputMode="tel" value={editor.phone} onChange={(event) => setEditor((current) => current && ({ ...current, phone: event.target.value }))} className="rounded-lg border border-slate-300 px-3 py-2" />
              </label>
              <label className="grid gap-1 text-sm font-semibold sm:col-span-2">رقم الإقامة الجديد (اختياري)
                <input value={editor.residenceNo} onChange={(event) => setEditor((current) => current && ({ ...current, residenceNo: event.target.value, clearResidence: false }))} autoComplete="off" className="rounded-lg border border-slate-300 px-3 py-2" />
              </label>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" checked={editor.clearResidence} onChange={(event) => setEditor((current) => current && ({ ...current, clearResidence: event.target.checked, residenceNo: '' }))} />
                مسح رقم الإقامة المسجل
              </label>
              <label className="grid gap-1 text-sm font-semibold sm:col-span-2">ملاحظات
                <textarea value={editor.notes} onChange={(event) => setEditor((current) => current && ({ ...current, notes: event.target.value }))} rows={3} className="rounded-lg border border-slate-300 px-3 py-2" />
              </label>
              <div className="flex flex-wrap justify-between gap-2 sm:col-span-2">
                {data.data?.gatekeepers.some((item) => item.school_id === editingSchool.id) && <button type="button" onClick={() => remove.mutate(editingSchool.id)} disabled={remove.isPending || save.isPending} className="rounded-lg border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 disabled:opacity-50">حذف سجل البواب</button>}
                <div className="ms-auto flex gap-2">
                  <button type="button" onClick={() => { setEditingSchool(null); setEditor(null); }} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">إلغاء</button>
                  <button type="submit" disabled={save.isPending || remove.isPending} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">حفظ</button>
                </div>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <article className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold text-brand-900">{value}</p></article>;
}

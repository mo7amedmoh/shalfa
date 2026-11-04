import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff } from 'lucide-react';
import { z } from 'zod';
import type { UserProfile } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { ImportWizardLauncher } from '../imports/ImportWizard';

const schoolSchema = z.object({
  id: z.string().uuid(),
  school_name: z.string(),
  ministry_number: z.string(),
  source_fields: z.record(z.string(), z.unknown()),
});
const employeeSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  employee_number: z.string().nullable(),
  job_title: z.string(),
  phone: z.string().nullable(),
});
const assignmentSchema = z.object({
  id: z.string().uuid(),
  school_id: z.string().uuid(),
  employee_id: z.string().uuid().nullable(),
  phone: z.string().nullable(),
  employee: z.object({ id: z.string().uuid(), full_name: z.string(), employee_number: z.string().nullable(), phone: z.string().nullable() }).nullable(),
});

async function loadGatekeeperData() {
  if (!supabase) return { schools: [], employees: [], assignments: [] };
  const [schoolsResult, employeeResult, assignmentResult] = await Promise.all([
    supabase.from('schools').select('id,school_name:name,ministry_number:ministry_no,source_fields:extra').order('name'),
    supabase.from('employees').select('id,full_name,employee_number:employee_no,job_title,phone').eq('job_title', 'حارس مدرسة').order('full_name'),
    supabase.from('gatekeepers').select('id,school_id,employee_id,phone,employee:employees(id,full_name,employee_number:employee_no,phone)'),
  ]);
  for (const result of [schoolsResult, employeeResult, assignmentResult]) {
    if (result.error) throw result.error;
  }
  return {
    schools: z.array(schoolSchema).parse(schoolsResult.data),
    employees: z.array(employeeSchema).parse(employeeResult.data),
    assignments: z.array(assignmentSchema).parse(assignmentResult.data),
  };
}

export function GatekeeperPlacementPage({ profile }: { profile: UserProfile | null }) {
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState<Record<string, string>>({});
  const [phone, setPhone] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const data = useQuery({ queryKey: ['gatekeeper-placement-data'], queryFn: loadGatekeeperData, enabled: Boolean(profile) });
  const canManage = Boolean(profile && ['admin', 'project_manager', 'area_engineer'].includes(profile.role));
  const rows = useMemo(() => {
    const assignments = new Map((data.data?.assignments ?? []).map((assignment) => [assignment.school_id, assignment]));
    const query = search.trim().toLocaleLowerCase();
    return (data.data?.schools ?? [])
      .map((school) => ({ school, assignment: assignments.get(school.id) ?? null }))
      .filter(({ school }) => `${school.school_name} ${school.ministry_number} ${String(school.source_fields['الحي'] ?? '')}`.toLocaleLowerCase().includes(query))
      .sort((left, right) => Number(Boolean(left.assignment?.employee_id)) - Number(Boolean(right.assignment?.employee_id)) || left.school.school_name.localeCompare(right.school.school_name, 'ar'));
  }, [data.data, search]);
  const missingCount = rows.filter(({ assignment }) => !assignment?.employee_id).length;

  const save = useMutation({
    mutationFn: async ({ schoolId, employeeId, phoneNumber }: { schoolId: string; employeeId: string; phoneNumber: string }) => {
      if (!supabase || !canManage) throw new Error('لا تملك صلاحية تعديل تسكين البوابين.');
      if (!employeeId) throw new Error('اختر بواباً أولاً.');
      const employee = data.data?.employees.find((candidate) => candidate.id === employeeId);
      if (!employee) throw new Error('تعذر العثور على الموظف المختار.');
      const { error } = await supabase.from('gatekeepers').upsert({
        school_id: schoolId,
        employee_id: employeeId,
        full_name: employee.full_name,
        phone: phoneNumber.trim() || null,
      }, { onConflict: 'school_id' });
      if (error) throw error;
    },
    onSuccess: async () => {
      setMessage('تم حفظ بيانات البواب.');
      await client.invalidateQueries({ queryKey: ['gatekeeper-placement-data'] });
    },
    onError: (error: Error) => setMessage(`تعذر حفظ بيانات البواب: ${error.message}`),
  });

  const remove = useMutation({
    mutationFn: async (schoolId: string) => {
      if (!supabase || !canManage) throw new Error('لا تملك صلاحية تعديل تسكين البوابين.');
      const { error } = await supabase.from('gatekeepers').delete().eq('school_id', schoolId);
      if (error) throw error;
    },
    onSuccess: async () => {
      setMessage('تم إلغاء تسكين البواب.');
      await client.invalidateQueries({ queryKey: ['gatekeeper-placement-data'] });
    },
    onError: (error: Error) => setMessage(`تعذر إلغاء التسكين: ${error.message}`),
  });

  async function revealResidence(gatekeeperId: string) {
    if (!supabase || !profile || !['admin', 'project_manager', 'area_engineer'].includes(profile.role)) return;
    if (revealed[gatekeeperId]) {
      setRevealed((current) => { const next = { ...current }; delete next[gatekeeperId]; return next; });
      return;
    }
    const { data: value, error } = await supabase.rpc('reveal_residence', { p_kind: 'gatekeepers', p_ids: [gatekeeperId] });
    if (error) {
      setMessage(`تعذر إظهار رقم الإقامة: ${error.message}`);
      return;
    }
    const parsed = z.array(z.object({ id: z.string().uuid(), residence_no: z.string().nullable() })).length(1).safeParse(value);
    if (!parsed.success) {
      setMessage('لم يُرجع النظام رقم إقامة صالحاً.');
      return;
    }
    const residenceNumber = parsed.data[0].residence_no;
    if (!residenceNumber) {
      setMessage('لا يوجد رقم إقامة مسجل لهذا البواب.');
      return;
    }
    setRevealed((current) => ({ ...current, [gatekeeperId]: residenceNumber }));
  }

  return (
    <div className="grid gap-5">
      <section>
        <p className="text-sm text-slate-500">ربط المدارس بالبوابين المسجلين في القوى العاملة</p>
        <div className="flex flex-wrap items-end justify-between gap-3"><h2 className="mt-1 text-2xl font-bold text-brand-900">تسكين البوابين</h2><ImportWizardLauncher target={{ kind: 'gatekeepers' }} profile={profile} /></div>
      </section>
      {data.error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">تعذر تحميل بيانات البوابين: {data.error.message}</div>}
      <section className="card grid gap-4 p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="min-w-60 flex-1 text-sm font-semibold">بحث باسم المدرسة أو الرقم الوزاري أو الحي
            <input value={search} onChange={(event) => setSearch(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
          </label>
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800">مدارس بلا بواب: {missingCount}</p>
        </div>
        {data.isLoading ? <p role="status">جارٍ تحميل السجلات…</p> : rows.length === 0 ? <p className="rounded-lg bg-slate-50 p-5 text-center text-sm text-slate-500">لا توجد مدارس مطابقة.</p> : (
          <div className="grid gap-3">
            {rows.map(({ school, assignment }) => {
              const isMissing = !assignment?.employee_id;
              const employeeId = assignment?.employee_id ?? '';
              const employee = assignment?.employee;
              return <article key={school.id} className={`rounded-xl border p-4 ${isMissing ? 'border-rose-200 bg-rose-50/50' : 'border-slate-200'}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="font-bold">{school.school_name}</h3>
                    <p className="mt-1 text-xs text-slate-500">الرقم الوزاري: {school.ministry_number} · الحي: {String(school.source_fields['الحي'] ?? 'غير محدد')}</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${isMissing ? 'bg-rose-100 text-rose-800' : 'bg-emerald-50 text-emerald-800'}`}>{isMissing ? 'لا يوجد بواب' : 'تم التسكين'}</span>
                </div>
                {employee && <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold">{employee.full_name}</span>
                  <span className="text-xs text-slate-500">رقم الموظف: {employee.employee_number}</span>
                  <span className="text-xs text-slate-600">{revealed[assignment?.id ?? ''] ?? '••••••'}</span>
                  {['admin', 'project_manager', 'area_engineer'].includes(profile?.role ?? '') && <button type="button" onClick={() => void revealResidence(assignment?.id ?? '')} aria-label={revealed[assignment?.id ?? ''] ? 'إخفاء رقم الإقامة' : 'إظهار رقم الإقامة'} className="rounded p-1 text-brand-700">{revealed[assignment?.id ?? ''] ? <EyeOff size={15} /> : <Eye size={15} />}</button>}
                  <a className="text-brand-700 underline" href={`tel:${assignment?.phone ?? ''}`}>{assignment?.phone || 'رقم الاتصال غير مسجل'}</a>
                </div>}
                {canManage && <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                  <select value={selectedEmployee[school.id] ?? employeeId} onChange={(event) => setSelectedEmployee((current) => ({ ...current, [school.id]: event.target.value }))} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                    <option value="">اختر بواباً</option>
                    {(data.data?.employees ?? []).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.full_name} · {candidate.job_title}</option>)}
                  </select>
                  <input value={phone[school.id] ?? assignment?.phone ?? employee?.phone ?? ''} onChange={(event) => setPhone((current) => ({ ...current, [school.id]: event.target.value }))} type="tel" inputMode="tel" placeholder="رقم الاتصال" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
                  <button type="button" onClick={() => save.mutate({ schoolId: school.id, employeeId: selectedEmployee[school.id] ?? employeeId, phoneNumber: phone[school.id] ?? assignment?.phone ?? employee?.phone ?? '' })} disabled={save.isPending} className="rounded-lg border border-brand-700 px-3 py-2 text-sm font-semibold text-brand-800 disabled:opacity-50">حفظ</button>
                </div>}
                {canManage && !isMissing && <button type="button" onClick={() => remove.mutate(school.id)} disabled={remove.isPending} className="mt-2 text-xs text-rose-700 disabled:opacity-50">إزالة التسكين</button>}
              </article>;
            })}
          </div>
        )}
        {message && <p role="status" className="text-sm text-slate-700">{message}</p>}
      </section>
    </div>
  );
}

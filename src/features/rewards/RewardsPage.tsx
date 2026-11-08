import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { z } from 'zod';
import { calculateRewardBalance, canAllocateReward } from '../../domain/rewards';
import type { UserProfile } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { APP_SCHEMA_SELECT } from '../../lib/schemaColumns';
import { loadXlsx } from '../../lib/xlsx';

const poolSchema = z.object({
  id: z.string().uuid(),
  month: z.string(),
  engineer_id: z.string().uuid(),
  amount: z.coerce.number().nonnegative(),
  status: z.enum(['open', 'approved']),
});
const engineerSchema = z.object({
  profile_id: z.string().uuid(),
  display_name: z.string().nullable(),
  job_title: z.string().nullable(),
  employee_id: z.string().uuid().nullable(),
});
const employeeSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  employee_no: z.string().nullable().optional(),
  job_title: z.string().nullable(),
});
const distributionSchema = z.object({
  id: z.string().uuid(),
  employee_id: z.string().uuid(),
  amount: z.coerce.number().nonnegative(),
  note: z.string().nullable(),
  employee: z.object({ full_name: z.string() }).nullable(),
});

async function loadPools(month: string) {
  if (!supabase) return [];
  const { data, error } = await supabase.from('reward_pools').select(APP_SCHEMA_SELECT.rewardPools).eq('month', `${month}-01`);
  if (error) throw error;
  return z.array(poolSchema).parse(data);
}

async function loadEngineers() {
  if (!supabase) return [];
  const { data, error } = await supabase.from('profiles').select(APP_SCHEMA_SELECT.areaEngineers).eq('role', 'area_engineer').order('full_name');
  if (error) throw error;
  return z.array(engineerSchema).parse(data);
}

async function loadEngineerEmployees() {
  if (!supabase) return [];
  const { data, error } = await supabase.from('employees').select(APP_SCHEMA_SELECT.engineerEmployees).eq('category', 'engineer').order('full_name');
  if (error) throw error;
  return z.array(employeeSchema).parse(data);
}

async function loadEmployees() {
  if (!supabase) return [];
  const { data, error } = await supabase.from('employees').select(APP_SCHEMA_SELECT.employeesForRewards).in('category', ['cleaner', 'technician', 'supervisor']).order('full_name');
  if (error) throw error;
  return z.array(employeeSchema).parse(data);
}

async function loadDistributions(poolId: string) {
  if (!supabase) return [];
  const { data, error } = await supabase.from('reward_allocations')
    .select(APP_SCHEMA_SELECT.rewardAllocations)
    .eq('pool_id', poolId)
    .order('updated_at');
  if (error) throw error;
  return z.array(distributionSchema).parse(data);
}

function localMonth(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function RewardsPage({ profile }: { profile: UserProfile | null }) {
  const client = useQueryClient();
  const [month, setMonth] = useState(localMonth());
  const [engineerId, setEngineerId] = useState('');
  const [amount, setAmount] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [note, setNote] = useState('');
  const [poolAmount, setPoolAmount] = useState('');
  const [message, setMessage] = useState('');
  const [linkEmployeeIds, setLinkEmployeeIds] = useState<Record<string, string>>({});
  const privileged = profile?.role === 'admin' || profile?.role === 'project_manager';
  const pools = useQuery({ queryKey: ['reward-pools', month], queryFn: () => loadPools(month), enabled: Boolean(profile) });
  const engineers = useQuery({ queryKey: ['area-engineers'], queryFn: loadEngineers, enabled: Boolean(profile && privileged) });
  const engineerEmployees = useQuery({ queryKey: ['engineer-employees'], queryFn: loadEngineerEmployees, enabled: Boolean(profile && privileged) });
  const employees = useQuery({ queryKey: ['reward-employees'], queryFn: loadEmployees, enabled: Boolean(profile) });

  useEffect(() => {
    if (profile?.role === 'area_engineer') setEngineerId(profile.employee_id ?? '');
    else if (privileged && engineers.data?.length && !engineerId) {
      const firstLinked = engineers.data.find((engineer) => engineer.employee_id);
      if (firstLinked?.employee_id) setEngineerId(firstLinked.employee_id);
    }
  }, [profile, privileged, engineers.data, engineerId]);

  const pool = pools.data?.find((item) => item.engineer_id === engineerId);
  const distributionsQuery = useQuery({
    queryKey: ['reward-distributions', pool?.id],
    queryFn: () => loadDistributions(pool!.id),
    enabled: Boolean(pool?.id),
  });
  const distributions = useMemo(() => distributionsQuery.data ?? [], [distributionsQuery.data]);
  const balance = useMemo(() => pool
    ? calculateRewardBalance(pool.amount, distributions.map((item) => item.amount))
    : null, [pool, distributions]);
  const remainingForDraft = balance && amount.trim() && Number.isFinite(Number(amount))
    ? balance.remainingAmount - Number(amount) + (distributions.find((item) => item.employee_id === employeeId)?.amount ?? 0)
    : balance?.remainingAmount;
  const canEditPool = Boolean(privileged && profile);
  const canDistribute = profile?.role === 'area_engineer' && Boolean(pool && pool.status === 'open');
  const rewardEmployeesById = useMemo(() => new Map((employees.data ?? []).map((employee) => [employee.id, employee])), [employees.data]);

  async function exportRewardAllocations() {
    if (!privileged) return;
    if (!distributions.length) {
      setMessage('لا توجد توزيعات مكافآت جاهزة للتصدير.');
      return;
    }
    const XLSX = await loadXlsx();
    const records = distributions.map((distribution) => {
      const employee = rewardEmployeesById.get(distribution.employee_id);
      return {
        'اسم الموظف': distribution.employee?.full_name ?? employee?.full_name ?? '',
        'الرقم الوظيفي': employee?.employee_no ?? '',
        المهنة: employee?.job_title ?? '',
        المشروع: 'SAFARY-RIYADH',
        'قيمة المكافأة': distribution.amount,
      };
    });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(records), 'مكافآت الموظفين');
    XLSX.writeFile(workbook, `مكافآت-${month}.xlsx`);
    setMessage('تم تصدير قائمة المكافآت بصيغة Excel.');
  }

  const savePool = useMutation({
    mutationFn: async () => {
      if (!supabase || !profile || !canEditPool) throw new Error('لا تملك صلاحية تحديد المخصصات.');
      const parsed = z.number().finite().min(0).safeParse(Number(poolAmount));
      if (!poolAmount.trim() || !parsed.success || !engineerId || !month) throw new Error('أدخل الشهر والمهندس ومبلغاً صحيحاً.');
      const existing = pools.data?.find((item) => item.engineer_id === engineerId);
      if (existing) {
        const { error } = await supabase.from('reward_pools').update({ amount: parsed.data }).eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('reward_pools').insert({
          month: `${month}-01`,
          engineer_id: engineerId,
          amount: parsed.data,
        });
        if (error) throw error;
      }
    },
    onSuccess: async () => {
      setMessage('تم حفظ مخصص الشهر.');
      await client.invalidateQueries({ queryKey: ['reward-pools', month] });
    },
    onError: (error: Error) => setMessage(`تعذر حفظ المخصص: ${error.message}`),
  });

  const approvePool = useMutation({
    mutationFn: async () => {
      if (!supabase || !profile || !canEditPool || !pool) throw new Error('لا توجد صلاحية اعتماد هذا المخصص.');
      const { error } = await supabase.from('reward_pools').update({ status: 'approved', approved_by: profile.id }).eq('id', pool.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      setMessage('تم اعتماد المخصص وإقفال الشهر.');
      await client.invalidateQueries({ queryKey: ['reward-pools', month] });
    },
    onError: (error: Error) => setMessage(`تعذر اعتماد الشهر: ${error.message}`),
  });

  const saveDistribution = useMutation({
    mutationFn: async () => {
      if (!supabase || !profile || !pool || !canDistribute) throw new Error('لا تملك صلاحية التوزيع لهذا الشهر.');
      const parsedAmount = z.number().finite().min(0).safeParse(Number(amount));
      if (!parsedAmount.success || !employeeId) throw new Error('اختر موظفاً وأدخل مبلغاً صحيحاً.');
      if (parsedAmount.data === 0 && !note.trim()) throw new Error('أدخل ملاحظة عند تسجيل مبلغ صفر.');
      const balanceWithoutCurrent = calculateRewardBalance(
        pool.amount,
        distributions.filter((item) => item.employee_id !== employeeId).map((item) => item.amount),
      );
      if (!canAllocateReward(balanceWithoutCurrent, parsedAmount.data)) throw new Error('المبلغ يتجاوز الرصيد المتبقي.');
      const { error } = await supabase.from('reward_allocations').upsert({
        pool_id: pool.id,
        employee_id: employeeId,
        amount: parsedAmount.data,
        note: note.trim() || null,
      }, { onConflict: 'pool_id,employee_id' });
      if (error) throw error;
    },
    onSuccess: async () => {
      setAmount('');
      setEmployeeId('');
      setNote('');
      setMessage('تم حفظ التوزيع.');
      await client.invalidateQueries({ queryKey: ['reward-distributions', pool?.id] });
    },
    onError: (error: Error) => setMessage(`تعذر حفظ التوزيع: ${error.message}`),
  });

  const linkEngineer = useMutation({
    mutationFn: async ({ profileId, employeeId }: { profileId: string; employeeId?: string }) => {
      if (!supabase || !privileged) throw new Error('لا تملك صلاحية ربط المهندسين.');
      const { error } = await supabase.rpc('link_area_engineer_profile', {
        p_profile_id: profileId,
        p_employee_id: employeeId || null,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setMessage('تم ربط المهندس بسجل الموظف.');
      await Promise.all([
        client.invalidateQueries({ queryKey: ['area-engineers'] }),
        client.invalidateQueries({ queryKey: ['engineer-employees'] }),
      ]);
    },
    onError: (error: Error) => setMessage(`تعذر ربط المهندس: ${error.message}`),
  });

  useEffect(() => {
    if (pool) setPoolAmount(String(pool.amount));
    else setPoolAmount('');
  }, [pool]);

  const engineerNames = new Map((engineers.data ?? [])
    .filter((item): item is typeof item & { employee_id: string } => Boolean(item.employee_id))
    .map((item) => [item.employee_id, item.display_name]));
  const unlinkedEngineers = (engineers.data ?? []).filter((engineer) => !engineer.employee_id);
  return (
    <div className="grid gap-5">
      <section><p className="text-sm text-slate-500">مخصص شهري وتوزيع موثق</p><h2 className="mt-1 text-2xl font-bold text-brand-900">مكافأة الفنيين</h2></section>
      {(pools.error || engineers.error || engineerEmployees.error || employees.error || distributionsQuery.error) && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          تعذر تحميل بيانات المكافآت.
          <span className="mt-1 block text-xs">{(pools.error || engineers.error || engineerEmployees.error || employees.error || distributionsQuery.error)?.message}</span>
        </div>
      )}
      <section className="card grid gap-4 p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-semibold">الشهر<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2" /></label>
          {privileged && <label className="grid gap-1 text-sm font-semibold">مهندس المنطقة<select value={engineerId} onChange={(event) => setEngineerId(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2"><option value="">اختر المهندس</option>{(engineers.data ?? []).map((item) => <option key={item.profile_id} value={item.employee_id ?? ''} disabled={!item.employee_id}>{item.display_name ?? item.profile_id}{item.employee_id ? '' : ' — غير مربوط بسجل موظف'}</option>)}</select></label>}
        </div>
        {privileged && unlinkedEngineers.length > 0 && <div className="grid gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
          <p className="font-bold text-amber-900">مهندسون غير مربوطين بسجل موظف</p>
          {unlinkedEngineers.map((engineer) => <div key={engineer.profile_id} className="flex flex-wrap items-center gap-2">
            <span className="min-w-48 text-amber-900">{engineer.display_name ?? engineer.profile_id} — غير مربوط بسجل موظف</span>
            <select
              value={linkEmployeeIds[engineer.profile_id] ?? ''}
              onChange={(event) => setLinkEmployeeIds((current) => ({ ...current, [engineer.profile_id]: event.target.value }))}
              className="rounded-lg border border-amber-300 bg-white px-3 py-2"
            >
              <option value="">إنشاء سجل من الملف</option>
              {engineerEmployees.data?.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name} · {employee.job_title ?? '—'}</option>)}
            </select>
            <button type="button" onClick={() => linkEngineer.mutate({ profileId: engineer.profile_id, employeeId: linkEmployeeIds[engineer.profile_id] })} disabled={linkEngineer.isPending} className="rounded-lg bg-brand-700 px-3 py-2 font-bold text-white disabled:opacity-50">ربط الآن</button>
          </div>)}
        </div>}
        {canEditPool && <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-sm font-semibold">المبلغ الإجمالي المتاح<input inputMode="decimal" type="number" min="0" step="0.01" value={poolAmount} onChange={(event) => setPoolAmount(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2" /></label>
          <button type="button" onClick={() => savePool.mutate()} disabled={savePool.isPending || !engineerId || pool?.status === 'approved'} className="rounded-lg border border-brand-700 px-4 py-2 text-sm font-bold text-brand-800 disabled:opacity-50">حفظ المخصص</button>
          {pool && pool.status === 'open' && <button type="button" onClick={() => approvePool.mutate()} disabled={approvePool.isPending} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">اعتماد وإقفال الشهر</button>}
        </div>}
        {pool && <div className="grid gap-3 sm:grid-cols-3">
          <Metric label="المبلغ المتاح" amount={pool.amount} />
          <Metric label="إجمالي الموزع" amount={balance?.allocatedAmount ?? 0} />
          <Metric label="الرصيد المتبقي" amount={balance?.remainingAmount ?? 0} />
        </div>}
        {pool?.status === 'approved' && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">تم اعتماد المخصص وإقفال هذا الشهر.</p>}
        {privileged && pool && <button type="button" onClick={() => void exportRewardAllocations()} disabled={distributionsQuery.isLoading || !distributions.length} className="inline-flex w-fit items-center gap-2 rounded-lg border border-brand-700 px-4 py-2 text-sm font-bold text-brand-800 disabled:opacity-50"><Download size={16} /> تصدير قائمة المكافآت Excel</button>}
        {!pool && <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">{privileged ? 'لم يُحدد مخصص لهذا المهندس والشهر.' : 'لم يُحدد مخصص متاح لحسابك لهذا الشهر.'}</p>}
      </section>

      {canDistribute && pool && <section className="card grid gap-4 p-5">
        <h3 className="font-bold">توزيع المكافآت</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="grid gap-1 text-sm font-semibold">الموظف<select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2"><option value="">اختر الموظف</option>{(employees.data ?? []).map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name} · {employee.job_title}</option>)}</select></label>
          <label className="grid gap-1 text-sm font-semibold">المبلغ<input type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2" /></label>
          <label className="grid gap-1 text-sm font-semibold sm:col-span-2">ملاحظة (مطلوبة إذا كان المبلغ صفراً)<input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} className="rounded-lg border border-slate-300 px-3 py-2" /></label>
        </div>
        <p className={`text-sm ${remainingForDraft !== undefined && remainingForDraft < 0 ? 'text-rose-700' : 'text-slate-600'}`}>الرصيد بعد هذا التوزيع: {remainingForDraft === undefined ? '—' : remainingForDraft.toFixed(2)}</p>
        <button type="button" onClick={() => saveDistribution.mutate()} disabled={saveDistribution.isPending || !employeeId || !amount || (remainingForDraft !== undefined && remainingForDraft < 0)} className="w-fit rounded-lg bg-brand-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">حفظ التوزيع</button>
      </section>}

      {pool && <section className="card grid gap-4 p-5">
        <h3 className="font-bold">سجل التوزيع</h3>
        {distributionsQuery.isLoading ? <p role="status">جارٍ تحميل السجل…</p> : distributions.length === 0 ? <p className="text-sm text-slate-500">لا توجد توزيعات بعد.</p> : <div className="table-scroll"><table>
          <thead><tr><th>الموظف</th><th>المبلغ</th><th>الملاحظة</th></tr></thead>
          <tbody>{distributions.map((item) => <tr key={item.id}><td>{item.employee?.full_name ?? item.employee_id}</td><td>{item.amount.toFixed(2)}</td><td>{item.note ?? '—'}</td></tr>)}</tbody>
        </table></div>}
      </section>}
      {message && <p role="status" className="text-sm text-slate-700">{message}</p>}
      {privileged && engineerId && <p className="text-xs text-slate-500">المهندس المحدد: {engineerNames.get(engineerId) ?? '—'}</p>}
    </div>
  );
}

function Metric({ label, amount }: { label: string; amount: number }) {
  return <article className="rounded-xl bg-brand-50 p-4"><p className="text-xs text-slate-600">{label}</p><p className="mt-1 text-xl font-bold text-brand-900">{amount.toFixed(2)}</p></article>;
}

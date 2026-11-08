import { useEffect, useState } from 'react';
import { normalizeImportName } from '../../domain/imports';
import { supabase } from '../../lib/supabase';
import type { UserProfile } from '../../lib/auth';

type Person = { id: string; full_name: string };
type Unlinked = { name: string; employee: Person | null };

export function PlanNameLinkingPage({ profile }: { profile: UserProfile | null }) {
  const [items, setItems] = useState<Unlinked[]>([]);
  const [employees, setEmployees] = useState<Person[]>([]);
  const [message, setMessage] = useState('');
  const canManage = Boolean(profile && ['admin', 'project_manager'].includes(profile.role));
  async function load() {
    if (!supabase || !canManage) return;
    const [monthly, general, staff] = await Promise.all([
      supabase.from('monthly_plan_rows').select('supervisor_id,supervisor_name').is('supervisor_id', null).not('supervisor_name', 'is', null),
      supabase.from('general_plan_rows').select('supervisor_name').not('supervisor_name', 'is', null),
      supabase.from('employees').select('id,full_name').order('full_name'),
    ]);
    if (monthly.error || general.error || staff.error) throw monthly.error ?? general.error ?? staff.error;
    const names = [...(monthly.data ?? []), ...(general.data ?? [])]
      .map((row) => String(row.supervisor_name ?? '').trim())
      .filter(Boolean);
    const unique = [...new Set(names.map(normalizeImportName))];
    setEmployees(staff.data ?? []);
    setItems(unique.map((key) => {
      const name = names.find((candidate) => normalizeImportName(candidate) === key) ?? key;
      return { name, employee: (staff.data ?? []).find((candidate) => normalizeImportName(candidate.full_name) === key) ?? null };
    }));
  }
  useEffect(() => { void load().catch((error: Error) => setMessage(error.message)); }, [canManage]);
  async function link(item: Unlinked, employeeId: string) {
    if (!supabase || !canManage) return;
    const { error } = await supabase.from('supervisor_aliases').upsert({ alias_normalised: normalizeImportName(item.name), employee_id: employeeId });
    if (error) { setMessage(error.message); return; }
    await supabase.rpc('relink_plan_names');
    setMessage('تم ربط الاسم وإعادة ربط صفوف الخطط.');
    await load();
  }
  if (!canManage) return <section className="card p-6">هذه الشاشة متاحة لمدير النظام ومدير المشروع.</section>;
  return <section className="card grid gap-4 p-5"><div><h2 className="text-xl font-bold">ربط الأسماء بالموظفين</h2><p className="text-sm text-slate-500">الأسماء غير المرتبطة لا تمنع الاستيراد.</p></div>
    <button type="button" className="justify-self-start rounded-lg border px-3 py-2 text-sm" onClick={async () => { for (const item of items.filter((candidate) => candidate.employee)) await link(item, item.employee!.id); }}>ربط كل التطابقات الدقيقة</button>
    {items.length === 0 ? <p className="text-sm text-slate-500">لا توجد أسماء غير مرتبطة.</p> : <div className="table-scroll"><table><thead><tr><th>الاسم</th><th>اقتراح الموظف</th><th>إجراء</th></tr></thead><tbody>{items.map((item) => <tr key={item.name}><td>{item.name}</td><td>{item.employee?.full_name ?? 'لا يوجد اقتراح'}</td><td><select defaultValue={item.employee?.id ?? ''} onChange={(event) => { if (event.target.value) void link(item, event.target.value); }}><option value="">اختر موظفاً</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name}</option>)}</select></td></tr>)}</tbody></table></div>}
    {message && <p role="status" className="text-sm">{message}</p>}</section>;
}

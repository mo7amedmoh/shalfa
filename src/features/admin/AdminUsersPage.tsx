import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { z } from 'zod';
import { supabase } from '../../lib/supabase';
import { APP_SCHEMA_SELECT } from '../../lib/schemaColumns';

const userSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  role: z.enum(['admin', 'project_manager', 'area_engineer', 'report_follower', 'supervisor', 'viewer']),
  display_name: z.string().nullable(),
  phone: z.string().nullable(),
  employee_id: z.string().uuid().nullable(),
});
const usersSchema = z.array(userSchema);
const roleSchema = z.enum(['admin', 'project_manager', 'area_engineer', 'report_follower', 'supervisor', 'viewer']);
type AppUser = z.infer<typeof userSchema>;
const newUserSchema = z.object({
  email: z.string().trim().email(),
  displayName: z.string().trim().min(2).max(120),
  role: roleSchema,
  password: z.string().min(12).regex(/[a-z]/).regex(/[A-Z]/).regex(/\d/).regex(/[^A-Za-z0-9]/),
  confirmPassword: z.string(),
});

const roleLabels: Record<AppUser['role'], string> = {
  admin: 'مدير النظام',
  project_manager: 'مدير المشروع',
  area_engineer: 'مهندس منطقة',
  report_follower: 'متابع تقارير',
  supervisor: 'مشرف',
  viewer: 'مشاهد',
};

async function loadUsers(): Promise<AppUser[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('profiles')
    .select(APP_SCHEMA_SELECT.profile)
    .order('full_name');
  if (error) throw error;
  return usersSchema.parse(data);
}

export function AdminUsersPage() {
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [edits, setEdits] = useState<Record<string, { role: AppUser['role']; phone: string }>>({});
  const [newUser, setNewUser] = useState<{ email: string; displayName: string; role: AppUser['role']; password: string; confirmPassword: string }>({
    email: '', displayName: '', role: 'viewer', password: '', confirmPassword: '',
  });
  const [message, setMessage] = useState('');
  const users = useQuery({ queryKey: ['admin-users'], queryFn: loadUsers });
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return (users.data ?? []).filter((user) => `${user.username} ${user.display_name} ${roleLabels[user.role]}`.toLocaleLowerCase().includes(query));
  }, [users.data, search]);

  const save = useMutation({
    mutationFn: async ({ userId, role, phone }: { userId: string; role: AppUser['role']; phone: string }) => {
      if (!supabase) throw new Error('يلزم إعداد Supabase.');
      if (phone.trim().length > 30) throw new Error('يجب ألا يتجاوز رقم التواصل 30 خانة.');
      const { error } = await supabase.from('profiles').update({ role, phone: phone.trim() || null }).eq('id', userId);
      if (error) throw error;
    },
    onSuccess: async () => {
      setMessage('تم تحديث الدور وبيانات التواصل.');
      await client.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (error: Error) => setMessage(`تعذر تحديث المستخدم: ${error.message}`),
  });
  const create = useMutation({
    mutationFn: async () => {
      if (!supabase) throw new Error('يلزم إعداد Supabase.');
      const parsed = newUserSchema.safeParse(newUser);
      if (!parsed.success) throw new Error('تحقق من البريد الإلكتروني والاسم والدور وكلمة المرور.');
      if (parsed.data.password !== parsed.data.confirmPassword) throw new Error('كلمتا المرور غير متطابقتين.');
      const { data, error } = await supabase.functions.invoke('create-user', {
        body: {
          email: parsed.data.email,
          display_name: parsed.data.displayName,
          role: parsed.data.role,
          password: parsed.data.password,
        },
      });
      if (error instanceof FunctionsHttpError && error.context instanceof Response) {
        const body: unknown = await error.context.json();
        const errorResult = z.object({ error: z.string() }).safeParse(body);
        if (errorResult.success) throw new Error(errorResult.data.error);
      }
      if (error) throw error;
      const result = z.object({ username: z.string() }).safeParse(data);
      if (!result.success) throw new Error('لم تُرجع وظيفة إنشاء المستخدم نتيجة صالحة.');
      return result.data;
    },
    onSuccess: async (created) => {
      setNewUser({ email: '', displayName: '', role: 'viewer', password: '', confirmPassword: '' });
      setMessage(`تم إنشاء المستخدم ${created.username}.`);
      await client.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (error: Error) => setMessage(`تعذر إنشاء المستخدم: ${error.message}`),
  });

  return (
    <div className="grid gap-5">
      <section><p className="text-sm text-slate-500">إدارة أدوار الوصول وبيانات الاتصال للحسابات المسجلة</p><h2 className="mt-1 text-2xl font-bold text-brand-900">المستخدمون والصلاحيات</h2></section>
      <section className="card grid gap-4 p-5">
        <form className="grid gap-3 rounded-xl border border-slate-200 p-4 sm:grid-cols-2 lg:grid-cols-3" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
          <h3 className="font-bold sm:col-span-2 lg:col-span-3">إنشاء مستخدم</h3>
          <label className="grid gap-1 text-sm font-semibold"><span>البريد الإلكتروني <span title="اسم المستخدم ثابت بعد الإنشاء." aria-label="اسم المستخدم ثابت بعد الإنشاء." className="cursor-help text-slate-500">ⓘ</span></span><input type="email" autoComplete="email" value={newUser.email} onChange={(event) => setNewUser((current) => ({ ...current, email: event.target.value }))} className="rounded-lg border border-slate-300 px-3 py-2 font-normal" required /></label>
          <label className="grid gap-1 text-sm font-semibold">الاسم الظاهر<input value={newUser.displayName} onChange={(event) => setNewUser((current) => ({ ...current, displayName: event.target.value }))} className="rounded-lg border border-slate-300 px-3 py-2 font-normal" required /></label>
          <label className="grid gap-1 text-sm font-semibold">الدور<select value={newUser.role} onChange={(event) => { const role = roleSchema.safeParse(event.target.value); if (role.success) setNewUser((current) => ({ ...current, role: role.data })); }} className="rounded-lg border border-slate-300 px-3 py-2 font-normal">{Object.entries(roleLabels).map(([role, label]) => <option key={role} value={role}>{label}</option>)}</select></label>
          <label className="grid gap-1 text-sm font-semibold">كلمة مرور أولية<input type="password" autoComplete="new-password" value={newUser.password} onChange={(event) => setNewUser((current) => ({ ...current, password: event.target.value }))} className="rounded-lg border border-slate-300 px-3 py-2 font-normal" required /></label>
          <label className="grid gap-1 text-sm font-semibold">تأكيد كلمة المرور<input type="password" autoComplete="new-password" value={newUser.confirmPassword} onChange={(event) => setNewUser((current) => ({ ...current, confirmPassword: event.target.value }))} className="rounded-lg border border-slate-300 px-3 py-2 font-normal" required /></label>
          <button type="submit" disabled={create.isPending} className="self-end rounded-lg bg-brand-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{create.isPending ? 'جارٍ الإنشاء…' : 'إنشاء الحساب'}</button>
          <p className="text-xs leading-5 text-slate-500 sm:col-span-2 lg:col-span-3">يُستخدم البريد الإلكتروني الكامل لتسجيل الدخول. كلمة المرور الأولية: 12 خانة على الأقل، مع أحرف كبيرة وصغيرة ورقم ورمز؛ سلّمها للمستخدم بأمان.</p>
        </form>
        <label className="grid gap-1 text-sm font-semibold">بحث<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="اسم المستخدم أو الاسم أو الدور" className="rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label>
        {users.error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">تعذر تحميل المستخدمين: {users.error.message}</p>}
        {users.isLoading ? <p role="status">جارٍ تحميل المستخدمين…</p> : filtered.length === 0 ? <p className="rounded-lg bg-slate-50 p-5 text-center text-sm text-slate-500">لا يوجد مستخدمون مطابقون.</p> : (
          <div className="grid gap-3">
            {filtered.map((user) => {
              const edit = edits[user.id] ?? { role: user.role, phone: user.phone ?? '' };
              return <article key={user.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><h3 className="font-bold">{user.display_name}</h3><p className="mt-1 text-xs text-slate-500" dir="ltr">{user.username}</p></div>
                  <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-900">{roleLabels[user.role]}</span>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                  <label className="grid gap-1 text-xs font-semibold">الدور
                    <select value={edit.role} onChange={(event) => {
                      const role = roleSchema.safeParse(event.target.value);
                      if (role.success) setEdits((current) => ({ ...current, [user.id]: { ...edit, role: role.data } }));
                    }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal">
                      {Object.entries(roleLabels).map(([role, label]) => <option key={role} value={role}>{label}</option>)}
                    </select>
                  </label>
                  <label className="grid gap-1 text-xs font-semibold">رقم التواصل
                    <input type="tel" value={edit.phone} onChange={(event) => setEdits((current) => ({ ...current, [user.id]: { ...edit, phone: event.target.value } }))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" />
                  </label>
                  <button type="button" onClick={() => save.mutate({ userId: user.id, ...edit })} disabled={save.isPending} className="self-end rounded-lg border border-brand-700 px-4 py-2 text-sm font-semibold text-brand-800 disabled:opacity-50">حفظ</button>
                </div>
                <p className="mt-2 text-xs text-slate-400">معرّف الموظف المرتبط: {user.employee_id ? 'مرتبط' : 'غير مرتبط'}</p>
              </article>;
            })}
          </div>
        )}
        {message && <p role="status" className="text-sm text-slate-700">{message}</p>}
      </section>
    </div>
  );
}

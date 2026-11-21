import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { z } from 'zod';
import { supabase } from '../../lib/supabase';
import { APP_SCHEMA_SELECT } from '../../lib/schemaColumns';
import { usePermission } from '../../app/permissionContext';

const userSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  role: z.enum(['admin', 'project_manager', 'area_engineer', 'report_follower', 'supervisor', 'viewer']),
  role_id: z.number().int(),
  display_name: z.string().nullable(),
  phone: z.string().nullable(),
  employee_id: z.string().uuid().nullable(),
});
const usersSchema = z.array(userSchema);
const roleSchema = z.enum(['admin', 'project_manager', 'area_engineer', 'report_follower', 'supervisor', 'viewer']);
const assignedRoleSchema = z.object({ id: z.number().int(), name_ar: z.string(), base_role: roleSchema });
const permissionRowSchema = z.object({ key: z.string(), group_key: z.string(), label_ar: z.string(), description: z.string().nullable() });
const overrideRowSchema = z.object({ permission_key: z.string(), granted: z.boolean() });
type AppUser = z.infer<typeof userSchema>;
type AssignedRole = z.infer<typeof assignedRoleSchema>;
const newUserSchema = z.object({
  email: z.string().trim().email(),
  displayName: z.string().trim().min(2).max(120),
  roleId: z.number().int().positive(),
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
    .select(APP_SCHEMA_SELECT.profileWithRoleId)
    .order('full_name');
  if (error) throw error;
  return usersSchema.parse(data);
}

async function loadRoles(): Promise<AssignedRole[]> {
  if (!supabase) throw new Error('يلزم إعداد Supabase.');
  const { data, error } = await supabase.from('roles').select('id,name_ar,base_role').order('id');
  if (error) throw error;
  return z.array(assignedRoleSchema).parse(data);
}

async function loadPermissionEditor(userId: string) {
  if (!supabase) throw new Error('يلزم إعداد Supabase.');
  const [permissionsResult, rolePermissionsResult, overridesResult] = await Promise.all([
    supabase.from('permissions').select('key,group_key,label_ar,description').order('key'),
    supabase.from('role_permissions').select('role_id,permission_key'),
    supabase.from('user_permission_overrides').select('permission_key,granted').eq('user_id', userId),
  ]);
  for (const result of [permissionsResult, rolePermissionsResult, overridesResult]) {
    if (result.error) throw result.error;
  }
  return {
    permissions: z.array(permissionRowSchema).parse(permissionsResult.data),
    rolePermissions: z.array(z.object({ role_id: z.number().int(), permission_key: z.string() })).parse(rolePermissionsResult.data),
    overrides: z.array(overrideRowSchema).parse(overridesResult.data),
  };
}

function getRoleName(user: AppUser, roles: AssignedRole[] | undefined) {
  return roles?.find((role) => role.id === user.role_id)?.name_ar ?? roleLabels[user.role];
}

export function AdminUsersPage() {
  const client = useQueryClient();
  const canManageUsers = usePermission('users.manage');
  const canCreateUsers = usePermission('users.create');
  const canAssignRoles = usePermission('users.assign_roles');
  const [search, setSearch] = useState('');
  const [edits, setEdits] = useState<Record<string, { role_id: number; phone: string }>>({});
  const [newUser, setNewUser] = useState<{ email: string; displayName: string; roleId: number; password: string; confirmPassword: string }>({
    email: '', displayName: '', roleId: 0, password: '', confirmPassword: '',
  });
  const [activeUserId, setActiveUserId] = useState<string | null>(null);
  const [overrideDrafts, setOverrideDrafts] = useState<Record<string, Record<string, 'default' | 'allow' | 'deny'>>>({});
  const [message, setMessage] = useState('');
  const users = useQuery({ queryKey: ['admin-users'], queryFn: loadUsers });
  const roles = useQuery({ queryKey: ['admin-assignable-roles'], queryFn: loadRoles });
  const permissionEditor = useQuery({
    queryKey: ['admin-user-permissions', activeUserId],
    queryFn: () => loadPermissionEditor(activeUserId!),
    enabled: activeUserId !== null,
  });
  useEffect(() => {
    if (newUser.roleId === 0 && roles.data?.length) {
      const viewer = roles.data.find((role) => role.base_role === 'viewer');
      setNewUser((current) => ({ ...current, roleId: viewer?.id ?? roles.data![0].id }));
    }
  }, [roles.data, newUser.roleId]);
  useEffect(() => {
    if (!activeUserId || !permissionEditor.data) return;
    setOverrideDrafts((current) => {
      if (current[activeUserId]) return current;
      const draft: Record<string, 'default' | 'allow' | 'deny'> = {};
      for (const override of permissionEditor.data!.overrides) {
        draft[override.permission_key] = override.granted ? 'allow' : 'deny';
      }
      return { ...current, [activeUserId]: draft };
    });
  }, [activeUserId, permissionEditor.data]);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return (users.data ?? []).filter((user) => `${user.username} ${user.display_name} ${getRoleName(user, roles.data)}`.toLocaleLowerCase().includes(query));
  }, [users.data, roles.data, search]);

  const save = useMutation({
    mutationFn: async ({ userId, role_id, phone }: { userId: string; role_id: number; phone: string }) => {
      if (!supabase) throw new Error('يلزم إعداد Supabase.');
      if (!canManageUsers) throw new Error('لا تملك صلاحية إدارة المستخدمين.');
      if (!canAssignRoles && users.data?.find((user) => user.id === userId)?.role_id !== role_id) {
        throw new Error('لا تملك صلاحية إسناد الأدوار.');
      }
      if (phone.trim().length > 30) throw new Error('يجب ألا يتجاوز رقم التواصل 30 خانة.');
      const overrides = overrideDrafts[userId] ?? {};
      const { error } = await supabase.rpc('assign_user_role', {
        p_user_id: userId,
        p_role_id: role_id,
        p_phone: phone.trim() || null,
        p_overrides: overrides,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setMessage('تم تحديث الدور وبيانات التواصل.');
      await Promise.all([
        client.invalidateQueries({ queryKey: ['admin-users'] }),
        client.invalidateQueries({ queryKey: ['admin-role-permissions'] }),
      ]);
    },
    onError: (error: Error) => setMessage(`تعذر تحديث المستخدم: ${error.message}`),
  });
  const create = useMutation({
    mutationFn: async () => {
      if (!supabase) throw new Error('يلزم إعداد Supabase.');
      if (!canManageUsers) throw new Error('لا تملك صلاحية إدارة المستخدمين.');
      if (!canCreateUsers) throw new Error('لا تملك صلاحية إنشاء المستخدمين.');
      const parsed = newUserSchema.safeParse(newUser);
      if (!parsed.success) throw new Error('تحقق من البريد الإلكتروني والاسم والدور وكلمة المرور.');
      if (parsed.data.password !== parsed.data.confirmPassword) throw new Error('كلمتا المرور غير متطابقتين.');
      const { data, error } = await supabase.functions.invoke('create-user', {
        body: {
          email: parsed.data.email,
          display_name: parsed.data.displayName,
          role_id: parsed.data.roleId,
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
      setNewUser((current) => ({ ...current, email: '', displayName: '', password: '', confirmPassword: '' }));
      setMessage(`تم إنشاء المستخدم ${created.username}.`);
      await client.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (error: Error) => setMessage(`تعذر إنشاء المستخدم: ${error.message}`),
  });

  return (
    <div className="grid gap-5">
      <section><p className="text-sm text-slate-500">إدارة أدوار الوصول وبيانات الاتصال للحسابات المسجلة</p><h2 className="mt-1 text-2xl font-bold text-brand-900">المستخدمون والصلاحيات</h2></section>
      <section className="card grid gap-4 p-5">
        {canCreateUsers && <form className="grid gap-3 rounded-xl border border-slate-200 p-4 sm:grid-cols-2 lg:grid-cols-3" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
          <h3 className="font-bold sm:col-span-2 lg:col-span-3">إنشاء مستخدم</h3>
          <label className="grid gap-1 text-sm font-semibold"><span>البريد الإلكتروني <span title="اسم المستخدم ثابت بعد الإنشاء." aria-label="اسم المستخدم ثابت بعد الإنشاء." className="cursor-help text-slate-500">ⓘ</span></span><input type="email" autoComplete="email" value={newUser.email} onChange={(event) => setNewUser((current) => ({ ...current, email: event.target.value }))} className="rounded-lg border border-slate-300 px-3 py-2 font-normal" required /></label>
          <label className="grid gap-1 text-sm font-semibold">الاسم الظاهر<input value={newUser.displayName} onChange={(event) => setNewUser((current) => ({ ...current, displayName: event.target.value }))} className="rounded-lg border border-slate-300 px-3 py-2 font-normal" required /></label>
          <label className="grid gap-1 text-sm font-semibold">الدور<select value={newUser.roleId || ''} disabled={!canAssignRoles || roles.isLoading} onChange={(event) => setNewUser((current) => ({ ...current, roleId: Number(event.target.value) }))} className="rounded-lg border border-slate-300 px-3 py-2 font-normal disabled:bg-slate-50">{(roles.data ?? []).map((role) => <option key={role.id} value={role.id}>{role.name_ar}</option>)}</select></label>
          <label className="grid gap-1 text-sm font-semibold">كلمة مرور أولية<input type="password" autoComplete="new-password" value={newUser.password} onChange={(event) => setNewUser((current) => ({ ...current, password: event.target.value }))} className="rounded-lg border border-slate-300 px-3 py-2 font-normal" required /></label>
          <label className="grid gap-1 text-sm font-semibold">تأكيد كلمة المرور<input type="password" autoComplete="new-password" value={newUser.confirmPassword} onChange={(event) => setNewUser((current) => ({ ...current, confirmPassword: event.target.value }))} className="rounded-lg border border-slate-300 px-3 py-2 font-normal" required /></label>
          <button type="submit" disabled={create.isPending} className="self-end rounded-lg bg-brand-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{create.isPending ? 'جارٍ الإنشاء…' : 'إنشاء الحساب'}</button>
          <p className="text-xs leading-5 text-slate-500 sm:col-span-2 lg:col-span-3">يُستخدم البريد الإلكتروني الكامل لتسجيل الدخول. كلمة المرور الأولية: 12 خانة على الأقل، مع أحرف كبيرة وصغيرة ورقم ورمز؛ سلّمها للمستخدم بأمان.</p>
        </form>}
        <label className="grid gap-1 text-sm font-semibold">بحث<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="اسم المستخدم أو الاسم أو الدور" className="rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label>
        {users.error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">تعذر تحميل المستخدمين: {users.error.message}</p>}
        {roles.error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">تعذر تحميل الأدوار: {roles.error.message}</p>}
        {users.isLoading ? <p role="status">جارٍ تحميل المستخدمين…</p> : filtered.length === 0 ? <p className="rounded-lg bg-slate-50 p-5 text-center text-sm text-slate-500">لا يوجد مستخدمون مطابقون.</p> : (
          <div className="grid gap-3">
            {filtered.map((user) => {
              const edit = edits[user.id] ?? { role_id: user.role_id, phone: user.phone ?? '' };
              return <article key={user.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><h3 className="font-bold">{user.display_name}</h3><p className="mt-1 text-xs text-slate-500" dir="ltr">{user.username}</p></div>
                  <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-900">{getRoleName(user, roles.data)}</span>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                  <label className="grid gap-1 text-xs font-semibold">الدور
                    <select value={edit.role_id} disabled={!canAssignRoles || roles.isLoading} onChange={(event) => {
                      const roleId = z.coerce.number().int().positive().safeParse(event.target.value);
                      if (roleId.success) setEdits((current) => ({ ...current, [user.id]: { ...edit, role_id: roleId.data } }));
                    }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal disabled:bg-slate-50">
                      {(roles.data ?? []).map((role) => <option key={role.id} value={role.id}>{role.name_ar}</option>)}
                    </select>
                  </label>
                  <label className="grid gap-1 text-xs font-semibold">رقم التواصل
                    <input type="tel" value={edit.phone} onChange={(event) => setEdits((current) => ({ ...current, [user.id]: { ...edit, phone: event.target.value } }))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" />
                  </label>
                  <button type="button" onClick={() => save.mutate({ userId: user.id, ...edit })} disabled={save.isPending || roles.isLoading} className="self-end rounded-lg border border-brand-700 px-4 py-2 text-sm font-semibold text-brand-800 disabled:opacity-50">حفظ</button>
                </div>
                <p className="mt-2 text-xs text-slate-400">معرّف الموظف المرتبط: {user.employee_id ? 'مرتبط' : 'غير مرتبط'}</p>
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setActiveUserId((current) => current === user.id ? null : null)} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-600">بيانات المستخدم</button>
                    <button type="button" onClick={() => setActiveUserId(user.id)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${activeUserId === user.id ? 'bg-brand-50 text-brand-900' : 'text-slate-600'}`}>صلاحيات خاصة</button>
                  </div>
                  {activeUserId === user.id && (
                    <div className="mt-3">
                      {permissionEditor.isLoading ? <p role="status" className="text-xs text-slate-500">جارٍ تحميل الصلاحيات…</p> : permissionEditor.error ? <p role="alert" className="text-xs text-rose-700">تعذر تحميل الصلاحيات.</p> : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-right text-xs">
                            <thead><tr className="border-b text-slate-500"><th className="p-2">الصلاحية</th><th className="p-2">الحالة</th><th className="p-2">النتيجة الفعلية</th></tr></thead>
                            <tbody>
                              {(permissionEditor.data?.permissions ?? []).map((permission) => {
                                const states = overrideDrafts[user.id] ?? {};
                                const state = states[permission.key] ?? 'default';
                                const roleDefault = permissionEditor.data?.rolePermissions.some((item) => item.role_id === edit.role_id && item.permission_key === permission.key) ?? false;
                                const effective = state === 'allow' ? true : state === 'deny' ? false : roleDefault;
                                return (
                                  <tr key={permission.key} className="border-b border-slate-100">
                                    <td className="p-2"><span className="font-semibold">{permission.label_ar}</span><span className="mr-1 text-slate-400" dir="ltr">{permission.key}</span></td>
                                    <td className="p-2">
                                      <select
                                        value={state}
                                        disabled={!canAssignRoles}
                                        onChange={(event) => {
                                          const next = z.enum(['default', 'allow', 'deny']).parse(event.target.value);
                                          setOverrideDrafts((current) => ({ ...current, [user.id]: { ...(current[user.id] ?? {}), [permission.key]: next } }));
                                        }}
                                        className="rounded border border-slate-300 px-2 py-1"
                                      >
                                        <option value="default">افتراضي من الدور</option>
                                        <option value="allow">مسموح</option>
                                        <option value="deny">ممنوع</option>
                                      </select>
                                    </td>
                                    <td className={`p-2 font-bold ${effective ? 'text-emerald-700' : 'text-rose-700'}`}>{effective ? 'مسموح' : 'ممنوع'}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </article>;
            })}
          </div>
        )}
        {message && <p role="status" className="text-sm text-slate-700">{message}</p>}
      </section>
    </div>
  );
}

import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, ShieldAlert, ShieldCheck, Trash2, Undo2 } from 'lucide-react';
import { z } from 'zod';
import { permissionGroups } from '../../domain/permissions';
import { supabase } from '../../lib/supabase';

const baseRoleSchema = z.enum(['admin', 'project_manager', 'area_engineer', 'report_follower', 'supervisor', 'viewer']);
const roleRowSchema = z.object({
  id: z.number().int(),
  key: z.string(),
  name_ar: z.string(),
  description: z.string().nullable(),
  is_system: z.boolean(),
  base_role: baseRoleSchema,
});
const permissionSchema = z.object({
  key: z.string(),
  group_key: z.string(),
  label_ar: z.string(),
  description: z.string().nullable(),
  enforced_in_db: z.boolean(),
});
const rolePermissionSchema = z.object({ role_id: z.number().int(), permission_key: z.string() });
type BaseRole = z.infer<typeof baseRoleSchema>;
type Role = z.infer<typeof roleRowSchema> & { userCount: number; permissionKeys: string[] };
type Permission = z.infer<typeof permissionSchema>;
type RoleCatalog = { roles: Role[]; permissions: Permission[] };
type DraftRole = {
  id: number | null;
  clientId: string;
  key: string;
  name: string;
  description: string;
  isSystem: boolean;
  baseRole: BaseRole;
  userCount: number;
  permissionKeys: string[];
  isNew: boolean;
};

const baseRoleInfo: Record<Exclude<BaseRole, 'admin'>, { label: string; description: string }> = {
  project_manager: { label: 'مدير المشروع', description: 'مرجع الدور للمستخدمين والعمليات الإدارية.' },
  area_engineer: { label: 'مهندس منطقة', description: 'مرجع دور ميداني لإدارة ومتابعة أعمال المنطقة.' },
  report_follower: { label: 'متابع التقارير', description: 'مرجع دور يركز على متابعة الزيارات والتقارير.' },
  supervisor: { label: 'مشرف', description: 'مرجع دور إشرافي بصلاحيات محدودة.' },
  viewer: { label: 'مستعرض', description: 'الافتراضي: صلاحيات قراءة عامة محدودة.' },
};
const baseRoleOptions = Object.entries(baseRoleInfo) as [Exclude<BaseRole, 'admin'>, (typeof baseRoleInfo)[Exclude<BaseRole, 'admin'>]][];

async function loadRoles(): Promise<RoleCatalog> {
  if (!supabase) throw new Error('يلزم إعداد Supabase.');
  const [rolesResult, permissionsResult, rolePermissionsResult] = await Promise.all([
    supabase.from('roles').select('id,key,name_ar,description,is_system,base_role').order('id'),
    supabase.from('permissions').select('key,group_key,label_ar,description,enforced_in_db').order('group_key').order('key'),
    supabase.from('role_permissions').select('role_id,permission_key'),
  ]);
  for (const result of [rolesResult, permissionsResult, rolePermissionsResult]) {
    if (result.error) throw result.error;
  }
  const roles = z.array(roleRowSchema).parse(rolesResult.data);
  const permissions = z.array(permissionSchema).parse(permissionsResult.data);
  const rolePermissions = z.array(rolePermissionSchema).parse(rolePermissionsResult.data);
  const counts = await Promise.all(roles.map(async (role) => {
    const result = await supabase!.from('profiles').select('role_id', { count: 'exact', head: true }).eq('role_id', role.id);
    if (result.error) throw result.error;
    return [role.id, result.count ?? 0] as const;
  }));
  const countByRole = new Map(counts);
  const permissionsByRole = new Map<number, string[]>();
  for (const item of rolePermissions) {
    permissionsByRole.set(item.role_id, [...(permissionsByRole.get(item.role_id) ?? []), item.permission_key]);
  }
  return {
    roles: roles.map((role) => ({
      ...role,
      userCount: countByRole.get(role.id) ?? 0,
      permissionKeys: permissionsByRole.get(role.id) ?? [],
    })),
    permissions,
  };
}

function draftFromRole(role: Role): DraftRole {
  return {
    id: role.id,
    clientId: String(role.id),
    key: role.key,
    name: role.name_ar,
    description: role.description ?? '',
    isSystem: role.is_system,
    baseRole: role.base_role,
    userCount: role.userCount,
    permissionKeys: role.permissionKeys,
    isNew: false,
  };
}

function hasArabic(value: string) {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(value);
}

function summarizeChanges(original: Role[], drafts: DraftRole[], deletedIds: number[]) {
  const changed: { role: DraftRole; added: number; removed: number; metadata: boolean }[] = [];
  for (const draft of drafts) {
    if (draft.id !== null && deletedIds.includes(draft.id)) continue;
    if (draft.isNew) {
      changed.push({ role: draft, added: draft.permissionKeys.length, removed: 0, metadata: true });
      continue;
    }
    const before = original.find((role) => role.id === draft.id);
    if (!before) continue;
    const added = draft.permissionKeys.filter((key) => !before.permissionKeys.includes(key)).length;
    const removed = before.permissionKeys.filter((key) => !draft.permissionKeys.includes(key)).length;
    const metadata = before.name_ar !== draft.name || (before.description ?? '') !== draft.description;
    if (added || removed || metadata) changed.push({ role: draft, added, removed, metadata });
  }
  return { changed, deletedIds };
}

export function RolePermissionsPage() {
  const queryClient = useQueryClient();
  const roleQuery = useQuery({ queryKey: ['admin-role-permissions'], queryFn: loadRoles });
  const [drafts, setDrafts] = useState<DraftRole[]>([]);
  const [deletedIds, setDeletedIds] = useState<number[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [baseRole, setBaseRole] = useState<Exclude<BaseRole, 'admin'>>('viewer');
  const [copyFrom, setCopyFrom] = useState('viewer');
  const [message, setMessage] = useState('');
  const [reviewing, setReviewing] = useState(false);

  useEffect(() => {
    if (!roleQuery.data) return;
    setDrafts(roleQuery.data.roles.map(draftFromRole));
    setDeletedIds([]);
    setReviewing(false);
  }, [roleQuery.data]);

  const originals = roleQuery.data?.roles ?? [];
  const summary = summarizeChanges(originals, drafts, deletedIds);
  const hasChanges = summary.changed.length > 0 || deletedIds.length > 0;
  const visibleDrafts = drafts.filter((role) => role.id === null || !deletedIds.includes(role.id));
  const createBaseInfo = baseRoleInfo[baseRole];

  const save = useMutation({
    mutationFn: async () => {
      if (!supabase) throw new Error('يلزم إعداد Supabase.');
      const { error } = await supabase.rpc('save_role_permissions', {
        p_changes: {
          roles: summary.changed.map(({ role }) => ({
            id: role.id,
            name_ar: role.name.trim(),
            description: role.description.trim() || null,
            base_role: role.isNew ? role.baseRole : undefined,
            permission_keys: role.permissionKeys,
          })),
          delete_ids: deletedIds,
        },
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setMessage('تم حفظ الأدوار والصلاحيات وتسجيل التغييرات في سجل التدقيق.');
      setReviewing(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-role-permissions'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
      ]);
    },
    onError: (error: Error) => setMessage(`تعذر الحفظ: ${error.message}`),
  });

  function addRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanName = name.trim();
    if (cleanName.length < 2 || cleanName.length > 80 || !hasArabic(cleanName)) {
      setMessage('أدخل اسم دور عربيًا من حرفين إلى 80 حرفًا.');
      return;
    }
    if (description.trim().length > 240) {
      setMessage('يجب ألا يتجاوز وصف الدور 240 حرفًا.');
      return;
    }
    const source = originals.find((role) => role.key === copyFrom) ?? originals.find((role) => role.key === 'viewer');
    const rolePermissions = source?.permissionKeys ?? [];
    const draftId = `new-${crypto.randomUUID()}`;
    setDrafts((current) => [...current, {
      id: null,
      clientId: draftId,
      key: draftId,
      name: cleanName,
      description: description.trim(),
      isSystem: false,
      baseRole,
      userCount: 0,
      permissionKeys: [...rolePermissions],
      isNew: true,
    }]);
    setName('');
    setDescription('');
    setMessage('أُضيف الدور كمسودة. احفظ التغييرات لتطبيقها.');
    setReviewing(false);
  }

  function updateRole(clientId: string, updates: Partial<Pick<DraftRole, 'name' | 'description'>>) {
    setDrafts((current) => current.map((role) => role.clientId === clientId ? { ...role, ...updates } : role));
    setReviewing(false);
  }

  function togglePermission(role: DraftRole, permissionKey: string) {
    if (role.isSystem && role.baseRole === 'admin') return;
    setDrafts((current) => current.map((item) => item.clientId !== role.clientId ? item : {
      ...item,
      permissionKeys: item.permissionKeys.includes(permissionKey)
        ? item.permissionKeys.filter((key) => key !== permissionKey)
        : [...item.permissionKeys, permissionKey],
    }));
    setReviewing(false);
  }

  return <div className="grid gap-5">
    <section>
      <p className="text-sm text-slate-500">إدارة الأدوار وصلاحياتها للمستخدمين المخولين</p>
      <h2 className="mt-1 text-2xl font-bold text-brand-900">الأدوار والصلاحيات</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">التغييرات تُراجع ثم تُحفظ معًا في عملية واحدة. صلاحيات مدير النظام مقفلة ولا يمكن حذف أدوار النظام.</p>
    </section>

    {roleQuery.error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">تعذر تحميل الأدوار والصلاحيات: {roleQuery.error.message}</p>}
    {save.isError && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">تعذر الحفظ: {save.error.message}</p>}
    {message && !save.isError && <p role="status" className="text-sm text-slate-700">{message}</p>}

    <section className="card grid gap-4 p-4 sm:p-5">
      <div>
        <h3 className="text-lg font-bold text-brand-900">إنشاء دور مخصص</h3>
        <p className="mt-1 text-sm leading-6 text-slate-500">انسخ صلاحيات دور قائم كبداية، ثم عدّلها من المصفوفة قبل الحفظ.</p>
      </div>
      <form className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" onSubmit={addRole}>
        <label className="grid gap-1 text-sm font-semibold">اسم الدور بالعربية
          <input required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 font-normal" />
        </label>
        <label className="grid gap-1 text-sm font-semibold">الوصف
          <input maxLength={240} value={description} onChange={(event) => setDescription(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 font-normal" />
        </label>
        <label className="grid gap-1 text-sm font-semibold">الدور الأساسي
          <select value={baseRole} onChange={(event) => setBaseRole(event.target.value as Exclude<BaseRole, 'admin'>)} className="rounded-lg border border-slate-300 px-3 py-2 font-normal">
            {baseRoleOptions.map(([value, info]) => <option key={value} value={value}>{info.label}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold">نسخ الصلاحيات من
          <select value={copyFrom} onChange={(event) => setCopyFrom(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 font-normal">
            {originals.filter((role) => !deletedIds.includes(role.id)).map((role) => <option key={role.key} value={role.key}>{role.name_ar}</option>)}
          </select>
        </label>
        <p className="rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600 sm:col-span-2 xl:col-span-3">{createBaseInfo.description} الدور الأساسي يحافظ على توافقه مع نموذج المستخدمين الحالي؛ الصلاحيات الفعلية تُحدد من المصفوفة.</p>
        <button type="submit" disabled={roleQuery.isLoading || !roleQuery.data} className="inline-flex items-center justify-center gap-2 self-end rounded-lg border border-brand-700 px-4 py-2 text-sm font-bold text-brand-800 disabled:cursor-not-allowed disabled:opacity-50"><Plus size={16} /> إضافة كمسودة</button>
      </form>
    </section>

    <section className="card grid gap-4 p-4 sm:p-5">
      <div>
        <h3 className="text-lg font-bold text-brand-900">إدارة الأدوار</h3>
        <p className="mt-1 text-sm text-slate-500">عدد المستخدمين يشمل كل الحسابات المسندة إلى الدور، ولا يمكن حذف دور مستخدم.</p>
      </div>
      {roleQuery.isLoading ? <p role="status">جارٍ تحميل الأدوار…</p> : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {drafts.map((role) => {
            const markedForDeletion = role.id !== null && deletedIds.includes(role.id);
            return <article key={role.clientId} className={`grid content-start gap-3 rounded-xl border p-4 ${markedForDeletion ? 'border-rose-200 bg-rose-50 opacity-70' : 'border-slate-200'}`}>
              <div className="flex items-start justify-between gap-2">
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${role.isSystem ? 'bg-slate-100 text-slate-700' : 'bg-brand-50 text-brand-800'}`}>{role.isSystem ? 'دور نظام' : role.isNew ? 'دور جديد' : 'دور مخصص'}</span>
                <span className="text-xs text-slate-500">عدد المستخدمين: {role.userCount}</span>
              </div>
              <label className="grid gap-1 text-xs font-semibold">اسم الدور
                <input value={role.name} maxLength={80} disabled={markedForDeletion} onChange={(event) => updateRole(role.clientId, { name: event.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal disabled:bg-slate-100" />
              </label>
              <label className="grid gap-1 text-xs font-semibold">الوصف
                <textarea value={role.description} maxLength={240} rows={2} disabled={markedForDeletion} onChange={(event) => updateRole(role.clientId, { description: event.target.value })} className="resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal disabled:bg-slate-100" />
              </label>
              <p className="text-xs text-slate-500">الدور الأساسي: {role.baseRole === 'admin' ? 'مدير النظام' : baseRoleInfo[role.baseRole].label}</p>
              {role.isSystem
                ? <p className="text-xs font-semibold text-slate-500">أدوار النظام لا تُحذف.</p>
                : role.isNew
                  ? <button type="button" onClick={() => setDrafts((current) => current.filter((item) => item.clientId !== role.clientId))} className="inline-flex items-center gap-2 text-sm font-semibold text-rose-700"><Trash2 size={15} /> إزالة المسودة</button>
                  : markedForDeletion
                    ? <button type="button" onClick={() => setDeletedIds((current) => current.filter((id) => id !== role.id))} className="inline-flex items-center gap-2 text-sm font-semibold text-brand-800"><Undo2 size={15} /> التراجع عن الحذف</button>
                    : <button type="button" disabled={role.userCount > 0} title={role.userCount ? 'لا يمكن حذف دور مسند إلى مستخدمين' : undefined} onClick={() => role.id !== null && setDeletedIds((current) => [...current, role.id!])} className="inline-flex items-center gap-2 text-sm font-semibold text-rose-700 disabled:cursor-not-allowed disabled:opacity-40"><Trash2 size={15} /> حذف الدور</button>}
            </article>;
          })}
        </div>
      )}
    </section>

    <section className="card grid gap-4 p-4 sm:p-5">
      <div>
        <h3 className="text-lg font-bold text-brand-900">مصفوفة الصلاحيات</h3>
        <p className="mt-1 text-sm leading-6 text-slate-500">كل قسم قابل للطي. في الشاشات الصغيرة اسحب الجدول أفقيًا لمقارنة الأدوار.</p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-800"><ShieldCheck size={14} /> محمي في القاعدة</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 font-semibold text-amber-800"><ShieldAlert size={14} /> واجهة فقط</span>
        </div>
      </div>
      {roleQuery.isLoading ? <p role="status">جارٍ تحميل الصلاحيات…</p> : !roleQuery.data?.permissions.length ? null : (
        <div className="grid gap-3">
          {Object.entries(permissionGroups).map(([groupKey, groupLabel]) => {
            const groupPermissions = roleQuery.data?.permissions.filter((permission) => permission.group_key === groupKey) ?? [];
            return <details key={groupKey} open className="overflow-hidden rounded-xl border border-slate-200">
              <summary className="cursor-pointer bg-slate-50 px-4 py-3 font-bold text-brand-900">{groupLabel}<span className="ms-2 text-xs font-normal text-slate-500">{groupPermissions.length || ''}</span></summary>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] border-collapse text-sm">
                  <thead><tr className="border-b border-slate-200 bg-white">
                    <th scope="col" className="sticky right-0 z-10 min-w-64 bg-white px-4 py-3 text-right">الصلاحية</th>
                    {visibleDrafts.map((role) => <th scope="col" key={role.clientId} className="min-w-32 px-3 py-3 text-center align-top">
                      <span className="block font-bold">{role.name}</span>
                      <span className="mt-1 block text-xs font-normal text-slate-500">المستخدمون: {role.userCount}</span>
                    </th>)}
                  </tr></thead>
                  <tbody>{groupPermissions.map((permission) => <tr key={permission.key} className="border-b border-slate-100 last:border-0">
                    <th scope="row" className="sticky right-0 z-10 bg-white px-4 py-3 text-right font-medium">
                      <span className="block">{permission.label_ar}</span>
                      <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${permission.enforced_in_db ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
                        {permission.enforced_in_db ? 'محمي في القاعدة' : 'واجهة فقط'}
                      </span>
                    </th>
                    {visibleDrafts.map((role) => {
                      const locked = role.isSystem && role.baseRole === 'admin';
                      return <td key={role.clientId} className="px-3 py-3 text-center">
                        <input type="checkbox" checked={role.permissionKeys.includes(permission.key)} disabled={locked || role.id !== null && deletedIds.includes(role.id)} onChange={() => togglePermission(role, permission.key)} aria-label={`${permission.label_ar} — ${role.name}`} className="h-4 w-4 accent-brand-700 disabled:cursor-not-allowed disabled:opacity-60" />
                      </td>;
                    })}
                  </tr>)}</tbody>
                </table>
              </div>
            </details>;
          })}
        </div>
      )}
    </section>

    {reviewing && hasChanges && <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 sm:p-5">
      <h3 className="font-bold text-amber-950">ما سيتغير</h3>
      <ul className="mt-3 grid gap-2 text-sm text-amber-950">
        {summary.changed.map(({ role, added, removed, metadata }) => <li key={role.clientId} className="rounded-lg bg-white/70 p-3">
          <strong>{role.name}</strong>{role.isNew ? ' — إنشاء دور' : ''}
          {metadata && !role.isNew ? ' · تحديث الاسم أو الوصف' : ''}
          {added ? ` · منح ${added} صلاحية` : ''}
          {removed ? ` · سحب ${removed} صلاحية` : ''}
        </li>)}
        {deletedIds.map((id) => <li key={id} className="rounded-lg bg-white/70 p-3">حذف الدور «{originals.find((role) => role.id === id)?.name_ar}» — لا يوجد مستخدم مسند إليه.</li>)}
      </ul>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={save.isPending} onClick={() => save.mutate()} className="inline-flex items-center gap-2 rounded-lg bg-brand-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"><Save size={16} /> {save.isPending ? 'جارٍ الحفظ…' : 'تأكيد وحفظ'}</button>
        <button type="button" disabled={save.isPending} onClick={() => setReviewing(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold">إلغاء</button>
      </div>
    </section>}
    {!reviewing && <button type="button" disabled={!hasChanges || save.isPending || roleQuery.isLoading} onClick={() => {
      const invalid = summary.changed.find(({ role }) => !role.name.trim() || role.name.length > 80 || !hasArabic(role.name) || role.description.length > 240);
      if (invalid) {
        setMessage(`تحقق من الاسم العربي أو وصف الدور «${invalid.role.name || 'بدون اسم'}».`);
        return;
      }
      setMessage('');
      setReviewing(true);
    }} className="inline-flex w-fit items-center gap-2 rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"><Save size={16} /> مراجعة التغييرات</button>}
  </div>;
}

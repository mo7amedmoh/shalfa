import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { getUnlinkedPlanNames } from '../../domain/planNameLinking';
import { defaultReportLayout } from '../plans/reportSections';
import { supabase } from '../../lib/supabase';
import { APP_SCHEMA_SELECT } from '../../lib/schemaColumns';

type SchemaCheck = { label: string; migration: string; ready: boolean; detail: string };
type HubStatus = {
  lastSync: string | null;
  hasEligibility: boolean;
  activePlanTypes: number;
  unlinkedNames: number;
  unlinkedGatekeepers: number | null;
  gatekeeperEmployees: number | null;
  cleanupRows: number | null;
  users: number | null;
  schemaChecks: SchemaCheck[];
};

async function loadPlanNames(table: 'monthly_plan_rows' | 'general_plan_rows'): Promise<string[]> {
  if (!supabase) throw new Error('يلزم إعداد Supabase.');
  const rows: Array<{ supervisor_name: string | null }> = [];
  for (let start = 0; ; start += 1000) {
    const result = table === 'monthly_plan_rows'
      ? await supabase.from('monthly_plan_rows').select('supervisor_name').is('supervisor_id', null).not('supervisor_name', 'is', null).range(start, start + 999)
      : await supabase.from('general_plan_rows').select('supervisor_name').not('supervisor_name', 'is', null).range(start, start + 999);
    if (result.error) throw result.error;
    const data = result.data;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows.map((row) => row.supervisor_name ?? '');
}

async function loadAliases(): Promise<string[]> {
  if (!supabase) throw new Error('يلزم إعداد Supabase.');
  const aliases: string[] = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabase.from('supervisor_aliases')
      .select('alias_normalised')
      .range(start, start + 999);
    if (error) throw error;
    aliases.push(...data.map((row) => row.alias_normalised));
    if (data.length < 1000) break;
  }
  return aliases;
}

async function loadHubStatus(isAdmin: boolean): Promise<HubStatus> {
  if (!supabase) throw new Error('يلزم إعداد Supabase.');
  const [
    latestSync, eligibility, planTypes, monthlyNames, generalNames, aliases,
    schoolsCheck, customCheck, monthlyCheck, gatekeeperCheck, employeeCategoryCheck, gatekeeperStatus,
    staffingRulesCheck,
  ] = await Promise.all([
    supabase.from('schools').select(APP_SCHEMA_SELECT.schoolsSyncTime)
      .not('synced_at', 'is', null).order('synced_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('app_config').select('key').eq('key', 'plan_eligibility').maybeSingle(),
    supabase.from('custom_plan_types').select('id', { count: 'exact', head: true }).eq('is_active', true),
    loadPlanNames('monthly_plan_rows'),
    loadPlanNames('general_plan_rows'),
    loadAliases(),
    supabase.from('schools').select('ministry_key').limit(0),
    supabase.from('custom_plan_types').select('group_key').limit(0),
    supabase.from('monthly_plan_rows').select('visited_date,report_done_date').limit(0),
    supabase.from('gatekeepers').select('employee_id,employee_no').limit(0),
    supabase.from('employees').select('id').eq('category', 'gatekeeper').limit(0),
    supabase.rpc('gatekeeper_employee_status'),
    supabase.from('app_config').select('key').eq('key', 'staffing_rules').maybeSingle(),
  ]);
  for (const result of [latestSync, eligibility, planTypes]) {
    if (result.error) throw result.error;
  }
  let cleanupRows: number | null = null;
  let userCount: number | null = null;
  let cleanupMigrationError: { message: string } | null = null;
  if (isAdmin) {
    const [cleanup, users] = await Promise.all([
      supabase.rpc('admin_school_cleanup_list'),
      supabase.from('profiles').select('id', { count: 'exact', head: true }),
    ]);
    if (users.error) throw users.error;
    cleanupMigrationError = cleanup.error;
    cleanupRows = !cleanup.error && Array.isArray(cleanup.data) ? cleanup.data.length : null;
    userCount = users.count ?? 0;
  }
  const parsedGatekeeperStatus = gatekeeperStatus.error
    ? null
    : z.object({ unlinked: z.number(), employees: z.number() }).parse(gatekeeperStatus.data);
  const check = (label: string, migration: string, error: { message: string } | null): SchemaCheck => ({
    label,
    migration,
    ready: !error,
    detail: error?.message ?? 'موجود',
  });
  const schemaChecks = [
    check('مفتاح الرقم الوزاري للمدارس', '202611070001_ministry_key.sql', schoolsCheck.error),
    check('مجموعة أنواع الخطط المخصصة', '202611060005_custom_plan_group_and_audit.sql', customCheck.error),
    check('حقول الزيارة والتقرير للخطط', '202611070002_bulk_plan_updates.sql', monthlyCheck.error),
    check('ربط سجلات البوابين بالموظفين', '202611100002_gatekeeper_employee_links.sql', gatekeeperCheck.error),
    check('فئة موظف حارس المدرسة', '202611100001_gatekeeper_category.sql', employeeCategoryCheck.error),
    check('فحص حالة ربط موظفي البوابين', '202611100002_gatekeeper_employee_links.sql', gatekeeperStatus.error),
    check('قواعد أحجام المدارس الستة', '202611140001_school_size_model.sql',
      staffingRulesCheck.error ?? (staffingRulesCheck.data ? null : { message: 'إعداد staffing_rules غير موجود' })),
    ...(isAdmin ? [check('قائمة تنظيف المدارس', '202611090001_school_cleanup.sql', cleanupMigrationError)] : []),
  ];
  const unlinkedNames = getUnlinkedPlanNames(
    [...monthlyNames, ...generalNames],
    aliases,
  ).length;
  return {
    lastSync: latestSync.data?.synced_at ?? null,
    hasEligibility: Boolean(eligibility.data),
    activePlanTypes: planTypes.count ?? 0,
    unlinkedNames,
    unlinkedGatekeepers: parsedGatekeeperStatus?.unlinked ?? null,
    gatekeeperEmployees: parsedGatekeeperStatus?.employees ?? null,
    cleanupRows,
    users: userCount,
    schemaChecks,
  };
}

export function SettingsHubPage({ isAdmin }: { isAdmin: boolean }) {
  const status = useQuery({ queryKey: ['admin-settings-hub', isAdmin], queryFn: () => loadHubStatus(isAdmin) });
  const checks = status.data?.schemaChecks ?? [];
  const missingMigrations = checks.filter((item) => !item.ready);
  const lastSync = status.data?.lastSync
    ? new Intl.DateTimeFormat('ar', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(status.data.lastSync))
    : 'لا توجد مزامنة مسجلة';
  const cards = [
    { title: 'مزامنة المدارس', description: `آخر مزامنة: ${lastSync}`, href: '/admin/settings/sync', action: 'إعداد الربط' },
    { title: 'أهلية الخطط', description: status.data?.hasEligibility ? 'قواعد الأهلية محفوظة' : 'لم تُحفظ القواعد بعد', href: '/admin/settings/eligibility', action: 'إعداد الأهلية' },
    { title: 'قواعد احتياج العمالة', description: 'توزيع العمال المطلوب حسب مؤشرات الأحجام الستة', href: '/admin/settings/staffing-rules', action: 'إدارة القواعد' },
    { title: 'إدارة الخطط', description: `أنواع خطط مخصصة نشطة: ${status.data?.activePlanTypes ?? '—'}`, href: '/settings/plans', action: 'إدارة الخطط' },
    { title: 'ربط الأسماء بالموظفين', description: `أسماء غير مرتبطة: ${status.data?.unlinkedNames ?? '—'}`, href: '/admin/settings/name-linking', action: 'مراجعة الأسماء' },
    { title: 'فحص المخطط والترحيلات', description: status.isLoading ? 'جارٍ الفحص…' : missingMigrations.length ? `ترحيلات ناقصة: ${missingMigrations.length}` : 'كل الفحوصات الأساسية ناجحة', href: '#schema-check', action: 'عرض الفحص' },
    { title: 'تنظيف المدارس', description: `مدارس تحتاج مراجعة: ${status.data?.cleanupRows ?? '—'}`, href: '/admin/school-cleanup', action: 'مراجعة المدارس', adminOnly: true },
    { title: 'افتراضات التقرير', description: `الأقسام الافتراضية: ${defaultReportLayout.length} · يمكن تخصيصها وحفظها لكل مستخدم`, href: '/plans/report', action: 'فتح التقرير' },
    { title: 'المستخدمون والصلاحيات', description: `الحسابات المسجلة: ${status.data?.users ?? '—'}`, href: '/admin/users', action: 'إدارة المستخدمين', adminOnly: true },
  ];
  return <div className="grid gap-5">
    <section>
      <p className="text-sm text-slate-500">مركز إعدادات المنصة وحالة تكاملاتها</p>
      <h2 className="mt-1 text-2xl font-bold text-brand-900">الإعدادات</h2>
    </section>
    {status.error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">تعذر تحميل حالة الإعدادات: {status.error.message}</p>}
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {cards.filter((card) => !card.adminOnly || isAdmin).map((card) => <Link key={card.title} to={card.href} className="card grid gap-2 p-4 transition hover:border-brand-300 hover:shadow-md">
        <h3 className="font-bold text-brand-900">{card.title}</h3>
        <p className="min-h-10 text-sm text-slate-600">{card.description}</p>
        <span className="text-sm font-semibold text-brand-700">{card.action} ←</span>
      </Link>)}
    </section>
    <section id="schema-check" className="card grid gap-3 p-5">
      <h3 className="text-lg font-bold text-brand-900">حالة المخطط والترحيلات المطلوبة</h3>
      {status.isLoading ? <p role="status">جارٍ فحص المخطط…</p> : <ul className="grid gap-2 text-sm">
        {checks.map((item) => <li key={item.label} className="flex flex-wrap justify-between gap-2 rounded-lg bg-slate-50 p-3">
          <span>{item.ready ? '✓' : '!' } {item.label}</span>
          <span className={item.ready ? 'text-emerald-700' : 'text-rose-700'}>{item.ready ? item.detail : `طبّق ${item.migration}: ${item.detail}`}</span>
        </li>)}
      </ul>}
      <button type="button" onClick={() => void status.refetch()} disabled={status.isFetching} className="justify-self-start rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-50">
        {status.isFetching ? 'جارٍ الفحص…' : 'إعادة فحص الحالة'}
      </button>
    </section>
  </div>;
}

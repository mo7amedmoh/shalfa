import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck, Building2, CalendarDays, ChevronDown, ClipboardCheck, FileText, Gauge,
  LayoutDashboard, LogOut, Menu, Settings2,
  UserRound, Users, X,
} from 'lucide-react';
import { NavLink, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { getUserPermissions, getUserProfile, signInWithEmail, type UserProfile } from '../lib/auth';
import { defaultPreferences, loadUserPreferences } from '../lib/preferences';
import { PreferencesProvider } from './PreferencesProvider';
import { Can, PermissionProvider, RequirePermission } from './PermissionProvider';
import { usePermission, usePermissions } from './permissionContext';
import type { PlanType } from '../domain/types';
import { buildCustomMenu, customPlanTypeSchema, type CustomPlanType } from '../domain/customPlans';
import { canUseReportTools, reportTools } from '../domain/reportTools';
import { permissionKeys, type PermissionKey } from '../domain/permissions';
import { DashboardPage } from '../features/dashboard/DashboardPage';

const SchoolsPage = lazy(() =>
  import('../features/schools/SchoolsPage').then((module) => ({ default: module.SchoolsPage })),
);
const ModulePage = lazy(() =>
  import('../features/modules/ModulePage').then((module) => ({ default: module.ModulePage })),
);
const MonthlyPlanPage = lazy(() =>
  import('../features/plans/MonthlyPlanPage').then((module) => ({ default: module.MonthlyPlanPage })),
);
const MonthlyReportPage = lazy(() =>
  import('../features/plans/MonthlyReportPage').then((module) => ({ default: module.MonthlyReportPage })),
);
const DevReportFixture = import.meta.env.DEV ? lazy(() =>
  import('../features/plans/DevReportFixture').then((module) => ({ default: module.DevReportFixture })),
) : null;
const DevMapFixture = import.meta.env.DEV ? lazy(() =>
  import('../features/schools/DevMapFixture').then((module) => ({ default: module.DevMapFixture })),
) : null;
const AccountPage = lazy(() =>
  import('../features/account/AccountPage').then((module) => ({ default: module.AccountPage })),
);
const GeneralPlansPage = lazy(() =>
  import('../features/plans/GeneralPlansPage').then((module) => ({ default: module.GeneralPlansPage })),
);
const CustomPlanPage = lazy(() =>
  import('../features/plans/CustomPlanPage').then((module) => ({ default: module.CustomPlanPage })),
);
const WorkforcePage = lazy(() =>
  import('../features/workforce/WorkforcePage').then((module) => ({ default: module.WorkforcePage })),
);
const RewardsPage = lazy(() =>
  import('../features/rewards/RewardsPage').then((module) => ({ default: module.RewardsPage })),
);
const CleanerPlacementPage = lazy(() =>
  import('../features/placement/CleanerPlacementPage').then((module) => ({ default: module.CleanerPlacementPage })),
);
const AttendancePage = lazy(() =>
  import('../features/attendance/AttendancePage').then((module) => ({ default: module.AttendancePage })),
);
const GatekeeperPlacementPage = lazy(() =>
  import('../features/placement/GatekeeperPlacementPage').then((module) => ({ default: module.GatekeeperPlacementPage })),
);
const AdminUsersPage = lazy(() =>
  import('../features/admin/AdminUsersPage').then((module) => ({ default: module.AdminUsersPage })),
);
const RolePermissionsPage = lazy(() =>
  import('../features/admin/RolePermissionsPage').then((module) => ({ default: module.RolePermissionsPage })),
);
const PlanManagementPage = lazy(() =>
  import('../features/admin/PlanManagementPage').then((module) => ({ default: module.PlanManagementPage })),
);
const AuditLogPage = lazy(() =>
  import('../features/admin/AuditLogPage').then((module) => ({ default: module.AuditLogPage })),
);
const SchoolCleanupPage = lazy(() =>
  import('../features/admin/SchoolCleanupPage').then((module) => ({ default: module.SchoolCleanupPage })),
);
const PlanNameLinkingPage = lazy(() =>
  import('../features/admin/PlanNameLinkingPage').then((module) => ({ default: module.PlanNameLinkingPage })),
);
const SettingsHubPage = lazy(() =>
  import('../features/admin/SettingsHubPage').then((module) => ({ default: module.SettingsHubPage })),
);
const StaffingRulesSettingsPage = lazy(() =>
  import('../features/admin/StaffingRulesSettingsPage').then((module) => ({ default: module.StaffingRulesSettingsPage })),
);
const TicketAnalysisPage = lazy(() =>
  import('../features/tickets/TicketAnalysisPage').then((module) => ({ default: module.TicketAnalysisPage })),
);
const ReportToolsPage = lazy(() =>
  import('../features/reports/ReportToolsPage').then((module) => ({ default: module.ReportToolsPage })),
);
const ReportGeneratorPage = lazy(() =>
  import('../features/reports/ReportGeneratorPage').then((module) => ({ default: module.ReportGeneratorPage })),
);
const monthlyPlanTypes: readonly PlanType[] = ['maintenance', 'cleaning', 'security_safety', 'elevators'];

function MonthlyPlanRoute({ profile }: { profile: UserProfile | null }) {
  const { type } = useParams();
  const planType = monthlyPlanTypes.find((candidate) => candidate === type);
  return planType ? <MonthlyPlanPage planType={planType} profile={profile} /> : <Navigate to="/" replace />;
}

type NavigationLink = { label: string; path: string; permission: PermissionKey };
type NavigationEntry = {
  label: string;
  icon: typeof LayoutDashboard;
  permission?: PermissionKey;
  path?: string;
  children?: NavigationLink[];
};

const navigation: NavigationEntry[] = [
  {
    label: 'لوحة التحكم',
    path: '/',
    icon: LayoutDashboard,
    permission: 'dashboard.view',
  },
  {
    label: 'الخطط الشهرية',
    icon: CalendarDays,
    children: [
      { label: 'خطة الصيانة', path: '/plans/maintenance', permission: 'plans.view' },
      { label: 'خطة النظافة', path: '/plans/cleaning', permission: 'plans.view' },
      { label: 'خطة الأمن والسلامة', path: '/plans/security_safety', permission: 'plans.view' },
      { label: 'خطة المصاعد', path: '/plans/elevators', permission: 'plans.view' },
      { label: 'التقرير العام', path: '/plans/report', permission: 'plans.view' },
    ],
  },
  {
    label: 'الخطط العامة',
    icon: ClipboardCheck,
    children: [
      { label: 'البستنة', path: '/general-plans/gardening', permission: 'plans.view' },
      { label: 'التنسيق', path: '/general-plans/landscaping', permission: 'plans.view' },
      { label: 'نزح مخلفات الصرف الصحي', path: '/general-plans/sewage_waste', permission: 'plans.view' },
      { label: 'توريد المياه', path: '/general-plans/water_supply', permission: 'plans.view' },
      { label: 'غسيل الخزانات', path: '/general-plans/tank_washing', permission: 'plans.view' },
      { label: 'مكافحة الآفات ورش المبيدات', path: '/general-plans/pest_control', permission: 'plans.view' },
      { label: 'خطط الاستعداد السنوية', path: '/general-plans/annual_readiness', permission: 'plans.view' },
    ],
  },
  { label: 'المباني المدرسية', path: '/schools', icon: Building2, permission: 'schools.view' },
  { label: 'القوى العاملة', path: '/workforce', icon: Users, permission: 'workforce.view' },
  {
    label: 'أعمال إدارية',
    icon: BadgeCheck,
    children: [
      { label: 'تسكين العمالة', path: '/placement/cleaners', permission: 'placement.cleaners.view' },
      { label: 'تحضير العمالة', path: '/placement/attendance', permission: 'attendance.view' },
      { label: 'تسكين البوابين', path: '/placement/gatekeepers', permission: 'placement.gatekeepers.view' },
      { label: 'مكافأة الفنيين', path: '/rewards', permission: 'rewards.view' },
    ],
  },
  {
    label: 'مؤشرات الأداء',
    icon: Gauge,
    children: [
      { label: 'بطاقات الأداء الشهرية', path: '/kpi/scorecards', permission: 'kpi.view' },
      { label: 'المخرجات التعاقدية', path: '/kpi/deliverables', permission: 'deliverables.view' },
    ],
  },
];

const adminNavigation: NavigationEntry[] = [
  { label: 'الإعدادات', path: '/admin/settings', icon: Settings2, permission: 'settings.view' },
  { label: 'سجل التدقيق', path: '/admin/audit', icon: FileText, permission: 'audit.view' },
];

function LoginPage({ onSignedIn }: { onSignedIn: () => void }) {
  const [error, setError] = useState('');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<{ email: string; password: string }>();

  async function submit(values: { email: string; password: string }) {
    setError('');
    try {
      await signInWithEmail(values.email, values.password);
      onSignedIn();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'تعذر تسجيل الدخول.');
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <section className="card w-full max-w-md p-8">
        <img src="/brand/logo.png" alt="شلفا لإدارة المرافق" className="mb-6 h-12 w-auto" />
        <h1 className="text-2xl font-bold text-brand-900">تسجيل الدخول</h1>
        <p className="mt-2 text-sm text-slate-500">استخدم بريدك الإلكتروني وكلمة المرور المعتمدين.</p>
        {!supabase && (
          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            يلزم إعداد عنوان Supabase ومفتاح anon في ملف البيئة لتفعيل تسجيل الدخول.
          </div>
        )}
        {error && <p role="alert" className="mt-4 text-sm text-rose-700">{error}</p>}
        <form className="mt-6 grid gap-4" onSubmit={handleSubmit(submit)}>
          <label className="grid gap-1 text-sm font-semibold">
            البريد الإلكتروني
            <input type="email" autoComplete="email" {...register('email', { required: 'البريد الإلكتروني مطلوب.' })} className="rounded-lg border border-slate-300 px-3 py-2" />
            {errors.email && <span className="text-xs text-rose-700">{errors.email.message}</span>}
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            كلمة المرور
            <input type="password" autoComplete="current-password" {...register('password', { required: 'كلمة المرور مطلوبة.' })} className="rounded-lg border border-slate-300 px-3 py-2" />
            {errors.password && <span className="text-xs text-rose-700">{errors.password.message}</span>}
          </label>
          <button disabled={!supabase || isSubmitting} className="rounded-lg bg-brand-700 px-4 py-2.5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
            {isSubmitting ? 'جارٍ التحقق…' : 'دخول'}
          </button>
        </form>
      </section>
    </main>
  );
}

function AppShell({
  profile,
  onSignOut,
  syncNotice,
}: {
  profile: UserProfile | null;
  onSignOut: () => void;
  syncNotice: string;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const location = useLocation();
  const grantedPermissions = usePermissions(permissionKeys);
  const canAccessReportTools = canUseReportTools(grantedPermissions);
  const canManageTicketAnalysis = usePermission('tools.ticket_analysis');
  const customTypes = useQuery({
    queryKey: ['custom-plan-types'],
    queryFn: async () => {
      if (!supabase) return [] as CustomPlanType[];
      const { data, error } = await supabase.from('custom_plan_types')
        .select('id,name,cadence,scope,track_visit_report,group_key,created_at,is_active').order('created_at');
      if (error) throw error;
      return z.array(customPlanTypeSchema).parse(data);
    },
    enabled: Boolean(profile),
  });
  const visibleNavigation = useMemo(() => navigation.flatMap((item) => {
    if (item.path) return grantedPermissions.has(item.permission!) ? [item] : [];
    const children = (item.children ?? []).filter((child) => grantedPermissions.has(child.permission));
    const group = item.label === 'الخطط الشهرية' ? 'monthly' : item.label === 'الخطط العامة' ? 'general' : null;
    if (group) {
      children.push(...buildCustomMenu(customTypes.data ?? [], group)
        .map(({ label, path }) => ({ label, path, permission: 'plans.view' as const }))
        .filter((child) => grantedPermissions.has(child.permission)));
    }
    return children.length ? [{ ...item, children }] : [];
  }), [customTypes.data, grantedPermissions]);
  const visibleAdminNavigation = adminNavigation.filter((item) => grantedPermissions.has(item.permission!));
  const preferences = useQuery({
    queryKey: ['user-preferences', profile?.id],
    queryFn: () => loadUserPreferences(profile!.id),
    enabled: Boolean(profile?.id),
  });
  const pageTitle = useMemo(() => {
    const allItems = [...visibleNavigation, ...visibleAdminNavigation];
    for (const item of allItems) {
      if (item.path === location.pathname) return item.label;
      const found = item.children?.find((child) => child.path === location.pathname);
      if (found) return found.label;
    }
    if (location.pathname.startsWith('/general-plans/')) return 'الخطة العامة';
    if (location.pathname.startsWith('/plans/')) return 'الخطط الشهرية';
    if (location.pathname.startsWith('/kpi/')) return 'مؤشرات الأداء';
    if (location.pathname.startsWith('/placement/')) return 'أعمال إدارية';
    if (location.pathname.startsWith('/tools/reports/')) {
      const toolId = location.pathname.split('/').at(-1);
      return reportTools.find((tool) => tool.id === toolId)?.label ?? 'منجز التقارير';
    }
    if (location.pathname === '/tools/reports') return 'منجز التقارير';
    if (location.pathname === '/tools/ticket-analysis') return 'تحليل البلاغات';
    if (location.pathname === '/admin/settings' || location.pathname.startsWith('/admin/settings/')) return 'الإعدادات';
    if (location.pathname === '/admin/school-cleanup') return 'تنظيف المدارس';
    if (location.pathname === '/admin/users') return 'المستخدمون والصلاحيات';
    return 'منصة إدارة المرافق المدرسية';
  }, [location.pathname, visibleAdminNavigation, visibleNavigation]);

  useEffect(() => {
    setSidebarOpen(false);
    setProfileMenuOpen(false);
    const activeGroup = visibleNavigation.find((item) =>
      item.children?.some((child) => child.path === location.pathname),
    );
    if (activeGroup) {
      setExpandedGroups((current) => ({ ...current, [activeGroup.label]: true }));
    }
  }, [location.pathname, visibleNavigation]);

  return (
    <PreferencesProvider value={preferences.data ?? defaultPreferences}>
    <div className="app-shell" data-sidebar-collapsed={sidebarCollapsed}>
      <aside className="sidebar p-4" data-open={sidebarOpen} data-collapsed={sidebarCollapsed}>
        <div className="mb-7 flex items-center justify-between gap-2 px-2 py-2">
          <img src="/brand/logo.png" alt="شلفا لإدارة المرافق" className="h-10 w-auto max-w-[190px]" />
          <button
            type="button"
            aria-label={sidebarCollapsed ? 'توسيع القائمة' : 'طي القائمة'}
            title={sidebarCollapsed ? 'توسيع القائمة' : 'طي القائمة'}
            className="desktop-sidebar-toggle rounded-lg p-2 text-slate-500 hover:bg-slate-100"
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          >
            <Menu size={19} aria-hidden="true" />
          </button>
          <button aria-label="إغلاق القائمة" className="mobile-menu hidden rounded-lg p-2 text-slate-500" onClick={() => setSidebarOpen(false)}><X size={20} /></button>
        </div>
        <nav aria-label="القائمة الرئيسية" className="grid gap-1">
          {visibleNavigation.map((item) => {
            const Icon = item.icon;
            return (
              <section key={item.label}>
                {item.path ? (
                <NavLink to={item.path} end className="nav-link" title={item.label}><Icon size={19} /><span>{item.label}</span></NavLink>
                ) : (
                  <>
                    <button
                      type="button"
                      className="nav-link w-full text-start"
                      aria-expanded={Boolean(expandedGroups[item.label])}
                      aria-controls={`nav-group-${visibleNavigation.indexOf(item)}`}
                      title={item.label}
                      onClick={() => {
                        if (sidebarCollapsed) {
                          setSidebarCollapsed(false);
                          setExpandedGroups((current) => ({ ...current, [item.label]: true }));
                        } else {
                          setExpandedGroups((current) => ({
                            ...current,
                            [item.label]: !current[item.label],
                          }));
                        }
                      }}
                    >
                      <Icon size={19} />
                      <span className="font-semibold">{item.label}</span>
                      <ChevronDown size={16} className={`me-auto transition-transform ${expandedGroups[item.label] ? 'rotate-180' : ''}`} />
                    </button>
                    {expandedGroups[item.label] && <div id={`nav-group-${visibleNavigation.indexOf(item)}`} className="me-4 grid border-e border-slate-200 pe-2">
                      {item.children?.map(({ label, path }) => (
                        <NavLink key={path} to={path} title={label} className="nav-link min-h-9 text-sm" aria-current={location.pathname === path ? 'page' : undefined}>{label}</NavLink>
                      ))}
                    </div>}
                  </>
                )}
              </section>
            );
          })}
          {visibleAdminNavigation.length > 0 ? <div className="mt-3 border-t border-slate-100 pt-3">
            {visibleAdminNavigation.map(({ label, path, icon: Icon }) => (
              <NavLink key={path} to={path!} title={label} className="nav-link"><Icon size={19} /><span>{label}</span></NavLink>
            ))}
          </div> : null}
        </nav>
        <div className="relative mt-6 border-t border-slate-100 pt-4">
          {profile ? (
            <>
              <button
                type="button"
                aria-expanded={profileMenuOpen}
                aria-controls="profile-menu"
                onClick={() => setProfileMenuOpen((open) => !open)}
                className="nav-link w-full justify-between"
              >
                <UserRound size={19} aria-hidden="true" />
                <span className="min-w-0 truncate text-sm font-semibold">{profile.display_name ?? profile.username}</span>
                <ChevronDown size={16} className={`shrink-0 transition-transform ${profileMenuOpen ? 'rotate-180' : ''}`} />
              </button>
              {profileMenuOpen && (
                <div id="profile-menu" className="absolute inset-x-0 bottom-full z-20 mb-2 grid gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                  <Can permission="dashboard.view"><NavLink to="/account" className="nav-link min-h-9 text-sm" onClick={() => setProfileMenuOpen(false)}>
                    <UserRound size={17} />
                    <span>حسابي</span>
                  </NavLink></Can>
                  {(canManageTicketAnalysis || canAccessReportTools) && (
                    <div className="border-t border-slate-100 pt-2">
                      <p className="px-3 pb-1 text-xs font-bold text-slate-500">أدواتي</p>
                      {canAccessReportTools && (
                        <NavLink to="/tools/reports" className="nav-link min-h-9 text-sm" onClick={() => setProfileMenuOpen(false)}>
                          <FileText size={17} />
                          <span>منجز التقارير</span>
                        </NavLink>
                      )}
                      {canManageTicketAnalysis && (
                        <NavLink to="/tools/ticket-analysis" className="nav-link min-h-9 text-sm" onClick={() => setProfileMenuOpen(false)}>
                          <FileText size={17} />
                          <span>تحليل البلاغات</span>
                        </NavLink>
                      )}
                    </div>
                  )}
                  <button type="button" onClick={onSignOut} className="nav-link min-h-9 text-sm text-rose-700">
                    <LogOut size={17} />
                    <span>تسجيل الخروج</span>
                  </button>
                </div>
              )}
            </>
          ) : null}
        </div>
      </aside>
      <div className="main-area">
        <header className="sticky top-0 z-10 flex min-h-16 items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur md:px-8">
          <button aria-label="فتح القائمة" className="mobile-menu hidden rounded-lg p-2 text-slate-700" onClick={() => setSidebarOpen(true)}><Menu size={21} /></button>
          <div className="flex-1">
            <p className="text-xs text-slate-500">شركة شلفا لإدارة المرافق</p>
            <h1 className="font-bold text-brand-900">{pageTitle}</h1>
          </div>
          {profile && <span className="hidden rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-800 sm:inline">{profile.role === 'admin' ? 'مدير النظام' : profile.role === 'project_manager' ? 'مدير المشروع' : 'مستخدم'}</span>}
        </header>
        {syncNotice && <div role="status" className="bg-emerald-50 px-4 py-2 text-center text-xs text-emerald-900">{syncNotice}</div>}
        {preferences.error && <div role="alert" className="bg-rose-50 px-4 py-2 text-center text-sm text-rose-800">تعذر تحميل تفضيلات العرض؛ تُستخدم القيم الافتراضية مؤقتاً.</div>}
        <main className="content-wrap">
          <Suspense fallback={<div role="status" className="card p-8 text-center text-slate-500">جارٍ تحميل الصفحة…</div>}>
            <Routes>
              {import.meta.env.DEV && DevReportFixture && <Route path="/__dev/report-fixture" element={<DevReportFixture />} />}
              {import.meta.env.DEV && DevMapFixture && <Route path="/__dev/map-fixture" element={<DevMapFixture />} />}
              <Route path="/" element={<RequirePermission permission="dashboard.view"><DashboardPage profile={profile} /></RequirePermission>} />
              <Route path="/schools" element={<RequirePermission permission="schools.view"><SchoolsPage profile={profile} /></RequirePermission>} />
              <Route path="/plans/report" element={<RequirePermission permission="plans.view"><MonthlyReportPage /></RequirePermission>} />
              <Route path="/plans/:type" element={<RequirePermission permission="plans.view"><MonthlyPlanRoute profile={profile} /></RequirePermission>} />
              <Route path="/general-plans/:type" element={<RequirePermission permission="plans.view"><GeneralPlansPage profile={profile} /></RequirePermission>} />
              <Route path="/plans/custom/:typeId" element={<RequirePermission permission="plans.view"><CustomPlanPage /></RequirePermission>} />
              <Route path="/workforce" element={<RequirePermission permission="workforce.view"><WorkforcePage profile={profile} /></RequirePermission>} />
              <Route path="/placement/cleaners" element={<RequirePermission permission="placement.cleaners.view"><CleanerPlacementPage profile={profile} /></RequirePermission>} />
              <Route path="/placement/attendance" element={<RequirePermission permission="attendance.view"><AttendancePage /></RequirePermission>} />
              <Route path="/placement/gatekeepers" element={<RequirePermission permission="placement.gatekeepers.view"><GatekeeperPlacementPage profile={profile} /></RequirePermission>} />
              <Route path="/rewards" element={<RequirePermission permission="rewards.view"><RewardsPage profile={profile} /></RequirePermission>} />
              <Route path="/kpi/:type" element={<RequirePermission permission="kpi.view"><ModulePage section="kpi" profile={profile} /></RequirePermission>} />
              <Route path="/account" element={<RequirePermission permission="dashboard.view"><AccountPage profile={profile} /></RequirePermission>} />
              <Route path="/tools/ticket-analysis" element={<RequirePermission permission="tools.ticket_analysis"><TicketAnalysisPage /></RequirePermission>} />
              <Route path="/tools/reports" element={<RequirePermission permission="reports.tools"><ReportToolsPage /></RequirePermission>} />
              <Route path="/tools/reports/:toolId" element={<RequirePermission permission="reports.tools"><ReportGeneratorPage /></RequirePermission>} />
              <Route path="/admin/users" element={<RequirePermission permission="users.manage"><AdminUsersPage /></RequirePermission>} />
              <Route path="/admin/audit" element={<RequirePermission permission="audit.view"><AuditLogPage /></RequirePermission>} />
              <Route path="/admin/school-cleanup" element={<RequirePermission permission="schools.cleanup"><SchoolCleanupPage /></RequirePermission>} />
              <Route path="/admin/plan-name-linking" element={<RequirePermission permission="settings.view"><Navigate to="/admin/settings/name-linking" replace /></RequirePermission>} />
              <Route path="/admin/settings" element={<RequirePermission permission="settings.view"><SettingsHubPage /></RequirePermission>} />
              <Route path="/admin/settings/sync" element={<RequirePermission permission="settings.view"><ModulePage section="admin" type="sync" /></RequirePermission>} />
              <Route path="/admin/settings/eligibility" element={<RequirePermission permission="plans.manage_types"><ModulePage section="admin" type="eligibility" /></RequirePermission>} />
              <Route path="/admin/settings/staffing-rules" element={<RequirePermission permission="staffing.rules.view"><StaffingRulesSettingsPage /></RequirePermission>} />
              <Route path="/admin/settings/name-linking" element={<RequirePermission permission="settings.view"><PlanNameLinkingPage /></RequirePermission>} />
              <Route path="/admin/settings/school-cleanup" element={<RequirePermission permission="schools.cleanup"><SchoolCleanupPage /></RequirePermission>} />
              <Route path="/admin/settings/users" element={<RequirePermission permission="users.manage"><AdminUsersPage /></RequirePermission>} />
              <Route path="/admin/settings/roles" element={<RequirePermission permission="users.manage"><RolePermissionsPage /></RequirePermission>} />
              <Route path="/settings/plans" element={<RequirePermission permission="plans.manage_types">{profile ? <PlanManagementPage profile={profile} /> : <Navigate to="/" replace />}</RequirePermission>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </main>
        <footer className="px-8 pb-6 text-center text-xs text-slate-400">منصة إدارة مشروع إدارة المرافق المدرسية</footer>
      </div>
    </div>
    </PreferencesProvider>
  );
}

export function App() {
  const queryClient = useQueryClient();
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [effectivePermissions, setEffectivePermissions] = useState<PermissionKey[] | null>(null);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [syncNotice, setSyncNotice] = useState('');
  const [authChecked, setAuthChecked] = useState(Boolean(supabase));

  useEffect(() => {
    if (!syncNotice) return;
    const timeout = window.setTimeout(() => setSyncNotice(''), 8000);
    return () => window.clearTimeout(timeout);
  }, [syncNotice]);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void supabase.auth.getSession().then(({ data, error }) => {
      if (error) console.error('تعذر استعادة جلسة المستخدم.', error);
      if (active) {
        setSessionUserId(data.session?.user.id ?? null);
        setAuthChecked(true);
      }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionUserId(session?.user.id ?? null);
      if (!session) {
        setProfile(null);
        setEffectivePermissions(null);
        setPermissionError(null);
      }
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!sessionUserId) return;
    let active = true;
    setProfile(null);
    setEffectivePermissions(null);
    setPermissionError(null);
    void Promise.all([getUserProfile(sessionUserId), getUserPermissions()])
      .then(([userProfile, permissions]) => {
        if (!active) return;
        setProfile(userProfile);
        setEffectivePermissions(permissions);
      })
      .catch((error: unknown) => {
        console.error('تعذر تحميل صلاحيات المستخدم.', error);
        if (active) {
          setProfile(null);
          setPermissionError(error instanceof Error ? error.message : 'تعذر تحميل الصلاحيات.');
        }
      });
    return () => { active = false; };
  }, [sessionUserId]);

  useEffect(() => {
    if (!effectivePermissions?.includes('schools.sync')) return;
    let active = true;
    void import('../lib/schoolSync').then(({ runThrottledSchoolSync }) => runThrottledSchoolSync())
      .then((result) => {
        if (active && result !== null) {
          void queryClient.invalidateQueries({ queryKey: ['schools'] });
          const counters: Array<[string, number]> = [
            ['صفوف المصدر', result.sourceRows],
            ['مستبعدة', result.skippedRows.total],
            ['جديد', result.inserted],
            ['محدث', result.updated],
            ['أحجام غير معروفة', result.sizeWarnings.length],
            ['معلّمة كمفقودة', result.flaggedMissing],
            ['إحداثيات غير صالحة', result.invalidCoordinates],
            ['صفوف مكررة', result.duplicatesWarned],
          ];
          const details = counters
            .filter(([, count]) => count > 0)
            .map(([label, count]) => `${label} ${count}`)
            .join(' · ');
          setSyncNotice(`اكتملت المزامنة · ${result.inserted + result.updated} مدرسة${details ? ` · ${details}` : ''}`);
        }
      })
      .catch((error: unknown) => {
        console.error('تعذرت المزامنة التلقائية للمدارس.', error);
        if (active) setSyncNotice('تعذرت المزامنة التلقائية. راجع إعدادات المصدر والاتصال.');
      });
    return () => { active = false; };
  }, [effectivePermissions, queryClient]);

  async function signOut() {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) console.error('تعذر تسجيل الخروج.', error);
  }

  if (import.meta.env.DEV && window.location.pathname === '/__dev/report-fixture' && DevReportFixture) {
    return <DevReportFixture />;
  }
  if (import.meta.env.DEV && window.location.pathname === '/__dev/map-fixture' && DevMapFixture) {
    return <DevMapFixture />;
  }
  if (!supabase) {
    const missingVariables = [
      ['VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL],
      ['VITE_SUPABASE_PUBLISHABLE_KEY', import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY],
    ].filter(([, value]) => !value).map(([name]) => name);
    return (
      <main className="grid min-h-screen place-items-center px-4">
        <section className="card max-w-lg p-6 text-center">
          <h1 className="text-xl font-bold text-brand-900">إعداد الاتصال مطلوب</h1>
          <p className="mt-3 text-sm leading-7 text-slate-600">أضف متغيرات البيئة الناقصة التالية إلى إعدادات البناء لإتاحة تسجيل الدخول:</p>
          <ul className="mt-3 list-inside list-disc text-start text-sm font-semibold text-slate-800">
            {missingVariables.map((name) => <li key={name}><code dir="ltr">{name}</code></li>)}
          </ul>
          <p className="mt-3 text-xs leading-6 text-slate-500">استخدم مفتاح النشر أو anon فقط؛ لا تضع service_role أو أي مفتاح سري في إعدادات العميل.</p>
        </section>
      </main>
    );
  }
  if (!authChecked) return <div className="grid min-h-screen place-items-center text-slate-600">جارٍ التحقق من الجلسة…</div>;
  if (!sessionUserId) return <LoginPage onSignedIn={() => setAuthChecked(true)} />;
  if (permissionError) {
    return <main className="grid min-h-screen place-items-center p-4">
      <section className="card grid max-w-lg gap-4 p-6 text-center">
        <p role="alert" className="text-sm text-rose-800">تعذر تحميل ملف المستخدم أو صلاحياته: {permissionError}</p>
        <button type="button" onClick={() => void signOut()} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold">تسجيل الخروج</button>
      </section>
    </main>;
  }
  if (sessionUserId && (!profile || !effectivePermissions)) {
    return <div role="status" className="grid min-h-screen place-items-center text-slate-600">جارٍ تحميل ملف المستخدم والصلاحيات…</div>;
  }
  return <PermissionProvider permissions={effectivePermissions ?? []}>
    <AppShell profile={profile} onSignOut={() => void signOut()} syncNotice={syncNotice} />
  </PermissionProvider>;
}

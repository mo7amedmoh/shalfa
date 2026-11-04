import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck, Building2, CalendarDays, ChevronDown, ClipboardCheck, FileText, Gauge,
  LayoutDashboard, LogOut, Menu, Settings2,
  ShieldCheck, UserRound, Users, X,
} from 'lucide-react';
import { NavLink, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { getUserProfile, signInWithEmail, type UserProfile } from '../lib/auth';
import { runThrottledSchoolSync } from '../lib/schoolSync';
import { defaultPreferences, loadUserPreferences } from '../lib/preferences';
import { PreferencesProvider } from './PreferencesProvider';
import type { PlanType } from '../domain/types';
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
const AccountPage = lazy(() =>
  import('../features/account/AccountPage').then((module) => ({ default: module.AccountPage })),
);
const GeneralPlansPage = lazy(() =>
  import('../features/plans/GeneralPlansPage').then((module) => ({ default: module.GeneralPlansPage })),
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
const GatekeeperPlacementPage = lazy(() =>
  import('../features/placement/GatekeeperPlacementPage').then((module) => ({ default: module.GatekeeperPlacementPage })),
);
const AdminUsersPage = lazy(() =>
  import('../features/admin/AdminUsersPage').then((module) => ({ default: module.AdminUsersPage })),
);
const AuditLogPage = lazy(() =>
  import('../features/admin/AuditLogPage').then((module) => ({ default: module.AuditLogPage })),
);
const monthlyPlanTypes: readonly PlanType[] = ['maintenance', 'cleaning', 'security_safety', 'elevators'];

function MonthlyPlanRoute({ profile }: { profile: UserProfile | null }) {
  const { type } = useParams();
  const planType = monthlyPlanTypes.find((candidate) => candidate === type);
  return planType ? <MonthlyPlanPage planType={planType} profile={profile} /> : <Navigate to="/" replace />;
}

const navigation = [
  {
    label: 'لوحة التحكم',
    path: '/',
    icon: LayoutDashboard,
  },
  {
    label: 'الخطط الشهرية',
    icon: CalendarDays,
    children: [
      ['خطة الصيانة', '/plans/maintenance'],
      ['خطة النظافة', '/plans/cleaning'],
      ['خطة الأمن والسلامة', '/plans/security_safety'],
      ['خطة المصاعد', '/plans/elevators'],
      ['التقرير العام', '/plans/report'],
    ],
  },
  {
    label: 'الخطط العامة',
    icon: ClipboardCheck,
    children: [
      ['البستنة', '/general-plans/gardening'],
      ['التنسيق', '/general-plans/landscaping'],
      ['نزح مخلفات الصرف الصحي', '/general-plans/sewage_waste'],
      ['توريد المياه', '/general-plans/water_supply'],
      ['غسيل الخزانات', '/general-plans/tank_washing'],
      ['مكافحة الآفات ورش المبيدات', '/general-plans/pest_control'],
      ['خطط الاستعداد السنوية', '/general-plans/annual_readiness'],
    ],
  },
  { label: 'المباني المدرسية', path: '/schools', icon: Building2 },
  { label: 'القوى العاملة', path: '/workforce', icon: Users },
  {
    label: 'أعمال إدارية',
    icon: BadgeCheck,
    children: [
      ['تسكين العمالة', '/placement/cleaners'],
      ['تسكين البوابين', '/placement/gatekeepers'],
      ['مكافأة الفنيين', '/rewards'],
    ],
  },
  {
    label: 'مؤشرات الأداء',
    icon: Gauge,
    children: [
      ['بطاقات الأداء الشهرية', '/kpi/scorecards'],
      ['المخرجات التعاقدية', '/kpi/deliverables'],
    ],
  },
  { label: 'حسابي', path: '/account', icon: UserRound },
];

const adminNavigation = [
  { label: 'المستخدمون والصلاحيات', path: '/admin/users', icon: ShieldCheck },
  { label: 'المزامنة والإعدادات', path: '/admin/settings', icon: Settings2 },
  { label: 'سجل التدقيق', path: '/admin/audit', icon: FileText },
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
  const location = useLocation();
  const isAdmin = profile?.role === 'admin';
  const preferences = useQuery({
    queryKey: ['user-preferences', profile?.id],
    queryFn: () => loadUserPreferences(profile!.id),
    enabled: Boolean(profile?.id),
  });
  const pageTitle = useMemo(() => {
    const allItems = [...navigation, ...adminNavigation];
    for (const item of allItems) {
      if ('path' in item && item.path === location.pathname) return item.label;
      if ('children' in item) {
        const found = item.children?.find((child) => child[1] === location.pathname);
        if (found) return found[0];
      }
    }
    if (location.pathname.startsWith('/general-plans/')) return 'الخطة العامة';
    if (location.pathname.startsWith('/plans/')) return 'الخطط الشهرية';
    if (location.pathname.startsWith('/kpi/')) return 'مؤشرات الأداء';
    if (location.pathname.startsWith('/placement/')) return 'أعمال إدارية';
    return 'منصة إدارة المرافق المدرسية';
  }, [location.pathname]);

  useEffect(() => setSidebarOpen(false), [location.pathname]);

  return (
    <PreferencesProvider value={preferences.data ?? defaultPreferences}>
    <div className="app-shell">
      <aside className="sidebar p-4" data-open={sidebarOpen}>
        <div className="mb-7 flex items-center justify-between gap-2 px-2 py-2">
          <img src="/brand/logo.png" alt="شلفا لإدارة المرافق" className="h-10 w-auto max-w-[190px]" />
          <button aria-label="إغلاق القائمة" className="mobile-menu hidden rounded-lg p-2 text-slate-500" onClick={() => setSidebarOpen(false)}><X size={20} /></button>
        </div>
        <nav aria-label="القائمة الرئيسية" className="grid gap-1">
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <section key={item.label}>
                {'path' in item ? (
                  <NavLink to={item.path!} end className="nav-link"><Icon size={19} /><span>{item.label}</span></NavLink>
                ) : (
                  <>
                    <div className="nav-link cursor-default"><Icon size={19} /><span className="font-semibold">{item.label}</span><ChevronDown size={16} className="me-auto" /></div>
                    <div className="me-4 grid border-e border-slate-200 pe-2">
                      {item.children?.map(([label, path]) => (
                        <NavLink key={path} to={path} className="nav-link min-h-9 text-sm" aria-current={location.pathname === path ? 'page' : undefined}>{label}</NavLink>
                      ))}
                    </div>
                  </>
                )}
              </section>
            );
          })}
          {isAdmin && <div className="mt-3 border-t border-slate-100 pt-3">
            {adminNavigation.map(({ label, path, icon: Icon }) => (
              <NavLink key={path} to={path} className="nav-link"><Icon size={19} /><span>{label}</span></NavLink>
            ))}
          </div>}
        </nav>
        <div className="mt-6 border-t border-slate-100 pt-4">
          {profile ? (
            <div className="flex items-center justify-between gap-2 px-2">
              <span className="min-w-0 truncate text-sm font-semibold">{profile.display_name}</span>
              <button onClick={onSignOut} aria-label="تسجيل الخروج" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><LogOut size={18} /></button>
            </div>
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
        {syncNotice && <div role="status" className="bg-emerald-50 px-4 py-2 text-center text-sm text-emerald-900">{syncNotice}</div>}
        {preferences.error && <div role="alert" className="bg-rose-50 px-4 py-2 text-center text-sm text-rose-800">تعذر تحميل تفضيلات العرض؛ تُستخدم القيم الافتراضية مؤقتاً.</div>}
        <main className="content-wrap">
          <Suspense fallback={<div role="status" className="card p-8 text-center text-slate-500">جارٍ تحميل الصفحة…</div>}>
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/schools" element={<SchoolsPage profile={profile} />} />
              <Route path="/plans/report" element={<MonthlyReportPage />} />
              <Route path="/plans/:type" element={<MonthlyPlanRoute profile={profile} />} />
              <Route path="/general-plans/:type" element={<GeneralPlansPage profile={profile} />} />
              <Route path="/workforce" element={<WorkforcePage profile={profile} />} />
              <Route path="/placement/cleaners" element={<CleanerPlacementPage profile={profile} />} />
              <Route path="/placement/gatekeepers" element={<GatekeeperPlacementPage profile={profile} />} />
              <Route path="/rewards" element={<RewardsPage profile={profile} />} />
              <Route path="/kpi/:type" element={<ModulePage section="kpi" profile={profile} />} />
              <Route path="/account" element={<AccountPage profile={profile} />} />
              <Route path="/admin/users" element={isAdmin ? <AdminUsersPage /> : <Navigate to="/" replace />} />
              <Route path="/admin/audit" element={isAdmin ? <AuditLogPage /> : <Navigate to="/" replace />} />
              <Route path="/admin/settings" element={isAdmin ? <ModulePage section="admin" type="settings" /> : <Navigate to="/" replace />} />
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
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [syncNotice, setSyncNotice] = useState('');
  const [authChecked, setAuthChecked] = useState(Boolean(supabase));

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
      if (!session) setProfile(null);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!sessionUserId) return;
    let active = true;
    void getUserProfile(sessionUserId)
      .then((userProfile) => { if (active) setProfile(userProfile); })
      .catch((error: unknown) => {
        console.error('تعذر تحميل صلاحيات المستخدم.', error);
        if (active) setProfile(null);
      });
    return () => { active = false; };
  }, [sessionUserId]);

  useEffect(() => {
    if (profile?.role !== 'admin') return;
    let active = true;
    void runThrottledSchoolSync()
      .then((result) => {
        if (active && result !== null) {
          const duplicatesNotice = result.duplicatesWarned > 0
            ? ` يوجد ${result.duplicatesWarned} صفاً برقم وزاري مكرر.`
            : '';
          setSyncNotice(`اكتملت المزامنة التلقائية: جديد ${result.inserted}، محدث ${result.updated}، معلّم كمفقود ${result.flaggedMissing}، إحداثيات ناقصة/غير صالحة ${result.invalidCoordinates}.${duplicatesNotice}`);
        }
      })
      .catch((error: unknown) => {
        console.error('تعذرت المزامنة التلقائية للمدارس.', error);
        if (active) setSyncNotice('تعذرت المزامنة التلقائية. راجع إعدادات المصدر والاتصال.');
      });
    return () => { active = false; };
  }, [profile]);

  async function signOut() {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) console.error('تعذر تسجيل الخروج.', error);
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
  if (sessionUserId && !profile) {
    return <div role="status" className="grid min-h-screen place-items-center text-slate-600">جارٍ تحميل ملف المستخدم والصلاحيات…</div>;
  }
  return <AppShell profile={profile} onSignOut={() => void signOut()} syncNotice={syncNotice} />;
}

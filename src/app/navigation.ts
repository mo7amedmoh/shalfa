import {
  BadgeCheck, Building2, CalendarDays, ClipboardCheck, FileText, Gauge,
  LayoutDashboard, Settings2, Users, Package,
} from 'lucide-react';
import { buildCustomMenu, type CustomPlanType } from '../domain/customPlans';
import type { PermissionKey } from '../domain/permissions';

export type NavigationLink = { label: string; path: string; permission: PermissionKey };
export type NavigationEntry = {
  label: string;
  icon: typeof LayoutDashboard;
  permission?: PermissionKey;
  path?: string;
  children?: NavigationLink[];
};

export const navigation: NavigationEntry[] = [
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
    label: 'المخزون',
    icon: Package,
    children: [
      { label: 'الأصناف والأرصدة', path: '/inventory', permission: 'inventory.view' },
      { label: 'طلبات قطع الغيار', path: '/inventory/requests', permission: 'inventory.request' },
      { label: 'طلبات للمراجعة', path: '/inventory/review', permission: 'inventory.approve' },
      { label: 'صرف الطلبات', path: '/inventory/issue', permission: 'inventory.issue' },
      { label: 'ختمي وتوقيعي', path: '/inventory/stamp', permission: 'inventory.approve' },
    ],
  },
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

export function filterNavigation(
  entries: readonly NavigationEntry[],
  grantedPermissions: ReadonlySet<PermissionKey>,
  customTypes: readonly CustomPlanType[] = [],
): NavigationEntry[] {
  return entries.flatMap((item) => {
    if (item.path) return grantedPermissions.has(item.permission!) ? [item] : [];
    const children = (item.children ?? []).filter((child) => grantedPermissions.has(child.permission));
    const group = item.label === 'الخطط الشهرية' ? 'monthly' : item.label === 'الخطط العامة' ? 'general' : null;
    if (group) {
      children.push(...buildCustomMenu([...customTypes], group)
        .map(({ label, path }) => ({ label, path, permission: 'plans.view' as const }))
        .filter((child) => grantedPermissions.has(child.permission)));
    }
    return children.length ? [{ ...item, children }] : [];
  });
}

export const adminNavigation: NavigationEntry[] = [
  { label: 'الإعدادات', path: '/admin/settings', icon: Settings2, permission: 'settings.view' },
  { label: 'سجل التدقيق', path: '/admin/audit', icon: FileText, permission: 'audit.view' },
];

import type { DashboardAccess } from './dashboardAccess';
import type { PermissionKey } from './permissions';

export const dashboardCardOptions = [
  { id: 'inventory-shortage', label: 'نواقص المستودع', permissionHint: 'صلاحية عرض المخزون' },
  { id: 'report-follower', label: 'التحديث الجماعي والزيارات المتأخرة', permissionHint: 'صلاحية تسجيل الزيارة والتقرير دون صلاحيات تعديل الخطط' },
  { id: 'plan-summary', label: 'ملخص أداء الخطة', permissionHint: 'صلاحية عرض الخطط' },
  { id: 'action-late-visits', label: 'زيارات فاتها موعدها', permissionHint: 'صلاحية إدارة الخطط' },
  { id: 'action-visit-no-report', label: 'زيارات تمت دون تقرير', permissionHint: 'صلاحية إدارة الخطط' },
  { id: 'action-cleaner-shortage', label: 'عجز عمالة النظافة', permissionHint: 'صلاحية إدارة الخطط وإسناد العاملين' },
  { id: 'action-deliverables-due', label: 'مخرجات تستحق خلال 14 يومًا', permissionHint: 'صلاحية تعديل المخرجات' },
  { id: 'action-kpi-pending', label: 'بطاقة الأداء السابقة غير المعتمدة', permissionHint: 'صلاحية تعديل مؤشرات الأداء' },
  { id: 'service-progress', label: 'أداء الخدمات', permissionHint: 'صلاحية عرض الخطط' },
  { id: 'supervisor-performance', label: 'التزام مشرفي الصيانة', permissionHint: 'صلاحية إسناد العاملين' },
  { id: 'workforce-coverage', label: 'تغطية القوى العاملة', permissionHint: 'صلاحية إسناد العاملين' },
  { id: 'schools-missing-supervisors', label: 'مدارس بلا مشرف صيانة/نظافة', permissionHint: 'صلاحية عرض القوى العاملة' },
  { id: 'rewards-shortcut', label: 'مكافآت الفنيين', permissionHint: 'صلاحية توزيع المكافآت' },
  { id: 'schools-support', label: 'المدارس التي تحتاج دعمًا', permissionHint: 'صلاحية إسناد العاملين' },
  { id: 'contracts-summary', label: 'العقود والمخرجات', permissionHint: 'صلاحية مؤشرات الأداء أو المخرجات' },
  { id: 'recent-activity', label: 'آخر النشاطات', permissionHint: 'صلاحية عرض الإعدادات' },
] as const;

export type DashboardCardId = (typeof dashboardCardOptions)[number]['id'];
export type DashboardCardSettings = { hiddenIds: DashboardCardId[] };

export const defaultDashboardCardSettings: DashboardCardSettings = { hiddenIds: [] };

const dashboardCardIdSet = new Set<string>(dashboardCardOptions.map(({ id }) => id));

export function normalizeDashboardCardSettings(value: unknown): DashboardCardSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('إعدادات بطاقات لوحة التحكم غير صالحة.');
  }
  const hiddenIds = (value as { hiddenIds?: unknown }).hiddenIds;
  if (!Array.isArray(hiddenIds) || hiddenIds.some((id) => typeof id !== 'string')) {
    throw new Error('قائمة البطاقات المخفية في إعدادات لوحة التحكم غير صالحة.');
  }
  return {
    hiddenIds: [...new Set(hiddenIds.filter((id): id is DashboardCardId => dashboardCardIdSet.has(id)))],
  };
}

export function isDashboardCardVisible(
  id: DashboardCardId,
  settings: DashboardCardSettings,
  access: DashboardAccess,
  permissions: ReadonlySet<PermissionKey>,
): boolean {
  if (settings.hiddenIds.includes(id)) return false;

  switch (id) {
    case 'inventory-shortage':
      return permissions.has('inventory.view');
    case 'report-follower':
      return access.reportFollowerView;
    case 'plan-summary':
    case 'service-progress':
      return access.plans && !access.reportFollowerView;
    case 'action-late-visits':
    case 'action-visit-no-report':
      return access.actions;
    case 'action-cleaner-shortage':
      return access.actions && access.staffing;
    case 'action-deliverables-due':
      return access.actions && access.deliverables;
    case 'action-kpi-pending':
      return access.actions && access.kpi;
    case 'supervisor-performance':
    case 'workforce-coverage':
    case 'schools-support':
      return access.workforce && !access.reportFollowerView;
    case 'schools-missing-supervisors':
      return permissions.has('workforce.view');
    case 'rewards-shortcut':
      return access.rewardsShortcut;
    case 'contracts-summary':
      return access.deliverables || access.kpi;
    case 'recent-activity':
      return access.activity;
  }
}

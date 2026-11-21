import type { PermissionKey } from './permissions';

export interface DashboardAccess {
  plans: boolean;
  staffing: boolean;
  syncTime: boolean;
  actions: boolean;
  workforce: boolean;
  rewardsShortcut: boolean;
  kpi: boolean;
  deliverables: boolean;
  activity: boolean;
  reportFollowerView: boolean;
}

export function dashboardAccessForPermissions(permissions: ReadonlySet<PermissionKey>): DashboardAccess {
  const has = (permission: PermissionKey) => permissions.has(permission);
  const reportFollowerView = has('plans.record_visit_report')
    && !has('plans.create_delete')
    && !has('plans.edit_rows');
  return {
    plans: has('plans.view'),
    staffing: has('workforce.assign_cleaners'),
    syncTime: has('settings.view'),
    actions: has('plans.create_delete'),
    workforce: has('workforce.assign_cleaners'),
    rewardsShortcut: has('rewards.distribute') && !has('audit.view'),
    kpi: has('kpi.edit'),
    deliverables: has('deliverables.edit'),
    activity: has('settings.view'),
    reportFollowerView,
  };
}

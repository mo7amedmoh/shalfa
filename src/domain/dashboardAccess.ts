import type { UserProfile } from '../lib/auth';

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

const noAccess: DashboardAccess = {
  plans: false,
  staffing: false,
  syncTime: false,
  actions: false,
  workforce: false,
  rewardsShortcut: false,
  kpi: false,
  deliverables: false,
  activity: false,
  reportFollowerView: false,
};

const fullAccess: DashboardAccess = {
  plans: true,
  staffing: true,
  syncTime: true,
  actions: true,
  workforce: true,
  rewardsShortcut: false,
  kpi: true,
  deliverables: true,
  activity: true,
  reportFollowerView: false,
};

export function dashboardAccessForRole(role: UserProfile['role'] | null | undefined): DashboardAccess {
  if (role === 'admin' || role === 'project_manager') return fullAccess;
  if (role === 'area_engineer') {
    return {
      ...noAccess,
      plans: true,
      staffing: true,
      actions: true,
      workforce: true,
      rewardsShortcut: true,
    };
  }
  if (role === 'report_follower') {
    return { ...noAccess, plans: true, reportFollowerView: true };
  }
  if (role === 'supervisor' || role === 'viewer') {
    return { ...noAccess, plans: true };
  }
  return noAccess;
}

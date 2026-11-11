import { describe, expect, it } from 'vitest';
import { dashboardAccessForRole } from './dashboardAccess';

describe('dashboard role visibility', () => {
  it('grants full dashboard cards only to administrators and project managers', () => {
    for (const role of ['admin', 'project_manager'] as const) {
      expect(dashboardAccessForRole(role)).toEqual({
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
      });
    }
  });

  it('limits area engineers to plans, placement and rewards surfaces', () => {
    expect(dashboardAccessForRole('area_engineer')).toMatchObject({
      plans: true, staffing: true, actions: true, workforce: true, rewardsShortcut: true,
      syncTime: false, kpi: false, deliverables: false, activity: false,
    });
  });

  it('shows report followers only their bulk-update and late-plan view', () => {
    expect(dashboardAccessForRole('report_follower')).toMatchObject({
      plans: true, reportFollowerView: true,
      staffing: false, actions: false, workforce: false, kpi: false, deliverables: false, activity: false,
    });
  });

  it('keeps supervisors and viewers on read-only plan cards and unknown roles data-free', () => {
    for (const role of ['supervisor', 'viewer'] as const) {
      expect(dashboardAccessForRole(role)).toMatchObject({ plans: true, staffing: false, actions: false, kpi: false });
    }
    expect(dashboardAccessForRole(null).plans).toBe(false);
  });
});

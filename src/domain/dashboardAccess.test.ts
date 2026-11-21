import { describe, expect, it } from 'vitest';
import { dashboardAccessForPermissions } from './dashboardAccess';
import type { PermissionKey } from './permissions';

const fullAccess = new Set<PermissionKey>([
  'plans.view', 'plans.create_delete', 'workforce.assign_cleaners', 'settings.view',
  'kpi.edit', 'deliverables.edit',
]);

describe('dashboard permission visibility', () => {
  it('preserves the administrator and project-manager dashboard cards', () => {
    expect(dashboardAccessForPermissions(new Set([...fullAccess, 'audit.view']))).toEqual({
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
    expect(dashboardAccessForPermissions(fullAccess)).toEqual(dashboardAccessForPermissions(
      new Set([...fullAccess, 'plans.edit_rows']),
    ));
  });

  it('limits area engineers to the existing plan, placement and rewards surfaces', () => {
    expect(dashboardAccessForPermissions(new Set([
      'plans.view', 'plans.create_delete', 'workforce.assign_cleaners', 'rewards.distribute',
    ]))).toEqual({
      plans: true,
      staffing: true,
      syncTime: false,
      actions: true,
      workforce: true,
      rewardsShortcut: true,
      kpi: false,
      deliverables: false,
      activity: false,
      reportFollowerView: false,
    });
  });

  it('shows report followers only their late-plan view', () => {
    expect(dashboardAccessForPermissions(new Set([
      'plans.view', 'plans.record_visit_report',
    ]))).toMatchObject({
      plans: true,
      reportFollowerView: true,
      staffing: false,
      actions: false,
      workforce: false,
      kpi: false,
      deliverables: false,
      activity: false,
    });
  });

  it('keeps supervisors and viewers on read-only plan cards and unknown permissions data-free', () => {
    expect(dashboardAccessForPermissions(new Set(['plans.view']))).toMatchObject({
      plans: true, staffing: false, actions: false, kpi: false,
    });
    expect(dashboardAccessForPermissions(new Set()).plans).toBe(false);
  });
});

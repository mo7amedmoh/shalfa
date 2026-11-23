import { describe, expect, it } from 'vitest';
import { dashboardAccessForPermissions } from './dashboardAccess';
import {
  defaultDashboardCardSettings,
  isDashboardCardVisible,
  normalizeDashboardCardSettings,
  type DashboardCardSettings,
} from './dashboardCards';
import type { PermissionKey } from './permissions';

describe('dashboard card customization', () => {
  it('defaults to all cards and removes unknown or duplicate hidden ids', () => {
    expect(normalizeDashboardCardSettings({ hiddenIds: ['plan-summary', 'plan-summary', 'unknown'] }))
      .toEqual({ hiddenIds: ['plan-summary'] });
    expect(defaultDashboardCardSettings).toEqual({ hiddenIds: [] });
  });

  it('rejects malformed saved settings', () => {
    expect(() => normalizeDashboardCardSettings({ hiddenIds: 'plan-summary' })).toThrow();
  });

  it('never shows a selected card when the current user lacks its permission', () => {
    const permissions = new Set<PermissionKey>(['plans.view']);
    const access = dashboardAccessForPermissions(permissions);
    expect(isDashboardCardVisible('plan-summary', defaultDashboardCardSettings, access, permissions)).toBe(true);
    expect(isDashboardCardVisible('inventory-shortage', defaultDashboardCardSettings, access, permissions)).toBe(false);
    expect(isDashboardCardVisible('recent-activity', defaultDashboardCardSettings, access, permissions)).toBe(false);
  });

  it('hides selected cards without changing permission checks for other cards', () => {
    const permissions = new Set<PermissionKey>(['plans.view', 'plans.create_delete']);
    const access = dashboardAccessForPermissions(permissions);
    const settings: DashboardCardSettings = { hiddenIds: ['action-late-visits'] };
    expect(isDashboardCardVisible('action-late-visits', settings, access, permissions)).toBe(false);
    expect(isDashboardCardVisible('plan-summary', settings, access, permissions)).toBe(true);
  });
});

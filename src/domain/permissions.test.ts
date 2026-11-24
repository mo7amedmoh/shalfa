import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PermissionProvider } from '../app/PermissionProvider';
import { usePermission } from '../app/permissionContext';
import { filterNavigation, navigation } from '../app/navigation';
import { parsePermissionKeys, permissionKeys, type PermissionKey } from './permissions';

function KnownPermissionProbe() {
  return createElement('output', null, String(usePermission('schools.view')));
}

function AdminPermissionProbe() {
  return createElement('output', null, [
    usePermission('workforce.view_contacts'),
    usePermission('workforce.view_id_image'),
    usePermission('inventory.issue'),
  ].join(','));
}

type Role = 'admin' | 'project_manager' | 'area_engineer' | 'report_follower' | 'supervisor' | 'viewer';

const roles: Role[] = ['admin', 'project_manager', 'area_engineer', 'report_follower', 'supervisor', 'viewer'];
const commonPermissions: PermissionKey[] = [
  'dashboard.view', 'schools.view', 'schools.export_csv', 'plans.view', 'workforce.view',
  'placement.cleaners.view', 'placement.gatekeepers.view', 'kpi.view', 'deliverables.view', 'rewards.view',
];
const rolePermissions: Record<Role, ReadonlySet<PermissionKey>> = {
  admin: new Set(permissionKeys),
  project_manager: new Set([
    ...commonPermissions,
    'schools.edit', 'schools.correct_size', 'plans.create_delete', 'plans.edit_rows',
    'plans.write_row_fields',
    'plans.record_visit_report', 'plans.bulk_update_general', 'plans.import', 'plans.redistribute_remaining',
    'plans.manage_types', 'workforce.assign_cleaners', 'gatekeepers.manage', 'gatekeepers.backfill',
    'gatekeepers.export_residence', 'residence.reveal', 'staffing.rules.view', 'staffing.exceptions.manage',
    'attendance.view', 'attendance.manage', 'attendance.import', 'attendance.export',
    'kpi.edit', 'kpi.approve', 'deliverables.edit', 'reports.tools', 'tools.ticket_analysis', 'settings.view',
    'inventory.view', 'inventory.manage_items', 'inventory.receive_stock', 'inventory.adjust', 'inventory.export_order',
  ]),
  area_engineer: new Set([
    ...commonPermissions, 'plans.create_delete', 'plans.record_visit_report', 'plans.bulk_update_general',
    'plans.import', 'plans.write_row_fields', 'workforce.assign_cleaners', 'gatekeepers.manage', 'residence.reveal',
    'rewards.distribute', 'reports.tools', 'inventory.view', 'inventory.approve', 'inventory.export_order',
  ]),
  report_follower: new Set([...commonPermissions, 'plans.record_visit_report', 'reports.tools']),
  supervisor: new Set([...commonPermissions, 'inventory.view', 'inventory.request']),
  viewer: new Set(commonPermissions),
};

type Surface = {
  id: string;
  legacyRoles: Role[];
  requires?: PermissionKey[];
  anyOf?: PermissionKey[];
  excludes?: PermissionKey[];
};

const surfaces: Surface[] = [
  { id: 'menu/dashboard', legacyRoles: roles, requires: ['dashboard.view'] },
  { id: 'menu/monthly-plans', legacyRoles: roles, requires: ['plans.view'] },
  { id: 'menu/general-plans', legacyRoles: roles, requires: ['plans.view'] },
  { id: 'menu/schools', legacyRoles: roles, requires: ['schools.view'] },
  { id: 'menu/workforce', legacyRoles: roles, requires: ['workforce.view'] },
  { id: 'menu/cleaner-placement', legacyRoles: roles, requires: ['placement.cleaners.view'] },
  { id: 'menu/attendance', legacyRoles: ['admin', 'project_manager'], requires: ['attendance.view'] },
  { id: 'menu/gatekeeper-placement', legacyRoles: roles, requires: ['placement.gatekeepers.view'] },
  { id: 'menu/rewards', legacyRoles: roles, requires: ['rewards.view'] },
  { id: 'menu/scorecards', legacyRoles: roles, requires: ['kpi.view'] },
  { id: 'menu/deliverables', legacyRoles: roles, requires: ['deliverables.view'] },
  { id: 'menu/settings', legacyRoles: ['admin', 'project_manager'], requires: ['settings.view'] },
  { id: 'menu/audit', legacyRoles: ['admin'], requires: ['audit.view'] },
  { id: 'menu/inventory-items', legacyRoles: ['admin', 'project_manager', 'area_engineer', 'supervisor'], requires: ['inventory.view'] },
  { id: 'menu/inventory-requests', legacyRoles: ['admin', 'supervisor'], requires: ['inventory.request'] },
  { id: 'menu/inventory-review', legacyRoles: ['admin', 'area_engineer'], requires: ['inventory.approve'] },
  { id: 'menu/inventory-stamp', legacyRoles: ['admin', 'area_engineer'], requires: ['inventory.approve'] },
  { id: 'menu/inventory-issue', legacyRoles: ['admin'], requires: ['inventory.issue'] },
  {
    id: 'menu/inventory-group',
    legacyRoles: ['admin', 'project_manager', 'area_engineer', 'supervisor'],
    anyOf: ['inventory.view', 'inventory.request', 'inventory.approve', 'inventory.issue'],
  },
  { id: 'menu/report-tools', legacyRoles: ['admin', 'project_manager', 'area_engineer', 'report_follower'], requires: ['reports.tools'] },
  { id: 'menu/ticket-analysis', legacyRoles: ['admin', 'project_manager'], requires: ['tools.ticket_analysis'] },
  { id: 'menu/custom-plan-types', legacyRoles: ['admin', 'project_manager'], requires: ['plans.manage_types'] },
  { id: 'route/dashboard', legacyRoles: roles, requires: ['dashboard.view'] },
  { id: 'route/monthly-plans', legacyRoles: roles, requires: ['plans.view'] },
  { id: 'route/general-plans', legacyRoles: roles, requires: ['plans.view'] },
  { id: 'route/schools', legacyRoles: roles, requires: ['schools.view'] },
  { id: 'route/workforce', legacyRoles: roles, requires: ['workforce.view'] },
  { id: 'route/cleaner-placement', legacyRoles: roles, requires: ['placement.cleaners.view'] },
  { id: 'route/attendance', legacyRoles: ['admin', 'project_manager'], requires: ['attendance.view'] },
  { id: 'route/gatekeeper-placement', legacyRoles: roles, requires: ['placement.gatekeepers.view'] },
  { id: 'route/rewards', legacyRoles: roles, requires: ['rewards.view'] },
  { id: 'route/kpi', legacyRoles: roles, requires: ['kpi.view'] },
  { id: 'route/account', legacyRoles: roles, requires: ['dashboard.view'] },
  { id: 'route/report-tools', legacyRoles: ['admin', 'project_manager', 'area_engineer', 'report_follower'], requires: ['reports.tools'] },
  { id: 'route/ticket-analysis', legacyRoles: ['admin', 'project_manager'], requires: ['tools.ticket_analysis'] },
  { id: 'route/settings', legacyRoles: ['admin', 'project_manager'], requires: ['settings.view'] },
  { id: 'route/plan-management', legacyRoles: ['admin', 'project_manager'], requires: ['plans.manage_types'] },
  { id: 'route/users', legacyRoles: ['admin'], requires: ['users.manage'] },
  { id: 'route/audit', legacyRoles: ['admin'], requires: ['audit.view'] },
  { id: 'route/inventory', legacyRoles: ['admin', 'project_manager', 'area_engineer', 'supervisor'], requires: ['inventory.view'] },
  { id: 'route/inventory-requests', legacyRoles: ['admin', 'supervisor'], requires: ['inventory.request'] },
  { id: 'route/school-cleanup', legacyRoles: ['admin'], requires: ['schools.cleanup'] },
  { id: 'route/staffing-rules', legacyRoles: ['admin', 'project_manager'], requires: ['staffing.rules.view'] },
  { id: 'settings-card/sync', legacyRoles: ['admin', 'project_manager'], requires: ['settings.view'] },
  { id: 'settings-card/eligibility', legacyRoles: ['admin', 'project_manager'], requires: ['settings.view', 'plans.manage_types'] },
  { id: 'settings-card/staffing-rules', legacyRoles: ['admin', 'project_manager'], requires: ['settings.view', 'staffing.rules.view'] },
  { id: 'settings-card/plan-management', legacyRoles: ['admin', 'project_manager'], requires: ['settings.view', 'plans.manage_types'] },
  { id: 'settings-card/name-linking', legacyRoles: ['admin', 'project_manager'], requires: ['settings.view'] },
  { id: 'settings-card/schema-check', legacyRoles: ['admin', 'project_manager'], requires: ['settings.view'] },
  { id: 'settings-card/school-cleanup', legacyRoles: ['admin'], requires: ['settings.view', 'schools.cleanup'] },
  { id: 'settings-card/report-defaults', legacyRoles: ['admin', 'project_manager'], requires: ['settings.view', 'plans.view'] },
  { id: 'settings-card/users', legacyRoles: ['admin'], requires: ['settings.view', 'users.manage'] },
  { id: 'dashboard/plans', legacyRoles: roles, requires: ['plans.view'] },
  { id: 'dashboard/staffing', legacyRoles: ['admin', 'project_manager', 'area_engineer'], requires: ['workforce.assign_cleaners'] },
  { id: 'dashboard/sync-time', legacyRoles: ['admin', 'project_manager'], requires: ['settings.view'] },
  { id: 'dashboard/actions', legacyRoles: ['admin', 'project_manager', 'area_engineer'], requires: ['plans.create_delete'] },
  { id: 'dashboard/workforce', legacyRoles: ['admin', 'project_manager', 'area_engineer'], requires: ['workforce.assign_cleaners'] },
  { id: 'dashboard/rewards-shortcut', legacyRoles: ['area_engineer'], requires: ['rewards.distribute'], excludes: ['audit.view'] },
  { id: 'dashboard/kpi', legacyRoles: ['admin', 'project_manager'], requires: ['kpi.edit'] },
  { id: 'dashboard/deliverables', legacyRoles: ['admin', 'project_manager'], requires: ['deliverables.edit'] },
  { id: 'dashboard/activity', legacyRoles: ['admin', 'project_manager'], requires: ['settings.view'] },
  { id: 'dashboard/inventory-shortages', legacyRoles: ['admin', 'project_manager', 'area_engineer', 'supervisor'], requires: ['inventory.view'] },
  { id: 'dashboard/report-follower', legacyRoles: ['report_follower'], requires: ['plans.record_visit_report'], excludes: ['plans.create_delete', 'plans.edit_rows'] },
  { id: 'action/school-edit', legacyRoles: ['admin', 'project_manager'], requires: ['schools.edit'] },
  { id: 'action/school-sync', legacyRoles: ['admin'], requires: ['schools.sync'] },
  { id: 'action/school-export-csv', legacyRoles: roles, requires: ['schools.export_csv'] },
  { id: 'action/monthly-plan-create-delete', legacyRoles: ['admin', 'project_manager', 'area_engineer'], requires: ['plans.create_delete'] },
  { id: 'action/monthly-plan-row-edit', legacyRoles: ['admin', 'project_manager'], requires: ['plans.edit_rows'] },
  { id: 'action/monthly-plan-visit-report', legacyRoles: ['admin', 'project_manager', 'area_engineer', 'report_follower'], requires: ['plans.record_visit_report'] },
  { id: 'action/monthly-plan-redistribute', legacyRoles: ['admin', 'project_manager'], requires: ['plans.redistribute_remaining'] },
  { id: 'action/general-plan-manage', legacyRoles: ['admin', 'project_manager', 'area_engineer'], requires: ['plans.create_delete'] },
  { id: 'action/general-plan-bulk-update', legacyRoles: ['admin', 'project_manager', 'area_engineer'], requires: ['plans.bulk_update_general'] },
  { id: 'action/plan-import', legacyRoles: ['admin', 'project_manager', 'area_engineer'], requires: ['plans.import'] },
  { id: 'action/cleaner-assignment', legacyRoles: ['admin', 'project_manager', 'area_engineer'], requires: ['workforce.assign_cleaners'] },
  { id: 'action/gatekeeper-manage', legacyRoles: ['admin', 'project_manager', 'area_engineer'], requires: ['gatekeepers.manage'] },
  { id: 'action/gatekeeper-backfill', legacyRoles: ['admin', 'project_manager'], requires: ['gatekeepers.backfill'] },
  { id: 'action/gatekeeper-export-residence', legacyRoles: ['admin', 'project_manager'], requires: ['gatekeepers.export_residence'] },
  { id: 'action/workforce-reveal-residence', legacyRoles: ['admin', 'project_manager', 'area_engineer'], requires: ['residence.reveal'] },
  { id: 'action/cleaner-placement-reveal-residence', legacyRoles: ['admin', 'project_manager'], requires: ['residence.reveal', 'staffing.exceptions.manage'] },
  { id: 'action/staffing-exceptions', legacyRoles: ['admin', 'project_manager'], requires: ['staffing.exceptions.manage'] },
  { id: 'action/staffing-rules-edit', legacyRoles: ['admin'], requires: ['staffing.rules.edit'] },
  { id: 'action/attendance-manage', legacyRoles: ['admin', 'project_manager'], requires: ['attendance.manage'] },
  { id: 'action/attendance-import', legacyRoles: ['admin', 'project_manager'], requires: ['attendance.import'] },
  { id: 'action/attendance-export', legacyRoles: ['admin', 'project_manager'], requires: ['attendance.export'] },
  { id: 'action/kpi-edit', legacyRoles: ['admin', 'project_manager'], requires: ['kpi.edit'] },
  { id: 'action/kpi-approve', legacyRoles: ['admin', 'project_manager'], requires: ['kpi.approve'] },
  { id: 'action/deliverables-edit', legacyRoles: ['admin', 'project_manager'], requires: ['deliverables.edit'] },
  { id: 'action/reward-pool-manage', legacyRoles: ['admin', 'project_manager'], requires: ['settings.view', 'rewards.view'] },
  { id: 'action/reward-distribute', legacyRoles: ['area_engineer'], requires: ['rewards.distribute'], excludes: ['audit.view'] },
  { id: 'action/user-create', legacyRoles: ['admin'], requires: ['users.create'] },
  { id: 'action/user-role-assignment', legacyRoles: ['admin'], requires: ['users.assign_roles'] },
];

describe('permission catalog and legacy role visibility', () => {
  it('ignores unknown database keys while retaining known permissions', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(parsePermissionKeys(['inventory.view', 'future.permission', 'schools.view'])).toEqual([
        'inventory.view',
        'schools.view',
      ]);
      expect(warn).toHaveBeenCalledWith(
        'تم تجاهل مفتاح صلاحية غير موجود في الكتالوج المحلي: future.permission',
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('keeps known permissions available through the provider with unknown runtime keys', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const markup = renderToStaticMarkup(createElement(
        PermissionProvider,
        {
          permissions: ['schools.view', 'future.permission'],
          children: createElement(KnownPermissionProbe),
        },
      ));

      expect(markup).toContain('true');
      expect(warn).toHaveBeenCalledWith(
        'تم تجاهل مفتاح صلاحية غير موجود في الكتالوج المحلي: future.permission',
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('grants the catalog permissions to system administrators in the UI when the database omits them', () => {
    const markup = renderToStaticMarkup(createElement(
      PermissionProvider,
      {
        permissions: [],
        isSystemAdmin: true,
        children: createElement(AdminPermissionProbe),
      },
    ));

    expect(markup).toContain('true,true,true');
  });

  it('explains invalid permission response shapes', () => {
    expect(() => parsePermissionKeys({ permission: 'schools.view' })).toThrow(
      'استجابة الصلاحيات غير صالحة: المتوقع مصفوفة نصوص، والمستلم object.',
    );
    expect(() => parsePermissionKeys(['schools.view', 42])).toThrow(
      'استجابة الصلاحيات غير صالحة: العنصر عند الفهرس 1 ليس نصًا.',
    );
  });

  it('uses exactly the permission keys defined by the RBAC migrations', () => {
    const migrations = [
      '202611220001_rbac.sql',
      '202611220006_permission_enforcement_batch1.sql',
      '202611230001_inventory.sql',
      '202611240001_school_supervisor_assignments.sql',
    ].map((file) => readFileSync(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8'));
    const migrationKeys = migrations.flatMap((migration) => {
      const catalogInsert = migration.match(/insert into public\.permissions[\s\S]*?values([\s\S]*?);/);
      return catalogInsert
        ? [...catalogInsert[1].matchAll(/\(\s*'([^']+)'/g)].map((match) => match[1])
        : [];
    }).sort();
    expect([...permissionKeys].sort()).toEqual(migrationKeys);
  });

  it('filters the inventory sidebar group and each link by permission for every role', () => {
    const inventoryLinks: Array<{ label: string; path: string; permission: PermissionKey }> = [
      { label: 'الأصناف والأرصدة', path: '/inventory', permission: 'inventory.view' },
      { label: 'طلبات قطع الغيار', path: '/inventory/requests', permission: 'inventory.request' },
      { label: 'طلبات للمراجعة', path: '/inventory/review', permission: 'inventory.approve' },
      { label: 'صرف الطلبات', path: '/inventory/issue', permission: 'inventory.issue' },
      { label: 'ختمي وتوقيعي', path: '/inventory/stamp', permission: 'inventory.approve' },
    ];
    expect(navigation.find((item) => item.label === 'المخزون')?.children).toEqual(inventoryLinks);

    for (const role of roles) {
      const grants = rolePermissions[role];
      const filtered = filterNavigation(navigation, grants);
      const inventoryGroup = filtered.find((item) => item.label === 'المخزون');
      const expectedLinks = inventoryLinks.filter((link) => grants.has(link.permission));
      expect(inventoryGroup?.children ?? [], `${role} inventory links`).toEqual(expectedLinks);
      expect(Boolean(inventoryGroup), `${role} inventory group`).toBe(expectedLinks.length > 0);

      const administrativeGroup = filtered.find((item) => item.label === 'أعمال إدارية');
      expect(administrativeGroup?.children?.some((link) => link.path.startsWith('/inventory/'))).toBe(false);
    }
  });

  it('keeps the same menus, routes, settings cards, dashboard cards and action buttons for every role', () => {
    for (const surface of surfaces) {
      const actualRoles = roles.filter((role) => {
        const grants = rolePermissions[role];
        const required = surface.anyOf
          ? surface.anyOf.some((permission) => grants.has(permission))
          : (surface.requires ?? []).every((permission) => grants.has(permission));
        return required
          && (surface.excludes ?? []).every((permission) => !grants.has(permission));
      });
      expect(actualRoles, surface.id).toEqual(surface.legacyRoles);
    }
  });
});

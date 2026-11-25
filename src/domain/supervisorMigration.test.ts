import { describe, expect, it } from 'vitest';
import { normalizeImportName } from './imports';
import { isKnownGatekeeperName, resolveSupervisorMigrationName } from './supervisorMigration';

describe('supervisor migration name matching', () => {
  const employees = [
    { id: 'one', full_name: 'مشرف الصيانة' },
    { id: 'two', full_name: 'مشرف النظافة' },
  ];

  it('detects gatekeeper names using the same normalization as plan name matching', () => {
    expect(isKnownGatekeeperName(' حَارِس المدرسة ', ['حارس المدرسة'])).toBe(true);
    expect(isKnownGatekeeperName('حارس مدرسة أخرى', ['حارس المدرسة'])).toBe(false);
  });

  it('uses the plan generator resolution order: saved alias, then exact employee name', () => {
    const aliases = [{ alias_normalised: normalizeImportName('الاسم البديل'), employee_id: 'one' }];

    expect(resolveSupervisorMigrationName('الاسم البديل', employees, aliases))
      .toEqual({ status: 'alias', employee: employees[0] });
    expect(resolveSupervisorMigrationName(' مشرف النظافة ', employees, aliases))
      .toEqual({ status: 'employee', employee: employees[1] });
  });

  it('reports unresolved, ambiguous, and invalid alias targets without choosing arbitrarily', () => {
    expect(resolveSupervisorMigrationName('اسم غير معروف', employees, []))
      .toEqual({ status: 'unmatched', employee: null });
    expect(resolveSupervisorMigrationName('اسم مكرر', [
      ...employees,
      { id: 'three', full_name: 'اسم مكرر' },
      { id: 'four', full_name: ' اسم  مكرر ' },
    ], [])).toEqual({ status: 'ambiguous', employee: null });
    expect(resolveSupervisorMigrationName('اسم بديل', employees, [
      { alias_normalised: normalizeImportName('اسم بديل'), employee_id: 'missing' },
    ])).toEqual({ status: 'unmatched', employee: null });
  });
});

import { normalizeImportName, resolvePlanPerson } from './imports';

export type SupervisorMigrationStatus = 'employee' | 'alias' | 'unmatched' | 'ambiguous';
export type SupervisorMigrationEmployee = { id: string; full_name: string };
export type SupervisorMigrationAlias = { alias_normalised: string; employee_id: string };

export function isKnownGatekeeperName(name: string, gatekeeperNames: readonly string[]): boolean {
  const normalized = normalizeImportName(name);
  return Boolean(normalized && gatekeeperNames.some((gatekeeperName) =>
    normalizeImportName(gatekeeperName) === normalized));
}

export function resolveSupervisorMigrationName(
  name: string,
  employees: readonly SupervisorMigrationEmployee[],
  aliases: readonly SupervisorMigrationAlias[],
): { status: SupervisorMigrationStatus; employee: SupervisorMigrationEmployee | null } {
  const resolution = resolvePlanPerson(name, employees, aliases);
  if (resolution.source === 'alias' && resolution.employee) {
    return { status: 'alias', employee: resolution.employee };
  }

  const normalized = normalizeImportName(name);
  const exactMatches = employees.filter((employee) => normalizeImportName(employee.full_name) === normalized);
  if (exactMatches.length === 1) return { status: 'employee', employee: exactMatches[0] };
  return {
    status: exactMatches.length > 1 ? 'ambiguous' : 'unmatched',
    employee: null,
  };
}

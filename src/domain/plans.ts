import { normalizeImportName, normalizeMinistryNumber } from './imports';
import { isKnownGatekeeperName } from './supervisorMigration';
import { resolvePlanSupervisor, type CurrentSchoolSupervisors } from './schoolSupervisors';

export interface PlannedVisit {
  schoolId: string;
  plannedDate: string;
}

export interface PlanDistributionOptions {
  startDate: string;
  schoolsPerDay: number;
  skipFridayAndSaturday?: boolean;
}

export interface PlanProgress {
  plannedDate: string;
  visitedAt: string | null;
  reportCompletedAt: string | null;
}

export interface CleaningSupervisorPlanRow {
  id: string;
  supervisorId?: string | null;
  supervisorName: string | null;
  schoolSourceFields: Record<string, unknown> | null;
  currentSupervisor?: CurrentSchoolSupervisors | null;
  useSheetFallback?: boolean;
}

export function monthlySupervisorName(
  row: CleaningSupervisorPlanRow,
  planType: string,
  excludedSupervisorNames: readonly string[] = [],
  useSheetFallback = true,
  excludedSupervisorIds: readonly string[] = [],
): string | null {
  const resolved = resolvePlanSupervisor({
    planType,
    supervisorId: row.supervisorId ?? null,
    supervisorName: row.supervisorName,
    current: row.currentSupervisor,
    schoolSourceFields: row.schoolSourceFields,
    useSheetFallback: row.useSheetFallback ?? useSheetFallback,
  });
  if (resolved.supervisorId) {
    return excludedSupervisorIds.includes(resolved.supervisorId) ? null : resolved.supervisorName;
  }
  return isKnownGatekeeperName(resolved.supervisorName ?? '', excludedSupervisorNames) ? null : resolved.supervisorName;
}

export function cleaningSupervisorName(row: CleaningSupervisorPlanRow): string | null {
  return resolvePlanSupervisor({
    planType: 'cleaning',
    supervisorId: row.supervisorId ?? null,
    supervisorName: row.supervisorName,
    current: row.currentSupervisor,
    schoolSourceFields: row.schoolSourceFields,
    useSheetFallback: row.useSheetFallback,
  }).supervisorName;
}

export function cleaningSupervisorUpdates(
  rows: readonly CleaningSupervisorPlanRow[],
): Array<{ id: string; supervisorId: string | null; supervisorName: string }> {
  return rows.flatMap((row) => {
    const resolved = resolvePlanSupervisor({
      planType: 'cleaning',
      supervisorId: row.supervisorId ?? null,
      supervisorName: row.supervisorName,
      current: row.currentSupervisor,
      schoolSourceFields: row.schoolSourceFields,
      useSheetFallback: row.useSheetFallback,
    });
    return (resolved.supervisorId !== (row.supervisorId ?? null) || resolved.supervisorName !== row.supervisorName?.trim())
      ? [{ id: row.id, supervisorId: resolved.supervisorId, supervisorName: resolved.supervisorName ?? '' }]
      : [];
  });
}

export type PlanCompletionFilter = 'all' | 'completed' | 'incomplete';
export interface PlanCompletionState {
  visitedAt: string | null;
  reportCompletedAt: string | null;
}

export interface PlanSchoolSearchFields {
  schoolName: string | null;
  ministryNumber: string | null;
  ministryKey?: string | null;
}

export function matchPlanSchoolsByMinistryNumbers(
  pastedNumbers: string,
  schools: readonly { id: string; ministryNumber: string }[],
): { schoolIds: string[]; unmatchedNumbers: string[]; inputCount: number } {
  const requestedNumbers = new Map<string, string>();
  for (const value of pastedNumbers.split(/[\s,،;؛|]+/u)) {
    const number = normalizeMinistryNumber(value);
    if (number && !requestedNumbers.has(number)) requestedNumbers.set(number, value.trim());
  }

  const matchedNumbers = new Set<string>();
  const schoolIds = schools.flatMap((school) => {
    const number = normalizeMinistryNumber(school.ministryNumber);
    if (!number || !requestedNumbers.has(number)) return [];
    matchedNumbers.add(number);
    return [school.id];
  });

  return {
    schoolIds,
    unmatchedNumbers: [...requestedNumbers]
      .filter(([number]) => !matchedNumbers.has(number))
      .map(([, original]) => original),
    inputCount: requestedNumbers.size,
  };
}

export function matchesPlanSchoolSearch(
  row: PlanSchoolSearchFields,
  search: string,
): boolean {
  const query = search.trim();
  if (!query) return true;

  const normalizedName = normalizeImportName(query);
  if (normalizeImportName(row.schoolName).includes(normalizedName)) return true;

  const normalizedNumber = normalizeMinistryNumber(query);
  if (!normalizedNumber) return false;
  const rowNumber = normalizeMinistryNumber(row.ministryKey || row.ministryNumber);
  return rowNumber.includes(normalizedNumber);
}

export function matchesPlanCompletionFilters(
  row: PlanCompletionState,
  visitFilter: PlanCompletionFilter,
  reportFilter: PlanCompletionFilter,
): boolean {
  return (visitFilter === 'all' || Boolean(row.visitedAt) === (visitFilter === 'completed'))
    && (reportFilter === 'all' || Boolean(row.reportCompletedAt) === (reportFilter === 'completed'));
}

export function isPlanRowOverdue(row: PlanProgress, today: string): boolean {
  return row.plannedDate < today && (!row.visitedAt || !row.reportCompletedAt);
}

function parseDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new RangeError('Start date must be a valid ISO calendar date.');
  }
  return date;
}

export function distributePlanDates(
  schoolIds: readonly string[],
  options: PlanDistributionOptions,
): PlannedVisit[] {
  if (!Number.isInteger(options.schoolsPerDay) || options.schoolsPerDay <= 0) {
    throw new RangeError('Schools per day must be a positive integer.');
  }
  const seen = new Set<string>();
  for (const id of schoolIds) {
    if (!id.trim() || seen.has(id)) throw new RangeError('School identifiers must be unique and non-empty.');
    seen.add(id);
  }

  const date = parseDate(options.startDate);
  let assignedToday = 0;
  const result: PlannedVisit[] = [];

  for (const schoolId of schoolIds) {
    while (
      options.skipFridayAndSaturday !== false &&
      (date.getUTCDay() === 5 || date.getUTCDay() === 6)
    ) {
      date.setUTCDate(date.getUTCDate() + 1);
      assignedToday = 0;
    }
    if (assignedToday >= options.schoolsPerDay) {
      date.setUTCDate(date.getUTCDate() + 1);
      assignedToday = 0;
      while (
        options.skipFridayAndSaturday !== false &&
        (date.getUTCDay() === 5 || date.getUTCDay() === 6)
      ) {
        date.setUTCDate(date.getUTCDate() + 1);
      }
    }
    result.push({ schoolId, plannedDate: date.toISOString().slice(0, 10) });
    assignedToday += 1;
  }
  return result;
}

import { normalizeImportName, normalizeMinistryNumber } from './imports';

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

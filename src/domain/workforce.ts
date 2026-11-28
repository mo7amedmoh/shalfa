import { z } from 'zod';

export const employeeCategorySchema = z.enum([
  'engineer',
  'supervisor',
  'admin_staff',
  'technician',
  'driver',
  'cleaner',
  'gatekeeper',
]);

export type ResidenceWorksite = {
  id: string;
  name: string;
};

export function isSchoolGatekeeperJobTitle(jobTitle: string | null): boolean {
  const normalizedTitle = (jobTitle ?? '')
    .normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .trim();
  return /(حارس|بواب)/.test(normalizedTitle);
}

export function isSupervisorEligibleEmployee(employee: {
  category: string | null;
  jobTitle: string | null;
}): boolean {
  return employee.category === 'supervisor' && !isSchoolGatekeeperJobTitle(employee.jobTitle);
}

/**
 * Returns the effective display category for an employee, treating a supervisor-categorized
 * employee whose job title is a school gatekeeper/doorman as a gatekeeper.
 */
export function effectiveEmployeeCategory(employee: {
  category: string;
  jobTitle: string | null;
}): string {
  if (employee.category === 'supervisor' && isSchoolGatekeeperJobTitle(employee.jobTitle)) {
    return 'gatekeeper';
  }
  return employee.category;
}

/**
 * Matches a workforce category filter while excluding school gatekeepers from the supervisor filter.
 */
export function matchesWorkforceCategoryFilter(
  employee: { category: string; jobTitle: string | null },
  categoryFilter: string,
): boolean {
  if (!categoryFilter) return true;
  if (categoryFilter === 'supervisor') {
    return isSupervisorEligibleEmployee(employee);
  }
  if (categoryFilter === 'gatekeeper') {
    return effectiveEmployeeCategory(employee) === 'gatekeeper';
  }
  return employee.category === categoryFilter;
}

export type ResidenceEmployee = {
  id: string;
  fullName: string;
  employeeNumber: string | null;
  residenceNumber: string | null;
  schools: ResidenceWorksite[];
};

export type ResidenceQualityIssue = ResidenceEmployee & {
  issue: 'missing' | 'passport-like' | 'invalid-length';
};

export type SharedResidenceNumber = {
  residenceNumber: string;
  employees: ResidenceEmployee[];
};

function normalizeResidenceNumber(value: string): string {
  return value.trim()
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .toLocaleUpperCase();
}

export function analyzeResidenceNumbers(records: readonly ResidenceEmployee[]): {
  issues: ResidenceQualityIssue[];
  shared: SharedResidenceNumber[];
} {
  const grouped = new Map<string, ResidenceEmployee[]>();
  const issues: ResidenceQualityIssue[] = [];
  for (const record of records) {
    const residenceNumber = record.residenceNumber?.trim() ?? '';
    if (!residenceNumber) {
      issues.push({ ...record, issue: 'missing' });
      continue;
    }
    const normalized = normalizeResidenceNumber(residenceNumber);
    const entries = grouped.get(normalized) ?? [];
    entries.push(record);
    grouped.set(normalized, entries);
    if (/^\d{10}$/.test(normalized)) continue;
    issues.push({
      ...record,
      issue: /^\d+$/.test(normalized) ? 'invalid-length' : 'passport-like',
    });
  }
  const shared = [...grouped.entries()]
    .filter(([, employees]) => employees.length > 1)
    .map(([residenceNumber, employees]) => ({ residenceNumber, employees }));
  return { issues, shared };
}

import type { PlanType } from './types';
import { calculateStaffing, parseClassCount, type StaffingInput, type StaffingResult } from './staffing';
import { eligibleSchoolIds, type PlanEligibilityConfig, type SchoolSourceRecord } from './planEligibility';

export interface DashboardPlanRow {
  planType: PlanType;
  visitedAt: string | null;
  reportCompletedAt: string | null;
}

export interface DashboardPlanProgress {
  planType: PlanType;
  total: number;
  visited: number;
  reportsCompleted: number;
  visitPercent: number;
  reportPercent: number;
}

export interface DashboardStaffingRow {
  requiredCleaners: number | null;
  assignedCleaners: number;
  shortage: number;
  surplus: number;
}

export interface DashboardSchool extends SchoolSourceRecord {
  assignedCleaners: number;
  declaredSize?: string | null;
  exception?: StaffingInput['exception'];
}

export interface DashboardEligibilityConfig extends PlanEligibilityConfig {
  classCountHeader: string;
  schoolSizeHeader: string;
}

export function summarizeDashboardPlans(rows: readonly DashboardPlanRow[]): DashboardPlanProgress[] {
  const planTypes: readonly PlanType[] = ['maintenance', 'cleaning', 'security_safety', 'elevators'];
  return planTypes.map((planType) => {
    const matchingRows = rows.filter((row) => row.planType === planType);
    const visited = matchingRows.filter((row) => row.visitedAt !== null).length;
    const reportsCompleted = matchingRows.filter((row) => row.reportCompletedAt !== null).length;
    return {
      planType,
      total: matchingRows.length,
      visited,
      reportsCompleted,
      visitPercent: matchingRows.length ? visited / matchingRows.length * 100 : 0,
      reportPercent: matchingRows.length ? reportsCompleted / matchingRows.length * 100 : 0,
    };
  });
}

export function summarizeDashboardVisits(rows: readonly DashboardPlanProgress[]) {
  return rows.reduce((summary, row) => ({
    total: summary.total + row.total,
    visited: summary.visited + row.visited,
    reportsCompleted: summary.reportsCompleted + row.reportsCompleted,
  }), { total: 0, visited: 0, reportsCompleted: 0 });
}

export function staffingRowsForEligibleSchools(
  schools: readonly DashboardSchool[],
  config: DashboardEligibilityConfig,
): StaffingResult[] {
  const eligible = new Set(eligibleSchoolIds(schools, 'maintenance', config));
  return schools.filter((school) => eligible.has(school.id)).map((school) => {
    const classes = parseClassCount(school.sourceFields[config.classCountHeader]);
    return calculateStaffing({
      classes,
      declaredSize: school.declaredSize,
      assignedCleaners: school.assignedCleaners,
      exception: school.exception,
    });
  });
}

export function summarizeDashboardStaffing(rows: readonly DashboardStaffingRow[]) {
  return rows.reduce((summary, row) => ({
    schools: summary.schools + 1,
    required: summary.required + (row.requiredCleaners ?? 0),
    assigned: summary.assigned + row.assignedCleaners,
    shortage: summary.shortage + row.shortage,
    surplus: summary.surplus + row.surplus,
    missingClassCount: summary.missingClassCount + Number(row.requiredCleaners === null),
  }), { schools: 0, required: 0, assigned: 0, shortage: 0, surplus: 0, missingClassCount: 0 });
}

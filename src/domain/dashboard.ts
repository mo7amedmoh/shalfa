import type { PlanType } from './types';
import { isDeliverableDueWithinDays, type DeliverableDueDates, type DeliverableRecord } from './deliverables';
import { normalizeImportName } from './imports';
import { summarizePlanReport, type DashboardVerdict, type ReportPlanMetricRow } from './planReport';
import { calculateStaffing, hasSizeClassDifference, parseClassCount, SCHOOL_SIZES, type SchoolSize, type StaffingInput, type StaffingResult, type StaffingRuleTable } from './staffing';
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
  size?: SchoolSize | null;
  requiredCleaners: number | null;
  assignedCleaners: number;
  shortage: number;
  surplus: number;
}

export interface DashboardSchool extends SchoolSourceRecord {
  assignedCleaners: number;
  schoolName?: string;
  ministryNumber?: string | null;
  declaredSize?: string | null;
  manualSizeOverride?: string | null;
  exception?: StaffingInput['exception'];
}

export interface DashboardCleanerShortageSchool {
  id: string;
  ministryNumber: string;
  name: string;
  required: number;
  assigned: number;
  shortage: number;
}

export interface DashboardEligibilityConfig extends PlanEligibilityConfig {
  classCountHeader: string;
  schoolSizeHeader: string;
  staffingRules?: StaffingRuleTable;
}

export interface DashboardServiceProgress {
  planType: PlanType;
  planned: number;
  visited: number;
  reportsDone: number;
  overallPercent: number;
  expectedPercent: number;
  behind: number;
  reportBehind: number;
  visitStatus: DashboardVerdict['status'];
  reportStatus: DashboardVerdict['status'];
  status: DashboardVerdict['status'];
}

export interface DashboardActionCounts {
  lateVisits: number;
  visitedWithoutReport: number;
  cleanerShortage: number;
  deliverablesDueSoon: number;
  previousKpiNotApproved: number;
}

export interface SupervisorComplianceRow {
  supervisorId: string | null;
  supervisorName: string | null;
  plannedDate: string;
  visited: boolean;
  visitedDate: string | null;
}

export interface SupervisorCompliance {
  id: string;
  name: string;
  planned: number;
  completedOnTime: number;
  percent: number;
}

export function summarizeSupervisorCompliance(
  rows: readonly SupervisorComplianceRow[],
  asOf: string,
): SupervisorCompliance[] {
  const groups = new Map<string, { name: string; planned: number; completedOnTime: number }>();
  for (const row of rows) {
    if (row.plannedDate > asOf) continue;
    const normalizedName = normalizeImportName(row.supervisorName);
    const id = row.supervisorId ?? (normalizedName ? `name:${normalizedName}` : 'name:unassigned');
    const current = groups.get(id) ?? {
      name: row.supervisorName?.trim() || 'مشرف غير محدد',
      planned: 0,
      completedOnTime: 0,
    };
    current.planned += 1;
    if (row.visited) {
      current.completedOnTime += 1;
    }
    groups.set(id, current);
  }
  return [...groups.entries()]
    .map(([id, summary]) => ({
      id,
      ...summary,
      percent: summary.planned ? (summary.completedOnTime / summary.planned) * 100 : 0,
    }))
    .sort((left, right) => right.percent - left.percent || left.name.localeCompare(right.name, 'ar'));
}

export function summarizeDashboardServices(
  rows: readonly ReportPlanMetricRow[],
  month: string,
  asOf: string,
): DashboardServiceProgress[] {
  const planTypes: readonly PlanType[] = ['maintenance', 'cleaning', 'security_safety', 'elevators'];
  return planTypes.map((planType) => {
    const metrics = summarizePlanReport(rows.filter((row) => row.planType === planType), month, asOf);
    const overallPercent = metrics.planned
      ? ((metrics.visited + metrics.reportsDone) / (2 * metrics.planned)) * 100
      : 0;
    const visitPercent = metrics.planned ? (metrics.visited / metrics.planned) * 100 : 0;
    const expectedPercent = metrics.planned ? (metrics.expectedVisits / metrics.planned) * 100 : 0;
    const reportPercent = metrics.planned ? (metrics.reportsDone / metrics.planned) * 100 : 0;
    const getStatus = (actualPercent: number): Exclude<DashboardVerdict['status'], 'no-plan'> =>
      actualPercent - expectedPercent >= -5
        ? 'on-track'
        : actualPercent - expectedPercent >= -15
          ? 'slightly-behind'
          : 'far-behind';
    const statusRank = { 'on-track': 0, 'slightly-behind': 1, 'far-behind': 2 } as const;
    const visitStatus = getStatus(visitPercent);
    const reportStatus = getStatus(reportPercent);
    return {
      planType,
      planned: metrics.planned,
      visited: metrics.visited,
      reportsDone: metrics.reportsDone,
      overallPercent,
      expectedPercent,
      behind: Math.max(0, metrics.expectedVisits - metrics.visited),
      reportBehind: Math.max(0, metrics.expectedVisits - metrics.reportsDone),
      visitStatus: metrics.planned ? visitStatus : 'no-plan',
      reportStatus: metrics.planned ? reportStatus : 'no-plan',
      status: !metrics.planned
        ? 'no-plan'
        : statusRank[visitStatus] >= statusRank[reportStatus] ? visitStatus : reportStatus,
    };
  });
}

export function countDashboardActions(input: {
  rows: readonly ReportPlanMetricRow[];
  month: string;
  asOf: string;
  staffing: readonly DashboardStaffingRow[];
  deliverables: readonly DeliverableRecord[];
  deliverableDates: DeliverableDueDates;
  previousKpiStatus: 'draft' | 'submitted' | 'approved' | null;
}): DashboardActionCounts {
  const metrics = summarizePlanReport(input.rows, input.month, input.asOf);
  return {
    lateVisits: metrics.lateVisits,
    visitedWithoutReport: metrics.inProgress,
    cleanerShortage: input.staffing.reduce((total, row) => total + row.shortage, 0),
    deliverablesDueSoon: input.deliverables.filter((deliverable) =>
      isDeliverableDueWithinDays(deliverable, input.deliverableDates, input.asOf, 14),
    ).length,
    previousKpiNotApproved: Number(input.previousKpiStatus !== 'approved'),
  };
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
      manualSizeOverride: school.manualSizeOverride,
      assignedCleaners: school.assignedCleaners,
      exception: school.exception,
      rules: config.staffingRules,
    });
  });
}

export function eligibleSchoolsMissingClassCount(
  schools: readonly DashboardSchool[],
  config: DashboardEligibilityConfig,
): Array<{ id: string; name: string }> {
  const eligible = new Set(eligibleSchoolIds(schools, 'maintenance', config));
  return schools
    .filter((school) => eligible.has(school.id) && calculateStaffing({
      classes: parseClassCount(school.sourceFields[config.classCountHeader]),
      declaredSize: school.declaredSize,
      manualSizeOverride: school.manualSizeOverride,
      assignedCleaners: school.assignedCleaners,
      exception: school.exception,
      rules: config.staffingRules,
    }).requiredCleaners === null)
    .map((school) => ({ id: school.id, name: school.schoolName?.trim() || school.id }));
}

export function schoolsWithSizeClassDifference(
  schools: readonly DashboardSchool[],
  classCountHeader: string,
): Array<{ id: string; name: string }> {
  return schools.flatMap((school) => {
    const classes = parseClassCount(school.sourceFields[classCountHeader]);
    return hasSizeClassDifference(school.declaredSize, classes)
      ? [{ id: school.id, name: school.schoolName?.trim() || school.id }]
      : [];
  });
}

export function cleanerShortageSchools(
  schools: readonly DashboardSchool[],
  config: DashboardEligibilityConfig,
): DashboardCleanerShortageSchool[] {
  const eligible = new Set(eligibleSchoolIds(schools, 'maintenance', config));
  return schools.flatMap((school) => {
    if (!eligible.has(school.id)) return [];
    const result = calculateStaffing({
      classes: parseClassCount(school.sourceFields[config.classCountHeader]),
      declaredSize: school.declaredSize,
      manualSizeOverride: school.manualSizeOverride,
      assignedCleaners: school.assignedCleaners,
      exception: school.exception,
      rules: config.staffingRules,
    });
    if (!result.shortage || result.requiredCleaners === null) return [];
    return [{
      id: school.id,
      ministryNumber: school.ministryNumber?.trim() ?? '',
      name: school.schoolName?.trim() || school.id,
      required: result.requiredCleaners,
      assigned: result.assignedCleaners,
      shortage: result.shortage,
    }];
  });
}

export function summarizeDashboardStaffing(rows: readonly DashboardStaffingRow[]) {
  return rows.reduce((summary, row) => ({
    schools: summary.schools + 1,
    required: summary.required + (row.requiredCleaners ?? 0),
    assigned: summary.assigned + row.assignedCleaners,
    shortage: summary.shortage + row.shortage,
    surplus: summary.surplus + row.surplus,
    shortageSchools: summary.shortageSchools + Number(row.shortage > 0),
    surplusSchools: summary.surplusSchools + Number(row.surplus > 0),
    missingClassCount: summary.missingClassCount + Number(row.requiredCleaners === null),
  }), { schools: 0, required: 0, assigned: 0, shortage: 0, surplus: 0, shortageSchools: 0, surplusSchools: 0, missingClassCount: 0 });
}

export interface WorkforceSummary {
  gatekeepers: {
    required: number;
    assigned: number;
    shortage: number;
    surplus: number;
    shortageSchools: number;
    surplusSchools: number;
    netBalance: number;
  };
  cleaners: ReturnType<typeof summarizeDashboardStaffing> & {
    bySize: Record<SchoolSize, { required: number; assigned: number; shortage: number; surplus: number }>;
    netBalance: number;
  };
  total: {
    required: number;
    assigned: number;
    shortage: number;
    surplus: number;
    shortageSchools: number | null;
    netBalance: number;
  };
}

export function summarizeWorkforce(
  cleanerRows: readonly (DashboardStaffingRow & { size?: SchoolSize | null })[],
  gatekeeperAssignmentsBySchool: readonly number[],
  totalShortageSchools?: number,
): WorkforceSummary {
  if (gatekeeperAssignmentsBySchool.some((assigned) => !Number.isInteger(assigned) || assigned < 0)) {
    throw new RangeError('Gatekeeper counts must be non-negative integers.');
  }
  if (totalShortageSchools !== undefined
    && (!Number.isSafeInteger(totalShortageSchools) || totalShortageSchools < 0)) {
    throw new RangeError('Total shortage school count must be a non-negative safe integer.');
  }
  const gatekeepersRequired = gatekeeperAssignmentsBySchool.length;
  const gatekeepersAssigned = gatekeeperAssignmentsBySchool.reduce((total, assigned) => total + assigned, 0);
  const cleaners = {
    ...summarizeDashboardStaffing(cleanerRows),
    bySize: SCHOOL_SIZES.reduce((result, size) => {
      result[size] = cleanerRows
        .filter((row) => row.size === size)
        .reduce((summary, row) => ({
          required: summary.required + (row.requiredCleaners ?? 0),
          assigned: summary.assigned + row.assignedCleaners,
          shortage: summary.shortage + row.shortage,
          surplus: summary.surplus + row.surplus,
        }), { required: 0, assigned: 0, shortage: 0, surplus: 0 });
      return result;
    }, {} as Record<SchoolSize, { required: number; assigned: number; shortage: number; surplus: number }>),
  };
  const gatekeepers = {
    required: gatekeepersRequired,
    assigned: gatekeepersAssigned,
    shortage: gatekeeperAssignmentsBySchool.reduce((total, assigned) => total + Math.max(0, 1 - assigned), 0),
    surplus: gatekeeperAssignmentsBySchool.reduce((total, assigned) => total + Math.max(0, assigned - 1), 0),
    shortageSchools: gatekeeperAssignmentsBySchool.filter((assigned) => assigned < 1).length,
    surplusSchools: gatekeeperAssignmentsBySchool.filter((assigned) => assigned > 1).length,
  };
  const cleanersNetBalance = cleaners.assigned - cleaners.required;
  const gatekeepersNetBalance = gatekeepers.assigned - gatekeepers.required;
  return {
    gatekeepers: { ...gatekeepers, netBalance: gatekeepersNetBalance },
    cleaners: { ...cleaners, netBalance: cleanersNetBalance },
    total: {
      required: gatekeepers.required + cleaners.required,
      assigned: gatekeepers.assigned + cleaners.assigned,
      shortage: gatekeepers.shortage + cleaners.shortage,
      surplus: gatekeepers.surplus + cleaners.surplus,
      shortageSchools: totalShortageSchools ?? null,
      netBalance: gatekeepers.assigned + cleaners.assigned - gatekeepers.required - cleaners.required,
    },
  };
}

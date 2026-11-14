import { describe, expect, it } from 'vitest';
import { cleanerShortageSchools, countDashboardActions, eligibleSchoolsMissingClassCount, schoolsWithSizeClassDifference, staffingRowsForEligibleSchools, summarizeDashboardPlans, summarizeDashboardServices, summarizeDashboardStaffing, summarizeDashboardVisits, summarizeSupervisorCompliance, summarizeWorkforce } from './dashboard';
import { DEFAULT_STAFFING_RULES } from './staffing';
import { filterPlanReportActionRows, summarizeDashboardVerdict, type ReportPlanMetricRow, type ReportPlanRow } from './planReport';
import type { DeliverableRecord } from './deliverables';

const metricRow = (values: Partial<ReportPlanMetricRow> = {}): ReportPlanMetricRow => ({
  month: '2026-11',
  planType: 'maintenance',
  plannedDate: '2026-11-02',
  visited: false,
  visitedDate: null,
  reportDone: false,
  reportCompletedDate: null,
  ...values,
});

describe('dashboard summaries', () => {
  it('groups maintenance compliance by linked supervisor or normalized free-text name and excludes future rows', () => {
    expect(summarizeSupervisorCompliance([
      { supervisorId: 'employee-1', supervisorName: 'أحمد علي', plannedDate: '2026-11-02', visited: true, visitedDate: '2026-11-03' },
      { supervisorId: 'employee-1', supervisorName: 'أحمد علي', plannedDate: '2026-11-03', visited: true, visitedDate: '2026-11-03' },
      { supervisorId: null, supervisorName: '  مُحَمَّد   سالم ', plannedDate: '2026-11-02', visited: true, visitedDate: '2026-11-02' },
      { supervisorId: null, supervisorName: 'محمد سالم', plannedDate: '2026-11-04', visited: false, visitedDate: null },
      { supervisorId: null, supervisorName: 'مشرف لاحق', plannedDate: '2026-11-12', visited: false, visitedDate: null },
    ], '2026-11-04')).toEqual([
      { id: 'employee-1', name: 'أحمد علي', planned: 2, completedOnTime: 1, percent: 50 },
      { id: 'name:محمد سالم', name: 'مُحَمَّد   سالم', planned: 2, completedOnTime: 1, percent: 50 },
    ]);
  });

  it('calculates independent current-plan completion rates', () => {
    expect(summarizeDashboardPlans([
      { planType: 'maintenance', visitedAt: '2026-11-02', reportCompletedAt: '2026-11-03' },
      { planType: 'maintenance', visitedAt: null, reportCompletedAt: null },
      { planType: 'elevators', visitedAt: null, reportCompletedAt: null },
    ])).toMatchObject([
      { planType: 'maintenance', total: 2, visited: 1, reportsCompleted: 1, visitPercent: 50, reportPercent: 50 },
      { planType: 'cleaning', total: 0, visitPercent: 0, reportPercent: 0 },
      { planType: 'security_safety', total: 0 },
      { planType: 'elevators', total: 1 },
    ]);
  });

  it('excludes schools with unknown class counts from requirements but reports missing counts', () => {
    expect(summarizeDashboardStaffing([
      { requiredCleaners: 2, assignedCleaners: 1, shortage: 1, surplus: 0 },
      { requiredCleaners: null, assignedCleaners: 0, shortage: 0, surplus: 0 },
    ])).toEqual({ schools: 2, required: 2, assigned: 1, shortage: 1, surplus: 0, shortageSchools: 1, missingClassCount: 1 });
  });

  it('uses the explicit size before class-count fallback in the domain layer', () => {
    const schools = [
      { id: 'independent', sourceFields: { 'نوع المبنى': 'مستقل', 'عدد الفصول': '13', 'حجم المدرسة': 'صغير' }, assignedCleaners: 1, declaredSize: 'صغير' },
      { id: 'other', sourceFields: { 'نوع المبنى': 'ملحق', 'عدد الفصول': '22' }, assignedCleaners: 0 },
    ];
    expect(staffingRowsForEligibleSchools(schools, {
      buildingTypeHeader: 'نوع المبنى',
      independentBuildingValues: ['مستقل'],
      primarySharedValues: [],
      elevatorContractorHeader: 'مقاول المصاعد',
      noElevatorValues: [],
      classCountHeader: 'عدد الفصول',
      schoolSizeHeader: 'حجم المدرسة',
    })).toMatchObject([{ size: 'small', requiredCleaners: 1, assignedCleaners: 1, shortage: 0, sizeDiffersFromClassCount: true }]);
    expect(staffingRowsForEligibleSchools([
      { id: 'fallback', sourceFields: { 'نوع المبنى': 'مستقل', 'عدد الفصول': '13' }, assignedCleaners: 1 },
    ], {
      buildingTypeHeader: 'نوع المبنى',
      independentBuildingValues: ['مستقل'],
      primarySharedValues: [],
      elevatorContractorHeader: 'مقاول المصاعد',
      noElevatorValues: [],
      classCountHeader: 'عدد الفصول',
      schoolSizeHeader: 'حجم المدرسة',
      staffingRules: DEFAULT_STAFFING_RULES,
    })).toMatchObject([{ size: 'medium', requiredCleaners: 2 }]);
  });

  it('lists eligible schools whose class count is missing', () => {
    expect(eligibleSchoolsMissingClassCount([
      { id: 'known', schoolName: 'مدرسة معلومة', sourceFields: { 'نوع المبنى': 'مستقل', 'عدد الفصول': '13' }, assignedCleaners: 1 },
      { id: 'missing', schoolName: 'مدرسة بلا فصول', sourceFields: { 'نوع المبنى': 'مستقل' }, assignedCleaners: 0 },
      { id: 'ineligible', schoolName: 'مدرسة ملحقة', sourceFields: { 'نوع المبنى': 'ملحق' }, assignedCleaners: 0 },
    ], {
      buildingTypeHeader: 'نوع المبنى',
      independentBuildingValues: ['مستقل'],
      primarySharedValues: [],
      elevatorContractorHeader: 'مقاول المصاعد',
      noElevatorValues: [],
      classCountHeader: 'عدد الفصول',
      schoolSizeHeader: 'حجم المدرسة',
    })).toEqual([{ id: 'missing', name: 'مدرسة بلا فصول' }]);
  });

  it('lists all schools whose explicit indicator differs from class count', () => {
    expect(schoolsWithSizeClassDifference([
      { id: 'matches', schoolName: 'متطابقة', sourceFields: { الفصول: '13' }, declaredSize: 'M', assignedCleaners: 0 },
      { id: 'differs', schoolName: 'مختلفة', sourceFields: { الفصول: '13' }, declaredSize: 'S+', assignedCleaners: 0 },
      { id: 'missing', schoolName: 'بلا حجم', sourceFields: { الفصول: '13' }, assignedCleaners: 0 },
    ], 'الفصول')).toEqual([{ id: 'differs', name: 'مختلفة' }]);
  });

  it('lists eligible cleaner-shortage schools with placement counts', () => {
    expect(cleanerShortageSchools([
      { id: 'short', schoolName: 'مدرسة العجز', ministryNumber: '1001', sourceFields: { 'نوع المبنى': 'مستقل', 'عدد الفصول': '13' }, assignedCleaners: 1 },
      { id: 'covered', schoolName: 'مدرسة مكتملة', ministryNumber: '1002', sourceFields: { 'نوع المبنى': 'مستقل', 'عدد الفصول': '13' }, assignedCleaners: 2 },
      { id: 'unknown', schoolName: 'مدرسة بلا فصول', ministryNumber: '1003', sourceFields: { 'نوع المبنى': 'مستقل' }, assignedCleaners: 0 },
      { id: 'ineligible', schoolName: 'مدرسة ملحقة', ministryNumber: '1004', sourceFields: { 'نوع المبنى': 'ملحق', 'عدد الفصول': '13' }, assignedCleaners: 0 },
    ], {
      buildingTypeHeader: 'نوع المبنى',
      independentBuildingValues: ['مستقل'],
      primarySharedValues: [],
      elevatorContractorHeader: 'مقاول المصاعد',
      noElevatorValues: [],
      classCountHeader: 'عدد الفصول',
      schoolSizeHeader: 'حجم المدرسة',
    })).toEqual([{
      id: 'short', ministryNumber: '1001', name: 'مدرسة العجز', required: 2, assigned: 1, shortage: 1,
    }]);
  });

  it('aggregates all current monthly plan rows', () => {
    expect(summarizeDashboardVisits(summarizeDashboardPlans([
      { planType: 'maintenance', visitedAt: '2026-11-02', reportCompletedAt: null },
      { planType: 'cleaning', visitedAt: null, reportCompletedAt: null },
    ]))).toEqual({ total: 2, visited: 1, reportsCompleted: 0 });
  });

  it('summarizes gatekeepers and cleaners into total shortage and surplus', () => {
    expect(summarizeWorkforce([
      { size: 'large', requiredCleaners: 3, assignedCleaners: 2, shortage: 1, surplus: 0 },
      { size: 'small', requiredCleaners: 1, assignedCleaners: 2, shortage: 0, surplus: 1 },
    ], 182, 180)).toMatchObject({
      gatekeepers: { required: 182, assigned: 180, shortage: 2, surplus: 0 },
      cleaners: { required: 4, assigned: 4, shortage: 1, surplus: 1 },
      total: { required: 186, assigned: 184, shortage: 3, surplus: 1 },
    });
    expect(summarizeWorkforce([
      { size: 'large', requiredCleaners: 3, assignedCleaners: 2, shortage: 1, surplus: 0 },
      { size: 'small', requiredCleaners: 1, assignedCleaners: 2, shortage: 0, surplus: 1 },
    ], 182, 180    ).cleaners.bySize).toEqual({
      small: { required: 1, assigned: 2, shortage: 0, surplus: 1 },
      small_plus: { required: 0, assigned: 0, shortage: 0, surplus: 0 },
      medium: { required: 0, assigned: 0, shortage: 0, surplus: 0 },
      medium_plus: { required: 0, assigned: 0, shortage: 0, surplus: 0 },
      large: { required: 3, assigned: 2, shortage: 1, surplus: 0 },
      large_plus: { required: 0, assigned: 0, shortage: 0, surplus: 0 },
    });
    const workforce = summarizeWorkforce([
      { size: 'small_plus', requiredCleaners: 2, assignedCleaners: 1, shortage: 1, surplus: 0 },
      { size: 'large_plus', requiredCleaners: 4, assignedCleaners: 4, shortage: 0, surplus: 0 },
    ], 3, 3);
    expect(workforce.total.required).toBe(workforce.gatekeepers.required + workforce.cleaners.required);
    expect(workforce.cleaners.bySize.small_plus.required).toBe(2);
    expect(workforce.cleaners.bySize.large_plus.assigned).toBe(4);
  });

  it('distinguishes schools with shortages from net cleaner balance', () => {
    const workforce = summarizeWorkforce([
      { size: 'large', requiredCleaners: 3, assignedCleaners: 1, shortage: 2, surplus: 0 },
      { size: 'small', requiredCleaners: 2, assignedCleaners: 5, shortage: 0, surplus: 3 },
    ], 0, 0);

    expect(workforce.cleaners.shortageSchools).toBe(1);
    expect(workforce.cleaners.netBalance).toBe(workforce.cleaners.surplus - workforce.cleaners.shortage);
    expect(workforce.cleaners.netBalance).toBe(1);
  });

  it('uses assigned minus required for net balance: deficit is negative and surplus is positive', () => {
    const deficit = summarizeWorkforce([
      { requiredCleaners: 4, assignedCleaners: 1, shortage: 3, surplus: 0 },
    ], 0, 0);
    const surplus = summarizeWorkforce([
      { requiredCleaners: 1, assignedCleaners: 4, shortage: 0, surplus: 3 },
    ], 0, 0);

    expect(deficit.cleaners.netBalance).toBe(-3);
    expect(surplus.cleaners.netBalance).toBe(3);
  });

  it('keeps net balance equal to assigned minus calculable required when class counts are missing', () => {
    const workforce = summarizeWorkforce([
      { requiredCleaners: 2, assignedCleaners: 1, shortage: 1, surplus: 0 },
      { requiredCleaners: null, assignedCleaners: 3, shortage: 0, surplus: 0 },
    ], 4, 5);

    expect(workforce.total.netBalance).toBe(workforce.total.assigned - workforce.total.required);
  });

  it('returns an empty verdict before a month with no plan rows', () => {
    expect(summarizeDashboardVerdict([], '2026-11', '2026-10-31')).toMatchObject({
      planned: 0,
      expected: 0,
      done: 0,
      behind: 0,
      firstSlipDay: null,
      requiredDailyPace: 0,
      elapsedWorkingDays: 0,
      monthProgressPercent: 0,
      status: 'no-plan',
    });
  });

  it('finds the first working-day slip after a Friday plan date and calculates pace', () => {
    const rows = [
      metricRow({ plannedDate: '2026-11-06' }),
      metricRow({ plannedDate: '2026-11-09', visited: true, visitedDate: '2026-11-09' }),
    ];
    expect(summarizeDashboardVerdict(rows, '2026-11', '2026-11-09')).toMatchObject({
      planned: 2,
      expected: 2,
      done: 1,
      behind: 1,
      firstSlipDay: '2026-11-08',
      remainingWorkingDays: 15,
      requiredDailyPace: 1 / 15,
      elapsedWorkingDays: 7,
      status: 'far-behind',
    });
  });

  it('reports the amount ahead when completed visits meet or exceed the expected count', () => {
    const rows = [
      metricRow({ plannedDate: '2026-11-02', visited: true, visitedDate: '2026-11-02' }),
      metricRow({ plannedDate: '2026-11-03', visited: true, visitedDate: '2026-11-03' }),
      metricRow({ plannedDate: '2026-11-20', visited: true, visitedDate: '2026-11-03' }),
    ];
    expect(summarizeDashboardVerdict(rows, '2026-11', '2026-11-03')).toMatchObject({
      expected: 2,
      done: 3,
      behind: 0,
      ahead: 1,
      firstSlipDay: null,
    });
  });

  it('filters a below-expected list independently from overdue visits', () => {
    const rows: ReportPlanRow[] = [
      { id: 'due', month: '2026-11', planType: 'maintenance', plannedDate: '2026-11-02', visited: false, visitedDate: null, reportDone: false, reportCompletedDate: null, engineerId: null, engineerName: null, supervisorId: null, supervisorName: null, contractorName: null, schoolId: 's1', schoolName: 'مستحقة', ministryNumber: '', neighbourhood: '', hasCleaner: true },
      { id: 'future', month: '2026-11', planType: 'maintenance', plannedDate: '2026-11-20', visited: false, visitedDate: null, reportDone: false, reportCompletedDate: null, engineerId: null, engineerName: null, supervisorId: null, supervisorName: null, contractorName: null, schoolId: 's2', schoolName: 'لاحقة', ministryNumber: '', neighbourhood: '', hasCleaner: true },
    ];
    expect(filterPlanReportActionRows(rows, 'below-expected', '2026-11-03').map((row) => row.id)).toEqual(['due']);
    expect(filterPlanReportActionRows(rows, 'late-visits', '2026-11-03').map((row) => row.id)).toEqual(['due']);
  });

  it('uses the expected performance target for unscheduled plans without marking rows overdue', () => {
    const rows: ReportPlanRow[] = ['a', 'b', 'c'].map((id) => ({
      id,
      lateByPlannedDate: false,
      month: '2026-11',
      planType: 'cleaning',
      plannedDate: '2026-11-20',
      visited: false,
      visitedDate: null,
      reportDone: false,
      reportCompletedDate: null,
      engineerId: null,
      engineerName: null,
      supervisorId: null,
      supervisorName: null,
      contractorName: null,
      schoolId: id,
      schoolName: id,
      ministryNumber: '',
      neighbourhood: '',
      hasCleaner: true,
    }));
    expect(filterPlanReportActionRows(rows, 'below-expected', '2026-11-03')).toHaveLength(1);
    expect(filterPlanReportActionRows(rows, 'late-visits', '2026-11-03')).toHaveLength(0);
  });

  it('does not count weekends as month-progress days and counts the full month before it starts', () => {
    const verdict = summarizeDashboardVerdict([
      metricRow({ plannedDate: '2026-11-02' }),
    ], '2026-11', '2026-10-31');
    expect(verdict).toMatchObject({
      expected: 0,
      firstSlipDay: null,
      elapsedWorkingDays: 0,
      totalWorkingDays: 22,
      remainingWorkingDays: 22,
      requiredDailyPace: 1 / 22,
      monthProgressPercent: 0,
      status: 'on-track',
    });
  });

  it('classifies verdict gaps at five and fifteen percent of the plan', () => {
    const makeRows = (visited: number) => Array.from({ length: 100 }, (_, index) =>
      metricRow({
        plannedDate: '2026-11-02',
        visited: index < visited,
        visitedDate: index < visited ? '2026-11-02' : null,
      }),
    );
    expect(summarizeDashboardVerdict(makeRows(95), '2026-11', '2026-11-02').status).toBe('on-track');
    expect(summarizeDashboardVerdict(makeRows(85), '2026-11', '2026-11-02').status).toBe('slightly-behind');
    expect(summarizeDashboardVerdict(makeRows(84), '2026-11', '2026-11-02').status).toBe('far-behind');
  });

  it('counts dashboard action tiles from report, staffing, deliverable and KPI data', () => {
    const deliverable = (values: Partial<DeliverableRecord>): DeliverableRecord => ({
      dueBasis: 'التوقيع',
      durationDays: null,
      dueDateOverride: null,
      status: 'not_delivered',
      ...values,
    });
    const rows = [
      metricRow({ plannedDate: '2026-11-01' }),
      metricRow({ plannedDate: '2026-11-02', visited: true, visitedDate: '2026-11-02' }),
      metricRow({ plannedDate: '2026-11-02', visited: true, visitedDate: '2026-11-02', reportDone: true, reportCompletedDate: '2026-11-03' }),
    ];
    expect(countDashboardActions({
      rows,
      month: '2026-11',
      asOf: '2026-11-03',
      staffing: [
        { requiredCleaners: 3, assignedCleaners: 1, shortage: 2, surplus: 0 },
        { requiredCleaners: 2, assignedCleaners: 2, shortage: 0, surplus: 0 },
      ],
      deliverables: [
        deliverable({ dueDateOverride: '2026-11-03' }),
        deliverable({ dueDateOverride: '2026-11-17', status: 'delivered_pending' }),
        deliverable({ dueDateOverride: '2026-11-18' }),
        deliverable({ dueDateOverride: '2026-11-10', status: 'approved' }),
      ],
      deliverableDates: { contractSigningDate: null, siteHandoverDate: null, awardLetterDate: null },
      previousKpiStatus: null,
    })).toEqual({
      lateVisits: 1,
      visitedWithoutReport: 1,
      cleanerShortage: 2,
      deliverablesDueSoon: 2,
      previousKpiNotApproved: 1,
    });
  });

  it('summarizes the four service cards without inventing plans', () => {
    expect(summarizeDashboardServices([], '2026-11', '2026-11-10')).toMatchObject([
      { planType: 'maintenance', planned: 0, overallPercent: 0, status: 'no-plan' },
      { planType: 'cleaning', planned: 0, overallPercent: 0, status: 'no-plan' },
      { planType: 'security_safety', planned: 0, overallPercent: 0, status: 'no-plan' },
      { planType: 'elevators', planned: 0, overallPercent: 0, status: 'no-plan' },
    ]);
  });
});

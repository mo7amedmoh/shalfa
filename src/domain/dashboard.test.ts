import { describe, expect, it } from 'vitest';
import { countDashboardActions, staffingRowsForEligibleSchools, summarizeDashboardPlans, summarizeDashboardServices, summarizeDashboardStaffing, summarizeDashboardVisits, summarizeSupervisorCompliance, summarizeWorkforce } from './dashboard';
import { summarizeDashboardVerdict, type ReportPlanMetricRow } from './planReport';
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

  it('applies configured eligibility and class-count staffing in the domain layer', () => {
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
    })).toMatchObject([{ requiredCleaners: 2, assignedCleaners: 1, shortage: 1, sizeCorrected: true }]);
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
    ], 182, 180).cleaners.bySize).toEqual({
      small: { required: 1, assigned: 2, shortage: 0, surplus: 1 },
      medium: { required: 0, assigned: 0, shortage: 0, surplus: 0 },
      large: { required: 3, assigned: 2, shortage: 1, surplus: 0 },
    });
  });

  it('distinguishes schools with shortages from net cleaner balance', () => {
    const workforce = summarizeWorkforce([
      { size: 'large', requiredCleaners: 3, assignedCleaners: 1, shortage: 2, surplus: 0 },
      { size: 'small', requiredCleaners: 2, assignedCleaners: 5, shortage: 0, surplus: 3 },
    ], 0, 0);

    expect(workforce.cleaners.shortageSchools).toBe(1);
    expect(workforce.cleaners.netBalance).toBe(workforce.cleaners.shortage - workforce.cleaners.surplus);
    expect(workforce.cleaners.netBalance).toBe(-1);
  });

  it('uses a positive net balance for deficits and a negative one for surpluses', () => {
    const deficit = summarizeWorkforce([
      { requiredCleaners: 4, assignedCleaners: 1, shortage: 3, surplus: 0 },
    ], 0, 0);
    const surplus = summarizeWorkforce([
      { requiredCleaners: 1, assignedCleaners: 4, shortage: 0, surplus: 3 },
    ], 0, 0);

    expect(deficit.cleaners.netBalance).toBe(3);
    expect(surplus.cleaners.netBalance).toBe(-3);
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

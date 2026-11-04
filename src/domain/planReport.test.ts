import { describe, expect, it } from 'vitest';
import {
  buildPlanReportView,
  filterPlanReportRows,
  rankSupervisorsByLateness,
  rowsForAxisStatus,
  summarizePlanReport,
  type ReportPlanRow,
} from './planReport';

const row = (values: Partial<ReportPlanRow> = {}): ReportPlanRow => ({
  id: 'row-1',
  month: '2026-11',
  planType: 'maintenance',
  plannedDate: '2026-11-05',
  visited: false,
  visitedDate: null,
  reportDone: false,
  reportCompletedDate: null,
  engineerId: 'engineer-1',
  engineerName: 'مهندس أول',
  supervisorId: 'supervisor-1',
  supervisorName: 'مشرف أول',
  contractorName: null,
  schoolId: 'school-1',
  schoolName: 'مدرسة أولى',
  ministryNumber: '1001',
  neighbourhood: 'الشمال',
  hasCleaner: true,
  ...values,
});

describe('monthly plan report metrics', () => {
  it('returns zero-safe metrics for a month with no plan rows', () => {
    expect(summarizePlanReport([], '2026-11', '2026-11-15')).toMatchObject({
      planned: 0,
      expectedVisits: 0,
      visited: 0,
      reportsDone: 0,
      completed: 0,
      visitPercent: 0,
      reportPercent: 0,
      completionPercent: 0,
      expectedPercent: 0,
      visitGap: 0,
      remaining: 0,
      reportRisk: 'none',
    });
  });

  it('calculates expected, visited, reports, completion, gap, remaining, and in-progress at the as-of date', () => {
    const rows = [
      row({ id: 'done', plannedDate: '2026-11-02', visited: true, visitedDate: '2026-11-03', reportDone: true, reportCompletedDate: '2026-11-04' }),
      row({ id: 'visit-only', plannedDate: '2026-11-05', visited: true, visitedDate: '2026-11-06' }),
      row({ id: 'pending', plannedDate: '2026-11-10' }),
      row({ id: 'future', plannedDate: '2026-11-20' }),
    ];
    expect(summarizePlanReport(rows, '2026-11', '2026-11-10')).toMatchObject({
      planned: 4,
      expectedVisits: 3,
      visited: 2,
      reportsDone: 1,
      completed: 1,
      visitPercent: 50,
      reportPercent: 25,
      completionPercent: 25,
      expectedPercent: 75,
      visitGap: -1,
      remaining: 3,
      inProgress: 1,
    });
  });

  it('does not count activity dated after the as-of date and handles dates before month start', () => {
    const rows = [
      row({ plannedDate: '2026-11-01', visited: true, visitedDate: '2026-11-02', reportDone: true, reportCompletedDate: '2026-11-03' }),
    ];
    expect(summarizePlanReport(rows, '2026-11', '2026-10-31')).toMatchObject({
      expectedVisits: 0,
      visited: 0,
      reportsDone: 0,
      completed: 0,
      workingDaysLeft: 22,
    });
  });

  it('uses the entire partial month-to-date for expected percentage', () => {
    const rows = [
      row({ id: 'one', plannedDate: '2026-11-01', visited: true, visitedDate: '2026-11-01' }),
      row({ id: 'two', plannedDate: '2026-11-10', visited: true, visitedDate: '2026-11-10' }),
      row({ id: 'three', plannedDate: '2026-11-11' }),
      row({ id: 'four', plannedDate: '2026-11-30' }),
    ];
    expect(summarizePlanReport(rows, '2026-11', '2026-11-10')).toMatchObject({
      expectedVisits: 2,
      expectedPercent: 50,
      visited: 2,
      visitPercent: 50,
      visitGap: 0,
    });
  });

  it('counts planned dates strictly before as-of as late visits', () => {
    const rows = [
      row({ id: 'yesterday', plannedDate: '2026-11-09' }),
      row({ id: 'today', plannedDate: '2026-11-10' }),
      row({ id: 'done-late', plannedDate: '2026-11-08', visited: true, visitedDate: '2026-11-10' }),
    ];
    expect(summarizePlanReport(rows, '2026-11', '2026-11-10').lateVisits).toBe(1);
  });

  it('does not call reports late before or on month end, and does after month end', () => {
    const rows = [row({ plannedDate: '2026-11-01' })];
    expect(summarizePlanReport(rows, '2026-11', '2026-11-30')).toMatchObject({
      lateReports: 0,
      reportsDueByMonthEnd: 1,
    });
    expect(summarizePlanReport(rows, '2026-11', '2026-12-01')).toMatchObject({
      lateReports: 1,
      reportsDueByMonthEnd: 0,
    });
  });

  it('uses Saudi working days (Sunday–Thursday) for remaining-report risk and forecasts', () => {
    const rows = Array.from({ length: 18 }, (_, index) => row({
      id: `row-${index}`,
      visited: true,
      visitedDate: '2026-11-05',
    }));
    expect(summarizePlanReport(rows, '2026-11', '2026-11-06')).toMatchObject({
      workingDaysLeft: 17,
      reportRisk: 'high',
    });
    expect(buildPlanReportView(rows, '2026-11', '2026-11-06').forecast).toMatchObject({
      elapsedWorkingDays: 5,
      totalWorkingDays: 22,
      estimate: 18,
    });
  });

  it('leaves month-end forecast unavailable before the month begins and caps it at the plan size', () => {
    const rows = [row({ visited: true, visitedDate: '2026-11-01' })];
    expect(buildPlanReportView(rows, '2026-11', '2026-10-31').forecast.estimate).toBeNull();
    expect(buildPlanReportView(rows, '2026-11', '2026-11-30').forecast.estimate).toBe(1);
  });
});

describe('monthly plan report filters and details', () => {
  const rows = [
    row({ id: 'maintenance', planType: 'maintenance' }),
    row({ id: 'cleaning', planType: 'cleaning', engineerId: 'engineer-2', neighbourhood: 'الشرق' }),
    row({ id: 'elevator', planType: 'elevators', supervisorId: null, contractorName: 'شركة المصاعد' }),
    row({ id: 'other-month', month: '2026-10' }),
  ];

  it('filters by month, axis, engineer, supervisor, and neighbourhood', () => {
    expect(filterPlanReportRows(rows, {
      month: '2026-11',
      axis: 'cleaning',
      engineerId: 'engineer-2',
      supervisorId: 'supervisor-1',
      neighbourhood: 'الشرق',
    }).map(({ id }) => id)).toEqual(['cleaning']);
    expect(filterPlanReportRows(rows, {
      month: '2026-11',
      axis: 'all',
      engineerId: '',
      supervisorId: '',
      neighbourhood: '',
    })).toHaveLength(3);
  });

  it('provides click-through rows for each axis status', () => {
    const candidates = [
      row({ id: 'done', visited: true, visitedDate: '2026-11-04' }),
      row({ id: 'pending', plannedDate: '2026-11-20' }),
      row({ id: 'late', plannedDate: '2026-11-01' }),
    ];
    expect(rowsForAxisStatus(candidates, 'maintenance', 'visit-done', '2026-11-05').map(({ id }) => id)).toEqual(['done']);
    expect(rowsForAxisStatus(candidates, 'maintenance', 'visit-pending', '2026-11-05').map(({ id }) => id)).toEqual(['pending']);
    expect(rowsForAxisStatus(candidates, 'maintenance', 'visit-late', '2026-11-05').map(({ id }) => id)).toEqual(['late']);
  });

  it('calculates compliance ranking, daily heat cells, and excludes external-company plans', () => {
    const view = buildPlanReportView([
      row({ id: 'completed', visited: true, visitedDate: '2026-11-05', reportDone: true, reportCompletedDate: '2026-11-05' }),
      row({ id: 'late', plannedDate: '2026-11-01' }),
      row({ id: 'external', planType: 'elevators', supervisorId: null, contractorName: 'شركة المصاعد' }),
    ], '2026-11', '2026-11-10');
    expect(view.supervisors).toHaveLength(1);
    expect(view.supervisors[0]).toMatchObject({
      planned: 2,
      completed: 1,
      completionPercent: 50,
      complianceScore: 50,
      lateVisits: 1,
    });
    expect(view.supervisors[0].daily[0].state).toBe('late');
    expect(view.axes.find(({ axis }) => axis === 'elevators')?.planned).toBe(1);
    expect(view.engineers.find(({ id }) => id === 'شركة المصاعد')?.label).toBe('شركة المصاعد');

    const ranked = rankSupervisorsByLateness([
      { ...view.supervisors[0], id: 'few', name: 'مشرف أ', lateVisits: 1, lateReports: 0 },
      { ...view.supervisors[0], id: 'most', name: 'مشرف ب', lateVisits: 1, lateReports: 2 },
    ]);
    expect(ranked.map(({ id }) => id)).toEqual(['most', 'few']);
  });

  it('tracks late-item aging and applies row-level quality checks', () => {
    const view = buildPlanReportView([
      row({ id: 'old', plannedDate: '2026-11-01', supervisorId: null, hasCleaner: false }),
      row({
        id: 'quality',
        plannedDate: '2026-11-20',
        visited: true,
        visitedDate: '2026-11-10',
        reportDone: true,
        reportCompletedDate: '2026-11-10',
        hasCleaner: false,
      }),
      row({
        id: 'report-only',
        plannedDate: '2026-11-25',
        reportDone: true,
        reportCompletedDate: '2026-11-26',
      }),
    ], '2026-11', '2026-12-01');
    expect(view.lateItems.map(({ kind, agingBucket }) => [kind, agingBucket])).toEqual([
      ['visit', '6+'],
      ['visit', '6+'],
      ['report', '1–2'],
    ]);
    expect(view.aging).toEqual({ '1–2': 1, '3–5': 0, '6+': 2 });
    expect(view.quality.missingSupervisor).toHaveLength(1);
    expect(view.quality.reportWithoutVisit).toHaveLength(1);
    expect(view.quality.visitDateBeforePlan).toHaveLength(1);
    expect(view.quality.schoolsWithoutCleaners).toHaveLength(2);
  });

  it('builds cumulative plan/actual values and month-end card deltas', () => {
    const current = [
      row({ id: 'a', plannedDate: '2026-11-01', visited: true, visitedDate: '2026-11-02' }),
      row({ id: 'b', plannedDate: '2026-11-10' }),
    ];
    const previous = [
      row({ id: 'a-prev', month: '2026-10', plannedDate: '2026-10-01', visited: true, visitedDate: '2026-10-02' }),
    ];
    const view = buildPlanReportView(current, '2026-11', '2026-11-10', previous);
    expect(view.daily[0]).toMatchObject({ planned: 1, actual: 0 });
    expect(view.daily[1]).toMatchObject({ planned: 1, actual: 1 });
    expect(view.daily[9]).toMatchObject({ planned: 2, actual: 1, isAsOfDate: true });
    expect(view.cards).toHaveLength(12);
    expect(view.cards.find(({ key }) => key === 'planned')?.delta).toBe(1);
  });
});

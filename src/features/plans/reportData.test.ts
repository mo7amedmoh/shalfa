import { describe, expect, it } from 'vitest';
import { buildPlanReportView, type ReportPlanRow } from '../../domain/planReport';
import { buildReportData } from './reportData';

const row = (id: string, values: Partial<ReportPlanRow> = {}): ReportPlanRow => ({
  id,
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
  schoolId: `school-${id}`,
  schoolName: `مدرسة ${id}`,
  ministryNumber: id,
  neighbourhood: 'الشمال',
  hasCleaner: true,
  ...values,
});

const formatNumber = (value: string | number) => String(value);

function reportData(rows: ReportPlanRow[], asOf = '2026-11-10') {
  const view = buildPlanReportView(rows, '2026-11', asOf);
  return buildReportData(view, rows, '2026-11', asOf, formatNumber);
}

describe('monthly report presentation data', () => {
  it('cuts the actual cumulative line off at the as-of date and continues the forecast', () => {
    const data = reportData([
      row('done', { visited: true, visitedDate: '2026-11-05' }),
      row('pending', { plannedDate: '2026-11-20' }),
    ]);

    expect(data.chart.points.filter(({ actualVisible }) => actualVisible)).toHaveLength(10);
    expect(data.chart.points.slice(10).every(({ actualVisible }) => !actualVisible)).toBe(true);
    expect(data.chart.forecastPoints).toBe(true);
    expect(data.chart.xLabels.map(({ label }) => label)).toContain('10');
    expect(data.chart.yTicks).toHaveLength(5);
  });

  it('uses maintenance rows only for the maintenance cumulative chart', () => {
    const data = reportData([
      row('maintenance', { plannedDate: '2026-11-05', visited: true, visitedDate: '2026-11-05' }),
      ...Array.from({ length: 3 }, (_, index) => row(`cleaning-${index}`, {
        planType: 'cleaning',
        plannedDate: '2026-11-05',
      })),
    ]);

    expect(data.chart.max).toBe(1);
    expect(data.chart.points[4]).toMatchObject({ yPlanned: 60, yActual: 60 });
  });

  it('classifies service progress against expected-to-date and keeps unplanned services neutral', () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, index) => row(`on-${index}`, {
        plannedDate: index < 5 ? `2026-11-0${index + 1}` : '2026-11-20',
        visited: index < 5,
        visitedDate: index < 5 ? `2026-11-0${index + 1}` : null,
        reportDone: index < 5,
        reportCompletedDate: index < 5 ? `2026-11-0${index + 1}` : null,
      })),
      ...Array.from({ length: 10 }, (_, index) => row(`slightly-${index}`, {
        planType: 'cleaning',
        plannedDate: index < 5 ? `2026-11-0${index + 1}` : '2026-11-20',
        visited: index < 4,
        visitedDate: index < 4 ? `2026-11-0${index + 1}` : null,
        reportDone: index < 4,
        reportCompletedDate: index < 4 ? `2026-11-0${index + 1}` : null,
      })),
      ...Array.from({ length: 10 }, (_, index) => row(`far-${index}`, {
        planType: 'security_safety',
        plannedDate: index < 5 ? `2026-11-0${index + 1}` : '2026-11-20',
        visited: index < 3,
        visitedDate: index < 3 ? `2026-11-0${index + 1}` : null,
        reportDone: index < 3,
        reportCompletedDate: index < 3 ? `2026-11-0${index + 1}` : null,
      })),
    ];
    const data = reportData(rows);
    const maintenance = data.services.find(({ id }) => id === 'maintenance');
    const slightlyBehind = data.services.find(({ id }) => id === 'cleaning');
    const farBehind = data.services.find(({ id }) => id === 'security_safety');
    const noPlan = data.services.find(({ id }) => id === 'elevators');

    expect(maintenance?.pillTone).toBe('on-track');
    expect(maintenance?.overallPercent).toBe(50);
    expect(slightlyBehind?.overallPercent).toBe(40);
    expect(slightlyBehind?.pillTone).toBe('slightly-behind');
    expect(farBehind?.overallPercent).toBe(30);
    expect(farBehind?.pillTone).toBe('far-behind');
    expect(noPlan).toMatchObject({ planned: 0, pillTone: 'no-plan' });
  });

  it('provides uploaded and planned report totals for each service', () => {
    const data = reportData([
      row('maintenance-1', { reportDone: true, reportCompletedDate: '2026-11-05' }),
      row('maintenance-2'),
      row('cleaning-1', { planType: 'cleaning', reportDone: true, reportCompletedDate: '2026-11-05' }),
    ]);

    expect(data.reports.byService).toMatchObject([
      { id: 'maintenance', uploaded: 1, planned: 2 },
      { id: 'cleaning', uploaded: 1, planned: 1 },
      { id: 'security_safety', uploaded: 0, planned: 0 },
      { id: 'elevators', uploaded: 0, planned: 0 },
    ]);
  });

  it('hides the pace gap when no plan uses pace accounting', () => {
    const data = reportData([row('planned-date-plan')]);

    expect(data.summaryCards.some(({ label }) => label === 'عجز وتيرة الإنجاز')).toBe(false);
  });

  it('marks a service far behind when visits are due but nothing is complete', () => {
    const data = reportData([
      row('cleaning-due', { planType: 'cleaning', plannedDate: '2026-11-05' }),
      row('cleaning-future', { planType: 'cleaning', plannedDate: '2026-11-20' }),
    ]);

    expect(data.services.find(({ id }) => id === 'cleaning')).toMatchObject({
      visited: 0,
      expectedVisits: 1,
      pillTone: 'far-behind',
    });
  });

  it('keeps pace shortfall out of overdue visits and summary cards', () => {
    const rows = Array.from({ length: 22 }, (_, index) => row(`pace-${index}`, {
      planId: 'performance-plan',
      lateByPlannedDate: false,
      plannedDate: '2026-11-30',
      visited: index < 5,
      visitedDate: index < 5 ? '2026-11-10' : null,
    }));
    const data = reportData(rows);

    expect(data.summaryCards.find(({ label }) => label === 'زيارات متأخرة')?.value).toBe(0);
    expect(data.summaryCards.some(({ label }) => label === 'عجز وتيرة الإنجاز')).toBe(false);
    expect(data.lateItems).toHaveLength(0);
    expect(data.status.label).toContain('أقل من وتيرة الإنجاز المستهدفة');
  });
});

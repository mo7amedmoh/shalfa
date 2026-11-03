import { describe, expect, it } from 'vitest';
import { buildDailyProgress, rankSupervisorProgress, summarizeMonthlyProgress, type MonthlyReportRow } from './monthlyReport';

const rows: MonthlyReportRow[] = [
  { id: '1', planType: 'maintenance', plannedDate: '2026-10-01', visitedAt: '2026-10-02', reportCompletedAt: '2026-10-03', supervisorId: 's1', supervisorName: 'أحمد', area: 'وسط' },
  { id: '2', planType: 'cleaning', plannedDate: '2026-10-02', visitedAt: null, reportCompletedAt: null, supervisorId: 's1', supervisorName: 'أحمد', area: 'وسط' },
  { id: '3', planType: 'security_safety', plannedDate: '2026-10-02', visitedAt: null, reportCompletedAt: null, supervisorId: 's2', supervisorName: 'سالم', area: 'شرق' },
];

describe('monthly progress report', () => {
  it('calculates visit and report completion rates from the filtered rows', () => {
    const summary = summarizeMonthlyProgress(rows);
    expect(summary).toMatchObject({ total: 3, visited: 1, reportsCompleted: 1 });
    expect(summary.visitPercent).toBeCloseTo(100 / 3);
    expect(summary.reportPercent).toBeCloseTo(100 / 3);
  });

  it('builds cumulative planned and visited counts for every day in a month', () => {
    const progress = buildDailyProgress(rows, '2026-10');
    expect(progress).toHaveLength(31);
    expect(progress[0]).toEqual({ date: '2026-10-01', planned: 1, actual: 0 });
    expect(progress[2]).toEqual({ date: '2026-10-03', planned: 3, actual: 1 });
    expect(() => buildDailyProgress(rows, '2026-13')).toThrow(RangeError);
  });

  it('ranks overdue and compliant supervisors using maintenance and cleaning only', () => {
    const ranked = rankSupervisorProgress(rows, '2026-10-10');
    expect(ranked.mostOverdue[0]).toMatchObject({ id: 's1', overdueCount: 1 });
    expect(ranked.mostCompliant[0]).toMatchObject({ id: 's1', reportPercent: 50 });
    expect(ranked.mostOverdue.some((row) => row.id === 's2')).toBe(false);
  });
});

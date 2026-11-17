import { describe, expect, it } from 'vitest';
import {
  businessDays,
  lastBusinessDayOfMonth,
  previewRemainingPlanRedistribution,
  type RemainingPlanVisit,
} from './planRedistribution';

const visits: RemainingPlanVisit[] = [
  { id: 'one', schoolId: 's1', schoolName: 'مدرسة أ', supervisorId: 'sup1', supervisorName: 'مشرف أ', plannedDate: '2026-11-12', visited: false },
  { id: 'two', schoolId: 's2', schoolName: 'مدرسة ب', supervisorId: 'sup1', supervisorName: 'مشرف أ', plannedDate: '2026-11-13', visited: false },
  { id: 'three', schoolId: 's3', schoolName: 'مدرسة ج', supervisorId: 'sup1', supervisorName: 'مشرف أ', plannedDate: '2026-11-14', visited: false },
  { id: 'done', schoolId: 's4', schoolName: 'مدرسة د', supervisorId: 'sup1', supervisorName: 'مشرف أ', plannedDate: '2026-11-16', visited: true },
  { id: 'before', schoolId: 's5', schoolName: 'مدرسة هـ', supervisorId: 'sup1', supervisorName: 'مشرف أ', plannedDate: '2026-11-09', visited: false },
];

describe('remaining monthly plan redistribution', () => {
  it('uses Sunday through Thursday and skips registered holidays', () => {
    expect(businessDays('2026-11-08', '2026-11-14', ['2026-11-10'])).toEqual([
      '2026-11-08', '2026-11-09', '2026-11-11', '2026-11-12',
    ]);
    expect(lastBusinessDayOfMonth('2026-11', ['2026-11-30'])).toBe('2026-11-29');
  });

  it('moves only unvisited rows from the start date and respects per-supervisor daily capacity', () => {
    const result = previewRemainingPlanRedistribution({
      rows: visits,
      startDate: '2026-11-12',
      endDate: '2026-11-17',
      holidays: [],
      dailyLimit: 1,
    });

    expect(result.assignments.map(({ rowId, newDate }) => [rowId, newDate])).toEqual([
      ['one', '2026-11-12'],
      ['two', '2026-11-15'],
      ['three', '2026-11-17'],
    ]);
    expect(result.capacityIssues).toEqual([]);
    expect(result.assignments.some(({ rowId }) => ['done', 'before'].includes(rowId))).toBe(false);
  });

  it('reports the exact supervisor capacity deficit and allows a per-operation limit increase', () => {
    const short = previewRemainingPlanRedistribution({
      rows: visits.slice(0, 3),
      startDate: '2026-11-12',
      endDate: '2026-11-15',
      holidays: [],
      dailyLimit: 1,
    });
    expect(short.capacityIssues).toEqual([{ supervisorName: 'مشرف أ', visits: 3, availableDays: 2 }]);

    const raised = previewRemainingPlanRedistribution({
      rows: visits.slice(0, 3),
      startDate: '2026-11-12',
      endDate: '2026-11-15',
      holidays: [],
      dailyLimit: 2,
    });
    expect(raised.capacityIssues).toEqual([]);
    expect(new Set(raised.assignments.map(({ newDate }) => newDate))).toEqual(new Set(['2026-11-12', '2026-11-15']));
    expect(raised.assignments.filter(({ newDate }) => newDate === '2026-11-12')).toHaveLength(2);
  });
});

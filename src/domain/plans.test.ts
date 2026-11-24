import { describe, expect, it } from 'vitest';
import {
  cleaningSupervisorName,
  cleaningSupervisorUpdates,
  monthlySupervisorName,
  distributePlanDates,
  isPlanRowOverdue,
  matchPlanSchoolsByMinistryNumbers,
  matchesPlanCompletionFilters,
  matchesPlanSchoolSearch,
} from './plans';

describe('monthly plan date distribution', () => {
  it('prefers the cleaning supervisor stored with the school and only updates rows with a source name', () => {
    const rows = [
      { id: 'one', supervisorName: 'اسم قديم', schoolSourceFields: { 'اسم المشرف (نظافة)': 'مشرف حقيقي' } },
      { id: 'two', supervisorName: 'مشرف حقيقي', schoolSourceFields: { 'اسم المشرف (نظافة)': 'مشرف حقيقي' } },
      { id: 'three', supervisorName: 'اسم محفوظ', schoolSourceFields: { 'اسم المشرف (نظافة)': '' } },
    ];

    expect(cleaningSupervisorName(rows[0])).toBe('مشرف حقيقي');
    expect(cleaningSupervisorName(rows[2])).toBe('اسم محفوظ');
    expect(cleaningSupervisorUpdates(rows)).toEqual([{ id: 'one', supervisorName: 'مشرف حقيقي' }]);
  });

  it('uses the current maintenance supervisor stored with the school', () => {
    const row = {
      id: 'maintenance-row',
      supervisorName: 'مشرف قديم',
      schoolSourceFields: { 'اسم المشرف (صيانة)': 'مشرف الصيانة المعتمد' },
    };

    expect(monthlySupervisorName(row, 'maintenance')).toBe('مشرف الصيانة المعتمد');
  });

  it('searches plan rows by normalized school name or ministry number', () => {
    const school = {
      schoolName: 'مدرسة أُحد الابتدائية',
      ministryNumber: 'M٠١٠٨٠١',
      ministryKey: '10801',
    };

    expect(matchesPlanSchoolSearch(school, 'أحد')).toBe(true);
    expect(matchesPlanSchoolSearch(school, '  مدرسة أُحد  ')).toBe(true);
    expect(matchesPlanSchoolSearch(school, '٠١٠٨')).toBe(true);
    expect(matchesPlanSchoolSearch(school, 'M10801')).toBe(true);
    expect(matchesPlanSchoolSearch(school, 'مدرسة أخرى')).toBe(false);
    expect(matchesPlanSchoolSearch(school, '')).toBe(true);
  });

  it('matches pasted ministry numbers in Arabic or Latin digits and reports unmatched numbers', () => {
    expect(matchPlanSchoolsByMinistryNumbers('M٠١٠٨٠١، 95183\n99999 10801', [
      { id: 'one', ministryNumber: '10801' },
      { id: 'two', ministryNumber: '٩٥١٨٣' },
    ])).toEqual({
      schoolIds: ['one', 'two'],
      unmatchedNumbers: ['99999'],
      inputCount: 3,
    });
  });

  it('matches visit and report completion filters independently', () => {
    const both = { visitedAt: '2026-11-01', reportCompletedAt: '2026-11-02' };
    const visitOnly = { visitedAt: '2026-11-01', reportCompletedAt: null };
    const neither = { visitedAt: null, reportCompletedAt: null };

    expect(matchesPlanCompletionFilters(both, 'completed', 'all')).toBe(true);
    expect(matchesPlanCompletionFilters(visitOnly, 'completed', 'incomplete')).toBe(true);
    expect(matchesPlanCompletionFilters(visitOnly, 'all', 'completed')).toBe(false);
    expect(matchesPlanCompletionFilters(neither, 'incomplete', 'incomplete')).toBe(true);
    expect(matchesPlanCompletionFilters(neither, 'all', 'all')).toBe(true);
  });

  it('distributes by the daily limit and skips Friday and Saturday', () => {
    const dates = distributePlanDates(['a', 'b', 'c', 'd'], {
      startDate: '2026-11-05',
      schoolsPerDay: 2,
    });
    expect(dates.map((item) => item.plannedDate)).toEqual([
      '2026-11-05',
      '2026-11-05',
      '2026-11-08',
      '2026-11-08',
    ]);
  });

  it('permits weekends only when explicitly configured', () => {
    expect(
      distributePlanDates(['a', 'b'], {
        startDate: '2026-11-06',
        schoolsPerDay: 1,
        skipFridayAndSaturday: false,
      }).map((item) => item.plannedDate),
    ).toEqual(['2026-11-06', '2026-11-07']);
  });

  it('rejects invalid limits, dates, and repeated schools', () => {
    expect(() => distributePlanDates(['a'], { startDate: 'bad', schoolsPerDay: 2 })).toThrow(RangeError);
    expect(() => distributePlanDates(['a', 'a'], { startDate: '2026-11-08', schoolsPerDay: 2 })).toThrow(RangeError);
    expect(() => distributePlanDates([], { startDate: '2026-11-08', schoolsPerDay: 0 })).toThrow(RangeError);
  });

  it('marks a row overdue only after the planned date when either step is incomplete', () => {
    expect(isPlanRowOverdue({ plannedDate: '2026-11-06', visitedAt: null, reportCompletedAt: null }, '2026-11-07')).toBe(true);
    expect(isPlanRowOverdue({ plannedDate: '2026-11-06', visitedAt: '2026-11-06', reportCompletedAt: '2026-11-06' }, '2026-11-07')).toBe(false);
    expect(isPlanRowOverdue({ plannedDate: '2026-11-07', visitedAt: null, reportCompletedAt: null }, '2026-11-07')).toBe(false);
  });
});

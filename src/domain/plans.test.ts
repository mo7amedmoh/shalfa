import { describe, expect, it } from 'vitest';
import { distributePlanDates, isPlanRowOverdue, matchesPlanCompletionFilters, matchesPlanSchoolSearch } from './plans';

describe('monthly plan date distribution', () => {
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

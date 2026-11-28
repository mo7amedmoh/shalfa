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
  it('prefers saved cleaning supervisor text over the sheet, and syncs rows to current assignments', () => {
    const rows = [
      { id: 'one', supervisorName: 'اسم قديم', schoolSourceFields: { 'اسم المشرف (نظافة)': 'مشرف حقيقي' } },
      { id: 'two', supervisorName: 'مشرف حقيقي', schoolSourceFields: { 'اسم المشرف (نظافة)': 'مشرف حقيقي' } },
      { id: 'three', supervisorName: 'اسم محفوظ', schoolSourceFields: { 'اسم المشرف (نظافة)': '' } },
    ];

    expect(cleaningSupervisorName(rows[0])).toBe('اسم قديم');
    expect(cleaningSupervisorName(rows[2])).toBe('اسم محفوظ');
    expect(cleaningSupervisorUpdates(rows)).toEqual([]);
    expect(cleaningSupervisorUpdates([{
      ...rows[0],
      supervisorId: null,
      currentSupervisor: {
        school_id: 'school-1',
        maintenance_supervisor_id: null,
        maintenance_supervisor_name: null,
        cleaning_supervisor_id: 'assigned',
        cleaning_supervisor_name: 'مشرف مسند',
      },
    }])).toEqual([{ id: 'one', supervisorId: 'assigned', supervisorName: 'مشرف مسند' }]);
  });

  it('uses the saved maintenance supervisor instead of an unvalidated name from the school sheet', () => {
    const row = {
      id: 'maintenance-row',
      supervisorName: 'مشرف قديم',
      schoolSourceFields: { 'اسم المشرف (صيانة)': 'مشرف الصيانة المعتمد' },
    };

    expect(monthlySupervisorName(row, 'maintenance')).toBe('مشرف قديم');
    expect(monthlySupervisorName({ ...row, supervisorName: null }, 'maintenance')).toBe('مشرف الصيانة المعتمد');
  });

  it('does not present a name recorded for a school gatekeeper as a maintenance supervisor', () => {
    expect(monthlySupervisorName({
      id: 'maintenance-row',
      supervisorName: 'حارس المدرسة',
      schoolSourceFields: { 'اسم المشرف (صيانة)': 'حارس المدرسة' },
    }, 'maintenance', [' حَارِس المدرسة '])).toBeNull();
  });

  it('does not present a name recorded for a school gatekeeper as a cleaning supervisor', () => {
    expect(monthlySupervisorName({
      id: 'cleaning-row',
      supervisorName: 'حارس المدرسة',
      schoolSourceFields: { 'اسم المشرف (نظافة)': 'حارس المدرسة' },
    }, 'cleaning', [' حَارِس المدرسة '])).toBeNull();
  });

  it('excludes a gatekeeper by employee id even if the saved plan name is different', () => {
    expect(monthlySupervisorName({
      id: 'cleaning-row',
      supervisorId: 'gatekeeper-id',
      supervisorName: 'مازن صالح محمد اليامي',
      schoolSourceFields: null,
    }, 'cleaning', [], true, ['gatekeeper-id'])).toBeNull();
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

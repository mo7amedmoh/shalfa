import { describe, expect, it } from 'vitest';
import { schedulePlan, summarizePlanSchedule, type SchedulerSchool } from './planScheduler';

const schools = (count: number): SchedulerSchool[] => Array.from({ length: count }, (_, index) => ({
  id: `school-${index + 1}`,
  name: `مدرسة ${index + 1}`,
}));

describe('plan scheduler', () => {
  const supervisors = [
    { id: 'one', name: 'مشرف أول' },
    { id: 'two', name: 'مشرف ثان' },
  ];

  it('distributes schools across supervisors and working days within caps', () => {
    const result = schedulePlan(schools(6), {
      startDate: '2026-11-08',
      endDate: '2026-11-11',
      weekendDays: [5, 6],
      defaultMaxSchoolsPerDay: 2,
      supervisors,
      assignmentMode: 'balanced',
      clusterBy: 'none',
    });

    expect(result.summary.days).toEqual(['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11']);
    expect(result.assignments).toHaveLength(6);
    expect(new Set(result.assignments.map((row) => row.supervisorId))).toEqual(new Set(['one', 'two']));
    expect(result.summary.warnings).toEqual([]);
    expect(result.summary.matrix.every((row) => Object.values(row.counts).every((count) => count <= 2))).toBe(true);
  });

  it('preserves written supervisors and applies per-supervisor limits', () => {
    const result = schedulePlan([
      { id: 'one', name: 'مدرسة أولى', supervisorName: 'مشرف المدرسة' },
      { id: 'two', name: 'مدرسة ثانية', supervisorName: 'مشرف المدرسة' },
      { id: 'three', name: 'مدرسة ثالثة', supervisorName: 'مشرف آخر' },
    ], {
      startDate: '2026-11-08',
      endDate: '2026-11-09',
      weekendDays: [],
      defaultMaxSchoolsPerDay: 2,
      supervisors: [{ id: 'local', name: 'مشرف المدرسة', maxSchoolsPerDay: 1 }],
      assignmentMode: 'keep',
      clusterBy: 'none',
    });

    expect(result.assignments.map((row) => row.supervisorName)).toEqual(['مشرف المدرسة', 'مشرف المدرسة', 'مشرف آخر']);
    expect(result.assignments.filter((row) => row.supervisorName === 'مشرف المدرسة').map((row) => row.plannedDate))
      .toEqual(['2026-11-08', '2026-11-09']);
    expect(result.summary.warnings).toEqual([]);
  });

  it('warns when total work exceeds capacity and when an edited day exceeds a cap', () => {
    const assignments = schedulePlan(schools(5), {
      startDate: '2026-11-08',
      endDate: '2026-11-08',
      weekendDays: [],
      defaultMaxSchoolsPerDay: 2,
      supervisors,
      assignmentMode: 'balanced',
      clusterBy: 'none',
    }).assignments;

    expect(assignments.length).toBe(5);
    const summary = summarizePlanSchedule(assignments, {
      startDate: '2026-11-08',
      endDate: '2026-11-08',
      weekendDays: [],
      defaultMaxSchoolsPerDay: 2,
      supervisors,
    });
    expect(summary.warnings.some((warning) => warning.includes('إجمالي المدارس'))).toBe(true);
    expect(summary.warnings.some((warning) => warning.includes('والحد'))).toBe(true);
  });

  it('keeps maintenance visits unique per supervisor and working day', () => {
    const result = schedulePlan(schools(10), {
      startDate: '2026-11-08',
      endDate: '2026-11-12',
      weekendDays: [5, 6],
      defaultMaxSchoolsPerDay: 1,
      singleVisitPerDay: true,
      supervisors,
      assignmentMode: 'balanced',
      clusterBy: 'coordinates',
    });
    const supervisorDays = result.assignments.map((row) => `${row.supervisorId}:${row.plannedDate}`);

    expect(new Set(supervisorDays).size).toBe(result.assignments.length);
    expect(result.summary.errors).toEqual([]);
  });

  it('excludes Fridays, Saturdays, and configured monthly holidays', () => {
    const result = schedulePlan(schools(4), {
      startDate: '2026-11-08',
      endDate: '2026-11-14',
      weekendDays: [5, 6],
      holidays: ['2026-11-11'],
      defaultMaxSchoolsPerDay: 1,
      singleVisitPerDay: true,
      supervisors: [{ id: 'one', name: 'مشرف أول' }],
      assignmentMode: 'balanced',
      clusterBy: 'none',
    });

    expect(result.assignments.map((row) => row.plannedDate)).toEqual([
      '2026-11-08',
      '2026-11-09',
      '2026-11-10',
      '2026-11-12',
    ]);
    expect(result.assignments.every((row) => !['2026-11-13', '2026-11-14'].includes(row.plannedDate))).toBe(true);
  });

  it('rejects a fixed supervisor workload above the available workdays', () => {
    expect(() => schedulePlan(schools(3).map((school) => ({
      ...school,
      supervisorName: 'أحمد',
    })), {
      startDate: '2026-11-08',
      endDate: '2026-11-09',
      weekendDays: [5, 6],
      defaultMaxSchoolsPerDay: 1,
      singleVisitPerDay: true,
      supervisors: [{ id: 'ahmed', name: 'أحمد' }],
      assignmentMode: 'keep',
      clusterBy: 'none',
    })).toThrow('أحمد: 3 مدرسة و2 يوم عمل فقط');
  });

  it('marks manually duplicated supervisor visits as blocking errors', () => {
    const summary = summarizePlanSchedule([
      { schoolId: 'one', supervisorId: 'one', supervisorName: 'أحمد', plannedDate: '2026-11-08' },
      { schoolId: 'two', supervisorId: 'one', supervisorName: 'أحمد', plannedDate: '2026-11-08' },
    ], {
      startDate: '2026-11-08',
      endDate: '2026-11-09',
      weekendDays: [5, 6],
      defaultMaxSchoolsPerDay: 1,
      singleVisitPerDay: true,
      supervisors: [{ id: 'one', name: 'أحمد' }],
    });

    expect(summary.errors).toContain('أحمد: 2 زيارات في 2026-11-08؛ المسموح زيارة واحدة يوميًا.');
  });

  it('uses the correct local calendar date at the end of November', () => {
    const result = schedulePlan(schools(1), {
      startDate: '2026-11-01',
      endDate: '2026-11-30',
      weekendDays: [5, 6],
      defaultMaxSchoolsPerDay: 1,
      singleVisitPerDay: true,
      supervisors: [{ id: 'one', name: 'مشرف أول' }],
      assignmentMode: 'balanced',
      clusterBy: 'none',
    });

    expect(result.summary.days[0]).toBe('2026-11-01');
    expect(result.summary.days[result.summary.days.length - 1]).toBe('2026-11-30');
    expect(result.assignments[0].plannedDate).toBe('2026-11-01');
  });

  it('clusters schools by neighbourhood and validates required inputs', () => {
    const result = schedulePlan([
      { id: 'b', name: 'مدرسة ب', neighbourhood: 'حي ب' },
      { id: 'a', name: 'مدرسة أ', neighbourhood: 'حي أ' },
    ], {
      startDate: '2026-11-08',
      endDate: '2026-11-09',
      weekendDays: [],
      defaultMaxSchoolsPerDay: 3,
      supervisors,
      assignmentMode: 'balanced',
      clusterBy: 'neighbourhood',
    });

    expect(result.assignments.map((row) => row.schoolId)).toEqual(['a', 'b']);
    expect(() => schedulePlan(schools(1), {
      startDate: '2026-11-08',
      endDate: '2026-11-08',
      weekendDays: [],
      defaultMaxSchoolsPerDay: 1,
      supervisors: [],
      assignmentMode: 'balanced',
      clusterBy: 'none',
    })).toThrow('أضف مشرفاً');
    expect(() => schedulePlan(schools(1), {
      startDate: '2026-11-08',
      endDate: '2026-11-08',
      weekendDays: [0, 1, 2, 3, 4, 5, 6],
      defaultMaxSchoolsPerDay: 1,
      supervisors,
      assignmentMode: 'balanced',
      clusterBy: 'none',
    })).toThrow('لا توجد أيام عمل');
  });
});

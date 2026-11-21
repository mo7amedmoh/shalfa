import { describe, expect, it } from 'vitest';
import { getAbsentRosterIds, getAttendanceDays, isBulkAttendanceDateAllowed, summarizeAttendance } from './attendance';

describe('attendance calendar', () => {
  it('counts present marks and all non-working days in the selected month', () => {
    const days = getAttendanceDays('2026-11', [5]);
    const summary = summarizeAttendance(new Set(['2026-11-02', '2026-11-30']), days);

    expect(days).toHaveLength(30);
    expect(summary).toEqual({ presentDays: 2, dayOffs: 4 });
  });

  it('marks Fridays as non-working while leaving Saturdays available', () => {
    const days = getAttendanceDays('2026-11', [5]);

    expect(days.find((day) => day.date === '2026-11-06')?.isNonWorking).toBe(true);
    expect(days.find((day) => day.date === '2026-11-06')?.isFriday).toBe(true);
    expect(days.find((day) => day.date === '2026-11-07')?.isNonWorking).toBe(false);
    expect(isBulkAttendanceDateAllowed('2026-11-06', '2026-11', [5], '2026-11-21')).toBe(false);
    expect(isBulkAttendanceDateAllowed('2026-11-21', '2026-11', [5], '2026-11-21')).toBe(true);
    expect(isBulkAttendanceDateAllowed('2026-11-22', '2026-11', [5], '2026-11-21')).toBe(false);
  });

  it('identifies Fridays for column shading even when weekday settings differ', () => {
    const friday = getAttendanceDays('2026-11', [0]).find((day) => day.date === '2026-11-06');

    expect(friday).toMatchObject({ isFriday: true, isNonWorking: false });
  });

  it('only reports absences on past or current working days in the selected month', () => {
    const rosterIds = ['present', 'absent'];
    const presentIds = new Set(['present']);

    expect(getAbsentRosterIds(rosterIds, presentIds, '2026-11-21', '2026-11', [5], '2026-11-21')).toEqual(['absent']);
    expect(getAbsentRosterIds(rosterIds, presentIds, '2026-11-19', '2026-11', [5], '2026-11-21')).toEqual(['absent']);
    expect(getAbsentRosterIds(rosterIds, presentIds, '2026-11-22', '2026-11', [5], '2026-11-21')).toEqual([]);
    expect(getAbsentRosterIds(rosterIds, presentIds, '2026-12-01', '2026-11', [5], '2026-12-02')).toEqual([]);
  });
});

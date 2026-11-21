import { describe, expect, it } from 'vitest';
import { planAttendanceRosterImport } from './attendanceImport';

describe('attendance roster import planning', () => {
  it('matches workers by identity and preserves attendance for matched rows', () => {
    const plan = planAttendanceRosterImport(
      [
        { id: 'existing-1', worker_id_number: '1234567890' },
        { id: 'existing-2', worker_id_number: '9876543210' },
      ],
      ['1234567890', '1111111111'],
      new Set(['existing-1', 'existing-2']),
    );

    expect(plan).toEqual({
      deleted: [{ id: 'existing-2', worker_id_number: '9876543210' }],
      addedCount: 1,
      deletedWithAttendanceCount: 1,
    });
  });

  it('matches duplicate identities one-to-one and does not match blank identities', () => {
    const plan = planAttendanceRosterImport(
      [
        { id: 'existing-1', worker_id_number: '1234567890' },
        { id: 'existing-2', worker_id_number: '1234567890' },
      ],
      ['1234567890', '1234567890', null],
      new Set(),
    );

    expect(plan.deleted).toEqual([]);
    expect(plan.addedCount).toBe(1);
    expect(plan.deletedWithAttendanceCount).toBe(0);
  });
});

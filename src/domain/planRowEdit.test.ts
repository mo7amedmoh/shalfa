import { describe, expect, it } from 'vitest';
import {
  buildPlanEditReason,
  getPlanEditWarnings,
  requiresVisitEditReason,
} from './planRowEdit';

describe('monthly plan row edits', () => {
  it('warns for Friday/Saturday and duplicate supervisor visits, excluding swapped rows', () => {
    const rows = [
      { id: 'current', plannedDate: '2026-11-20', supervisorId: 'supervisor-1' },
      { id: 'swap', plannedDate: '2026-11-21', supervisorId: 'supervisor-2' },
      { id: 'other', plannedDate: '2026-11-20', supervisorId: 'supervisor-1' },
    ];

    expect(getPlanEditWarnings({
      plannedDate: '2026-11-20',
      supervisorId: 'supervisor-1',
      rows,
      excludedRowIds: ['current', 'swap'],
      scheduleChanged: true,
    })).toEqual(['weekend', 'supervisor_conflict']);
    expect(getPlanEditWarnings({
      plannedDate: '2026-11-20',
      supervisorId: 'supervisor-1',
      rows,
      excludedRowIds: ['current', 'other'],
      scheduleChanged: true,
    })).toEqual(['weekend']);
  });

  it('only requires a reason for a visited row when its school or date changes', () => {
    expect(requiresVisitEditReason({ visited: true, schoolChanged: true, dateChanged: false })).toBe(true);
    expect(requiresVisitEditReason({ visited: true, schoolChanged: false, dateChanged: true })).toBe(true);
    expect(requiresVisitEditReason({ visited: true, schoolChanged: false, dateChanged: false })).toBe(false);
    expect(requiresVisitEditReason({ visited: false, schoolChanged: true, dateChanged: true })).toBe(false);
  });

  it('stores the schedule warning override with the audit reason', () => {
    expect(buildPlanEditReason('ظرف طارئ', ['weekend'])).toBe(
      'ظرف طارئ\nتجاوز تحذير الجدولة: الموعد يقع يوم الجمعة أو السبت.',
    );
    expect(buildPlanEditReason('', [])).toBeNull();
  });
});

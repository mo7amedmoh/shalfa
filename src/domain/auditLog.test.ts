import { describe, expect, it } from 'vitest';
import { getAuditUndoState } from './auditLog';

const editEvent = {
  id: 12,
  action: 'edit_plan_row',
  details: { changes: { planned_date: { old: '2026-11-01', new: '2026-11-02' } } },
};

describe('audit log undo state', () => {
  it('only enables undo for a standalone plan edit with old and new values', () => {
    expect(getAuditUndoState(editEvent, [editEvent])).toBe('available');
    expect(getAuditUndoState({ ...editEvent, details: { ...editEvent.details, swap_row_id: 'other' } }, [])).toBe('unsupported');
    expect(getAuditUndoState({ ...editEvent, details: { changes: { planned_date: { new: '2026-11-02' } } } }, [])).toBe('unsupported');
    expect(getAuditUndoState({ ...editEvent, details: { changes: { other: { old: 1, new: 2 } } } }, [])).toBe('unsupported');
    expect(getAuditUndoState({ ...editEvent, action: 'DELETE' }, [])).toBe('unsupported');
  });

  it('uses the latest recorded operation to alternate undo and redo', () => {
    const undo = { id: 14, action: 'undo_plan_row_edit', details: { source_audit_id: '12' } };
    const redo = { id: 15, action: 'redo_plan_row_edit', details: { source_audit_id: '12' } };
    expect(getAuditUndoState(editEvent, [undo, editEvent])).toBe('undone');
    expect(getAuditUndoState(editEvent, [redo, undo, editEvent])).toBe('available');
  });
});

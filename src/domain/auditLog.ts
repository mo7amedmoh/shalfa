type AuditEvent = {
  id: number;
  action: string;
  details: Record<string, unknown> | null;
};

export type AuditUndoState = 'available' | 'undone' | 'unsupported';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasReversiblePlanChanges(details: Record<string, unknown> | null): boolean {
  if (!details || details.swap_row_id) return false;
  const changes = details.changes;
  if (!isRecord(changes) || !Object.keys(changes).length) return false;
  const allowedFields = new Set(['school_id', 'supervisor_id', 'planned_date']);
  return Object.values(changes).every((change) => (
    isRecord(change) && Object.hasOwn(change, 'old') && Object.hasOwn(change, 'new')
  )) && Object.keys(changes).every((field) => allowedFields.has(field));
}

export function getAuditUndoState(event: AuditEvent, events: readonly AuditEvent[]): AuditUndoState {
  if (event.action !== 'edit_plan_row' || !hasReversiblePlanChanges(event.details)) return 'unsupported';
  const latestState = events.find((candidate) => (
    (candidate.action === 'undo_plan_row_edit' || candidate.action === 'redo_plan_row_edit')
    && candidate.details?.source_audit_id === String(event.id)
  ));
  return latestState?.action === 'undo_plan_row_edit' ? 'undone' : 'available';
}

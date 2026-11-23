import { describe, expect, it } from 'vitest';
import {
  canCancelInventoryRequest,
  canTransitionInventoryRequest,
  getInventoryIssueOutcome,
  getSuggestedInventoryItems,
  hasQuantityWarning,
  inventoryRequestStatusLabels,
  validateApprovalQuantities,
  validateIssueQuantities,
  type RecentInventoryItem,
} from './inventoryRequestsModel';

describe('inventory request states and quantities', () => {
  it('allows only the declared request state transitions', () => {
    const statuses = ['draft', 'submitted', 'approved', 'partially_issued', 'rejected', 'issued', 'cancelled'] as const;
    const allowedTransitions = new Set([
      'draft:submitted',
      'draft:cancelled',
      'submitted:approved',
      'submitted:rejected',
      'submitted:cancelled',
      'approved:partially_issued',
      'approved:issued',
      'partially_issued:issued',
    ]);

    for (const from of statuses) {
      for (const to of statuses) {
        expect(canTransitionInventoryRequest(from, to), `${from} -> ${to}`).toBe(allowedTransitions.has(`${from}:${to}`));
      }
    }
  });

  it('rejects empty or excessive approvals and validates full or partial issue quantities', () => {
    expect(validateApprovalQuantities([])).toBeTruthy();
    expect(validateApprovalQuantities([{ requested: 4, approved: 5 }])).toBeTruthy();
    expect(validateApprovalQuantities([{ requested: 4, approved: 0 }])).toBeTruthy();
    expect(validateApprovalQuantities([{ requested: 4, approved: 3 }])).toBeNull();
    expect(validateIssueQuantities([{ remaining: 3, issuing: 0 }])).toBeTruthy();
    expect(validateIssueQuantities([{ remaining: 2, issuing: 3 }])).toBeTruthy();
    expect(validateIssueQuantities([{ remaining: 3, issuing: 1 }])).toBeNull();
    expect(getInventoryIssueOutcome([{ approved: 4, alreadyIssued: 1, issuing: 2 }])).toBe('partially_issued');
    expect(getInventoryIssueOutcome([{ approved: 4, alreadyIssued: 1, issuing: 3 }])).toBe('issued');
  });

  it('only allows cancellation before approval', () => {
    expect(canCancelInventoryRequest('draft')).toBe(true);
    expect(canCancelInventoryRequest('submitted')).toBe(true);
    expect(canCancelInventoryRequest('approved')).toBe(false);
    expect(canCancelInventoryRequest('partially_issued')).toBe(false);
    expect(canCancelInventoryRequest('issued')).toBe(false);
    expect(canCancelInventoryRequest('rejected')).toBe(false);
    expect(canCancelInventoryRequest('cancelled')).toBe(false);
  });

  it('warns when requested quantity exceeds known available stock without blocking uncounted items', () => {
    expect(hasQuantityWarning(5, 4)).toBe(true);
    expect(hasQuantityWarning(4, 4)).toBe(false);
    expect(hasQuantityWarning(5, null)).toBe(false);
    expect(hasQuantityWarning(0, 0)).toBe(false);
  });

  it('shows the ten most recently requested distinct items', () => {
    const items: RecentInventoryItem[] = Array.from({ length: 11 }, (_, index) => ({
      item_id: `item-${index}`,
      name: `صنف ${index}`,
      logix_code: null,
      unit: 'قطعة',
      available: 2,
      last_requested_at: `2026-11-${String(index + 1).padStart(2, '0')}T10:00:00Z`,
    }));
    items.push({ ...items[0], last_requested_at: '2026-11-23T12:00:00Z' });

    const result = getSuggestedInventoryItems(items);

    expect(result).toHaveLength(10);
    expect(result[0].item_id).toBe('item-0');
    expect(new Set(result.map((item) => item.item_id)).size).toBe(10);
  });

  it('labels every request state for the status list', () => {
    expect(Object.keys(inventoryRequestStatusLabels)).toEqual([
      'draft',
      'submitted',
      'approved',
      'rejected',
      'issued',
      'partially_issued',
      'cancelled',
    ]);
  });
});

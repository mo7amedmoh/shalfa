export type InventoryRequestStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'issued'
  | 'partially_issued'
  | 'cancelled';

export const inventoryRequestQueryKeys = {
  schools: ['inventory-request-schools'],
  items: ['inventory-request-items'],
  requests: ['inventory-my-requests'],
  suggestions: ['inventory-request-suggestions'],
} as const;

export const inventoryWorkflowQueryKeys = {
  review: [...inventoryRequestQueryKeys.requests, 'review'],
  issue: [...inventoryRequestQueryKeys.requests, 'issue'],
  stamp: ['inventory-approver-stamp'],
} as const;

export const inventoryRequestStatusLabels: Record<InventoryRequestStatus, string> = {
  draft: 'مسودة',
  submitted: 'بانتظار اعتماد المهندس',
  approved: 'معتمد',
  rejected: 'مرفوض',
  issued: 'تم الصرف',
  partially_issued: 'صُرف جزئيًا',
  cancelled: 'ملغي',
};

const inventoryRequestTransitions: Record<InventoryRequestStatus, readonly InventoryRequestStatus[]> = {
  draft: ['submitted', 'cancelled'],
  submitted: ['approved', 'rejected', 'cancelled'],
  approved: ['partially_issued', 'issued'],
  partially_issued: ['issued'],
  rejected: [],
  issued: [],
  cancelled: [],
};

export function canTransitionInventoryRequest(
  from: InventoryRequestStatus,
  to: InventoryRequestStatus,
): boolean {
  return inventoryRequestTransitions[from].includes(to);
}

export function validateApprovalQuantities(
  lines: readonly { requested: number; approved: number }[],
): string | null {
  if (!lines.length) return 'أبقِ صنفًا واحدًا على الأقل في الطلب.';
  if (lines.some((line) => !Number.isFinite(line.approved) || line.approved <= 0 || line.approved > line.requested)) {
    return 'كمية الاعتماد يجب أن تكون أكبر من صفر وألا تتجاوز الكمية المطلوبة.';
  }
  return null;
}

export function validateIssueQuantities(
  lines: readonly { remaining: number; issuing: number }[],
): string | null {
  if (!lines.some((line) => Number.isFinite(line.issuing) && line.issuing > 0)) {
    return 'أدخل كمية موجبة لصنف واحد على الأقل.';
  }
  if (lines.some((line) => !Number.isFinite(line.issuing) || line.issuing < 0 || line.issuing > line.remaining)) {
    return 'كمية الصرف يجب ألا تتجاوز الكمية المعتمدة المتبقية.';
  }
  return null;
}

export function getInventoryIssueOutcome(
  lines: readonly { approved: number; alreadyIssued: number; issuing: number }[],
): Extract<InventoryRequestStatus, 'issued' | 'partially_issued'> {
  return lines.every((line) => line.alreadyIssued + line.issuing >= line.approved)
    ? 'issued'
    : 'partially_issued';
}

export function canCancelInventoryRequest(status: InventoryRequestStatus): boolean {
  return status === 'draft' || status === 'submitted';
}

export function hasQuantityWarning(quantity: number, available: number | null): boolean {
  return Number.isFinite(quantity) && quantity > 0 && available !== null && quantity > available;
}

export type RecentInventoryItem = {
  item_id: string;
  name: string;
  logix_code: string | null;
  unit: string;
  available: number | null;
  last_requested_at: string;
};

export function getSuggestedInventoryItems<T extends RecentInventoryItem>(
  items: readonly T[],
  limit = 10,
): T[] {
  const sorted = [...items].sort((left, right) => {
    const dateDifference = Date.parse(right.last_requested_at) - Date.parse(left.last_requested_at);
    return Number.isNaN(dateDifference) || dateDifference === 0
      ? left.name.localeCompare(right.name)
      : dateDifference;
  });
  const uniqueItems = new Map<string, T>();
  for (const item of sorted) {
    if (!uniqueItems.has(item.item_id)) uniqueItems.set(item.item_id, item);
  }
  return [...uniqueItems.values()].slice(0, Math.max(0, limit));
}

export type InventoryOrderStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'issued'
  | 'partially_issued'
  | 'cancelled';

export type InventoryOrderLine = {
  logixCode: string | null;
  name: string;
  unit: string;
  quantity: number;
  note: string | null;
};

export type InventoryOrderRow = {
  key: string;
  number: string;
  logixCode: string;
  name: string;
  unit: string;
  quantity: string;
  note: string;
};

export function isApprovedInventoryOrder(status: InventoryOrderStatus): boolean {
  return status === 'approved' || status === 'partially_issued' || status === 'issued';
}

export function createInventoryOrderRows(
  items: readonly InventoryOrderLine[],
  minimumRows = 23,
): InventoryOrderRow[] {
  const rows = items.map((item, index) => ({
    key: `item-${index}`,
    number: String(index + 1),
    logixCode: item.logixCode ?? '',
    name: item.name,
    unit: item.unit,
    quantity: String(item.quantity),
    note: item.note ?? '',
  }));
  const blankCount = Math.max(0, minimumRows - rows.length);
  for (let index = 0; index < blankCount; index += 1) {
    rows.push({
      key: `blank-${index}`,
      number: '',
      logixCode: '',
      name: '',
      unit: '',
      quantity: '',
      note: '',
    });
  }
  return rows;
}

export function formatInventoryOrderDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('تاريخ أمر الصرف غير صالح.');
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Asia/Riyadh',
  }).format(date);
}

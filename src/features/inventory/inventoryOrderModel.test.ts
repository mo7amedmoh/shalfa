import { describe, expect, it } from 'vitest';
import {
  createInventoryOrderRows,
  formatInventoryOrderDate,
  isApprovedInventoryOrder,
  type InventoryOrderStatus,
} from './inventoryOrderModel';

describe('inventory order model', () => {
  it('only treats approved and issued requests as signed orders', () => {
    const statuses: InventoryOrderStatus[] = [
      'draft', 'submitted', 'approved', 'rejected', 'issued', 'partially_issued', 'cancelled',
    ];
    expect(statuses.filter(isApprovedInventoryOrder)).toEqual(['approved', 'issued', 'partially_issued']);
  });

  it('pads forms to 23 rows without printing zeros into empty cells', () => {
    const rows = createInventoryOrderRows([{
      logixCode: null,
      name: 'مصباح',
      unit: 'قطعة',
      quantity: 3,
      note: null,
    }]);

    expect(rows).toHaveLength(23);
    expect(rows[0]).toMatchObject({ number: '1', logixCode: '', name: 'مصباح', quantity: '3', note: '' });
    expect(rows[1]).toMatchObject({ number: '', logixCode: '', name: '', unit: '', quantity: '', note: '' });
  });

  it('keeps every item when the order exceeds the minimum row count', () => {
    const rows = createInventoryOrderRows(Array.from({ length: 25 }, (_, index) => ({
      logixCode: String(index + 1),
      name: `صنف ${index + 1}`,
      unit: 'قطعة',
      quantity: index + 1,
      note: null,
    })));

    expect(rows).toHaveLength(25);
    expect(rows[24]).toMatchObject({ number: '25', logixCode: '25', quantity: '25' });
  });

  it('formats the saved order date in the Riyadh timezone', () => {
    expect(formatInventoryOrderDate('2026-11-22T21:30:00.000Z')).toBe('23/11/2026');
    expect(() => formatInventoryOrderDate('invalid')).toThrow('تاريخ أمر الصرف غير صالح.');
  });
});

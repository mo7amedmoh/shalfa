import { describe, expect, it } from 'vitest';
import { filterInventoryItems, getInventoryShortageCounts, type InventoryListItem } from './inventoryModel';

const items: InventoryListItem[] = [
  { item_id: 'one', name: 'مفتاح كهربائي', logix_code: 'LX-1', category_id: 'electrical', status: 'low' },
  { item_id: 'two', name: 'مصباح', logix_code: null, category_id: 'electrical', status: 'out' },
  { item_id: 'three', name: 'صمام', logix_code: 'LX-3', category_id: 'plumbing', status: 'available' },
  { item_id: 'four', name: 'مادة غير مجرودة', logix_code: null, category_id: 'plumbing', status: 'uncounted' },
];

describe('inventory list filtering', () => {
  it('counts shortages without treating uncounted items as out', () => {
    expect(getInventoryShortageCounts(items)).toEqual({ out: 1, low: 1 });
  });

  it('combines search, category, state and shortage-only filters', () => {
    expect(filterInventoryItems(items, {
      search: 'lx-',
      categoryId: 'electrical',
      status: 'low',
      shortagesOnly: true,
    }).map((item) => item.item_id)).toEqual(['one']);
  });

  it('includes only low and out items in shortage-only mode', () => {
    expect(filterInventoryItems(items, {
      search: '',
      categoryId: 'all',
      status: 'all',
      shortagesOnly: true,
    }).map((item) => item.item_id)).toEqual(['one', 'two']);
  });
});

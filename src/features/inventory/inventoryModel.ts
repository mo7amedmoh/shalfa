export type InventoryStatus = 'available' | 'low' | 'out' | 'uncounted';

export type InventoryListItem = {
  item_id: string;
  name: string;
  logix_code: string | null;
  category_id: string;
  status: InventoryStatus;
};

export type InventoryShortageCounts = { out: number; low: number };

export function getInventoryShortageCounts(items: readonly Pick<InventoryListItem, 'status'>[]): InventoryShortageCounts {
  return items.reduce<InventoryShortageCounts>((counts, item) => {
    if (item.status === 'out') counts.out += 1;
    if (item.status === 'low') counts.low += 1;
    return counts;
  }, { out: 0, low: 0 });
}

export function filterInventoryItems<T extends InventoryListItem>(
  items: readonly T[],
  filters: {
    search: string;
    categoryId: string;
    status: InventoryStatus | 'all';
    shortagesOnly: boolean;
  },
): T[] {
  const search = filters.search.trim().toLocaleLowerCase();
  return items.filter((item) => {
    if (filters.categoryId !== 'all' && item.category_id !== filters.categoryId) return false;
    if (filters.status !== 'all' && item.status !== filters.status) return false;
    if (filters.shortagesOnly && item.status !== 'out' && item.status !== 'low') return false;
    if (!search) return true;
    return item.name.toLocaleLowerCase().includes(search)
      || (item.logix_code ?? '').toLocaleLowerCase().includes(search);
  });
}

export const TABLE_PAGE_SIZE = 10;

export function paginateRows<T>(rows: readonly T[], requestedPage: number) {
  const pageCount = Math.max(1, Math.ceil(rows.length / TABLE_PAGE_SIZE));
  const currentPage = Math.min(Math.max(requestedPage, 1), pageCount);
  const start = (currentPage - 1) * TABLE_PAGE_SIZE;

  return {
    currentPage,
    pageCount,
    rows: rows.slice(start, start + TABLE_PAGE_SIZE),
  };
}

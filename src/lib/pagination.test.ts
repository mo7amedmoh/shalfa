import { describe, expect, it } from 'vitest';
import { paginateRows } from './pagination';

describe('paginateRows', () => {
  it('returns an empty first page when there are no rows', () => {
    expect(paginateRows([], 1)).toEqual({ currentPage: 1, pageCount: 1, rows: [] });
  });

  it('returns only the requested page and reports the total page count', () => {
    const rows = Array.from({ length: 23 }, (_, index) => index + 1);

    expect(paginateRows(rows, 2)).toEqual({
      currentPage: 2,
      pageCount: 3,
      rows: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
    });
  });

  it('clamps a stale page number to the final page after results shrink', () => {
    const rows = Array.from({ length: 12 }, (_, index) => index + 1);

    expect(paginateRows(rows, 5)).toEqual({
      currentPage: 2,
      pageCount: 2,
      rows: [11, 12],
    });
  });
});

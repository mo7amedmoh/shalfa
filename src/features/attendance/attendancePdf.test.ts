import { describe, expect, it } from 'vitest';
import { splitAttendancePdfRows } from './attendancePdf';

describe('attendance PDF print pagination', () => {
  it('splits long rosters into sections of approximately 50 rows', () => {
    const rows = Array.from({ length: 101 }, (_, index) => index);
    expect(splitAttendancePdfRows(rows).map((section) => section.length)).toEqual([50, 50, 1]);
  });

  it('supports an empty roster without creating a print section', () => {
    expect(splitAttendancePdfRows([])).toEqual([]);
  });

  it('rejects an invalid page size', () => {
    expect(() => splitAttendancePdfRows([1], 0)).toThrow(RangeError);
  });
});

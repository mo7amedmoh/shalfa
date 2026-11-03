import { describe, expect, it } from 'vitest';
import { deduplicateSchoolRows, normalizeSheetSchoolSize } from './schoolSync';

const row = (ministry_no: string, name: string) => ({
  ministry_no,
  name,
  extra: {},
  size_source: null,
  class_count: null,
  lat: null,
  lng: null,
  synced_at: '2026-11-03T00:00:00.000Z',
});

describe('deduplicateSchoolRows', () => {
  it('keeps the first row for each ministry number and counts ignored duplicates', () => {
    const result = deduplicateSchoolRows([
      row('95183', 'المدرسة الأولى'),
      row('95184', 'مدرسة أخرى'),
      row('95183', 'نسخة مكررة'),
    ]);

    expect(result).toEqual({
      rows: [row('95183', 'المدرسة الأولى'), row('95184', 'مدرسة أخرى')],
      duplicateCount: 1,
    });

  });

  it('leaves unique ministry numbers unchanged', () => {
    const rows = [row('95183', 'مدرسة'), row('95184', 'مدرسة أخرى')];
    expect(deduplicateSchoolRows(rows)).toEqual({ rows, duplicateCount: 0 });
  });
});

describe('normalizeSheetSchoolSize', () => {
  it.each([
    ['S', 'small'],
    [' s ', 'small'],
    ['M', 'medium'],
    [' m ', 'medium'],
    ['L', 'large'],
    [' l ', 'large'],
  ] as const)('normalizes %s to %s', (value, size) => {
    expect(normalizeSheetSchoolSize(value)).toBe(size);
  });

  it('does not infer a size from unrecognized values', () => {
    expect(normalizeSheetSchoolSize('XL')).toBeNull();
    expect(normalizeSheetSchoolSize(null)).toBeNull();
  });
});

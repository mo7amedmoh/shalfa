import { describe, expect, it } from 'vitest';
import { currentMonthBusinessDays, parseMinistryNumberList } from './schoolSupervisorAssignments';

describe('school supervisor assignment helpers', () => {
  it('normalizes and deduplicates pasted ministry numbers with common separators', () => {
    expect(parseMinistryNumberList(' M٠١٢٣، 00456\n456; ٠٠٧٨ ')).toEqual(['123', '456', '78']);
    expect(parseMinistryNumberList(' \n، ; ')).toEqual([]);
  });

  it('counts current-month Sunday-to-Thursday workdays excluding configured holidays', () => {
    expect(currentMonthBusinessDays('2026-11-24', ['2026-11-08'])).toHaveLength(21);
    expect(currentMonthBusinessDays('2026-11-24', [])).toHaveLength(22);
  });

  it('rejects invalid current dates', () => {
    expect(() => currentMonthBusinessDays('2026-02-31', [])).toThrow('تاريخ اليوم غير صالح.');
  });
});

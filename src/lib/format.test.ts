import { describe, expect, it } from 'vitest';
import { formatDate, formatNumerals } from './format';

describe('display formatting', () => {
  it('converts between Latin and Arabic-Indic digits', () => {
    expect(formatNumerals('2026/11/03', 'arabic_indic')).toBe('٢٠٢٦/١١/٠٣');
    expect(formatNumerals('٢٠٢٦/١١/٠٣', 'latin')).toBe('2026/11/03');
  });

  it('formats Gregorian dates and rejects invalid input', () => {
    expect(formatDate('2026-11-03', 'dd/mm/yyyy')).toBe('03/11/2026');
    expect(() => formatDate('bad', 'yyyy/mm/dd')).toThrow(RangeError);
  });
});

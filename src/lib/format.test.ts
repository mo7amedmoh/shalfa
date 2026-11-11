import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatNumerals } from './format';

describe('display formatting', () => {
  it('converts between Latin and Arabic-Indic digits', () => {
    expect(formatNumerals('2026/11/03', 'arabic_indic')).toBe('٢٠٢٦/١١/٠٣');
    expect(formatNumerals('٢٠٢٦/١١/٠٣', 'latin')).toBe('2026/11/03');
  });

  it('formats Gregorian dates and rejects invalid input', () => {
    expect(formatDate('2026-11-03', 'dd/mm/yyyy')).toBe('03/11/2026');
    expect(() => formatDate('bad', 'yyyy/mm/dd')).toThrow(RangeError);
  });

  it('formats timestamps using date and numeral preferences without locale bidi characters', () => {
    const formatted = formatDateTime('2026-11-03T09:07:00', 'dd/mm/yyyy', 'arabic_indic');

    expect(formatted).toBe('٠٣/١١/٢٠٢٦ ٠٩:٠٧');
    expect(formatted).not.toMatch(/[\u200e\u200f\u202a-\u202e]/);
  });
});

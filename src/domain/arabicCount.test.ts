import { describe, expect, it } from 'vitest';
import { formatArabicCount } from './arabicCount';

const forms = { one: 'زيارة', two: 'زيارتان', few: 'زيارات', many: 'زيارة' };
const formatNumber = (value: number) => String(value);

describe('formatArabicCount', () => {
  it.each([
    [0, '0 زيارات'],
    [1, '1 زيارة'],
    [2, '2 زيارتان'],
    [3, '3 زيارات'],
    [10, '10 زيارات'],
    [11, '11 زيارة'],
    [24, '24 زيارة'],
  ])('formats %i with the matching Arabic form', (count, expected) => {
    expect(formatArabicCount(count, formatNumber, forms)).toBe(expected);
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid counts: %s', (count) => {
    expect(() => formatArabicCount(count, formatNumber, forms)).toThrow(RangeError);
  });
});

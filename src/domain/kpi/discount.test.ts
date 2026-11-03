import { describe, expect, it } from 'vitest';
import { calculateDiscount } from './discount';

describe('contract discount matrix', () => {
  it('uses the scorecard month for the grace period and accountability', () => {
    expect(calculateDiscount('2026-07-01', 68, '2026-09-01')).toMatchObject({ contractMonth: 3, accountable: false, payablePercent: 95 });
    expect(calculateDiscount('2026-07-01', 88, '2026-10-01')).toMatchObject({ contractMonth: 4, accountable: true, payablePercent: 98 });
  });

  it('calculates withholding at rating boundaries', () => {
    expect(calculateDiscount('2026-07-01', 90, '2027-01-01', 1000)).toMatchObject({ contractMonth: 7, payablePercent: 99, withheldAmount: 10 });
    expect(calculateDiscount('2026-07-01', 84.99, '2027-01-01', 1000).payablePercent).toBe(94);
  });

  it('rejects score dates before the contract starts', () => {
    expect(() => calculateDiscount('2026-07-01', 90, '2026-06-01')).toThrow(/cannot precede/);
  });

  it('rejects invalid dates, scores, and invoices', () => {
    expect(() => calculateDiscount('bad', 90, '2026-07-01')).toThrow(RangeError);
    expect(() => calculateDiscount('2026-07-01', 90, 'bad')).toThrow(RangeError);
    expect(() => calculateDiscount('2026-07-01', 101, '2026-07-01')).toThrow(RangeError);
    expect(() => calculateDiscount('2026-07-01', 90, '2026-07-01', -1)).toThrow(RangeError);
  });
});

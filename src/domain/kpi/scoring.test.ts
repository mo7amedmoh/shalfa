import { describe, expect, it } from 'vitest';
import { averageApplicableScores, ratingBand } from './scoring';

describe('shared KPI scoring helpers', () => {
  it('excludes not-applicable indicators from an average', () => {
    expect(averageApplicableScores([1, null, 0.5])).toBe(0.75);
    expect(averageApplicableScores([null])).toBeNull();
  });

  it('applies rating thresholds', () => {
    expect(ratingBand(95)).toBe('excellent');
    expect(ratingBand(85)).toBe('average');
    expect(ratingBand(84.99)).toBe('weak');
  });

  it('rejects invalid scores', () => {
    expect(() => averageApplicableScores([1.1])).toThrow(RangeError);
    expect(() => ratingBand(100.1)).toThrow(RangeError);
  });
});

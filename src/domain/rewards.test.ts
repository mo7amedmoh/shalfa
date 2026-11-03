import { describe, expect, it } from 'vitest';
import { calculateRewardBalance, canAllocateReward } from './rewards';

describe('technician reward allocation', () => {
  it('calculates remaining balance to two decimal places', () => {
    expect(calculateRewardBalance(500, [100, 25.55])).toEqual({
      poolAmount: 500,
      allocatedAmount: 125.55,
      remainingAmount: 374.45,
    });
  });

  it('prevents over-allocation and invalid values', () => {
    expect(canAllocateReward(calculateRewardBalance(100, [75]), 26)).toBe(false);
    expect(() => calculateRewardBalance(10, [5, 6])).toThrow(RangeError);
    expect(() => calculateRewardBalance(-1, [])).toThrow(RangeError);
  });
});

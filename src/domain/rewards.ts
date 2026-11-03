export interface RewardBalance {
  poolAmount: number;
  allocatedAmount: number;
  remainingAmount: number;
}

export function calculateRewardBalance(
  poolAmount: number,
  allocations: readonly number[],
): RewardBalance {
  if (!Number.isFinite(poolAmount) || poolAmount < 0) {
    throw new RangeError('Reward pool must be non-negative.');
  }
  if (allocations.some((amount) => !Number.isFinite(amount) || amount < 0)) {
    throw new RangeError('Reward allocations must be non-negative.');
  }
  const allocatedAmount = Math.round(allocations.reduce((sum, amount) => sum + amount, 0) * 100) / 100;
  if (allocatedAmount > poolAmount) {
    throw new RangeError('Reward allocations exceed the approved pool.');
  }
  return {
    poolAmount,
    allocatedAmount,
    remainingAmount: Math.round((poolAmount - allocatedAmount) * 100) / 100,
  };
}

export function canAllocateReward(balance: RewardBalance, amount: number): boolean {
  return Number.isFinite(amount) && amount >= 0 && amount <= balance.remainingAmount;
}

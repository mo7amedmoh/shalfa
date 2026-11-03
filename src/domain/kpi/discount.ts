const monthBands = {
  1: [1, 1, 1, 1, 1, 1, 1],
  2: [1, 1, 1, 1, 1, 0.975, 0.975],
  3: [1, 1, 1, 0.95, 0.95, 0.95, 0.95],
  4: [1, 1, 0.98, 0.95, 0.94, 0.92, 0.9],
  7: [1, 0.99, 0.96, 0.94, 0.9, 0.85, 0.8],
} as const;

export interface DiscountResult {
  contractMonth: number;
  accountable: boolean;
  payablePercent: number;
  withheldAmount: number | null;
}

function parseIsoDate(value: string): Date {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new RangeError('Dates must use the ISO calendar format YYYY-MM-DD.');
  }
  return parsed;
}

export function calculateDiscount(
  contractStartDate: string,
  scorePercent: number,
  scoreDate: string,
  invoiceAmount?: number,
): DiscountResult {
  const contractStart = parseIsoDate(contractStartDate);
  const scoreMonth = parseIsoDate(scoreDate);
  if (!Number.isFinite(scorePercent) || scorePercent < 0 || scorePercent > 100) {
    throw new RangeError('KPI score must be between zero and one hundred.');
  }
  if (invoiceAmount !== undefined && (!Number.isFinite(invoiceAmount) || invoiceAmount < 0)) {
    throw new RangeError('Invoice amount must be non-negative.');
  }

  const monthDifference = (scoreMonth.getUTCFullYear() - contractStart.getUTCFullYear()) * 12 +
    scoreMonth.getUTCMonth() - contractStart.getUTCMonth();
  if (monthDifference < 0) throw new RangeError('KPI score date cannot precede the contract start date.');
  const contractMonth = monthDifference + 1;
  const band = scorePercent >= 95 ? 0
    : scorePercent >= 90 ? 1
      : scorePercent >= 85 ? 2
        : scorePercent >= 80 ? 3
          : scorePercent >= 75 ? 4
            : scorePercent >= 70 ? 5
              : 6;
  const bandRow = contractMonth <= 3
    ? monthBands[contractMonth as 1 | 2 | 3]
    : contractMonth <= 6
      ? monthBands[4]
      : monthBands[7];
  const payablePercent = bandRow[band] * 100;
  return {
    contractMonth,
    accountable: contractMonth >= 4,
    payablePercent,
    withheldAmount: invoiceAmount === undefined
      ? null
      : Math.round(invoiceAmount * (1 - payablePercent / 100) * 100) / 100,
  };
}

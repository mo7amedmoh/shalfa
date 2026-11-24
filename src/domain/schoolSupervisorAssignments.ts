import { normalizeMinistryNumber } from './imports';
import { businessDays } from './planRedistribution';

export function parseMinistryNumberList(value: string): string[] {
  const numbers = value.split(/[\s,،;؛]+/u)
    .map((item) => normalizeMinistryNumber(item))
    .filter(Boolean);
  return [...new Set(numbers)];
}

export function currentMonthBusinessDays(today: string, holidays: readonly string[]): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    throw new RangeError('تاريخ اليوم غير صالح.');
  }
  const parsedToday = new Date(`${today}T00:00:00.000Z`);
  if (!Number.isFinite(parsedToday.getTime()) || parsedToday.toISOString().slice(0, 10) !== today) {
    throw new RangeError('تاريخ اليوم غير صالح.');
  }
  const month = today.slice(0, 7);
  const start = `${month}-01`;
  const [year, monthNumber] = month.split('-').map(Number);
  const end = `${month}-${String(new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()).padStart(2, '0')}`;
  return businessDays(start, end, holidays.filter((holiday) => holiday.startsWith(`${month}-`)));
}

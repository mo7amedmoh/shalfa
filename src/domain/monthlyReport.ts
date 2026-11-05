import { isPlanRowOverdue } from './plans';
import { normalizeImportName } from './imports';

export type MonthlyReportPlanType = 'maintenance' | 'cleaning' | 'security_safety' | 'elevators';

export interface MonthlyReportRow {
  id: string;
  planType: MonthlyReportPlanType;
  plannedDate: string;
  visitedAt: string | null;
  reportCompletedAt: string | null;
  supervisorId: string | null;
  supervisorName: string | null;
  area: string;
}

export function supervisorGroupKey(row: Pick<MonthlyReportRow, 'supervisorId' | 'supervisorName'>): string {
  return row.supervisorId ?? `name:${normalizeImportName(row.supervisorName) || 'unassigned'}`;
}

export interface MonthlyProgressSummary {
  total: number;
  visited: number;
  reportsCompleted: number;
  visitPercent: number;
  reportPercent: number;
}

export interface DailyProgress {
  date: string;
  planned: number;
  actual: number;
}

export interface SupervisorProgress {
  id: string;
  name: string;
  total: number;
  visited: number;
  reportsCompleted: number;
  reportPercent: number;
  overdueCount: number;
  overdueDays: number;
}

export function summarizeMonthlyProgress(rows: readonly MonthlyReportRow[]): MonthlyProgressSummary {
  const visited = rows.filter((row) => row.visitedAt !== null).length;
  const reportsCompleted = rows.filter((row) => row.reportCompletedAt !== null).length;
  return {
    total: rows.length,
    visited,
    reportsCompleted,
    visitPercent: rows.length ? (visited / rows.length) * 100 : 0,
    reportPercent: rows.length ? (reportsCompleted / rows.length) * 100 : 0,
  };
}

export function buildDailyProgress(rows: readonly MonthlyReportRow[], month: string): DailyProgress[] {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new RangeError('Month must use YYYY-MM format.');
  const [year, monthNumber] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const firstDate = new Date(Date.UTC(year, monthNumber - 1, 1));
  if (!Number.isFinite(firstDate.getTime()) || firstDate.toISOString().slice(0, 7) !== month) {
    throw new RangeError('Month must be a valid calendar month.');
  }
  const result: DailyProgress[] = [];
  let planned = 0;
  let actual = 0;
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${month}-${String(day).padStart(2, '0')}`;
    planned += rows.filter((row) => row.plannedDate === date).length;
    actual += rows.filter((row) => row.visitedAt === date).length;
    result.push({ date, planned, actual });
  }
  return result;
}

export function rankSupervisorProgress(
  rows: readonly MonthlyReportRow[],
  today: string,
): { mostOverdue: SupervisorProgress[]; mostCompliant: SupervisorProgress[] } {
  const groups = new Map<string, MonthlyReportRow[]>();
  for (const row of rows) {
    if (!['maintenance', 'cleaning'].includes(row.planType)) continue;
    const key = supervisorGroupKey(row);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const progress = [...groups.entries()].map(([id, assigned]) => {
    const visited = assigned.filter((row) => row.visitedAt !== null).length;
    const reportsCompleted = assigned.filter((row) => row.reportCompletedAt !== null).length;
    const overdue = assigned.filter((row) => isPlanRowOverdue({
      plannedDate: row.plannedDate,
      visitedAt: row.visitedAt,
      reportCompletedAt: row.reportCompletedAt,
    }, today));
    const overdueDays = overdue.reduce((sum, row) => sum + Math.max(0, Math.floor(
      (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${row.plannedDate}T00:00:00Z`)) / 86_400_000,
    )), 0);
    return {
      id,
      name: assigned.find((row) => row.supervisorName)?.supervisorName ?? 'مشرف غير محدد',
      total: assigned.length,
      visited,
      reportsCompleted,
      reportPercent: assigned.length ? (reportsCompleted / assigned.length) * 100 : 0,
      overdueCount: overdue.length,
      overdueDays,
    };
  });
  const mostOverdue = [...progress].sort((a, b) =>
    b.overdueCount - a.overdueCount || b.overdueDays - a.overdueDays || a.name.localeCompare(b.name, 'ar'),
  );
  const mostCompliant = [...progress].sort((a, b) =>
    b.reportPercent - a.reportPercent || a.overdueCount - b.overdueCount || a.name.localeCompare(b.name, 'ar'),
  );
  return { mostOverdue, mostCompliant };
}

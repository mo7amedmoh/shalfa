import type { PlanType } from './types';
import { normalizeImportName } from './imports';

export type ReportAxis = 'maintenance' | 'cleaning' | 'elevators' | 'security_safety';
export type ReportAxisFilter = ReportAxis | 'all';
export type ReportPlanRow = {
  id: string;
  month: string;
  planType: ReportAxis;
  plannedDate: string;
  visited: boolean;
  visitedDate: string | null;
  reportDone: boolean;
  reportCompletedDate: string | null;
  engineerId: string | null;
  engineerName: string | null;
  supervisorId: string | null;
  supervisorName: string | null;
  contractorName: string | null;
  schoolId: string;
  schoolName: string;
  ministryNumber: string;
  neighbourhood: string;
  hasCleaner: boolean;
  updatedAt?: string | null;
};

export type ReportFilters = {
  month: string;
  axis: ReportAxisFilter;
  engineerId: string;
  supervisorId: string;
  neighbourhood: string;
};

export type ReportMetrics = {
  planned: number;
  expectedVisits: number;
  visited: number;
  reportsDone: number;
  completed: number;
  visitPercent: number;
  reportPercent: number;
  completionPercent: number;
  expectedPercent: number;
  visitGap: number;
  lateVisits: number;
  lateReports: number;
  reportsDueByMonthEnd: number;
  remaining: number;
  inProgress: number;
  workingDaysLeft: number;
  reportRisk: 'none' | 'manageable' | 'high';
  paceStatus: 'ahead' | 'on_track' | 'behind' | 'no_plan';
};

export type AxisSummary = {
  axis: ReportAxis;
  label: string;
  planned: number;
  visited: number;
  reportsDone: number;
  completed: number;
  lateVisits: number;
  lateReports: number;
  visitPercent: number;
  reportPercent: number;
  completionPercent: number;
  visitStack: StatusStack;
  reportStack: StatusStack;
};

export type StatusStack = {
  done: number;
  pending: number;
  late: number;
  donePercent: number;
  pendingPercent: number;
  latePercent: number;
};

export type DailyAchievement = {
  date: string;
  planned: number;
  actual: number;
  isAsOfDate: boolean;
  plannedWidth: number;
  actualWidth: number;
};

export type SupervisorMetric = {
  id: string;
  name: string;
  planned: number;
  visited: number;
  reportsDone: number;
  completed: number;
  visitPercent: number;
  reportPercent: number;
  completionPercent: number;
  lateVisits: number;
  lateReports: number;
  complianceScore: number;
  daily: Array<{ date: string; planned: number; actual: number; plannedWidth: number; actualWidth: number; state: 'done' | 'due' | 'late' }>;
};

export type LateItem = {
  id: string;
  schoolName: string;
  ministryNumber: string;
  neighbourhood: string;
  supervisorName: string;
  engineerName: string;
  axis: string;
  kind: 'visit' | 'report';
  plannedDate: string;
  daysLate: number;
  agingBucket: '1–2' | '3–5' | '6+';
};

export type BreakdownRow = {
  id: string;
  label: string;
  planned: number;
  visited: number;
  reportsDone: number;
  completed: number;
  late: number;
  completionPercent: number;
};

export type DataQuality = {
  missingSupervisor: ReportPlanRow[];
  missingPlannedDate: ReportPlanRow[];
  reportWithoutVisit: ReportPlanRow[];
  visitDateBeforePlan: ReportPlanRow[];
  schoolsWithoutCleaners: ReportPlanRow[];
};

export type PlanReportView = {
  metrics: ReportMetrics;
  cards: Array<{ key: keyof ReportMetrics; label: string; value: number; unit: 'count' | 'percent'; delta: number | null; status: 'positive' | 'warning' | 'neutral' }>;
  axes: AxisSummary[];
  daily: DailyAchievement[];
  forecast: { actual: number; estimate: number | null; total: number; elapsedWorkingDays: number; totalWorkingDays: number };
  supervisors: SupervisorMetric[];
  lateItems: LateItem[];
  aging: Record<'1–2' | '3–5' | '6+', number>;
  neighbourhoods: BreakdownRow[];
  engineers: BreakdownRow[];
  quality: DataQuality;
};

const axisLabels: Record<ReportAxis, string> = {
  maintenance: 'الصيانة والتكييف',
  cleaning: 'النظافة',
  elevators: 'المصاعد',
  security_safety: 'الأمن والسلامة',
};

const axisByPlan: Record<PlanType, ReportAxis> = {
  maintenance: 'maintenance',
  cleaning: 'cleaning',
  elevators: 'elevators',
  security_safety: 'security_safety',
};

function responsiblePartyName(row: ReportPlanRow): string | null {
  const usesExternalCompany = row.planType === 'elevators' || row.planType === 'security_safety';
  return usesExternalCompany
    ? row.contractorName ?? row.engineerName
    : row.engineerName ?? row.contractorName;
}

function assertMonth(month: string): void {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new RangeError('Month must use YYYY-MM format.');
  const parsed = new Date(`${month}-01T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 7) !== month) {
    throw new RangeError('Month must be a valid calendar month.');
  }
}

function assertDate(date: string): void {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new RangeError('Date must be a valid ISO calendar date.');
  }
}

function monthDays(month: string): number {
  assertMonth(month);
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

function monthEnd(month: string): string {
  return `${month}-${String(monthDays(month)).padStart(2, '0')}`;
}

function dayDifference(start: string, end: string): number {
  return Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

function countWorkingDays(start: string, end: string): number {
  if (start > end) return 0;
  let count = 0;
  for (let day = new Date(`${start}T00:00:00Z`); day.toISOString().slice(0, 10) <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    const weekday = day.getUTCDay();
    if (weekday !== 5 && weekday !== 6) count += 1;
  }
  return count;
}

function isCompleteAt(row: ReportPlanRow, asOf: string, kind: 'visit' | 'report'): boolean {
  const completed = kind === 'visit' ? row.visited : row.reportDone;
  const completedDate = kind === 'visit' ? row.visitedDate : row.reportCompletedDate;
  return completed && (!completedDate || completedDate <= asOf);
}

function ratio(numerator: number, denominator: number): number {
  return denominator ? (numerator / denominator) * 100 : 0;
}

function isLateVisit(row: ReportPlanRow, asOf: string): boolean {
  return row.plannedDate < asOf && !isCompleteAt(row, asOf, 'visit');
}

function isLateReport(row: ReportPlanRow, asOf: string): boolean {
  return asOf > monthEnd(row.month) && !isCompleteAt(row, asOf, 'report');
}

function workingDaysLeft(month: string, asOf: string): number {
  const start = asOf < `${month}-01` ? `${month}-01` : asOf;
  return countWorkingDays(start, monthEnd(month));
}

export function filterPlanReportRows(
  rows: readonly ReportPlanRow[],
  filters: ReportFilters,
): ReportPlanRow[] {
  assertMonth(filters.month);
  return rows.filter((row) =>
    row.month.slice(0, 7) === filters.month
    && (filters.axis === 'all' || row.planType === filters.axis)
    && (!filters.engineerId || row.engineerId === filters.engineerId)
    && (!filters.supervisorId || row.supervisorId === filters.supervisorId)
    && (!filters.neighbourhood || row.neighbourhood === filters.neighbourhood),
  );
}

export function summarizePlanReport(rows: readonly ReportPlanRow[], month: string, asOf: string): ReportMetrics {
  assertMonth(month);
  assertDate(asOf);
  const planned = rows.length;
  const expectedVisits = rows.filter((row) => row.plannedDate <= asOf).length;
  const visited = rows.filter((row) => isCompleteAt(row, asOf, 'visit')).length;
  const reportsDone = rows.filter((row) => isCompleteAt(row, asOf, 'report')).length;
  const completed = rows.filter((row) =>
    isCompleteAt(row, asOf, 'visit') && isCompleteAt(row, asOf, 'report'),
  ).length;
  const lateVisits = rows.filter((row) => isLateVisit(row, asOf)).length;
  const lateReports = rows.filter((row) => isLateReport(row, asOf)).length;
  const reportsDueByMonthEnd = asOf <= monthEnd(month)
    ? rows.filter((row) => !isCompleteAt(row, asOf, 'report')).length
    : 0;
  const daysLeft = workingDaysLeft(month, asOf);
  return {
    planned,
    expectedVisits,
    visited,
    reportsDone,
    completed,
    visitPercent: ratio(visited, planned),
    reportPercent: ratio(reportsDone, planned),
    completionPercent: ratio(completed, planned),
    expectedPercent: ratio(expectedVisits, planned),
    visitGap: visited - expectedVisits,
    lateVisits,
    lateReports,
    reportsDueByMonthEnd,
    remaining: planned - completed,
    inProgress: rows.filter((row) =>
      isCompleteAt(row, asOf, 'visit') && !isCompleteAt(row, asOf, 'report'),
    ).length,
    workingDaysLeft: daysLeft,
    reportRisk: !reportsDueByMonthEnd ? 'none' : reportsDueByMonthEnd > daysLeft ? 'high' : 'manageable',
    paceStatus: !planned
      ? 'no_plan'
      : visited - expectedVisits > Math.max(1, Math.ceil(planned * 0.02))
        ? 'ahead'
        : visited - expectedVisits < -Math.max(1, Math.ceil(planned * 0.02))
          ? 'behind'
          : 'on_track',
  };
}

function statusStack(rows: readonly ReportPlanRow[], asOf: string, kind: 'visit' | 'report'): StatusStack {
  const done = rows.filter((row) => isCompleteAt(row, asOf, kind)).length;
  const late = rows.filter((row) => kind === 'visit' ? isLateVisit(row, asOf) : isLateReport(row, asOf)).length;
  const pending = rows.length - done - late;
  return {
    done,
    pending,
    late,
    donePercent: ratio(done, rows.length),
    pendingPercent: ratio(pending, rows.length),
    latePercent: ratio(late, rows.length),
  };
}

function axisMetrics(rows: readonly ReportPlanRow[], month: string, asOf: string, axis: ReportAxis): AxisSummary {
  const axisRows = rows.filter((row) => row.planType === axis);
  const metrics = summarizePlanReport(axisRows, month, asOf);
  return {
    axis,
    label: axisLabels[axis],
    planned: metrics.planned,
    visited: metrics.visited,
    reportsDone: metrics.reportsDone,
    completed: metrics.completed,
    lateVisits: metrics.lateVisits,
    lateReports: metrics.lateReports,
    visitPercent: metrics.visitPercent,
    reportPercent: metrics.reportPercent,
    completionPercent: metrics.completionPercent,
    visitStack: statusStack(axisRows, asOf, 'visit'),
    reportStack: statusStack(axisRows, asOf, 'report'),
  };
}

function buildDaily(rows: readonly ReportPlanRow[], month: string, asOf: string): DailyAchievement[] {
  const days = monthDays(month);
  const plannedByDate = new Map<string, number>();
  const actualByDate = new Map<string, number>();
  for (const row of rows) {
    plannedByDate.set(row.plannedDate, (plannedByDate.get(row.plannedDate) ?? 0) + 1);
    if (isCompleteAt(row, asOf, 'visit') && row.visitedDate) {
      actualByDate.set(row.visitedDate, (actualByDate.get(row.visitedDate) ?? 0) + 1);
    }
  }
  let planned = 0;
  let actual = 0;
  return Array.from({ length: days }, (_, index) => {
    const date = `${month}-${String(index + 1).padStart(2, '0')}`;
    planned += plannedByDate.get(date) ?? 0;
    actual += actualByDate.get(date) ?? 0;
    return {
      date,
      planned,
      actual,
      isAsOfDate: date === asOf,
      plannedWidth: ratio(planned, rows.length),
      actualWidth: ratio(actual, rows.length),
    };
  });
}

function buildForecast(rows: readonly ReportPlanRow[], month: string, asOf: string): PlanReportView['forecast'] {
  const end = monthEnd(month);
  const elapsedEnd = asOf < `${month}-01` ? `${month}-01` : asOf > end ? end : asOf;
  const elapsedWorkingDays = asOf < `${month}-01` ? 0 : countWorkingDays(`${month}-01`, elapsedEnd);
  const totalWorkingDays = countWorkingDays(`${month}-01`, end);
  const actual = rows.filter((row) => isCompleteAt(row, asOf, 'visit')).length;
  const estimate = !totalWorkingDays || !elapsedWorkingDays
    ? null
    : Math.min(rows.length, Math.round((actual / elapsedWorkingDays) * totalWorkingDays));
  return { actual, estimate, total: rows.length, elapsedWorkingDays, totalWorkingDays };
}

function supervisorMetrics(rows: readonly ReportPlanRow[], month: string, asOf: string): SupervisorMetric[] {
  const eligible = rows.filter((row) => row.planType === 'maintenance' || row.planType === 'cleaning');
  const groups = new Map<string, ReportPlanRow[]>();
  for (const row of eligible) {
    const id = row.supervisorId ?? `name:${normalizeImportName(row.supervisorName) || 'unassigned'}`;
    const items = groups.get(id) ?? [];
    items.push(row);
    groups.set(id, items);
  }
  return [...groups.entries()].map(([id, assigned]) => {
    const metrics = summarizePlanReport(assigned, month, asOf);
    const score = (metrics.completionPercent * 0.5)
      + (metrics.visitPercent * 0.25)
      + (metrics.reportPercent * 0.25);
    const rawDaily = Array.from({ length: monthDays(month) }, (_, index) => {
      const date = `${month}-${String(index + 1).padStart(2, '0')}`;
      const dayRows = assigned.filter((row) => row.plannedDate === date);
      const hasLate = dayRows.some((row) => isLateVisit(row, asOf) || isLateReport(row, asOf));
      const done = dayRows.length > 0 && dayRows.every((row) =>
        isCompleteAt(row, asOf, 'visit') && isCompleteAt(row, asOf, 'report'),
      );
      return {
        date,
        planned: dayRows.length,
        actual: dayRows.filter((row) => isCompleteAt(row, asOf, 'visit')).length,
        state: (hasLate ? 'late' : done ? 'done' : 'due') as 'done' | 'due' | 'late',
      };
    });
    const maxDaily = Math.max(1, ...rawDaily.map(({ planned }) => planned));
    const daily = rawDaily.map((item) => ({
      ...item,
      plannedWidth: ratio(item.planned, maxDaily),
      actualWidth: ratio(item.actual, maxDaily),
    }));
    return {
      id,
      name: assigned.find((row) => row.supervisorName)?.supervisorName ?? 'مشرف غير محدد',
      planned: metrics.planned,
      visited: metrics.visited,
      reportsDone: metrics.reportsDone,
      completed: metrics.completed,
      visitPercent: metrics.visitPercent,
      reportPercent: metrics.reportPercent,
      completionPercent: metrics.completionPercent,
      lateVisits: metrics.lateVisits,
      lateReports: metrics.lateReports,
      complianceScore: score,
      daily,
    };
  }).sort((left, right) =>
    right.complianceScore - left.complianceScore || left.name.localeCompare(right.name, 'ar'),
  );
}

export function rankSupervisorsByLateness(
  supervisors: readonly SupervisorMetric[],
): SupervisorMetric[] {
  return [...supervisors].sort((left, right) =>
    (right.lateVisits + right.lateReports) - (left.lateVisits + left.lateReports)
    || left.complianceScore - right.complianceScore
    || left.name.localeCompare(right.name, 'ar'),
  );
}

function buildLateItems(rows: readonly ReportPlanRow[], asOf: string): LateItem[] {
  const items: LateItem[] = [];
  for (const row of rows) {
    const lateVisit = isLateVisit(row, asOf);
    const lateReport = isLateReport(row, asOf);
    for (const kind of (['visit', 'report'] as const)) {
      if ((kind === 'visit' && !lateVisit) || (kind === 'report' && !lateReport)) continue;
      const lateSince = kind === 'visit' ? row.plannedDate : monthEnd(row.month);
      const daysLate = dayDifference(lateSince, asOf);
      items.push({
        id: `${row.id}:${kind}`,
        schoolName: row.schoolName,
        ministryNumber: row.ministryNumber,
        neighbourhood: row.neighbourhood,
        supervisorName: row.planType === 'elevators' || row.planType === 'security_safety'
          ? '—'
          : row.supervisorName ?? 'غير محدد',
        engineerName: responsiblePartyName(row) ?? 'غير محدد',
        axis: axisLabels[row.planType],
        kind,
        plannedDate: row.plannedDate,
        daysLate,
        agingBucket: daysLate <= 2 ? '1–2' : daysLate <= 5 ? '3–5' : '6+',
      });
    }
  }
  return items.sort((left, right) => right.daysLate - left.daysLate || left.schoolName.localeCompare(right.schoolName, 'ar'));
}

function breakdown(rows: readonly ReportPlanRow[], asOf: string, by: 'neighbourhood' | 'engineer'): BreakdownRow[] {
  const groups = new Map<string, ReportPlanRow[]>();
  for (const row of rows) {
    const id = by === 'neighbourhood'
      ? row.neighbourhood || 'غير محدد'
      : (row.planType === 'elevators' || row.planType === 'security_safety')
        ? row.contractorName ?? row.engineerId ?? '__unassigned__'
        : row.engineerId ?? row.contractorName ?? '__unassigned__';
    const items = groups.get(id) ?? [];
    items.push(row);
    groups.set(id, items);
  }
  return [...groups.entries()].map(([id, assigned]) => {
    const visited = assigned.filter((row) => isCompleteAt(row, asOf, 'visit')).length;
    const reportsDone = assigned.filter((row) => isCompleteAt(row, asOf, 'report')).length;
    const completed = assigned.filter((row) =>
      isCompleteAt(row, asOf, 'visit') && isCompleteAt(row, asOf, 'report'),
    ).length;
    return {
      id,
      label: by === 'engineer'
        ? assigned.map(responsiblePartyName).find((name) => name)
          ?? 'غير محدد'
        : id,
      planned: assigned.length,
      visited,
      reportsDone,
      completed,
      late: assigned.filter((row) => isLateVisit(row, asOf) || isLateReport(row, asOf)).length,
      completionPercent: ratio(completed, assigned.length),
    };
  }).sort((left, right) => right.completionPercent - left.completionPercent || left.label.localeCompare(right.label, 'ar'));
}

function buildQuality(rows: readonly ReportPlanRow[]): DataQuality {
  return {
    missingSupervisor: rows.filter((row) => !row.supervisorId),
    missingPlannedDate: rows.filter((row) => !row.plannedDate),
    reportWithoutVisit: rows.filter((row) => row.reportDone && !row.visited),
    visitDateBeforePlan: rows.filter((row) =>
      row.visitedDate !== null && dayDifference(row.visitedDate, row.plannedDate) >= 7,
    ),
    schoolsWithoutCleaners: rows.filter((row) =>
      (row.planType === 'maintenance' || row.planType === 'cleaning') && !row.hasCleaner,
    ),
  };
}

function previousComparableDate(month: string, asOf: string): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  const previousMonth = date.toISOString().slice(0, 7);
  const day = Math.min(Number(asOf.slice(8, 10)), monthDays(previousMonth));
  return `${previousMonth}-${String(day).padStart(2, '0')}`;
}

export function buildPlanReportView(
  rows: readonly ReportPlanRow[],
  month: string,
  asOf: string,
  previousRows: readonly ReportPlanRow[] = [],
): PlanReportView {
  const metrics = summarizePlanReport(rows, month, asOf);
  const previousDate = previousComparableDate(month, asOf);
  const previousMetrics = summarizePlanReport(previousRows, previousDate.slice(0, 7), previousDate);
  const definitions: Array<{ key: keyof ReportMetrics; label: string; unit: 'count' | 'percent' }> = [
    { key: 'planned', label: 'الزيارات المخططة', unit: 'count' },
    { key: 'expectedVisits', label: 'المتوقع حتى تاريخه', unit: 'count' },
    { key: 'visited', label: 'الزيارات المنفذة', unit: 'count' },
    { key: 'visitPercent', label: 'نسبة الزيارات', unit: 'percent' },
    { key: 'reportsDone', label: 'التقارير المنجزة', unit: 'count' },
    { key: 'reportPercent', label: 'نسبة التقارير', unit: 'percent' },
    { key: 'completionPercent', label: 'اكتمال الزيارة والتقرير', unit: 'percent' },
    { key: 'lateVisits', label: 'الزيارات المتأخرة', unit: 'count' },
    { key: 'lateReports', label: 'التقارير المتأخرة', unit: 'count' },
    { key: 'reportsDueByMonthEnd', label: 'تقارير مستحقة بنهاية الشهر', unit: 'count' },
    { key: 'remaining', label: 'المتبقي غير المكتمل', unit: 'count' },
    { key: 'inProgress', label: 'قيد الإجراء', unit: 'count' },
  ];
  const daily = buildDaily(rows, month, asOf);
  const supervisors = supervisorMetrics(rows, month, asOf);
  const lateItems = buildLateItems(rows, asOf);
  return {
    metrics,
    cards: definitions.map(({ key, label, unit }) => ({
      key,
      label,
      value: metrics[key] as number,
      unit,
      delta: previousRows.length ? (metrics[key] as number) - (previousMetrics[key] as number) : null,
      status: key === 'lateVisits' || key === 'lateReports'
        ? (metrics[key] ? 'warning' : 'positive')
        : key === 'reportsDueByMonthEnd'
          ? (metrics.reportRisk === 'high' ? 'warning' : 'neutral')
          : key === 'remaining' || key === 'inProgress'
            ? (metrics[key] ? 'neutral' : 'positive')
            : key === 'visitPercent' || key === 'reportPercent' || key === 'completionPercent'
              ? (metrics[key] >= metrics.expectedPercent ? 'positive' : 'warning')
              : 'neutral',
    })),
    axes: (Object.keys(axisLabels) as ReportAxis[]).map((axis) => axisMetrics(rows, month, asOf, axis)),
    daily,
    forecast: buildForecast(rows, month, asOf),
    supervisors,
    lateItems,
    aging: {
      '1–2': lateItems.filter((item) => item.agingBucket === '1–2').length,
      '3–5': lateItems.filter((item) => item.agingBucket === '3–5').length,
      '6+': lateItems.filter((item) => item.agingBucket === '6+').length,
    },
    neighbourhoods: breakdown(rows, asOf, 'neighbourhood'),
    engineers: breakdown(rows, asOf, 'engineer'),
    quality: buildQuality(rows),
  };
}

export function rowsForAxisStatus(
  rows: readonly ReportPlanRow[],
  axis: ReportAxis,
  status: 'visit-done' | 'visit-pending' | 'visit-late' | 'report-done' | 'report-pending' | 'report-late',
  asOf: string,
): ReportPlanRow[] {
  return rows.filter((row) => {
    if (row.planType !== axis) return false;
    switch (status) {
      case 'visit-done': return isCompleteAt(row, asOf, 'visit');
      case 'visit-pending': return !isCompleteAt(row, asOf, 'visit') && !isLateVisit(row, asOf);
      case 'visit-late': return isLateVisit(row, asOf);
      case 'report-done': return isCompleteAt(row, asOf, 'report');
      case 'report-pending': return !isCompleteAt(row, asOf, 'report') && !isLateReport(row, asOf);
      case 'report-late': return isLateReport(row, asOf);
    }
  });
}

export function axisLabel(axis: ReportAxis): string {
  return axisLabels[axis];
}

export function reportAxisForPlanType(planType: PlanType): ReportAxis {
  return axisByPlan[planType];
}

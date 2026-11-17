export type RemainingPlanVisit = {
  id: string;
  schoolId: string;
  schoolName: string;
  supervisorId: string | null;
  supervisorName: string | null;
  plannedDate: string;
  visited: boolean;
};

export type RedistributionPreviewRow = {
  rowId: string;
  schoolId: string;
  schoolName: string;
  supervisorId: string | null;
  supervisorName: string;
  oldDate: string;
  newDate: string;
};

export type RedistributionCapacityIssue = {
  supervisorName: string;
  visits: number;
  availableDays: number;
};

export type RedistributionPreview = {
  days: string[];
  assignments: RedistributionPreviewRow[];
  capacityIssues: RedistributionCapacityIssue[];
};

function parseIsoDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new RangeError('أدخل تاريخًا صحيحًا بصيغة YYYY-MM-DD.');
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.toISOString().slice(0, 10) !== value) throw new RangeError('أدخل تاريخًا صحيحًا بصيغة YYYY-MM-DD.');
  return date;
}

function supervisorKey(visit: RemainingPlanVisit): string {
  return visit.supervisorId ?? `name:${(visit.supervisorName ?? '').trim().toLocaleLowerCase() || 'unassigned'}`;
}

export function businessDays(startDate: string, endDate: string, holidays: readonly string[]): string[] {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  if (start > end) throw new RangeError('تاريخ البداية يجب أن يسبق تاريخ النهاية.');

  const holidaySet = new Set(holidays);
  const days: string[] = [];
  for (const date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    const isoDate = date.toISOString().slice(0, 10);
    if (date.getUTCDay() < 5 && !holidaySet.has(isoDate)) days.push(isoDate);
  }
  return days;
}

export function lastBusinessDayOfMonth(month: string, holidays: readonly string[]): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new RangeError('الشهر المحدد غير صالح.');
  }
  const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  const days = businessDays(start.toISOString().slice(0, 10), end.toISOString().slice(0, 10), holidays);
  return days[days.length - 1] ?? '';
}

export function previewRemainingPlanRedistribution({
  rows,
  startDate,
  endDate,
  holidays,
  dailyLimit,
}: {
  rows: readonly RemainingPlanVisit[];
  startDate: string;
  endDate: string;
  holidays: readonly string[];
  dailyLimit: number;
}): RedistributionPreview {
  if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 20) {
    throw new RangeError('الحد اليومي يجب أن يكون عددًا صحيحًا بين 1 و20.');
  }

  const days = businessDays(startDate, endDate, holidays);
  if (!days.length) throw new RangeError('لا توجد أيام عمل ضمن الفترة المحددة.');
  const daySet = new Set(days);
  const eligible = rows.filter((row) => !row.visited && row.plannedDate >= startDate);
  const eligibleIds = new Set(eligible.map((row) => row.id));
  const dailyLoad = new Map<string, Map<string, number>>();
  const groups = new Map<string, RemainingPlanVisit[]>();

  for (const row of eligible) {
    const key = supervisorKey(row);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  for (const row of rows) {
    if (eligibleIds.has(row.id) || !daySet.has(row.plannedDate)) continue;
    const key = supervisorKey(row);
    const load = dailyLoad.get(key) ?? new Map<string, number>();
    load.set(row.plannedDate, (load.get(row.plannedDate) ?? 0) + 1);
    dailyLoad.set(key, load);
  }

  const assignments: RedistributionPreviewRow[] = [];
  const capacityIssues: RedistributionCapacityIssue[] = [];
  const groupEntries = [...groups.entries()].sort(([, a], [, b]) =>
    (a[0].supervisorName ?? 'غير محدد').localeCompare(b[0].supervisorName ?? 'غير محدد', 'ar'));

  for (const [key, visits] of groupEntries) {
    const load = dailyLoad.get(key) ?? new Map<string, number>();
    const freeDays = days.filter((day) => (load.get(day) ?? 0) < dailyLimit);
    const remainingSlots = days.reduce((sum, day) => sum + Math.max(0, dailyLimit - (load.get(day) ?? 0)), 0);
    if (visits.length > remainingSlots) {
      capacityIssues.push({
        supervisorName: visits[0].supervisorName?.trim() || 'غير محدد',
        visits: visits.length,
        availableDays: freeDays.length,
      });
      continue;
    }

    for (const visit of visits) {
      const available = days.filter((day) => (load.get(day) ?? 0) < dailyLimit);
      const target = available.sort((a, b) =>
        (load.get(a) ?? 0) - (load.get(b) ?? 0) || a.localeCompare(b))[0];
      if (!target) {
        capacityIssues.push({
          supervisorName: visit.supervisorName?.trim() || 'غير محدد',
          visits: visits.length,
          availableDays: freeDays.length,
        });
        break;
      }
      load.set(target, (load.get(target) ?? 0) + 1);
      assignments.push({
        rowId: visit.id,
        schoolId: visit.schoolId,
        schoolName: visit.schoolName,
        supervisorId: visit.supervisorId,
        supervisorName: visit.supervisorName?.trim() || 'غير محدد',
        oldDate: visit.plannedDate,
        newDate: target,
      });
    }
    dailyLoad.set(key, load);
  }

  assignments.sort((a, b) => a.newDate.localeCompare(b.newDate)
    || a.supervisorName.localeCompare(b.supervisorName, 'ar')
    || a.schoolName.localeCompare(b.schoolName, 'ar'));
  return { days, assignments, capacityIssues };
}

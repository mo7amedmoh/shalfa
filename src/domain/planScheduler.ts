import { normalizeImportName } from './imports';

export type SchedulerSchool = {
  id: string;
  name: string;
  supervisorName?: string | null;
  neighbourhood?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export type SchedulerSupervisor = {
  id: string;
  name: string;
  maxSchoolsPerDay?: number | null;
};

export type ScheduleAssignment = {
  schoolId: string;
  plannedDate: string;
  supervisorId: string | null;
  supervisorName: string | null;
};

export type PlanScheduleOptions = {
  startDate: string;
  endDate: string;
  weekendDays: readonly number[];
  defaultMaxSchoolsPerDay: number;
  supervisors: readonly SchedulerSupervisor[];
  assignmentMode: 'keep' | 'balanced';
  clusterBy: 'none' | 'neighbourhood' | 'coordinates';
};

export type ScheduleMatrixRow = {
  supervisorId: string | null;
  supervisorName: string;
  maxSchoolsPerDay: number;
  counts: Record<string, number>;
};

export type PlanScheduleSummary = {
  days: string[];
  matrix: ScheduleMatrixRow[];
  warnings: string[];
  hasInvalidDates: boolean;
};

function parseIsoDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new RangeError('يجب إدخال تاريخ صحيح بصيغة YYYY-MM-DD.');
  }
  return date;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function validateCapacity(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} يجب أن يكون عدداً صحيحاً موجباً.`);
  }
}

function dateList(startDate: string, endDate: string, weekendDays: readonly number[]): string[] {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  if (start > end) throw new RangeError('تاريخ البداية يجب أن يسبق تاريخ النهاية.');
  if (weekendDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new RangeError('أيام العطلة غير صالحة.');
  }
  const weekends = new Set(weekendDays);
  const days: string[] = [];
  for (const date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    if (!weekends.has(date.getUTCDay())) days.push(isoDate(date));
  }
  if (!days.length) throw new RangeError('لا توجد أيام عمل ضمن الفترة المحددة.');
  return days;
}

function orderedSchools(
  schools: readonly SchedulerSchool[],
  clusterBy: PlanScheduleOptions['clusterBy'],
): SchedulerSchool[] {
  const compareText = (a: string, b: string) => a.localeCompare(b, 'ar');
  if (clusterBy === 'neighbourhood') {
    return [...schools].sort((a, b) =>
      compareText(a.neighbourhood ?? '', b.neighbourhood ?? '') || compareText(a.name, b.name) || a.id.localeCompare(b.id));
  }
  if (clusterBy === 'coordinates') {
    const coordinateKey = (school: SchedulerSchool) => {
      if (school.latitude === null || school.latitude === undefined
        || school.longitude === null || school.longitude === undefined
        || !Number.isFinite(school.latitude) || !Number.isFinite(school.longitude)) return 'zzzz';
      return `${Math.floor(school.latitude * 50).toString().padStart(6, '0')}:${Math.floor(school.longitude * 50).toString().padStart(6, '0')}`;
    };
    return [...schools].sort((a, b) =>
      coordinateKey(a).localeCompare(coordinateKey(b))
      || (a.latitude ?? Number.MAX_VALUE) - (b.latitude ?? Number.MAX_VALUE)
      || (a.longitude ?? Number.MAX_VALUE) - (b.longitude ?? Number.MAX_VALUE)
      || a.id.localeCompare(b.id));
  }
  return [...schools];
}

function uniqueSupervisors(supervisors: readonly SchedulerSupervisor[]): SchedulerSupervisor[] {
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  return supervisors.flatMap((supervisor) => {
    const name = supervisor.name.trim();
    const normalized = normalizeImportName(name);
    if (!name || !normalized || seenIds.has(supervisor.id) || seenNames.has(normalized)) return [];
    seenIds.add(supervisor.id);
    seenNames.add(normalized);
    const cap = supervisor.maxSchoolsPerDay;
    if (cap !== null && cap !== undefined) validateCapacity(cap, `الحد اليومي للمشرف ${name}`);
    return [{ ...supervisor, name }];
  });
}

function capacitiesFor(
  supervisors: readonly SchedulerSupervisor[],
  defaultCapacity: number,
): Map<string, number> {
  return new Map(supervisors.map((supervisor) => [
    supervisor.id,
    supervisor.maxSchoolsPerDay ?? defaultCapacity,
  ]));
}

export function summarizePlanSchedule(
  assignments: readonly ScheduleAssignment[],
  options: Pick<PlanScheduleOptions, 'startDate' | 'endDate' | 'weekendDays' | 'defaultMaxSchoolsPerDay' | 'supervisors'>,
): PlanScheduleSummary {
  validateCapacity(options.defaultMaxSchoolsPerDay, 'الحد اليومي الافتراضي');
  const days = dateList(options.startDate, options.endDate, options.weekendDays);
  const supervisors = uniqueSupervisors(options.supervisors);
  const byName = new Map(supervisors.map((supervisor) => [normalizeImportName(supervisor.name), supervisor]));
  const loads = new Map<string, Map<string, number>>();
  const found = new Map<string, SchedulerSupervisor>();
  for (const supervisor of supervisors) found.set(supervisor.id, supervisor);

  for (const assignment of assignments) {
    const resolved = assignment.supervisorId
      ? supervisors.find((supervisor) => supervisor.id === assignment.supervisorId)
      : byName.get(normalizeImportName(assignment.supervisorName ?? ''));
    const id = resolved?.id ?? assignment.supervisorId ?? (assignment.supervisorName ? `name:${normalizeImportName(assignment.supervisorName)}` : '__unassigned__');
    const name = resolved?.name ?? assignment.supervisorName?.trim() ?? 'غير محدد';
    const supervisor = resolved ?? { id, name, maxSchoolsPerDay: null };
    found.set(id, supervisor);
    const dailyLoads = loads.get(id) ?? new Map<string, number>();
    dailyLoads.set(assignment.plannedDate, (dailyLoads.get(assignment.plannedDate) ?? 0) + 1);
    loads.set(id, dailyLoads);
  }

  const orderedSupervisors = [...found.values()].sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  const effectiveCaps = capacitiesFor(orderedSupervisors, options.defaultMaxSchoolsPerDay);
  const matrix = orderedSupervisors.map((supervisor) => {
    const counts: Record<string, number> = Object.fromEntries(days.map((day) => [day, loads.get(supervisor.id)?.get(day) ?? 0]));
    return {
      supervisorId: supervisor.id === '__unassigned__' ? null : supervisor.id,
      supervisorName: supervisor.name || 'غير محدد',
      maxSchoolsPerDay: effectiveCaps.get(supervisor.id) ?? options.defaultMaxSchoolsPerDay,
      counts,
    };
  });
  const totalSchools = assignments.length;
  const totalCapacity = days.length * matrix.reduce((sum, row) => sum + row.maxSchoolsPerDay, 0);
  const warnings: string[] = [];
  if (totalSchools > totalCapacity) {
    warnings.push(`إجمالي المدارس (${totalSchools}) يتجاوز السعة المتاحة في أيام العمل (${totalCapacity}).`);
  }

  let hasInvalidDates = false;
  const availableDays = new Set(days);
  const outOfRange = assignments.filter((assignment) => {
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(assignment.plannedDate)
      && assignment.plannedDate >= options.startDate
      && assignment.plannedDate <= options.endDate
      && availableDays.has(assignment.plannedDate);
    return !valid;
  });
  if (outOfRange.length) {
    hasInvalidDates = true;
    warnings.push(`${outOfRange.length} موعد خارج الفترة أو يقع في يوم عطلة.`);
  }

  for (const row of matrix) {
    for (const day of days) {
      const count = row.counts[day];
      if (count > row.maxSchoolsPerDay) {
        warnings.push(`${row.supervisorName} لديه ${count} مدارس في ${day}، والحد ${row.maxSchoolsPerDay}.`);
      }
    }
  }
  return { days, matrix, warnings, hasInvalidDates };
}

export function schedulePlan(
  schools: readonly SchedulerSchool[],
  options: PlanScheduleOptions,
): { assignments: ScheduleAssignment[]; summary: PlanScheduleSummary } {
  validateCapacity(options.defaultMaxSchoolsPerDay, 'الحد اليومي الافتراضي');
  const days = dateList(options.startDate, options.endDate, options.weekendDays);
  if (!schools.length) throw new RangeError('اختر مدرسة واحدة على الأقل.');
  const ids = new Set<string>();
  for (const school of schools) {
    if (!school.id.trim() || ids.has(school.id)) throw new RangeError('معرّفات المدارس يجب أن تكون فريدة وغير فارغة.');
    ids.add(school.id);
  }

  const configuredSupervisors = uniqueSupervisors(options.supervisors);
  if (options.assignmentMode === 'balanced' && !configuredSupervisors.length) {
    throw new RangeError('أضف مشرفاً واحداً على الأقل للتوزيع المتوازن.');
  }
  const supervisors = [...configuredSupervisors];
  if (options.assignmentMode === 'keep') {
    const configuredNames = new Set(supervisors.map((supervisor) => normalizeImportName(supervisor.name)));
    for (const name of schools.map((school) => school.supervisorName?.trim() ?? '').filter(Boolean)) {
      const normalized = normalizeImportName(name);
      if (!configuredNames.has(normalized)) {
        supervisors.push({ id: `name:${normalized}`, name });
        configuredNames.add(normalized);
      }
    }
    if (schools.some((school) => !school.supervisorName?.trim())) {
      supervisors.push({ id: '__unassigned__', name: 'غير محدد' });
    }
    if (!supervisors.length) supervisors.push({ id: '__unassigned__', name: 'غير محدد' });
  }
  const capacities = capacitiesFor(supervisors, options.defaultMaxSchoolsPerDay);
  const ordered = orderedSchools(schools, options.clusterBy);
  const loadBySupervisor = new Map<string, Map<string, number>>();
  const totalBySupervisor = new Map<string, number>();
  const assignments: ScheduleAssignment[] = [];
  const supervisorByNormalizedName = new Map(supervisors.map((supervisor) => [normalizeImportName(supervisor.name), supervisor]));

  const bestDay = (supervisor: SchedulerSupervisor, allowOverflow: boolean) => {
    const daily = loadBySupervisor.get(supervisor.id) ?? new Map<string, number>();
    const candidates = days.filter((day) => allowOverflow || (daily.get(day) ?? 0) < (capacities.get(supervisor.id) ?? options.defaultMaxSchoolsPerDay));
    const pool = candidates.length ? candidates : days;
    return [...pool].sort((a, b) => (daily.get(a) ?? 0) - (daily.get(b) ?? 0) || a.localeCompare(b))[0];
  };
  const minimumDayLoad = (supervisor: SchedulerSupervisor) => {
    const daily = loadBySupervisor.get(supervisor.id);
    return Math.min(...days.map((day) => daily?.get(day) ?? 0));
  };

  for (const school of ordered) {
    let supervisor: SchedulerSupervisor | undefined;
    if (options.assignmentMode === 'keep') {
      const existingName = school.supervisorName?.trim() ?? '';
      supervisor = existingName
        ? supervisorByNormalizedName.get(normalizeImportName(existingName))
        : supervisors.find((candidate) => candidate.id === '__unassigned__');
    } else {
      const available = supervisors.filter((candidate) => {
        const day = bestDay(candidate, false);
        const count = loadBySupervisor.get(candidate.id)?.get(day) ?? 0;
        return count < (capacities.get(candidate.id) ?? options.defaultMaxSchoolsPerDay);
      });
      const pool = available.length ? available : supervisors;
      supervisor = [...pool].sort((a, b) =>
        (totalBySupervisor.get(a.id) ?? 0) - (totalBySupervisor.get(b.id) ?? 0)
        || minimumDayLoad(a) - minimumDayLoad(b)
        || a.name.localeCompare(b.name, 'ar'))[0];
    }
    if (!supervisor) throw new Error('تعذر تحديد مشرف للمدرسة.');

    const date = bestDay(supervisor, false);
    const dailyLoads = loadBySupervisor.get(supervisor.id) ?? new Map<string, number>();
    dailyLoads.set(date, (dailyLoads.get(date) ?? 0) + 1);
    loadBySupervisor.set(supervisor.id, dailyLoads);
    totalBySupervisor.set(supervisor.id, (totalBySupervisor.get(supervisor.id) ?? 0) + 1);
    assignments.push({
      schoolId: school.id,
      plannedDate: date,
      supervisorId: supervisor.id === '__unassigned__' ? null : supervisor.id,
      supervisorName: supervisor.id === '__unassigned__' ? null : supervisor.name,
    });
  }

  const summary = summarizePlanSchedule(assignments, {
    startDate: options.startDate,
    endDate: options.endDate,
    weekendDays: options.weekendDays,
    defaultMaxSchoolsPerDay: options.defaultMaxSchoolsPerDay,
    supervisors,
  });
  return { assignments, summary };
}

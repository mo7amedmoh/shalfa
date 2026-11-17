export type PlanEditWarning = 'weekend' | 'supervisor_conflict';

export type PlanEditScheduleRow = {
  id: string;
  plannedDate: string;
  supervisorId: string | null;
};

const warningLabels: Record<PlanEditWarning, string> = {
  weekend: 'الموعد يقع يوم الجمعة أو السبت.',
  supervisor_conflict: 'للمشرف زيارة أخرى في اليوم نفسه.',
};

export function getPlanEditWarnings({
  plannedDate,
  supervisorId,
  rows,
  excludedRowIds,
  scheduleChanged,
}: {
  plannedDate: string;
  supervisorId: string | null;
  rows: readonly PlanEditScheduleRow[];
  excludedRowIds: readonly string[];
  scheduleChanged: boolean;
}): PlanEditWarning[] {
  if (!scheduleChanged) return [];

  const warnings: PlanEditWarning[] = [];
  const date = new Date(`${plannedDate}T00:00:00.000Z`);
  if (Number.isFinite(date.getTime()) && [5, 6].includes(date.getUTCDay())) {
    warnings.push('weekend');
  }

  const excludedIds = new Set(excludedRowIds);
  if (supervisorId && rows.some((row) =>
    !excludedIds.has(row.id)
    && row.plannedDate === plannedDate
    && row.supervisorId === supervisorId
  )) {
    warnings.push('supervisor_conflict');
  }

  return warnings;
}

export function requiresVisitEditReason({
  visited,
  schoolChanged,
  dateChanged,
}: {
  visited: boolean;
  schoolChanged: boolean;
  dateChanged: boolean;
}): boolean {
  return visited && (schoolChanged || dateChanged);
}

export function planEditWarningLabel(warning: PlanEditWarning): string {
  return warningLabels[warning];
}

export function buildPlanEditReason(reason: string, warnings: readonly PlanEditWarning[]): string | null {
  const parts = [reason.trim()].filter(Boolean);
  if (warnings.length) {
    parts.push(`تجاوز تحذير الجدولة: ${warnings.map(planEditWarningLabel).join(' ')}`);
  }
  return parts.length ? parts.join('\n') : null;
}

import { normalizeMinistryNumber } from './imports';

export type PlanBulkAction = 'visit' | 'report' | 'both';
export type PlanBulkStatus = 'matched' | 'unmatched' | 'not_in_plan' | 'duplicate' | 'ambiguous' | 'invalid';

export type PlanBulkPreviewRow = {
  line: number;
  ministryNumber: string;
  status: PlanBulkStatus;
  note: string;
  schoolName?: string;
  update?: { row_id: string; visited_date?: string; report_date?: string };
};

export type PlanBulkPreviewCounts = {
  input: number;
  matched: number;
  unmatched: number;
  notInPlan: number;
  duplicate: number;
  ambiguous: number;
  invalid: number;
};

export type PlanBulkSchool = {
  id: string;
  schoolName: string;
  ministryNumber: string;
  ministryKey: string;
  visited: boolean;
};

export type MinistryIndexSchool = Pick<PlanBulkSchool, 'schoolName' | 'ministryNumber' | 'ministryKey'>;
export type PersistedPlanUpdate = {
  id: string;
  visited_date: string | null;
  report_done_date: string | null;
};
export type PlanBulkUpdate = { row_id: string; visited_date?: string | null; report_date?: string | null };

export function getUnpersistedPlanUpdateIds(
  updates: readonly PlanBulkUpdate[],
  persistedRows: readonly PersistedPlanUpdate[],
): string[] {
  const persistedById = new Map(persistedRows.map((row) => [row.id, row]));
  return updates.filter((update) => {
    const persisted = persistedById.get(update.row_id);
    if (!persisted) return true;
    if ('visited_date' in update && persisted.visited_date !== update.visited_date) return true;
    if ('report_date' in update && persisted.report_done_date !== update.report_date) return true;
    return false;
  }).map((update) => update.row_id);
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function ministryKey(school: { ministryNumber: string; ministryKey: string }): string {
  return normalizeMinistryNumber(school.ministryKey || school.ministryNumber);
}

export function parsePastedMinistryNumbers(value: string): string[] {
  return value
    .split(/[\s,،]+/u)
    .map((part) => normalizeMinistryNumber(part))
    .filter(Boolean);
}

export function previewPlanNumberUpdates(
  pastedNumbers: string,
  planRows: readonly PlanBulkSchool[],
  allSchools: readonly MinistryIndexSchool[],
  action: PlanBulkAction,
  visitDate: string,
  reportDate: string,
): { rows: PlanBulkPreviewRow[]; counts: PlanBulkPreviewCounts } {
  const numbers = parsePastedMinistryNumbers(pastedNumbers);
  const planByKey = new Map<string, PlanBulkSchool[]>();
  const knownKeys = new Set<string>();
  for (const school of allSchools) {
    const key = ministryKey(school);
    if (key) knownKeys.add(key);
  }
  for (const school of planRows) {
    const key = ministryKey(school);
    if (!key) continue;
    const matches = planByKey.get(key) ?? [];
    matches.push(school);
    planByKey.set(key, matches);
  }

  const seen = new Set<string>();
  const rows = numbers.map((number, index): PlanBulkPreviewRow => {
    const line = index + 1;
    const key = normalizeMinistryNumber(number);
    if (seen.has(key)) {
      return { line, ministryNumber: number, status: 'duplicate', note: 'تكرر الرقم في القائمة؛ لم يُحدّث مرة ثانية.' };
    }
    seen.add(key);
    const matches = planByKey.get(key) ?? [];
    if (!matches.length) {
      return knownKeys.has(key)
        ? { line, ministryNumber: number, status: 'not_in_plan', note: 'المدرسة موجودة، لكنها ليست ضمن هذه الخطة.' }
        : { line, ministryNumber: number, status: 'unmatched', note: 'لا توجد مدرسة بهذا الرقم الوزاري.' };
    }
    if (matches.length > 1) {
      return { line, ministryNumber: number, status: 'ambiguous', note: 'الرقم يطابق أكثر من صف في الخطة؛ لم يتم التحديث.' };
    }
    const school = matches[0];
    if ((action === 'visit' || action === 'both') && !isValidDate(visitDate)) {
      return { line, ministryNumber: number, status: 'invalid', note: 'أدخل تاريخ زيارة صحيحاً.' };
    }
    if ((action === 'report' || action === 'both') && !isValidDate(reportDate)) {
      return { line, ministryNumber: number, status: 'invalid', note: 'أدخل تاريخ تقرير صحيحاً.' };
    }
    if (action === 'report' && !school.visited) {
      return { line, ministryNumber: number, status: 'invalid', note: 'لا يمكن إكمال التقرير قبل تسجيل الزيارة.' };
    }
    return {
      line,
      ministryNumber: number,
      status: 'matched',
      note: school.schoolName,
      schoolName: school.schoolName,
      update: {
        row_id: school.id,
        ...(action === 'visit' || action === 'both' ? { visited_date: visitDate } : {}),
        ...(action === 'report' || action === 'both' ? { report_date: reportDate } : {}),
      },
    };
  });
  const counts: PlanBulkPreviewCounts = {
    input: rows.length,
    matched: rows.filter((row) => row.status === 'matched').length,
    unmatched: rows.filter((row) => row.status === 'unmatched').length,
    notInPlan: rows.filter((row) => row.status === 'not_in_plan').length,
    duplicate: rows.filter((row) => row.status === 'duplicate').length,
    ambiguous: rows.filter((row) => row.status === 'ambiguous').length,
    invalid: rows.filter((row) => row.status === 'invalid').length,
  };
  return { rows, counts };
}

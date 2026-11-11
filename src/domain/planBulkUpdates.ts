import { normalizeImportName, normalizeMinistryNumber } from './imports';

export type PlanBulkAction = 'visit' | 'report' | 'both';
export type PlanBulkStatus = 'matched' | 'unmatched' | 'not_in_plan' | 'duplicate' | 'ambiguous' | 'invalid';

export type PlanBulkPreviewRow = {
  line: number;
  identifier: string;
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

function isMinistryNumberList(value: string): boolean {
  return /^(?:[a-z]*[\d٠-٩۰-۹]+)(?:\s+[a-z]*[\d٠-٩۰-۹]+)*$/iu.test(value.trim());
}

export function parsePastedPlanIdentifiers(value: string): string[] {
  return value.split(/[\r\n,،]+/u)
    .flatMap((part) => {
      const trimmed = part.trim();
      if (!trimmed) return [];
      if (isMinistryNumberList(trimmed)) {
        return trimmed.split(/\s+/u).map((number) => normalizeMinistryNumber(number)).filter(Boolean);
      }
      return [trimmed];
    });
}

export function previewPlanIdentifierUpdates(
  pastedIdentifiers: string,
  planRows: readonly PlanBulkSchool[],
  allSchools: readonly MinistryIndexSchool[],
  action: PlanBulkAction,
  visitDate: string,
  reportDate: string,
): { rows: PlanBulkPreviewRow[]; counts: PlanBulkPreviewCounts } {
  const identifiers = parsePastedPlanIdentifiers(pastedIdentifiers);
  const planByKey = new Map<string, PlanBulkSchool[]>();
  const planByName = new Map<string, PlanBulkSchool[]>();
  const knownKeys = new Set<string>();
  const knownNames = new Set<string>();
  for (const school of allSchools) {
    const key = ministryKey(school);
    if (key) knownKeys.add(key);
    const name = normalizeImportName(school.schoolName);
    if (name) knownNames.add(name);
  }
  for (const school of planRows) {
    const key = ministryKey(school);
    if (!key) continue;
    const matches = planByKey.get(key) ?? [];
    matches.push(school);
    planByKey.set(key, matches);
    const name = normalizeImportName(school.schoolName);
    if (name) {
      const nameMatches = planByName.get(name) ?? [];
      nameMatches.push(school);
      planByName.set(name, nameMatches);
    }
  }

  const seenIdentifiers = new Set<string>();
  const seenTargets = new Set<string>();
  const rows = identifiers.map((identifier, index): PlanBulkPreviewRow => {
    const line = index + 1;
    const isNumber = isMinistryNumberList(identifier);
    const key = isNumber ? normalizeMinistryNumber(identifier) : '';
    const name = isNumber ? '' : normalizeImportName(identifier);
    const identity = isNumber ? `number:${key}` : `name:${name}`;
    if (seenIdentifiers.has(identity)) {
      return { line, identifier, status: 'duplicate', note: 'تكرر الرقم أو اسم المدرسة في القائمة؛ لم يُحدّث مرة ثانية.' };
    }
    seenIdentifiers.add(identity);
    const matches = isNumber ? planByKey.get(key) ?? [] : planByName.get(name) ?? [];
    if (!matches.length) {
      const known = isNumber ? knownKeys.has(key) : knownNames.has(name);
      return known
        ? { line, identifier, status: 'not_in_plan', note: 'المدرسة موجودة، لكنها ليست ضمن هذه الخطة.' }
        : { line, identifier, status: 'unmatched', note: isNumber ? 'لا توجد مدرسة بهذا الرقم الوزاري.' : 'لا توجد مدرسة بهذا الاسم.' };
    }
    if (matches.length > 1) {
      return { line, identifier, status: 'ambiguous', note: isNumber ? 'الرقم يطابق أكثر من صف في الخطة؛ لم يتم التحديث.' : 'الاسم يطابق أكثر من مدرسة في الخطة؛ استخدم الرقم الوزاري لتحديد المدرسة.' };
    }
    const school = matches[0];
    if (seenTargets.has(school.id)) {
      return { line, identifier, status: 'duplicate', schoolName: school.schoolName, note: 'سبق إدراج هذه المدرسة في القائمة؛ لم تُحدّث مرة ثانية.' };
    }
    if ((action === 'visit' || action === 'both') && !isValidDate(visitDate)) {
      return { line, identifier, status: 'invalid', note: 'أدخل تاريخ زيارة صحيحاً.' };
    }
    if ((action === 'report' || action === 'both') && !isValidDate(reportDate)) {
      return { line, identifier, status: 'invalid', note: 'أدخل تاريخ تقرير صحيحاً.' };
    }
    if (action === 'report' && !school.visited) {
      return { line, identifier, status: 'invalid', note: 'لا يمكن إكمال التقرير قبل تسجيل الزيارة.' };
    }
    seenTargets.add(school.id);
    return {
      line,
      identifier,
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

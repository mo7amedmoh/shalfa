import { normalizeImportName, normalizeMinistryNumber } from './imports';
import { parsePastedPlanIdentifiers } from './planBulkUpdates';

export type GeneralPlanBulkSchool = {
  id: string;
  schoolName: string;
  ministryNumber: string;
  planId?: string;
};

export type GeneralPlanIdentifierStatus = 'matched' | 'unmatched' | 'not_in_plan' | 'duplicate' | 'ambiguous';

export type GeneralPlanIdentifierPreviewRow = {
  line: number;
  identifier: string;
  status: GeneralPlanIdentifierStatus;
  note: string;
  rowId?: string;
  planId?: string;
};

export type GeneralPlanIdentifierPreview = {
  rows: GeneralPlanIdentifierPreviewRow[];
  counts: Record<GeneralPlanIdentifierStatus, number>;
};

function isMinistryNumber(value: string): boolean {
  return /^[a-z]*[\d٠-٩۰-۹]+$/iu.test(value);
}

export function previewGeneralPlanIdentifiers(
  input: string,
  planSchools: readonly GeneralPlanBulkSchool[],
  allSchools: readonly GeneralPlanBulkSchool[],
): GeneralPlanIdentifierPreview {
  const planByNumber = new Map<string, GeneralPlanBulkSchool[]>();
  const planByName = new Map<string, GeneralPlanBulkSchool[]>();
  const allNumbers = new Set<string>();
  const allNames = new Set<string>();

  for (const school of allSchools) {
    const number = normalizeMinistryNumber(school.ministryNumber);
    const name = normalizeImportName(school.schoolName);
    if (number) allNumbers.add(number);
    if (name) allNames.add(name);
  }
  for (const school of planSchools) {
    const number = normalizeMinistryNumber(school.ministryNumber);
    const name = normalizeImportName(school.schoolName);
    if (number) planByNumber.set(number, [...(planByNumber.get(number) ?? []), school]);
    if (name) planByName.set(name, [...(planByName.get(name) ?? []), school]);
  }

  const seenIdentifiers = new Set<string>();
  const seenRows = new Set<string>();
  const rows = parsePastedPlanIdentifiers(input).map((identifier, index): GeneralPlanIdentifierPreviewRow => {
    const number = isMinistryNumber(identifier) ? normalizeMinistryNumber(identifier) : '';
    const name = number ? '' : normalizeImportName(identifier);
    const identity = number ? `number:${number}` : `name:${name}`;
    if (seenIdentifiers.has(identity)) {
      return { line: index + 1, identifier, status: 'duplicate', note: 'تكرر الرقم أو اسم المدرسة في القائمة.' };
    }
    seenIdentifiers.add(identity);

    const matches = number ? planByNumber.get(number) ?? [] : planByName.get(name) ?? [];
    if (!matches.length) {
      const exists = number ? allNumbers.has(number) : allNames.has(name);
      return {
        line: index + 1,
        identifier,
        status: exists ? 'not_in_plan' : 'unmatched',
        note: exists ? 'المدرسة موجودة، لكنها ليست ضمن هذه الخطة.' : 'لم يتم العثور على مدرسة مطابقة.',
      };
    }
    if (matches.length > 1) {
      return { line: index + 1, identifier, status: 'ambiguous', note: 'المدخل يطابق أكثر من صف في الخطة؛ استخدم الرقم الوزاري.' };
    }
    const [school] = matches;
    if (seenRows.has(school.id)) {
      return { line: index + 1, identifier, status: 'duplicate', note: 'سبق إدراج المدرسة نفسها في القائمة.', rowId: school.id };
    }
    seenRows.add(school.id);
    return {
      line: index + 1,
      identifier,
      status: 'matched',
      note: school.schoolName,
      rowId: school.id,
      planId: school.planId,
    };
  });

  return {
    rows,
    counts: {
      matched: rows.filter((row) => row.status === 'matched').length,
      unmatched: rows.filter((row) => row.status === 'unmatched').length,
      not_in_plan: rows.filter((row) => row.status === 'not_in_plan').length,
      duplicate: rows.filter((row) => row.status === 'duplicate').length,
      ambiguous: rows.filter((row) => row.status === 'ambiguous').length,
    },
  };
}

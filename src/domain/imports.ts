export function normalizeMinistryNumber(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value)
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .trim()
    .replace(/\s+/g, '')
    .toLocaleLowerCase();
}

export function normalizeImportName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();
}

export function matchImportEmployees<T extends { id: string; full_name: string }>(
  value: unknown,
  employees: readonly T[],
  aliases: readonly { alias_normalised: string; employee_id: string }[],
): T[] {
  const normalized = normalizeImportName(value);
  if (!normalized) return [];
  const alias = aliases.find((item) => item.alias_normalised === normalized);
  if (alias) {
    const employee = employees.find((item) => item.id === alias.employee_id);
    if (employee) return [employee];
  }
  return employees.filter((item) => normalizeImportName(item.full_name) === normalized);
}

export function normalizePhone(value: unknown): { phone: string | null; valid: boolean } {
  if (typeof value !== 'string' && typeof value !== 'number') return { phone: null, valid: false };
  let digits = String(value).replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[\s()+.-]/g, '');
  if (digits.startsWith('00966')) digits = digits.slice(2);
  if (digits.startsWith('966')) digits = digits.slice(3);
  if (digits.startsWith('05')) digits = digits.slice(1);
  if (/^5\d{8}$/.test(digits)) return { phone: `+966${digits}`, valid: true };
  return { phone: null, valid: false };
}

export function parseImportInteger(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value)
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .trim();
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parseImportDate(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86_400_000);
    return date.toISOString().slice(0, 10);
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const normalized = value.trim().replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0));
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(normalized);
  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(normalized);
  const parts = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : dmy ? [Number(dmy[3]), Number(dmy[2]), Number(dmy[1])] : null;
  if (parts) {
    const [year, month, day] = parts;
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
      ? `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      : null;
  }
  const parsed = new Date(normalized);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
}

export type MonthlyImportRow = {
  ministryNumber: string;
  buildingType: string;
  engineerName: string;
  plannedDate: string | null;
  supervisorName: string;
  contractorName: string;
  acDate: string | null;
  acSupervisor: string;
  notes: string;
};

export function parseMonthlyPlanRows(
  headers: readonly string[],
  records: readonly (readonly unknown[])[],
  dateHeader: string,
  assignmentHeader: string,
): MonthlyImportRow[] {
  const ministryIndex = headers.indexOf('الرقم الوزاري');
  const buildingIndex = headers.indexOf('تصنيف الوحدة');
  const engineerIndex = headers.indexOf('مهندس المرافق مقاول الباطن');
  const dateIndex = headers.indexOf(dateHeader);
  const assignmentIndex = headers.indexOf(assignmentHeader);
  const acDateIndex = headers.indexOf('تاريخ التكييف');
  const acSupervisorIndex = headers.indexOf('مشرف التكييف');
  const notesIndex = headers.indexOf('ملاحظات');
  if ([ministryIndex, buildingIndex, dateIndex, assignmentIndex].some((index) => index < 0)) {
    throw new Error('عناوين الأعمدة المطلوبة غير مكتملة.');
  }
  return records.map((record) => ({
    ministryNumber: String(record[ministryIndex] ?? '').trim(),
    buildingType: String(record[buildingIndex] ?? '').trim(),
    engineerName: engineerIndex < 0 ? '' : String(record[engineerIndex] ?? '').trim(),
    plannedDate: parseImportDate(record[dateIndex]),
    supervisorName: assignmentHeader.startsWith('مشرف ') ? String(record[assignmentIndex] ?? '').trim() : '',
    contractorName: assignmentHeader.startsWith('شركة ') ? String(record[assignmentIndex] ?? '').trim() : '',
    acDate: acDateIndex < 0 ? null : parseImportDate(record[acDateIndex]),
    acSupervisor: acSupervisorIndex < 0 ? '' : String(record[acSupervisorIndex] ?? '').trim(),
    notes: notesIndex < 0 ? '' : String(record[notesIndex] ?? '').trim(),
  }));
}

export function autoDetectImportColumns(
  headers: readonly string[],
  fields: Readonly<Record<string, readonly string[] | { aliases: readonly string[]; occurrence?: number }>>,
): Record<string, number> {
  const normalizeHeader = (header: string) => normalizeImportName(header).replace(/[^\p{L}\p{N}]/gu, '');
  const normalizedHeaders = headers.map(normalizeHeader);
  return Object.fromEntries(Object.entries(fields).flatMap(([field, hint]) => {
    const aliases = 'aliases' in hint ? hint.aliases : hint;
    const occurrence = 'aliases' in hint ? hint.occurrence ?? 0 : 0;
    const accepted = new Set(aliases.map(normalizeHeader));
    const matches = normalizedHeaders.flatMap((header, index) => accepted.has(header) ? [index] : []);
    const index = matches.length ? matches[Math.min(occurrence, matches.length - 1)] : -1;
    return index < 0 ? [] : [[field, index]];
  }));
}

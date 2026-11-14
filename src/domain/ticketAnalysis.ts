import { normalizeImportName, normalizeMinistryNumber, schoolPersonDefault } from './imports';

export interface TicketRecord {
  id: string;
  priority: string;
  status: string;
  slaStatus: string;
  categoryGroup: string;
  category: string;
  schoolNumber: string;
  schoolName: string;
  supervisor: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  resolvedAt: Date | null;
  reopened: boolean | null;
  qualityIssues: TicketRowQualityIssues;
}

export interface TicketRowQualityIssues {
  missingIdentifier: boolean;
  missingPriority: boolean;
  missingStatus: boolean;
  missingSlaStatus: boolean;
  missingCategory: boolean;
  missingSchool: boolean;
  missingCreatedDate: boolean;
  invalidCreatedDate: boolean;
}

export interface TicketDataWarnings {
  missingIdentifiers: number;
  missingPriorities: number;
  missingStatuses: number;
  missingSlaStatuses: number;
  missingCategories: number;
  missingSchools: number;
  missingCreatedDates: number;
  invalidCreatedDates: number;
  missingSupervisors: number;
}

export interface ParsedTickets {
  tickets: TicketRecord[];
  warnings: TicketDataWarnings;
  hasSupervisorColumn: boolean;
}

export interface TicketCount {
  label: string;
  count: number;
  percent: number;
}

export interface TicketSchoolSummary {
  key: string;
  name: string;
  schoolNumber: string;
  total: number;
  resolved: number;
  open: number;
  cancelled: number;
}

export interface RepeatedTicketSummary {
  schoolName: string;
  category: string;
  supervisor: string;
  count: number;
  open: number;
}

export interface TicketSupervisorSummary {
  name: string;
  total: number;
  resolved: number;
  open: number;
  cancelled: number;
  withinSla: number;
  breachedSla: number;
  warningSla: number;
  criticalOpen: number;
}

export interface TicketAnalysis {
  total: number;
  firstCreatedAt: Date | null;
  lastCreatedAt: Date | null;
  resolved: number;
  open: number;
  cancelled: number;
  assigned: number;
  inProgress: number;
  consultantApproval: number;
  reopened: number;
  critical: number;
  criticalOpen: number;
  statuses: Array<{ label: string; count: number; resolved: number; open: number; cancelled: number }>;
  priorities: TicketCount[];
  categories: TicketCount[];
  categoryGroups: TicketCount[];
  categoryGroupAvailable: boolean;
  schoolsCount: number;
  categoriesCount: number;
  sla: {
    within: number;
    warning: number;
    breached: number;
    unknown: number;
    assessed: number;
    compliancePercent: number | null;
    breachPercent: number | null;
  };
  averageResolutionHours: number | null;
  resolvedWithDuration: number;
  schoolsByTotal: TicketSchoolSummary[];
  schoolsByOpen: TicketSchoolSummary[];
  repeats: {
    groups: number;
    schools: number;
    tickets: number;
    additionalTickets: number;
    openTickets: number;
    top: RepeatedTicketSummary[];
  };
  supervisors: TicketSupervisorSummary[];
  hasSupervisorData: boolean;
}

export interface TicketSlaTrendPoint {
  month: string;
  assessed: number;
  monthlyCompliancePercent: number | null;
  cumulativeCompliancePercent: number | null;
}

export interface TicketSchoolSupervisorSource {
  ministryNumber: string;
  ministryKey: string | null;
  sourceFields: Record<string, unknown> | null;
}

type TicketField =
  | 'id'
  | 'priority'
  | 'status'
  | 'slaStatus'
  | 'categoryGroup'
  | 'category'
  | 'schoolNumber'
  | 'schoolName'
  | 'supervisor'
  | 'createdAt'
  | 'updatedAt'
  | 'resolvedAt'
  | 'reopened';

const fieldAliases: Record<TicketField, readonly string[]> = {
  id: ['معرف الحالة', 'رقم الحالة', 'case id', 'case number', 'ticket id', 'ticket number'],
  priority: ['الاولوية', 'priority', 'urgency'],
  status: ['الحالة', 'status', 'state'],
  slaStatus: ['حالة slm', 'حالة sla', 'slm status', 'sla status'],
  categoryGroup: ['الطبقة 2 للفئة', 'الفئة الطبقة 2', 'category level 2'],
  category: ['الطبقة 3 للفئة', 'الفئة الطبقة 3', 'category level 3', 'category'],
  schoolNumber: ['رقم المدرسة', 'school number', 'school id'],
  schoolName: ['اسم المبنى', 'اسم المدرسة', 'building name', 'school name'],
  supervisor: ['المشرف', 'اسم المشرف', 'المسؤول', 'مسؤول البلاغ', 'supervisor', 'assignee', 'assigned to'],
  createdAt: ['تاريخ الانشاء', 'تاريخ فتح البلاغ', 'created at', 'created on', 'creation date'],
  updatedAt: ['تاريخ التعديل', 'modified at', 'modified date', 'last modified'],
  resolvedAt: ['تاريخ الحل', 'تاريخ الاغلاق', 'resolved date', 'closed date'],
  reopened: ['معاد فتحها', 'اعيد فتحها', 'reopened', 'reopened status'],
};

const requiredFields: readonly TicketField[] = [
  'id',
  'priority',
  'status',
  'slaStatus',
  'category',
  'schoolName',
  'createdAt',
];

const schoolNumberHeaders = new Set([
  'رقم المدرسة',
  'الرقم الوزاري',
  'رقم المبنى',
  'school number',
  'school id',
  'ministry number',
].map(normalizeImportName));

export function normalizeTicketSchoolNumber(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return normalizeMinistryNumber(String(value).normalize('NFKC').trim().replace(/^s\s*-\s*/i, ''));
}

export function attachSchoolSupervisors(
  tickets: readonly TicketRecord[],
  schools: readonly TicketSchoolSupervisorSource[],
): TicketRecord[] {
  const supervisorsByNumber = new Map<string, Set<string>>();
  for (const school of schools) {
    const supervisor = schoolPersonDefault(
      { source_fields: school.sourceFields ?? {} },
      'supervisor',
      'maintenance',
    );
    if (!supervisor) continue;

    const numbers = new Set([
      normalizeTicketSchoolNumber(school.ministryNumber),
      normalizeTicketSchoolNumber(school.ministryKey),
      ...Object.entries(school.sourceFields ?? {})
        .filter(([header]) => schoolNumberHeaders.has(normalizeImportName(header)))
        .map(([, value]) => normalizeTicketSchoolNumber(value)),
    ]);
    for (const number of numbers) {
      if (!number) continue;
      const supervisors = supervisorsByNumber.get(number) ?? new Set<string>();
      supervisors.add(supervisor);
      supervisorsByNumber.set(number, supervisors);
    }
  }

  return tickets.map((ticket) => {
    if (ticket.supervisor.trim()) return ticket;
    const key = normalizeTicketSchoolNumber(ticket.schoolNumber);
    const supervisors = supervisorsByNumber.get(key);
    if (!supervisors || supervisors.size !== 1) return ticket;
    return { ...ticket, supervisor: [...supervisors][0] };
  });
}

const arabicDigits: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

function textValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  return String(value).trim();
}

function normalizedText(value: string): string {
  return value.normalize('NFKC')
    .toLocaleLowerCase('ar')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/[_-]+/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findColumns(headers: readonly string[]): Partial<Record<TicketField, string>> {
  const normalizedHeaders = new Map(headers.map((header) => [normalizedText(header), header]));
  const columns: Partial<Record<TicketField, string>> = {};
  for (const [field, aliases] of Object.entries(fieldAliases) as Array<[TicketField, readonly string[]]>) {
    const alias = aliases.find((candidate) => normalizedHeaders.has(normalizedText(candidate)));
    if (alias) columns[field] = normalizedHeaders.get(normalizedText(alias));
  }
  return columns;
}

function parseDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86_400_000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const source = textValue(value);
  if (!source) return null;
  const normalized = source
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/[٠-٩۰-۹]/g, (digit) => arabicDigits[digit] ?? digit)
    .trim();
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(normalized)) {
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const match = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s*[,،]?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(ص|م|am|pm)?)?$/i);
  if (!match) return null;
  const [, dayText, monthText, yearText, hourText = '0', minuteText = '0', secondText = '0', period = ''] = match;
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  let hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const normalizedPeriod = period.toLocaleLowerCase('ar');
  if ((normalizedPeriod === 'م' || normalizedPeriod === 'pm') && hour < 12) hour += 12;
  if ((normalizedPeriod === 'ص' || normalizedPeriod === 'am') && hour === 12) hour = 0;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day
    || hour > 23 || minute > 59 || second > 59) return null;
  return date;
}

function booleanValue(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  const normalized = normalizedText(textValue(value));
  if (['true', 'yes', '1', 'صواب', 'صحيح', 'نعم'].includes(normalized)) return true;
  if (['false', 'no', '0', 'خطا', 'لا'].includes(normalized)) return false;
  return null;
}

export function parseTicketRows(rows: readonly Record<string, unknown>[]): ParsedTickets {
  if (!rows.length) throw new Error('الملف لا يحتوي على صفوف بيانات.');
  const columns = findColumns(Object.keys(rows[0]));
  const missingHeaders = requiredFields.filter((field) => !columns[field]);
  if (missingHeaders.length) {
    const fieldLabels: Record<TicketField, string> = {
      id: 'مُعرّف الحالة',
      priority: 'الأولوية',
      status: 'الحالة',
      slaStatus: 'حالة SLA',
      categoryGroup: 'الفئة (الطبقة 2)',
      category: 'الفئة (الطبقة 3)',
      schoolNumber: 'رقم المدرسة',
      schoolName: 'اسم المدرسة أو المبنى',
      supervisor: 'المشرف',
      createdAt: 'تاريخ الإنشاء',
      updatedAt: 'تاريخ التعديل',
      resolvedAt: 'تاريخ الحل',
      reopened: 'معاد فتحها',
    };
    throw new Error(`تعذر تحليل الملف؛ الأعمدة المطلوبة غير موجودة: ${missingHeaders.map((field) => fieldLabels[field]).join('، ')}.`);
  }
  const records = rows.filter((row) => Object.values(row).some((value) => textValue(value) !== ''));
  if (!records.length) throw new Error('الورقة لا تحتوي على بلاغات بعد صف العناوين.');

  const warnings: TicketDataWarnings = {
    missingIdentifiers: 0,
    missingPriorities: 0,
    missingStatuses: 0,
    missingSlaStatuses: 0,
    missingCategories: 0,
    missingSchools: 0,
    missingCreatedDates: 0,
    invalidCreatedDates: 0,
    missingSupervisors: columns.supervisor ? 0 : records.length,
  };
  const tickets = records.map((row, index): TicketRecord => {
    const getValue = (field: TicketField) => columns[field] ? row[columns[field]!] : '';
    const id = textValue(getValue('id'));
    const priority = textValue(getValue('priority'));
    const status = textValue(getValue('status'));
    const slaStatus = textValue(getValue('slaStatus'));
    const categoryGroup = textValue(getValue('categoryGroup'));
    const category = textValue(getValue('category'));
    const schoolNumber = textValue(getValue('schoolNumber'));
    const schoolName = textValue(getValue('schoolName'));
    const supervisor = textValue(getValue('supervisor'));
    const createdValue = getValue('createdAt');
    const createdAt = parseDate(createdValue);
    const updatedAt = parseDate(getValue('updatedAt'));
    const resolvedAt = parseDate(getValue('resolvedAt'));
    const qualityIssues: TicketRowQualityIssues = {
      missingIdentifier: !id,
      missingPriority: !priority,
      missingStatus: !status,
      missingSlaStatus: !slaStatus,
      missingCategory: !category,
      missingSchool: !schoolName && !schoolNumber,
      missingCreatedDate: !textValue(createdValue),
      invalidCreatedDate: Boolean(textValue(createdValue) && !createdAt),
    };
    if (qualityIssues.missingIdentifier) warnings.missingIdentifiers += 1;
    if (qualityIssues.missingPriority) warnings.missingPriorities += 1;
    if (qualityIssues.missingStatus) warnings.missingStatuses += 1;
    if (qualityIssues.missingSlaStatus) warnings.missingSlaStatuses += 1;
    if (qualityIssues.missingCategory) warnings.missingCategories += 1;
    if (qualityIssues.missingSchool) warnings.missingSchools += 1;
    if (qualityIssues.missingCreatedDate) warnings.missingCreatedDates += 1;
    if (qualityIssues.invalidCreatedDate) warnings.invalidCreatedDates += 1;
    if (columns.supervisor && !supervisor) warnings.missingSupervisors += 1;
    return {
      id: id || `ROW-${index + 2}`,
      priority: priority || 'غير محدد',
      status: status || 'غير محدد',
      slaStatus: slaStatus || 'غير محدد',
      categoryGroup,
      category: category || 'غير مصنف',
      schoolNumber,
      schoolName: schoolName || 'مدرسة غير محددة',
      supervisor,
      createdAt,
      updatedAt,
      resolvedAt,
      reopened: booleanValue(getValue('reopened')),
      qualityIssues,
    };
  });
  return { tickets, warnings, hasSupervisorColumn: Boolean(columns.supervisor) };
}

export function deduplicateTicketRecords(tickets: readonly TicketRecord[]): TicketRecord[] {
  const byId = new Map<string, TicketRecord>();
  const withoutIdentifiers: TicketRecord[] = [];
  for (const ticket of tickets) {
    if (ticket.qualityIssues.missingIdentifier) {
      withoutIdentifiers.push(ticket);
      continue;
    }
    const existing = byId.get(ticket.id);
    if (!existing) {
      byId.set(ticket.id, ticket);
      continue;
    }
    const newest = (ticket.updatedAt?.getTime() ?? Number.NEGATIVE_INFINITY)
      >= (existing.updatedAt?.getTime() ?? Number.NEGATIVE_INFINITY)
      ? ticket
      : existing;
    byId.set(ticket.id, {
      ...newest,
      supervisor: newest.supervisor || existing.supervisor || ticket.supervisor,
    });
  }
  return [...byId.values(), ...withoutIdentifiers];
}

export function countTicketDataWarnings(tickets: readonly TicketRecord[]): TicketDataWarnings {
  const warnings: TicketDataWarnings = {
    missingIdentifiers: 0,
    missingPriorities: 0,
    missingStatuses: 0,
    missingSlaStatuses: 0,
    missingCategories: 0,
    missingSchools: 0,
    missingCreatedDates: 0,
    invalidCreatedDates: 0,
    missingSupervisors: 0,
  };
  for (const ticket of tickets) {
    const { qualityIssues } = ticket;
    if (qualityIssues.missingIdentifier) warnings.missingIdentifiers += 1;
    if (qualityIssues.missingPriority) warnings.missingPriorities += 1;
    if (qualityIssues.missingStatus) warnings.missingStatuses += 1;
    if (qualityIssues.missingSlaStatus) warnings.missingSlaStatuses += 1;
    if (qualityIssues.missingCategory) warnings.missingCategories += 1;
    if (qualityIssues.missingSchool) warnings.missingSchools += 1;
    if (qualityIssues.missingCreatedDate) warnings.missingCreatedDates += 1;
    if (qualityIssues.invalidCreatedDate) warnings.invalidCreatedDates += 1;
    if (!ticket.supervisor.trim()) warnings.missingSupervisors += 1;
  }
  return warnings;
}

export function filterTicketRecordsByCreatedMonth(
  tickets: readonly TicketRecord[],
  month: string,
): TicketRecord[] {
  return tickets.filter((ticket) => ticket.createdAt?.toISOString().slice(0, 7) === month);
}

export function filterTicketRecordsThroughMonth(
  tickets: readonly TicketRecord[],
  month: string,
): TicketRecord[] {
  return tickets.filter((ticket) => Boolean(ticket.createdAt && ticket.createdAt.toISOString().slice(0, 7) <= month));
}

type TicketState = 'resolved' | 'open' | 'cancelled' | 'unknown';
type SlaState = 'within' | 'warning' | 'breached' | 'unknown';

function ticketState(status: string): TicketState {
  const text = normalizedText(status);
  if (!text || text === normalizedText('غير محدد')) return 'unknown';
  if (text.includes('ملغ') || text.includes('cancel') || text.includes('void')) return 'cancelled';
  if (text.includes('حل') || text.includes('مغلق') || text.includes('closed') || text.includes('resolved') || text.includes('completed')) return 'resolved';
  return 'open';
}

function slaState(status: string): SlaState {
  const text = normalizedText(status);
  if (text.includes('مخترق') || text.includes('تجاوز') || text.includes('متاخر') || text.includes('breach') || text.includes('overdue')) return 'breached';
  if (text.includes('تحذير') || text.includes('warning')) return 'warning';
  if (text.includes('ضمن المهلة') || text.includes('within') || text.includes('compliant') || text.includes('on time')) return 'within';
  return 'unknown';
}

export function buildTicketSlaTrend(
  tickets: readonly TicketRecord[],
  throughMonth: string,
): TicketSlaTrendPoint[] {
  const [lastYear, lastMonth] = throughMonth.split('-').map(Number);
  if (!Number.isInteger(lastYear) || !Number.isInteger(lastMonth) || lastMonth < 1 || lastMonth > 12) return [];
  const monthly = new Map<string, { within: number; warning: number; breached: number }>();
  for (const ticket of tickets) {
    if (!ticket.createdAt) continue;
    const month = ticket.createdAt.toISOString().slice(0, 7);
    if (month > throughMonth) continue;
    const counts = monthly.get(month) ?? { within: 0, warning: 0, breached: 0 };
    const state = slaState(ticket.slaStatus);
    if (state === 'within') counts.within += 1;
    if (state === 'warning') counts.warning += 1;
    if (state === 'breached') counts.breached += 1;
    monthly.set(month, counts);
  }
  const firstMonth = [...monthly.keys()].sort()[0];
  if (!firstMonth) return [];

  const [firstYear, firstMonthNumber] = firstMonth.split('-').map(Number);
  const cursor = new Date(Date.UTC(firstYear, firstMonthNumber - 1, 1));
  const cumulative = { compliant: 0, assessed: 0 };
  const trend: TicketSlaTrendPoint[] = [];
  while (cursor.toISOString().slice(0, 7) <= throughMonth) {
    const month = cursor.toISOString().slice(0, 7);
    const counts = monthly.get(month) ?? { within: 0, warning: 0, breached: 0 };
    const assessed = counts.within + counts.warning + counts.breached;
    cumulative.compliant += counts.within + counts.warning;
    cumulative.assessed += assessed;
    trend.push({
      month,
      assessed,
      monthlyCompliancePercent: assessed ? ((counts.within + counts.warning) / assessed) * 100 : null,
      cumulativeCompliancePercent: cumulative.assessed
        ? (cumulative.compliant / cumulative.assessed) * 100
        : null,
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return trend;
}

function isCritical(priority: string): boolean {
  const text = normalizedText(priority);
  return text.includes('حرج') || text.includes('عاجل') || text.includes('critical') || text.includes('emergency');
}

function schoolKey(ticket: TicketRecord): string {
  const number = normalizedText(ticket.schoolNumber);
  if (number) return `number:${number}`;
  const name = normalizedText(ticket.schoolName);
  return name && name !== normalizedText('مدرسة غير محددة') ? `name:${name}` : '';
}

function sortedCounts(counter: Map<string, number>, total: number): TicketCount[] {
  return [...counter].map(([label, count]) => ({
    label,
    count,
    percent: total ? (count / total) * 100 : 0,
  })).sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'ar'));
}

export function analyzeTickets(tickets: readonly TicketRecord[], hasSupervisorData: boolean): TicketAnalysis {
  const states = tickets.map((ticket) => ticketState(ticket.status));
  const slaStates = tickets.map((ticket) => slaState(ticket.slaStatus));
  const resolved = states.filter((state) => state === 'resolved').length;
  const open = states.filter((state) => state === 'open').length;
  const cancelled = states.filter((state) => state === 'cancelled').length;
  const within = slaStates.filter((state) => state === 'within').length;
  const warning = slaStates.filter((state) => state === 'warning').length;
  const breached = slaStates.filter((state) => state === 'breached').length;
  const unknown = slaStates.filter((state) => state === 'unknown').length;
  const assessed = within + warning + breached;
  const compliancePercent = assessed ? ((within + warning) / assessed) * 100 : null;
  const breachPercent = assessed ? (breached / assessed) * 100 : null;
  const dates = tickets.flatMap((ticket) => ticket.createdAt ? [ticket.createdAt] : []);
  const resolvedDurations = tickets.flatMap((ticket) => {
    if (ticketState(ticket.status) !== 'resolved' || !ticket.createdAt || !ticket.resolvedAt) return [];
    const hours = (ticket.resolvedAt.getTime() - ticket.createdAt.getTime()) / 3_600_000;
    return Number.isFinite(hours) && hours >= 0 ? [hours] : [];
  });

  const statusGroups = new Map<string, { count: number; resolved: number; open: number; cancelled: number }>();
  const priorityGroups = new Map<string, number>();
  const categoryGroups = new Map<string, number>();
  const categoryLevel2Groups = new Map<string, number>();
  const schools = new Map<string, TicketSchoolSummary>();
  const repeats = new Map<string, { schoolKey: string; schoolName: string; category: string; supervisor: string; count: number; open: number }>();
  const supervisors = new Map<string, TicketSupervisorSummary>();

  tickets.forEach((ticket, index) => {
    const state = states[index];
    const sla = slaStates[index];
    const statusLabel = ticket.status || 'غير محدد';
    const statusGroup = statusGroups.get(statusLabel) ?? { count: 0, resolved: 0, open: 0, cancelled: 0 };
    statusGroup.count += 1;
    if (state === 'resolved') statusGroup.resolved += 1;
    if (state === 'open') statusGroup.open += 1;
    if (state === 'cancelled') statusGroup.cancelled += 1;
    statusGroups.set(statusLabel, statusGroup);
    priorityGroups.set(ticket.priority || 'غير محدد', (priorityGroups.get(ticket.priority || 'غير محدد') ?? 0) + 1);
    categoryGroups.set(ticket.category || 'غير مصنف', (categoryGroups.get(ticket.category || 'غير مصنف') ?? 0) + 1);
    if (ticket.categoryGroup) {
      categoryLevel2Groups.set(ticket.categoryGroup, (categoryLevel2Groups.get(ticket.categoryGroup) ?? 0) + 1);
    }

    const key = schoolKey(ticket);
    if (key) {
      const school = schools.get(key) ?? {
        key,
        name: ticket.schoolName || 'مدرسة غير محددة',
        schoolNumber: ticket.schoolNumber,
        total: 0,
        resolved: 0,
        open: 0,
        cancelled: 0,
      };
      school.total += 1;
      if (state === 'resolved') school.resolved += 1;
      if (state === 'open') school.open += 1;
      if (state === 'cancelled') school.cancelled += 1;
      schools.set(key, school);

      const categoryKey = normalizedText(ticket.category);
      if (categoryKey) {
        const repeatKey = `${key}|${categoryKey}`;
        const repeat = repeats.get(repeatKey) ?? {
          schoolKey: key,
          schoolName: ticket.schoolName,
          category: ticket.category,
          supervisor: ticket.supervisor,
          count: 0,
          open: 0,
        };
        repeat.count += 1;
        if (state === 'open') repeat.open += 1;
        if (!repeat.supervisor && ticket.supervisor) repeat.supervisor = ticket.supervisor;
        repeats.set(repeatKey, repeat);
      }
    }

    if (ticket.supervisor) {
      const supervisor = supervisors.get(ticket.supervisor) ?? {
        name: ticket.supervisor,
        total: 0,
        resolved: 0,
        open: 0,
        cancelled: 0,
        withinSla: 0,
        breachedSla: 0,
        warningSla: 0,
        criticalOpen: 0,
      };
      supervisor.total += 1;
      if (state === 'resolved') supervisor.resolved += 1;
      if (state === 'open') supervisor.open += 1;
      if (state === 'cancelled') supervisor.cancelled += 1;
      if (sla === 'within') supervisor.withinSla += 1;
      if (sla === 'warning') supervisor.warningSla += 1;
      if (sla === 'breached') supervisor.breachedSla += 1;
      if (state === 'open' && isCritical(ticket.priority)) supervisor.criticalOpen += 1;
      supervisors.set(ticket.supervisor, supervisor);
    }
  });

  const repeatedGroups = [...repeats.values()].filter((item) => item.count > 1);
  const sortedSchools = [...schools.values()].sort((left, right) =>
    right.total - left.total || left.name.localeCompare(right.name, 'ar'));
  const openSchools = [...schools.values()].filter((school) => school.open > 0).sort((left, right) =>
    right.open - left.open || left.name.localeCompare(right.name, 'ar'));
  const topRepeats = repeatedGroups.sort((left, right) =>
    right.count - left.count || left.schoolName.localeCompare(right.schoolName, 'ar') || left.category.localeCompare(right.category, 'ar'));
  const firstCreatedTimestamp = dates.reduce((value, date) => Math.min(value, date.getTime()), Number.POSITIVE_INFINITY);
  const lastCreatedTimestamp = dates.reduce((value, date) => Math.max(value, date.getTime()), Number.NEGATIVE_INFINITY);

  return {
    total: tickets.length,
    firstCreatedAt: dates.length ? new Date(firstCreatedTimestamp) : null,
    lastCreatedAt: dates.length ? new Date(lastCreatedTimestamp) : null,
    resolved,
    open,
    cancelled,
    assigned: tickets.filter((ticket) => normalizedText(ticket.status).includes('تعيين') || normalizedText(ticket.status).includes('assigned')).length,
    inProgress: tickets.filter((ticket) => normalizedText(ticket.status).includes('قيد التنفيذ') || normalizedText(ticket.status).includes('in progress')).length,
    consultantApproval: tickets.filter((ticket) => normalizedText(ticket.status).includes('موافقة الاستشاري') || normalizedText(ticket.status).includes('consultant')).length,
    reopened: tickets.filter((ticket) => ticket.reopened === true).length,
    critical: tickets.filter((ticket) => isCritical(ticket.priority)).length,
    criticalOpen: tickets.filter((ticket, index) => states[index] === 'open' && isCritical(ticket.priority)).length,
    statuses: [...statusGroups].map(([label, counts]) => ({ label, ...counts })).sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'ar')),
    priorities: sortedCounts(priorityGroups, tickets.length),
    categories: sortedCounts(categoryGroups, tickets.length),
    categoryGroups: sortedCounts(categoryLevel2Groups, tickets.length),
    categoryGroupAvailable: tickets.some((ticket) => Boolean(ticket.categoryGroup)),
    schoolsCount: schools.size,
    categoriesCount: categoryGroups.size,
    sla: {
      within,
      warning,
      breached,
      unknown,
      assessed,
      compliancePercent,
      breachPercent,
    },
    averageResolutionHours: resolvedDurations.length
      ? resolvedDurations.reduce((sum, hours) => sum + hours, 0) / resolvedDurations.length
      : null,
    resolvedWithDuration: resolvedDurations.length,
    schoolsByTotal: sortedSchools.slice(0, 15),
    schoolsByOpen: openSchools.slice(0, 15),
    repeats: {
      groups: repeatedGroups.length,
      schools: new Set(repeatedGroups.map((item) => item.schoolKey)).size,
      tickets: repeatedGroups.reduce((sum, item) => sum + item.count, 0),
      additionalTickets: repeatedGroups.reduce((sum, item) => sum + item.count - 1, 0),
      openTickets: repeatedGroups.reduce((sum, item) => sum + item.open, 0),
      top: topRepeats.slice(0, 15).map(({ schoolName, category, supervisor, count, open: repeatedOpen }) => ({
        schoolName,
        category,
        supervisor,
        count,
        open: repeatedOpen,
      })),
    },
    supervisors: [...supervisors.values()].sort((left, right) =>
      right.total - left.total || left.name.localeCompare(right.name, 'ar')),
    hasSupervisorData,
  };
}

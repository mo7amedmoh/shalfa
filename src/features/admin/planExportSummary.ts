import { normalisePlanName } from '../../domain/customPlans';

export type PlanSummaryCategory =
  | 'maintenance'
  | 'cleaning'
  | 'security'
  | 'elevators'
  | 'water'
  | 'sewage';

export type PlanSummaryRecord = {
  id: string;
  schoolId: string | null;
  schoolName: string;
  ministryNumber: string;
  periodKey: string;
  category: PlanSummaryCategory | null;
  extraType?: string;
  plannedDate: string | null;
  engineerName: string | null;
  responsibleName: string | null;
  contractorName: string | null;
  visited: boolean | null;
  reportDone: boolean | null;
};

type SummaryColumn = { key: string; header: string };

const fixedColumns: SummaryColumn[] = [
  { key: 'school', header: 'المدرسة' },
  { key: 'ministryNumber', header: 'الرقم الوزاري' },
  { key: 'maintenanceEngineer', header: 'المهندس' },
  { key: 'maintenanceDate', header: 'تاريخ خطة الصيانة' },
  { key: 'maintenanceSupervisor', header: 'مشرف الصيانة' },
  { key: 'maintenanceVisited', header: 'تمت الزيارة' },
  { key: 'maintenanceReport', header: 'تم التقرير' },
  { key: 'cleaningDate', header: 'تاريخ خطة النظافة' },
  { key: 'cleaningSupervisor', header: 'مشرف النظافة' },
  { key: 'cleaningVisited', header: 'تمت الزيارة' },
  { key: 'cleaningReport', header: 'تم التقرير' },
  { key: 'securityDate', header: 'تاريخ خطة الامن و السلامة' },
  { key: 'securityContractor', header: 'مقاول الامن و السلامة' },
  { key: 'securityVisited', header: 'تمت الزيارة' },
  { key: 'securityReport', header: 'تم التقرير' },
  { key: 'elevatorsDate', header: 'تاريخ خطة المصاعد' },
  { key: 'elevatorsContractor', header: 'مقاول المصاعد' },
  { key: 'elevatorsVisited', header: 'تمت الزيارة' },
  { key: 'elevatorsReport', header: 'تم التقرير' },
  { key: 'waterDate', header: 'تاريخ خطة توريد المياة' },
  { key: 'waterVisited', header: 'تمت الزيارة' },
  { key: 'sewageDate', header: 'تاريخ خطة النزح' },
  { key: 'sewageVisited', header: 'تمت الزيارة' },
];

const categoryColumns: Record<PlanSummaryCategory, Partial<Record<keyof PlanSummaryRecord, string>>> = {
  maintenance: {
    plannedDate: 'maintenanceDate',
    engineerName: 'maintenanceEngineer',
    responsibleName: 'maintenanceSupervisor',
    visited: 'maintenanceVisited',
    reportDone: 'maintenanceReport',
  },
  cleaning: {
    plannedDate: 'cleaningDate',
    responsibleName: 'cleaningSupervisor',
    visited: 'cleaningVisited',
    reportDone: 'cleaningReport',
  },
  security: {
    plannedDate: 'securityDate',
    contractorName: 'securityContractor',
    visited: 'securityVisited',
    reportDone: 'securityReport',
  },
  elevators: {
    plannedDate: 'elevatorsDate',
    contractorName: 'elevatorsContractor',
    visited: 'elevatorsVisited',
    reportDone: 'elevatorsReport',
  },
  water: { plannedDate: 'waterDate', visited: 'waterVisited' },
  sewage: { plannedDate: 'sewageDate', visited: 'sewageVisited' },
};

const extraFields = [
  { suffix: 'date', label: 'تاريخ الخطة', source: 'plannedDate' },
  { suffix: 'engineer', label: 'المهندس', source: 'engineerName' },
  { suffix: 'responsible', label: 'المسؤول', source: 'responsibleName' },
  { suffix: 'visited', label: 'تمت الزيارة', source: 'visited' },
  { suffix: 'report', label: 'تم التقرير', source: 'reportDone' },
] as const;

function categoryForName(name: string): PlanSummaryCategory | null {
  const normalised = normalisePlanName(name);
  if (normalised.includes('توريد') && normalised.includes('مياه')) return 'water';
  if (normalised.includes('نزح') || normalised.includes('صرف صحي')) return 'sewage';
  if (normalised.includes('مصاعد') || normalised.includes('مصعد')) return 'elevators';
  if (normalised.includes('امن') || normalised.includes('سلامه')) return 'security';
  if (normalised.includes('نظافه') || normalised.includes('تنظيف')) return 'cleaning';
  if (normalised.includes('صيانه') || normalised.includes('تكييف')) return 'maintenance';
  return null;
}

function displayValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'نعم' : 'لا';
  return value == null ? '' : String(value);
}

function appendValue(target: Record<string, string>, key: string, value: unknown) {
  const next = displayValue(value);
  if (!next) return;
  target[key] = target[key] ? `${target[key]}\n${next}` : next;
}

export function buildPlanSummary(records: readonly PlanSummaryRecord[]) {
  const extraTypes = [...new Set(records
    .filter((record) => !record.category && record.extraType)
    .map((record) => record.extraType!))]
    .sort((left, right) => left.localeCompare(right, 'ar'));
  const columns = [
    ...fixedColumns,
    ...extraTypes.flatMap((name) => extraFields.map(({ suffix, label }) => ({
      key: `extra:${name}:${suffix}`,
      header: `${name} - ${label}`,
    }))),
  ];
  const rows = new Map<string, Record<string, string>>();

  for (const record of records) {
    const schoolKey = record.schoolId
      ?? (record.ministryNumber ? `ministry:${record.ministryNumber}` : record.schoolName ? `name:${record.schoolName}` : `unknown:${record.id}`);
    const rowKey = `${schoolKey}\u001f${record.periodKey}`;
    let row = rows.get(rowKey);
    if (!row) {
      row = { school: record.schoolName, ministryNumber: record.ministryNumber };
      rows.set(rowKey, row);
    } else {
      if (!row.school && record.schoolName) row.school = record.schoolName;
      if (!row.ministryNumber && record.ministryNumber) row.ministryNumber = record.ministryNumber;
    }

    if (record.category) {
      for (const [source, target] of Object.entries(categoryColumns[record.category])) {
        appendValue(row, target, record[source as keyof PlanSummaryRecord]);
      }
    } else if (record.extraType) {
      for (const { suffix, source } of extraFields) {
        appendValue(row, `extra:${record.extraType}:${suffix}`, record[source as keyof PlanSummaryRecord]);
      }
    }
  }

  return { columns, rows: [...rows.values()] };
}

export function matchCustomPlanCategory(name: string): PlanSummaryCategory | null {
  return categoryForName(name);
}

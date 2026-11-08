import { useMemo, useState } from 'react';
import { Download, FileSpreadsheet, Upload, X } from 'lucide-react';
import type * as XLSX from 'xlsx';
import { loadXlsx } from '../../lib/xlsx';
import { z } from 'zod';
import { autoDetectImportColumns, matchImportEmployees, normalizeImportName, normalizeMinistryNumber, normalizePhone, parseImportDate, parseMonthlyPlanRows, resolvePlanPerson, schoolPersonDefault } from '../../domain/imports';
import { eligibleSchoolIds, type PlanEligibilityConfig } from '../../domain/planEligibility';
import type { GeneralPlanType, PlanType } from '../../domain/types';
import type { UserProfile } from '../../lib/auth';
import { APP_SCHEMA_SELECT } from '../../lib/schemaColumns';
import { supabase } from '../../lib/supabase';

type ImportTarget =
  | { kind: 'monthly'; planType: PlanType }
  | { kind: 'general'; planType: GeneralPlanType }
  | { kind: 'cleaners' }
  | { kind: 'gatekeepers' };

type Field = { key: string; label: string; aliases: string[]; required?: boolean; occurrence?: number };
type SchoolRef = { id: string; ministry_no: string; name: string; plan_scope: boolean; source_fields: Record<string, unknown> };
type EmployeeRef = { id: string; full_name: string; employee_no: string | null; category: string; job_title: string | null; phone: string | null };
type AliasRef = { alias_normalised: string; employee_id: string };
type ImportReferences = {
  schools: SchoolRef[];
  employees: EmployeeRef[];
  aliases: AliasRef[];
  gatekeeperSchoolIds: Set<string>;
  existingGatekeeperPhones: string[];
  eligibility: PlanEligibilityConfig | null;
};
type ImportRow = {
  line: number;
  values: Record<string, unknown>;
  schoolId: string;
  engineerId: string;
  supervisorId: string;
  employeeId: string;
  phone: string | null;
};
type ReportRow = { line: number; ministryNumber: string; status: 'created' | 'updated' | 'skipped' | 'needs_attention'; note: string };

const schoolSchema = z.object({
  id: z.string().uuid(),
  ministry_no: z.string(),
  name: z.string(),
  plan_scope: z.boolean(),
  source_fields: z.record(z.string(), z.unknown()),
});
const eligibilitySchema = z.object({
  buildingTypeHeader: z.string(),
  independentBuildingValues: z.array(z.string()),
  primarySharedValues: z.array(z.string()),
  elevatorContractorHeader: z.string(),
  noElevatorValues: z.array(z.string()),
});
const employeeSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  employee_no: z.string().nullable(),
  category: z.string(),
  job_title: z.string().nullable(),
  phone: z.string().nullable(),
});
const aliasesSchema = z.array(z.object({ alias_normalised: z.string(), employee_id: z.string().uuid() }));
const roleCanImport = (profile: UserProfile | null) =>
  Boolean(profile && ['admin', 'project_manager', 'area_engineer'].includes(profile.role));
const monthlyNames: Record<PlanType, { date: string; assignment: string }> = {
  maintenance: { date: 'تاريخ الصيانة', assignment: 'مشرف الصيانة' },
  cleaning: { date: 'تاريخ النظافة', assignment: 'مشرف النظافة' },
  security_safety: { date: 'تاريخ الأمن و السلامة', assignment: 'شركة الأمن و السلامة' },
  elevators: { date: 'تاريخ المصاعد', assignment: 'شركة المصاعد' },
};
const monthlyLabels: Record<PlanType, string> = {
  maintenance: 'الصيانة والتكييف',
  cleaning: 'النظافة',
  security_safety: 'الأمن والسلامة',
  elevators: 'المصاعد',
};
const generalNames: Record<string, { date: string; notes?: string }> = {
  water_supply: { date: 'تاريخ توريد المياه', notes: 'ملاحظات توريد مياة' },
  sewage_waste: { date: 'تاريخ النزح', notes: 'ملاحظات النزح' },
  sewage_removal: { date: 'تاريخ النزح', notes: 'ملاحظات النزح' },
};
const generalLabels: Record<GeneralPlanType, string> = {
  gardening: 'البستنة',
  landscaping: 'التنسيق',
  sewage_waste: 'نزح مخلفات الصرف الصحي',
  water_supply: 'توريد المياه',
  tank_washing: 'غسيل الخزانات',
  pest_control: 'مكافحة الآفات ورش المبيدات',
  annual_readiness: 'خطط الاستعداد السنوية',
};

function fieldsFor(target: ImportTarget): Field[] {
  if (target.kind === 'monthly') {
    const service = monthlyNames[target.planType];
    return [
      { key: 'ministry', label: 'الرقم الوزاري', aliases: ['الرقم الوزاري'], required: true },
      { key: 'buildingType', label: 'تصنيف الوحدة', aliases: ['تصنيف الوحدة', 'نوع المبنى'], required: true },
      { key: 'engineer', label: 'مهندس المرافق مقاول الباطن', aliases: ['مهندس المرافق مقاول الباطن', 'اسم مهندس المرافق'], required: true },
      { key: 'plannedDate', label: service.date, aliases: [service.date], required: true },
      { key: 'assignment', label: service.assignment, aliases: [service.assignment], required: true },
      ...(target.planType === 'maintenance' ? [
        { key: 'acDate', label: 'تاريخ التكييف', aliases: ['تاريخ التكييف'] },
        { key: 'acSupervisor', label: 'مشرف التكييف', aliases: ['مشرف التكييف'] },
      ] : []),
    ];
  }
  if (target.kind === 'general') {
    const special = generalNames[target.planType] ?? {};
    return [
      { key: 'ministry', label: 'الرقم الوزاري', aliases: ['الرقم الوزاري'], required: true },
      ...(special.date ? [{ key: 'buildingType', label: 'تصنيف الوحدة', aliases: ['تصنيف الوحدة', 'نوع المبنى'] }] : []),
      { key: 'plannedDate', label: special.date ?? 'التاريخ المخطط', aliases: [special.date ?? 'التاريخ المخطط', 'التاريخ', 'تاريخ التنفيذ'], required: true },
      { key: 'engineer', label: 'اسم المهندس', aliases: ['اسم المهندس', 'اسم مهندس المرافق'] },
      { key: 'supervisor', label: 'اسم المشرف', aliases: ['اسم المشرف', 'مشرف الخطة'] },
      ...(special.notes ? [{ key: 'notes', label: special.notes, aliases: [special.notes] }] : [{ key: 'notes', label: 'ملاحظات', aliases: ['ملاحظات'] }]),
    ];
  }
  if (target.kind === 'cleaners') {
    return [
      { key: 'ministry', label: 'الرقم الوزاري', aliases: ['الرقم الوزاري'], required: true },
      { key: 'fullName', label: 'اسم العامل', aliases: ['اسم العامل', 'اسم عامل النظافة', 'اسم العامل / ة', 'اسم الموظف'], required: true },
      { key: 'residence', label: 'رقم الإقامة', aliases: ['رقم الإقامة', 'رقم الاقامة'] },
      { key: 'labourSource', label: 'مصدر العمالة', aliases: ['مصدر العمالة', 'مصدر العامل'] },
      { key: 'employeeNo', label: 'الرقم الوظيفي', aliases: ['الرقم الوظيفي', 'رقم الموظف'] },
    ];
  }
  return [
    { key: 'ministry', label: 'الرقم الوزاري', aliases: ['الرقم الوزاري'], required: true },
    { key: 'schoolName', label: 'اسم المدرسة', aliases: ['اسم المدرسة'] },
    { key: 'fullName', label: 'اسم البواب', aliases: ['اسم البواب', 'البواب', 'اسم الحارس'], required: true },
    { key: 'employeeNo', label: 'الرقم الوظيفي', aliases: ['الرقم الوظيفي', 'رقم الموظف'] },
    { key: 'residence', label: 'رقم الإقامة', aliases: ['رقم الإقامة', 'رقم الاقامة'] },
    { key: 'phone', label: 'رقم الجوال', aliases: ['رقم الجوال', 'رقم الهاتف', 'رقم التواصل', 'رقم الاتصال'] },
    { key: 'notes', label: 'ملاحظات', aliases: ['ملاحظات'] },
  ];
}

function templateHeaders(target: ImportTarget): string[] {
  return fieldsFor(target).map(({ label }) => label);
}

async function downloadWorkbook(name: string, rows: unknown[][]) {
  const XLSX = await loadXlsx();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'نموذج');
  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function targetLabel(target: ImportTarget): string {
  if (target.kind === 'monthly') return `الخطة الشهرية: ${monthlyLabels[target.planType]}`;
  if (target.kind === 'general') return `الخطة العامة: ${generalLabels[target.planType]}`;
  return target.kind === 'cleaners' ? 'تسكين العمالة' : 'تسكين البوابين';
}

function maskResidence(value: unknown): string {
  const digits = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  return digits ? `${'•'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}` : '—';
}

function reportStatus(rows: readonly ReportRow[]) {
  return {
    created: rows.filter((row) => row.status === 'created').length,
    updated: rows.filter((row) => row.status === 'updated').length,
    skipped: rows.filter((row) => row.status === 'skipped').length,
    needsAttention: rows.filter((row) => row.status === 'needs_attention').length,
  };
}

async function loadAllPages<T>(fetchPage: (start: number, end: number) => Promise<T[]>): Promise<T[]> {
  const rows: T[] = [];
  for (let start = 0; ; start += 1000) {
    const page = await fetchPage(start, start + 999);
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

export function ImportWizardLauncher({ target, profile }: { target: ImportTarget; profile: UserProfile | null }) {
  const [open, setOpen] = useState(false);
  if (!roleCanImport(profile)) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg border border-brand-300 px-4 py-2 text-sm font-bold text-brand-800 hover:bg-brand-50">
        استيراد Excel
      </button>
      {open && <ImportWizard target={target} profile={profile} onClose={() => setOpen(false)} />}
    </>
  );
}

function ImportWizard({ target, profile, onClose }: { target: ImportTarget; profile: UserProfile | null; onClose: () => void }) {
  const fields = useMemo(() => fieldsFor(target), [target]);
  const [step, setStep] = useState<'upload' | 'map' | 'preview' | 'report'>('upload');
  const [fileName, setFileName] = useState('');
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [sheets, setSheets] = useState<string[]>([]);
  const [sheetName, setSheetName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [sourceRows, setSourceRows] = useState<unknown[][]>([]);
  const [formattedRows, setFormattedRows] = useState<unknown[][]>([]);
  const [columnMap, setColumnMap] = useState<Record<string, number>>({});
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [references, setReferences] = useState<ImportReferences | null>(null);
  const [referenceError, setReferenceError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState('');
  const [report, setReport] = useState<ReportRow[]>([]);
  const [rememberAliases, setRememberAliases] = useState<Record<string, boolean>>({});

  const months = useMemo(() => [...new Set(rows.map((row) => parseImportDate(row.values.plannedDate)).filter((date): date is string => Boolean(date)).map((date) => date.slice(0, 7)))].sort(), [rows]);
  const invalidDateCount = useMemo(() => rows.filter((row) => String(row.values.plannedDate ?? '').trim() && !parseImportDate(row.values.plannedDate)).length, [rows]);
  const outsideMonthCount = useMemo(() => rows.filter((row) => {
    const date = parseImportDate(row.values.plannedDate);
    return Boolean(date && selectedMonth && date.slice(0, 7) !== selectedMonth);
  }).length, [rows, selectedMonth]);

  async function loadReferences(): Promise<ImportReferences> {
    if (!supabase) throw new Error('يلزم إعداد الاتصال بقاعدة البيانات.');
    const client = supabase;
    const [schools, employees, aliases, gatekeepers, configResult] = await Promise.all([
      loadAllPages(async (start, end) => {
        let query = client.from('schools').select(APP_SCHEMA_SELECT.schoolsImport).order('name');
        if (target.kind === 'gatekeepers') query = query.eq('plan_scope', true);
        const { data, error } = await query.range(start, end);
        if (error) throw error;
        return data;
      }),
      loadAllPages(async (start, end) => {
        const { data, error } = await client.from('employees').select(APP_SCHEMA_SELECT.employeesForImport).order('full_name').range(start, end);
        if (error) throw error;
        return data;
      }),
      loadAllPages(async (start, end) => {
        const { data, error } = await client.from('supervisor_aliases').select(APP_SCHEMA_SELECT.supervisorAliases).range(start, end);
        if (error) throw error;
        return data;
      }),
      loadAllPages(async (start, end) => {
        const { data, error } = await client.from('gatekeepers').select(APP_SCHEMA_SELECT.gatekeeperPhones).range(start, end);
        if (error) throw error;
        return data;
      }),
      client.from('app_config').select(APP_SCHEMA_SELECT.appConfigValue).eq('key', 'plan_eligibility').maybeSingle(),
    ]);
    if (configResult.error) throw configResult.error;
    const eligibility = configResult.data ? eligibilitySchema.parse(configResult.data.value) : null;
    const gatekeeperRows = z.array(z.object({ school_id: z.string().uuid(), phone: z.string().nullable() })).parse(gatekeepers);
    return {
      schools: z.array(schoolSchema).parse(schools),
      employees: z.array(employeeSchema).parse(employees),
      aliases: aliasesSchema.parse(aliases),
      gatekeeperSchoolIds: new Set(gatekeeperRows.map((row) => row.school_id)),
      existingGatekeeperPhones: gatekeeperRows.map((row) => row.phone ?? ''),
      eligibility,
    };
  }

  async function handleFile(file: File | undefined) {
    setMessage('');
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) {
      setMessage('ارفع ملف Excel بامتداد .xlsx فقط.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setMessage('الحد الأقصى لحجم الملف 5 ميغابايت.');
      return;
    }
    try {
      const XLSX = await loadXlsx();
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
      if (!workbook.SheetNames.length) throw new Error('لا توجد أوراق عمل في الملف.');
      setWorkbook(workbook);
      setFileName(file.name);
      setSheets(workbook.SheetNames);
      setSheetName(workbook.SheetNames[0]);
      await readSheet(workbook, workbook.SheetNames[0]);
      setStep('map');
      try {
        setReferences(await loadReferences());
        setReferenceError('');
      } catch (error) {
        setReferenceError(error instanceof Error ? error.message : 'تعذر تحميل بيانات المطابقة.');
      }
    } catch (error) {
      setMessage(`تعذر قراءة الملف: ${error instanceof Error ? error.message : 'خطأ غير معروف'}`);
    }
  }

  async function readSheet(workbook: XLSX.WorkBook, selected: string) {
    const XLSX = await loadXlsx();
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[selected], { header: 1, raw: true, defval: '' });
    const formattedMatrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[selected], { header: 1, raw: false, defval: '' });
    const [headerRow = [], ...dataRows] = matrix;
    const nextHeaders = headerRow.map((value) => String(value ?? '').trim());
    setHeaders(nextHeaders);
    setSourceRows(dataRows);
    setFormattedRows(formattedMatrix.slice(1));
    setColumnMap(autoDetectImportColumns(nextHeaders, Object.fromEntries(fields.map(({ key, aliases, occurrence }) => [
      key,
      { aliases, occurrence },
    ]))));
  }

  function mappedValue(source: readonly unknown[], formatted: readonly unknown[], key: string): unknown {
    const column = columnMap[key];
    if (column === undefined) return '';
    if (['ministry', 'employeeNo', 'residence', 'phone'].includes(key)) {
      return formatted[column] ?? source[column] ?? '';
    }
    return source[column] ?? '';
  }

  async function selectSheet(value: string) {
    if (!fileName || !workbook) return;
    try {
      setSheetName(value);
      void readSheet(workbook, value);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذر قراءة الورقة.');
    }
  }

  function buildPreview() {
    const missing = fields.filter((field) => field.required && columnMap[field.key] === undefined);
    if (missing.length) {
      setMessage(`اربط الأعمدة المطلوبة: ${missing.map(({ label }) => label).join('، ')}`);
      return;
    }
    const mappedIndexes = fields.flatMap(({ key }) => columnMap[key] === undefined ? [] : [columnMap[key]]);
    if (new Set(mappedIndexes).size !== mappedIndexes.length) {
      setMessage('لا يمكن ربط أكثر من حقل بالعمود نفسه.');
      return;
    }
    let parsed: ImportRow[];
    if (target.kind === 'monthly') {
      const virtualHeaders = Array.from({ length: headers.length }, () => '');
      const canonicalHeaders: Record<string, string> = {
        ministry: 'الرقم الوزاري',
        buildingType: 'تصنيف الوحدة',
        engineer: 'مهندس المرافق مقاول الباطن',
        plannedDate: monthlyNames[target.planType].date,
        assignment: monthlyNames[target.planType].assignment,
        acDate: 'تاريخ التكييف',
        acSupervisor: 'مشرف التكييف',
      };
      fields.forEach(({ key }) => {
        if (columnMap[key] !== undefined) virtualHeaders[columnMap[key]] = canonicalHeaders[key] ?? '';
      });
      const monthlyRows = parseMonthlyPlanRows(
        virtualHeaders,
        sourceRows,
        monthlyNames[target.planType].date,
        monthlyNames[target.planType].assignment,
      );
      parsed = monthlyRows.map((monthly, index) => ({
        line: index + 2,
        values: {
          ministry: mappedValue(sourceRows[index] ?? [], formattedRows[index] ?? [], 'ministry') || monthly.ministryNumber,
          buildingType: monthly.buildingType,
          engineer: monthly.engineerName,
          plannedDate: monthly.plannedDate,
          assignment: monthly.supervisorName || monthly.contractorName,
          acDate: monthly.acDate,
          acSupervisor: monthly.acSupervisor,
        },
        schoolId: '',
        engineerId: '',
        supervisorId: '',
        employeeId: '',
        phone: null,
      }));
    } else {
      parsed = sourceRows.map((source, index) => ({
        line: index + 2,
        values: Object.fromEntries(fields.map(({ key }) => [key, mappedValue(source, formattedRows[index] ?? [], key)])),
        schoolId: '',
        engineerId: '',
        supervisorId: '',
        employeeId: '',
        phone: null,
      }));
    }
    setRows(parsed);
    const dateCounts = new Map<string, number>();
    parsed.forEach((row) => {
      const month = parseImportDate(row.values.plannedDate)?.slice(0, 7);
      if (month) dateCounts.set(month, (dateCounts.get(month) ?? 0) + 1);
    });
    const detectedMonth = [...dateCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? '';
    setSelectedMonth(detectedMonth);
    setStep('preview');
    setMessage('');
  }

  function updateRow(index: number, patch: Partial<ImportRow>) {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  }

  function schoolCandidates(row: ImportRow): SchoolRef[] {
    if (!references) return [];
    const ministry = normalizeMinistryNumber(row.values.ministry);
    return ministry ? references.schools.filter((school) => normalizeMinistryNumber(school.ministry_no) === ministry) : [];
  }

  function matchEmployee(name: unknown, category?: string): EmployeeRef[] {
    if (!references) return [];
    return matchImportEmployees(name, references.employees, references.aliases)
      .filter((employee) => !category || employee.category === category);
  }

  function rowState(row: ImportRow, index: number): { status: 'ready' | 'skipped' | 'attention'; notes: string[]; school: SchoolRef | null; engineer: EmployeeRef | null; supervisor: EmployeeRef | null; engineerName: string; supervisorName: string; employee: EmployeeRef | null } {
    const notes: string[] = [];
    const schoolMatches = schoolCandidates(row);
    const school = row.schoolId ? references?.schools.find((item) => item.id === row.schoolId) ?? null : schoolMatches.length === 1 ? schoolMatches[0] : null;
    const uniqueSchoolTarget = target.kind === 'monthly' || target.kind === 'general' || target.kind === 'gatekeepers';
    const duplicateTargetSchool = uniqueSchoolTarget && school
      ? rows.some((other, otherIndex) => {
        if (otherIndex === index) return false;
        const otherSchool = other.schoolId
          ? references?.schools.find((item) => item.id === other.schoolId)
          : schoolCandidates(other).length === 1 ? schoolCandidates(other)[0] : null;
        return otherSchool?.id === school.id;
      })
      : false;
    if (school && !school.plan_scope) {
      return { status: 'skipped', notes: ['المدرسة خارج نطاق الأهلية المعتمدة للخطة أو التسكين.'], school, engineer: null, supervisor: null, engineerName: '', supervisorName: '', employee: null };
    }
    if ((target.kind === 'monthly' || target.kind === 'general') && school) {
      if (!references?.eligibility) {
        notes.push('يلزم ضبط قواعد أهلية المدارس قبل استيراد الخطط.');
      } else {
        const sourceBuildingType = String(row.values.buildingType ?? '').trim();
        const storedEligible = eligibleSchoolIds(
          [{ id: school.id, sourceFields: school.source_fields }],
          target.planType,
          references.eligibility,
        ).length > 0;
        const importedEligible = !sourceBuildingType || eligibleSchoolIds(
          [{
            id: school.id,
            sourceFields: { ...school.source_fields, [references.eligibility.buildingTypeHeader]: sourceBuildingType },
          }],
          target.planType,
          references.eligibility,
        ).length > 0;
        if (!storedEligible || !importedEligible) {
          return { status: 'skipped', notes: ['تصنيف الوحدة غير مؤهل؛ تم استبعاد مشترك ملحق وأي تصنيف آخر.'], school, engineer: null, supervisor: null, engineerName: '', supervisorName: '', employee: null };
        }
      }
    }
    const date = parseImportDate(row.values.plannedDate);
    if ((target.kind === 'monthly' || target.kind === 'general') && !date) {
      return { status: 'skipped', notes: ['لا يوجد تاريخ صالح لهذا النوع من الخطة.'], school, engineer: null, supervisor: null, engineerName: '', supervisorName: '', employee: null };
    }
    if (date && selectedMonth && date.slice(0, 7) !== selectedMonth) {
      return { status: 'skipped', notes: [`التاريخ خارج الشهر المحدد ${selectedMonth}.`], school, engineer: null, supervisor: null, engineerName: '', supervisorName: '', employee: null };
    }
    if (target.kind === 'monthly' && target.planType === 'elevators'
      && normalizeImportName(row.values.assignment) === normalizeImportName('لا ينطبق')) {
      return { status: 'skipped', notes: ['قيمة المصاعد «لا ينطبق»؛ لا يُنشأ صف للخطة.'], school, engineer: null, supervisor: null, engineerName: '', supervisorName: '', employee: null };
    }
    if (!String(row.values.ministry ?? '').trim()) notes.push('الرقم الوزاري مطلوب.');
    if (!school) notes.push(schoolMatches.length > 1 ? 'وجدت عدة مدارس بهذا الرقم؛ اختر المدرسة يدوياً.' : 'لم توجد مدرسة بهذا الرقم؛ اختر المدرسة يدوياً بالاسم.');
    if (duplicateTargetSchool) notes.push('تكررت المدرسة نفسها في الملف؛ اختر المدرسة المقصودة لكل صف ولا تستورد تكرار المفتاح.');
    if ((target.kind === 'monthly' || target.kind === 'general')
      && (!school || duplicateTargetSchool || notes.some((note) => !note.startsWith('تحذير:')))) {
      return { status: 'attention', notes, school, engineer: null, supervisor: null, engineerName: '', supervisorName: '', employee: null };
    }
    if (target.kind === 'monthly') {
      const supervisorField = target.planType === 'maintenance' || target.planType === 'cleaning';
      const engineerResolution = resolvePlanPerson(row.values.engineer, references?.employees ?? [], references?.aliases ?? [], school ? schoolPersonDefault(school, 'engineer', target.planType) : '');
      const supervisorResolution = supervisorField
        ? resolvePlanPerson(row.values.assignment, references?.employees ?? [], references?.aliases ?? [], school ? schoolPersonDefault(school, 'supervisor', target.planType) : '')
        : { employee: null, name: '', source: 'empty' as const };
      const engineer = row.engineerId ? references?.employees.find((item) => item.id === row.engineerId) ?? null : engineerResolution.employee;
      const supervisor = row.supervisorId ? references?.employees.find((item) => item.id === row.supervisorId) ?? null : supervisorResolution.employee;
      if (!engineerResolution.name) notes.push('اسم المهندس فارغ؛ سيُحفظ الصف دون اسم.');
      else if (engineerResolution.source === 'school') notes.push('مأخوذ من قاعدة المباني: اسم المهندس.');
      else if (!engineer) notes.push('اسم نصي (غير مسجل): المهندس.');
      if (supervisorField && !supervisorResolution.name) notes.push('اسم المشرف فارغ؛ سيُحفظ الصف دون اسم.');
      else if (supervisorResolution.source === 'school') notes.push('مأخوذ من قاعدة المباني: اسم المشرف.');
      else if (supervisorField && !supervisor) notes.push('اسم نصي (غير مسجل): المشرف.');
      if (target.planType === 'maintenance') {
        const acDate = parseImportDate(row.values.acDate);
        const maintenanceSupervisor = normalizeImportName(row.values.assignment);
        const acSupervisor = normalizeImportName(row.values.acSupervisor);
        if ((columnMap.acDate !== undefined && acDate !== date)
          || (columnMap.acSupervisor !== undefined && acSupervisor !== maintenanceSupervisor)) {
          notes.push('تحذير: بيانات التكييف تختلف عن الصيانة؛ ستُستورد بيانات الصيانة فقط.');
        }
      }
      return { status: 'ready', notes, school, engineer, supervisor, engineerName: engineerResolution.name, supervisorName: supervisorResolution.name, employee: null };
    }
    if (target.kind === 'general') {
      const engineerResolution = resolvePlanPerson(row.values.engineer, references?.employees ?? [], references?.aliases ?? [], school ? schoolPersonDefault(school, 'engineer', target.planType) : '');
      const supervisorResolution = resolvePlanPerson(row.values.supervisor, references?.employees ?? [], references?.aliases ?? [], school ? schoolPersonDefault(school, 'supervisor', target.planType) : '');
      if (engineerResolution.source === 'school') notes.push('مأخوذ من قاعدة المباني: اسم المهندس.');
      if (supervisorResolution.source === 'school') notes.push('مأخوذ من قاعدة المباني: اسم المشرف.');
      if (engineerResolution.name && !engineerResolution.employee) notes.push('اسم نصي (غير مسجل): المهندس.');
      if (supervisorResolution.name && !supervisorResolution.employee) notes.push('اسم نصي (غير مسجل): المشرف.');
      return { status: notes.some((note) => !note.startsWith('تحذير:') && !note.startsWith('مأخوذ') && !note.startsWith('اسم نصي')) ? 'attention' : 'ready', notes, school, engineer: engineerResolution.employee, supervisor: supervisorResolution.employee, engineerName: engineerResolution.name, supervisorName: supervisorResolution.name, employee: null };
    }

    if (!String(row.values.fullName ?? '').trim()) notes.push('اسم العامل مطلوب.');
    let phone = '';
    if (target.kind === 'gatekeepers' && String(row.values.phone ?? '').trim()) {
      const normalized = normalizePhone(row.phone ?? row.values.phone);
      if (normalized.valid) phone = normalized.phone!;
      else notes.push('تحذير: رقم الجوال غير صالح؛ لن يُحفظ، ويمكنك تصحيحه في المعاينة.');
    }
    if (target.kind === 'gatekeepers' && phone) {
      const repeated = rows.some((item, rowIndex) => rowIndex !== index && normalizePhone(item.phone ?? item.values.phone).phone === phone);
      if (repeated) notes.push('تحذير: رقم الجوال مكرر في الملف.');
      if (references?.employees.some((employee) => employee.phone && normalizePhone(employee.phone).phone === phone)) notes.push('تحذير: رقم الجوال مستخدم لدى موظف آخر.');
      if (references?.existingGatekeeperPhones.some((existing) => normalizePhone(existing).phone === phone)) notes.push('تحذير: رقم الجوال مكرر في سجلات البوابين الحالية.');
    }
    if (target.kind === 'cleaners') {
      const employeeNo = String(row.values.employeeNo ?? '').trim();
      const byNo = employeeNo ? references?.employees.filter((employee) => employee.employee_no === employeeNo && employee.category === 'cleaner') ?? [] : [];
      if (byNo.length > 1) notes.push('الرقم الوظيفي يطابق أكثر من عامل؛ راجع السجل.');
      return { status: notes.some((note) => !note.startsWith('تحذير:')) ? 'attention' : 'ready', notes, school, engineer: null, supervisor: null, engineerName: '', supervisorName: '', employee: null };
    }
    const employeeNo = String(row.values.employeeNo ?? '').trim();
    const employeeNumberMatches = employeeNo
      ? references?.employees.filter((employee) => employee.employee_no === employeeNo && employee.job_title === 'حارس مدرسة') ?? []
      : [];
    const employeeMatches = employeeNumberMatches.length
      ? employeeNumberMatches
      : matchEmployee(row.values.fullName).filter((employee) => employee.job_title === 'حارس مدرسة');
    const employee = row.employeeId
      ? references?.employees.find((item) => item.id === row.employeeId && item.job_title === 'حارس مدرسة') ?? null
      : employeeMatches.length === 1 ? employeeMatches[0] : null;
    if (employeeMatches.length > 1 && !employee) notes.push('الرقم الوظيفي أو الاسم يطابق أكثر من موظف؛ اختر الموظف يدوياً.');
    if (!employee) notes.push('اختر البواب يدوياً من الموظفين ذوي المسمى «حارس مدرسة».');
    if (employee && employeeNo && employee.employee_no !== employeeNo) {
      notes.push('تحذير: الرقم الوظيفي المستورد لا يطابق سجل الموظف المختار؛ سيُحفظ الرقم كما ورد في بيانات البواب.');
    }
    return { status: notes.some((note) => !note.startsWith('تحذير:')) ? 'attention' : 'ready', notes, school, engineer: null, supervisor: null, engineerName: '', supervisorName: '', employee };
  }

  async function writeImport() {
    if (!supabase || !profile || !roleCanImport(profile) || !references) throw new Error('لا تملك صلاحية الاستيراد.');
    const evaluated = rows.map((row, index) => ({ row, state: rowState(row, index) }));
    const reports: ReportRow[] = [];
    const writable = evaluated.filter(({ state }) =>
      state.status !== 'skipped' && state.status !== 'attention' && state.school !== null,
    );
    for (const { row, state } of evaluated.filter(({ state }) =>
      state.status === 'skipped' || state.status === 'attention' || state.school === null,
    )) {
      reports.push({
        line: row.line,
        ministryNumber: String(row.values.ministry ?? ''),
        status: state.status === 'skipped' ? 'skipped' : 'needs_attention',
        note: state.notes.join(' ') || 'لم يتم العثور على مدرسة مطابقة؛ اختر المدرسة يدوياً.',
      });
    }
    if (!writable.length) {
      setReport(reports.sort((left, right) => left.line - right.line));
      setStep('report');
      return;
    }

    if (target.kind === 'monthly') {
      if (!selectedMonth) throw new Error('لا يمكن تحديد شهر الخطة من التواريخ.');
      const month = `${selectedMonth}-01`;
      const { data: plan, error: planError } = await supabase.from('monthly_plans')
        .upsert({ plan_type: target.planType, month }, { onConflict: 'plan_type,month' })
        .select(APP_SCHEMA_SELECT.id).single();
      if (planError) throw planError;
      const old = await supabase.from('monthly_plan_rows').select(APP_SCHEMA_SELECT.monthlyPlanSchoolIds).eq('plan_id', plan.id);
      if (old.error) throw old.error;
      const existing = new Set(old.data.map((item) => item.school_id));
      for (let offset = 0; offset < writable.length; offset += 100) {
        const batch = writable.slice(offset, offset + 100);
        const payload = batch.map(({ row, state }) => ({
          plan_id: plan.id,
          school_id: state.school!.id,
          planned_date: parseImportDate(row.values.plannedDate),
          engineer_id: state.engineer?.id ?? null,
          engineer_name: state.engineerName || null,
          supervisor_id: state.supervisor?.id ?? null,
          supervisor_name: state.supervisorName || null,
          contractor_name: target.planType === 'security_safety' || target.planType === 'elevators'
            ? String(row.values.assignment ?? '').trim() || null
            : null,
        }));
        const { error } = await supabase.from('monthly_plan_rows').upsert(payload, { onConflict: 'plan_id,school_id' });
        if (error) {
          batch.forEach(({ row }) => reports.push({ line: row.line, ministryNumber: String(row.values.ministry), status: 'needs_attention', note: error.message }));
        } else {
          batch.forEach(({ row, state }) => reports.push({
            line: row.line, ministryNumber: String(row.values.ministry),
            status: existing.has(state.school!.id) ? 'updated' : 'created',
            note: state.notes.filter((note) => note.startsWith('تحذير:')).join(' '),
          }));
        }
      }
    } else if (target.kind === 'general') {
      const sourceType = target.planType === 'sewage_waste' ? 'sewage_removal' : target.planType;
      const targetYear = selectedMonth ? Number(selectedMonth.slice(0, 4)) : Number(String(parseImportDate(rows.find((row) => row.values.plannedDate)?.values.plannedDate) ?? '').slice(0, 4));
      const { data: plan, error: planError } = await supabase.from('general_plans')
        .upsert({ plan_type: sourceType, year: targetYear }, { onConflict: 'plan_type,year' })
        .select(APP_SCHEMA_SELECT.id).single();
      if (planError) throw planError;
      for (let offset = 0; offset < writable.length; offset += 100) {
        const batch = writable.slice(offset, offset + 100);
        const payload = batch.map(({ row, state }) => ({
          source_line: row.line,
          school_id: state.school!.id,
          planned_date: parseImportDate(row.values.plannedDate),
          ...(row.values.notes ? { notes: String(row.values.notes) } : {}),
          supervisor_id: state.supervisor?.id ?? null,
          supervisor_name: state.supervisorName || null,
          engineer_name: state.engineerName || null,
        }));
        const result = await supabase.rpc('import_general_plan_rows', { p_plan_id: plan.id, p_rows: payload });
        if (result.error) {
          batch.forEach(({ row }) => reports.push({
            line: row.line,
            ministryNumber: String(row.values.ministry),
            status: 'needs_attention',
            note: result.error.message,
          }));
          continue;
        }
        for (const { state } of batch) {
          const { error: peopleError } = await supabase.from('general_plan_rows').update({
            supervisor_id: state.supervisor?.id ?? null,
            supervisor_name: state.supervisorName || null,
            engineer_name: state.engineerName || null,
          }).eq('plan_id', plan.id).eq('school_id', state.school!.id);
          if (peopleError) throw peopleError;
        }
        const operations = z.array(z.object({ source_line: z.number().int(), operation: z.enum(['created', 'updated']) })).parse(result.data);
        const operationByLine = new Map(operations.map((item) => [item.source_line, item.operation]));
        batch.forEach(({ row, state }) => {
          const operation = operationByLine.get(row.line);
          reports.push({
            line: row.line,
            ministryNumber: String(row.values.ministry),
            status: operation === 'created' || operation === 'updated' ? operation : 'needs_attention',
            note: operation ? state.notes.filter((note) => note.startsWith('تحذير:')).join(' ') : 'لم يرجع تقرير بحالة الصف.',
          });
        });
      }
    } else if (target.kind === 'cleaners') {
      for (let offset = 0; offset < writable.length; offset += 50) {
        const batch = writable.slice(offset, offset + 50);
        for (const { row, state } of batch) {
          const labourSource = normalizeImportName(row.values.labourSource).includes('اجير') ? 'ajeer' : 'org_structure';
          const result = await supabase.rpc('resolve_import_cleaner', {
            p_school_id: state.school!.id,
            p_full_name: String(row.values.fullName).trim(),
            p_employee_no: String(row.values.employeeNo ?? '').trim() || null,
            p_residence_no: String(row.values.residence ?? '').trim() || null,
            p_labour_source: labourSource,
          });
          if (result.error) {
            reports.push({ line: row.line, ministryNumber: String(row.values.ministry), status: 'needs_attention', note: result.error.message });
            continue;
          }
          const resultRow = z.array(z.object({
            id: z.string().uuid(),
            full_name: z.string(),
            employee_no: z.string().nullable(),
            operation: z.enum(['created', 'updated']),
          })).min(1).parse(result.data)[0];
          reports.push({
            line: row.line,
            ministryNumber: String(row.values.ministry),
            status: resultRow.operation,
            note: state.notes.filter((note) => note.startsWith('تحذير:')).join(' '),
          });
        }
      }
    } else {
      for (let offset = 0; offset < writable.length; offset += 100) {
        const batch = writable.slice(offset, offset + 100);
        const payload = batch.map(({ row, state }) => ({
          school_id: state.school!.id,
          employee_id: state.employee?.id ?? null,
          full_name: String(row.values.fullName).trim(),
          employee_no: String(row.values.employeeNo ?? '').trim() || null,
          phone: normalizePhone(row.phone ?? row.values.phone).phone,
          residence_no: String(row.values.residence ?? '').trim() || null,
          notes: String(row.values.notes ?? '').trim() || null,
        }));
        const { error } = await supabase.from('gatekeepers').upsert(payload, { onConflict: 'school_id' });
        batch.forEach(({ row, state }) => reports.push({
          line: row.line,
          ministryNumber: String(row.values.ministry),
          status: error ? 'needs_attention' : references.gatekeeperSchoolIds.has(state.school!.id) ? 'updated' : 'created',
          note: error?.message ?? state.notes.filter((note) => note.startsWith('تحذير:')).join(' '),
        }));
      }
    }

    const aliasCandidates: Array<{ alias_normalised: string; employee_id: string; line: number }> = [];
    if (target.kind === 'monthly') {
      for (const { row, state } of writable) {
        if (!reports.some((item) => item.line === row.line && (item.status === 'created' || item.status === 'updated'))) continue;
        if (state.engineer && rememberAliases[`${row.line}:engineer`]) {
          aliasCandidates.push({ alias_normalised: normalizeImportName(row.values.engineer), employee_id: state.engineer.id, line: row.line });
        }
        if ((target.planType === 'maintenance' || target.planType === 'cleaning')
          && state.supervisor && rememberAliases[`${row.line}:supervisor`]) {
          aliasCandidates.push({ alias_normalised: normalizeImportName(row.values.assignment), employee_id: state.supervisor.id, line: row.line });
        }
      }
    }
    const aliasRows = new Map<string, { alias_normalised: string; employee_id: string; lines: number[] }>();
    const conflictingAliases = new Set<string>();
    for (const candidate of aliasCandidates) {
      if (!candidate.alias_normalised) continue;
      if (conflictingAliases.has(candidate.alias_normalised)) {
        const reportRow = reports.find((item) => item.line === candidate.line);
        if (reportRow) reportRow.note = `${reportRow.note} الاسم البديل يطابق موظفين مختلفين؛ لم يُحفظ الربط.`.trim();
        continue;
      }
      const current = aliasRows.get(candidate.alias_normalised);
      if (current && current.employee_id !== candidate.employee_id) {
        conflictingAliases.add(candidate.alias_normalised);
        for (const line of [...current.lines, candidate.line]) {
          const reportRow = reports.find((item) => item.line === line);
          if (reportRow) reportRow.note = `${reportRow.note} الاسم البديل يطابق موظفين مختلفين؛ لم يُحفظ الربط.`.trim();
        }
        aliasRows.delete(candidate.alias_normalised);
      } else if (current) current.lines.push(candidate.line);
      else aliasRows.set(candidate.alias_normalised, {
        alias_normalised: candidate.alias_normalised,
        employee_id: candidate.employee_id,
        lines: [candidate.line],
      });
    }
    const aliases = [...aliasRows.values()];
    for (let offset = 0; offset < aliases.length; offset += 100) {
      const batch = aliases.slice(offset, offset + 100);
      const { error } = await supabase.from('supervisor_aliases').upsert(
        batch.map(({ alias_normalised, employee_id }) => ({ alias_normalised, employee_id })),
        { onConflict: 'alias_normalised' },
      );
      if (error) {
        for (const item of batch) for (const line of item.lines) {
          const reportRow = reports.find((row) => row.line === line);
          if (reportRow) reportRow.note = `${reportRow.note} تعذر حفظ الاسم البديل: ${error.message}`.trim();
        }
      }
    }
    setReport(reports.sort((left, right) => left.line - right.line));
    setStep('report');
  }

  async function confirmImport() {
    setBusy(true);
    setMessage('');
    try {
      await writeImport();
    } catch (error) {
      setMessage(`تعذر إكمال الاستيراد: ${error instanceof Error ? error.message : 'خطأ غير معروف'}`);
    } finally {
      setBusy(false);
    }
  }

  function downloadReport() {
    const counts = reportStatus(report);
    downloadWorkbook('تقرير-الاستيراد.xlsx', [
      ['الصف', 'الرقم الوزاري', 'الحالة', 'التفاصيل'],
      ...report.map(({ line, ministryNumber, status, note }) => [line, ministryNumber, ({
        created: 'تم الإنشاء',
        updated: 'تم التحديث',
        skipped: 'تم التجاوز',
        needs_attention: 'تحتاج مراجعة',
      }[status]), note]),
      [],
      ['تم الإنشاء', counts.created, 'تم التحديث', counts.updated, 'تم التجاوز', counts.skipped, 'تحتاج مراجعة', counts.needsAttention],
    ]);
  }

  return (
    <div className="fixed inset-0 z-[1000] overflow-y-auto bg-slate-950/50 p-3 sm:p-8" role="dialog" aria-modal="true" aria-label="استيراد Excel">
      <section className="mx-auto grid max-h-[92vh] max-w-6xl grid-rows-[auto_1fr_auto] overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 p-4 sm:p-6">
          <div><h2 className="text-xl font-bold text-brand-900">استيراد البيانات</h2><p className="mt-1 text-sm text-slate-500">{targetLabel(target)}</p></div>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="rounded-lg p-2 hover:bg-slate-100"><X size={20} /></button>
        </header>
        <div className="overflow-auto p-4 sm:p-6">
          {step === 'upload' && (
            <div className="grid justify-items-center gap-5 py-10 text-center">
              <FileSpreadsheet size={42} className="text-brand-700" />
              <p className="max-w-xl text-sm leading-7 text-slate-600">ارفع ملف .xlsx بحجم لا يتجاوز 5 ميغابايت. ستراجع البيانات قبل أي كتابة إلى قاعدة البيانات.</p>
              <label className="cursor-pointer rounded-lg bg-brand-700 px-5 py-3 font-bold text-white">
                <Upload size={17} className="me-2 inline" />اختيار الملف
                <input id="import-file-input" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void handleFile(event.target.files?.[0])} className="sr-only" />
              </label>
              <button type="button" onClick={() => downloadWorkbook('قالب-الاستيراد.xlsx', [templateHeaders(target)])} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm"><Download size={16} />تنزيل قالب Excel</button>
              {message && <p role="alert" className="text-sm text-rose-700">{message}</p>}
            </div>
          )}
          {step === 'map' && (
            <div className="grid gap-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <p className="self-center text-sm text-slate-600">الملف: {fileName}</p>
                <label className="grid gap-1 text-sm font-semibold">ورقة العمل
                  <select value={sheetName} onChange={(event) => void selectSheet(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2">
                    {sheets.map((sheet) => <option key={sheet}>{sheet}</option>)}
                  </select>
                </label>
              </div>
              <p className="text-sm text-slate-600">طابق كل حقل مع عموده. جرى اكتشاف العناوين العربية المتطابقة تلقائياً، ويمكن تعديل أي ربط يدوياً.</p>
              {referenceError && <div role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">تعذر تحميل بيانات المطابقة: {referenceError}<button type="button" onClick={() => void loadReferences().then((value) => { setReferences(value); setReferenceError(''); }).catch((error: Error) => setReferenceError(error.message))} className="ms-3 underline">إعادة المحاولة</button></div>}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {fields.map((field) => (
                  <label key={field.key} className="grid gap-1 text-sm font-semibold">
                    {field.label}{field.required && <span className="text-rose-700"> (مطلوب)</span>}
                    <select value={columnMap[field.key] ?? ''} onChange={(event) => setColumnMap((current) => {
                      if (event.target.value === '') {
                        const next = { ...current };
                        delete next[field.key];
                        return next;
                      }
                      return { ...current, [field.key]: Number(event.target.value) };
                    })} className="rounded-lg border border-slate-300 px-3 py-2 font-normal">
                      <option value="">غير مربوط</option>
                      {headers.map((header, index) => <option key={index} value={index}>{header || `عمود ${index + 1}`} {headers.slice(0, index).includes(header) ? `(${headers.slice(0, index + 1).filter((item) => item === header).length})` : ''}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              {message && <p role="alert" className="text-sm text-rose-700">{message}</p>}
            </div>
          )}
          {step === 'preview' && (
            <div className="grid gap-4">
              {referenceError && <p role="alert" className="text-rose-700">{referenceError}</p>}
              {months.length > 0 && (
                <label className="grid max-w-sm gap-1 text-sm font-semibold">الشهر المكتشف: {selectedMonth ? new Intl.DateTimeFormat('ar-SA', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${selectedMonth}-01T00:00:00Z`)) : 'غير محدد'}
                  <select value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2">
                    {months.map((month) => <option key={month} value={month}>{month}</option>)}
                  </select>
                </label>
              )}
              {invalidDateCount > 0 && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">تحذير: تعذر تفسير {invalidDateCount} تاريخاً. استخدم يوم-شهر-سنة أو سنة-شهر-يوم؛ لن يتم التخمين.</p>}
              {outsideMonthCount > 0 && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">تحذير: {outsideMonthCount} تاريخاً خارج الشهر المحدد وسيتم استبعادها من الاستيراد.</p>}
              {referenceError && <button type="button" onClick={() => void loadReferences().then((value) => { setReferences(value); setReferenceError(''); }).catch((error: Error) => setReferenceError(error.message))} className="justify-self-start rounded border px-3 py-2 text-sm">إعادة تحميل بيانات المطابقة</button>}
              <div className="max-h-[55vh] overflow-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-start text-xs">
                  <thead className="sticky top-0 bg-slate-50"><tr>
                    <th className="p-2">صف المصدر</th><th className="p-2">الرقم الوزاري</th><th className="p-2">المدرسة / الحالة</th>
                    {fields.filter((field) => !['ministry', 'residence'].includes(field.key)).map((field) => <th key={field.key} className="p-2">{field.label}</th>)}
                    {target.kind === 'cleaners' || target.kind === 'gatekeepers' ? <th className="p-2">رقم الإقامة</th> : null}
                    <th className="p-2">التحقق</th>
                  </tr></thead>
                  <tbody>{rows.map((row, index) => {
                    const state = references ? rowState(row, index) : { status: 'attention' as const, notes: ['جارٍ تحميل بيانات المطابقة.'], school: null, engineer: null, supervisor: null, employee: null };
                    const matches = schoolCandidates(row);
                    return (
                      <tr key={row.line} className="border-t border-slate-100 align-top">
                        <td className="p-2">{row.line}</td>
                        <td className="p-2">{String(row.values.ministry ?? '')}</td>
                        <td className="min-w-52 p-2">
                          <select value={row.schoolId || state.school?.id || ''} onChange={(event) => updateRow(index, { schoolId: event.target.value })} className="w-full rounded border px-2 py-1">
                            <option value="">{matches.length > 1 ? 'اختر المدرسة بسبب التكرار' : matches.length === 0 ? 'اختر المدرسة يدوياً' : 'اختر المدرسة'}</option>
                            {references?.schools.map((school) => <option key={school.id} value={school.id}>{school.name} · {school.ministry_no}</option>)}
                          </select>
                          {state.school && <span className="mt-1 block text-slate-500">{state.school.name}</span>}
                        </td>
                        {fields.filter((field) => !['ministry', 'residence'].includes(field.key)).map((field) => (
                          <td key={field.key} className="min-w-32 p-2">
                            {field.key === 'engineer' || (field.key === 'assignment' && target.kind === 'monthly' && (target.planType === 'maintenance' || target.planType === 'cleaning')) ? (
                              <div className="grid gap-1">
                                <span>{String(row.values[field.key] ?? '')}</span>
                                {(() => {
                                  const kind = field.key === 'engineer' ? 'engineer' : 'supervisor';
                                  const selected = field.key === 'engineer' ? row.engineerId || state.engineer?.id || '' : row.supervisorId || state.supervisor?.id || '';
                                  const expectedCategory = field.key === 'engineer' ? 'engineer' : 'supervisor';
                                  const candidates = references?.employees.filter((employee) => employee.category === expectedCategory) ?? [];
                                  return (
                                    <>
                                      <select value={selected} onChange={(event) => updateRow(index, field.key === 'engineer' ? { engineerId: event.target.value } : { supervisorId: event.target.value })} className="rounded border px-2 py-1">
                                        <option value="">تعيين يدوي إذا لزم</option>
                                        {candidates.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name}</option>)}
                                      </select>
                                      {selected && String(row.values[field.key] ?? '').trim() && (
                                        <label className="flex items-center gap-1"><input type="checkbox" checked={Boolean(rememberAliases[`${row.line}:${kind}`])} onChange={(event) => setRememberAliases((current) => ({ ...current, [`${row.line}:${kind}`]: event.target.checked }))} />تذكر الاسم البديل</label>
                                      )}
                                    </>
                                  );
                                })()}
                              </div>
                            ) : field.key === 'fullName' && target.kind === 'gatekeepers' ? (
                              <div className="grid gap-1">
                                <span>{String(row.values.fullName ?? '')}</span>
                                <select value={row.employeeId || state.employee?.id || ''} onChange={(event) => updateRow(index, { employeeId: event.target.value })} className="rounded border px-2 py-1">
                                  <option value="">ربط بموظف عند التطابق</option>
                                  {references?.employees.filter((employee) => employee.job_title === 'حارس مدرسة').map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name} · {employee.employee_no ?? 'دون رقم وظيفي'}</option>)}
                                </select>
                              </div>
                            ) : field.key === 'phone' ? (
                              <input
                                value={row.phone ?? normalizePhone(row.values.phone).phone ?? String(row.values.phone ?? '')}
                                onChange={(event) => updateRow(index, { phone: event.target.value })}
                                className="w-36 rounded border px-2 py-1"
                                aria-label="رقم جوال البواب"
                              />
                            ) : String(row.values[field.key] ?? '')}
                          </td>
                        ))}
                        {(target.kind === 'cleaners' || target.kind === 'gatekeepers') && <td className="p-2 font-mono">{maskResidence(row.values.residence)}</td>}
                        <td className="min-w-60 p-2">
                          <span className={`font-bold ${state.status === 'ready' ? 'text-emerald-700' : state.status === 'skipped' ? 'text-slate-500' : 'text-amber-800'}`}>
                            {state.status === 'ready' ? 'جاهز' : state.status === 'skipped' ? 'سيُتجاوز' : 'يحتاج مراجعة'}
                          </span>
                          {state.notes.map((note, noteIndex) => <p key={noteIndex} className="mt-1">{note}</p>)}
                        </td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
              <p className="text-xs leading-6 text-slate-500">المعاينة لا تكتب أي بيانات. ستُستورد الصفوف الجاهزة فقط بعد التأكيد؛ تُسجل الصفوف غير المحسومة في التقرير.</p>
            </div>
          )}
          {step === 'report' && (
            <div className="grid gap-5">
              {(() => {
                const counts = reportStatus(report);
                return <div className="grid gap-3 sm:grid-cols-4">
                  <Summary label="تم الإنشاء" value={counts.created} />
                  <Summary label="تم التحديث" value={counts.updated} />
                  <Summary label="تم التجاوز" value={counts.skipped} />
                  <Summary label="تحتاج مراجعة" value={counts.needsAttention} />
                </div>;
              })()}
              <div className="max-h-[55vh] overflow-auto rounded-lg border">
                <table className="min-w-full text-start text-sm">
                  <thead className="sticky top-0 bg-slate-50"><tr><th className="p-2">الصف</th><th className="p-2">الرقم الوزاري</th><th className="p-2">الحالة</th><th className="p-2">التفاصيل</th></tr></thead>
                  <tbody>{report.map((row) => <tr key={row.line} className="border-t"><td className="p-2">{row.line}</td><td className="p-2">{row.ministryNumber}</td><td className="p-2">{{ created: 'تم الإنشاء', updated: 'تم التحديث', skipped: 'تم التجاوز', needs_attention: 'تحتاج مراجعة' }[row.status]}</td><td className="p-2">{row.note || '—'}</td></tr>)}</tbody>
                </table>
              </div>
              <button type="button" onClick={downloadReport} className="inline-flex w-fit items-center gap-2 rounded-lg border px-4 py-2"><Download size={16} />تنزيل التقرير Excel</button>
            </div>
          )}
        </div>
        <footer className="flex flex-wrap justify-between gap-3 border-t border-slate-200 p-4 sm:px-6">
          <div className="flex gap-2">
            {step === 'map' && <button type="button" onClick={() => setStep('upload')} className="rounded-lg border px-4 py-2 text-sm">السابق</button>}
            {step === 'preview' && <button type="button" onClick={() => setStep('map')} className="rounded-lg border px-4 py-2 text-sm">تعديل ربط الأعمدة</button>}
          </div>
          <div className="flex gap-2">
            {step === 'map' && <button type="button" onClick={buildPreview} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-bold text-white">معاينة البيانات</button>}
            {step === 'preview' && <button type="button" disabled={busy || !references} onClick={() => void confirmImport()} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? 'جارٍ الاستيراد…' : 'تأكيد وبدء الاستيراد'}</button>}
            {step === 'report' && <button type="button" onClick={onClose} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-bold text-white">إنهاء</button>}
          </div>
          {message && <p role="alert" className="w-full text-sm text-rose-700">{message}</p>}
        </footer>
      </section>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return <article className="rounded-lg bg-slate-50 p-4"><p className="text-sm text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold text-brand-900">{value}</p></article>;
}

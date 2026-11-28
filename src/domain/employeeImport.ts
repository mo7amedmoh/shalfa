import { parseImportDate } from './imports';
import { employeeCategorySchema } from './workforce';

export type EmployeeImportRow = {
  full_name: string;
  employee_no: string | null;
  residence_no: string | null;
  job_title: string | null;
  category: string | null;
  department: string | null;
  phone: string | null;
  nationality: string | null;
  hire_date: string | null;
  status: string | null;
  project_name: string | null;
  manager_number: string | null;
  rating: number | string | null;
  review_name: string;
  decision_employee_id?: string;
};

export const employeeImportColumnDefinitions = [
  { key: 'full_name', label: 'الاسم', aliases: ['الاسم', 'اسم الموظف', 'اسم', 'Full Name', 'Name'], required: true },
  { key: 'employee_no', label: 'الرقم الوظيفي', aliases: ['الرقم الوظيفي', 'رقم الموظف', 'Employee No', 'Employee Number'] },
  { key: 'job_title', label: 'الوظيفة', aliases: ['الوظيفة', 'المسمى الوظيفي', 'المهنة', 'المهنه', 'Job Title'] },
  { key: 'category', label: 'الفئة الوظيفية', aliases: ['الفئة الوظيفية', 'فئة الموظف', 'المهنة', 'المهنه', 'Category'] },
  { key: 'department', label: 'القسم', aliases: ['القسم', 'الإدارة', 'الشركة', 'الشركه', 'Department'] },
  { key: 'phone', label: 'رقم الجوال', aliases: ['رقم الجوال', 'رقم التواصل', 'الجوال', 'Phone'] },
  { key: 'residence_no', label: 'رقم الإقامة', aliases: ['رقم الإقامة', 'رقم الاقامة', 'رقم الهوية', 'الهويه', 'Residence No'] },
  { key: 'nationality', label: 'الجنسية', aliases: ['الجنسية', 'Nationality'] },
  { key: 'hire_date', label: 'تاريخ المباشرة', aliases: ['تاريخ المباشرة', 'تاريخ التعيين', 'Hire Date'] },
  { key: 'status', label: 'الحالة', aliases: ['الحالة', 'حالة الموظف', 'Status'] },
  { key: 'review_name', label: 'مراجعة الاسم', aliases: ['مراجعة الاسم', 'Review Name'] },
  { key: 'project_name', label: 'المشروع', aliases: ['المشروع', 'Project'] },
  { key: 'manager_number', label: 'الرقم الوظيفي للمدير', aliases: ['الرقم الوظيفي للمدير', 'Manager Employee No'] },
  { key: 'rating', label: 'التقييم', aliases: ['التقييم', 'Rating'] },
] as const;

export type EmployeeImportColumnKey = (typeof employeeImportColumnDefinitions)[number]['key'];
export type EmployeeImportColumnMap = Partial<Record<EmployeeImportColumnKey, string>>;

function cellText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function importHeader(
  row: Record<string, unknown>,
  field: EmployeeImportColumnKey,
  columnMap?: EmployeeImportColumnMap,
): string {
  const definition = employeeImportColumnDefinitions.find((item) => item.key === field);
  if (!definition) return '';
  if (columnMap) {
    const key = columnMap[field];
    return key ? cellText(row[key]) : '';
  }
  const key = Object.keys(row).find((header) => definition.aliases.some(
    (alias) => header.trim().toLocaleLowerCase() === alias.toLocaleLowerCase(),
  ));
  return key ? cellText(row[key]) : '';
}

export function suggestEmployeeImportColumnMap(headers: string[]): EmployeeImportColumnMap {
  return Object.fromEntries(employeeImportColumnDefinitions.flatMap((definition) => {
    const header = headers.find((item) => definition.aliases.some(
      (alias) => item.trim().toLocaleLowerCase() === alias.toLocaleLowerCase(),
    ));
    return header ? [[definition.key, header]] : [];
  })) as EmployeeImportColumnMap;
}

function categoryFromArabic(value: string): string | null {
  const normalized = value.trim().replace(/تكيف/g, 'تكييف');
  if (employeeCategorySchema.safeParse(normalized).success) return normalized;
  if (/حارس/.test(normalized)) return 'gatekeeper';
  if (/مشرف/.test(normalized)) return 'supervisor';
  if (/كهرب|سباك|مبلط|دهان|نجار|بلاط|مكيف|تكييف|اعمال مدنيه/.test(normalized)) return 'technician';
  if (/مهندس/.test(normalized)) return 'engineer';
  if (/إداري|اداري/.test(normalized)) return 'admin_staff';
  if (/سائق/.test(normalized)) return 'driver';
  if (/عامل نظافة|نظافة|تنظيف/.test(normalized)) return 'cleaner';
  return normalized || null;
}

function statusFromArabic(value: string): string | null {
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized === 'نشط') return 'active';
  if (normalized === 'غير نشط') return 'inactive';
  if (normalized === 'منتهي الخدمة') return 'terminated';
  return normalized;
}

function dateValue(value: string): string | null {
  if (!value) return null;
  return parseImportDate(value) ?? value;
}

export function parseEmployeeImportRows(
  fileRows: Record<string, unknown>[],
  columnMap?: EmployeeImportColumnMap,
): EmployeeImportRow[] {
  return fileRows.map((row) => {
    const rawHireDate = importHeader(row, 'hire_date', columnMap);
    const ratingText = importHeader(row, 'rating', columnMap);
    const rating = ratingText === '' ? null : Number(ratingText);
    return {
      full_name: importHeader(row, 'full_name', columnMap),
      employee_no: importHeader(row, 'employee_no', columnMap) || null,
      residence_no: importHeader(row, 'residence_no', columnMap) || null,
      job_title: importHeader(row, 'job_title', columnMap) || null,
      category: categoryFromArabic(importHeader(row, 'category', columnMap)),
      department: importHeader(row, 'department', columnMap) || null,
      phone: importHeader(row, 'phone', columnMap) || null,
      nationality: importHeader(row, 'nationality', columnMap) || null,
      hire_date: dateValue(rawHireDate),
      status: statusFromArabic(importHeader(row, 'status', columnMap)),
      project_name: importHeader(row, 'project_name', columnMap) || null,
      manager_number: importHeader(row, 'manager_number', columnMap) || null,
      rating: Number.isFinite(rating) ? rating : ratingText || null,
      review_name: importHeader(row, 'review_name', columnMap),
    };
  });
}

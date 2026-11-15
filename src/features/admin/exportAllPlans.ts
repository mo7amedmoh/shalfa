import { z } from 'zod';
import { loadXlsx } from '../../lib/xlsx';
import { supabase } from '../../lib/supabase';

const monthlyPlanSchema = z.object({
  id: z.string().uuid(),
  plan_type: z.string(),
  month: z.string(),
  notes: z.string().nullable(),
  created_at: z.string(),
});
const monthlyPlanRowSchema = z.object({
  id: z.string().uuid(),
  plan_id: z.string().uuid(),
  school_id: z.string().uuid(),
  planned_date: z.string(),
  engineer_name: z.string().nullable(),
  supervisor_name: z.string().nullable(),
  contractor_name: z.string().nullable(),
  visited: z.boolean(),
  visited_date: z.string().nullable(),
  report_done: z.boolean(),
  report_done_date: z.string().nullable(),
  school: z.object({ name: z.string().nullable(), ministry_no: z.string().nullable() }).nullable(),
});
const generalPlanSchema = z.object({
  id: z.string().uuid(),
  plan_type: z.string(),
  year: z.number().int(),
  title: z.string().nullable(),
  created_at: z.string(),
});
const generalPlanRowSchema = z.object({
  id: z.string().uuid(),
  plan_id: z.string().uuid(),
  school_id: z.string().uuid().nullable(),
  planned_date: z.string().nullable(),
  execution_date: z.string().nullable(),
  status: z.string(),
  report_done: z.boolean(),
  report_done_date: z.string().nullable(),
  supervisor_name: z.string().nullable(),
  engineer_name: z.string().nullable(),
  contractor_name: z.string().nullable(),
  notes: z.string().nullable(),
  school: z.object({ name: z.string().nullable(), ministry_no: z.string().nullable() }).nullable(),
});
const customPlanTypeSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  cadence: z.enum(['monthly', 'yearly']),
  scope: z.enum(['all_in_scope', 'manual']),
  track_visit_report: z.boolean(),
  group_key: z.enum(['monthly', 'general']),
  is_active: z.boolean(),
  created_at: z.string(),
});
const customPlanSchema = z.object({
  id: z.string().uuid(),
  type_id: z.string().uuid(),
  period: z.string(),
});
const customPlanRowSchema = z.object({
  id: z.string().uuid(),
  plan_id: z.string().uuid(),
  school_id: z.string().uuid().nullable(),
  planned_date: z.string().nullable(),
  execution_date: z.string().nullable(),
  status: z.string(),
  supervisor_name: z.string().nullable(),
  engineer_name: z.string().nullable(),
  visited: z.boolean().nullable(),
  visited_date: z.string().nullable(),
  report_done: z.boolean().nullable(),
  report_done_date: z.string().nullable(),
  contractor_name: z.string().nullable(),
  notes: z.string().nullable(),
  school: z.object({ name: z.string().nullable(), ministry_no: z.string().nullable() }).nullable(),
});

type ExportCounts = {
  monthlyPlans: number;
  monthlyRows: number;
  generalPlans: number;
  generalRows: number;
  customTypes: number;
  customPlans: number;
  customRows: number;
};

async function fetchAllPages<T>(loadPage: (from: number, to: number) => Promise<T[]>): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const page = await loadPage(from, from + pageSize - 1);
    if (!page.length) return rows;
    rows.push(...page);
    from += page.length;
  }
}

function addSheet<T extends object>(
  XLSX: typeof import('xlsx'),
  workbook: import('xlsx').WorkBook,
  name: string,
  headers: string[],
  records: T[],
) {
  const sheet = records.length
    ? XLSX.utils.json_to_sheet(records, { header: headers })
    : XLSX.utils.aoa_to_sheet([headers]);
  XLSX.utils.book_append_sheet(workbook, sheet, name);
}

const monthlyTypeNames: Record<string, string> = {
  maintenance: 'الصيانة والتكييف',
  cleaning: 'النظافة',
  security_safety: 'الأمن والسلامة',
  elevators: 'المصاعد',
};
const generalTypeNames: Record<string, string> = {
  gardening: 'البستنة',
  landscaping: 'التنسيق',
  sewage_removal: 'نزح مخلفات الصرف الصحي',
  sewage_waste: 'نزح مخلفات الصرف الصحي',
  water_supply: 'توريد المياه',
  tank_washing: 'غسيل الخزانات',
  pest_control: 'مكافحة الآفات ورش المبيدات',
  annual_readiness: 'خطط الاستعداد السنوية',
};
const statusNames: Record<string, string> = {
  planned: 'مخطط',
  in_progress: 'جارٍ',
  done: 'منجز',
  cancelled: 'ملغى',
};

export async function exportAllPlans(): Promise<ExportCounts> {
  if (!supabase) throw new Error('إعداد الاتصال بقاعدة البيانات غير مكتمل.');
  const client = supabase;
  const XLSX = await loadXlsx();

  const [monthlyPlans, generalPlans, customTypes, customPlans] = await Promise.all([
    fetchAllPages(async (from, to) => {
      const { data, error } = await client.from('monthly_plans')
        .select('id,plan_type,month,notes,created_at')
        .order('id')
        .range(from, to);
      if (error) throw error;
      return z.array(monthlyPlanSchema).parse(data);
    }),
    fetchAllPages(async (from, to) => {
      const { data, error } = await client.from('general_plans')
        .select('id,plan_type,year,title,created_at')
        .order('id')
        .range(from, to);
      if (error) throw error;
      return z.array(generalPlanSchema).parse(data);
    }),
    fetchAllPages(async (from, to) => {
      const { data, error } = await client.from('custom_plan_types')
        .select('id,name,cadence,scope,track_visit_report,group_key,is_active,created_at')
        .order('id')
        .range(from, to);
      if (error) throw error;
      return z.array(customPlanTypeSchema).parse(data);
    }),
    fetchAllPages(async (from, to) => {
      const { data, error } = await client.from('custom_plans')
        .select('id,type_id,period')
        .order('id')
        .range(from, to);
      if (error) throw error;
      return z.array(customPlanSchema).parse(data);
    }),
  ]);

  const [monthlyRows, generalRows, customRows] = await Promise.all([
    fetchAllPages(async (from, to) => {
      const { data, error } = await client.from('monthly_plan_rows')
        .select('id,plan_id,school_id,planned_date,engineer_name,supervisor_name,contractor_name,visited,visited_date,report_done,report_done_date,school:schools(name,ministry_no)')
        .order('id')
        .range(from, to);
      if (error) throw error;
      return z.array(monthlyPlanRowSchema).parse(data);
    }),
    fetchAllPages(async (from, to) => {
      const { data, error } = await client.from('general_plan_rows')
        .select('id,plan_id,school_id,planned_date,execution_date,status,report_done,report_done_date,supervisor_name,engineer_name,contractor_name,notes,school:schools(name,ministry_no)')
        .order('id')
        .range(from, to);
      if (error) throw error;
      return z.array(generalPlanRowSchema).parse(data);
    }),
    fetchAllPages(async (from, to) => {
      const { data, error } = await client.from('custom_plan_rows')
        .select('id,plan_id,school_id,planned_date,execution_date,status,supervisor_name,engineer_name,visited,visited_date,report_done,report_done_date,contractor_name,notes,school:schools(name,ministry_no)')
        .order('id')
        .range(from, to);
      if (error) throw error;
      return z.array(customPlanRowSchema).parse(data);
    }),
  ]);

  const monthlyPlanById = new Map(monthlyPlans.map((plan) => [plan.id, plan]));
  const generalPlanById = new Map(generalPlans.map((plan) => [plan.id, plan]));
  const customPlanById = new Map(customPlans.map((plan) => [plan.id, plan]));
  const customTypeById = new Map(customTypes.map((type) => [type.id, type]));
  const workbook = XLSX.utils.book_new();

  addSheet(XLSX, workbook, 'الخطط الشهرية',
    ['معرف الخطة', 'الخدمة', 'الشهر', 'ملاحظات', 'تاريخ الإنشاء'],
    monthlyPlans.map((plan) => ({
      'معرف الخطة': plan.id,
      'الخدمة': monthlyTypeNames[plan.plan_type] ?? plan.plan_type,
      'الشهر': plan.month,
      'ملاحظات': plan.notes ?? '',
      'تاريخ الإنشاء': plan.created_at,
    })),
  );
  addSheet(XLSX, workbook, 'تفاصيل الشهرية',
    ['معرف السجل', 'معرف الخطة', 'الخدمة', 'الشهر', 'معرف المدرسة', 'المدرسة', 'الرقم الوزاري', 'التاريخ المخطط', 'المشرف', 'المهندس', 'المقاول', 'تمت الزيارة', 'تاريخ الزيارة', 'تم التقرير', 'تاريخ التقرير'],
    monthlyRows.map((row) => {
      const plan = monthlyPlanById.get(row.plan_id);
      return {
        'معرف السجل': row.id,
        'معرف الخطة': row.plan_id,
        'الخدمة': plan ? monthlyTypeNames[plan.plan_type] ?? plan.plan_type : '',
        'الشهر': plan?.month ?? '',
        'معرف المدرسة': row.school_id,
        'المدرسة': row.school?.name ?? '',
        'الرقم الوزاري': row.school?.ministry_no ?? '',
        'التاريخ المخطط': row.planned_date,
        'المشرف': row.supervisor_name ?? '',
        'المهندس': row.engineer_name ?? '',
        'المقاول': row.contractor_name ?? '',
        'تمت الزيارة': row.visited ? 'نعم' : 'لا',
        'تاريخ الزيارة': row.visited_date ?? '',
        'تم التقرير': row.report_done ? 'نعم' : 'لا',
        'تاريخ التقرير': row.report_done_date ?? '',
      };
    }),
  );
  addSheet(XLSX, workbook, 'الخطط العامة',
    ['معرف الخطة', 'نوع الخطة', 'السنة', 'العنوان', 'تاريخ الإنشاء'],
    generalPlans.map((plan) => ({
      'معرف الخطة': plan.id,
      'نوع الخطة': generalTypeNames[plan.plan_type] ?? plan.plan_type,
      'السنة': plan.year,
      'العنوان': plan.title ?? '',
      'تاريخ الإنشاء': plan.created_at,
    })),
  );
  addSheet(XLSX, workbook, 'تفاصيل العامة',
    ['معرف السجل', 'معرف الخطة', 'نوع الخطة', 'السنة', 'معرف المدرسة', 'المدرسة', 'الرقم الوزاري', 'التاريخ المخطط', 'تاريخ التنفيذ', 'الحالة', 'تم التقرير', 'تاريخ التقرير', 'المشرف', 'المهندس', 'المقاول', 'الملاحظات'],
    generalRows.map((row) => {
      const plan = generalPlanById.get(row.plan_id);
      return {
        'معرف السجل': row.id,
        'معرف الخطة': row.plan_id,
        'نوع الخطة': plan ? generalTypeNames[plan.plan_type] ?? plan.plan_type : '',
        'السنة': plan?.year ?? '',
        'معرف المدرسة': row.school_id ?? '',
        'المدرسة': row.school?.name ?? '',
        'الرقم الوزاري': row.school?.ministry_no ?? '',
        'التاريخ المخطط': row.planned_date ?? '',
        'تاريخ التنفيذ': row.execution_date ?? '',
        'الحالة': statusNames[row.status] ?? row.status,
        'تم التقرير': row.report_done ? 'نعم' : 'لا',
        'تاريخ التقرير': row.report_done_date ?? '',
        'المشرف': row.supervisor_name ?? '',
        'المهندس': row.engineer_name ?? '',
        'المقاول': row.contractor_name ?? '',
        'الملاحظات': row.notes ?? '',
      };
    }),
  );
  addSheet(XLSX, workbook, 'أنواع المخصصة',
    ['معرف النوع', 'اسم الخطة', 'الفئة', 'التكرار', 'نطاق المدارس', 'تتبع الزيارة والتقرير', 'نشطة', 'تاريخ الإنشاء'],
    customTypes.map((type) => ({
      'معرف النوع': type.id,
      'اسم الخطة': type.name,
      'الفئة': type.group_key === 'monthly' ? 'شهرية' : 'عامة',
      'التكرار': type.cadence === 'monthly' ? 'شهري' : 'سنوي',
      'نطاق المدارس': type.scope === 'all_in_scope' ? 'كل المدارس ضمن النطاق' : 'يدوي',
      'تتبع الزيارة والتقرير': type.track_visit_report ? 'نعم' : 'لا',
      'نشطة': type.is_active ? 'نعم' : 'لا',
      'تاريخ الإنشاء': type.created_at,
    })),
  );
  addSheet(XLSX, workbook, 'فترات المخصصة',
    ['معرف الفترة', 'معرف النوع', 'اسم الخطة', 'الفئة', 'الفترة'],
    customPlans.map((plan) => {
      const type = customTypeById.get(plan.type_id);
      return {
        'معرف الفترة': plan.id,
        'معرف النوع': plan.type_id,
        'اسم الخطة': type?.name ?? '',
        'الفئة': type?.group_key === 'monthly' ? 'شهرية' : type ? 'عامة' : '',
        'الفترة': plan.period,
      };
    }),
  );
  addSheet(XLSX, workbook, 'تفاصيل المخصصة',
    ['معرف السجل', 'معرف الفترة', 'اسم الخطة', 'الفترة', 'معرف المدرسة', 'المدرسة', 'الرقم الوزاري', 'التاريخ المخطط', 'تاريخ التنفيذ', 'الحالة', 'المشرف', 'المهندس', 'تمت الزيارة', 'تاريخ الزيارة', 'تم التقرير', 'تاريخ التقرير', 'المقاول', 'الملاحظات'],
    customRows.map((row) => {
      const plan = customPlanById.get(row.plan_id);
      const type = plan ? customTypeById.get(plan.type_id) : undefined;
      return {
        'معرف السجل': row.id,
        'معرف الفترة': row.plan_id,
        'اسم الخطة': type?.name ?? '',
        'الفترة': plan?.period ?? '',
        'معرف المدرسة': row.school_id ?? '',
        'المدرسة': row.school?.name ?? '',
        'الرقم الوزاري': row.school?.ministry_no ?? '',
        'التاريخ المخطط': row.planned_date ?? '',
        'تاريخ التنفيذ': row.execution_date ?? '',
        'الحالة': statusNames[row.status] ?? row.status,
        'المشرف': row.supervisor_name ?? '',
        'المهندس': row.engineer_name ?? '',
        'تمت الزيارة': row.visited === null ? '' : row.visited ? 'نعم' : 'لا',
        'تاريخ الزيارة': row.visited_date ?? '',
        'تم التقرير': row.report_done === null ? '' : row.report_done ? 'نعم' : 'لا',
        'تاريخ التقرير': row.report_done_date ?? '',
        'المقاول': row.contractor_name ?? '',
        'الملاحظات': row.notes ?? '',
      };
    }),
  );

  XLSX.writeFile(workbook, `كل-الخطط-${new Date().toISOString().slice(0, 10)}.xlsx`);
  return {
    monthlyPlans: monthlyPlans.length,
    monthlyRows: monthlyRows.length,
    generalPlans: generalPlans.length,
    generalRows: generalRows.length,
    customTypes: customTypes.length,
    customPlans: customPlans.length,
    customRows: customRows.length,
  };
}

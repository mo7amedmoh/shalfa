import { z } from 'zod';
import { supabase } from '../../lib/supabase';
import {
  buildPlanSummary,
  matchCustomPlanCategory,
  type PlanSummaryCategory,
  type PlanSummaryRecord,
} from './planExportSummary';

const monthlyPlanSchema = z.object({
  id: z.string().uuid(),
  plan_type: z.string(),
  month: z.string(),
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
  report_done: z.boolean(),
  school: z.object({ name: z.string().nullable(), ministry_no: z.string().nullable() }).nullable(),
});
const generalPlanSchema = z.object({
  id: z.string().uuid(),
  plan_type: z.string(),
  year: z.number().int(),
});
const generalPlanRowSchema = z.object({
  id: z.string().uuid(),
  plan_id: z.string().uuid(),
  school_id: z.string().uuid().nullable(),
  planned_date: z.string().nullable(),
  execution_date: z.string().nullable(),
  status: z.string(),
  report_done: z.boolean(),
  supervisor_name: z.string().nullable(),
  engineer_name: z.string().nullable(),
  contractor_name: z.string().nullable(),
  school: z.object({ name: z.string().nullable(), ministry_no: z.string().nullable() }).nullable(),
});
const customPlanTypeSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  group_key: z.enum(['monthly', 'general']),
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
  report_done: z.boolean().nullable(),
  contractor_name: z.string().nullable(),
  school: z.object({ name: z.string().nullable(), ministry_no: z.string().nullable() }).nullable(),
});

type ExportCounts = { summaryRows: number; records: number };

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

const monthlyTypeNames: Record<string, string> = {
  maintenance: 'الصيانة',
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

function monthlyCategory(planType: string): PlanSummaryCategory | null {
  if (planType === 'maintenance') return 'maintenance';
  if (planType === 'cleaning') return 'cleaning';
  if (planType === 'security_safety') return 'security';
  if (planType === 'elevators') return 'elevators';
  return null;
}

function generalCategory(planType: string): PlanSummaryCategory | null {
  if (planType === 'water_supply') return 'water';
  if (planType === 'sewage_removal' || planType === 'sewage_waste') return 'sewage';
  return null;
}

function periodKey(group: 'monthly' | 'general', period: string | number): string {
  const value = String(period);
  return group === 'monthly' ? `monthly:${value.slice(0, 7)}` : `general:${value.slice(0, 4)}`;
}

function planRecord(
  input: Omit<PlanSummaryRecord, 'schoolName' | 'ministryNumber'> & {
    school: { name: string | null; ministry_no: string | null } | null;
  },
): PlanSummaryRecord {
  const { school, ...record } = input;
  return {
    ...record,
    schoolName: school?.name ?? '',
    ministryNumber: school?.ministry_no ?? '',
  };
}

function downloadWorkbook(buffer: ArrayBuffer, fileName: string) {
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function loadLogoBase64(): Promise<string> {
  const response = await fetch(`${import.meta.env.BASE_URL}brand/logo.png`);
  if (!response.ok) throw new Error('تعذر تحميل شعار شلفا لإضافته إلى ملف Excel.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function exportAllPlans(): Promise<ExportCounts> {
  if (!supabase) throw new Error('إعداد الاتصال بقاعدة البيانات غير مكتمل.');
  const client = supabase;
  const [monthlyPlans, generalPlans, customTypes, customPlans] = await Promise.all([
    fetchAllPages(async (from, to) => {
      const { data, error } = await client.from('monthly_plans')
        .select('id,plan_type,month')
        .order('id')
        .range(from, to);
      if (error) throw error;
      return z.array(monthlyPlanSchema).parse(data);
    }),
    fetchAllPages(async (from, to) => {
      const { data, error } = await client.from('general_plans')
        .select('id,plan_type,year')
        .order('id')
        .range(from, to);
      if (error) throw error;
      return z.array(generalPlanSchema).parse(data);
    }),
    fetchAllPages(async (from, to) => {
      const { data, error } = await client.from('custom_plan_types')
        .select('id,name,group_key')
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
        .select('id,plan_id,school_id,planned_date,engineer_name,supervisor_name,contractor_name,visited,report_done,school:schools(name,ministry_no)')
        .order('id')
        .range(from, to);
      if (error) throw error;
      return z.array(monthlyPlanRowSchema).parse(data);
    }),
    fetchAllPages(async (from, to) => {
      const { data, error } = await client.from('general_plan_rows')
        .select('id,plan_id,school_id,planned_date,execution_date,status,report_done,supervisor_name,engineer_name,contractor_name,school:schools(name,ministry_no)')
        .order('id')
        .range(from, to);
      if (error) throw error;
      return z.array(generalPlanRowSchema).parse(data);
    }),
    fetchAllPages(async (from, to) => {
      const { data, error } = await client.from('custom_plan_rows')
        .select('id,plan_id,school_id,planned_date,execution_date,status,supervisor_name,engineer_name,visited,report_done,contractor_name,school:schools(name,ministry_no)')
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
  const records: PlanSummaryRecord[] = [];

  for (const row of monthlyRows) {
    const plan = monthlyPlanById.get(row.plan_id);
    const category = plan ? monthlyCategory(plan.plan_type) : null;
    records.push(planRecord({
      id: row.id,
      schoolId: row.school_id,
      school: row.school,
      periodKey: periodKey('monthly', plan?.month ?? 'غير محدد'),
      category,
      extraType: category ? undefined : (plan ? monthlyTypeNames[plan.plan_type] ?? plan.plan_type : 'خطة شهرية غير معروفة'),
      plannedDate: row.planned_date,
      engineerName: row.engineer_name,
      responsibleName: row.supervisor_name,
      contractorName: row.contractor_name,
      visited: row.visited,
      reportDone: row.report_done,
    }));
  }

  for (const row of generalRows) {
    const plan = generalPlanById.get(row.plan_id);
    const category = plan ? generalCategory(plan.plan_type) : null;
    records.push(planRecord({
      id: row.id,
      schoolId: row.school_id,
      school: row.school,
      periodKey: periodKey('general', plan?.year ?? 'غير محدد'),
      category,
      extraType: category ? undefined : (plan ? generalTypeNames[plan.plan_type] ?? plan.plan_type : 'خطة عامة غير معروفة'),
      plannedDate: row.planned_date,
      engineerName: row.engineer_name,
      responsibleName: row.supervisor_name,
      contractorName: row.contractor_name,
      visited: row.status === 'done' || Boolean(row.execution_date),
      reportDone: row.report_done,
    }));
  }

  for (const row of customRows) {
    const plan = customPlanById.get(row.plan_id);
    const type = plan ? customTypeById.get(plan.type_id) : undefined;
    const category = type ? matchCustomPlanCategory(type.name) : null;
    records.push(planRecord({
      id: row.id,
      schoolId: row.school_id,
      school: row.school,
      periodKey: periodKey(type?.group_key ?? 'general', plan?.period ?? 'غير محدد'),
      category,
      extraType: category ? undefined : (type?.name ?? 'خطة مخصصة غير معروفة'),
      plannedDate: row.planned_date,
      engineerName: row.engineer_name,
      responsibleName: row.supervisor_name,
      contractorName: row.contractor_name,
      visited: row.visited ?? (row.status === 'done' || Boolean(row.execution_date)),
      reportDone: row.report_done,
    }));
  }

  const summary = buildPlanSummary(records);
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'شلفا لإدارة المرافق';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('ملخص الخطط', {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 4 }],
  });
  const lastColumn = summary.columns.length;

  sheet.mergeCells(1, 1, 2, 1);
  sheet.mergeCells(1, 2, 2, lastColumn);
  for (let rowNumber = 1; rowNumber <= 2; rowNumber += 1) {
    for (let columnNumber = 1; columnNumber <= lastColumn; columnNumber += 1) {
      sheet.getCell(rowNumber, columnNumber).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF29375A' } };
    }
  }
  sheet.getCell(1, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
  const title = sheet.getCell(1, 2);
  title.value = 'ملخص الخطط';
  title.font = { name: 'Cairo', size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
  title.alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.getRow(1).height = 30;
  sheet.getRow(2).height = 30;

  const logoId = workbook.addImage({ base64: await loadLogoBase64(), extension: 'png' });
  sheet.addImage(logoId, { tl: { col: 0.1, row: 0.1 }, ext: { width: 145, height: 55 } });

  const headerRow = sheet.getRow(4);
  headerRow.values = summary.columns.map(({ header }) => header);
  headerRow.height = 44;
  headerRow.eachCell((cell, columnNumber) => {
    cell.font = { name: 'Cairo', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF31416C' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { bottom: { style: 'medium', color: { argb: 'FF9EAFD2' } } };
    if (summary.columns[columnNumber - 1]?.key.startsWith('extra:')) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF536BA0' } };
    }
  });

  for (const [index, column] of summary.columns.entries()) {
    sheet.getColumn(index + 1).width = column.key === 'school' ? 28
      : column.key === 'ministryNumber' ? 17
        : column.key.endsWith('Date') || column.key.endsWith('date') ? 19
          : column.key.endsWith('Visited') || column.key.endsWith('Report') ? 15
            : column.key.startsWith('extra:') ? 20
              : 21;
  }

  for (const [rowIndex, record] of summary.rows.entries()) {
    const row = sheet.getRow(rowIndex + 5);
    row.values = summary.columns.map(({ key }) => record[key] ?? '');
    row.height = 30;
    row.eachCell((cell) => {
      cell.font = { name: 'Cairo', size: 10, color: { argb: 'FF24304D' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFE2E7F2' } } };
      if (rowIndex % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F3F9' } };
      }
    });
  }

  sheet.autoFilter = {
    from: { row: 4, column: 1 },
    to: { row: Math.max(4, summary.rows.length + 4), column: lastColumn },
  };
  const output = await workbook.xlsx.writeBuffer();
  downloadWorkbook(output, `ملخص-الخطط-${new Date().toISOString().slice(0, 10)}.xlsx`);
  return { summaryRows: summary.rows.length, records: records.length };
}

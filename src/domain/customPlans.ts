import { z } from 'zod';
import type { PlanEligibilityConfig, SchoolSourceRecord } from './planEligibility';
import { eligibleSchoolIds, normalizeEligibilityValue } from './planEligibility';

export const customPlanTypeSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, 'اسم الخطة مطلوب.'),
  cadence: z.enum(['monthly', 'yearly']),
  scope: z.enum(['all_in_scope', 'manual']),
  track_visit_report: z.boolean(),
  group_key: z.enum(['monthly', 'general']),
  created_at: z.string(),
  is_active: z.boolean(),
});

export const customPlanCreateSchema = z.object({
  name: z.string().trim().min(1, 'اسم الخطة مطلوب.').max(120, 'اسم الخطة طويل جداً.'),
  cadence: z.enum(['monthly', 'yearly']),
  scope: z.enum(['all_in_scope', 'manual']),
  track_visit_report: z.boolean(),
  group_key: z.enum(['monthly', 'general']),
});

export type CustomPlanType = z.infer<typeof customPlanTypeSchema>;
export type CustomPlanCreate = z.infer<typeof customPlanCreateSchema>;

export function describeDatabaseError(error: unknown): string {
  const reason = error as { code?: string; message?: string };
  if (reason.code === '42703' || reason.code === 'PGRST204') return 'مخطط قاعدة البيانات قديم؛ طبّق ترحيل الخطط المخصصة 202611060005_custom_plan_group_and_audit.sql.';
  if (reason.code === '42501') return 'ليس لديك صلاحية تنفيذ هذه العملية وفق سياسات الوصول.';
  if (reason.code === '23505') return 'يوجد اسم خطة أو فترة خطة مكررة.';
  if (reason.code === '23514') return 'قيمة في الطلب تخالف قيد قاعدة البيانات.';
  return reason.message ?? 'تعذر تنفيذ العملية.';
}

export function normalisePlanName(value: string): string {
  return value.trim().normalize('NFKC').replace(/[أإآٱىةـ]/g, (char) => ({
    أ: 'ا', إ: 'ا', آ: 'ا', ٱ: 'ا', ى: 'ي', ة: 'ه', ـ: '',
  }[char] ?? char)).replace(/\s+/g, ' ').toLocaleLowerCase();
}

export function assertUniqueActiveName(name: string, types: readonly Pick<CustomPlanType, 'id' | 'name' | 'is_active'>[], ignoreId?: string): void {
  const normalised = normalisePlanName(name);
  if (!normalised) throw new Error('اسم الخطة مطلوب.');
  if (types.some((type) => type.is_active && type.id !== ignoreId && normalisePlanName(type.name) === normalised)) {
    throw new Error('يوجد نوع خطة نشط بهذا الاسم.');
  }
}

export function buildCustomMenu(types: readonly CustomPlanType[], group: 'monthly' | 'general') {
  return types
    .filter((type) => type.is_active && type.group_key === group)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((type) => ({ label: type.name, path: `/plans/custom/${type.id}` }));
}

export function eligibleCustomSchoolIds(
  schools: readonly SchoolSourceRecord[],
  scope: CustomPlanType['scope'],
  config: PlanEligibilityConfig,
): string[] {
  if (scope === 'all_in_scope') {
    return schools
      .filter((school) => school.sourceFields.plan_scope !== false)
      .filter((school) => normalizeEligibilityValue(school.sourceFields[config.buildingTypeHeader]) !== normalizeEligibilityValue('مشترك ملحق'))
      .map((school) => school.id);
  }
  return eligibleSchoolIds(schools, 'maintenance', config);
}

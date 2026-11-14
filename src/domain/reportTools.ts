import type { UserProfile } from '../lib/auth';

export const reportTools = [
  {
    id: 'cleaning',
    label: 'منجز تقارير النظافة',
    description: 'إنشاء تقرير التنظيف العميق من قالب Excel وإضافة صور المدرسة.',
  },
  {
    id: 'maintenance',
    label: 'منجز تقارير الصيانة و التكييف',
    description: 'إنشاء تقارير الصيانة والتكييف مع الصور المطلوبة لكل فئة.',
  },
  {
    id: 'tank-washing',
    label: 'منجز تقارير غسيل الخزانات',
    description: 'إنشاء تقرير PowerPoint بصور قبل/بعد أو صور عامة.',
  },
  {
    id: 'pest-control',
    label: 'منجز تقارير مكافحة الافات',
    description: 'إنشاء تقرير مكافحة الآفات من قالب PowerPoint.',
  },
] as const;

export type ReportToolId = (typeof reportTools)[number]['id'];

export function canUseReportTools(role: UserProfile['role'] | null | undefined): boolean {
  return role === 'admin'
    || role === 'project_manager'
    || role === 'area_engineer'
    || role === 'report_follower';
}

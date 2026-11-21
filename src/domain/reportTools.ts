import type { PermissionKey } from './permissions';

export const reportTools = [
  {
    id: 'cleaning',
    label: 'منجز تقارير النظافة',
    description: 'إنشاء تقرير التنظيف العميق من قالب Excel وإضافة صور المدرسة.',
  },
  {
    id: 'cleaning-attendance',
    label: 'منجز تقارير تحضير عمالة النظافة',
    description: 'إنشاء تقرير تحضير عمالة النظافة من قالب PowerPoint وإضافة صورة في كل شريحة.',
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

export function canUseReportTools(permissions: ReadonlySet<PermissionKey>): boolean {
  return permissions.has('reports.tools');
}

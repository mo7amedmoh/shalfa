import { describe, expect, it } from 'vitest';
import { buildPlanSummary, matchCustomPlanCategory, type PlanSummaryRecord } from './planExportSummary';

function record(overrides: Partial<PlanSummaryRecord>): PlanSummaryRecord {
  return {
    id: 'row-1',
    schoolId: 'school-1',
    schoolName: 'مدرسة الاختبار',
    ministryNumber: '12345',
    periodKey: 'monthly:2026-11',
    category: 'maintenance',
    extraType: undefined,
    plannedDate: '2026-11-12',
    engineerName: null,
    responsibleName: null,
    contractorName: null,
    visited: null,
    reportDone: null,
    ...overrides,
  };
}

describe('buildPlanSummary', () => {
  it('combines service plans for the same school and period and retains unmatched plans in extra columns', () => {
    const summary = buildPlanSummary([
      record({ engineerName: 'مهندس 1', responsibleName: 'مشرف 1', visited: true, reportDone: false }),
      record({
        id: 'row-2',
        category: 'cleaning',
        plannedDate: '2026-11-14',
        engineerName: null,
        responsibleName: 'مشرف نظافة',
        visited: true,
        reportDone: true,
      }),
      record({
        id: 'row-3',
        category: null,
        extraType: 'خطة البستنة',
        plannedDate: '2026-11-18',
        responsibleName: 'مقاول البستنة',
        visited: false,
        reportDone: false,
      }),
    ]);

    expect(summary.rows).toHaveLength(1);
    expect(summary.columns.slice(0, 23).map(({ header }) => header)).toEqual([
      'المدرسة',
      'الرقم الوزاري',
      'المهندس',
      'تاريخ خطة الصيانة',
      'مشرف الصيانة',
      'تمت الزيارة',
      'تم التقرير',
      'تاريخ خطة النظافة',
      'مشرف النظافة',
      'تمت الزيارة',
      'تم التقرير',
      'تاريخ خطة الامن و السلامة',
      'مقاول الامن و السلامة',
      'تمت الزيارة',
      'تم التقرير',
      'تاريخ خطة المصاعد',
      'مقاول المصاعد',
      'تمت الزيارة',
      'تم التقرير',
      'تاريخ خطة توريد المياة',
      'تمت الزيارة',
      'تاريخ خطة النزح',
      'تمت الزيارة',
    ]);
    expect(summary.rows[0]).toMatchObject({
      school: 'مدرسة الاختبار',
      maintenanceEngineer: 'مهندس 1',
      maintenanceSupervisor: 'مشرف 1',
      maintenanceVisited: 'نعم',
      maintenanceReport: 'لا',
      cleaningDate: '2026-11-14',
      cleaningSupervisor: 'مشرف نظافة',
      'extra:خطة البستنة:date': '2026-11-18',
      'extra:خطة البستنة:responsible': 'مقاول البستنة',
      'extra:خطة البستنة:visited': 'لا',
    });
    expect(summary.columns.map(({ header }) => header)).toContain('خطة البستنة - تاريخ الخطة');
  });

  it('keeps different periods separate and maps matching custom plan names to fixed service columns', () => {
    const summary = buildPlanSummary([
      record({ id: 'row-1', periodKey: 'monthly:2026-10' }),
      record({ id: 'row-2', periodKey: 'monthly:2026-11' }),
    ]);

    expect(summary.rows).toHaveLength(2);
    expect(matchCustomPlanCategory('خطة صيانة وتكييف')).toBe('maintenance');
    expect(matchCustomPlanCategory('خطة توريد المياه')).toBe('water');
    expect(matchCustomPlanCategory('غسيل خزانات المياه')).toBeNull();
    expect(matchCustomPlanCategory('خطة غير مصنفة')).toBeNull();
  });
});

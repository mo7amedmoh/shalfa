import { describe, expect, it } from 'vitest';
import { assertUniqueActiveName, buildCustomMenu, customPlanCreateSchema, eligibleCustomSchoolIds } from './customPlans';

const type = (id: string, name: string, created_at: string, group_key: 'monthly' | 'general' = 'monthly') => ({
  id, name, created_at, group_key, is_active: true, cadence: 'monthly' as const,
  scope: 'all_in_scope' as const, track_visit_report: true,
});

describe('custom plans', () => {
  it('trims and validates the Arabic name', () => {
    expect(customPlanCreateSchema.parse({
      name: '  خطة النظافة  ', cadence: 'monthly', scope: 'manual',
      track_visit_report: true, group_key: 'monthly',
    }).name).toBe('خطة النظافة');
    expect(() => customPlanCreateSchema.parse({
      name: ' ', cadence: 'monthly', scope: 'manual',
      track_visit_report: true, group_key: 'monthly',
    })).toThrow();
  });

  it('accepts the yearly all-in-scope rainy-season plan payload', () => {
    expect(customPlanCreateSchema.parse({
      name: 'استعدادات موسم الامطار',
      cadence: 'yearly',
      scope: 'all_in_scope',
      track_visit_report: true,
      group_key: 'general',
    })).toMatchObject({ cadence: 'yearly', scope: 'all_in_scope', track_visit_report: true });
  });

  it('rejects duplicate active names but allows hidden duplicates', () => {
    expect(() => assertUniqueActiveName(' خطة صيانة ', [type('1', 'خطة صيانة', '2026-01-01')])).toThrow();
    expect(() => assertUniqueActiveName(' خطة صيانة ', [{ ...type('1', 'خطة صيانة', '2026-01-01'), is_active: false }])).not.toThrow();
  });

  it('builds dynamic group menus in creation order', () => {
    expect(buildCustomMenu([type('2', 'ثانية', '2026-02-01'), type('1', 'أولى', '2026-01-01')], 'monthly').map((item) => item.label))
      .toEqual(['أولى', 'ثانية']);
  });

  it('excludes appended shared schools from eligibility', () => {
    const config = { buildingTypeHeader: 'نوع', independentBuildingValues: ['مستقل'], primarySharedValues: ['مشترك'], elevatorContractorHeader: 'مصعد', noElevatorValues: [] };
    expect(eligibleCustomSchoolIds([
      { id: '1', sourceFields: { plan_scope: true, نوع: 'مستقل' } },
      { id: '2', sourceFields: { plan_scope: true, نوع: 'مشترك ملحق' } },
    ], 'all_in_scope', config)).toEqual(['1']);
  });
});

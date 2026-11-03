import { describe, expect, it } from 'vitest';
import { eligibleSchoolIds, type PlanEligibilityConfig } from './planEligibility';
import type { GeneralPlanType, PlanType } from './types';

const config: PlanEligibilityConfig = {
  buildingTypeHeader: 'نوع المبنى',
  independentBuildingValues: ['مستقل'],
  primarySharedValues: ['مشترك اساسي'],
  elevatorContractorHeader: 'مقاول المصاعد',
  noElevatorValues: ['لا ينطبق', ''],
};

const schools = [
  { id: 'independent', sourceFields: { 'نوع المبنى': 'مستقل', 'مقاول المصاعد': 'شركة' } },
  { id: 'shared', sourceFields: { 'نوع المبنى': 'مشترك اساسي', 'مقاول المصاعد': 'لا ينطبق' } },
  { id: 'annex', sourceFields: { 'نوع المبنى': 'مشترك ملحق', 'مقاول المصاعد': 'شركة' } },
  { id: 'missing', sourceFields: { 'نوع المبنى': 'مستقل', 'مقاول المصاعد': '' } },
];

describe('configurable school plan eligibility', () => {
  it('uses configured independent and primary shared values', () => {
    expect(eligibleSchoolIds(schools, 'maintenance', config)).toEqual(['independent', 'shared', 'missing']);
  });

  it('requires an elevator contractor for elevator plans', () => {
    expect(eligibleSchoolIds(schools, 'elevators', config)).toEqual(['independent']);
  });

  it.each([
    'maintenance', 'cleaning', 'security_safety', 'elevators',
    'gardening', 'landscaping', 'sewage_waste', 'tank_washing', 'pest_control', 'annual_readiness',
  ] as const satisfies readonly (PlanType | GeneralPlanType)[])(
    'always excludes annex shared buildings from %s plans',
    (planType) => {
      expect(eligibleSchoolIds(schools, planType, {
        ...config,
        independentBuildingValues: [...config.independentBuildingValues, 'مشترك ملحق'],
      })).not.toContain('annex');
    },
  );

  it('rejects missing source headers rather than silently including schools', () => {
    expect(() => eligibleSchoolIds(schools, 'maintenance', { ...config, buildingTypeHeader: '' })).toThrow();
  });
});

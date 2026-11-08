import type { GeneralPlanType, PlanType } from './types';

export interface PlanEligibilityConfig {
  buildingTypeHeader: string;
  independentBuildingValues: string[];
  primarySharedValues: string[];
  elevatorContractorHeader: string;
  noElevatorValues: string[];
}

export interface SchoolSourceRecord {
  id: string;
  sourceFields: Record<string, unknown>;
}

export function normalizeEligibilityValue(value: unknown): string {
  return typeof value === 'string'
    ? value.normalize('NFKC')
      .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase()
    : '';
}

export function eligibleSchoolIds(
  schools: readonly SchoolSourceRecord[],
  planType: PlanType | GeneralPlanType,
  config: PlanEligibilityConfig,
): string[] {
  if (!config.buildingTypeHeader.trim() || !config.elevatorContractorHeader.trim()) {
    throw new Error('يجب ضبط عناوين أعمدة أهلية الخطط.');
  }
  const buildingValues = new Set(
    [...config.independentBuildingValues, ...config.primarySharedValues].map(normalizeEligibilityValue).filter(Boolean),
  );
  const noElevatorValues = new Set(config.noElevatorValues.map(normalizeEligibilityValue).filter(Boolean));
  return schools
    .filter((school) => {
      const buildingType = normalizeEligibilityValue(school.sourceFields[config.buildingTypeHeader]);
      if (buildingType === normalizeEligibilityValue('مشترك ملحق')) return false;
      if (!buildingValues.has(buildingType)) return false;
      if (planType !== 'elevators') return true;
      const contractor = normalizeEligibilityValue(school.sourceFields[config.elevatorContractorHeader]);
      return contractor !== '' && !noElevatorValues.has(contractor);
    })
    .map((school) => school.id);
}

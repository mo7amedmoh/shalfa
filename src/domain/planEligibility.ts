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

function normalized(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLocaleLowerCase() : '';
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
    [...config.independentBuildingValues, ...config.primarySharedValues].map(normalized).filter(Boolean),
  );
  const noElevatorValues = new Set(config.noElevatorValues.map(normalized).filter(Boolean));
  return schools
    .filter((school) => {
      const buildingType = normalized(school.sourceFields[config.buildingTypeHeader]);
      if (buildingType === normalized('مشترك ملحق')) return false;
      if (!buildingValues.has(buildingType)) return false;
      if (planType !== 'elevators') return true;
      const contractor = normalized(school.sourceFields[config.elevatorContractorHeader]);
      return contractor !== '' && !noElevatorValues.has(contractor);
    })
    .map((school) => school.id);
}

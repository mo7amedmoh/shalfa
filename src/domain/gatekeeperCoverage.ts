export type GatekeeperCoverageSchool = {
  id: string;
  name: string;
  ministryNumber: string;
  inScope: boolean;
};

export type GatekeeperCoverageRecord = {
  schoolId: string;
  employeeId: string | null;
};

export type GatekeeperCoverage = {
  gatekeeperRows: number;
  inScopeSchools: number;
  schoolsWithGatekeeper: number;
  schoolsWithoutGatekeeper: GatekeeperCoverageSchool[];
  unlinkedInScopeRows: number;
  outOfScopeRows: number;
};

export function summarizeGatekeeperCoverage(
  schools: readonly GatekeeperCoverageSchool[],
  gatekeepers: readonly GatekeeperCoverageRecord[],
): GatekeeperCoverage {
  const inScope = schools.filter((school) => school.inScope);
  const inScopeIds = new Set(inScope.map((school) => school.id));
  const scopedRecords = gatekeepers.filter((gatekeeper) => inScopeIds.has(gatekeeper.schoolId));
  const coveredIds = new Set(scopedRecords.map((gatekeeper) => gatekeeper.schoolId));
  return {
    gatekeeperRows: gatekeepers.length,
    inScopeSchools: inScope.length,
    schoolsWithGatekeeper: coveredIds.size,
    schoolsWithoutGatekeeper: inScope.filter((school) => !coveredIds.has(school.id)),
    unlinkedInScopeRows: scopedRecords.filter((gatekeeper) => !gatekeeper.employeeId).length,
    outOfScopeRows: gatekeepers.length - scopedRecords.length,
  };
}

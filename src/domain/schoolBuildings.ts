export type SchoolSourceColumn = { header: string; value: unknown };

export function resolveSchoolBuildingNames(
  schools: readonly { source_columns: readonly SchoolSourceColumn[] }[],
): string[] {
  const buildingNamesByNumber = new Map<string, string>();
  const buildingNumbers: string[] = [];
  const sourceBuildingNames: string[] = [];

  for (const school of schools) {
    const buildingNumber = String(school.source_columns.find(({ header }) => header === 'م')?.value ?? '').trim();
    const buildingName = String(school.source_columns.find(({ header }) => header === 'المبني')?.value ?? '').trim();
    buildingNumbers.push(buildingNumber);
    sourceBuildingNames.push(buildingName);
    if (buildingNumber && buildingName && !buildingNamesByNumber.has(buildingNumber)) {
      buildingNamesByNumber.set(buildingNumber, buildingName);
    }
  }

  return sourceBuildingNames.map((name, index) =>
    name || buildingNamesByNumber.get(buildingNumbers[index]) || '',
  );
}

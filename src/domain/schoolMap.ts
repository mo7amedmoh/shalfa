export interface MappableSchool {
  id: string;
  latitude: number | null;
  longitude: number | null;
}

export function isRiyadhCoordinate(latitude: number | null, longitude: number | null): boolean {
  return latitude !== null && longitude !== null
    && latitude >= 24 && latitude <= 25.5
    && longitude >= 46 && longitude <= 47.5;
}

export function schoolsWithMapCoordinates<T extends MappableSchool>(schools: readonly T[]): T[] {
  return schools.filter((school) => isRiyadhCoordinate(school.latitude, school.longitude));
}

export function duplicateMinistryRows<T extends { ministry_number: string; source_row: number | null }>(
  schools: readonly T[],
): Array<{ ministryNumber: string; rows: number[] }> {
  const grouped = new Map<string, number[]>();
  for (const school of schools) {
    const rows = grouped.get(school.ministry_number) ?? [];
    if (school.source_row !== null) rows.push(school.source_row);
    grouped.set(school.ministry_number, rows);
  }
  return [...grouped.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([ministryNumber, rows]) => ({ ministryNumber, rows: rows.sort((a, b) => a - b) }));
}

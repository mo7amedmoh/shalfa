export interface MappableSchool {
  id: string;
  latitude: number | null;
  longitude: number | null;
}

export type SlimMapSchool = {
  id: string;
  name: string;
  ministryNumber: string;
  latitude: number | null;
  longitude: number | null;
  size: 'small' | 'medium' | 'large' | null;
  buildingType: string | null;
  planScope: boolean;
};

export function toSlimMapSchool(school: {
  id: string;
  school_name: string;
  ministry_number: string;
  latitude: number | null;
  longitude: number | null;
  size_source: 'small' | 'medium' | 'large' | null;
  size_calc: 'small' | 'medium' | 'large' | null;
  building_type: string | null;
  plan_scope: boolean;
}): SlimMapSchool {
  return {
    id: school.id,
    name: school.school_name,
    ministryNumber: school.ministry_number,
    latitude: school.latitude,
    longitude: school.longitude,
    size: school.size_calc ?? school.size_source,
    buildingType: school.building_type,
    planScope: school.plan_scope,
  };
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

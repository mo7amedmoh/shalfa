import type { SlimMapSchool } from '../../domain/schoolMap';

export interface SchoolMapCamera {
  getZoom: () => number;
  panTo: (coordinates: [number, number]) => void;
  setZoom: (zoom: number) => void;
}

export function selectSchoolOnMap(
  map: SchoolMapCamera,
  school: Pick<SlimMapSchool, 'latitude' | 'longitude'>,
): void {
  if (school.latitude === null || school.longitude === null) return;
  if (map.getZoom() < 14) map.setZoom(15);
  map.panTo([school.latitude, school.longitude]);
}

import { useEffect } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';
import type { SlimMapSchool } from '../../domain/schoolMap';

function markerColour(size: SlimMapSchool['size']): string {
  return size === 'large' ? '#c43d4d' : size === 'medium' ? '#d79527' : '#2877b8';
}

export function SchoolMapMarkers({
  schools,
  onSelect,
}: {
  schools: readonly SlimMapSchool[];
  onSelect: (schoolId: string) => void;
}) {
  const map = useMap();

  useEffect(() => {
    const markers = new Map<string, L.CircleMarker>();
    for (const school of schools) {
      if (school.latitude === null || school.longitude === null) continue;
      const marker = L.circleMarker([school.latitude, school.longitude], {
        radius: school.size === 'large' ? 8 : school.size === 'medium' ? 7 : 6,
        color: markerColour(school.size),
        fillColor: markerColour(school.size),
        fillOpacity: 0.85,
        weight: 1,
      });
      marker.bindTooltip(school.name, { direction: 'top', sticky: true });
      marker.on('click', () => onSelect(school.id));
      markers.set(school.id, marker);
      marker.addTo(map);
    }
    return () => {
      markers.forEach((marker) => marker.removeFrom(map));
    };
  }, [map, onSelect, schools]);

  return null;
}

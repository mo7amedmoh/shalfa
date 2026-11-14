import { useEffect } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';
import type { SlimMapSchool } from '../../domain/schoolMap';

function markerColour(size: SlimMapSchool['size']): string {
  if (!size) return '#64748b';
  return ({
    small: '#2877b8',
    small_plus: '#26a69a',
    medium: '#d79527',
    medium_plus: '#8b5cf6',
    large: '#c43d4d',
    large_plus: '#7f1d1d',
  } as const)[size];
}

function markerRadius(size: SlimMapSchool['size']): number {
  return size === 'large_plus' ? 9 : size === 'large' || size === 'medium_plus' ? 8 : size === 'medium' ? 7 : 6;
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
        radius: markerRadius(school.size),
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

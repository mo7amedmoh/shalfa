import { useEffect } from 'react';
import L, { type LayerGroup } from 'leaflet';
import { useMap } from 'react-leaflet';
import 'leaflet.markercluster';
import type { SlimMapSchool } from '../../domain/schoolMap';

type ClusterMap = typeof L & {
  markerClusterGroup: (options?: {
    chunkedLoading?: boolean;
    removeOutsideVisibleBounds?: boolean;
    showCoverageOnHover?: boolean;
    iconCreateFunction?: (cluster: { getChildCount: () => number }) => L.DivIcon;
  }) => LayerGroup;
};

const leafletWithClusters = L as ClusterMap;

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
    const cluster = leafletWithClusters.markerClusterGroup({
      chunkedLoading: true,
      removeOutsideVisibleBounds: true,
      showCoverageOnHover: false,
      iconCreateFunction: (group) => L.divIcon({
        className: 'school-cluster-icon',
        html: `<span>${group.getChildCount()}</span>`,
        iconSize: [36, 36],
      }),
    });
    const markers = new Map<string, L.CircleMarker>();
    const refreshLabels = () => {
      const bounds = map.getBounds();
      const labelled = map.getZoom() >= 15
        ? new Set(schools
          .filter((school) => school.latitude !== null && school.longitude !== null
            && bounds.contains([school.latitude, school.longitude]))
          .slice(0, 40)
          .map((school) => school.id))
        : new Set<string>();
      markers.forEach((marker, id) => {
        if (labelled.has(id)) marker.openTooltip();
        else marker.closeTooltip();
      });
    };

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
      cluster.addLayer(marker);
    }

    cluster.addTo(map);
    refreshLabels();
    map.on('moveend zoomend', refreshLabels);
    return () => {
      map.off('moveend zoomend', refreshLabels);
      cluster.removeFrom(map);
      cluster.clearLayers();
    };
  }, [map, onSelect, schools]);

  return null;
}

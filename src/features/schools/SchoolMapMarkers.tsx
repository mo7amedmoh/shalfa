import { useMemo } from 'react';
import { divIcon } from 'leaflet';
import { Marker, Popup, Tooltip } from 'react-leaflet';
import type { SchoolRecord } from './schoolTypes';
import { SchoolDetails } from './SchoolDetails';

const schoolIcon = divIcon({
  className: 'school-marker-icon',
  html: '<span class="school-map-marker" aria-hidden="true"></span>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

export function SchoolMapMarkers({
  schools,
  zoom,
  onSelect,
}: {
  schools: readonly SchoolRecord[];
  zoom: number;
  onSelect: (school: SchoolRecord) => void;
}) {
  const markers = useMemo(() => schools.filter((school) =>
    school.latitude !== null && school.longitude !== null,
  ), [schools]);
  return markers.map((school) => (
    <Marker
      key={school.id}
      position={[school.latitude!, school.longitude!]}
      icon={schoolIcon}
      eventHandlers={{ click: () => onSelect(school) }}
    >
      <Tooltip direction="top" offset={[0, -12]} permanent={zoom >= 14} sticky={zoom < 14}>
        {school.school_name}
      </Tooltip>
      <Popup>
        <h3 className="mb-2 font-bold">{school.school_name}</h3>
        <SchoolDetails school={school} />
      </Popup>
    </Marker>
  ));
}

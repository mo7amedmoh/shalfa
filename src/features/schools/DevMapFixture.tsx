import { MapContainer, TileLayer } from 'react-leaflet';
import type { SlimMapSchool } from '../../domain/schoolMap';
import { SchoolMapMarkers } from './SchoolMapMarkers';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

const schools: SlimMapSchool[] = Array.from({ length: 250 }, (_, index) => ({
  id: `fixture-${index}`,
  name: `مدرسة اختبار ${index + 1}`,
  ministryNumber: `F${String(index + 1).padStart(4, '0')}`,
  latitude: 24.55 + (index % 25) * 0.008,
  longitude: 46.55 + Math.floor(index / 25) * 0.008,
  size: index % 3 === 0 ? 'large' : index % 2 === 0 ? 'medium' : 'small',
  buildingType: 'مستقل',
  planScope: true,
}));

export function DevMapFixture() {
  return <div className="card p-3"><h1 className="mb-3 text-lg font-bold">خريطة اختبار الأداء</h1><MapContainer center={[24.65, 46.65]} zoom={10} preferCanvas scrollWheelZoom className="map-frame"><TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" /><SchoolMapMarkers schools={schools} onSelect={() => undefined} /></MapContainer></div>;
}

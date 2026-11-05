import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import { Download, List, Map as MapIcon, Search, SlidersHorizontal } from 'lucide-react';
import { z } from 'zod';
import { useDisplayFormat } from '../../app/useDisplayFormat';
import { duplicateMinistryRows, schoolsWithMapCoordinates, toSlimMapSchool } from '../../domain/schoolMap';
import { resolveSchoolBuildingNames } from '../../domain/schoolBuildings';
import type { UserProfile } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { APP_SCHEMA_SELECT } from '../../lib/schemaColumns';
import { DuplicateSchoolWarning } from './SchoolSyncWarnings';
import { SchoolDetails } from './SchoolDetails';
import { SchoolMapMarkers } from './SchoolMapMarkers';
import type { SchoolRecord } from './schoolTypes';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

const sourceColumnSchema = z.object({ header: z.string(), value: z.unknown() });
const schoolSchema = z.object({
  id: z.string(),
  ministry_number: z.string(),
  school_name: z.string(),
  source_columns: z.array(sourceColumnSchema),
  source_row: z.number().int().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  synced_at: z.string().nullable(),
  missing_from_sheet_at: z.string().nullable(),
  plan_scope: z.boolean(),
  size_source: z.enum(['small', 'medium', 'large']).nullable(),
  size_calc: z.enum(['small', 'medium', 'large']).nullable(),
  class_count: z.number().int().nullable(),
  building_type: z.string().nullable(),
  has_elevator_contractor: z.boolean(),
});

const categoricalHeaders = ['الحي', 'نوع المبنى', 'حجم المدرسة', 'المرحلة', 'الملكية', 'حالة الوحدة', 'مكتب التعليم'];

async function loadSchools(): Promise<SchoolRecord[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('schools')
    .select(APP_SCHEMA_SELECT.schoolsMap)
    .order('source_row');
  if (error) throw error;
  return z.array(schoolSchema).parse(data);
}

function cellValue(school: SchoolRecord, header: string): string {
  const column = school.source_columns.find((item) => item.header === header);
  return column ? displayValue(column.value) : '';
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function columnWidth(header: string): number {
  if (header === 'م') return 72;
  if (header === 'الرقم الوزاري') return 132;
  if (header === 'اسم المدرسة' || header === 'المبني') return 230;
  if (header === 'العنوان') return 280;
  if (header.startsWith('رقم ') || header.startsWith('هاتف')) return 140;
  if (header === 'الحي' || header === 'المرحلة' || header === 'الملكية') return 132;
  if (header.includes('مقاول') || header.includes('مشرف') || header.includes('مهندس')) return 190;
  return 158;
}

function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

function MapViewport({
  schools,
  target,
}: {
  schools: readonly SchoolRecord[];
  target: SchoolRecord | null;
}) {
  const map = useMap();
  useEffect(() => {
    if (target?.latitude !== null && target?.longitude !== null && target) {
      map.flyTo([target.latitude, target.longitude], Math.max(map.getZoom(), 15), { duration: 0.6 });
      return;
    }
    if (schools.length) {
      map.fitBounds(schools.map((school) => [school.latitude!, school.longitude!] as [number, number]), { padding: [28, 28], maxZoom: 14 });
    } else {
      map.setView([24.7136, 46.6753], 10);
    }
  }, [map, schools, target]);
  return null;
}

export function SchoolsPage({ profile }: { profile: UserProfile | null }) {
  const [search, setSearch] = useState('');
  const [displayMode, setDisplayMode] = useState<'table' | 'map'>('table');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [visibleColumns, setVisibleColumns] = useState<number[]>([]);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [mapTargetId, setMapTargetId] = useState('');
  const [mapSearch, setMapSearch] = useState('');
  const [selectedSchoolId, setSelectedSchoolId] = useState('');
  const { formatNumber, formatDateTime } = useDisplayFormat();
  const { data: schools = [], isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['schools'],
    queryFn: loadSchools,
    enabled: Boolean(supabase && profile),
    staleTime: 5 * 60 * 1000,
  });
  const columns = useMemo(() => schools[0]?.source_columns.map(({ header }, index) => ({ index, header })) ?? [], [schools]);
  const buildingNames = useMemo(() => resolveSchoolBuildingNames(schools), [schools]);
  const resolvedBuildingNames = useMemo(
    () => new Map(schools.map((school, index) => [school.id, buildingNames[index] ?? ''])),
    [schools, buildingNames],
  );
  useEffect(() => {
    setVisibleColumns((current) => current.length
      ? current.filter((index) => index < columns.length)
      : columns.filter(({ header }) => header !== 'العنوان').map(({ index }) => index));
  }, [columns]);
  useEffect(() => {
    const update = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const filterHeaders = categoricalHeaders.filter((header) => columns.some((column) => column.header === header));
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return schools.filter((school) => {
      if (needle && !school.source_columns.some(({ value }) => displayValue(value).toLocaleLowerCase().includes(needle))) return false;
      return filterHeaders.every((header) => !filters[header] || cellValue(school, header) === filters[header]);
    });
  }, [schools, search, filters, filterHeaders]);
  const mappableSchools = useMemo(() => schoolsWithMapCoordinates(filtered), [filtered]);
  const slimMapSchools = useMemo(() => mappableSchools.map(toSlimMapSchool), [mappableSchools]);
  const coordinateIssues = useMemo(() => filtered.filter((school) =>
    !schoolsWithMapCoordinates([school]).length,
  ), [filtered]);
  const duplicates = useMemo(() => duplicateMinistryRows(schools), [schools]);
  const missingSchools = useMemo(() => schools.filter((school) => school.missing_from_sheet_at !== null), [schools]);
  const lastSynced = schools.map((school) => school.synced_at).filter((value): value is string => Boolean(value)).sort().at(-1);
  const selectedSchool = schools.find((school) => school.id === selectedSchoolId) ?? null;
  const mapTarget = mappableSchools.find((school) => school.id === mapTargetId) ?? null;
  const canSync = profile?.role === 'admin';
  const visible = new Set(visibleColumns);

  function styleForColumn(index: number, header: string, isHeader: boolean) {
    const ministryIndex = columns.find(({ header: item }) => item === 'الرقم الوزاري')?.index;
    const schoolNameIndex = columns.find(({ header: item }) => item === 'اسم المدرسة')?.index;
    const pinned = [ministryIndex, schoolNameIndex].filter((value): value is number => value !== undefined && visible.has(value));
    const width = columnWidth(header);
    if (!pinned.includes(index)) {
      return { width: `${width}px`, minWidth: `${width}px`, maxWidth: `${width}px` };
    }
    const offset = pinned.filter((other) => other < index)
      .reduce((sum, other) => sum + columnWidth(columns[other].header), 0);
    return {
      position: 'sticky' as const,
      insetInlineStart: `${offset}px`,
      minWidth: `${width}px`,
      width: `${width}px`,
      maxWidth: `${width}px`,
      zIndex: isHeader ? 5 : 2,
    };
  }

  function exportCsv() {
    const selected = columns.filter(({ index }) => visible.has(index));
    const content = [
      selected.map(({ header }) => csvCell(header)).join(','),
      ...filtered.map((school) => selected.map(({ index, header }) => csvCell(
        header === 'المبني'
          ? resolvedBuildingNames.get(school.id) ?? ''
          : displayValue(school.source_columns[index]?.value),
      )).join(',')),
    ].join('\r\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'schools.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="grid gap-5">
      {!isOnline && (
        <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          وضع بدون اتصال — آخر تحديث: {lastSynced ? formatDateTime(lastSynced) : 'غير متاح'}. قد لا تظهر خرائط الأساس دون اتصال.
        </div>
      )}
      {!isOnline && schools.length === 0 && <p role="alert" className="rounded-lg bg-rose-50 p-4 text-sm text-rose-800">لا توجد نسخة محفوظة من بيانات المدارس على هذا الجهاز.</p>}
      <section className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm text-slate-500">بيانات المدارس كما وردت في الورقة، مع البحث والخريطة</p>
          <h2 className="mt-1 text-2xl font-bold text-brand-900">المباني المدرسية</h2>
        </div>
        {canSync && <a href="/admin/settings" className="inline-flex items-center justify-center rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-800">إعداد المزامنة</a>}
      </section>

      <DuplicateSchoolWarning duplicates={duplicates} />
      {missingSchools.length > 0 && (
        <section role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          {missingSchools.length} مدرسة غير موجودة في آخر نسخة من الورقة؛ تم الاحتفاظ بالسجلات دون حذفها.
        </section>
      )}
      {coordinateIssues.length > 0 && (
        <section role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          {coordinateIssues.length} مدرسة لا تملك إحداثيات صالحة ضمن نطاق الرياض؛ تظهر في قائمة الجانب عند فتح الخريطة.
        </section>
      )}

      <section className="grid gap-3 sm:grid-cols-3">
        <article className="card p-4"><p className="text-sm text-slate-500">المدارس المعروضة</p><p className="mt-2 text-2xl font-bold text-brand-900">{isLoading ? '…' : formatNumber(schools.length)}</p></article>
        <article className="card p-4"><p className="text-sm text-slate-500">بلا إحداثيات صالحة</p><p className="mt-2 text-2xl font-bold text-brand-900">{formatNumber(coordinateIssues.length)}</p></article>
        <article className="card p-4"><p className="text-sm text-slate-500">آخر مزامنة مسجلة</p><p className="mt-2 text-sm font-bold text-brand-900">{lastSynced ? formatDateTime(lastSynced) : 'لا توجد مزامنة مسجلة'}</p></article>
      </section>

      <section className="card grid gap-3 p-4">
        <div className="flex flex-col gap-3 lg:flex-row">
          <label className="relative min-w-0 flex-1">
            <Search size={18} className="absolute inset-inline-start-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث في جميع أعمدة الورقة" className="w-full rounded-lg border border-slate-300 py-2.5 pe-3 ps-10" />
          </label>
          <div className="flex rounded-lg border border-slate-200 p-1" role="group" aria-label="طريقة عرض المدارس">
            <button type="button" onClick={() => setDisplayMode('table')} aria-pressed={displayMode === 'table'} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm ${displayMode === 'table' ? 'bg-brand-50 text-brand-800' : 'text-slate-600'}`}><List size={17} /> جدول</button>
            <button type="button" onClick={() => setDisplayMode('map')} aria-pressed={displayMode === 'map'} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm ${displayMode === 'map' ? 'bg-brand-50 text-brand-800' : 'text-slate-600'}`}><MapIcon size={17} /> خريطة</button>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {filterHeaders.map((header) => {
            const values = [...new Set(schools.map((school) => cellValue(school, header)).filter(Boolean))].sort();
            return (
              <label key={header} className="grid gap-1 text-xs font-semibold text-slate-600">
                {header}
                <select value={filters[header] ?? ''} onChange={(event) => setFilters((current) => ({ ...current, [header]: event.target.value }))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal">
                  <option value="">الكل</option>
                  {values.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
            );
          })}
        </div>
        {displayMode === 'table' && (
          <div className="flex flex-wrap items-center gap-2">
            <details className="relative">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm"><SlidersHorizontal size={16} /> الأعمدة</summary>
              <div className="absolute inset-inline-start-0 z-10 mt-2 max-h-80 w-72 overflow-auto rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
                {columns.map(({ index, header }) => (
                  <label key={index} className="flex items-center gap-2 border-b border-slate-100 py-1.5 text-sm">
                    <input type="checkbox" checked={visible.has(index)} onChange={(event) => setVisibleColumns((current) => event.target.checked ? [...current, index].sort((a, b) => a - b) : current.filter((item) => item !== index))} />
                    <span>{header}{columns.filter((column) => column.header === header)[0]?.index !== index ? ` (${columns.filter((column) => column.header === header).findIndex((column) => column.index === index) + 1})` : ''}</span>
                  </label>
                ))}
              </div>
            </details>
            <button type="button" onClick={exportCsv} disabled={!filtered.length || !visible.size} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-50"><Download size={16} /> تصدير CSV</button>
            <span className="text-xs text-slate-500">المعروض {formatNumber(filtered.length)} صفاً</span>
          </div>
        )}
      </section>

      {error && isOnline && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">تعذر تحميل المدارس. تحقق من اتصال Supabase وسياسات الوصول.</div>}
      {isLoading || (isFetching && isOnline) ? (
        <div role="status" className="card animate-pulse p-8 text-center text-slate-500">جارٍ تحميل المدارس…</div>
      ) : schools.length === 0 ? (
        <div className="card p-8 text-center">
          <h3 className="font-bold text-slate-800">لا توجد مدارس محملة</h3>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-7 text-slate-500">تتطلب المزامنة إعداد التبويب وعناوين الحقول. لن تحذف المزامنة المدارس القديمة.</p>
          <button type="button" onClick={() => void refetch()} className="mt-4 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold">إعادة المحاولة</button>
        </div>
      ) : displayMode === 'map' ? (
        <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="grid min-w-0 gap-3">
            <label className="grid gap-1 text-sm font-semibold">
              ابحث للانتقال إلى مدرسة
              <input
                list="map-school-options"
                value={mapSearch}
                onChange={(event) => {
                  const value = event.target.value;
                  setMapSearch(value);
                  const match = mappableSchools.find((school) =>
                    `${school.school_name} · ${school.ministry_number}`.toLocaleLowerCase() === value.trim().toLocaleLowerCase(),
                  );
                  if (match) {
                    setMapTargetId(match.id);
                    setSelectedSchoolId(match.id);
                  } else if (!value) {
                    setMapTargetId('');
                  }
                }}
                placeholder="اسم المدرسة أو رقمها الوزاري"
                className="rounded-lg border border-slate-300 px-3 py-2"
              />
              <datalist id="map-school-options">
                {mappableSchools.map((school) => <option key={school.id} value={`${school.school_name} · ${school.ministry_number}`} />)}
              </datalist>
            </label>
            <div className="card min-w-0 overflow-hidden p-3">
              <MapContainer center={[24.7136, 46.6753]} zoom={10} scrollWheelZoom preferCanvas className="map-frame" aria-label="خريطة المدارس">
                <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                <MapViewport schools={mappableSchools} target={mapTarget} />
                <SchoolMapMarkers schools={slimMapSchools} onSelect={setSelectedSchoolId} />
              </MapContainer>
              <div className="flex flex-wrap gap-3 px-2 pt-3 text-xs text-slate-600" aria-label="دليل أحجام المدارس">
                <span><i className="school-map-legend-dot school-map-legend-small" /> صغيرة</span>
                <span><i className="school-map-legend-dot school-map-legend-medium" /> متوسطة</span>
                <span><i className="school-map-legend-dot school-map-legend-large" /> كبيرة</span>
              </div>
              <p className="px-2 pt-3 text-xs text-slate-500">تجميع العلامات يعرض عدد المدارس في كل مجموعة. أسماء المدارس تظهر عند التحويم، وتبقى ظاهرة قرب مقياس تفصيلي.</p>
            </div>
          </div>
          <aside className="grid content-start gap-3">
            {selectedSchool && <section className="card grid gap-3 p-4">
              <h3 className="font-bold text-brand-900">{selectedSchool.school_name}</h3>
              <SchoolDetails school={selectedSchool} />
            </section>}
            <section className="card p-4">
              <h3 className="font-bold text-amber-900">مدارس خارج نطاق الخريطة أو بإحداثيات ناقصة ({coordinateIssues.length})</h3>
              <ul className="mt-3 grid max-h-64 gap-1 overflow-auto text-sm">
                {coordinateIssues.map((school) => (
                  <li key={school.id}>
                    <button type="button" onClick={() => setSelectedSchoolId(school.id)} className="w-full rounded px-2 py-1 text-start hover:bg-amber-50">
                      {school.school_name} · {school.ministry_number}
                    </button>
                  </li>
                ))}
                {!coordinateIssues.length && <li className="text-slate-500">كل المدارس الظاهرة لها إحداثيات صالحة.</li>}
              </ul>
            </section>
          </aside>
        </section>
      ) : (
        <section className="schools-table-scroll">
          <table dir="rtl" className="schools-source-table">
            <thead><tr>{columns.filter(({ index }) => visible.has(index)).map(({ index, header }) => (
              <th key={index} style={styleForColumn(index, header, true)}>{header}</th>
            ))}</tr></thead>
            <tbody>{filtered.map((school, rowIndex) => (
              <tr key={school.id} className={school.missing_from_sheet_at ? 'school-row-missing' : ''}>
                {columns.filter(({ index }) => visible.has(index)).map(({ index, header }) => (
                  header === 'المبني' ? (() => {
                    const buildingNumber = cellValue(school, 'م');
                    const buildingName = resolvedBuildingNames.get(school.id) ?? '';
                    const previous = filtered[rowIndex - 1];
                    const sharesPreviousCell = Boolean(
                      previous
                      && buildingNumber
                      && cellValue(previous, 'م') === buildingNumber
                      && resolvedBuildingNames.get(previous.id) === buildingName,
                    );
                    if (sharesPreviousCell) return null;
                    let rowSpan = 1;
                    while (rowIndex + rowSpan < filtered.length) {
                      const next = filtered[rowIndex + rowSpan];
                      if (!buildingNumber
                        || cellValue(next, 'م') !== buildingNumber
                        || resolvedBuildingNames.get(next.id) !== buildingName) break;
                      rowSpan += 1;
                    }
                    return (
                      <td key={index} rowSpan={rowSpan} style={styleForColumn(index, header, false)} title={buildingName}>
                        {buildingName || displayValue(school.source_columns[index]?.value)}
                      </td>
                    );
                  })() : (
                    <td key={index} style={styleForColumn(index, header, false)} title={displayValue(school.source_columns[index]?.value)}>
                      {displayValue(school.source_columns[index]?.value)}
                    </td>
                  )
                ))}
              </tr>
            ))}</tbody>
          </table>
          {!filtered.length && <p className="p-8 text-center text-sm text-slate-500">لا توجد نتائج مطابقة للفلاتر.</p>}
        </section>
      )}
      {canSync && <p className="text-xs text-slate-500">المزامنة متاحة لمدير النظام، وتُحفظ الصفوف المكررة وسجلات المدارس الغائبة دون حذف.</p>}
    </div>
  );
}

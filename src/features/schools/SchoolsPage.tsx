import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import { Search, Map as MapIcon, List } from 'lucide-react';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import type { UserProfile } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { useDisplayFormat } from '../../app/useDisplayFormat';

const schoolSchema = z.object({
  id: z.string(),
  ministry_number: z.string(),
  school_name: z.string(),
  source_fields: z.record(z.string(), z.unknown()),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  last_synced_at: z.string().nullable(),
});

type School = z.infer<typeof schoolSchema>;

async function loadSchools(): Promise<School[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('schools')
    .select('id,ministry_number,school_name,source_fields,latitude,longitude,last_synced_at')
    .order('school_name');
  if (error) throw error;
  return z.array(schoolSchema).parse(data);
}

function formatField(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '—';
}

export function SchoolsPage({ profile }: { profile: UserProfile | null }) {
  const [search, setSearch] = useState('');
  const [displayMode, setDisplayMode] = useState<'table' | 'map'>('table');
  const { formatNumber, formatDateTime } = useDisplayFormat();
  const { data: schools = [], isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['schools'],
    queryFn: loadSchools,
    enabled: Boolean(supabase && profile),
  });
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return schools.filter((school) =>
      `${school.school_name} ${school.ministry_number}`.toLocaleLowerCase().includes(query),
    );
  }, [schools, search]);
  const missingSchools = schools.filter(
    (school) => school.latitude === null || school.longitude === null,
  );
  const missingCoordinates = missingSchools.length;
  const lastSynced = schools.map((school) => school.last_synced_at).filter(Boolean).sort().at(-1);
  const canSync = profile?.role === 'admin';

  return (
    <div className="grid gap-5">
      <section className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm text-slate-500">مرآة بيانات المصدر، للعرض والبحث</p>
          <h2 className="mt-1 text-2xl font-bold text-brand-900">المباني المدرسية</h2>
        </div>
        {canSync && <Link to="/admin/settings" className="inline-flex items-center justify-center rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-800">إعداد المزامنة</Link>}
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <article className="card p-4"><p className="text-sm text-slate-500">المدارس المعروضة</p><p className="mt-2 text-2xl font-bold text-brand-900">{isLoading ? '…' : formatNumber(schools.length)}</p></article>
        <article className="card p-4"><p className="text-sm text-slate-500">إحداثيات غير متاحة</p><p className="mt-2 text-2xl font-bold text-brand-900">{isLoading ? '…' : formatNumber(missingCoordinates)}</p></article>
        <article className="card p-4"><p className="text-sm text-slate-500">آخر مزامنة مسجلة</p><p className="mt-2 text-sm font-bold text-brand-900">{lastSynced ? formatDateTime(lastSynced) : 'لا توجد مزامنة مسجلة'}</p></article>
      </section>

      <section className="card p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="relative flex-1">
            <Search size={18} className="absolute inset-inline-start-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث باسم المدرسة أو الرقم الوزاري" className="w-full rounded-lg border border-slate-300 py-2.5 pe-3 ps-10" />
          </label>
          <div className="flex rounded-lg border border-slate-200 p-1" role="group" aria-label="طريقة عرض المدارس">
            <button type="button" onClick={() => setDisplayMode('table')} aria-pressed={displayMode === 'table'} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm ${displayMode === 'table' ? 'bg-brand-50 text-brand-800' : 'text-slate-600'}`}><List size={17} /> جدول</button>
            <button type="button" onClick={() => setDisplayMode('map')} aria-pressed={displayMode === 'map'} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm ${displayMode === 'map' ? 'bg-brand-50 text-brand-800' : 'text-slate-600'}`}><MapIcon size={17} /> خريطة</button>
          </div>
        </div>
      </section>

      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">تعذر تحميل المدارس. تحقق من اتصال Supabase وسياسات الوصول.</div>}
      {isLoading || isFetching ? (
        <div role="status" className="card animate-pulse p-8 text-center text-slate-500">جارٍ تحميل المدارس…</div>
      ) : schools.length === 0 ? (
        <div className="card p-8 text-center">
          <Building2Placeholder />
          <h3 className="mt-3 font-bold text-slate-800">لا توجد مدارس محملة</h3>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-7 text-slate-500">تتطلب المزامنة اسم تبويب المصدر ومطابقة عناوين الحقول الملتبسة. لن تُستخدم الإحداثيات قبل تأكيد اتجاهها.</p>
          <button type="button" onClick={() => void refetch()} className="mt-4 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold">إعادة المحاولة</button>
        </div>
      ) : displayMode === 'map' ? (
        <div className="card p-3">
          <MapContainer center={[24.7136, 46.6753]} zoom={10} scrollWheelZoom className="map-frame" aria-label="خريطة المدارس">
            <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <MarkerClusterGroup>
              {filtered.filter((school) => school.latitude !== null && school.longitude !== null).map((school) => (
                <Marker key={school.id} position={[school.latitude!, school.longitude!]}>
                  <Popup>
                    <strong>{school.school_name}</strong>
                    <p>الرقم الوزاري: {school.ministry_number}</p>
                    {Object.entries(school.source_fields).map(([field, value]) => <p key={field}>{field}: {formatField(value)}</p>)}
                  </Popup>
                </Marker>
              ))}
            </MarkerClusterGroup>
          </MapContainer>
          {missingCoordinates > 0 && <p className="px-2 pt-3 text-sm text-amber-800">{missingCoordinates} مدرسة بلا إحداثيات محفوظة.</p>}
        </div>
      ) : (
        <section className="card table-scroll">
          <table>
            <thead><tr><th>الرقم الوزاري</th><th>اسم المدرسة</th><th>نوع المبنى</th><th>الحي</th><th>عدد الفصول</th><th>مقاول المصاعد</th></tr></thead>
            <tbody>{filtered.map((school) => (
              <tr key={school.id}>
                <td>{school.ministry_number}</td>
                <td className="font-semibold">
                  <details>
                    <summary className="cursor-pointer">{school.school_name}</summary>
                    <dl className="mt-2 grid gap-1 whitespace-normal text-xs font-normal text-slate-600">
                      {Object.entries(school.source_fields).map(([field, value]) => <div key={field}><dt className="inline font-bold">{field}: </dt><dd className="inline">{formatField(value)}</dd></div>)}
                    </dl>
                  </details>
                </td>
                <td>{formatField(school.source_fields['نوع المبنى'])}</td>
                <td>{formatField(school.source_fields['الحي'])}</td>
                <td>{formatField(school.source_fields['عدد الفصول'])}</td>
                <td>{formatField(school.source_fields['مقاول المصاعد'])}</td>
              </tr>
            ))}</tbody>
          </table>
          {filtered.length === 0 && <p className="p-8 text-center text-sm text-slate-500">لا توجد نتائج مطابقة.</p>}
        </section>
      )}
      {missingSchools.length > 0 && schools.length > 0 && (
        <details className="card p-4">
          <summary className="cursor-pointer font-bold text-amber-900">مدارس بإحداثيات ناقصة أو غير صالحة ({missingSchools.length})</summary>
          <ul className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
            {missingSchools.map((school) => <li key={school.id}>{school.school_name} · {school.ministry_number}</li>)}
          </ul>
        </details>
      )}
      {canSync && <p className="text-xs text-slate-500">دورك يسمح بطلب المزامنة؛ لن تبدأ قبل ضبط التبويب والمطابقة المعتمدة.</p>}
    </div>
  );
}

function Building2Placeholder() {
  return <div aria-hidden="true" className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-brand-50 text-brand-700"><Building2Icon /></div>;
}

function Building2Icon() {
  return <span className="text-xl">⌂</span>;
}

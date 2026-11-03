import Papa from 'papaparse';
import { z } from 'zod';
import { supabase } from './supabase';

export const schoolSyncConfigSchema = z.object({
  tabName: z.string().trim().min(1),
  ministryNumberHeader: z.string().trim().min(1),
  schoolNameHeader: z.string().trim().min(1),
  latitudeHeader: z.string().trim().optional(),
  longitudeHeader: z.string().trim().optional(),
  intervalMinutes: z.number().int().min(15).max(1440).default(60),
});

export type SchoolSyncConfig = z.infer<typeof schoolSyncConfigSchema>;

const sheetId = '1RQo06DqRHv24M8bh1CmJbOl4c_GmoLPXKkHK_sVIoI8';
const parseCoordinate = (value: string | undefined, min: number, max: number): number | null => {
  if (!value?.trim()) return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
};

export async function syncSchools(configInput: SchoolSyncConfig): Promise<number> {
  if (!supabase) throw new Error('لم يتم إعداد الاتصال بقاعدة البيانات.');
  const config = schoolSyncConfigSchema.parse(configInput);
  const endpoint = new URL(`https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq`);
  endpoint.searchParams.set('tqx', 'out:csv');
  endpoint.searchParams.set('sheet', config.tabName);
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error(`تعذر جلب ورقة المدارس (HTTP ${response.status}).`);
  const csv = await response.text();
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: 'greedy',
    dynamicTyping: false,
  });
  if (parsed.errors.length) {
    throw new Error(`تعذر تحليل CSV: ${parsed.errors[0].message}`);
  }
  const fields = parsed.meta.fields ?? [];
  for (const header of [config.ministryNumberHeader, config.schoolNameHeader]) {
    if (!fields.includes(header)) throw new Error(`عنوان العمود غير موجود في الورقة: ${header}`);
  }
  if (Boolean(config.latitudeHeader) !== Boolean(config.longitudeHeader)) {
    throw new Error('يجب ضبط عمودي خط العرض والطول معاً أو تركهما فارغين.');
  }
  for (const header of [config.latitudeHeader, config.longitudeHeader]) {
    if (header && !fields.includes(header)) throw new Error(`عنوان عمود الإحداثيات غير موجود: ${header}`);
  }

  const unique = new Map<string, {
    ministry_number: string;
    school_name: string;
    source_fields: Record<string, string>;
    latitude: number | null;
    longitude: number | null;
    last_synced_at: string;
  }>();
  const synchronizedAt = new Date().toISOString();
  for (const row of parsed.data) {
    const ministryNumber = row[config.ministryNumberHeader]?.trim();
    const schoolName = row[config.schoolNameHeader]?.trim();
    if (!ministryNumber || !schoolName) continue;
    if (unique.has(ministryNumber)) throw new Error(`الرقم الوزاري مكرر في المصدر: ${ministryNumber}`);
    unique.set(ministryNumber, {
      ministry_number: ministryNumber,
      school_name: schoolName,
      source_fields: row,
      latitude: config.latitudeHeader ? parseCoordinate(row[config.latitudeHeader], -90, 90) : null,
      longitude: config.longitudeHeader ? parseCoordinate(row[config.longitudeHeader], -180, 180) : null,
      last_synced_at: synchronizedAt,
    });
  }
  if (unique.size === 0) throw new Error('لم يعثر على صفوف مدارس صالحة للمزامنة.');

  const rows = [...unique.values()];
  for (let index = 0; index < rows.length; index += 500) {
    const { error } = await supabase.from('schools').upsert(rows.slice(index, index + 500), {
      onConflict: 'ministry_number',
    });
    if (error) throw new Error(`تعذر حفظ دفعة المدارس ${Math.floor(index / 500) + 1}: ${error.message}`);
  }
  const { error: auditError } = await supabase.rpc('audit_school_sync', { p_record_count: unique.size });
  if (auditError) throw new Error(`تم حفظ المدارس، لكن تعذر تسجيل عملية المزامنة: ${auditError.message}`);
  return unique.size;
}

export async function runThrottledSchoolSync(): Promise<number | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('app_settings').select('value').eq('key', 'school_sync').maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const config = schoolSyncConfigSchema.parse(data.value);
  const { data: latest, error: latestError } = await supabase
    .from('schools')
    .select('last_synced_at')
    .not('last_synced_at', 'is', null)
    .order('last_synced_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) throw latestError;
  const lastSyncedAt = latest?.last_synced_at;
  const elapsedMinutes = lastSyncedAt
    ? (Date.now() - new Date(lastSyncedAt).getTime()) / 60_000
    : Number.POSITIVE_INFINITY;
  if (elapsedMinutes < config.intervalMinutes) return null;
  return syncSchools(config);
}

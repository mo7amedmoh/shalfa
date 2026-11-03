import Papa from 'papaparse';
import { z } from 'zod';
import { parseClassCount } from '../domain/staffing';
import { mapSchoolContactColumns, schoolContactsExtraKey } from '../domain/schoolContacts';
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
export type SchoolSyncResult = {
  syncedCount: number;
  duplicateCount: number;
};

const sheetId = '1RQo06DqRHv24M8bh1CmJbOl4c_GmoLPXKkHK_sVIoI8';
type SyncedSchool = {
  ministry_no: string;
  name: string;
  extra: Record<string, unknown>;
  size_source: 'small' | 'medium' | 'large' | null;
  class_count: number | null;
  lat: number | null;
  lng: number | null;
  synced_at: string;
};

export function normalizeSheetSchoolSize(value: unknown): 'small' | 'medium' | 'large' | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLocaleUpperCase();
  if (normalized === 'S') return 'small';
  if (normalized === 'M') return 'medium';
  if (normalized === 'L') return 'large';
  return null;
}

function sourceFieldsFromColumns(headers: readonly string[], values: readonly string[]): Record<string, unknown> {
  const occurrences = new Map<string, number>();
  const sourceFields: Record<string, unknown> = {};
  headers.forEach((rawHeader, index) => {
    const header = rawHeader.trim();
    const key = header || `column_${index + 1}`;
    const occurrence = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, occurrence);
    sourceFields[occurrence === 1 ? key : `${key}_${occurrence}`] = values[index]?.trim() ?? '';
  });
  sourceFields[schoolContactsExtraKey] = mapSchoolContactColumns(headers, values);
  return sourceFields;
}

export function deduplicateSchoolRows(rows: SyncedSchool[]): { rows: SyncedSchool[]; duplicateCount: number } {
  const unique = new Map<string, SyncedSchool>();
  let duplicateCount = 0;
  for (const row of rows) {
    if (unique.has(row.ministry_no)) {
      duplicateCount += 1;
      continue;
    }
    unique.set(row.ministry_no, row);
  }
  return { rows: [...unique.values()], duplicateCount };
}

const parseCoordinate = (value: string | undefined, min: number, max: number): number | null => {
  if (!value?.trim()) return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
};

export async function syncSchools(configInput: SchoolSyncConfig): Promise<SchoolSyncResult> {
  if (!supabase) throw new Error('لم يتم إعداد الاتصال بقاعدة البيانات.');
  const config = schoolSyncConfigSchema.parse(configInput);
  const endpoint = new URL(`https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq`);
  endpoint.searchParams.set('tqx', 'out:csv');
  endpoint.searchParams.set('sheet', config.tabName);
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error(`تعذر جلب ورقة المدارس (HTTP ${response.status}).`);
  const csv = await response.text();
  const parsed = Papa.parse<string[]>(csv, {
    header: false,
    skipEmptyLines: 'greedy',
    dynamicTyping: false,
  });
  if (parsed.errors.length) {
    throw new Error(`تعذر تحليل CSV: ${parsed.errors[0].message}`);
  }
  const [rawHeaders = [], ...sourceRows] = parsed.data;
  const headers = rawHeaders.map((header) => String(header ?? '').trim());
  for (const header of [config.ministryNumberHeader, config.schoolNameHeader]) {
    if (!headers.includes(header)) throw new Error(`عنوان العمود غير موجود في الورقة: ${header}`);
  }
  if (Boolean(config.latitudeHeader) !== Boolean(config.longitudeHeader)) {
    throw new Error('يجب ضبط عمودي خط العرض والطول معاً أو تركهما فارغين.');
  }
  for (const header of [config.latitudeHeader, config.longitudeHeader]) {
    if (header && !headers.includes(header)) throw new Error(`عنوان عمود الإحداثيات غير موجود: ${header}`);
  }
  const columnIndex = (header: string) => headers.indexOf(header);
  const ministryNumberIndex = columnIndex(config.ministryNumberHeader);
  const schoolNameIndex = columnIndex(config.schoolNameHeader);
  const sizeHeaderIndex = headers.findIndex((header) => header.trim().toLocaleLowerCase() === 'حجم المدرسة');
  const classCountHeaderIndex = headers.findIndex((header) => header.trim().toLocaleLowerCase() === 'عدد الفصول');

  const syncRows: SyncedSchool[] = [];
  const synchronizedAt = new Date().toISOString();
  for (const row of sourceRows) {
    const values = row.map((value) => String(value ?? ''));
    const ministryNumber = values[ministryNumberIndex]?.trim();
    const schoolName = values[schoolNameIndex]?.trim();
    if (!ministryNumber || !schoolName) continue;
    syncRows.push({
      ministry_no: ministryNumber,
      name: schoolName,
      extra: sourceFieldsFromColumns(headers, values),
      size_source: sizeHeaderIndex < 0 ? null : normalizeSheetSchoolSize(values[sizeHeaderIndex]),
      class_count: classCountHeaderIndex < 0 ? null : parseClassCount(values[classCountHeaderIndex]),
      lat: config.latitudeHeader ? parseCoordinate(values[columnIndex(config.latitudeHeader)], -90, 90) : null,
      lng: config.longitudeHeader ? parseCoordinate(values[columnIndex(config.longitudeHeader)], -180, 180) : null,
      synced_at: synchronizedAt,
    });
  }
  const { rows, duplicateCount } = deduplicateSchoolRows(syncRows);
  if (rows.length === 0) throw new Error('لم يعثر على صفوف مدارس صالحة للمزامنة.');

  for (let index = 0; index < rows.length; index += 500) {
    const { error } = await supabase.from('schools').upsert(rows.slice(index, index + 500), {
      onConflict: 'ministry_no',
    });
    if (error) throw new Error(`تعذر حفظ دفعة المدارس ${Math.floor(index / 500) + 1}: ${error.message}`);
  }
  return { syncedCount: rows.length, duplicateCount };
}

export async function runThrottledSchoolSync(): Promise<SchoolSyncResult | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('app_config').select('value').eq('key', 'school_sync').maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const config = schoolSyncConfigSchema.parse(data.value);
  const { data: latest, error: latestError } = await supabase
    .from('schools')
    .select('synced_at')
    .not('synced_at', 'is', null)
    .order('synced_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) throw latestError;
  const lastSyncedAt = latest?.synced_at;
  const elapsedMinutes = lastSyncedAt
    ? (Date.now() - new Date(lastSyncedAt).getTime()) / 60_000
    : Number.POSITIVE_INFINITY;
  if (elapsedMinutes < config.intervalMinutes) return null;
  return syncSchools(config);
}

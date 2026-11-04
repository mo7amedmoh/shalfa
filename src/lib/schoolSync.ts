import * as XLSX from 'xlsx';
import { z } from 'zod';
import { parseClassCount } from '../domain/staffing';
import { mapSchoolContactColumns, schoolContactsExtraKey } from '../domain/schoolContacts';
import { normalizeMinistryNumber } from '../domain/imports';
import { supabase } from './supabase';
import { APP_SCHEMA_SELECT } from './schemaColumns';

export const schoolSyncConfigSchema = z.object({
  tabName: z.string().trim().min(1),
  ministryNumberHeader: z.string().trim().min(1),
  schoolNameHeader: z.string().trim().min(1),
  latitudeHeader: z.string().trim().optional(),
  longitudeHeader: z.string().trim().optional(),
  intervalMinutes: z.number().int().min(15).max(1440).default(60),
});

export type SchoolSyncConfig = z.infer<typeof schoolSyncConfigSchema>;
export type DuplicateMinistryNumber = { ministryNumber: string; rows: number[] };
export type SchoolSyncResult = {
  inserted: number;
  updated: number;
  sourceRows: number;
  skippedRows: {
    total: number;
    missingMinistryNumber: number;
    ministryNumberColumn: { position: number; header: string };
    missingMinistryNumberRows: Array<{
      sourceRow: number;
      schoolName: string;
      nearbyCells: Array<{ position: number; header: string; value: string }>;
    }>;
    missingSchoolName: number;
  };
  duplicatesWarned: number;
  duplicateNumbers: DuplicateMinistryNumber[];
  flaggedMissing: number;
  invalidCoordinates: number;
};

const sheetId = '1RQo06DqRHv24M8bh1CmJbOl4c_GmoLPXKkHK_sVIoI8';
export type SourceColumn = { header: string; value: string };
type SyncedSchool = {
  ministry_no: string;
  source_key: string;
  source_row: number;
  source_columns: SourceColumn[];
  building_type: string | null;
  plan_scope: boolean;
  has_elevator_contractor: boolean;
  name: string;
  extra: Record<string, unknown>;
  size_source: 'small' | 'medium' | 'large' | null;
  class_count: number | null;
  lat: number | null;
  lng: number | null;
  synced_at: string;
  missing_from_sheet_at: null;
};

export function normalizeSheetSchoolSize(value: unknown): 'small' | 'medium' | 'large' | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLocaleUpperCase();
  if (normalized === 'S') return 'small';
  if (normalized === 'M') return 'medium';
  if (normalized === 'L') return 'large';
  return null;
}

function normalizeDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0));
}

function normalizedText(value: unknown): string {
  return typeof value === 'string'
    ? normalizeDigits(value).trim().replace(/[أإآ]/g, 'ا').replace(/\s+/g, ' ').toLocaleLowerCase()
    : '';
}

export function normalizeRiyadhCoordinates(
  latitudeValue: string | undefined,
  longitudeValue: string | undefined,
): { lat: number | null; lng: number | null; valid: boolean } {
  const parse = (value: string | undefined) => {
    if (!value?.trim()) return null;
    const text = normalizeDigits(value).trim().replace(/\s+/g, '').replace(',', '.');
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
  };
  let lat = parse(latitudeValue);
  let lng = parse(longitudeValue);
  if (lat === null || lng === null) return { lat: null, lng: null, valid: false };

  const isRiyadhLatitude = (value: number) => value >= 24 && value <= 25.5;
  const isRiyadhLongitude = (value: number) => value >= 46 && value <= 47.5;
  if (isRiyadhLongitude(lat) && isRiyadhLatitude(lng)) [lat, lng] = [lng, lat];
  if (!isRiyadhLatitude(lat) || !isRiyadhLongitude(lng)) return { lat: null, lng: null, valid: false };
  return { lat, lng, valid: true };
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

export function parseSchoolWorkbook(
  workbookData: ArrayBuffer,
  tabName: string,
): { headers: string[]; rows: string[][] } {
  const workbook = XLSX.read(workbookData, { type: 'array' });
  const sheet = workbook.Sheets[tabName];
  if (!sheet) throw new Error(`تعذر العثور على تبويب المدارس في ملف المصدر: ${tabName}`);
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: true,
  });
  const [rawHeaders = [], ...rawRows] = matrix;
  const toText = (value: unknown) => String(value ?? '').trim();
  return {
    headers: rawHeaders.map(toText),
    rows: rawRows.map((row) => row.map(toText)),
  };
}

export function prepareSchoolRows(
  headers: readonly string[],
  sourceRows: readonly (readonly string[])[],
  config: SchoolSyncConfig,
  synchronizedAt: string,
): {
  rows: SyncedSchool[];
  duplicateNumbers: DuplicateMinistryNumber[];
  invalidCoordinates: number;
  sourceRows: number;
  skippedRows: SchoolSyncResult['skippedRows'];
} {
  const columnIndex = (header: string) => headers.indexOf(header);
  const ministryNumberIndex = columnIndex(config.ministryNumberHeader);
  const schoolNameIndex = columnIndex(config.schoolNameHeader);
  const sizeHeaderIndex = headers.findIndex((header) => normalizedText(header) === normalizedText('حجم المدرسة'));
  const classCountHeaderIndex = headers.findIndex((header) => normalizedText(header) === normalizedText('عدد الفصول'));
  const buildingTypeIndex = headers.findIndex((header) => normalizedText(header) === normalizedText('نوع المبنى'));
  const elevatorContractorIndex = headers.findIndex((header) => normalizedText(header) === normalizedText('مقاول المصاعد'));
  const occurrences = new Map<string, number>();
  const duplicateRows = new Map<string, number[]>();
  const rows: SyncedSchool[] = [];
  let invalidCoordinates = 0;
  let processedSourceRows = 0;
  const skippedRows: SchoolSyncResult['skippedRows'] = {
    total: 0,
    missingMinistryNumber: 0,
    ministryNumberColumn: {
      position: ministryNumberIndex + 1,
      header: headers[ministryNumberIndex] ?? config.ministryNumberHeader,
    },
    missingMinistryNumberRows: [],
    missingSchoolName: 0,
  };
  for (const [sourceIndex, rawValues] of sourceRows.entries()) {
    const values = rawValues.map((value) => String(value ?? ''));
    if (values.every((value) => !value.trim())) continue;
    processedSourceRows += 1;
    const sourceRow = sourceIndex + 2;
    const ministryNumber = values[ministryNumberIndex]?.trim();
    const schoolName = values[schoolNameIndex]?.trim();
    if (!ministryNumber || !schoolName) {
      skippedRows.total += 1;
      if (!ministryNumber) {
        skippedRows.missingMinistryNumber += 1;
        const nearbyCells = headers
          .map((header, index) => ({ header, index, value: values[index]?.trim() ?? '' }))
          .filter(({ index }) => Math.abs(index - ministryNumberIndex) <= 2)
          .map(({ header, index, value }) => ({ position: index + 1, header, value }));
        skippedRows.missingMinistryNumberRows.push({
          sourceRow,
          schoolName: schoolName ?? '',
          nearbyCells,
        });
      }
      if (!schoolName) skippedRows.missingSchoolName += 1;
      continue;
    }
    const normalizedMinistryNumber = normalizeMinistryNumber(ministryNumber);
    const occurrence = (occurrences.get(normalizedMinistryNumber) ?? 0) + 1;
    occurrences.set(normalizedMinistryNumber, occurrence);
    if (occurrence > 1) {
      const duplicate = duplicateRows.get(normalizedMinistryNumber) ?? [
        rows.find((candidate) => candidate.source_key === `${normalizedMinistryNumber}#1`)!.source_row,
      ];
      duplicate.push(sourceRow);
      duplicateRows.set(normalizedMinistryNumber, duplicate);
    }
    const sourceColumns = headers.map((header, index) => ({ header, value: values[index] ?? '' }));
    const extra = sourceFieldsFromColumns(headers, values);
    const coordinate = normalizeRiyadhCoordinates(
      config.latitudeHeader ? values[columnIndex(config.latitudeHeader)] : undefined,
      config.longitudeHeader ? values[columnIndex(config.longitudeHeader)] : undefined,
    );
    if (!coordinate.valid) invalidCoordinates += 1;
    const buildingType = values[buildingTypeIndex]?.trim() ?? '';
    const elevatorContractor = values[elevatorContractorIndex];
    rows.push({
      ministry_no: ministryNumber,
      source_key: `${normalizedMinistryNumber}#${occurrence}`,
      source_row: sourceRow,
      source_columns: sourceColumns,
      building_type: buildingType || null,
      plan_scope: ['مستقل', 'مشترك اساسي'].includes(normalizedText(buildingType)),
      has_elevator_contractor: Boolean(normalizedText(elevatorContractor) && normalizedText(elevatorContractor) !== normalizedText('لا ينطبق')),
      name: schoolName,
      extra,
      size_source: sizeHeaderIndex < 0 ? null : normalizeSheetSchoolSize(values[sizeHeaderIndex]),
      class_count: classCountHeaderIndex < 0 ? null : parseClassCount(values[classCountHeaderIndex]),
      lat: coordinate.lat,
      lng: coordinate.lng,
      synced_at: synchronizedAt,
      missing_from_sheet_at: null,
    });
  }
  const duplicateNumbers = [...duplicateRows.entries()].map(([ministryNumber, rows]) => ({ ministryNumber, rows }));
  return { rows, duplicateNumbers, invalidCoordinates, sourceRows: processedSourceRows, skippedRows };
}

export function getMissingMinistryNumbersError(
  skippedRows: SchoolSyncResult['skippedRows'],
): Error | null {
  const missingRows = skippedRows.missingMinistryNumberRows;
  if (!missingRows.length) return null;
  const rowNumbers = missingRows.map(({ sourceRow }) => sourceRow).join('، ');
  return new Error(
    `أُوقفت المزامنة قبل حفظ أي تغييرات: لم يتضمن ملف المصدر أرقاماً وزارية في ${missingRows.length} صفاً (${rowNumbers}). تحقق من بيانات المصدر ثم أعد المحاولة.`,
  );
}

export async function syncSchools(configInput: SchoolSyncConfig): Promise<SchoolSyncResult> {
  if (!supabase) throw new Error('لم يتم إعداد الاتصال بقاعدة البيانات.');
  const config = schoolSyncConfigSchema.parse(configInput);
  const endpoint = new URL(`https://docs.google.com/spreadsheets/d/${sheetId}/export`);
  endpoint.searchParams.set('format', 'xlsx');
  endpoint.searchParams.set('cacheBust', String(Date.now()));
  const response = await fetch(endpoint, { cache: 'no-store' });
  if (!response.ok) throw new Error(`تعذر جلب ملف المدارس بصيغة Excel (HTTP ${response.status}).`);
  const { headers, rows: parsedSourceRows } = parseSchoolWorkbook(await response.arrayBuffer(), config.tabName);
  for (const header of [config.ministryNumberHeader, config.schoolNameHeader]) {
    if (!headers.includes(header)) throw new Error(`عنوان العمود غير موجود في الورقة: ${header}`);
  }
  if (Boolean(config.latitudeHeader) !== Boolean(config.longitudeHeader)) {
    throw new Error('يجب ضبط عمودي خط العرض والطول معاً أو تركهما فارغين.');
  }
  for (const header of [config.latitudeHeader, config.longitudeHeader]) {
    if (header && !headers.includes(header)) throw new Error(`عنوان عمود الإحداثيات غير موجود: ${header}`);
  }
  const synchronizedAt = new Date().toISOString();
  const prepared = prepareSchoolRows(headers, parsedSourceRows, config, synchronizedAt);
  const { rows: syncRows, duplicateNumbers, invalidCoordinates, sourceRows: sourceRowCount, skippedRows } = prepared;
  const missingNumbersError = getMissingMinistryNumbersError(skippedRows);
  if (missingNumbersError) {
    throw new Error(
      `تعذر استيراد بعض الأرقام الوزارية من ملف Excel. ${missingNumbersError.message}`,
    );
  }
  if (syncRows.length === 0) throw new Error('لم يعثر على صفوف مدارس صالحة للمزامنة.');

  const existing: Array<{ id: string; source_key: string; missing_from_sheet_at: string | null }> = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from('schools')
      .select(APP_SCHEMA_SELECT.schoolsSyncState)
      .range(offset, offset + 999);
    if (error) throw new Error(`تعذر قراءة مفاتيح المدارس قبل المزامنة: ${error.message}`);
    existing.push(...data);
    if (data.length < 1000) break;
  }
  const existingByKey = new Map(existing.map((school) => [school.source_key, school]));
  const currentKeys = new Set(syncRows.map((school) => school.source_key));
  const inserted = syncRows.filter((school) => !existingByKey.has(school.source_key)).length;
  const updated = syncRows.length - inserted;

  for (let index = 0; index < syncRows.length; index += 500) {
    const { error } = await supabase.from('schools').upsert(syncRows.slice(index, index + 500), {
      onConflict: 'source_key',
    });
    if (error) throw new Error(`تعذر حفظ دفعة المدارس ${Math.floor(index / 500) + 1}: ${error.message}`);
  }
  const missingRows = existing.filter((school) => !currentKeys.has(school.source_key) && !school.missing_from_sheet_at);
  for (let index = 0; index < missingRows.length; index += 500) {
    const { error } = await supabase.from('schools')
      .update({ missing_from_sheet_at: synchronizedAt })
      .in('id', missingRows.slice(index, index + 500).map(({ id }) => id));
    if (error) throw new Error(`تعذر تعليم المدارس الغائبة من المصدر: ${error.message}`);
  }
  return {
    inserted,
    updated,
    sourceRows: sourceRowCount,
    skippedRows,
    duplicatesWarned: duplicateNumbers.reduce((count, duplicate) => count + duplicate.rows.length - 1, 0),
    duplicateNumbers,
    flaggedMissing: missingRows.length,
    invalidCoordinates,
  };
}

export async function runThrottledSchoolSync(): Promise<SchoolSyncResult | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('app_config').select(APP_SCHEMA_SELECT.appConfigValue).eq('key', 'school_sync').maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const config = schoolSyncConfigSchema.parse(data.value);
  const { data: latest, error: latestError } = await supabase
    .from('schools')
    .select(APP_SCHEMA_SELECT.schoolsSyncTime)
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

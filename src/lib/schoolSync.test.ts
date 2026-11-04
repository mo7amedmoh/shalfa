import { describe, expect, it } from 'vitest';
import { normalizeRiyadhCoordinates, normalizeSheetSchoolSize, prepareSchoolRows, type SchoolSyncConfig } from './schoolSync';

const headers = [
  'الرقم الوزاري',
  'اسم المدرسة',
  'نوع المبنى',
  'مقاول المصاعد',
  'عدد الفصول',
  'حجم المدرسة',
  'الشماليات',
  'الشرقيات',
  'رقم الاتصال',
  'رقم الاتصال',
  'رقم الاتصال',
  'رقم الاتصال',
  'رقم الاتصال',
  'رقم التواصل',
];
const config: SchoolSyncConfig = {
  tabName: 'مدارس',
  ministryNumberHeader: 'الرقم الوزاري',
  schoolNameHeader: 'اسم المدرسة',
  latitudeHeader: 'الشماليات',
  longitudeHeader: 'الشرقيات',
  intervalMinutes: 60,
};
const row = (ministry: string, name: string, type = 'مستقل', size = 'M', lat = '24.7', lng = '46.6') => [
  ministry, name, type, 'شركة', '١٣', size, lat, lng, '1', '2', '3', '4', '5', '6',
];

describe('normalizeSheetSchoolSize', () => {
  it.each([
    ['S', 'small'],
    [' s ', 'small'],
    ['M', 'medium'],
    [' m ', 'medium'],
    ['L', 'large'],
    [' l ', 'large'],
  ] as const)('normalizes %s to %s', (value, size) => {
    expect(normalizeSheetSchoolSize(value)).toBe(size);
  });

  it('does not infer a size from unrecognized values', () => {
    expect(normalizeSheetSchoolSize('XL')).toBeNull();
    expect(normalizeSheetSchoolSize(null)).toBeNull();
  });
});

describe('Riyadh school coordinates', () => {
  it('parses Arabic digits and decimal commas and swaps clearly reversed coordinates', () => {
    expect(normalizeRiyadhCoordinates('٤٦,٦٤٥٣٨', '٢٤,٦٩١١')).toEqual({
      lat: 24.6911,
      lng: 46.64538,
      valid: true,
    });
  });

  it('rejects missing and out-of-Riyadh coordinates', () => {
    expect(normalizeRiyadhCoordinates('', '46.6').valid).toBe(false);
    expect(normalizeRiyadhCoordinates('33.5', '-112.1')).toEqual({ lat: null, lng: null, valid: false });
  });
});

describe('prepareSchoolRows', () => {
  it('imports all duplicate ministry rows with occurrence keys and ordered columns', () => {
    const prepared = prepareSchoolRows(headers, [
      row('95183', 'المدرسة الأولى'),
      row('95183', 'المدرسة الثانية', 'مشترك ملحق', 's', '٢٤,٧', '٤٦,٦'),
      row('95184', 'مدرسة ثالثة', 'مشترك أساسي', 'L'),
    ], config, '2026-11-04T00:00:00.000Z');

    expect(prepared.rows).toHaveLength(3);
    expect(prepared.rows.map(({ source_key }) => source_key)).toEqual(['95183#1', '95183#2', '95184#1']);
    expect(prepared.duplicateNumbers).toEqual([{ ministryNumber: '95183', rows: [2, 3] }]);
    expect(prepared.invalidCoordinates).toBe(0);
    expect(prepared.rows[0].source_columns.slice(8)).toEqual(headers.slice(8).map((header, index) => ({
      header,
      value: String(index + 1),
    })));
    expect(prepared.rows[0]).toMatchObject({ class_count: 13, size_source: 'medium', plan_scope: true, has_elevator_contractor: true });
    expect(prepared.rows[1]).toMatchObject({ plan_scope: false, size_source: 'small' });
    expect(prepared.rows[2]).toMatchObject({ plan_scope: true, size_source: 'large' });
  });

  it('counts schools with invalid coordinates without dropping their records', () => {
    const prepared = prepareSchoolRows(headers, [row('95183', 'مدرسة', 'مستقل', 'M', '', '')], config, 'now');
    expect(prepared.rows).toHaveLength(1);
    expect(prepared.invalidCoordinates).toBe(1);
    expect(prepared.rows[0]).toMatchObject({ lat: null, lng: null });
  });

  it('normalizes Arabic-Indic digits when deriving duplicate source keys', () => {
    const prepared = prepareSchoolRows(headers, [
      row('٩٥١٨٣', 'مدرسة بالأرقام العربية'),
      row('95183', 'مدرسة بالأرقام اللاتينية'),
    ], config, 'now');
    expect(prepared.rows.map(({ source_key }) => source_key)).toEqual(['95183#1', '95183#2']);
    expect(prepared.duplicateNumbers).toEqual([{ ministryNumber: '95183', rows: [2, 3] }]);
  });
});

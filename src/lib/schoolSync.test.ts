import { describe, expect, it } from 'vitest';
import {
  getMissingMinistryNumbersError,
  matchExistingSchoolSyncRows,
  normalizeRiyadhCoordinates,
  normalizeSheetSchoolSize,
  parseSchoolWorkbook,
  prepareSchoolRows,
  type SchoolSyncConfig,
  type SchoolSyncResult,
} from './schoolSync';
import * as XLSX from 'xlsx';

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

  it('counts source rows omitted for missing identifiers or names', () => {
    const prepared = prepareSchoolRows(headers, [
      row('95183', 'مدرسة'),
      row('', 'بلا رقم وزاري'),
      row('95184', ''),
      row('', ''),
    ], config, 'now');
    expect(prepared.rows).toHaveLength(1);
    expect(prepared.skippedRows).toEqual({
      total: 3,
      missingMinistryNumber: 2,
      ministryNumberColumn: { position: 1, header: 'الرقم الوزاري' },
      missingMinistryNumberRows: [
        {
          sourceRow: 3,
          schoolName: 'بلا رقم وزاري',
          nearbyCells: [
            { position: 1, header: 'الرقم الوزاري', value: '' },
            { position: 2, header: 'اسم المدرسة', value: 'بلا رقم وزاري' },
            { position: 3, header: 'نوع المبنى', value: 'مستقل' },
          ],
        },
        {
          sourceRow: 5,
          schoolName: '',
          nearbyCells: [
            { position: 1, header: 'الرقم الوزاري', value: '' },
            { position: 2, header: 'اسم المدرسة', value: '' },
            { position: 3, header: 'نوع المبنى', value: 'مستقل' },
          ],
        },
      ],
      missingSchoolName: 2,
    });
  });

  describe('school sync preflight', () => {
    it('blocks partial syncs when source rows have missing ministry numbers', () => {
      const skippedRows: SchoolSyncResult['skippedRows'] = {
        total: 1,
        missingMinistryNumber: 1,
        ministryNumberColumn: { position: 3, header: 'الرقم الوزاري' },
        missingMinistryNumberRows: [{
          sourceRow: 37,
          schoolName: 'ثانوية زهير بن قيس - نظام مقررات',
          nearbyCells: [],
        }],
        missingSchoolName: 0,
      };
      const error = getMissingMinistryNumbersError(skippedRows);
      expect(error?.message).toContain('أُوقفت المزامنة قبل حفظ أي تغييرات');
      expect(error?.message).toContain('37');
    });

    it('allows syncs when every source row has a ministry number', () => {
      const skippedRows: SchoolSyncResult['skippedRows'] = {
        total: 0,
        missingMinistryNumber: 0,
        ministryNumberColumn: { position: 3, header: 'الرقم الوزاري' },
        missingMinistryNumberRows: [],
        missingSchoolName: 0,
      };
      expect(getMissingMinistryNumbersError(skippedRows)).toBeNull();
    });
  });

  describe('parseSchoolWorkbook', () => {
    it('preserves mixed text and numeric ministry numbers and blank physical rows', async () => {
      const workbook = XLSX.utils.book_new();
      const sheet = XLSX.utils.aoa_to_sheet([
        ['الرقم الوزاري', 'اسم المدرسة'],
        [195866, 'الابتدائية'],
        ['M110179', 'ثانوية زهير بن قيس'],
        ['', ''],
        [195452, 'ثانوية طرفة'],
      ]);
      XLSX.utils.book_append_sheet(workbook, sheet, 'قاعدة بيانات المدارس');
      const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;

      const parsed = await parseSchoolWorkbook(bytes, 'قاعدة بيانات المدارس');
      expect(parsed.headers).toEqual(['الرقم الوزاري', 'اسم المدرسة']);
      expect(parsed.rows).toEqual([
        ['195866', 'الابتدائية'],
        ['M110179', 'ثانوية زهير بن قيس'],
        ['', ''],
        ['195452', 'ثانوية طرفة'],
      ]);
    });

    it('reports an error when the requested sheet is not present', async () => {
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['header']]), 'Other');
      const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
      await expect(parseSchoolWorkbook(bytes, 'قاعدة بيانات المدارس'))
        .rejects.toThrow('تعذر العثور على تبويب المدارس في ملف المصدر');
    });
  });

  it('keeps physical sheet row numbers correct when blank rows are present', () => {
    const prepared = prepareSchoolRows(headers, [
      row('95183', 'المدرسة الأولى'),
      ['', '', '', '', '', '', '', '', '', '', '', '', '', ''],
      row('', 'بلا رقم بعد صف فارغ'),
    ], config, 'now');

    expect(prepared.sourceRows).toBe(2);
    expect(prepared.skippedRows.missingMinistryNumberRows).toEqual([
      {
        sourceRow: 4,
        schoolName: 'بلا رقم بعد صف فارغ',
        nearbyCells: [
          { position: 1, header: 'الرقم الوزاري', value: '' },
          { position: 2, header: 'اسم المدرسة', value: 'بلا رقم بعد صف فارغ' },
          { position: 3, header: 'نوع المبنى', value: 'مستقل' },
        ],
      },
    ]);
  });

  it('normalizes Arabic-Indic digits when deriving duplicate source keys', () => {
    const prepared = prepareSchoolRows(headers, [
      row('٩٥١٨٣', 'مدرسة بالأرقام العربية'),
      row('95183', 'مدرسة بالأرقام اللاتينية'),
    ], config, 'now');
    expect(prepared.rows.map(({ source_key }) => source_key)).toEqual(['95183#1', '95183#2']);
    expect(prepared.duplicateNumbers).toEqual([{ ministryNumber: '95183', rows: [2, 3] }]);
  });

  it('groups ministry numbers that differ only by M prefixes and leading zeroes', () => {
    const prepared = prepareSchoolRows(headers, [
      row('M010801', 'مدرسة'),
      row('10801', 'مدرسة أخرى'),
    ], config, 'now');

    expect(prepared.rows.map(({ source_key }) => source_key)).toEqual(['10801#1', '10801#2']);
    expect(prepared.duplicateNumbers).toEqual([{ ministryNumber: '10801', rows: [2, 3] }]);
  });

  it('adopts an existing row using its old-format M-prefixed key', () => {
    const prepared = prepareSchoolRows(headers, [row('M010801', 'مدرسة تجريبية')], config, 'now');
    const result = matchExistingSchoolSyncRows(prepared.rows, [{
      id: 'existing-id',
      source_key: 'm010801#1',
      ministry_no: 'M010801',
      name: 'مدرسة تجريبية',
      source_row: 42,
      missing_from_sheet_at: '2026-11-08T00:00:00.000Z',
    }]);

    expect(prepared.rows[0].source_key).toBe('10801#1');
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].existing.id).toBe('existing-id');
    expect(result.ambiguous).toHaveLength(0);
  });

  it('does not silently insert a row when normalized identity matches multiple existing schools', () => {
    const prepared = prepareSchoolRows(headers, [row('95183', 'مدرسة مكررة')], config, 'now');
    const existing = ['one', 'two'].map((id) => ({
      id,
      source_key: `legacy-${id}`,
      ministry_no: 'M095183',
      name: 'مَدْرَسَة مكررة',
      source_row: id === 'one' ? 117 : 118,
      missing_from_sheet_at: '2026-11-08T00:00:00.000Z',
    }));

    const result = matchExistingSchoolSyncRows(prepared.rows, existing);
    expect(result.matches).toHaveLength(0);
    expect(result.ambiguous).toHaveLength(1);
    expect(result.ambiguous[0].candidates.map(({ id }) => id)).toEqual(['one', 'two']);
  });

  it('keeps X0 as a literal ministry number for the attached-school row', () => {
    const prepared = prepareSchoolRows(headers, [row('X0', 'الروضة الملحقة بالابتدائية 105', 'مشترك ملحق')], config, 'now');

    expect(prepared.rows[0]).toMatchObject({
      ministry_no: 'X0',
      source_key: 'x0#1',
      plan_scope: false,
    });
  });
});

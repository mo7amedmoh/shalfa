import { describe, expect, it } from 'vitest';
import {
  autoDetectImportColumns,
  matchImportEmployees,
  normalizeImportName,
  normalizeMinistryNumber,
  normalizePhone,
  parseImportDate,
  parseImportInteger,
  parseMonthlyPlanRows,
} from './imports';

describe('import value normalization', () => {
  it('normalizes Arabic-Indic ministry numbers', () => {
    expect(normalizeMinistryNumber(' ٩٥١ ٨٣ ')).toBe('95183');
    expect(normalizeMinistryNumber('')).toBe('');
  });

  it('matches name variants without treating distinct full names as identical', () => {
    expect(normalizeImportName(' مُشْرِف تجريبي ')).toBe(normalizeImportName('مشرف تجريبي'));
    expect(normalizeImportName('أ ب')).toBe(normalizeImportName('ا ب'));
    expect(normalizeImportName('موظف')).not.toBe(normalizeImportName('موظف تجريبي'));
  });

  it('resolves a remembered alias before exact-name matching', () => {
    const employees = [
      { id: 'one', full_name: 'مشرف تجريبي' },
      { id: 'two', full_name: 'مهندس افتراضي' },
    ];
    expect(matchImportEmployees('بديل تجريبي', employees, [
      { alias_normalised: normalizeImportName('بديل تجريبي'), employee_id: 'one' },
    ])).toEqual([employees[0]]);
    expect(matchImportEmployees('مشرف تجريبي ', employees, [])).toEqual([employees[0]]);
  });

  it.each([
    ['05 1234 5678', '+966512345678', true],
    ['+966 5 1234 5678', '+966512345678', true],
    ['٥١٢٣٤٥٦٧٨', '+966512345678', true],
    ['12345', null, false],
  ] as const)('normalizes phone %s', (input, phone, valid) => {
    expect(normalizePhone(input)).toEqual({ phone, valid });
  });

  it('parses non-negative integer cells with Arabic-Indic digits', () => {
    expect(parseImportInteger('١٢')).toBe(12);
    expect(parseImportInteger('0')).toBe(0);
    expect(parseImportInteger('-1')).toBeNull();
    expect(parseImportInteger('١٫٥')).toBeNull();
  });
});

describe('import date parsing', () => {
  it('parses Excel serial dates and common text formats', () => {
    expect(parseImportDate(46300)).toBe('2026-10-05');
    expect(parseImportDate('٥/١١/٢٠٢٦')).toBe('2026-11-05');
    expect(parseImportDate('2026-11-05')).toBe('2026-11-05');
    expect(parseImportDate('31/02/2026')).toBeNull();
    expect(parseImportDate('')).toBeNull();
  });
});

describe('monthly plan workbook parser', () => {
  it('parses an anonymized monthly source sample and detects Arabic headers', () => {
    const headers = [
      'الرقم الوزاري',
      'تصنيف الوحدة',
      'مهندس المرافق مقاول الباطن',
      'تاريخ الصيانة',
      'مشرف الصيانة',
      'تاريخ التكييف',
      'مشرف التكييف',
      'تاريخ النظافة',
      'مشرف النظافة',
      'تاريخ الأمن و السلامة',
      'شركة الأمن و السلامة',
      'تاريخ المصاعد',
      'شركة المصاعد',
      'تاريخ توريد المياه',
      'عدد الردود',
      'ملاحظات توريد مياة',
      'تاريخ النزح',
      'عدد الردود',
      'ملاحظات النزح',
    ];
    const rows = parseMonthlyPlanRows(headers, [[
      '000123', 'مستقل', 'مهندس مجهول', 46300, 'مشرف تجريبي', 46300, 'مشرف تجريبي',
      '', '', '', 'شركة تجريبية', '', 'لا ينطبق', 46300, 2, 'ملاحظة', '', 0, '',
    ]], 'تاريخ الصيانة', 'مشرف الصيانة');

    expect(rows[0]).toMatchObject({
      ministryNumber: '000123',
      buildingType: 'مستقل',
      engineerName: 'مهندس مجهول',
      plannedDate: '2026-10-05',
      supervisorName: 'مشرف تجريبي',
      acDate: '2026-10-05',
      acSupervisor: 'مشرف تجريبي',
    });
    expect(autoDetectImportColumns(headers, {
      ministry: ['الرقم الوزاري'],
      class: ['تصنيف الوحدة'],
      date: ['تاريخ الصيانة'],
      waterResponses: { aliases: ['عدد الردود'], occurrence: 0 },
      sewageResponses: { aliases: ['عدد الردود'], occurrence: 1 },
    })).toEqual({ ministry: 0, class: 1, date: 3, waterResponses: 14, sewageResponses: 17 });
  });
});

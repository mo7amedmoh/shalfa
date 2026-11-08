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
  resolvePlanPerson,
  schoolPersonDefault,
} from './imports';

describe('import value normalization', () => {
  it('normalizes Arabic-Indic ministry numbers', () => {
    expect(normalizeMinistryNumber(' ٩٥١ ٨٣ ')).toBe('95183');
    expect(normalizeMinistryNumber('M010801')).toBe('10801');
    expect(normalizeMinistryNumber('00010801')).toBe('10801');
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

  it('resolves names in order and falls back to free text', () => {
    const employees = [{ id: 'one', full_name: 'هاني عراقي' }];
    const aliases = [{ alias_normalised: normalizeImportName('هاني'), employee_id: 'one' }];
    expect(resolvePlanPerson('هاني', employees, aliases).source).toBe('alias');
    expect(resolvePlanPerson('اسم غير مسجل', employees, aliases)).toMatchObject({ employee: null, name: 'اسم غير مسجل', source: 'free_text' });
    expect(resolvePlanPerson('', employees, [], 'هاني عراقي').source).toBe('employee');
    expect(resolvePlanPerson('', [], [], 'اسم من قاعدة المباني').source).toBe('school');
  });

  it('uses only name columns from the school source fields', () => {
    const school = { source_fields: { 'اسم مهندس المرافق': 'مهندس المدرسة', 'رقم الاتصال': '0500000000', 'اسم المشرف (صيانة)': 'مشرف المدرسة' } };
    expect(schoolPersonDefault(school, 'engineer', 'maintenance')).toBe('مهندس المدرسة');
    expect(schoolPersonDefault(school, 'supervisor', 'maintenance')).toBe('مشرف المدرسة');
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
    expect(parseImportDate(46327)).toBe('2026-11-01');
    expect(parseImportDate('٥/١١/٢٠٢٦')).toBe('2026-11-05');
    expect(parseImportDate('1-Nov-26')).toBe('2026-11-01');
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
      'ملاحظات توريد مياة',
      'تاريخ النزح',
      'ملاحظات النزح',
    ];
    const rows = parseMonthlyPlanRows(headers, [[
      '000123', 'مستقل', 'مهندس مجهول', 46327, 'مشرف تجريبي', 46327, 'مشرف تجريبي',
      '', '', '', 'شركة تجريبية', '', 'لا ينطبق', 46327, 'ملاحظة', '', '',
    ]], 'تاريخ الصيانة', 'مشرف الصيانة');

    expect(rows[0]).toMatchObject({
      ministryNumber: '000123',
      buildingType: 'مستقل',
      engineerName: 'مهندس مجهول',
      plannedDate: '2026-11-01',
      supervisorName: 'مشرف تجريبي',
      acDate: '2026-11-01',
      acSupervisor: 'مشرف تجريبي',
    });
    expect(autoDetectImportColumns(headers, {
      ministry: ['الرقم الوزاري'],
      class: ['تصنيف الوحدة'],
      date: ['تاريخ الصيانة'],
    })).toEqual({ ministry: 0, class: 1, date: 3 });
  });
});

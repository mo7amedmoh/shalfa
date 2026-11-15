import { describe, expect, it } from 'vitest';
import { previewGeneralPlanIdentifiers, type GeneralPlanBulkSchool } from './generalPlanBulkUpdates';

const school = (id: string, schoolName: string, ministryNumber: string): GeneralPlanBulkSchool => ({
  id,
  schoolName,
  ministryNumber,
});

describe('general-plan bulk identifier preview', () => {
  const planSchools = [
    school('1', 'مدرسة النور', 'M00123'),
    school('2', 'مدرسة الأمل', '00456'),
  ];

  it('matches Arabic and Latin ministry numbers and school names', () => {
    const result = previewGeneralPlanIdentifiers(
      '١٢٣\nمدرسة الأمل',
      planSchools,
      planSchools,
    );

    expect(result.rows.map((row) => row.status)).toEqual(['matched', 'matched']);
    expect(result.rows.map((row) => row.rowId)).toEqual(['1', '2']);
  });

  it('distinguishes schools outside the plan and unknown identifiers', () => {
    const result = previewGeneralPlanIdentifiers(
      '789\nمدرسة غير موجودة',
      planSchools,
      [...planSchools, school('3', 'مدرسة خارج الخطة', '789')],
    );

    expect(result.rows.map((row) => row.status)).toEqual(['not_in_plan', 'unmatched']);
    expect(result.counts.not_in_plan).toBe(1);
    expect(result.counts.unmatched).toBe(1);
  });

  it('does not silently update ambiguous or duplicate rows', () => {
    const duplicateSchool = school('3', 'مدرسة النور فرع آخر', '123');
    const result = previewGeneralPlanIdentifiers(
      '123\nمدرسة النور\n123',
      [...planSchools, duplicateSchool],
      [...planSchools, duplicateSchool],
    );

    expect(result.rows.map((row) => row.status)).toEqual(['ambiguous', 'matched', 'duplicate']);
  });
});

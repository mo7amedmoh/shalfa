import { describe, expect, it } from 'vitest';
import { reportSchoolNeighbourhood } from './reportSchools';

describe('report school neighbourhood', () => {
  it('prefers the dedicated neighbourhood field when it is populated', () => {
    expect(reportSchoolNeighbourhood({
      neighbourhood: 'حي النخيل',
      sourceFields: { الحي: 'حي الندى' },
    })).toBe('حي النخيل');
  });

  it('falls back to the Arabic source sheet field', () => {
    expect(reportSchoolNeighbourhood({
      neighbourhood: null,
      sourceFields: { 'اسم الحي': 'حي الندى' },
    })).toBe('حي الندى');
  });

  it('supports English source headers and ignores non-text values', () => {
    expect(reportSchoolNeighbourhood({
      neighbourhood: null,
      sourceFields: { District: 12 },
    })).toBe('12');
    expect(reportSchoolNeighbourhood({
      neighbourhood: null,
      sourceFields: { district: null },
    })).toBe('');
  });
});

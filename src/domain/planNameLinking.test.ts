import { describe, expect, it } from 'vitest';
import { getUnlinkedPlanNames } from './planNameLinking';

describe('unlinked plan names', () => {
  it('deduplicates normalized names and excludes saved aliases', () => {
    expect(getUnlinkedPlanNames(
      ['مشرف تجريبي', ' مشرف  تجريبي ', 'اسم غير مربوط', ''],
      ['مُشرف تجريبي'],
    )).toEqual(['اسم غير مربوط']);
  });
});

import { describe, expect, it } from 'vitest';
import { calculateChecklistProgress } from './checklist';

describe('KPI checklist progress', () => {
  it('excludes not-applicable items from completion percentage', () => {
    expect(calculateChecklistProgress(['مكتمل', 'جارٍ', 'لا ينطبق'])).toEqual({
      total: 3,
      completed: 1,
      inProgress: 1,
      notStarted: 0,
      notApplicable: 1,
      percentage: 50,
    });
  });

  it('returns no percentage when every item is not applicable', () => {
    expect(calculateChecklistProgress(['لا ينطبق']).percentage).toBeNull();
  });
});

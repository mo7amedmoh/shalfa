import { describe, expect, it } from 'vitest';
import { summarizeGeneralPlanProgress } from './generalPlans';

describe('general plan completion summary', () => {
  it('counts workflow states and completion percentage', () => {
    expect(summarizeGeneralPlanProgress(['pending', 'in_progress', 'complete', 'complete'])).toEqual({
      total: 4, pending: 1, inProgress: 1, complete: 2, completionPercent: 50,
    });
  });

  it('returns a zero completion rate when no plan rows exist', () => {
    expect(summarizeGeneralPlanProgress([])).toEqual({
      total: 0, pending: 0, inProgress: 0, complete: 0, completionPercent: 0,
    });
  });
});

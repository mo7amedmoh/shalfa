import { describe, expect, it } from 'vitest';
import { employeeCategorySchema } from './workforce';

describe('employee categories', () => {
  it('accepts school gatekeepers in the workforce roster', () => {
    expect(employeeCategorySchema.parse('gatekeeper')).toBe('gatekeeper');
  });
});

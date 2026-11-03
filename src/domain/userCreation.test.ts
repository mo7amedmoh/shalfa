import { describe, expect, it } from 'vitest';
import { validateCreateUserInput } from './userCreation';

describe('create-user input validation', () => {
  it('normalizes valid usernames before account creation', () => {
    expect(validateCreateUserInput({
      username: 'Engineer.One',
      display_name: 'مهندس المنطقة',
      role: 'area_engineer',
      password: 'StrongPass123!',
    })).toEqual({
      success: true,
      data: {
        username: 'engineer.one',
        displayName: 'مهندس المنطقة',
        role: 'area_engineer',
        password: 'StrongPass123!',
      },
    });
  });

  it.each([
    null,
    [],
    { username: 'ab', display_name: 'اسم صحيح', role: 'viewer', password: 'StrongPass123!' },
    { username: 'valid.user', display_name: 'x', role: 'viewer', password: 'StrongPass123!' },
    { username: 'valid.user', display_name: 'اسم صحيح', role: 'owner', password: 'StrongPass123!' },
    { username: 'valid.user', display_name: 'اسم صحيح', role: 'viewer', password: 'weak' },
  ])('rejects invalid payloads', (input) => {
    expect(validateCreateUserInput(input).success).toBe(false);
  });
});

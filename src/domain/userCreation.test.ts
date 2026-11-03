import { describe, expect, it } from 'vitest';
import { validateCreateUserInput } from './userCreation';

describe('create-user input validation', () => {
  it('normalizes the full email and derives its immutable username', () => {
    expect(validateCreateUserInput({
      email: 'Engineer.One@Example.com',
      display_name: 'مهندس المنطقة',
      role: 'area_engineer',
      password: 'StrongPass123!',
    })).toEqual({
      success: true,
      data: {
        email: 'engineer.one@example.com',
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
    { email: 'ab@example.com', display_name: 'اسم صحيح', role: 'viewer', password: 'StrongPass123!' },
    { email: 'valid.user@example.com', display_name: 'x', role: 'viewer', password: 'StrongPass123!' },
    { email: 'valid.user@example.com', display_name: 'اسم صحيح', role: 'owner', password: 'StrongPass123!' },
    { email: 'valid.user@example.com', display_name: 'اسم صحيح', role: 'viewer', password: 'weak' },
    { email: 'valid.user@shalfa.local', display_name: 'اسم صحيح', role: 'viewer', password: 'StrongPass123!' },
    { email: 'invalid local@example.com', display_name: 'اسم صحيح', role: 'viewer', password: 'StrongPass123!' },
  ])('rejects invalid payloads', (input) => {
    expect(validateCreateUserInput(input).success).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { analyzeResidenceNumbers, employeeCategorySchema } from './workforce';

describe('employee categories', () => {
  it('accepts school gatekeepers in the workforce roster', () => {
    expect(employeeCategorySchema.parse('gatekeeper')).toBe('gatekeeper');
  });

  describe('residence number quality', () => {
    it('flags passport-like and malformed numbers and identifies shared numbers with worksites', () => {
      const data = analyzeResidenceNumbers([
        { id: 'one', fullName: 'أحمد', employeeNumber: '1', residenceNumber: '1234567890', schools: [{ id: 's1', name: 'مدرسة أ' }] },
        { id: 'two', fullName: 'علي', employeeNumber: '2', residenceNumber: 'P123456', schools: [{ id: 's2', name: 'مدرسة ب' }] },
        { id: 'three', fullName: 'سالم', employeeNumber: '3', residenceNumber: '١٢٣٤٥٦٧٨٩٠', schools: [{ id: 's3', name: 'مدرسة ج' }] },
        { id: 'four', fullName: 'ماجد', employeeNumber: '4', residenceNumber: '123', schools: [] },
        { id: 'five', fullName: 'فهد', employeeNumber: '5', residenceNumber: null, schools: [] },
      ]);

      expect(data.issues.map(({ id, issue }) => [id, issue])).toEqual([
        ['two', 'passport-like'],
        ['four', 'invalid-length'],
        ['five', 'missing'],
      ]);
      expect(data.shared).toEqual([{
        residenceNumber: '1234567890',
        employees: [
          { id: 'one', fullName: 'أحمد', employeeNumber: '1', residenceNumber: '1234567890', schools: [{ id: 's1', name: 'مدرسة أ' }] },
          { id: 'three', fullName: 'سالم', employeeNumber: '3', residenceNumber: '١٢٣٤٥٦٧٨٩٠', schools: [{ id: 's3', name: 'مدرسة ج' }] },
        ],
      }]);
    });

    it('recomputes issue counts from refreshed values', () => {
      const record = { id: 'one', fullName: 'أحمد', employeeNumber: null, residenceNumber: 'ABC123', schools: [] };
      expect(analyzeResidenceNumbers([record]).issues).toHaveLength(1);
      expect(analyzeResidenceNumbers([{ ...record, residenceNumber: '1234567890' }]).issues).toHaveLength(0);
    });
  });
});

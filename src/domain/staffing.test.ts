import { describe, expect, it } from 'vitest';
import { calculateStaffing, getSizeFromClasses, parseClassCount, requiredCleanersForSize } from './staffing';

describe('staffing rules', () => {
  it('parses valid class counts and rejects missing or malformed source values', () => {
    expect(parseClassCount('12')).toBe(12);
    expect(parseClassCount(21)).toBe(21);
    expect(parseClassCount('١٢')).toBe(12);
    expect(parseClassCount('۱۲')).toBe(12);
    expect(parseClassCount('')).toBeNull();
    expect(parseClassCount('12.5')).toBeNull();
    expect(parseClassCount('-1')).toBeNull();
  });

  it.each([
    [1, 'small'],
    [12, 'small'],
    [13, 'medium'],
    [21, 'medium'],
    [22, 'large'],
  ] as const)('maps %i classes to %s', (classes, size) => {
    expect(getSizeFromClasses(classes)).toBe(size);
  });

  it('sets the contractual cleaner count for each size', () => {
    expect(['small', 'medium', 'large'].map((size) =>
      requiredCleanersForSize(size as 'small' | 'medium' | 'large'),
    )).toEqual([1, 2, 3]);
  });

  it('corrects mismatched size and calculates shortage', () => {
    expect(
      calculateStaffing({ classes: 14, declaredSize: 'S', assignedCleaners: 1 }),
    ).toMatchObject({ size: 'medium', requiredCleaners: 2, shortage: 1, sizeCorrected: true });
  });

  it.each([
    [12, 'small'],
    [18, 'medium'],
    [24, 'large'],
  ] as const)('uses class count for %i classes when source size is %s', (classes, sourceSize) => {
    expect(calculateStaffing({
      classes,
      declaredSize: sourceSize,
      assignedCleaners: 1,
    })).toMatchObject({ size: sourceSize, sizeCorrected: false });
  });

  it('applies a reasoned school exception without changing the standard rules', () => {
    expect(
      calculateStaffing({
        classes: 28,
        declaredSize: 'L',
        assignedCleaners: 2,
        exception: { requiredCleaners: 2, reason: 'اعتماد استثناء للمبنى' },
      }),
    ).toMatchObject({
      requiredCleaners: 2,
      shortage: 0,
      exceptionApplied: true,
      sizeCorrected: false,
    });
  });

  it('rejects invalid counts and exceptions', () => {
    expect(() => getSizeFromClasses(-1)).toThrow(RangeError);
    expect(() => getSizeFromClasses(0)).toThrow(RangeError);
    expect(() =>
      calculateStaffing({
        classes: 7,
        assignedCleaners: 0,
        exception: { requiredCleaners: 1, reason: ' ' },
      }),
    ).toThrow(RangeError);
  });

  it('does not report a correction when no source size label exists', () => {
    expect(calculateStaffing({ classes: 12, assignedCleaners: 1 }).sizeCorrected).toBe(false);
  });
});

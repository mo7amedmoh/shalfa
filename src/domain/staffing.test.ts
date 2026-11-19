import { describe, expect, it } from 'vitest';
import {
  calculateStaffing,
  DEFAULT_STAFFING_RULES,
  getSizeFromClasses,
  hasSizeCorrectionMismatch,
  hasSizeClassDifference,
  normalizeSchoolSize,
  mergeStaffingRules,
  parseClassCount,
  requiredCleanersForSize,
} from './staffing';

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

  it.each([
    ['small', 'small'],
    ['small_plus', 'small_plus'],
    ['medium', 'medium'],
    ['medium_plus', 'medium_plus'],
    ['large', 'large'],
    ['large_plus', 'large_plus'],
    ['large_plus_plus', 'large_plus_plus'],
  ] as const)('accepts stored size key %s', (value, size) => {
    expect(normalizeSchoolSize(value)).toBe(size);
  });

  it.each([
    ['S', 'small'],
    ['s', 'small'],
    ['small', 'small'],
    ['صغير', 'small'],
    ['صغيرة', 'small'],
    ['S+', 'small_plus'],
    ['s +', 'small_plus'],
    ['s＋', 'small_plus'],
    ['small+', 'small_plus'],
    ['صغير+', 'small_plus'],
    ['صغيرة+', 'small_plus'],
    ['M', 'medium'],
    ['m', 'medium'],
    ['medium', 'medium'],
    ['متوسط', 'medium'],
    ['متوسطة', 'medium'],
    ['M+', 'medium_plus'],
    ['m＋', 'medium_plus'],
    ['medium+', 'medium_plus'],
    ['متوسط+', 'medium_plus'],
    ['متوسطة+', 'medium_plus'],
    ['L', 'large'],
    ['l', 'large'],
    ['large', 'large'],
    ['كبير', 'large'],
    ['كبيرة', 'large'],
    ['L+', 'large_plus'],
    ['l +', 'large_plus'],
    ['l＋', 'large_plus'],
    ['large+', 'large_plus'],
    ['كبير+', 'large_plus'],
    ['كبيرة+', 'large_plus'],
    ['L++', 'large_plus_plus'],
    ['l++', 'large_plus_plus'],
    ['large++', 'large_plus_plus'],
    ['large_plus_plus', 'large_plus_plus'],
    ['كبير++', 'large_plus_plus'],
    ['كبيرة++', 'large_plus_plus'],
    ['L ++', 'large_plus_plus'],
    ['L＋＋', 'large_plus_plus'],
  ] as const)('continues to normalize sheet value %s to %s', (value, size) => {
    expect(normalizeSchoolSize(value)).toBe(size);
  });

  it.each(['XL', '', null, undefined, 1])('returns null for unknown size %s', (value) => {
    expect(normalizeSchoolSize(value)).toBeNull();
  });

  it('detects size corrections that differ from the sheet value', () => {
    expect(hasSizeCorrectionMismatch('small', 'M')).toBe(true);
    expect(hasSizeCorrectionMismatch('small', 'S')).toBe(false);
    expect(hasSizeCorrectionMismatch('small', '')).toBe(true);
    expect(hasSizeCorrectionMismatch(null, 'M')).toBe(false);
  });

  it('sets the staffing rule for every indicator', () => {
    expect(Object.values(DEFAULT_STAFFING_RULES)).toEqual([1, 2, 2, 3, 3, 4, 5]);
    expect(requiredCleanersForSize('large_plus')).toBe(4);
    expect(requiredCleanersForSize('large_plus_plus')).toBe(5);
  });

  it('fills missing persisted staffing rules with defaults', () => {
    expect(mergeStaffingRules({
      small: 2,
      small_plus: 2,
      medium: 2,
      medium_plus: 3,
      large: 3,
      large_plus: 4,
    })).toEqual({ ...DEFAULT_STAFFING_RULES, small: 2 });
  });

  it('calculates five cleaners for a large-plus-plus school', () => {
    expect(calculateStaffing({
      classes: 5,
      declaredSize: 'L++',
      assignedCleaners: 0,
    })).toMatchObject({ size: 'large_plus_plus', requiredCleaners: 5, shortage: 5 });
  });

  it.each([
    ['small_plus', 2],
    ['medium_plus', 3],
    ['large_plus', 4],
  ] as const)('uses stored plus size %s instead of the class-count fallback', (size, requiredCleaners) => {
    expect(calculateStaffing({
      classes: 5,
      declaredSize: size,
      assignedCleaners: 0,
    })).toMatchObject({ size, requiredCleaners });
  });

  it.each([
    ['small_plus', 2],
    ['medium_plus', 3],
    ['large_plus', 4],
  ] as const)('accepts stored plus size %s as a manual correction', (size, requiredCleaners) => {
    expect(calculateStaffing({
      classes: 5,
      manualSizeOverride: size,
      assignedCleaners: 0,
    })).toMatchObject({ size, requiredCleaners });
  });

  it('uses the explicit size as authoritative and flags a difference from class count', () => {
    expect(
      calculateStaffing({ classes: 14, declaredSize: 'S', assignedCleaners: 1 }),
    ).toMatchObject({ size: 'small', requiredCleaners: 1, shortage: 0, sizeDiffersFromClassCount: true });
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
    })).toMatchObject({ size: sourceSize, sizeDiffersFromClassCount: false });
  });

  it('uses class count only when the explicit indicator is missing', () => {
    expect(calculateStaffing({ classes: 25, assignedCleaners: 0 })).toMatchObject({
      size: 'large',
      requiredCleaners: 3,
      sizeDiffersFromClassCount: false,
    });
  });

  it('applies staffing rules from configuration', () => {
    expect(calculateStaffing({
      classes: null,
      declaredSize: 'L+',
      assignedCleaners: 1,
      rules: { ...DEFAULT_STAFFING_RULES, large_plus: 5 },
    })).toMatchObject({ size: 'large_plus', requiredCleaners: 5, shortage: 4 });
  });

  it('applies priority manual size override, then exception, then indicator, then class fallback', () => {
    const exception = { requiredCleaners: 7, reason: 'اعتماد استثناء للمبنى' };
    expect(
      calculateStaffing({
        classes: 28,
        declaredSize: 'L+',
        assignedCleaners: 2,
        exception,
      }),
    ).toMatchObject({
      size: 'large_plus',
      requiredCleaners: 7,
      shortage: 5,
      exceptionApplied: true,
      sizeDiffersFromClassCount: true,
    });
    expect(calculateStaffing({
      classes: 28,
      declaredSize: 'S',
      manualSizeOverride: 'M+',
      assignedCleaners: 1,
      exception,
    })).toMatchObject({
      size: 'medium_plus',
      requiredCleaners: 3,
      exceptionApplied: false,
      sizeDiffersFromClassCount: true,
    });
    expect(calculateStaffing({
      classes: 28,
      declaredSize: 'S',
      assignedCleaners: 1,
    })).toMatchObject({ size: 'small', requiredCleaners: 1 });
    expect(calculateStaffing({
      classes: 28,
      assignedCleaners: 1,
    })).toMatchObject({ size: 'large', requiredCleaners: 3 });
  });

  it('calculates size discrepancies only when both an indicator and class size exist', () => {
    expect(hasSizeClassDifference('S+', 18)).toBe(true);
    expect(hasSizeClassDifference('S', null)).toBe(false);
    expect(hasSizeClassDifference(null, 18)).toBe(false);
    expect(hasSizeClassDifference('unknown', 18)).toBe(false);
  });

  it('can calculate staffing from an indicator or exception without a class count', () => {
    expect(calculateStaffing({ classes: null, declaredSize: 'M+', assignedCleaners: 0 }))
      .toMatchObject({ size: 'medium_plus', requiredCleaners: 3 });
    expect(calculateStaffing({
      classes: null,
      assignedCleaners: 0,
      exception: { requiredCleaners: 2, reason: 'سبب واضح' },
    })).toMatchObject({ size: null, requiredCleaners: 2, exceptionApplied: true });
  });

  it('does not report a class-count difference when no source size label exists', () => {
    expect(calculateStaffing({ classes: 12, assignedCleaners: 1 }).sizeDiffersFromClassCount).toBe(false);
  });

  it('rejects invalid counts, rules and exceptions', () => {
    expect(() => getSizeFromClasses(-1)).toThrow(RangeError);
    expect(() => getSizeFromClasses(0)).toThrow(RangeError);
    expect(() => requiredCleanersForSize('small', { ...DEFAULT_STAFFING_RULES, small: -1 })).toThrow(RangeError);
    expect(() =>
      calculateStaffing({
        classes: 7,
        assignedCleaners: 0,
        exception: { requiredCleaners: 1, reason: ' ' },
      }),
    ).toThrow(RangeError);
    expect(() => calculateStaffing({
      classes: null,
      assignedCleaners: 0,
      manualSizeOverride: 'XX',
    })).toThrow(RangeError);
  });
});

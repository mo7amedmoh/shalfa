export const SCHOOL_SIZES = [
  'small',
  'small_plus',
  'medium',
  'medium_plus',
  'large',
  'large_plus',
] as const;

export type SchoolSize = (typeof SCHOOL_SIZES)[number];
export type StaffingRuleTable = Record<SchoolSize, number>;

export const DEFAULT_STAFFING_RULES: StaffingRuleTable = {
  small: 1,
  small_plus: 2,
  medium: 2,
  medium_plus: 3,
  large: 3,
  large_plus: 4,
};

export const SCHOOL_SIZE_CODES: Record<SchoolSize, string> = {
  small: 'S',
  small_plus: 'S+',
  medium: 'M',
  medium_plus: 'M+',
  large: 'L',
  large_plus: 'L+',
};

export const SCHOOL_SIZE_LABELS: Record<SchoolSize, string> = {
  small: 'صغيرة (S)',
  small_plus: 'صغيرة+ (S+)',
  medium: 'متوسطة (M)',
  medium_plus: 'متوسطة+ (M+)',
  large: 'كبيرة (L)',
  large_plus: 'كبيرة+ (L+)',
};

export interface StaffingInput {
  classes: number | null;
  declaredSize?: string | null;
  manualSizeOverride?: string | null;
  assignedCleaners: number;
  exception?: { requiredCleaners: number; reason: string } | null;
  rules?: StaffingRuleTable;
}

export interface StaffingResult {
  size: SchoolSize | null;
  requiredCleaners: number | null;
  assignedCleaners: number;
  shortage: number;
  surplus: number;
  sizeDiffersFromClassCount: boolean;
  exceptionApplied: boolean;
}

export function parseClassCount(value: unknown): number | null {
  const raw = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  const text = raw.replace(/[٠-٩۰-۹]/g, (digit) => String(digit.charCodeAt(0) >= 0x06f0
    ? digit.charCodeAt(0) - 0x06f0
    : digit.charCodeAt(0) - 0x0660));
  if (!/^\d+$/.test(text)) return null;
  const count = Number(text);
  return Number.isSafeInteger(count) && count > 0 ? count : null;
}

const SIZE_ALIASES: Record<SchoolSize, readonly string[]> = {
  small: ['s', 'small', 'صغير', 'صغيرة'],
  small_plus: ['s+', 'small+', 'صغير+', 'صغيرة+'],
  medium: ['m', 'medium', 'متوسط', 'متوسطة'],
  medium_plus: ['m+', 'medium+', 'متوسط+', 'متوسطة+'],
  large: ['l', 'large', 'كبير', 'كبيرة'],
  large_plus: ['l+', 'large+', 'كبير+', 'كبيرة+'],
};

export function normalizeSchoolSize(value: unknown): SchoolSize | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLocaleLowerCase().replace(/[＋]/g, '+').replace(/\s+/g, '');
  if (!normalized) return null;
  return SCHOOL_SIZES.find((size) => SIZE_ALIASES[size].includes(normalized)) ?? null;
}

export function getSizeFromClasses(classes: number): SchoolSize {
  if (!Number.isInteger(classes) || classes < 1) {
    throw new RangeError('Class count must be a positive integer.');
  }
  if (classes <= 12) return 'small';
  if (classes <= 21) return 'medium';
  return 'large';
}

export function hasSizeClassDifference(declaredSize: string | null | undefined, classes: number | null): boolean {
  const indicatorSize = normalizeSchoolSize(declaredSize);
  return indicatorSize !== null && classes !== null && indicatorSize !== getSizeFromClasses(classes);
}

export function requiredCleanersForSize(
  size: SchoolSize,
  rules: StaffingRuleTable = DEFAULT_STAFFING_RULES,
): number {
  const count = rules[size];
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(`Staffing rule for ${size} must be a non-negative integer.`);
  }
  return count;
}

export function calculateStaffing(input: StaffingInput): StaffingResult {
  if (!Number.isInteger(input.assignedCleaners) || input.assignedCleaners < 0) {
    throw new RangeError('Assigned cleaner count must be a non-negative integer.');
  }
  if (
    input.exception &&
    (!Number.isInteger(input.exception.requiredCleaners) ||
      input.exception.requiredCleaners < 0 ||
      !input.exception.reason.trim())
  ) {
    throw new RangeError('A staffing exception requires a valid count and reason.');
  }

  const rules = input.rules ?? DEFAULT_STAFFING_RULES;
  const manualSize = normalizeSchoolSize(input.manualSizeOverride);
  if (input.manualSizeOverride?.trim() && !manualSize) {
    throw new RangeError('Manual school size override is invalid.');
  }
  const declaredSize = normalizeSchoolSize(input.declaredSize);
  const size = manualSize ?? declaredSize
    ?? (input.classes === null ? null : getSizeFromClasses(input.classes));
  const manualOverrideApplied = manualSize !== null;
  const exceptionApplied = !manualOverrideApplied && Boolean(input.exception);
  const requiredCleaners = manualSize
    ? requiredCleanersForSize(manualSize, rules)
    : input.exception
      ? input.exception.requiredCleaners
      : size
        ? requiredCleanersForSize(size, rules)
        : null;
  const delta = requiredCleaners === null ? 0 : requiredCleaners - input.assignedCleaners;

  return {
    size,
    requiredCleaners,
    assignedCleaners: input.assignedCleaners,
    shortage: Math.max(0, delta),
    surplus: Math.max(0, -delta),
    sizeDiffersFromClassCount: hasSizeClassDifference(input.declaredSize, input.classes),
    exceptionApplied,
  };
}

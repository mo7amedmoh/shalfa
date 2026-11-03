export type SchoolSize = 'small' | 'medium' | 'large';

export interface StaffingInput {
  classes: number | null;
  declaredSize?: string | null;
  assignedCleaners: number;
  exception?: { requiredCleaners: number; reason: string } | null;
}

export interface StaffingResult {
  size: SchoolSize | null;
  requiredCleaners: number | null;
  assignedCleaners: number;
  shortage: number;
  surplus: number;
  sizeCorrected: boolean;
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

const SIZE_LABELS: Record<SchoolSize, readonly string[]> = {
  small: ['small', 'صغير', 'صغيرة', 's'],
  medium: ['medium', 'متوسط', 'متوسطة', 'm'],
  large: ['large', 'كبير', 'كبيرة', 'l'],
};

function declaredSizeKey(value: string | null | undefined): SchoolSize | null {
  const normalized = value?.trim().toLocaleLowerCase();
  if (!normalized) return null;
  return (
    (Object.entries(SIZE_LABELS).find(([, labels]) => labels.includes(normalized))?.[0] as
      | SchoolSize
      | undefined) ?? null
  );
}

export function getSizeFromClasses(classes: number): SchoolSize {
  if (!Number.isInteger(classes) || classes < 1) {
    throw new RangeError('Class count must be a positive integer.');
  }
  if (classes <= 12) return 'small';
  if (classes <= 21) return 'medium';
  return 'large';
}

export function requiredCleanersForSize(size: SchoolSize): number {
  return size === 'small' ? 1 : size === 'medium' ? 2 : 3;
}

export function calculateStaffing(input: StaffingInput): StaffingResult {
  if (!Number.isInteger(input.assignedCleaners) || input.assignedCleaners < 0) {
    throw new RangeError('Assigned cleaner count must be a non-negative integer.');
  }
  if (input.classes === null) {
    return {
      size: null,
      requiredCleaners: null,
      assignedCleaners: input.assignedCleaners,
      shortage: 0,
      surplus: 0,
      sizeCorrected: false,
      exceptionApplied: false,
    };
  }

  const size = getSizeFromClasses(input.classes);
  if (
    input.exception &&
    (!Number.isInteger(input.exception.requiredCleaners) ||
      input.exception.requiredCleaners < 0 ||
      !input.exception.reason.trim())
  ) {
    throw new RangeError('A staffing exception requires a valid count and reason.');
  }
  const standardRequired = requiredCleanersForSize(size);
  const requiredCleaners = input.exception?.requiredCleaners ?? standardRequired;
  const delta = requiredCleaners - input.assignedCleaners;

  return {
    size,
    requiredCleaners,
    assignedCleaners: input.assignedCleaners,
    shortage: Math.max(0, delta),
    surplus: Math.max(0, -delta),
    sizeCorrected: Boolean(input.declaredSize?.trim()) && declaredSizeKey(input.declaredSize) !== size,
    exceptionApplied: Boolean(input.exception),
  };
}

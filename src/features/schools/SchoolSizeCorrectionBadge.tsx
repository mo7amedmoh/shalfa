import { hasSizeCorrectionMismatch, normalizeSchoolSize, SCHOOL_SIZE_CODES, type SchoolSize } from '../../domain/staffing';

export function SchoolSizeCorrectionBadge({
  sheetSize,
  correctedSize,
  updatedByName,
  updatedAt,
  formatDateTime,
}: {
  sheetSize: unknown;
  correctedSize: SchoolSize | null;
  updatedByName: string | null;
  updatedAt: string | null;
  formatDateTime: (value: string) => string;
}) {
  if (!correctedSize || !hasSizeCorrectionMismatch(correctedSize, sheetSize)) return null;

  const normalizedSheetSize = normalizeSchoolSize(sheetSize);
  const sheetLabel = normalizedSheetSize
    ? SCHOOL_SIZE_CODES[normalizedSheetSize]
    : typeof sheetSize === 'string' && sheetSize.trim() ? sheetSize.trim() : 'غير محدد';
  const title = `الشيت: ${sheetLabel} · التصحيح: ${SCHOOL_SIZE_CODES[correctedSize]} · بواسطة ${updatedByName || 'مستخدم غير معروف'} · بتاريخ ${updatedAt ? formatDateTime(updatedAt) : 'غير متاح'}`;

  return (
    <span
      title={title}
      aria-label={title}
      className="ms-1 inline-flex rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-violet-800"
    >
      مُصحَّح يدويًا
    </span>
  );
}

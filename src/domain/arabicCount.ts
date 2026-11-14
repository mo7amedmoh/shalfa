export interface ArabicCountForms {
  one: string;
  two: string;
  few: string;
  many: string;
}

export function formatArabicCount(
  count: number,
  formatNumber: (value: number) => string,
  forms: ArabicCountForms,
): string {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError('Arabic count must be a non-negative safe integer.');
  }
  const form = count === 1
    ? forms.one
    : count === 2
      ? forms.two
      : count <= 10
        ? forms.few
        : forms.many;
  return `${formatNumber(count)} ${form}`;
}

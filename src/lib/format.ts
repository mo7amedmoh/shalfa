export type NumeralSystem = 'latin' | 'arabic_indic';

const arabicIndicDigits = '٠١٢٣٤٥٦٧٨٩';

export function formatNumerals(value: string | number, system: NumeralSystem): string {
  const text = String(value);
  if (system === 'latin') return text.replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
  return text.replace(/\d/g, (digit) => arabicIndicDigits[Number(digit)]);
}

export function formatDate(value: string, format: 'dd/mm/yyyy' | 'yyyy/mm/dd'): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new RangeError('Date must be a valid ISO calendar date.');
  }
  const [year, month, day] = value.split('-');
  return format === 'dd/mm/yyyy' ? `${day}/${month}/${year}` : `${year}/${month}/${day}`;
}

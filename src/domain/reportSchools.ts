export interface ReportSchoolLocation {
  neighbourhood: string | null;
  sourceFields: Readonly<Record<string, unknown>>;
}

const neighbourhoodHeaders = new Set([
  'الحي',
  'اسمالحي',
  'المنطقة',
  'الحيالمنطقة',
  'district',
  'neighborhood',
  'neighbourhood',
]);

export function reportSchoolNeighbourhood(school: ReportSchoolLocation): string {
  const neighbourhood = school.neighbourhood?.trim();
  if (neighbourhood) return neighbourhood;

  const sourceValue = Object.entries(school.sourceFields).find(([header]) => {
    const normalizedHeader = header.normalize('NFKC').toLocaleLowerCase().replace(/[\s/_-]+/g, '');
    return neighbourhoodHeaders.has(normalizedHeader) || /^الحي\d+$/.test(normalizedHeader);
  })?.[1];

  return typeof sourceValue === 'string' || typeof sourceValue === 'number'
    ? String(sourceValue).trim()
    : '';
}

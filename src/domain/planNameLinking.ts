import { normalizeImportName } from './imports';

export function getUnlinkedPlanNames(names: readonly string[], linkedAliases: readonly string[]): string[] {
  const linked = new Set(linkedAliases.map(normalizeImportName).filter(Boolean));
  const unique = new Map<string, string>();
  for (const rawName of names) {
    const name = rawName.trim();
    const normalized = normalizeImportName(name);
    if (normalized && !linked.has(normalized) && !unique.has(normalized)) unique.set(normalized, name);
  }
  return [...unique.values()].sort((left, right) => left.localeCompare(right, 'ar'));
}

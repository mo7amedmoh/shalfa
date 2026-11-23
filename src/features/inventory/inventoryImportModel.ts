export type ImportedImage = {
  id: string;
  blob: Blob | null;
  previewUrl: string | null;
  width: number | null;
  height: number | null;
  error: string | null;
};

export type InventoryImportRow = {
  rowNumber: number;
  name: string;
  logixCode: string;
  unit: string;
  category: string;
  notes: string;
  balanceText: string;
  balanceState: 'empty' | 'number' | 'text' | 'error' | 'formula_missing' | 'edited';
  valueErrors: string[];
  images: ImportedImage[];
  selectedImageId: string | null;
  ignored: boolean;
  allowMissingCode: boolean;
  ignoreValueErrors: boolean;
  skipUnreadableImages: boolean;
};

export type InventoryImportValidation = {
  missingName: boolean;
  missingCode: boolean;
  duplicateCode: boolean;
  missingUnit: boolean;
  missingCategory: boolean;
  misspelledCategory: boolean;
  invalidBalance: boolean;
  unresolvedValueErrors: boolean;
  unreadableImages: boolean;
  canImport: boolean;
};

export type ImportSummary = { inserted: number; updated: number; ignored: number };

export function getSpreadsheetRowFromImageAnchor(anchorRow: number): number {
  return Math.floor(anchorRow) + 1;
}

export function readImportedBalance(value: unknown): Pick<InventoryImportRow, 'balanceText' | 'balanceState'> {
  let cellValue = value;
  if (cellValue && typeof cellValue === 'object') {
    if ('error' in cellValue) return { balanceText: '', balanceState: 'error' };
    if ('formula' in cellValue || 'sharedFormula' in cellValue) {
      if (!('result' in cellValue) || cellValue.result === undefined || cellValue.result === null || cellValue.result === '') {
        return { balanceText: '', balanceState: 'formula_missing' };
      }
      cellValue = cellValue.result;
      if (cellValue && typeof cellValue === 'object' && 'error' in cellValue) {
        return { balanceText: '', balanceState: 'error' };
      }
    }
  }
  if (cellValue === null || cellValue === undefined || cellValue === '') {
    return { balanceText: '', balanceState: 'empty' };
  }
  if (typeof cellValue === 'number' && Number.isFinite(cellValue)) {
    return { balanceText: String(cellValue), balanceState: 'number' };
  }
  return { balanceText: String(cellValue).trim(), balanceState: 'text' };
}

export function parseOpeningBalance(row: Pick<InventoryImportRow, 'balanceText' | 'balanceState'>): number | null | undefined {
  if (row.balanceState === 'error' || row.balanceState === 'formula_missing' || row.balanceState === 'text') {
    return undefined;
  }
  const text = row.balanceText.trim();
  if (!text) return null;
  const quantity = Number(text);
  return Number.isFinite(quantity) && quantity >= 0 ? quantity : undefined;
}

export function validateInventoryImportRows(rows: readonly InventoryImportRow[]): InventoryImportValidation[] {
  const codeCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.ignored) continue;
    const code = row.logixCode.trim();
    if (code) codeCounts.set(code, (codeCounts.get(code) ?? 0) + 1);
  }

  return rows.map((row) => {
    const code = row.logixCode.trim();
    const missingName = !row.name.trim();
    const missingCode = !code && !row.allowMissingCode;
    const duplicateCode = Boolean(code && (codeCounts.get(code) ?? 0) > 1);
    const missingUnit = !row.unit.trim();
    const category = row.category.trim();
    const missingCategory = !category;
    const misspelledCategory = category === 'سبكة';
    const invalidBalance = parseOpeningBalance(row) === undefined;
    const unresolvedValueErrors = row.valueErrors.length > 0 && !row.ignoreValueErrors;
    const unreadableImages = row.images.some((image) => image.error) && !row.skipUnreadableImages;
    const canImport = !row.ignored && !missingName && !missingCode && !duplicateCode
      && !missingUnit && !missingCategory && !misspelledCategory && !invalidBalance
      && !unresolvedValueErrors && !unreadableImages;
    return {
      missingName,
      missingCode,
      duplicateCode,
      missingUnit,
      missingCategory,
      misspelledCategory,
      invalidBalance,
      unresolvedValueErrors,
      unreadableImages,
      canImport,
    };
  });
}

export function summarizeInventoryImport(inserted: number, updated: number, ignored: number): ImportSummary {
  return { inserted, updated, ignored };
}

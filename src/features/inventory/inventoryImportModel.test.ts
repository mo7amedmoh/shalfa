import { describe, expect, it } from 'vitest';
import {
  getSpreadsheetRowFromImageAnchor,
  parseOpeningBalance,
  readImportedBalance,
  summarizeInventoryImport,
  validateInventoryImportRows,
  type InventoryImportRow,
} from './inventoryImportModel';

function row(overrides: Partial<InventoryImportRow> = {}): InventoryImportRow {
  return {
    rowNumber: 3,
    name: 'مصباح',
    logixCode: '1001',
    unit: 'قطعة',
    category: 'كهرباء',
    notes: '',
    balanceText: '0',
    balanceState: 'number',
    valueErrors: [],
    images: [],
    selectedImageId: null,
    ignored: false,
    allowMissingCode: false,
    ignoreValueErrors: false,
    skipUnreadableImages: false,
    ...overrides,
  };
}

describe('inventory Excel import model', () => {
  it('distinguishes an empty balance from a numeric zero and uses formula cached results', () => {
    const blank = readImportedBalance(null);
    const zero = readImportedBalance(0);
    const formula = readImportedBalance({ formula: '1-1', result: 0 });

    expect(parseOpeningBalance(blank)).toBeNull();
    expect(parseOpeningBalance(zero)).toBe(0);
    expect(parseOpeningBalance(formula)).toBe(0);
    expect(readImportedBalance('0[[')).toEqual({ balanceText: '0[[', balanceState: 'text' });
    expect(readImportedBalance({ error: '#VALUE!' }).balanceState).toBe('error');
  });

  it('maps a zero-based workbook image anchor to its Excel row', () => {
    expect(getSpreadsheetRowFromImageAnchor(2.6)).toBe(3);
  });

  it('requires explicit resolution for missing codes, duplicate codes, missing fields, misspellings, and invalid balances', () => {
    const rows = [
      row({ logixCode: '', allowMissingCode: false }),
      row({ rowNumber: 4, logixCode: '1001' }),
      row({ rowNumber: 5, unit: '' }),
      row({ rowNumber: 6, category: 'سبكة' }),
      row({ rowNumber: 7, balanceText: '0[[', balanceState: 'text' }),
    ];

    const validation = validateInventoryImportRows(rows);

    expect(validation[0].missingCode).toBe(true);
    expect(validation[0].duplicateCode).toBe(false);
    expect(validation[1].duplicateCode).toBe(true);
    expect(validation[2].missingUnit).toBe(true);
    expect(validation[3].misspelledCategory).toBe(true);
    expect(validation[4].invalidBalance).toBe(true);
    expect(validation.every((entry) => !entry.canImport)).toBe(true);
  });

  it('permits a code-less item only after acknowledgement and excludes ignored rows from duplicate checks', () => {
    const rows = [
      row({ logixCode: '', allowMissingCode: true }),
      row({ rowNumber: 4, ignored: true, logixCode: '1001' }),
    ];

    const validation = validateInventoryImportRows(rows);

    expect(validation[0].canImport).toBe(true);
    expect(validation[1].duplicateCode).toBe(false);
    expect(validation[1].canImport).toBe(false);
  });

  it('reports the persisted inserted, updated, and ignored totals', () => {
    expect(summarizeInventoryImport(8, 12, 3)).toEqual({ inserted: 8, updated: 12, ignored: 3 });
  });
});

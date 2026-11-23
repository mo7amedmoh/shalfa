import { describe, expect, it } from 'vitest';
import {
  getSpreadsheetRowFromImageAnchor,
  parseOpeningBalance,
  readImportedBalance,
  summarizeInventoryImport,
  getInventoryImportMatches,
  normalizeInventoryImportText,
  resolveInventoryImportMatch,
  validateInventoryImportRows,
  type ExistingInventoryItem,
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
    existingMatchId: null,
    matchAsNew: false,
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

  it('requires explicit resolution for missing codes, missing fields, misspellings, and invalid balances', () => {
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
    expect(validation[1].canImport).toBe(true);
    expect(validation.every((entry, index) => index === 1 || !entry.canImport)).toBe(true);
  });

  it('matches coded rows by normalized code and name and flags multiple matches for review', () => {
    const matches: ExistingInventoryItem[] = [
      { id: 'one', logixCode: ' A-1 ', name: 'إضاءة', categoryName: 'كهرباء', photoPath: null },
      { id: 'two', logixCode: 'a-1', name: 'اضاءة', categoryName: 'إنارة', photoPath: null },
      { id: 'other', logixCode: 'A-1', name: 'مصباح', categoryName: 'كهرباء', photoPath: null },
    ];
    const imported = row({ logixCode: 'a-1', name: 'اضاءة' });

    expect(normalizeInventoryImportText(' إِضَاءَة ')).toBe('اضاءة');
    expect(getInventoryImportMatches(imported, matches).map((item) => item.id)).toEqual(['one', 'two']);
    expect(validateInventoryImportRows([imported], matches)[0].ambiguousMatch).toBe(true);
    expect(validateInventoryImportRows([row({ ...imported, existingMatchId: 'two' })], matches)[0].canImport).toBe(true);
    expect(resolveInventoryImportMatch({ existingMatchId: null, matchAsNew: true }, matches)).toBeNull();
  });

  it('matches code-less rows by normalized name and category, and allows explicit creation for ambiguous matches', () => {
    const matches: ExistingInventoryItem[] = [
      { id: 'one', logixCode: null, name: 'مِفتاح', categoryName: 'كهرباء', photoPath: null },
      { id: 'two', logixCode: '', name: 'مفتاح', categoryName: 'كهرباء', photoPath: null },
      { id: 'coded', logixCode: '123', name: 'مفتاح', categoryName: 'كهرباء', photoPath: null },
      { id: 'other-category', logixCode: null, name: 'مفتاح', categoryName: 'سباكة', photoPath: null },
    ];
    const imported = row({ logixCode: '', allowMissingCode: true, name: 'مفتاح', category: 'كهرباء' });

    expect(getInventoryImportMatches(imported, matches).map((item) => item.id)).toEqual(['one', 'two']);
    expect(validateInventoryImportRows([row({ ...imported, matchAsNew: true })], matches)[0].canImport).toBe(true);
    expect(resolveInventoryImportMatch({ existingMatchId: 'one', matchAsNew: false }, matches)?.id).toBe('one');
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

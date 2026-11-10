import { describe, expect, it } from 'vitest';
import { defaultPreferences, normalizePreferences } from './preferences';

describe('normalizePreferences', () => {
  it('accepts the preferences shape from the applied schema defaults', () => {
    expect(normalizePreferences({
      numerals: 'latin',
      date_format: 'gregorian',
      page_size: 25,
    })).toEqual(defaultPreferences);
  });

  it('preserves preferences saved by the app', () => {
    expect(normalizePreferences({
      numerals: 'arabic_indic',
      date_format: 'yyyy/mm/dd',
      rows_per_page: 50,
    })).toEqual({
      numerals: 'arabic_indic',
      date_format: 'yyyy/mm/dd',
      rows_per_page: 50,
      cleaner_placement_view: 'editable',
    });
  });

  it('preserves the per-user cleaner placement view', () => {
    expect(normalizePreferences({
      numerals: 'latin',
      date_format: 'dd/mm/yyyy',
      rows_per_page: 25,
      cleaner_placement_view: 'compact',
    })).toMatchObject({ cleaner_placement_view: 'compact' });
  });

  it('rejects invalid persisted page sizes', () => {
    expect(() => normalizePreferences({
      numerals: 'latin',
      date_format: 'gregorian',
      page_size: 5,
    })).toThrow();
  });
});

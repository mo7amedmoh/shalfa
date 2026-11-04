import { describe, expect, it } from 'vitest';
import { duplicateMinistryRows, isRiyadhCoordinate, schoolsWithMapCoordinates } from './schoolMap';

describe('school map data', () => {
  it('creates a map marker candidate for each school with a valid Riyadh coordinate', () => {
    const schools = [
      { id: 'one', latitude: 24.7, longitude: 46.6 },
      { id: 'two', latitude: 24.9, longitude: 47.1 },
      { id: 'missing', latitude: null, longitude: null },
      { id: 'outside', latitude: 33.5, longitude: -112.1 },
    ];

    expect(schoolsWithMapCoordinates(schools).map(({ id }) => id)).toEqual(['one', 'two']);
  });

  it('checks bounds and groups duplicate numbers by source row', () => {
    expect(isRiyadhCoordinate(24.7, 46.6)).toBe(true);
    expect(isRiyadhCoordinate(26, 46.6)).toBe(false);
    expect(duplicateMinistryRows([
      { ministry_number: '95183', source_row: 118 },
      { ministry_number: '95183', source_row: 117 },
      { ministry_number: '95184', source_row: 119 },
    ])).toEqual([{ ministryNumber: '95183', rows: [117, 118] }]);
  });
});

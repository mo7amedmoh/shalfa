import { describe, expect, it } from 'vitest';
import { resolveSchoolBuildingNames } from './schoolBuildings';

describe('resolveSchoolBuildingNames', () => {
  it('uses the primary building name for a school sharing its building number', () => {
    const schools = [
      { source_columns: [{ header: 'م', value: '50' }, { header: 'المبني', value: 'ابتدائية بشير بن الوليد' }] },
      { source_columns: [{ header: 'م', value: '50' }, { header: 'المبني', value: '' }] },
    ];

    expect(resolveSchoolBuildingNames(schools)).toEqual([
      'ابتدائية بشير بن الوليد',
      'ابتدائية بشير بن الوليد',
    ]);
  });

  it('does not fill a building name from a different building number', () => {
    const schools = [
      { source_columns: [{ header: 'م', value: '50' }, { header: 'المبني', value: 'المبنى الأول' }] },
      { source_columns: [{ header: 'م', value: '51' }, { header: 'المبني', value: '' }] },
    ];

    expect(resolveSchoolBuildingNames(schools)).toEqual(['المبنى الأول', '']);
  });
});

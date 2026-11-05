import { describe, expect, it } from 'vitest';
import { toSlimMapSchool } from '../../domain/schoolMap';

describe('SchoolMapMarkers data contract', () => {
  it('does not pass source columns into the map layer', () => {
    const projected = toSlimMapSchool({
      id: 'one',
      school_name: 'مدرسة one',
      ministry_number: 'one',
      latitude: 24.7,
      longitude: 46.6,
      size_source: null,
      size_calc: 'small',
      building_type: 'مستقل',
      plan_scope: true,
    });

    expect(projected).toEqual({
      id: 'one',
      name: 'مدرسة one',
      ministryNumber: 'one',
      latitude: 24.7,
      longitude: 46.6,
      size: 'small',
      buildingType: 'مستقل',
      planScope: true,
    });
    expect('source_columns' in projected).toBe(false);
  });
});

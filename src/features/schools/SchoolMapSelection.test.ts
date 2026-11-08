import { describe, expect, it } from 'vitest';
import { selectSchoolOnMap } from './schoolMapView';

describe('selectSchoolOnMap', () => {
  it('pans to the school without changing the current zoom when already close', () => {
    let pannedTo: [number, number] | undefined;
    let setZoomCalls = 0;
    const map = {
      getZoom: () => 15,
      panTo: (coordinates: [number, number]) => { pannedTo = coordinates; },
      setZoom: () => { setZoomCalls += 1; },
    };

    selectSchoolOnMap(map, { latitude: 24.7, longitude: 46.6 });

    expect(pannedTo).toEqual([24.7, 46.6]);
    expect(setZoomCalls).toBe(0);
  });

  it('zooms to 15 before panning when the map is zoomed out', () => {
    let zoom = 10;
    const map = {
      getZoom: () => zoom,
      panTo: () => undefined,
      setZoom: (nextZoom: number) => { zoom = nextZoom; },
    };

    selectSchoolOnMap(map, { latitude: 24.7, longitude: 46.6 });

    expect(zoom).toBe(15);
  });
});

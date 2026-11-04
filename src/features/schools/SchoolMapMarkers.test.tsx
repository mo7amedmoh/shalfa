import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SchoolMapMarkers } from './SchoolMapMarkers';
import type { SchoolRecord } from './schoolTypes';

vi.mock('react-leaflet', async () => {
  const react = await vi.importActual<typeof import('react')>('react');
  return {
    Marker: ({ children, position }: { children: React.ReactNode; position: [number, number] }) =>
      react.createElement('div', { 'data-school-marker': position.join(',') }, children),
    Popup: ({ children }: { children: React.ReactNode }) => react.createElement('div', null, children),
    Tooltip: ({ children }: { children: React.ReactNode }) => react.createElement('span', null, children),
  };
});

const school = (id: string, latitude: number | null, longitude: number | null): SchoolRecord => ({
  id,
  ministry_number: id,
  school_name: `مدرسة ${id}`,
  source_columns: [{ header: 'اسم المدرسة', value: `مدرسة ${id}` }],
  source_row: 2,
  latitude,
  longitude,
  synced_at: null,
  missing_from_sheet_at: null,
  plan_scope: true,
  size_source: null,
  size_calc: null,
  class_count: null,
  building_type: 'مستقل',
  has_elevator_contractor: false,
});

describe('SchoolMapMarkers', () => {
  it('renders map markers for schools with coordinates and omits coordinate-less schools', () => {
    const markup = renderToStaticMarkup(React.createElement(SchoolMapMarkers, {
      schools: [school('one', 24.7, 46.6), school('two', 24.8, 46.7), school('missing', null, null)],
      zoom: 10,
      onSelect: () => undefined,
    }));

    expect(markup.match(/data-school-marker=/g)).toHaveLength(2);
    expect(markup).toContain('24.7,46.6');
    expect(markup).toContain('24.8,46.7');
  });
});

import { describe, expect, it } from 'vitest';
import { defaultReportLayout, getReportLayout, normalizeReportLayout } from './reportSections';

describe('report layout persistence', () => {
  it('loads defaults when no preference exists', () => {
    expect(normalizeReportLayout(undefined)).toEqual(defaultReportLayout);
    expect(getReportLayout()).toHaveLength(6);
  });

  it('preserves saved order and visibility while adding new defaults', () => {
    const layout = normalizeReportLayout([
      { id: 'reports', visible: true },
      { id: 'header', visible: false },
    ]);
    expect(layout[0]).toEqual({ id: 'reports', visible: true });
    expect(layout.find((item) => item.id === 'header')?.visible).toBe(false);
    expect(layout.find((item) => item.id === 'late-items')?.visible).toBe(false);
    expect(getReportLayout(layout).map((section) => section.id)).toEqual(['reports', 'services', 'summary', 'supervisors', 'cumulative']);
  });

  it('moves cleaning supervisors before the cumulative report when all sections are selected', () => {
    const allSections = defaultReportLayout.map((item) => ({ ...item, visible: true }));
    expect(getReportLayout(allSections).map((section) => section.id)).toEqual([
      'header',
      'services',
      'summary',
      'supervisors',
      'cleaning-supervisors',
      'cumulative',
      'reports',
      'late-items',
    ]);
  });

  it('updates users who had the previous default order without overwriting custom order', () => {
    const previousDefault = [
      'header',
      'services',
      'summary',
      'supervisors',
      'cumulative',
      'reports',
      'late-items',
      'cleaning-supervisors',
    ].map((id) => ({ id, visible: true }));
    expect(getReportLayout(normalizeReportLayout(previousDefault)).map((section) => section.id)).toEqual([
      'header',
      'services',
      'summary',
      'supervisors',
      'cleaning-supervisors',
      'cumulative',
      'reports',
      'late-items',
    ]);
  });
});

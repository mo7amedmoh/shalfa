import { describe, expect, it } from 'vitest';
import {
  defaultTicketReportLayout,
  getTicketReportLayout,
  normalizeTicketReportLayout,
} from './ticketReportLayout';

describe('ticket report layout', () => {
  it('uses the default sections when no saved preference exists', () => {
    expect(normalizeTicketReportLayout(undefined)).toEqual(defaultTicketReportLayout);
    expect(getTicketReportLayout()).toHaveLength(defaultTicketReportLayout.length);
  });

  it('preserves section order and visibility while adding newer defaults', () => {
    const layout = normalizeTicketReportLayout([
      { id: 'repeats', visible: true },
      { id: 'summary', visible: false },
      { id: 'unknown', visible: true },
    ]);

    expect(layout[0]).toEqual({ id: 'repeats', visible: true });
    expect(layout[1]).toEqual({ id: 'summary', visible: false });
    expect(layout).toHaveLength(defaultTicketReportLayout.length);
    expect(getTicketReportLayout(layout).map((section) => section.id)).toEqual([
      'repeats',
      'header',
      'supervisors',
      'schools',
      'categories',
    ]);
  });
});

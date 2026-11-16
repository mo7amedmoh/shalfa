import { describe, expect, it } from 'vitest';
import { groupReportPdfSections } from './reportPdf';

describe('groupReportPdfSections', () => {
  it('groups the supervisor sections together and preserves other section order', () => {
    const sections = ['header', 'supervisors', 'cumulative', 'cleaning-supervisors', 'reports']
      .map((id) => ({ id, content: id }));

    expect(groupReportPdfSections(sections, [['supervisors', 'cleaning-supervisors']])).toEqual([
      { sections: ['header'], sideBySide: false },
      { sections: ['supervisors', 'cleaning-supervisors'], sideBySide: true },
      { sections: ['cumulative'], sideBySide: false },
      { sections: ['reports'], sideBySide: false },
    ]);
  });

  it('keeps a visible supervisor section in its own group when the other is hidden', () => {
    expect(groupReportPdfSections(
      [{ id: 'supervisors', content: 'maintenance' }],
      [['supervisors', 'cleaning-supervisors']],
    )).toEqual([{ sections: ['maintenance'], sideBySide: false }]);
  });
});

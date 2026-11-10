import { describe, expect, it } from 'vitest';
import { parsePastedMinistryNumbers, previewPlanNumberUpdates } from './planBulkUpdates';

const planRows = [
  { id: 'row-1', schoolName: 'مدرسة أولى', ministryNumber: 'M010801', ministryKey: '10801', visited: false },
  { id: 'row-2', schoolName: 'مدرسة ثانية', ministryNumber: '95183', ministryKey: '95183', visited: true },
];
const allSchools = [
  { schoolName: 'مدرسة أولى', ministryNumber: 'M010801', ministryKey: '10801' },
  ...planRows.slice(1).map(({ schoolName, ministryNumber, ministryKey }) => ({ schoolName, ministryNumber, ministryKey })),
  { schoolName: 'خارج الخطة', ministryNumber: '700', ministryKey: '700' },
];

describe('pasted ministry-number updates', () => {
  it('splits supported separators and normalizes Arabic-Indic digits', () => {
    expect(parsePastedMinistryNumbers('M010801\n٩٥١٨٣, 700، ٨٠٠')).toEqual(['10801', '95183', '700', '800']);
  });

  it('previews matched, unmatched, and schools outside the selected plan', () => {
    const result = previewPlanNumberUpdates('M010801 700 999', planRows, allSchools, 'visit', '2026-11-10', '');
    expect(result.rows.map((row) => row.status)).toEqual(['matched', 'not_in_plan', 'unmatched']);
    expect(result.rows[0].update).toEqual({ row_id: 'row-1', visited_date: '2026-11-10' });
    expect(result.counts).toMatchObject({ input: 3, matched: 1, notInPlan: 1, unmatched: 1 });
  });

  it('requires an existing visit for report-only updates, but accepts both actions together', () => {
    const reportOnly = previewPlanNumberUpdates('M010801', planRows, allSchools, 'report', '', '2026-11-10');
    expect(reportOnly.rows[0].status).toBe('invalid');

    const reportAfterVisit = previewPlanNumberUpdates('95183', planRows, allSchools, 'report', '', '2026-11-10');
    expect(reportAfterVisit.rows[0].status).toBe('matched');
    expect(reportAfterVisit.rows[0].update).toEqual({ row_id: 'row-2', report_date: '2026-11-10' });

    const both = previewPlanNumberUpdates('M010801', planRows, allSchools, 'both', '2026-11-09', '2026-11-10');
    expect(both.rows[0].status).toBe('matched');
    expect(both.rows[0].update).toEqual({ row_id: 'row-1', visited_date: '2026-11-09', report_date: '2026-11-10' });
  });

  it('does not apply duplicate or ambiguous identifiers and rejects invalid dates', () => {
    const duplicate = previewPlanNumberUpdates('10801 10801', planRows, allSchools, 'visit', '2026-11-10', '');
    expect(duplicate.rows.map((row) => row.status)).toEqual(['matched', 'duplicate']);

    const ambiguous = previewPlanNumberUpdates('10801', [...planRows, { ...planRows[0], id: 'row-3' }], allSchools, 'visit', '2026-11-10', '');
    expect(ambiguous.rows[0].status).toBe('ambiguous');

    const invalidDate = previewPlanNumberUpdates('10801', planRows, allSchools, 'both', '2026-02-30', '2026-11-10');
    expect(invalidDate.rows[0].status).toBe('invalid');
  });
});

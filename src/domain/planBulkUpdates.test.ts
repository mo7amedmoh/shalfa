import { describe, expect, it } from 'vitest';
import { getUnpersistedPlanUpdateIds, parsePastedPlanIdentifiers, previewPlanIdentifierUpdates } from './planBulkUpdates';

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
  it('detects rows whose requested states were not persisted', () => {
    const updates = [
      { row_id: 'row-1', visited_date: '2026-11-10' },
      { row_id: 'row-2', report_date: '2026-11-10' },
      { row_id: 'row-3', visited_date: null },
    ];
    expect(getUnpersistedPlanUpdateIds(updates, [
      { id: 'row-1', visited_date: '2026-11-10', report_done_date: null },
      { id: 'row-2', visited_date: '2026-11-09', report_done_date: null },
    ])).toEqual(['row-2', 'row-3']);
  });

  it('splits ministry numbers and school names while normalizing Arabic-Indic digits', () => {
    expect(parsePastedPlanIdentifiers('M010801 ٩٥١٨٣, مدرسة أولى\nمدرسة ثانية، 700')).toEqual([
      '10801', '95183', 'مدرسة أولى', 'مدرسة ثانية', '700',
    ]);
  });

  it('previews matched, unmatched, and schools outside the selected plan', () => {
    const result = previewPlanIdentifierUpdates('M010801 700 999', planRows, allSchools, 'visit', '2026-11-10', '');
    expect(result.rows.map((row) => row.status)).toEqual(['matched', 'not_in_plan', 'unmatched']);
    expect(result.rows[0].update).toEqual({ row_id: 'row-1', visited_date: '2026-11-10' });
    expect(result.counts).toMatchObject({ input: 3, matched: 1, notInPlan: 1, unmatched: 1 });
  });

  it('requires an existing visit for report-only updates, but accepts both actions together', () => {
    const reportOnly = previewPlanIdentifierUpdates('M010801', planRows, allSchools, 'report', '', '2026-11-10');
    expect(reportOnly.rows[0].status).toBe('invalid');

    const reportAfterVisit = previewPlanIdentifierUpdates('95183', planRows, allSchools, 'report', '', '2026-11-10');
    expect(reportAfterVisit.rows[0].status).toBe('matched');
    expect(reportAfterVisit.rows[0].update).toEqual({ row_id: 'row-2', report_date: '2026-11-10' });

    const both = previewPlanIdentifierUpdates('M010801', planRows, allSchools, 'both', '2026-11-09', '2026-11-10');
    expect(both.rows[0].status).toBe('matched');
    expect(both.rows[0].update).toEqual({ row_id: 'row-1', visited_date: '2026-11-09', report_date: '2026-11-10' });
  });

  it('does not apply duplicate or ambiguous identifiers and rejects invalid dates', () => {
    const duplicate = previewPlanIdentifierUpdates('10801 10801', planRows, allSchools, 'visit', '2026-11-10', '');
    expect(duplicate.rows.map((row) => row.status)).toEqual(['matched', 'duplicate']);

    const ambiguous = previewPlanIdentifierUpdates('10801', [...planRows, { ...planRows[0], id: 'row-3' }], allSchools, 'visit', '2026-11-10', '');
    expect(ambiguous.rows[0].status).toBe('ambiguous');

    const invalidDate = previewPlanIdentifierUpdates('10801', planRows, allSchools, 'both', '2026-02-30', '2026-11-10');
    expect(invalidDate.rows[0].status).toBe('invalid');
  });

  it('matches exact normalized school names in mixed lists and reports ambiguous or out-of-plan names', () => {
    const result = previewPlanIdentifierUpdates(
      'مَدْرَسَة أولى, خارج الخطة\nمدرسة مكررة',
      [
        ...planRows,
        { id: 'row-3', schoolName: 'مدرسة مكررة', ministryNumber: '300', ministryKey: '300', visited: false },
        { id: 'row-4', schoolName: 'مدرسة مكررة', ministryNumber: '400', ministryKey: '400', visited: false },
      ],
      allSchools,
      'visit',
      '2026-11-10',
      '',
    );
    expect(result.rows.map((row) => row.status)).toEqual(['matched', 'not_in_plan', 'ambiguous']);
    expect(result.rows[0].update).toEqual({ row_id: 'row-1', visited_date: '2026-11-10' });
  });

  it('does not update the same school twice when listed by both name and ministry number', () => {
    const result = previewPlanIdentifierUpdates('مدرسة أولى\n10801', planRows, allSchools, 'visit', '2026-11-10', '');
    expect(result.rows.map((row) => row.status)).toEqual(['matched', 'duplicate']);
  });
});

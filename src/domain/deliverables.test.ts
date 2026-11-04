import { describe, expect, it } from 'vitest';
import {
  computeDeliverableDueDate,
  isDeliverableLate,
  resolveDeliverableDueDate,
  summarizeDeliverables,
  type DeliverableDueDates,
  type DeliverableRecord,
} from './deliverables';

const dates: DeliverableDueDates = {
  contractSigningDate: '2026-07-01',
  siteHandoverDate: '2026-07-05',
  awardLetterDate: '2026-07-10',
};

const deliverable = (values: Partial<DeliverableRecord> = {}): DeliverableRecord => ({
  dueBasis: 'التوقيع',
  durationDays: 30,
  dueDateOverride: null,
  status: 'not_delivered',
  ...values,
});

describe('contractual deliverable due dates', () => {
  it('computes dates from signing, site handover, or contract start plus calendar days', () => {
    expect(computeDeliverableDueDate('التوقيع', 30, dates)).toBe('2026-07-31');
    expect(computeDeliverableDueDate('استلام الموقع', 0, dates)).toBe('2026-07-05');
    expect(computeDeliverableDueDate('الترسية', 60, dates)).toBe('2026-09-08');
  });

  it('returns no computed date when the duration, basis, or setting date is unavailable', () => {
    expect(computeDeliverableDueDate('حسب الخطة', 30, dates)).toBeNull();
    expect(computeDeliverableDueDate('التوقيع', null, dates)).toBeNull();
    expect(computeDeliverableDueDate('التوقيع', -1, dates)).toBeNull();
    expect(computeDeliverableDueDate('التوقيع', 30, { ...dates, contractSigningDate: null })).toBeNull();
  });

  it('resolves a manual due-date override and explains the comparison date', () => {
    expect(resolveDeliverableDueDate(deliverable({ dueDateOverride: '2026-08-01' }), dates)).toEqual({
      dueDate: '2026-08-01',
      isOverride: true,
      hint: 'موعد يدوي (الموعد المحسوب: 2026-07-31).',
    });
  });

  it('explains why textual recurring durations do not produce a single due date', () => {
    expect(resolveDeliverableDueDate(deliverable({
      dueBasis: 'استلام الموقع',
      durationDays: null,
      durationText: 'شهريًا (آخر يوم عمل)',
    }), dates).hint).toContain('شهريًا (آخر يوم عمل)');
  });

  it('marks only undelivered items late after the due date', () => {
    expect(isDeliverableLate(deliverable(), dates, '2026-07-31')).toBe(false);
    expect(isDeliverableLate(deliverable(), dates, '2026-08-01')).toBe(true);
    expect(isDeliverableLate(deliverable({ status: 'delivered_pending' }), dates, '2026-08-01')).toBe(false);
    expect(isDeliverableLate(deliverable({ status: 'approved' }), dates, '2026-08-01')).toBe(false);
    expect(isDeliverableLate(deliverable({ dueDateOverride: '2026-08-15' }), dates, '2026-08-01')).toBe(false);
    expect(isDeliverableLate(deliverable({ dueBasis: 'نهاية العقد', durationDays: null }), dates, '2026-12-01')).toBe(false);
  });

  it('summarizes delivered, approved, late, and progress for empty and populated lists', () => {
    const items = [
      deliverable(),
      deliverable({ status: 'delivered_pending' }),
      deliverable({ status: 'approved' }),
    ];
    expect(summarizeDeliverables(items, dates, '2026-08-01')).toMatchObject({
      total: 3,
      delivered: 2,
      approved: 1,
      late: 1,
    });
    expect(summarizeDeliverables(items, dates, '2026-08-01').progressPercent).toBeCloseTo(200 / 3);
    expect(summarizeDeliverables([], dates, '2026-08-01')).toEqual({
      total: 0,
      delivered: 0,
      approved: 0,
      late: 0,
      progressPercent: 0,
    });
  });
});

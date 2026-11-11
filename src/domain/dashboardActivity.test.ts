import { describe, expect, it } from 'vitest';
import { formatDashboardActivity } from './dashboardActivity';

describe('formatDashboardActivity', () => {
  it('formats known bulk-plan changes without exposing audit payloads', () => {
    expect(formatDashboardActivity({
      action: 'bulk_update_plan_rows',
      entity: 'monthly_plan_rows',
      details: { rows: 8, visits_marked: 3, reports_marked: 2, sensitive: 'not shown' },
    })).toBe('تحديث جماعي للخطة: 8 صف، 3 زيارة، 2 تقرير.');
  });

  it('formats recognized approvals and ignores unrelated events', () => {
    expect(formatDashboardActivity({
      action: 'UPDATE',
      entity: 'kpi_months',
      details: { new: { status: 'approved', month: '2026-10-01' } },
    })).toBe('تم اعتماد بطاقة الأداء لشهر 2026-10-01.');
    expect(formatDashboardActivity({
      action: 'DELETE',
      entity: 'schools',
      details: { name: 'مدرسة سرية' },
    })).toBeNull();
  });

  it('formats sync and import events using only approved count fields', () => {
    expect(formatDashboardActivity({
      action: 'sync',
      entity: 'schools',
      details: { schools: 12, source_url: 'private' },
    })).toBe('اكتملت مزامنة 12 مدرسة.');
    expect(formatDashboardActivity({
      action: 'import_monthly_plans',
      entity: 'monthly_plan_rows',
      details: { imported: 7 },
    })).toBe('تم استيراد 7 سجل.');
  });
});

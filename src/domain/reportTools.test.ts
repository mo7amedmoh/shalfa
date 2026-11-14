import { describe, expect, it } from 'vitest';
import { canUseReportTools, reportTools } from './reportTools';

describe('report tools access', () => {
  it('exposes report generators to report followers, area engineers and admins', () => {
    for (const role of ['report_follower', 'area_engineer', 'admin'] as const) {
      expect(canUseReportTools(role)).toBe(true);
    }
  });

  it('keeps report generators unavailable to unrelated roles', () => {
    for (const role of ['supervisor', 'viewer'] as const) {
      expect(canUseReportTools(role)).toBe(false);
    }
    expect(canUseReportTools(null)).toBe(false);
  });

  it('lists the four attached report generators', () => {
    expect(reportTools.map(({ label }) => label)).toEqual([
      'منجز تقارير النظافة',
      'منجز تقارير الصيانة و التكييف',
      'منجز تقارير غسيل الخزانات',
      'منجز تقارير مكافحة الافات',
    ]);
  });
});

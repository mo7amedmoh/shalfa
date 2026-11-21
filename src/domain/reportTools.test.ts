import { describe, expect, it } from 'vitest';
import { canUseReportTools, reportTools } from './reportTools';

describe('report tools access', () => {
  it('follows the effective reports.tools permission', () => {
    expect(canUseReportTools(new Set(['reports.tools']))).toBe(true);
    expect(canUseReportTools(new Set())).toBe(false);
  });

  it('lists the available report generators', () => {
    expect(reportTools.map(({ label }) => label)).toEqual([
      'منجز تقارير النظافة',
      'منجز تقارير تحضير عمالة النظافة',
      'منجز تقارير الصيانة و التكييف',
      'منجز تقارير غسيل الخزانات',
      'منجز تقارير مكافحة الافات',
    ]);
  });
});

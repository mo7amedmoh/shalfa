import { describe, expect, it } from 'vitest';
import {
  analyzeTickets,
  attachSchoolSupervisors,
  buildTicketSlaTrend,
  countTicketDataWarnings,
  deduplicateTicketRecords,
  filterTicketRecordsByCreatedMonth,
  filterTicketRecordsThroughMonth,
  normalizeTicketSchoolNumber,
  parseTicketRows,
} from './ticketAnalysis';

const headers = {
  id: 'مُعرّف الحالة',
  priority: 'الأولوية',
  status: 'الحالة',
  slaStatus: 'حالة SLM',
  category: 'الطبقة 3 للفئة',
  schoolNumber: 'رقم المدرسة',
  schoolName: 'اسم المبنى',
  supervisor: 'المشرف',
  createdAt: 'تاريخ الإنشاء',
  updatedAt: 'تاريخ التعديل',
  resolvedAt: 'تاريخ الحل',
  reopened: 'معاد فتحها',
};

describe('parseTicketRows', () => {
  it('renames the requested category level 3 values within their category level 2', () => {
    const categoryMappings = [
      ['الصيانة', 'أعمال مدنية', 'أعمال مدنية'],
      ['الصيانة', 'أعمال سباكة', 'أعمال سباكة'],
      ['الصيانة', 'صيانة الأعمال الصحية', 'أعمال سباكة'],
      ['الصيانة', 'بلاغات صيانة العناصر المعمارية والمدنية', 'أعمال مدنية'],
      ['التكييف', 'بلاغات صيانة أجهزة التكييف', 'أعمال التكييف'],
      ['أعمال الصيانة', 'صيانة الأعمال الكهربائية', 'أعمال كهرباء'],
      ['الصيانة', 'بلاغات صيانة نظام الانذار ومكافحة الحريق', 'امن و سلامة'],
      ['الصيانة', 'بلاغات صيانة الاعمال الكهربائية', 'أعمال كهرباء'],
      ['الصيانة', 'المصاعد والسلالم الكهربائية', 'مصاعد'],
      ['النظافة', 'خدمات النظافة', 'أعمال نظافة'],
      ['الصيانة', 'بلاغات صيانة الاعمال الصحية', 'أعمال سباكة'],
      ['الصيانة', 'أعمال كهربائية', 'أعمال كهرباء'],
      ['النظافة', 'بلاغات أعمال النظافة العامة', 'أعمال نظافة'],
      ['الصيانة', 'بلاغات صيانة أنظمة المراقبة', 'أنظمة مراقبة'],
      ['الصيانة', 'الأنظمة الصوتية', 'أنظمة صوتية'],
      ['النظافة', 'استفسارات اعمال النظافة العامة', 'أعمال نظافة'],
      ['التكييف', 'بلاغات نظافة أجهزة التكييف', 'أعمال التكييف'],
      ['الصيانة', 'بلاغات صيانة الأعمال الميكانيكية', 'اعمال ميكانيكية'],
      ['الصيانة', 'بلاغات صيانة المصاعد والسلالم الكهربائية', 'مصاعد'],
    ];
    const parsed = parseTicketRows(categoryMappings.map(([group, category], index) => ({
      [headers.id]: `CATEGORY-${index}`,
      [headers.priority]: 'متوسط',
      [headers.status]: 'قيد التنفيذ',
      [headers.slaStatus]: 'ضمن المهلة',
      'الطبقة 2 للفئة': group,
      [headers.category]: category,
      [headers.schoolName]: 'مدرسة',
      [headers.createdAt]: '10/11/2026',
    })));

    expect(parsed.tickets.map(({ category }) => category)).toEqual(categoryMappings.map(([, , renamed]) => renamed));
  });

  it('renames known categories when the upload omits category level 2', () => {
    const parsed = parseTicketRows([{
      [headers.id]: 'CATEGORY-WITHOUT-GROUP',
      [headers.priority]: 'متوسط',
      [headers.status]: 'قيد التنفيذ',
      [headers.slaStatus]: 'ضمن المهلة',
      [headers.category]: 'صيانة الأعمال الصحية',
      [headers.schoolName]: 'مدرسة',
      [headers.createdAt]: '10/11/2026',
    }]);

    expect(parsed.tickets[0].category).toBe('أعمال سباكة');
  });

  it('renames sanitary maintenance work even when its category group differs', () => {
    const parsed = parseTicketRows([{
      [headers.id]: 'SANITARY-MAINTENANCE',
      [headers.priority]: 'متوسط',
      [headers.status]: 'قيد التنفيذ',
      [headers.slaStatus]: 'ضمن المهلة',
      'الطبقة 2 للفئة': 'أعمال الصيانة',
      [headers.category]: 'صيانة الأعمال الصحية',
      [headers.schoolName]: 'مدرسة',
      [headers.createdAt]: '10/11/2026',
    }]);

    expect(parsed.tickets[0].category).toBe('أعمال سباكة');
  });

  it('maps the sample Arabic headers and parses Arabic locale date values', () => {
    const parsed = parseTicketRows([{
      [headers.id]: 'CASE-1',
      [headers.priority]: 'حرج',
      [headers.status]: 'تم حله',
      [headers.slaStatus]: 'ضمن المهلة الزمنية',
      [headers.category]: 'أعمال سباكة',
      [headers.schoolNumber]: 'S-100',
      [headers.schoolName]: 'ابتدائية النور',
      [headers.supervisor]: 'مشرف 1',
      [headers.createdAt]: '10\u200f/11\u200f/2026, 1:16:52 م',
      [headers.resolvedAt]: '١٠/١١/٢٠٢٦، ٢:١٦:٥٢ م',
      [headers.reopened]: 'صواب',
    }]);

    expect(parsed.hasSupervisorColumn).toBe(true);
    expect(parsed.tickets[0].createdAt?.toISOString()).toBe('2026-11-10T13:16:52.000Z');
    expect(parsed.tickets[0].resolvedAt?.toISOString()).toBe('2026-11-10T14:16:52.000Z');
    expect(parsed.tickets[0].reopened).toBe(true);
    expect(parsed.warnings).toMatchObject({ missingIdentifiers: 0, invalidCreatedDates: 0, missingSupervisors: 0 });
  });

  it('requires core columns while allowing a missing supervisor column', () => {
    const row: Record<string, unknown> = {
      [headers.id]: 'CASE-2',
      [headers.priority]: 'متوسط',
      [headers.status]: 'قيد التنفيذ',
      [headers.slaStatus]: 'تحذير',
      [headers.category]: 'أعمال كهربائية',
      [headers.schoolName]: 'ابتدائية النور',
      [headers.createdAt]: '10/11/2026, 11:00:00 ص',
    };
    delete row[headers.supervisor];
    const parsed = parseTicketRows([row]);
    expect(parsed.hasSupervisorColumn).toBe(false);
    expect(parsed.warnings.missingSupervisors).toBe(1);
    expect(() => parseTicketRows([{ الحالة: 'قيد التنفيذ' }])).toThrow('الأعمدة المطلوبة غير موجودة');
  });
});

describe('analyzeTickets', () => {
  it('builds monthly SLA breach percentages from the uploaded ticket dates', () => {
    const parsed = parseTicketRows([
      { [headers.id]: 'A', [headers.priority]: 'متوسط', [headers.status]: 'تم حله', [headers.slaStatus]: 'ضمن المهلة', [headers.category]: 'أعمال', [headers.schoolName]: 'مدرسة', [headers.createdAt]: '10/08/2026' },
      { [headers.id]: 'B', [headers.priority]: 'متوسط', [headers.status]: 'تم حله', [headers.slaStatus]: 'تم اختراقه', [headers.category]: 'أعمال', [headers.schoolName]: 'مدرسة', [headers.createdAt]: '11/08/2026' },
      { [headers.id]: 'C', [headers.priority]: 'متوسط', [headers.status]: 'قيد التنفيذ', [headers.slaStatus]: 'تحذير', [headers.category]: 'أعمال', [headers.schoolName]: 'مدرسة', [headers.createdAt]: '12/09/2026' },
      { [headers.id]: 'D', [headers.priority]: 'متوسط', [headers.status]: 'قيد التنفيذ', [headers.slaStatus]: 'تجاوز المهلة', [headers.category]: 'أعمال', [headers.schoolName]: 'مدرسة', [headers.createdAt]: '12/11/2026' },
      { [headers.id]: 'E', [headers.priority]: 'متوسط', [headers.status]: 'قيد التنفيذ', [headers.slaStatus]: 'ضمن المهلة', [headers.category]: 'أعمال', [headers.schoolName]: 'مدرسة', [headers.createdAt]: '12/12/2026' },
      { [headers.id]: 'F', [headers.priority]: 'متوسط', [headers.status]: 'قيد التنفيذ', [headers.slaStatus]: 'تجاوز المهلة', [headers.category]: 'أعمال', [headers.schoolName]: 'مدرسة', [headers.createdAt]: '13/12/2026' },
    ]);

    const trend = buildTicketSlaTrend(parsed.tickets, '2026-11');
    expect(trend.map(({ month, assessed, monthlyBreachPercent }) => (
      { month, assessed, monthlyBreachPercent }
    ))).toEqual([
      { month: '2026-08', assessed: 2, monthlyBreachPercent: 50 },
      { month: '2026-09', assessed: 1, monthlyBreachPercent: 0 },
      { month: '2026-10', assessed: 0, monthlyBreachPercent: null },
      { month: '2026-11', assessed: 1, monthlyBreachPercent: 100 },
      { month: '2026-12', assessed: 2, monthlyBreachPercent: 50 },
    ]);
    expect(trend[3]).toMatchObject({ breached: 1 });
    expect(trend[4]).toMatchObject({ breached: 1 });
  });

  it('filters current-month results while retaining prior-months for the SLA trend', () => {
    const { tickets } = parseTicketRows([
      { [headers.id]: 'OLD', [headers.priority]: 'متوسط', [headers.status]: 'تم حله', [headers.slaStatus]: 'ضمن المهلة', [headers.category]: 'أعمال', [headers.schoolName]: 'مدرسة', [headers.createdAt]: '12/10/2026' },
      { [headers.id]: 'CURRENT', [headers.priority]: 'متوسط', [headers.status]: 'قيد التنفيذ', [headers.slaStatus]: 'تحذير', [headers.category]: 'أعمال', [headers.schoolName]: 'مدرسة', [headers.createdAt]: '12/11/2026' },
      { [headers.id]: 'FUTURE', [headers.priority]: 'متوسط', [headers.status]: 'قيد التنفيذ', [headers.slaStatus]: 'تجاوز المهلة', [headers.category]: 'أعمال', [headers.schoolName]: 'مدرسة', [headers.createdAt]: '12/12/2026' },
    ]);

    expect(filterTicketRecordsByCreatedMonth(tickets, '2026-11').map(({ id }) => id)).toEqual(['CURRENT']);
    expect(filterTicketRecordsThroughMonth(tickets, '2026-11').map(({ id }) => id)).toEqual(['OLD', 'CURRENT']);
  });

  it('keeps the most recently updated copy of overlapping tickets and counts current-row warnings', () => {
    const parsed = parseTicketRows([
      { [headers.id]: 'CASE-1', [headers.priority]: 'متوسط', [headers.status]: 'قيد التنفيذ', [headers.slaStatus]: 'ضمن المهلة', [headers.category]: 'أعمال', [headers.schoolName]: 'مدرسة', [headers.createdAt]: '10/11/2026', [headers.updatedAt]: '11/11/2026' },
      { [headers.id]: 'CASE-1', [headers.priority]: 'متوسط', [headers.status]: 'قيد التنفيذ', [headers.slaStatus]: 'تجاوز المهلة', [headers.category]: 'أعمال', [headers.schoolName]: 'مدرسة', [headers.createdAt]: '10/11/2026', [headers.updatedAt]: '12/11/2026' },
    ]);
    const deduplicated = deduplicateTicketRecords(parsed.tickets);

    expect(deduplicated).toHaveLength(1);
    expect(deduplicated[0].slaStatus).toBe('تجاوز المهلة');
    expect(countTicketDataWarnings(deduplicated).missingSupervisors).toBe(1);
  });

  it('matches school supervisors by ministry or school number after removing the S- prefix', () => {
    const parsed = parseTicketRows([
      {
        [headers.id]: 'CASE-1',
        [headers.priority]: 'متوسط',
        [headers.status]: 'قيد التنفيذ',
        [headers.slaStatus]: 'ضمن المهلة',
        [headers.category]: 'أعمال سباكة',
        [headers.schoolNumber]: 'S-M39195176',
        [headers.schoolName]: 'المدرسة الأولى',
        [headers.createdAt]: '10/11/2026',
      },
      {
        [headers.id]: 'CASE-2',
        [headers.priority]: 'متوسط',
        [headers.status]: 'قيد التنفيذ',
        [headers.slaStatus]: 'ضمن المهلة',
        [headers.category]: 'أعمال كهربائية',
        [headers.schoolNumber]: 'S-002',
        [headers.schoolName]: 'المدرسة الثانية',
        [headers.createdAt]: '10/11/2026',
      },
    ]);
    const tickets = attachSchoolSupervisors(parsed.tickets, [
      {
        ministryNumber: 'M39195176',
        ministryKey: '39195176',
        sourceFields: { 'اسم المشرف (صيانة)': 'مشرف الوزارة' },
      },
      {
        ministryNumber: 'M99999999',
        ministryKey: null,
        sourceFields: { 'رقم المدرسة': '002', 'اسم المشرف (صيانة)': 'مشرف المبنى' },
      },
    ]);

    expect(normalizeTicketSchoolNumber('S-M39195176')).toBe('39195176');
    expect(tickets.map((ticket) => ticket.supervisor)).toEqual(['مشرف الوزارة', 'مشرف المبنى']);
  });

  it('leaves ambiguous school-number supervisor matches unassigned', () => {
    const parsed = parseTicketRows([{
      [headers.id]: 'CASE-1',
      [headers.priority]: 'متوسط',
      [headers.status]: 'قيد التنفيذ',
      [headers.slaStatus]: 'ضمن المهلة',
      [headers.category]: 'أعمال سباكة',
      [headers.schoolNumber]: 'S-002',
      [headers.schoolName]: 'المدرسة',
      [headers.createdAt]: '10/11/2026',
    }]);
    const tickets = attachSchoolSupervisors(parsed.tickets, [
      { ministryNumber: '1', ministryKey: null, sourceFields: { 'رقم المدرسة': '002', 'اسم المشرف (صيانة)': 'مشرف أ' } },
      { ministryNumber: '2', ministryKey: null, sourceFields: { 'رقم المدرسة': 'S-002', 'اسم المشرف (صيانة)': 'مشرف ب' } },
    ]);

    expect(tickets[0].supervisor).toBe('');
  });

  it('calculates status, SLA, resolution, school and repeat summaries', () => {
    const parsed = parseTicketRows([
      {
        [headers.id]: 'CASE-1',
        [headers.priority]: 'حرج',
        [headers.status]: 'قيد التنفيذ',
        [headers.slaStatus]: 'ضمن المهلة الزمنية',
        [headers.category]: 'أعمال سباكة',
        [headers.schoolNumber]: 'S-100',
        [headers.schoolName]: 'ابتدائية النور',
        [headers.supervisor]: 'مشرف 1',
        [headers.createdAt]: '10/11/2026, 9:00:00 ص',
        [headers.resolvedAt]: '',
        [headers.reopened]: 'صواب',
      },
      {
        [headers.id]: 'CASE-2',
        [headers.priority]: 'متوسط',
        [headers.status]: 'تم حله',
        [headers.slaStatus]: 'تحذير',
        [headers.category]: 'أعمال سباكة',
        [headers.schoolNumber]: 'S-100',
        [headers.schoolName]: 'ابتدائية النور',
        [headers.supervisor]: 'مشرف 1',
        [headers.createdAt]: '10/11/2026, 10:00:00 ص',
        [headers.resolvedAt]: '10/11/2026, 11:00:00 ص',
      },
      {
        [headers.id]: 'CASE-3',
        [headers.priority]: 'حرج',
        [headers.status]: 'ملغى',
        [headers.slaStatus]: 'تجاوز المهلة',
        [headers.category]: 'أعمال كهربائية',
        [headers.schoolNumber]: 'S-200',
        [headers.schoolName]: 'ابتدائية الندى',
        [headers.supervisor]: 'مشرف 2',
        [headers.createdAt]: '11/11/2026, 9:00:00 ص',
      },
    ]);

    expect(parsed.tickets[1].resolvedAt?.toISOString()).toBe('2026-11-10T11:00:00.000Z');
    const analysis = analyzeTickets(parsed.tickets, parsed.hasSupervisorColumn);
    expect(analysis).toMatchObject({
      total: 3,
      resolved: 1,
      open: 1,
      cancelled: 1,
      inProgress: 1,
      reopened: 1,
      critical: 2,
      criticalOpen: 1,
      averageResolutionHours: 1,
      resolvedWithDuration: 1,
      sla: { within: 1, warning: 1, breached: 1, assessed: 3 },
      repeats: { groups: 1, schools: 1, tickets: 2, additionalTickets: 1, openTickets: 1 },
    });
    expect(analysis.sla.compliancePercent).toBeCloseTo(200 / 3);
    expect(analysis.sla.breachPercent).toBeCloseTo(100 / 3);
    expect(analysis.schoolsByTotal[0]).toMatchObject({ schoolNumber: 'S-100', total: 2, resolved: 1, open: 1 });
    expect(analysis.repeats.top[0]).toMatchObject({ schoolName: 'ابتدائية النور', category: 'أعمال سباكة', count: 2, open: 1 });
    expect(analysis.supervisors[0]).toMatchObject({ name: 'مشرف 1', total: 2, resolved: 1, open: 1, withinSla: 1 });
  });
});

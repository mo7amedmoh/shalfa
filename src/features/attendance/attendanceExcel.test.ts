import { describe, expect, it } from 'vitest';
import { getAttendanceDays } from '../../domain/attendance';
import { buildAttendanceWorkbook, getAttendanceExportPeriod } from './attendanceExcel';

describe('attendance Excel export period', () => {
  it('formats the selected month for the footer and file name', () => {
    expect(getAttendanceExportPeriod('2026-10')).toBe('Oct26');
  });

  it('rejects invalid month values', () => {
    expect(() => getAttendanceExportPeriod('2026-13')).toThrow(RangeError);
  });
});

describe('attendance Excel workbook', () => {
  it('builds the print layout, attendance marks, logos, and one stamp per page', async () => {
    const pixelPng = Uint8Array.from(
      atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/r3sAAAAASUVORK5CYII='),
      (character) => character.charCodeAt(0),
    );
    const rows = Array.from({ length: 51 }, (_, index) => ({
      id: `worker-${index}`,
      sort_no: index + 1,
      school_name: 'مدرسة تجريبية',
      worker_name: `عامل ${index + 1}`,
      worker_id_number: index === 0 ? '0012345678' : null,
      remarks: null,
    }));
    const workbook = await buildAttendanceWorkbook({
      month: '2026-10',
      rows,
      marks: [{ roster_id: 'worker-0', day: '2026-10-01' }],
      days: getAttendanceDays('2026-10', [5]),
      tbcLogoBytes: pixelPng,
      safariLogoBytes: pixelPng,
      stampBytes: pixelPng,
    });
    const sheet = workbook.getWorksheet('Time Sheet');

    expect(sheet).toBeDefined();
    expect(sheet?.pageSetup).toMatchObject({
      paperSize: 9,
      orientation: 'landscape',
      fitToWidth: 1,
      printTitlesRow: '1:4',
      printArea: 'A1:AQ104',
    });
    expect(sheet?.headerFooter.oddFooter).toBe('&CPage &P&R O&&M-TBC - Oct26 Timesheet-1');
    expect(sheet?.getCell('E4').fill).toMatchObject({ fgColor: { argb: 'FFFF0000' } });
    expect(sheet?.getCell('F4').fill).toMatchObject({ fgColor: { argb: 'FF4472C4' } });
    expect(sheet?.getCell('F5').fill).toMatchObject({ fgColor: { argb: 'FF4472C4' } });
    expect(sheet?.getCell('F5').font.color).toMatchObject({ argb: 'FFFFFFFF' });
    expect(sheet?.getColumn(2).width).toBeLessThan(61);
    expect(sheet?.getCell('B5').border).toMatchObject({
      top: { style: 'thin' },
      bottom: { style: 'thin' },
      left: { style: 'thin' },
      right: { style: 'thin' },
    });
    expect(sheet?.getCell('E5').value).toBe('✓');
    expect(sheet?.getCell('D5').value).toBe('0012345678');
    expect(sheet?.getCell('D5').numFmt).toBe('@');
    expect([38, 39, 40, 41, 42].map((column) => sheet?.getRow(5).getCell(column).value))
      .toEqual(['', '', '', '', '']);
    expect(sheet?.model.rowBreaks).toEqual([expect.objectContaining({ id: 54, man: 1 })]);
    expect(sheet?.getImages()).toHaveLength(4);
  }, 20_000);
});

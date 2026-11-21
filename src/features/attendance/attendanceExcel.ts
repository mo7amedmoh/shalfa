import { summarizeAttendance } from '../../domain/attendance';
import type { AttendanceDay } from '../../domain/attendance';

const PIXELS_PER_INCH = 96;
const LOGO_HEIGHT_INCHES = 0.59;
const STAMP_HEIGHT_INCHES = 1.76;
const STAMP_BOTTOM_OFFSET_INCHES = 1.5 / 2.54;
const TBC_LOGO_ASPECT_RATIO = 199 / 90;
const SAFARI_LOGO_ASPECT_RATIO = 173 / 93;
const STAMP_ASPECT_RATIO = 1111 / 387;

export type AttendanceExcelRoster = {
  id: string;
  sort_no: number;
  school_name: string;
  worker_name: string;
  worker_id_number: string | null;
  remarks: string | null;
};

export type AttendanceExcelMark = {
  roster_id: string;
  day: string;
};

export type AttendanceExcelAssets = {
  tbcLogoBytes: Uint8Array;
  safariLogoBytes: Uint8Array;
  stampBytes: Uint8Array;
};

export type AttendanceExcelData = {
  month: string;
  rows: readonly AttendanceExcelRoster[];
  marks: readonly AttendanceExcelMark[];
  days: readonly AttendanceDay[];
};

export function getAttendanceExportPeriod(month: string): string {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) throw new RangeError('Month must be a valid YYYY-MM value.');
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${monthNames[Number(match[2]) - 1]}${match[1].slice(-2)}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function loadPublicLogo(fileName: string): Promise<Uint8Array> {
  const response = await fetch(`${import.meta.env.BASE_URL}brand/${fileName}`);
  if (!response.ok) throw new Error(`تعذر تحميل شعار ${fileName}.`);
  return new Uint8Array(await response.arrayBuffer());
}

function columnWidthPixels(width: number): number {
  return Math.floor(width * 7 + 5);
}

function autoFitColumnWidth(
  values: readonly (string | number | null | undefined)[],
  minimum: number,
  maximum: number,
  padding = 2,
): number {
  const contentWidth = values.reduce<number>((width, value) =>
    Math.max(width, String(value ?? '').length),
  0) + padding;
  return Math.min(maximum, Math.max(minimum, contentWidth));
}

function getColumnPosition(widths: readonly number[], targetPixels: number): number {
  let remainingPixels = targetPixels;
  for (const [index, width] of widths.entries()) {
    const columnPixels = columnWidthPixels(width);
    if (remainingPixels < columnPixels) return index + remainingPixels / columnPixels;
    remainingPixels -= columnPixels;
  }
  return widths.length;
}

function downloadWorkbook(output: ArrayBuffer, fileName: string): void {
  const url = URL.createObjectURL(new Blob([output], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function buildAttendanceWorkbook({
  month,
  rows,
  marks,
  days,
  tbcLogoBytes,
  safariLogoBytes,
  stampBytes,
}: AttendanceExcelData & AttendanceExcelAssets): Promise<import('exceljs').Workbook> {
  if (!rows.length) throw new Error('لا توجد بيانات لتحضير العمالة في هذا الشهر.');
  const period = getAttendanceExportPeriod(month);
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'شلفا لإدارة المرافق';
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet('Time Sheet');
  const widths = [
    autoFitColumnWidth(['S.No', ...rows.map(({ sort_no }) => sort_no)], 5, 8),
    autoFitColumnWidth(['School', ...rows.map(({ school_name }) => school_name)], 12, 61),
    autoFitColumnWidth(['Name', ...rows.map(({ worker_name }) => worker_name)], 12, 45),
    autoFitColumnWidth(['ID', ...rows.map(({ worker_id_number }) => worker_id_number)], 10, 16),
    ...days.map(({ day }) => autoFitColumnWidth([day, '✓'], 2.6, 4.5, 1)),
    autoFitColumnWidth(['Present Days'], 11.8, 14),
    autoFitColumnWidth(['Day Offs'], 8, 10),
    ...['A', 'UL', 'AL', 'SL', 'HL'].map((status) => autoFitColumnWidth([status], 3.5, 5, 1)),
    autoFitColumnWidth(['Remarks', ...rows.map(({ remarks }) => remarks)], 10, 30),
  ];
  widths.forEach((width, index) => {
    worksheet.getColumn(index + 1).width = width;
  });
  worksheet.properties.defaultRowHeight = 14.4;
  worksheet.pageSetup = {
    paperSize: 9,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: '1:4',
    margins: { left: 0.2, right: 0.2, top: 0.25, bottom: 0.45, header: 0.1, footer: 0.2 },
  };
  worksheet.headerFooter = {
    differentFirst: false,
    differentOddEven: false,
    oddFooter: `&CPage &P&R O&&M-TBC - ${period} Timesheet-1`,
    evenFooter: `&CPage &P&R O&&M-TBC - ${period} Timesheet-1`,
  };

  worksheet.getRow(1).height = 35.4;
  worksheet.getRow(2).height = 35.4;
  worksheet.getRow(3).height = 6;
  worksheet.getRow(4).height = 17.4;
  for (let rowNumber = 1; rowNumber <= 4; rowNumber += 1) {
    worksheet.getRow(rowNumber).eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { name: 'Calibri', size: 11 };
    });
  }

  const totalWidthPixels = widths.reduce((sum, width) => sum + columnWidthPixels(width), 0);
  const logoHeightPixels = LOGO_HEIGHT_INCHES * PIXELS_PER_INCH;
  const safariLogoWidthPixels = logoHeightPixels * SAFARI_LOGO_ASPECT_RATIO;
  const tbcLogoId = workbook.addImage({ base64: bytesToBase64(tbcLogoBytes), extension: 'png' });
  const safariLogoId = workbook.addImage({ base64: bytesToBase64(safariLogoBytes), extension: 'png' });
  worksheet.addImage(tbcLogoId, {
    tl: { col: 0.05, row: 0.05 },
    ext: { width: logoHeightPixels * TBC_LOGO_ASPECT_RATIO, height: logoHeightPixels },
  });
  worksheet.addImage(safariLogoId, {
    tl: { col: getColumnPosition(widths, totalWidthPixels - safariLogoWidthPixels), row: 0.02 },
    ext: { width: safariLogoWidthPixels, height: logoHeightPixels },
  });

  const headers = [
    'S.No', 'School', 'Name', 'ID',
    ...days.map(({ day }) => String(day)),
    'Present Days', 'Day Offs', 'A', 'UL', 'AL', 'SL', 'HL', 'Remarks',
  ];
  const header = worksheet.getRow(4);
  header.values = headers;
  const baseHeaderFill = 'FF3DB2BB';
  const gridBorder = { style: 'thin' as const, color: { argb: 'FF000000' } };
  const statusHeaderFills: Record<string, string> = {
    A: 'FFFFFF00',
    AL: 'FF66FF33',
    SL: 'FF00FFFF',
    HL: 'FFFF0000',
  };
  header.eachCell((cell, columnNumber) => {
    const label = String(cell.value ?? '');
    const day = days[columnNumber - 5];
    const fill = day
      ? day.isNonWorking || day.isFriday ? 'FF4472C4' : 'FFFF0000'
      : statusHeaderFills[label] ?? baseHeaderFill;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    cell.font = {
      name: 'Calibri',
      size: 11,
      color: { argb: fill === 'FF3DB2BB' || fill === 'FF4472C4' ? 'FFFFFFFF' : 'FF000000' },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: gridBorder,
      bottom: gridBorder,
      left: gridBorder,
      right: gridBorder,
    };
  });

  const marksByRoster = new Map<string, Set<string>>();
  for (const mark of marks) {
    const dates = marksByRoster.get(mark.roster_id) ?? new Set<string>();
    dates.add(mark.day.slice(0, 10));
    marksByRoster.set(mark.roster_id, dates);
  }
  for (const [index, roster] of rows.entries()) {
    const rowNumber = index + 5;
    const presentDates = marksByRoster.get(roster.id) ?? new Set<string>();
    const summary = summarizeAttendance(presentDates, days);
    const values: Array<string | number> = [
      roster.sort_no,
      roster.school_name,
      roster.worker_name,
      roster.worker_id_number ?? '',
      ...days.map(({ date }) => presentDates.has(date) ? '✓' : ''),
      summary.presentDays,
      summary.dayOffs,
      '',
      '',
      '',
      '',
      '',
      roster.remarks ?? '',
    ];
    const row = worksheet.getRow(rowNumber);
    row.values = values;
    row.height = 14.4;
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      const day = days[columnNumber - 5];
      const isBlueDay = day?.isNonWorking || day?.isFriday;
      cell.font = { name: 'Calibri', size: 11, color: { argb: isBlueDay ? 'FFFFFFFF' : 'FF000000' } };
      if (isBlueDay) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
      }
      cell.alignment = {
        vertical: 'middle',
        horizontal: columnNumber === 2 || columnNumber === 3 || columnNumber === headers.length ? 'left' : 'center',
      };
      cell.border = {
        top: gridBorder,
        bottom: gridBorder,
        left: gridBorder,
        right: gridBorder,
      };
    });
    const identityCell = row.getCell(4);
    identityCell.value = roster.worker_id_number ?? '';
    identityCell.numFmt = '@';
  }

  const rowsPerPage = 50;
  const pageCount = Math.ceil(rows.length / rowsPerPage);
  const lastPageEndRow = 4 + pageCount * rowsPerPage;
  for (let rowNumber = rows.length + 5; rowNumber <= lastPageEndRow; rowNumber += 1) {
    worksheet.getRow(rowNumber).height = 14.4;
  }
  worksheet.pageSetup.printArea = `A1:${worksheet.getColumn(headers.length).letter}${lastPageEndRow}`;
  const stampHeightPixels = STAMP_HEIGHT_INCHES * PIXELS_PER_INCH;
  const stampWidthPixels = stampHeightPixels * STAMP_ASPECT_RATIO;
  const stampHeightRows = (stampHeightPixels * 72 / PIXELS_PER_INCH) / 14.4;
  const stampBottomOffsetRows = (STAMP_BOTTOM_OFFSET_INCHES * 72) / 14.4;
  const stampColumn = getColumnPosition(widths, totalWidthPixels - stampWidthPixels);
  const stampId = workbook.addImage({ base64: bytesToBase64(stampBytes), extension: 'png' });
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const lastDataRow = 4 + (pageIndex + 1) * rowsPerPage;
    const stampTopRow = lastDataRow - stampHeightRows - stampBottomOffsetRows;
    worksheet.addImage(stampId, {
      tl: { col: stampColumn, row: stampTopRow },
      ext: { width: stampWidthPixels, height: stampHeightPixels },
    });
    if (pageIndex < pageCount - 1) worksheet.getRow(lastDataRow).addPageBreak();
  }

  return workbook;
}

export async function exportAttendanceXlsx(data: AttendanceExcelData & { stampBytes: Uint8Array }): Promise<void> {
  const [tbcLogoBytes, safariLogoBytes] = await Promise.all([
    loadPublicLogo('logo-tbc.png'),
    loadPublicLogo('logo-safari.png'),
  ]);
  const workbook = await buildAttendanceWorkbook({
    ...data,
    tbcLogoBytes,
    safariLogoBytes,
  });
  const period = getAttendanceExportPeriod(data.month);
  const output = await workbook.xlsx.writeBuffer();
  downloadWorkbook(output, `O&M-TBC - ${period} Timesheet-1.xlsx`);
}

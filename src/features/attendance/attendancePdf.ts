import { summarizeAttendance } from '../../domain/attendance';
import type { AttendanceDay } from '../../domain/attendance';
import cairoArabicBold from '@fontsource/cairo/files/cairo-arabic-700-normal.woff2?url';
import cairoArabicRegular from '@fontsource/cairo/files/cairo-arabic-400-normal.woff2?url';
import type { AttendanceExcelMark, AttendanceExcelRoster } from './attendanceExcel';
import { getAttendanceExportPeriod } from './attendanceExcel';

const ROWS_PER_PAGE = 50;
const A4_LANDSCAPE_CONTENT_WIDTH_MM = 285;
const PIXELS_PER_INCH = 96;
const LOGO_HEIGHT_INCHES = 0.59;
const STAMP_HEIGHT_INCHES = 1.76;
const STAMP_BOTTOM_OFFSET_INCHES = 1.5 / 2.54;
const TBC_LOGO_ASPECT_RATIO = 199 / 90;
const SAFARI_LOGO_ASPECT_RATIO = 173 / 93;
const STAMP_ASPECT_RATIO = 1111 / 387;

function columnWidthPixels(width: number): number {
  return Math.floor(width * 7 + 5);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function loadPublicImage(fileName: string): Promise<string> {
  const response = await fetch(`${import.meta.env.BASE_URL}brand/${fileName}`);
  if (!response.ok) throw new Error(`تعذر تحميل شعار ${fileName}.`);
  return `data:image/png;base64,${bytesToBase64(new Uint8Array(await response.arrayBuffer()))}`;
}

function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildPrintSection({
  sectionRows,
  days,
  marksByRoster,
  period,
  tbcLogo,
  safariLogo,
  stamp,
  columnWidths,
  totalWidthPixels,
  scale,
  pageNumber,
}: {
  sectionRows: readonly AttendanceExcelRoster[];
  days: readonly AttendanceDay[];
  marksByRoster: Map<string, Set<string>>;
  period: string;
  tbcLogo: string;
  safariLogo: string;
  stamp: string;
  columnWidths: readonly number[];
  totalWidthPixels: number;
  scale: number;
  pageNumber: number;
}): string {
  const colgroup = columnWidths.map((width) =>
    `<col style="width:${(columnWidthPixels(width) / totalWidthPixels * 100).toFixed(4)}%">`,
  ).join('');
  const dayHeaders = days.map((day) => {
    const isBlueDay = day.isNonWorking || day.isFriday;
    const color = isBlueDay ? '#4472C4' : '#FF0000';
    return `<th class="day ${isBlueDay ? 'non-working' : ''}" style="background:${color}">${escapeHtml(day.day)}</th>`;
  }).join('');

  const body = sectionRows.map((roster) => {
    const presentDates = marksByRoster.get(roster.id) ?? new Set<string>();
    const summary = summarizeAttendance(presentDates, days);
    const dayCells = days.map((day) => `<td class="day-cell ${day.isNonWorking || day.isFriday ? 'friday' : ''}">${presentDates.has(day.date) ? '&#10003;' : ''}</td>`).join('');
    return `<tr>
      <td class="number">${escapeHtml(roster.sort_no)}</td>
      <td class="school">${escapeHtml(roster.school_name)}</td>
      <td class="worker">${escapeHtml(roster.worker_name)}</td>
      <td class="identity">${escapeHtml(roster.worker_id_number)}</td>
      ${dayCells}
      <td class="present">${escapeHtml(summary.presentDays)}</td>
      <td class="day-off">${escapeHtml(summary.dayOffs)}</td>
      <td></td><td></td><td></td><td></td><td></td>
      <td class="remarks">${escapeHtml(roster.remarks)}</td>
    </tr>`;
  }).join('');

  return `<section class="print-section">
    <header class="sheet-header" style="--sheet-scale:${scale}">
      <div class="brand-row">
        <div class="brand-cell tbc"><img src="${tbcLogo}" alt="TBC"></div>
        <div class="brand-cell safari"><img src="${safariLogo}" alt="Safari"></div>
      </div>
      <div class="logo-spacer"></div>
      <table class="sheet-table">
        <colgroup>${colgroup}</colgroup>
        <thead>
          <tr class="header-row">
            <th>S.No</th><th>School</th><th>Name</th><th>ID</th>
            ${dayHeaders}
            <th class="present">Present Days</th><th class="day-off">Day Offs</th>
            <th class="status-a">A</th><th>UL</th><th class="status-al">AL</th><th class="status-sl">SL</th><th class="status-hl">HL</th>
            <th>Remarks</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </header>
    <footer class="sheet-footer">
      <span class="page-marker">Page ${pageNumber}</span>
      <span class="stamp-name">O&amp;M-TBC - ${escapeHtml(period)} Timesheet-1</span>
      <img class="stamp" src="${stamp}" alt="الختم والتوقيع">
    </footer>
  </section>`;
}

export function splitAttendancePdfRows<T>(rows: readonly T[], rowsPerPage = ROWS_PER_PAGE): T[][] {
  if (rowsPerPage < 1) throw new RangeError('rowsPerPage must be positive.');
  return Array.from({ length: Math.ceil(rows.length / rowsPerPage) }, (_, index) =>
    [...rows.slice(index * rowsPerPage, (index + 1) * rowsPerPage)],
  );
}

export async function printAttendancePdf({
  month,
  rows,
  marks,
  days,
  stampBytes,
}: {
  month: string;
  rows: readonly AttendanceExcelRoster[];
  marks: readonly AttendanceExcelMark[];
  days: readonly AttendanceDay[];
  stampBytes: Uint8Array;
}, printWindow: Window): Promise<void> {
  if (!rows.length) throw new Error('لا توجد بيانات لتحضير العمالة في هذا الشهر.');
  const [tbcLogo, safariLogo, cairoRegularBytes, cairoBoldBytes] = await Promise.all([
    loadPublicImage('logo-tbc.png'),
    loadPublicImage('logo-safari.png'),
    fetch(cairoArabicRegular).then(async (response) => {
      if (!response.ok) throw new Error('تعذر تحميل خط Cairo العربي.');
      return new Uint8Array(await response.arrayBuffer());
    }),
    fetch(cairoArabicBold).then(async (response) => {
      if (!response.ok) throw new Error('تعذر تحميل الخط العريض Cairo.');
      return new Uint8Array(await response.arrayBuffer());
    }),
  ]);
  const stamp = `data:image/png;base64,${bytesToBase64(stampBytes)}`;
  const cairoRegular = `data:font/woff2;base64,${bytesToBase64(cairoRegularBytes)}`;
  const cairoBold = `data:font/woff2;base64,${bytesToBase64(cairoBoldBytes)}`;
  const period = getAttendanceExportPeriod(month);
  const columnWidths = [
    5, 61, 45, 12,
    ...days.map(() => 2.6),
    11.8, 8,
    3.5, 3.5, 3.5, 3.5, 3.5,
    30,
  ];
  const totalWidthPixels = columnWidths.reduce((sum, width) => sum + columnWidthPixels(width), 0);
  const scale = Math.min(1, (A4_LANDSCAPE_CONTENT_WIDTH_MM * 96 / 25.4) / totalWidthPixels);
  const marksByRoster = new Map<string, Set<string>>();
  for (const mark of marks) {
    const dates = marksByRoster.get(mark.roster_id) ?? new Set<string>();
    dates.add(mark.day.slice(0, 10));
    marksByRoster.set(mark.roster_id, dates);
  }

  const sections = splitAttendancePdfRows(rows).map((sectionRows, index) =>
    buildPrintSection({
      sectionRows,
      days,
      marksByRoster,
      period,
      tbcLogo,
      safariLogo,
      stamp,
      columnWidths,
      totalWidthPixels,
      scale,
      pageNumber: index + 1,
    }),
  ).join('');

  printWindow.document.write(`<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <title>O&amp;M-TBC - ${escapeHtml(period)} Timesheet-1</title>
  <style>
    @font-face { font-family: Cairo; font-style: normal; font-weight: 400; src: url("${cairoRegular}") format("woff2"); }
    @font-face { font-family: Cairo; font-style: normal; font-weight: 700; src: url("${cairoBold}") format("woff2"); }
    @page { size: A4 landscape; margin: 6mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; font-family: Cairo, Calibri, Arial, sans-serif; color: #000; }
    body { direction: rtl; }
    .print-section { position: relative; width: 285mm; height: 198mm; page-break-after: always; break-after: page; overflow: hidden; }
    .print-section:last-child { page-break-after: auto; break-after: auto; }
    .sheet-header { width: 100%; }
    .brand-row { height: ${70.8 * scale}pt; display: flex; align-items: flex-start; justify-content: space-between; direction: ltr; }
    .brand-cell { height: ${70.8 * scale}pt; display: flex; align-items: flex-start; }
    .brand-cell.tbc img { width: ${LOGO_HEIGHT_INCHES * PIXELS_PER_INCH * TBC_LOGO_ASPECT_RATIO * scale}px; height: ${LOGO_HEIGHT_INCHES * PIXELS_PER_INCH * scale}px; object-fit: contain; }
    .brand-cell.safari img { width: ${LOGO_HEIGHT_INCHES * PIXELS_PER_INCH * SAFARI_LOGO_ASPECT_RATIO * scale}px; height: ${LOGO_HEIGHT_INCHES * PIXELS_PER_INCH * scale}px; object-fit: contain; }
    .logo-spacer { height: ${6 * scale}pt; }
    .sheet-table { table-layout: fixed; width: 100%; border-collapse: collapse; direction: ltr; font-size: ${11 * scale}px; font-family: Cairo, Calibri, Arial, sans-serif; }
    .sheet-table, .sheet-table * { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    .sheet-table th, .sheet-table td { border: 1px solid #000; height: ${14.4 * scale}pt; padding: 1px 2px; text-align: center; vertical-align: middle; overflow: hidden; white-space: nowrap; }
    .sheet-table .header-row th { height: ${17.4 * scale}pt; background: #3DB2BB; font-family: Cairo, Calibri, Arial, sans-serif; }
    .sheet-table th.present, .sheet-table td.present { background: #3DB2BB; }
    .sheet-table th.status-a { background: #FFFF00; }
    .sheet-table th.status-al { background: #66FF33; }
    .sheet-table th.status-sl { background: #00FFFF; }
    .sheet-table th.status-hl { background: #FF0000; }
    .sheet-table th.day { background: #FF0000; }
    .sheet-table th.day.non-working { background: #4472C4 !important; color: #fff; }
    .sheet-table td.friday { background: #4472C4 !important; color: #fff; }
    .sheet-table td.remarks { text-align: left; }
    .sheet-footer { direction: ltr; position: absolute; left: 0; right: 0; bottom: 0; height: ${STAMP_HEIGHT_INCHES * PIXELS_PER_INCH * scale}px; pointer-events: none; }
    .sheet-footer .stamp { position: absolute; right: 0; bottom: ${STAMP_BOTTOM_OFFSET_INCHES * PIXELS_PER_INCH * scale}px; width: ${STAMP_HEIGHT_INCHES * PIXELS_PER_INCH * STAMP_ASPECT_RATIO * scale}px; height: ${STAMP_HEIGHT_INCHES * PIXELS_PER_INCH * scale}px; object-fit: contain; }
    .sheet-footer .page-marker { position: absolute; left: 50%; bottom: 0; transform: translateX(-50%); font-size: 11px; }
    .sheet-footer .stamp-name { position: absolute; right: 0; bottom: 0; font-size: 11px; }
    @media print { html, body { width: 297mm; height: 210mm; } .print-section { margin: 0; } }
  </style>
</head>
<body>${sections}</body>
</html>`);
  printWindow.document.close();
  printWindow.focus();
  await printWindow.document.fonts.ready;
  await Promise.all([...(printWindow.document.images ? Array.from(printWindow.document.images).map((image) =>
    image.complete ? Promise.resolve() : new Promise<void>((resolve) => {
      image.onload = () => resolve();
      image.onerror = () => resolve();
    }),
  ) : [])]);
  printWindow.print();
}

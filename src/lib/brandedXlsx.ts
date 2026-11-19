export type BrandedWorksheet = {
  name: string;
  title: string;
  columns: string[];
  rows: Array<Array<string | number | null>>;
};

const colors = {
  banner: 'FF29375A',
  header: 'FF31416C',
  headerBorder: 'FF9EAFD2',
  text: 'FF24304D',
  rowBorder: 'FFE2E7F2',
  alternateRow: 'FFF1F3F9',
  subtitle: 'FF31416C',
};

export async function exportBrandedXlsx(fileName: string, sheets: BrandedWorksheet[]): Promise<void> {
  if (!sheets.length || sheets.some(({ columns }) => columns.length < 2)) {
    throw new Error('لا يمكن إنشاء ملف Excel دون أوراق وأعمدة صالحة.');
  }

  const response = await fetch(`${import.meta.env.BASE_URL}brand/logo.png`);
  if (!response.ok) throw new Error('تعذر تحميل شعار شلفا لإضافته إلى ملف Excel.');
  const logoBytes = new Uint8Array(await response.arrayBuffer());
  let logoBinary = '';
  for (const byte of logoBytes) logoBinary += String.fromCharCode(byte);

  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'شلفا لإدارة المرافق';
  workbook.created = new Date();
  const logoId = workbook.addImage({ base64: btoa(logoBinary), extension: 'png' });

  for (const { name, title, columns, rows } of sheets) {
    const worksheet = workbook.addWorksheet(name, {
      views: [{ rightToLeft: true, state: 'frozen', ySplit: 4 }],
    });

    worksheet.mergeCells(1, 1, 2, 1);
    worksheet.mergeCells(1, 2, 2, columns.length);
    for (let rowNumber = 1; rowNumber <= 2; rowNumber += 1) {
      for (let columnNumber = 1; columnNumber <= columns.length; columnNumber += 1) {
        worksheet.getCell(rowNumber, columnNumber).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: colors.banner },
        };
      }
    }
    worksheet.getCell(1, 1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFFFFF' },
    };
    const titleCell = worksheet.getCell(1, 2);
    titleCell.value = title;
    titleCell.font = { name: 'Cairo', size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    worksheet.getRow(1).height = 30;
    worksheet.getRow(2).height = 30;
    worksheet.addImage(logoId, { tl: { col: 0.1, row: 0.1 }, ext: { width: 145, height: 55 } });

    const subtitle = worksheet.getCell(3, 1);
    subtitle.value = `تاريخ التصدير: ${new Date().toLocaleString('ar-SA')}`;
    worksheet.mergeCells(3, 1, 3, columns.length);
    subtitle.font = { name: 'Cairo', size: 10, bold: true, color: { argb: colors.subtitle } };
    subtitle.alignment = { horizontal: 'right', vertical: 'middle' };
    worksheet.getRow(3).height = 24;

    const headerRow = worksheet.getRow(5);
    headerRow.values = columns;
    headerRow.height = 38;
    headerRow.eachCell((cell) => {
      cell.font = { name: 'Cairo', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.header } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = { bottom: { style: 'medium', color: { argb: colors.headerBorder } } };
    });

    columns.forEach((column, index) => {
      const longestValue = rows.reduce((longest, row) => Math.max(longest, String(row[index] ?? '').length), column.length);
      worksheet.getColumn(index + 1).width = Math.min(36, Math.max(15, longestValue + 3));
    });

    rows.forEach((values, index) => {
      const row = worksheet.getRow(index + 6);
      row.values = values;
      row.height = 30;
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.font = { name: 'Cairo', size: 10, color: { argb: colors.text } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = { bottom: { style: 'thin', color: { argb: colors.rowBorder } } };
        if (index % 2 === 1) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.alternateRow } };
        }
      });
    });

    worksheet.autoFilter = {
      from: { row: 5, column: 1 },
      to: { row: Math.max(5, rows.length + 5), column: columns.length },
    };
  }

  const output = await workbook.xlsx.writeBuffer();
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

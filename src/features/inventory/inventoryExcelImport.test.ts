import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { parseInventoryWorkbook } from './inventoryExcelImport';

describe('inventory Excel workbook parsing', () => {
  it('recovers item rows when a drawing part is malformed and reports that images were skipped', async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Inventory');
    worksheet.addRow(['Item', 'Logix code', 'Unit', 'Category', null, 'Notes']);
    worksheet.addRow(['Lamp', '1', 'piece', 'Electric', 0, '']);
    const imageId = workbook.addImage({
      base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS8sAAAAASUVORK5CYII=',
      extension: 'png',
    });
    worksheet.addImage(imageId, 'H2');

    const zip = await JSZip.loadAsync(await workbook.xlsx.writeBuffer());
    const drawingPath = Object.keys(zip.files).find((path) => /^xl\/drawings\/drawing\d+\.xml$/.test(path));
    expect(drawingPath).toBeDefined();
    if (!drawingPath) throw new Error('Test workbook did not produce a drawing part.');
    zip.file(drawingPath, '<xdr:notDrawing xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"/>');

    const damagedFile = new File([await zip.generateAsync({ type: 'arraybuffer' })], 'inventory.xlsx');
    const parsed = await parseInventoryWorkbook(damagedFile);

    expect(parsed.imagesUnavailable).toBe(true);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].name).toBe('Lamp');
    expect(parsed.rows[0].balanceText).toBe('0');
    expect(parsed.rows[0].images).toEqual([]);
  });
});

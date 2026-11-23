import type { Image, Worksheet } from 'exceljs';
import {
  getSpreadsheetRowFromImageAnchor,
  readImportedBalance,
  type ImportedImage,
  type InventoryImportRow,
} from './inventoryImportModel';

type WorkbookImageData = Pick<ImportedImage, 'blob' | 'previewUrl' | 'width' | 'height' | 'error'>;
type InventoryColumns = {
  headerRow: number;
  firstDataRow: number;
  item: number;
  code: number;
  unit: number;
  category: number;
  image: number | null;
  balance: number;
  notes: number | null;
};

const maximumWorkbookBytes = 25 * 1024 * 1024;
const maximumImageDimension = 800;

function normalizedHeader(value: unknown): string {
  return String(value ?? '').trim().toLocaleLowerCase().replace(/[\s_-]+/g, '');
}

function cachedValue(value: unknown): unknown {
  if (value && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value)) {
    return 'result' in value ? value.result : undefined;
  }
  return value;
}

function isExcelError(value: unknown): boolean {
  const resolved = cachedValue(value);
  return typeof resolved === 'string'
    ? /^#(?:VALUE!|N\/A|REF!|DIV\/0!|NAME\?|NUM!|NULL!)/i.test(resolved)
    : Boolean(resolved && typeof resolved === 'object' && 'error' in resolved);
}

function textFromCell(cell: { value: unknown; text: string }, useDisplayText = false): string {
  const value = cachedValue(cell.value);
  if (value === null || value === undefined || value === '') return '';
  if (isExcelError(cell.value)) return '';
  if (typeof value === 'number') return String(value);
  if (value instanceof Date || useDisplayText) return cell.text.trim();
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object' && 'text' in value && typeof value.text === 'string') return value.text.trim();
  if (typeof value === 'object' && 'richText' in value && Array.isArray(value.richText)) {
    return value.richText.map((part) => typeof part === 'object' && part !== null && 'text' in part ? String(part.text) : '').join('').trim();
  }
  return String(value).trim();
}

function findInventoryColumns(worksheet: Worksheet): InventoryColumns {
  const maximumHeaderRow = Math.min(10, worksheet.rowCount);
  let headerRow = 0;
  let itemColumn = 0;
  let codeColumn = 0;
  let unitColumn = 0;
  let categoryColumn = 0;
  for (let rowNumber = 1; rowNumber <= maximumHeaderRow; rowNumber += 1) {
    let foundItem = 0;
    let foundCode = 0;
    let foundUnit = 0;
    let foundCategory = 0;
    for (let column = 1; column <= worksheet.columnCount; column += 1) {
      const header = normalizedHeader(worksheet.getRow(rowNumber).getCell(column).value);
      if (header === 'item') foundItem = column;
      if (header === 'logixcode') foundCode = column;
      if (header === 'unit') foundUnit = column;
      if (header === 'category') foundCategory = column;
    }
    if (foundItem && foundCode && foundUnit && foundCategory) {
      headerRow = rowNumber;
      itemColumn = foundItem;
      codeColumn = foundCode;
      unitColumn = foundUnit;
      categoryColumn = foundCategory;
    }
  }
  if (!headerRow) {
    throw new Error('لم يُعثر على صف عناوين يحتوي Item وLogix code وUnit وCategory.');
  }

  const imageHeaders = new Set(['image', 'photo', 'picture', 'الصورة', 'الصوره', 'الصور']);
  let imageColumn: number | null = null;
  for (let rowNumber = 1; rowNumber <= maximumHeaderRow; rowNumber += 1) {
    for (let column = 1; column <= worksheet.columnCount; column += 1) {
      if (imageHeaders.has(normalizedHeader(worksheet.getRow(rowNumber).getCell(column).value))) imageColumn = column;
    }
  }
  if (!imageColumn) {
    const anchorsByColumn = new Map<number, number>();
    for (const image of worksheet.getImages()) {
      const column = image.range.tl.nativeCol + 1;
      anchorsByColumn.set(column, (anchorsByColumn.get(column) ?? 0) + 1);
    }
    imageColumn = [...anchorsByColumn].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
  }

  const noteHeaders = new Set(['notes', 'note', 'comments', 'ملاحظات', 'ملاحظة']);
  let notesColumn: number | null = null;
  const balanceHeaders = new Set(['balance', 'stock', 'quantity', 'الرصيد', 'رصيد']);
  let balanceColumn: number | null = null;
  for (let rowNumber = 1; rowNumber <= maximumHeaderRow; rowNumber += 1) {
    for (let column = 1; column <= worksheet.columnCount; column += 1) {
      const header = normalizedHeader(worksheet.getRow(rowNumber).getCell(column).value);
      if (noteHeaders.has(header)) notesColumn = column;
      if (balanceHeaders.has(header)) balanceColumn = column;
    }
  }

  const firstDataRow = headerRow + 1;
  if (!balanceColumn) {
    const candidates: Array<{ column: number; numericValues: number }> = [];
    for (let column = 1; column <= worksheet.columnCount; column += 1) {
      if ([itemColumn, codeColumn, unitColumn, categoryColumn, imageColumn, notesColumn].includes(column)) continue;
      let numericValues = 0;
      for (let rowNumber = firstDataRow; rowNumber <= worksheet.rowCount; rowNumber += 1) {
        const value = cachedValue(worksheet.getRow(rowNumber).getCell(column).value);
        if (typeof value === 'number' && Number.isFinite(value)) numericValues += 1;
      }
      if (numericValues > 0) candidates.push({ column, numericValues });
    }
    balanceColumn = candidates.sort((left, right) => right.numericValues - left.numericValues)[0]?.column ?? null;
  }
  if (!balanceColumn) {
    throw new Error('لم يُعثر على عمود الرصيد الرقمي ذي العنوان الفارغ.');
  }

  if (!notesColumn) {
    const candidates: number[] = [];
    for (let column = balanceColumn + 1; column <= worksheet.columnCount; column += 1) {
      if (column === imageColumn) continue;
      for (let rowNumber = firstDataRow; rowNumber <= worksheet.rowCount; rowNumber += 1) {
        const value = cachedValue(worksheet.getRow(rowNumber).getCell(column).value);
        if (value !== null && value !== undefined && value !== '') {
          candidates.push(column);
          break;
        }
      }
    }
    notesColumn = candidates[candidates.length - 1] ?? null;
  }

  return {
    headerRow,
    firstDataRow,
    item: itemColumn,
    code: codeColumn,
    unit: unitColumn,
    category: categoryColumn,
    image: imageColumn,
    balance: balanceColumn,
    notes: notesColumn,
  };
}

function sourceImageBlob(image: Image): Blob {
  const mimeType = image.extension === 'png'
    ? 'image/png'
    : image.extension === 'gif'
      ? 'image/gif'
      : 'image/jpeg';
  if (image.buffer) {
    return new Blob([image.buffer], { type: mimeType });
  }
  if (image.base64) {
    const base64 = image.base64.includes(',') ? image.base64.slice(image.base64.indexOf(',') + 1) : image.base64;
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new Blob([bytes.buffer], { type: mimeType });
  }
  throw new Error('الصورة المضمنة لا تحتوي بيانات قابلة للقراءة.');
}

async function compressWorkbookImage(image: Image): Promise<WorkbookImageData> {
  const source = sourceImageBlob(image);
  const bitmap = await createImageBitmap(source);
  try {
    const scale = Math.min(1, maximumImageDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('تعذر تجهيز الصورة للتحويل.');
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (!result) reject(new Error('تعذر ضغط الصورة.'));
        else if (result.type !== 'image/webp') reject(new Error('المتصفح لا يدعم حفظ الصور بصيغة WebP.'));
        else resolve(result);
      }, 'image/webp', 0.82);
    });
    return { blob, previewUrl: URL.createObjectURL(blob), width, height, error: null };
  } finally {
    bitmap.close();
  }
}

export async function parseInventoryWorkbook(file: File): Promise<InventoryImportRow[]> {
  if (!file.name.toLocaleLowerCase().endsWith('.xlsx')) {
    throw new Error('اختر ملف Excel بصيغة .xlsx.');
  }
  if (!file.size || file.size > maximumWorkbookBytes) {
    throw new Error('يجب ألا يتجاوز حجم ملف Excel ‏25 ميجابايت.');
  }

  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const worksheet = workbook.worksheets.find((candidate) => {
    try {
      findInventoryColumns(candidate);
      return true;
    } catch {
      return false;
    }
  });
  if (!worksheet) throw new Error('لم يُعثر على ورقة تحتوي أعمدة الأصناف المطلوبة.');

  const columns = findInventoryColumns(worksheet);
  const imagePlacementsByRow = new Map<number, Set<string>>();
  if (columns.image !== null) {
    for (const placement of worksheet.getImages()) {
      if (placement.range.tl.nativeCol + 1 !== columns.image) continue;
      const rowNumber = getSpreadsheetRowFromImageAnchor(placement.range.tl.row);
      if (rowNumber < columns.firstDataRow || rowNumber > worksheet.rowCount) continue;
      const imageIds = imagePlacementsByRow.get(rowNumber) ?? new Set<string>();
      imageIds.add(String(placement.imageId));
      imagePlacementsByRow.set(rowNumber, imageIds);
    }
  }

  const referencedImageIds = new Set([...imagePlacementsByRow.values()].flatMap((ids) => [...ids]));
  const imageData = new Map<string, WorkbookImageData>();
  const uniqueIds = [...referencedImageIds];
  for (let start = 0; start < uniqueIds.length; start += 4) {
    const batch = uniqueIds.slice(start, start + 4);
    const results = await Promise.all(batch.map(async (id): Promise<[string, WorkbookImageData]> => {
      try {
        return [id, await compressWorkbookImage(workbook.getImage(Number(id)))];
      } catch (error) {
        return [id, { blob: null, previewUrl: null, width: null, height: null, error: error instanceof Error ? error.message : 'تعذر قراءة الصورة.' }];
      }
    }));
    results.forEach(([id, image]) => imageData.set(id, image));
  }

  const rows: InventoryImportRow[] = [];
  for (let rowNumber = columns.firstDataRow; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const sheetRow = worksheet.getRow(rowNumber);
    const itemCell = sheetRow.getCell(columns.item);
    const codeCell = sheetRow.getCell(columns.code);
    const unitCell = sheetRow.getCell(columns.unit);
    const categoryCell = sheetRow.getCell(columns.category);
    const balanceCell = sheetRow.getCell(columns.balance);
    const noteCell = columns.notes ? sheetRow.getCell(columns.notes) : null;
    const valueErrors: string[] = [];
    for (let column = 1; column <= worksheet.columnCount; column += 1) {
      const cell = sheetRow.getCell(column);
      if (isExcelError(cell.value)) valueErrors.push(`${cell.address}: ${String(cachedValue(cell.value) ?? '#VALUE!')}`);
    }

    const images = [...(imagePlacementsByRow.get(rowNumber) ?? [])].map((id): ImportedImage => ({
      id,
      ...(imageData.get(id) ?? { blob: null, previewUrl: null, width: null, height: null, error: 'تعذر قراءة الصورة.' }),
    }));
    const itemName = textFromCell(itemCell);
    const logixCode = textFromCell(codeCell);
    const unit = textFromCell(unitCell);
    const category = textFromCell(categoryCell);
    const balance = readImportedBalance(balanceCell.value);
    const notes = noteCell ? textFromCell(noteCell, true) : '';
    if (!itemName && !logixCode && !unit && !category && !balance.balanceText && !notes && !valueErrors.length && !images.length) {
      continue;
    }

    rows.push({
      rowNumber,
      name: itemName,
      logixCode,
      unit,
      category,
      notes,
      ...balance,
      valueErrors,
      images,
      selectedImageId: images.find((image) => !image.error)?.id ?? null,
      ignored: false,
      allowMissingCode: false,
      ignoreValueErrors: false,
      skipUnreadableImages: false,
      existingMatchId: null,
      matchAsNew: false,
    });
  }
  if (!rows.length) throw new Error('لم يُعثر على صفوف أصناف للاستيراد.');
  return rows;
}

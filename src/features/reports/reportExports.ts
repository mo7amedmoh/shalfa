import type JSZip from 'jszip';

export interface ReportPhoto {
  file: File;
  dataUrl: string;
  pngDataUrl: string;
}

export interface SchoolReportDetails {
  school: string;
  ministryCode: string;
  district: string;
  date: string;
}

const pptNamespace = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const drawingNamespace = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const officeRelationshipNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const packageRelationshipNamespace = 'http://schemas.openxmlformats.org/package/2006/relationships';
const spreadsheetNamespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const spreadsheetDrawingNamespace = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
const contentTypesNamespace = 'http://schemas.openxmlformats.org/package/2006/content-types';
const pointsPerInch = 914400;
const photoLefts = [0.359, 2.534, 4.709, 6.893];
const photoTops = [0.929, 2.937, 4.904];
const photoFrameWidth = 2.142;
const photoWidth = 2.15;
const photoHeight = 1.66;

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function parseXml(xml: string, fileName: string): XMLDocument {
  const documentValue = new DOMParser().parseFromString(xml, 'application/xml');
  if (documentValue.querySelector('parsererror')) {
    throw new Error(`تعذر قراءة جزء ${fileName} من القالب.`);
  }
  return documentValue;
}

function serializeXml(documentValue: XMLDocument): string {
  return new XMLSerializer().serializeToString(documentValue);
}

async function readXml(zip: JSZip, path: string): Promise<XMLDocument> {
  const entry = zip.file(path);
  if (!entry) throw new Error(`القالب لا يحتوي على الملف المطلوب: ${path}`);
  return parseXml(await entry.async('text'), path);
}

function relationFilePath(slidePath: string): string {
  const [folder, fileName] = slidePath.split('/').slice(-2);
  return `ppt/${folder}/_rels/${fileName}.rels`;
}

function relationTargetPath(target: string): string {
  return target.startsWith('/') ? target.slice(1) : `ppt/${target.replace(/^\.\.\//, '')}`;
}

function getSlidePaths(
  presentation: XMLDocument,
  presentationRelationships: XMLDocument,
): string[] {
  const targets = new Map(
    Array.from(presentationRelationships.getElementsByTagNameNS(packageRelationshipNamespace, 'Relationship'))
      .map((relationship) => [relationship.getAttribute('Id') ?? '', relationship.getAttribute('Target') ?? '']),
  );
  const slideIds = Array.from(presentation.getElementsByTagNameNS(pptNamespace, 'sldId'));
  return slideIds.map((slideId) => {
    const target = targets.get(slideId.getAttributeNS(officeRelationshipNamespace, 'id') ?? '');
    if (!target) throw new Error('تعذر مطابقة شرائح القالب.');
    return relationTargetPath(target);
  });
}

function replaceTextInCell(
  rows: Element[],
  rowIndex: number,
  columnIndex: number,
  value: string,
) {
  const cells = rows[rowIndex]?.getElementsByTagNameNS(drawingNamespace, 'tc');
  const cell = cells?.[columnIndex];
  if (!cell) throw new Error('جدول بيانات التقرير في قالب PowerPoint لا يحتوي الخانات المطلوبة.');
  const textNodes = Array.from(cell.getElementsByTagNameNS(drawingNamespace, 't'));
  if (textNodes.length) {
    textNodes[0].textContent = value;
    textNodes.slice(1).forEach((node) => { node.textContent = ''; });
    return;
  }
  const paragraph = cell.getElementsByTagNameNS(drawingNamespace, 'p')[0];
  if (!paragraph) throw new Error('إحدى خانات جدول التقرير لا تحتوي على فقرة قابلة للتحرير.');
  const run = paragraph.ownerDocument.createElementNS(drawingNamespace, 'a:r');
  const runProperties = paragraph.ownerDocument.createElementNS(drawingNamespace, 'a:rPr');
  runProperties.setAttribute('lang', 'ar-SA');
  const text = paragraph.ownerDocument.createElementNS(drawingNamespace, 'a:t');
  text.textContent = value;
  run.append(runProperties, text);
  const endProperties = paragraph.getElementsByTagNameNS(drawingNamespace, 'endParaRPr')[0];
  paragraph.insertBefore(run, endProperties ?? null);
}

function setPowerPointDetails(slide: XMLDocument, details: SchoolReportDetails) {
  const tables = Array.from(slide.getElementsByTagNameNS(drawingNamespace, 'tbl'));
  if (!tables.length) throw new Error('لم يتم العثور على جدول بيانات التقرير في الشريحة الثانية.');
  const rows = Array.from(tables[0].getElementsByTagNameNS(drawingNamespace, 'tr'));
  if (rows.length < 3) throw new Error('جدول بيانات التقرير لا يحتوي على الصفوف المطلوبة.');
  replaceTextInCell(rows, 0, 1, details.ministryCode);
  replaceTextInCell(rows, 1, 1, details.school);
  replaceTextInCell(rows, 2, 0, 'الحي / المنطقة');
  replaceTextInCell(rows, 2, 1, details.district);
  if (details.date && rows.length > 3) replaceTextInCell(rows, 3, 1, details.date);
}

function addPictureElement(
  slide: XMLDocument,
  relationshipId: string,
  shapeId: number,
  left: number,
  top: number,
  name: string,
) {
  const picture = slide.createElementNS(pptNamespace, 'p:pic');
  const nonVisual = slide.createElementNS(pptNamespace, 'p:nvPicPr');
  const properties = slide.createElementNS(pptNamespace, 'p:cNvPr');
  properties.setAttribute('id', String(shapeId));
  properties.setAttribute('name', name);
  const pictureProperties = slide.createElementNS(pptNamespace, 'p:cNvPicPr');
  const locks = slide.createElementNS(drawingNamespace, 'a:picLocks');
  locks.setAttribute('noChangeAspect', '1');
  pictureProperties.appendChild(locks);
  nonVisual.append(properties, pictureProperties, slide.createElementNS(pptNamespace, 'p:nvPr'));

  const fill = slide.createElementNS(pptNamespace, 'p:blipFill');
  const blip = slide.createElementNS(drawingNamespace, 'a:blip');
  blip.setAttributeNS(officeRelationshipNamespace, 'r:embed', relationshipId);
  fill.append(blip);
  const stretch = slide.createElementNS(drawingNamespace, 'a:stretch');
  stretch.appendChild(slide.createElementNS(drawingNamespace, 'a:fillRect'));
  fill.appendChild(stretch);

  const shapeProperties = slide.createElementNS(pptNamespace, 'p:spPr');
  const transform = slide.createElementNS(drawingNamespace, 'a:xfrm');
  const offset = slide.createElementNS(drawingNamespace, 'a:off');
  offset.setAttribute('x', String(Math.round(left * pointsPerInch)));
  offset.setAttribute('y', String(Math.round(top * pointsPerInch)));
  const extent = slide.createElementNS(drawingNamespace, 'a:ext');
  extent.setAttribute('cx', String(Math.round(photoWidth * pointsPerInch)));
  extent.setAttribute('cy', String(Math.round(photoHeight * pointsPerInch)));
  transform.append(offset, extent);
  shapeProperties.append(transform);
  const geometry = slide.createElementNS(drawingNamespace, 'a:prstGeom');
  geometry.setAttribute('prst', 'rect');
  geometry.appendChild(slide.createElementNS(drawingNamespace, 'a:avLst'));
  shapeProperties.appendChild(geometry);
  picture.append(nonVisual, fill, shapeProperties);

  const tree = slide.getElementsByTagNameNS(pptNamespace, 'spTree')[0];
  if (!tree) throw new Error('تعذر إضافة الصور إلى شريحة التقرير.');
  tree.appendChild(picture);
}

function nextRelationshipId(relationships: XMLDocument): string {
  const ids = Array.from(relationships.getElementsByTagNameNS(packageRelationshipNamespace, 'Relationship'))
    .map((relationship) => Number((relationship.getAttribute('Id') ?? '').replace(/^rId/, '')))
    .filter(Number.isFinite);
  return `rId${Math.max(0, ...ids) + 1}`;
}

function addPhotoToSlide(
  zip: JSZip,
  slidePath: string,
  slide: XMLDocument,
  photo: ReportPhoto,
  photoIndex: number,
  row: number,
  column: number,
): Promise<void> {
  return (async () => {
    const relationshipsPath = relationFilePath(slidePath);
    const relationships = await readXml(zip, relationshipsPath);
    const relationshipId = nextRelationshipId(relationships);
    let mediaName = `shalfa-report-photo-${photoIndex}.png`;
    let suffix = 1;
    while (zip.file(`ppt/media/${mediaName}`)) {
      mediaName = `shalfa-report-photo-${photoIndex}-${suffix}.png`;
      suffix += 1;
    }
    const base64 = photo.pngDataUrl.slice(photo.pngDataUrl.indexOf(',') + 1);
    zip.file(`ppt/media/${mediaName}`, base64, { base64: true });

    const relationship = relationships.createElementNS(packageRelationshipNamespace, 'Relationship');
    relationship.setAttribute('Id', relationshipId);
    relationship.setAttribute('Type', `${officeRelationshipNamespace}/image`);
    relationship.setAttribute('Target', `../media/${mediaName}`);
    relationships.documentElement.appendChild(relationship);
    zip.file(relationshipsPath, serializeXml(relationships));

    const left = photoLefts[column] + (photoFrameWidth - photoWidth) / 2;
    addPictureElement(slide, relationshipId, 5000 + photoIndex, left, photoTops[row], photo.file.name);
  })();
}

function addBeforeAfterPhotos(
  zip: JSZip,
  slidePath: string,
  slide: XMLDocument,
  before: ReportPhoto[],
  after: ReportPhoto[],
  pageIndex: number,
  photoStartIndex: number,
): Promise<number> {
  return (async () => {
    let photoIndex = photoStartIndex;
    const add = async (photos: ReportPhoto[], columns: number[]) => {
      for (let index = 0; index < photos.length; index += 1) {
        await addPhotoToSlide(
          zip,
          slidePath,
          slide,
          photos[index],
          photoIndex,
          Math.floor(index / 2),
          columns[index % 2],
        );
        photoIndex += 1;
      }
    };
    await add(after.slice(pageIndex * 6, (pageIndex + 1) * 6), [0, 2]);
    await add(before.slice(pageIndex * 6, (pageIndex + 1) * 6), [1, 3]);
    return photoIndex;
  })();
}

async function addGeneralPhotos(
  zip: JSZip,
  slidePath: string,
  slide: XMLDocument,
  photos: ReportPhoto[],
  pageIndex: number,
  photoStartIndex: number,
): Promise<number> {
  let photoIndex = photoStartIndex;
  const pagePhotos = photos.slice(pageIndex * 12, (pageIndex + 1) * 12);
  for (let index = 0; index < pagePhotos.length; index += 1) {
    await addPhotoToSlide(zip, slidePath, slide, pagePhotos[index], photoIndex, Math.floor(index / 4), index % 4);
    photoIndex += 1;
  }
  return photoIndex;
}

function replaceBeforeAfterLabels(slide: XMLDocument, schoolName: string) {
  Array.from(slide.getElementsByTagNameNS(drawingNamespace, 't')).forEach((node) => {
    if (node.textContent?.trim() === 'قبل' || node.textContent?.trim() === 'بعد') {
      node.textContent = schoolName;
    }
  });
}

function addSlideRelationship(
  relationships: XMLDocument,
  relationshipId: string,
  slidePath: string,
) {
  const relationship = relationships.createElementNS(packageRelationshipNamespace, 'Relationship');
  relationship.setAttribute('Id', relationshipId);
  relationship.setAttribute('Type', `${officeRelationshipNamespace}/slide`);
  relationship.setAttribute('Target', slidePath.replace(/^ppt\//, ''));
  relationships.documentElement.appendChild(relationship);
}

function addSlideContentType(contentTypes: XMLDocument, slidePath: string) {
  const override = contentTypes.createElementNS(
    'http://schemas.openxmlformats.org/package/2006/content-types',
    'Override',
  );
  override.setAttribute('PartName', `/${slidePath}`);
  override.setAttribute('ContentType', 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml');
  contentTypes.documentElement.appendChild(override);
}

function addPngContentType(contentTypes: XMLDocument) {
  const pngContentType = Array.from(
    contentTypes.getElementsByTagNameNS('http://schemas.openxmlformats.org/package/2006/content-types', 'Default'),
  ).some((entry) => entry.getAttribute('Extension')?.toLowerCase() === 'png');
  if (pngContentType) return;
  const definition = contentTypes.createElementNS(
    'http://schemas.openxmlformats.org/package/2006/content-types',
    'Default',
  );
  definition.setAttribute('Extension', 'png');
  definition.setAttribute('ContentType', 'image/png');
  contentTypes.documentElement.appendChild(definition);
}

export async function exportPowerPointReport(
  template: File,
  details: SchoolReportDetails,
  mode: 'before-after' | 'general',
  before: ReportPhoto[],
  after: ReportPhoto[],
  general: ReportPhoto[],
  fileName: string,
): Promise<void> {
  const { default: JSZipModule } = await import('jszip');
  const zip = await JSZipModule.loadAsync(template);
  const presentation = await readXml(zip, 'ppt/presentation.xml');
  const presentationRelationships = await readXml(zip, 'ppt/_rels/presentation.xml.rels');
  const slidePaths = getSlidePaths(presentation, presentationRelationships);
  if (slidePaths.length < 3) throw new Error('يجب أن يحتوي قالب PowerPoint على ثلاث شرائح على الأقل.');
  const detailsSlide = await readXml(zip, slidePaths[1]);
  setPowerPointDetails(detailsSlide, details);

  const templatePhotoSlide = await readXml(zip, slidePaths[2]);
  const pageCount = mode === 'general'
    ? Math.max(1, Math.ceil(general.length / 12))
    : Math.max(1, Math.ceil(before.length / 6), Math.ceil(after.length / 6));
  const slideList = presentation.getElementsByTagNameNS(pptNamespace, 'sldIdLst')[0];
  const originalSlideId = Array.from(slideList?.children ?? [])
    .find((slideId) => slideId.getAttributeNS(officeRelationshipNamespace, 'id')
      === Array.from(presentationRelationships.getElementsByTagNameNS(packageRelationshipNamespace, 'Relationship'))
        .find((relationship) => relationTargetPath(relationship.getAttribute('Target') ?? '') === slidePaths[2])
        ?.getAttribute('Id'));
  if (!slideList || !originalSlideId) throw new Error('تعذر تحديد شريحة الصور في قالب PowerPoint.');

  const contentTypes = await readXml(zip, '[Content_Types].xml');
  addPngContentType(contentTypes);
  const templatePhotoSlideXml = serializeXml(templatePhotoSlide);
  const allSlideNumbers = Object.keys(zip.files)
    .map((path) => path.match(/^ppt\/slides\/slide(\d+)\.xml$/)?.[1])
    .filter((value): value is string => Boolean(value))
    .map(Number);
  const presentationSlideIds = Array.from(slideList.children)
    .map((slideId) => Number(slideId.getAttribute('id')))
    .filter(Number.isFinite);
  let nextSlideNumber = Math.max(0, ...allSlideNumbers) + 1;
  let nextSlideId = Math.max(255, ...presentationSlideIds) + 1;
  let nextPresentationRelationshipId = nextRelationshipId(presentationRelationships);
  let photoIndex = 0;
  let previousSlideId = originalSlideId;

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const isOriginal = pageIndex === 0;
    const slidePath = isOriginal ? slidePaths[2] : `ppt/slides/slide${nextSlideNumber++}.xml`;
    const slide = isOriginal ? templatePhotoSlide : parseXml(templatePhotoSlideXml, slidePath);
    const relationshipsPath = relationFilePath(slidePaths[2]);
    if (!isOriginal) {
      const sourceRelationships = await readXml(zip, relationshipsPath);
      zip.file(relationFilePath(slidePath), serializeXml(sourceRelationships));
      const newRelationshipId = nextPresentationRelationshipId;
      nextPresentationRelationshipId = `rId${Number(newRelationshipId.replace(/^rId/, '')) + 1}`;
      addSlideRelationship(presentationRelationships, newRelationshipId, slidePath);

      const slideId = presentation.createElementNS(pptNamespace, 'p:sldId');
      slideId.setAttribute('id', String(nextSlideId++));
      slideId.setAttributeNS(officeRelationshipNamespace, 'r:id', newRelationshipId);
      previousSlideId.parentNode?.insertBefore(slideId, previousSlideId.nextSibling);
      previousSlideId = slideId;
      addSlideContentType(contentTypes, slidePath);
    }

    if (mode === 'general') {
      replaceBeforeAfterLabels(slide, details.school);
      photoIndex = await addGeneralPhotos(zip, slidePath, slide, general, pageIndex, photoIndex);
    } else {
      photoIndex = await addBeforeAfterPhotos(zip, slidePath, slide, before, after, pageIndex, photoIndex);
    }
    zip.file(slidePath, serializeXml(slide));
  }

  zip.file(slidePaths[1], serializeXml(detailsSlide));
  zip.file('ppt/presentation.xml', serializeXml(presentation));
  zip.file('ppt/_rels/presentation.xml.rels', serializeXml(presentationRelationships));
  zip.file('[Content_Types].xml', serializeXml(contentTypes));
  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  });
  downloadBlob(blob, fileName);
}

function packagePathFromTarget(baseDirectory: string, target: string): string {
  const segments = target.startsWith('/') ? [] : baseDirectory.split('/').filter(Boolean);
  for (const segment of target.replace(/^\//, '').split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  return segments.join('/');
}

function relationshipsPathForPart(partPath: string): string {
  const separator = partPath.lastIndexOf('/');
  return `${partPath.slice(0, separator)}/_rels/${partPath.slice(separator + 1)}.rels`;
}

function createRelationshipsDocument(): XMLDocument {
  return parseXml(
    `<Relationships xmlns="${packageRelationshipNamespace}"></Relationships>`,
    'relationships',
  );
}

function findRelationship(documentValue: XMLDocument, relationshipId: string): Element | undefined {
  return Array.from(documentValue.getElementsByTagNameNS(packageRelationshipNamespace, 'Relationship'))
    .find((relationship) => relationship.getAttribute('Id') === relationshipId);
}

function nextPartNumber(zip: JSZip, pattern: RegExp): number {
  const numbers = Object.keys(zip.files)
    .map((path) => path.match(pattern)?.[1])
    .filter((value): value is string => Boolean(value))
    .map(Number);
  return Math.max(0, ...numbers) + 1;
}

async function worksheetPart(zip: JSZip, name?: string): Promise<{ path: string; document: XMLDocument }> {
  const [workbook, relationships] = await Promise.all([
    readXml(zip, 'xl/workbook.xml'),
    readXml(zip, 'xl/_rels/workbook.xml.rels'),
  ]);
  const sheets = Array.from(workbook.getElementsByTagNameNS(spreadsheetNamespace, 'sheet'));
  const sheet = name
    ? sheets.find((item) => item.getAttribute('name') === name)
    : sheets.find((item) => !['hidden', 'veryHidden'].includes(item.getAttribute('state') ?? 'visible'));
  if (!sheet) {
    throw new Error(name
      ? `التبويب ${name} غير موجود في الملف المرجعي.`
      : 'قالب Excel لا يحتوي على ورقة عمل ظاهرة لتقرير النظافة.');
  }
  if (!name) {
    const sheetIndex = sheets.indexOf(sheet);
    Array.from(workbook.getElementsByTagNameNS(spreadsheetNamespace, 'workbookView'))
      .forEach((view) => view.setAttribute('activeTab', String(sheetIndex)));
    zip.file('xl/workbook.xml', serializeXml(workbook));
  }
  const relationshipId = sheet.getAttributeNS(officeRelationshipNamespace, 'id');
  const relationship = relationshipId ? findRelationship(relationships, relationshipId) : undefined;
  const target = relationship?.getAttribute('Target');
  if (!target) throw new Error(`تعذر تحديد ملف التبويب ${name ?? ''}.`);
  const path = packagePathFromTarget('xl', target);
  return { path, document: await readXml(zip, path) };
}

function columnNumber(column: string): number {
  return [...column.toUpperCase()].reduce((value, character) => (
    value * 26 + character.charCodeAt(0) - 64
  ), 0);
}

function cellCoordinates(address: string): { column: number; row: number; address: string } {
  const match = address.toUpperCase().match(/^([A-Z]+)(\d+)$/);
  if (!match) throw new Error(`عنوان خلية غير صالح: ${address}`);
  return { column: columnNumber(match[1]), row: Number(match[2]), address: `${match[1]}${match[2]}` };
}

function topLeftOfMergedCell(worksheet: XMLDocument, address: string): string {
  const target = cellCoordinates(address);
  const mergedRanges = Array.from(worksheet.getElementsByTagNameNS(spreadsheetNamespace, 'mergeCell'));
  for (const range of mergedRanges) {
    const [startAddress, endAddress = startAddress] = (range.getAttribute('ref') ?? '').split(':');
    const start = cellCoordinates(startAddress);
    const end = cellCoordinates(endAddress);
    if (target.column >= start.column && target.column <= end.column
      && target.row >= start.row && target.row <= end.row) return start.address;
  }
  return target.address;
}

function findOrCreateCell(worksheet: XMLDocument, address: string): Element {
  const reference = cellCoordinates(address);
  let sheetData = worksheet.getElementsByTagNameNS(spreadsheetNamespace, 'sheetData')[0];
  if (!sheetData) {
    sheetData = worksheet.createElementNS(spreadsheetNamespace, 'sheetData');
    worksheet.documentElement.appendChild(sheetData);
  }
  let row = Array.from(sheetData.getElementsByTagNameNS(spreadsheetNamespace, 'row'))
    .find((candidate) => Number(candidate.getAttribute('r')) === reference.row);
  if (!row) {
    row = worksheet.createElementNS(spreadsheetNamespace, 'row');
    row.setAttribute('r', String(reference.row));
    const followingRow = Array.from(sheetData.children).find((candidate) => (
      Number(candidate.getAttribute('r')) > reference.row
    ));
    sheetData.insertBefore(row, followingRow ?? null);
  }
  const existingCell = Array.from(row.getElementsByTagNameNS(spreadsheetNamespace, 'c'))
    .find((candidate) => candidate.getAttribute('r') === reference.address);
  if (existingCell) return existingCell;
  const cell = worksheet.createElementNS(spreadsheetNamespace, 'c');
  cell.setAttribute('r', reference.address);
  const followingCell = Array.from(row.getElementsByTagNameNS(spreadsheetNamespace, 'c')).find((candidate) => {
    const existing = candidate.getAttribute('r')?.match(/^([A-Z]+)/);
    return existing ? columnNumber(existing[1]) > reference.column : false;
  });
  row.insertBefore(cell, followingCell ?? null);
  return cell;
}

function setWorksheetCellValue(worksheet: XMLDocument, address: string, value: string | number) {
  const cell = findOrCreateCell(worksheet, topLeftOfMergedCell(worksheet, address));
  Array.from(cell.children).forEach((child) => {
    if (['f', 'v', 'is'].includes(child.localName)) cell.removeChild(child);
  });
  if (typeof value === 'string') {
    cell.setAttribute('t', 'inlineStr');
    const inlineString = worksheet.createElementNS(spreadsheetNamespace, 'is');
    const text = worksheet.createElementNS(spreadsheetNamespace, 't');
    if (/^\s|\s$/.test(value)) text.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
    text.textContent = value;
    inlineString.appendChild(text);
    const extensionList = Array.from(cell.children).find((child) => child.localName === 'extLst');
    cell.insertBefore(inlineString, extensionList ?? null);
    return;
  }
  cell.setAttribute('t', 'n');
  const numericValue = worksheet.createElementNS(spreadsheetNamespace, 'v');
  numericValue.textContent = String(value);
  const extensionList = Array.from(cell.children).find((child) => child.localName === 'extLst');
  cell.insertBefore(numericValue, extensionList ?? null);
}

async function readWorksheetCellText(zip: JSZip, worksheet: XMLDocument, address: string): Promise<string> {
  const reference = topLeftOfMergedCell(worksheet, address);
  const cell = Array.from(worksheet.getElementsByTagNameNS(spreadsheetNamespace, 'c'))
    .find((candidate) => candidate.getAttribute('r') === reference);
  if (!cell) return '';
  if (cell.getAttribute('t') === 'inlineStr') {
    return Array.from(cell.getElementsByTagNameNS(spreadsheetNamespace, 't'))
      .map((text) => text.textContent ?? '')
      .join('');
  }
  const value = cell.getElementsByTagNameNS(spreadsheetNamespace, 'v')[0]?.textContent ?? '';
  if (cell.getAttribute('t') !== 's') return value;
  const sharedStringsFile = zip.file('xl/sharedStrings.xml');
  if (!sharedStringsFile) throw new Error('القالب يشير إلى نصوص مشتركة غير موجودة.');
  const sharedStrings = parseXml(await sharedStringsFile.async('text'), 'xl/sharedStrings.xml');
  const sharedValue = Array.from(sharedStrings.getElementsByTagNameNS(spreadsheetNamespace, 'si'))[Number(value)];
  return sharedValue
    ? Array.from(sharedValue.getElementsByTagNameNS(spreadsheetNamespace, 't'))
      .map((text) => text.textContent ?? '')
      .join('')
    : '';
}

function setWorksheetRightToLeft(worksheet: XMLDocument) {
  const sheetViews = worksheet.getElementsByTagNameNS(spreadsheetNamespace, 'sheetViews')[0];
  const sheetView = sheetViews?.getElementsByTagNameNS(spreadsheetNamespace, 'sheetView')[0];
  if (sheetView) sheetView.setAttribute('rightToLeft', '1');
}

interface SpreadsheetDrawing {
  path: string;
  document: XMLDocument;
  relationshipsPath: string;
  relationships: XMLDocument;
}

function insertWorksheetDrawing(worksheet: XMLDocument, relationshipId: string) {
  const drawing = worksheet.createElementNS(spreadsheetNamespace, 'drawing');
  drawing.setAttributeNS(officeRelationshipNamespace, 'r:id', relationshipId);
  const trailingElements = new Set([
    'legacyDrawing', 'legacyDrawingHF', 'picture', 'oleObjects', 'controls',
    'webPublishItems', 'tableParts', 'extLst',
  ]);
  const following = Array.from(worksheet.documentElement.children)
    .find((child) => child.namespaceURI === spreadsheetNamespace && trailingElements.has(child.localName));
  worksheet.documentElement.insertBefore(drawing, following ?? null);
}

function addSpreadsheetContentType(
  contentTypes: XMLDocument,
  partPath: string,
  contentType: string,
) {
  const override = contentTypes.createElementNS(contentTypesNamespace, 'Override');
  override.setAttribute('PartName', `/${partPath}`);
  override.setAttribute('ContentType', contentType);
  contentTypes.documentElement.appendChild(override);
}

function ensurePngContentType(contentTypes: XMLDocument) {
  const hasPng = Array.from(contentTypes.getElementsByTagNameNS(contentTypesNamespace, 'Default'))
    .some((entry) => entry.getAttribute('Extension')?.toLowerCase() === 'png');
  if (hasPng) return;
  const definition = contentTypes.createElementNS(contentTypesNamespace, 'Default');
  definition.setAttribute('Extension', 'png');
  definition.setAttribute('ContentType', 'image/png');
  contentTypes.documentElement.appendChild(definition);
}

async function getSpreadsheetDrawing(
  zip: JSZip,
  worksheetPath: string,
  worksheet: XMLDocument,
  contentTypes: XMLDocument,
): Promise<SpreadsheetDrawing> {
  const relationshipsPath = relationshipsPathForPart(worksheetPath);
  const existingRelationships = zip.file(relationshipsPath)
    ? await readXml(zip, relationshipsPath)
    : createRelationshipsDocument();
  const drawingElement = worksheet.getElementsByTagNameNS(spreadsheetNamespace, 'drawing')[0];
  let drawingPath: string;
  let drawingRelationships: XMLDocument;
  if (drawingElement) {
    const relationshipId = drawingElement.getAttributeNS(officeRelationshipNamespace, 'id');
    const relationship = relationshipId ? findRelationship(existingRelationships, relationshipId) : undefined;
    const target = relationship?.getAttribute('Target');
    if (!target) throw new Error('تعذر العثور على الرسم المرتبط بورقة Excel.');
    drawingPath = packagePathFromTarget(worksheetPath.slice(0, worksheetPath.lastIndexOf('/')), target);
    drawingRelationships = zip.file(relationshipsPathForPart(drawingPath))
      ? await readXml(zip, relationshipsPathForPart(drawingPath))
      : createRelationshipsDocument();
    zip.file(relationshipsPath, serializeXml(existingRelationships));
  } else {
    const drawingNumber = nextPartNumber(zip, /^xl\/drawings\/drawing(\d+)\.xml$/);
    drawingPath = `xl/drawings/drawing${drawingNumber}.xml`;
    const drawingRelationshipId = nextRelationshipId(existingRelationships);
    const drawingRelationship = existingRelationships.createElementNS(packageRelationshipNamespace, 'Relationship');
    drawingRelationship.setAttribute('Id', drawingRelationshipId);
    drawingRelationship.setAttribute('Type', `${officeRelationshipNamespace}/drawing`);
    drawingRelationship.setAttribute('Target', `../drawings/drawing${drawingNumber}.xml`);
    existingRelationships.documentElement.appendChild(drawingRelationship);
    insertWorksheetDrawing(worksheet, drawingRelationshipId);
    drawingRelationships = createRelationshipsDocument();
    zip.file(relationshipsPath, serializeXml(existingRelationships));
    zip.file(
      drawingPath,
      `<xdr:wsDr xmlns:xdr="${spreadsheetDrawingNamespace}" xmlns:a="${drawingNamespace}" xmlns:r="${officeRelationshipNamespace}"></xdr:wsDr>`,
    );
    addSpreadsheetContentType(
      contentTypes,
      drawingPath,
      'application/vnd.openxmlformats-officedocument.drawing+xml',
    );
  }
  const drawingRelationshipsPath = relationshipsPathForPart(drawingPath);
  zip.file(worksheetPath, serializeXml(worksheet));
  zip.file(drawingRelationshipsPath, serializeXml(drawingRelationships));
  return {
    path: drawingPath,
    document: await readXml(zip, drawingPath),
    relationshipsPath: drawingRelationshipsPath,
    relationships: drawingRelationships,
  };
}

function appendDrawingElement(
  documentValue: XMLDocument,
  namespace: string,
  qualifiedName: string,
  value: string,
): Element {
  const element = documentValue.createElementNS(namespace, qualifiedName);
  element.textContent = value;
  return element;
}

function appendSpreadsheetImage(
  zip: JSZip,
  drawing: SpreadsheetDrawing,
  photo: ReportPhoto,
  imageIndex: number,
  column: number,
  row: number,
  width: number,
  height: number,
) {
  let mediaName = `shalfa-report-photo-${imageIndex}.png`;
  let suffix = 1;
  while (zip.file(`xl/media/${mediaName}`)) {
    mediaName = `shalfa-report-photo-${imageIndex}-${suffix}.png`;
    suffix += 1;
  }
  zip.file(
    `xl/media/${mediaName}`,
    photo.pngDataUrl.slice(photo.pngDataUrl.indexOf(',') + 1),
    { base64: true },
  );
  const relationshipId = nextRelationshipId(drawing.relationships);
  const relationship = drawing.relationships.createElementNS(packageRelationshipNamespace, 'Relationship');
  relationship.setAttribute('Id', relationshipId);
  relationship.setAttribute('Type', `${officeRelationshipNamespace}/image`);
  relationship.setAttribute('Target', `../media/${mediaName}`);
  drawing.relationships.documentElement.appendChild(relationship);

  const ids = Array.from(drawing.document.getElementsByTagNameNS(spreadsheetDrawingNamespace, 'cNvPr'))
    .map((element) => Number(element.getAttribute('id')))
    .filter(Number.isFinite);
  const shapeId = Math.max(0, ...ids) + 1;
  const extentWidth = Math.round(width * 9525);
  const extentHeight = Math.round(height * 9525);
  const anchor = drawing.document.createElementNS(spreadsheetDrawingNamespace, 'xdr:oneCellAnchor');
  const from = drawing.document.createElementNS(spreadsheetDrawingNamespace, 'xdr:from');
  from.append(
    appendDrawingElement(drawing.document, spreadsheetDrawingNamespace, 'xdr:col', String(column)),
    appendDrawingElement(drawing.document, spreadsheetDrawingNamespace, 'xdr:colOff', '0'),
    appendDrawingElement(drawing.document, spreadsheetDrawingNamespace, 'xdr:row', String(row)),
    appendDrawingElement(drawing.document, spreadsheetDrawingNamespace, 'xdr:rowOff', '0'),
  );
  anchor.appendChild(from);
  const extent = drawing.document.createElementNS(spreadsheetDrawingNamespace, 'xdr:ext');
  extent.setAttribute('cx', String(extentWidth));
  extent.setAttribute('cy', String(extentHeight));
  anchor.appendChild(extent);

  const picture = drawing.document.createElementNS(spreadsheetDrawingNamespace, 'xdr:pic');
  const nonVisual = drawing.document.createElementNS(spreadsheetDrawingNamespace, 'xdr:nvPicPr');
  const properties = drawing.document.createElementNS(spreadsheetDrawingNamespace, 'xdr:cNvPr');
  properties.setAttribute('id', String(shapeId));
  properties.setAttribute('name', photo.file.name || `صورة التقرير ${imageIndex + 1}`);
  const pictureProperties = drawing.document.createElementNS(spreadsheetDrawingNamespace, 'xdr:cNvPicPr');
  const locks = drawing.document.createElementNS(drawingNamespace, 'a:picLocks');
  locks.setAttribute('noChangeAspect', '1');
  pictureProperties.appendChild(locks);
  nonVisual.append(
    properties,
    pictureProperties,
    drawing.document.createElementNS(spreadsheetDrawingNamespace, 'xdr:nvPr'),
  );
  const fill = drawing.document.createElementNS(spreadsheetDrawingNamespace, 'xdr:blipFill');
  const blip = drawing.document.createElementNS(drawingNamespace, 'a:blip');
  blip.setAttributeNS(officeRelationshipNamespace, 'r:embed', relationshipId);
  fill.appendChild(blip);
  const stretch = drawing.document.createElementNS(drawingNamespace, 'a:stretch');
  stretch.appendChild(drawing.document.createElementNS(drawingNamespace, 'a:fillRect'));
  fill.appendChild(stretch);
  const shapeProperties = drawing.document.createElementNS(spreadsheetDrawingNamespace, 'xdr:spPr');
  const transform = drawing.document.createElementNS(drawingNamespace, 'a:xfrm');
  const offset = drawing.document.createElementNS(drawingNamespace, 'a:off');
  offset.setAttribute('x', '0');
  offset.setAttribute('y', '0');
  const shapeExtent = drawing.document.createElementNS(drawingNamespace, 'a:ext');
  shapeExtent.setAttribute('cx', String(extentWidth));
  shapeExtent.setAttribute('cy', String(extentHeight));
  transform.append(offset, shapeExtent);
  shapeProperties.appendChild(transform);
  const geometry = drawing.document.createElementNS(drawingNamespace, 'a:prstGeom');
  geometry.setAttribute('prst', 'rect');
  geometry.appendChild(drawing.document.createElementNS(drawingNamespace, 'a:avLst'));
  shapeProperties.appendChild(geometry);
  picture.append(nonVisual, fill, shapeProperties);
  anchor.append(picture, drawing.document.createElementNS(spreadsheetDrawingNamespace, 'xdr:clientData'));
  drawing.document.documentElement.appendChild(anchor);
  zip.file(drawing.path, serializeXml(drawing.document));
  zip.file(drawing.relationshipsPath, serializeXml(drawing.relationships));
}

async function saveXlsx(zip: JSZip, fileName: string) {
  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  downloadBlob(blob, fileName);
}

export async function exportDeepCleaningWorkbook(
  template: File,
  details: SchoolReportDetails,
  photos: ReportPhoto[],
  fileName: string,
) {
  const { default: JSZipModule } = await import('jszip');
  const zip = await JSZipModule.loadAsync(template);
  const { path, document: worksheet } = await worksheetPart(zip);
  const contentTypes = await readXml(zip, '[Content_Types].xml');
  setWorksheetRightToLeft(worksheet);
  setWorksheetCellValue(worksheet, 'G4', `اسم المدرسة: ${details.school}`);
  setWorksheetCellValue(worksheet, 'G5', `الرقم الوزاري: ${details.ministryCode}`);
  if (photos.length) {
    ensurePngContentType(contentTypes);
    const drawing = await getSpreadsheetDrawing(zip, path, worksheet, contentTypes);
    const columns = [1, 8, 15];
    for (let index = 0; index < photos.length; index += 1) {
      appendSpreadsheetImage(
        zip,
        drawing,
        photos[index],
        index,
        columns[index % columns.length],
        53 + Math.floor(index / columns.length) * 7,
        Math.round(3.23 * 96),
        Math.round(3.33 * 96),
      );
    }
  }
  zip.file(path, serializeXml(worksheet));
  zip.file('[Content_Types].xml', serializeXml(contentTypes));
  await saveXlsx(zip, fileName);
}

export interface PhotoCategory {
  name: string;
  requiredCount: number;
  photos: ReportPhoto[];
}

const imageColumns = [1, 9, 16];
const firstImageRow = 55;
const imageRowStep = 7;
const stopBeforeRow = 146;
const maintenanceCategories = ['كهرباء', 'دورات مياه', 'الأمن والسلامة', 'أعمال أخرى'];
const hvacCategories = ['مكيفات شباك', 'مكيفات اسبليت', 'نظافة مكيفات شباك', 'نظافة مكيفات اسبليت'];

async function appendMinistryCode(zip: JSZip, worksheet: XMLDocument, code: string) {
  const address = topLeftOfMergedCell(worksheet, 'A4');
  const label = 'الرقم الوزاري :';
  const existing = (await readWorksheetCellText(zip, worksheet, address) || label).trim();
  if (existing.includes(label)) {
    const prefix = existing.slice(0, existing.indexOf(label)) + label;
    const oldValue = existing.slice(existing.indexOf(label) + label.length).trim();
    setWorksheetCellValue(worksheet, address, oldValue === code || oldValue.endsWith(` ${code}`) ? existing : `${prefix} ${code}`.trim());
  } else {
    setWorksheetCellValue(worksheet, address, existing ? `${existing} ${code}` : `${label} ${code}`);
  }
}

function addReportSectionImages(
  zip: JSZip,
  drawing: SpreadsheetDrawing,
  categories: PhotoCategory[],
) {
  let categoryStartRow = firstImageRow;
  for (const category of categories) {
    for (let index = 0; index < category.photos.length; index += 1) {
      const row = categoryStartRow + Math.floor(index / imageColumns.length) * imageRowStep;
      if (row >= stopBeforeRow) return;
      appendSpreadsheetImage(
        zip,
        drawing,
        category.photos[index],
        drawing.document.getElementsByTagNameNS(spreadsheetDrawingNamespace, 'pic').length,
        imageColumns[index % imageColumns.length],
        row - 1,
        Math.round((8.2 / 2.54) * 96),
        Math.round((7.56 / 2.54) * 96),
      );
    }
    categoryStartRow += Math.ceil(category.requiredCount / imageColumns.length) * imageRowStep;
  }
}

export async function exportMaintenanceWorkbook(
  template: File,
  details: SchoolReportDetails,
  maintenance: PhotoCategory[],
  hvac: PhotoCategory[],
  fileName: string,
) {
  const { default: JSZipModule } = await import('jszip');
  const zip = await JSZipModule.loadAsync(template);
  const workbook = await readXml(zip, 'xl/workbook.xml');
  const sheetNames = new Set(Array.from(workbook.getElementsByTagNameNS(spreadsheetNamespace, 'sheet'))
    .map((sheet) => sheet.getAttribute('name')));
  const missingSheets = ['O&M', 'HVAC'].filter((name) => !sheetNames.has(name));
  if (missingSheets.length) throw new Error(`التبويبات التالية غير موجودة في الملف المرجعي: ${missingSheets.join('، ')}`);
  const contentTypes = await readXml(zip, '[Content_Types].xml');
  ensurePngContentType(contentTypes);
  const date = details.date ? new Date(`${details.date}T00:00:00`) : new Date();
  for (const [sheetName, categories] of [['O&M', maintenance], ['HVAC', hvac]] as const) {
    const { path, document: worksheet } = await worksheetPart(zip, sheetName);
    setWorksheetRightToLeft(worksheet);
    await appendMinistryCode(zip, worksheet, details.ministryCode);
    setWorksheetCellValue(worksheet, 'C3', details.school);
    setWorksheetCellValue(worksheet, 'J7', date.getFullYear());
    setWorksheetCellValue(worksheet, 'L7', date.getMonth() + 1);
    setWorksheetCellValue(worksheet, 'M7', date.getDate());
    const drawing = await getSpreadsheetDrawing(zip, path, worksheet, contentTypes);
    addReportSectionImages(zip, drawing, categories);
    zip.file(path, serializeXml(worksheet));
  }
  zip.file('[Content_Types].xml', serializeXml(contentTypes));
  await saveXlsx(zip, fileName);
}

export const maintenanceCategoryDefinitions = [
  ...maintenanceCategories.map((name, index) => ({ name, requiredCount: index < 2 ? 9 : 6, section: 'maintenance' as const })),
  ...hvacCategories.map((name, index) => ({ name, requiredCount: index < 2 ? 9 : 6, section: 'hvac' as const })),
];

export function sanitizeFilePart(value: string): string {
  return value.replace(/[<>:"/\\|?*]/g, '_').trim().replace(/[. ]+$/g, '') || 'school-report';
}

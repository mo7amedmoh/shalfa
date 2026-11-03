import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import * as XLSX from 'xlsx';

const referenceDirectory = resolve('docs/reference');
const sources = [
  {
    name: 'Service_Provider_IFM__KPI_update_-_OCT.xlsx',
    matches: (file: string) => normalize(file) === 'serviceproviderifmkpiupdateoct',
  },
  {
    name: 'Checklist_CM_OM.xlsx',
    matches: (file: string) => normalize(file) === 'checklistcmom',
  },
];
const files = readdirSync(referenceDirectory).filter((file) => /\.xlsx$/i.test(file));
const resolvedSources = sources.map((source) => ({
  ...source,
  matches: files.filter((file) => source.matches(file.replace(/\.xlsx$/i, ''))),
}));
const missing = resolvedSources.filter((source) => source.matches.length === 0);
const ambiguous = resolvedSources.filter((source) => source.matches.length > 1);

if (missing.length > 0 || ambiguous.length > 0) {
  for (const source of missing) console.error(`Missing workbook matching ${source.name}.`);
  for (const source of ambiguous) console.error(`Multiple workbooks match ${source.name}: ${source.matches.join(', ')}.`);
  process.exitCode = 1;
} else {
  const outputDirectory = resolve('supabase/seed');
  mkdirSync(outputDirectory, { recursive: true });
  for (const source of resolvedSources) {
    const file = source.matches[0];
    const workbook = XLSX.read(readFileSync(resolve(referenceDirectory, file)), { cellFormula: true });
    const sheets = workbook.SheetNames.map((name) => ({
      name,
      rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], {
        header: 1,
        defval: null,
        raw: false,
      }),
      formulas: Object.entries(workbook.Sheets[name])
        .filter(([cell, value]) => !cell.startsWith('!') && typeof value === 'object' && 'f' in value)
        .map(([cell, value]) => ({ cell, formula: (value as XLSX.CellObject).f })),
    }));
    const output = resolve(outputDirectory, `${basename(source.name, '.xlsx')}.json`);
    writeFileSync(output, JSON.stringify({ source: file, canonicalSource: source.name, sheets }, null, 2), 'utf8');
    console.info(`Imported workbook structure and formulas: ${output}`);
  }

  const performanceFile = resolvedSources.find((source) => source.name.startsWith('Service_Provider'))!.matches[0];
  const checklistFile = resolvedSources.find((source) => source.name === 'Checklist_CM_OM.xlsx')!.matches[0];
  const performanceWorkbook = XLSX.read(readFileSync(resolve(referenceDirectory, performanceFile)), { cellFormula: true });
  const checklistWorkbook = XLSX.read(readFileSync(resolve(referenceDirectory, checklistFile)), { cellFormula: true });
  const cards = [
    { code: 'CM', weight: 0.1, sheet: 'مؤشرات اداء ادارة العقد' },
    { code: 'OM', weight: 0.15, sheet: 'مؤشرات اداء عمليات التشغيلية' },
    { code: 'HS', weight: 0.3, sheet: 'مؤشرات اداء الخدمات الثقيلة' },
    { code: 'SS', weight: 0.45, sheet: 'مؤشرات اداء الخدمات الخفيفة' },
  ].map((card) => ({
    code: card.code,
    weight: card.weight,
    indicators: rowsFrom(performanceWorkbook, card.sheet)
      .filter((row) => typeof row[1] === 'string' && new RegExp(`^${card.code}\\.\\d+$`).test(row[1]))
      .map((row) => ({
        id: row[1],
        category: row[2],
        name: row[3],
        importance: row[4],
        description: row[5],
        formulaDescription: row[6],
        target: row[7],
        source: row[8],
        requiredEvidence: row[9],
        frequency: row[11],
        octoberApplicable: String(row[0]).toLocaleUpperCase() === 'TRUE',
        octoberInputs: { numerator: toNumber(row[12]), denominator: toNumber(row[13]), observed: toNumber(row[12]) },
        octoberScore: toNumber(row[14]),
      })),
  }));
  const checklist = {
    CM: checklistRows(checklistWorkbook, 'CM إدارة العقد'),
    OM: checklistRows(checklistWorkbook, 'OM إدارة العمليات'),
  };
  const deliverables = rowsFrom(checklistWorkbook, 'المخرجات (28)')
    .filter((row) => toNumber(row[0]) !== null)
    .map((row) => ({
      number: toNumber(row[0]),
      clause: row[1],
      name: row[2],
      dueReference: row[3],
      durationDays: toNumber(row[4]),
      reviewCycle: row[5],
      sourceDueDate: row[6],
      initialStatus: row[7],
      sourceDeliveryDate: row[8],
      sourceApprovalDate: row[9],
      overdueFormula: row[10],
      notes: row[11],
    }));
  const penalties = rowsFrom(performanceWorkbook, 'اجمالي الغرامات المباشرة')
    .filter((row) => toNumber(row[0]) !== null)
    .map((row) => ({
      number: toNumber(row[0]),
      category: row[1],
      indicator: row[2],
      description: row[3],
      formula: row[4],
      target: row[5],
      reference: row[6],
      requiredEvidence: row[7],
      monthlyValueInput: row[8],
      penaltyRule: row[9],
    }));
  const catalogOutput = resolve(outputDirectory, 'kpi-catalog.json');
  writeFileSync(catalogOutput, JSON.stringify({
    sourceFiles: [performanceFile, checklistFile],
    cards,
    checklist,
    deliverables,
    penalties,
  }, null, 2), 'utf8');
  console.info(`Imported normalized KPI definitions: ${catalogOutput}`);
  const publicDataDirectory = resolve('public/data');
  mkdirSync(publicDataDirectory, { recursive: true });
  const scorecardsOutput = resolve(publicDataDirectory, 'kpi-scorecards.json');
  writeFileSync(scorecardsOutput, JSON.stringify(cards), 'utf8');
  console.info(`Generated scorecard definitions for the app: ${scorecardsOutput}`);
  const checklistOutput = resolve(publicDataDirectory, 'kpi-checklist.json');
  const publicChecklist = Object.entries(checklist).flatMap(([code, items]) =>
    items.flatMap((item) => {
      if (item.number === null) return [];
      return [{
        id: `${code}-${item.number}`,
        code,
        number: item.number,
        axis: String(item.axis ?? ''),
        item: String(item.item ?? ''),
        reference: String(item.reference ?? ''),
        evidence: String(item.evidence ?? ''),
        frequency: String(item.frequency ?? ''),
        initialStatus: String(item.initialStatus ?? 'لم يبدأ'),
        isRecommendation: item.isRecommendation,
      }];
    }),
  );
  writeFileSync(checklistOutput, JSON.stringify(publicChecklist), 'utf8');
  console.info(`Generated checklist definitions for the app: ${checklistOutput}`);
}

function normalize(file: string): string {
  return file.toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
}

function rowsFrom(workbook: XLSX.WorkBook, sheetName: string): unknown[][] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Required workbook sheet was not found: ${sheetName}`);
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false }) as unknown[][];
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const normalized = value.trim().replace(/,/g, '');
  const percent = normalized.endsWith('%');
  const parsed = Number(percent ? normalized.slice(0, -1) : normalized);
  return Number.isFinite(parsed) ? (percent ? parsed / 100 : parsed) : null;
}

function checklistRows(workbook: XLSX.WorkBook, sheetName: string) {
  return rowsFrom(workbook, sheetName)
    .filter((row) => toNumber(row[0]) !== null)
    .map((row) => ({
      number: toNumber(row[0]),
      axis: row[1],
      item: row[2],
      reference: row[3],
      evidence: row[4],
      frequency: row[5],
      owner: row[6],
      initialStatus: row[7],
      lastUpdatedAt: row[8],
      notes: row[9],
      isRecommendation: typeof row[3] === 'string' && row[3].trim() === 'توصية',
    }));
}

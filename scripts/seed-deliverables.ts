import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import { z } from 'zod';
import { loadEnv } from 'vite';

const envFile = loadEnv('development', process.cwd(), '');
const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? envFile.SUPABASE_URL ?? envFile.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? envFile.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the trusted seed environment.');
}

const referenceDirectory = resolve('docs/reference');
const workbooks = readdirSync(referenceDirectory).filter((file) => file.toLocaleLowerCase() === 'checklist_cm_om.xlsx');
if (workbooks.length !== 1) {
  throw new Error(`Expected exactly one Checklist_CM_OM.xlsx in ${referenceDirectory}; found ${workbooks.length}.`);
}

const workbook = XLSX.read(readFileSync(resolve(referenceDirectory, workbooks[0])), { cellDates: false });
const sheet = workbook.Sheets['المخرجات (28)'];
if (!sheet) throw new Error('Required worksheet "المخرجات (28)" was not found.');

const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false }) as unknown[][];
const numberValue = z.coerce.number().int().positive();
const durationDays = (value: unknown) => {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
};
const deliverableSchema = z.object({
  seq: numberValue,
  clause: z.string().trim().min(1).nullable(),
  title: z.string().trim().min(1),
  due_basis: z.string().trim().min(1).nullable(),
  duration_days: z.number().int().nonnegative().nullable(),
  duration_text: z.string().trim().min(1).nullable(),
  review_cycle: z.string().trim().min(1).nullable(),
});
const items = rows.filter((row) => numberValue.safeParse(row[0]).success).map((row) => deliverableSchema.parse({
  seq: row[0],
  clause: row[1] == null ? null : String(row[1]),
  title: row[2],
  due_basis: row[3] == null ? null : String(row[3]),
  duration_days: durationDays(row[4]),
  duration_text: row[4] == null || String(row[4]).trim() === '' || durationDays(row[4]) !== null ? null : String(row[4]).trim(),
  review_cycle: row[5] == null ? null : String(row[5]),
}));
if (items.length !== 28 || new Set(items.map(({ seq }) => seq)).size !== 28) {
  throw new Error(`Expected 28 uniquely numbered deliverables; parsed ${items.length}.`);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { error } = await supabase.from('deliverables').upsert(items, {
  onConflict: 'seq',
});
if (error) throw new Error(`Deliverable seed failed: ${error.message}`);
console.info('Seeded 28 contractual deliverables. Workbook metadata was refreshed; existing statuses, due-date overrides, delivery dates, approval dates, and notes were preserved.');

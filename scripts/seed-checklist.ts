import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { loadEnv } from 'vite';

const itemSchema = z.object({
  number: z.number().int().positive(),
  axis: z.string().nullable(),
  item: z.string().nullable(),
  reference: z.string().nullable(),
  evidence: z.string().nullable(),
  frequency: z.string().nullable(),
  owner: z.string().nullable(),
  initialStatus: z.string().nullable(),
});
const catalogSchema = z.object({
  checklist: z.object({
    CM: z.array(itemSchema),
    OM: z.array(itemSchema),
  }),
});
const statusByLabel: Record<string, 'done' | 'in_progress' | 'not_started' | 'not_applicable'> = {
  مكتمل: 'done',
  'جارٍ': 'in_progress',
  'لم يبدأ': 'not_started',
  'لا ينطبق': 'not_applicable',
};

const envFile = loadEnv('development', process.cwd(), '');
const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? envFile.SUPABASE_URL ?? envFile.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? envFile.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the trusted seed environment.');
}

const catalog = catalogSchema.parse(JSON.parse(readFileSync(resolve('supabase/seed/kpi-catalog.json'), 'utf8')));
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const rows = (['CM', 'OM'] as const).flatMap((domain) => catalog.checklist[domain].map((item) => {
  const label = item.initialStatus ?? 'لم يبدأ';
  const status = statusByLabel[label];
  if (!status) throw new Error(`Unknown checklist status "${label}" for ${domain}-${item.number}.`);
  return {
    domain,
    seq: item.number,
    axis: item.axis ?? '',
    item: item.item ?? '',
    contract_ref: item.reference || null,
    evidence: item.evidence || null,
    frequency: item.frequency || null,
    owner: item.owner ?? '',
    status,
    notes: '',
  };
}));

const { error } = await supabase.from('checklist_items').upsert(rows, {
  onConflict: 'domain,seq',
  ignoreDuplicates: true,
});
if (error) throw new Error(`Checklist seed failed: ${error.message}`);
console.info(`Seeded ${rows.length} checklist items (existing progress was preserved).`);

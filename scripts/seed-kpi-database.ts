import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { loadEnv } from 'vite';

const indicatorSchema = z.object({
  id: z.string().regex(/^(CM|OM|HS|SS)\.\d+$/),
  name: z.string(),
  importance: z.string().nullable(),
  description: z.string().nullable(),
  formulaDescription: z.string().nullable(),
  target: z.string().nullable(),
  source: z.string().nullable(),
  requiredEvidence: z.string().nullable(),
  frequency: z.enum(['شهري', 'ربع سنوي', 'سنوي']),
  octoberApplicable: z.boolean(),
  octoberInputs: z.object({
    numerator: z.number().nullable(),
    denominator: z.number().nullable(),
    observed: z.number().nullable(),
  }),
  octoberScore: z.number().nullable(),
});
const cardSchema = z.object({
  code: z.enum(['CM', 'OM', 'HS', 'SS']),
  weight: z.number(),
  indicators: z.array(indicatorSchema),
});
const catalogSchema = z.object({ cards: z.array(cardSchema).length(4) });

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
const weights = catalog.cards.map(({ code, weight }) => ({ card: code, weight }));
const indicators = catalog.cards.flatMap(({ code, indicators: rows }) => rows.map((row) => ({
  code: row.id,
  card: code,
  seq: Number(row.id.split('.')[1]),
  name: row.name,
  importance: row.importance,
  frequency: ({ شهري: 'monthly', 'ربع سنوي': 'quarterly', سنوي: 'annual' } as const)[row.frequency],
  description: row.description,
  formula_text: row.formulaDescription,
  target_text: row.target,
  source_ref: row.source,
  required_data: row.requiredEvidence,
  default_applicable: row.octoberApplicable,
})));

const { error: weightError } = await supabase.from('kpi_card_weights').upsert(weights, { onConflict: 'card' });
if (weightError) throw new Error(`KPI weights seed failed: ${weightError.message}`);
const { error: indicatorError } = await supabase.from('kpi_indicators').upsert(indicators, { onConflict: 'code' });
if (indicatorError) throw new Error(`KPI indicators seed failed: ${indicatorError.message}`);

const workOrder = 'TBC005754 & TBC006484';
const { data: kpiMonth, error: monthError } = await supabase.from('kpi_months').upsert({
  month: '2026-10-01',
  work_order: workOrder,
  project_no: 'All',
  region: 'المنطقة الوسطى',
  contractor: 'شركة شلفا لإدارة المرافق',
}, { onConflict: 'month,work_order' }).select('id,status').single();
if (monthError) throw new Error(`KPI month seed failed: ${monthError.message}`);

if (kpiMonth.status !== 'approved') {
  const entries = catalog.cards.flatMap(({ indicators: rows }) => rows.map((row) => {
    const formInput = {
      applicable: row.octoberApplicable,
      ...(row.octoberInputs.numerator === null ? {} : { numerator: row.octoberInputs.numerator }),
      ...(row.octoberInputs.denominator === null ? {} : { denominator: row.octoberInputs.denominator }),
      ...(row.octoberInputs.observed === null ? {} : { observed: row.octoberInputs.observed }),
    };
    return {
      kpi_month_id: kpiMonth.id,
      indicator_code: row.id,
      applicable: row.octoberApplicable,
      numerator: row.octoberInputs.numerator,
      denominator: row.octoberInputs.denominator,
      extra: { formInput },
      score: row.octoberApplicable ? row.octoberScore : null,
    };
  }));
  const { error: entryError } = await supabase.from('kpi_entries').upsert(entries, {
    onConflict: 'kpi_month_id,indicator_code',
    ignoreDuplicates: true,
  });
  if (entryError) throw new Error(`KPI entries seed failed: ${entryError.message}`);
}

console.info(`Seeded ${indicators.length} KPI indicators and preserved the October month status.`);

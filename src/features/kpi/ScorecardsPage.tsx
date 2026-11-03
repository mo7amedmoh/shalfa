import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { calculateMonthlyKpiTotal, scoreByIndicatorId, type FormulaInputs } from '../../domain/kpi/formulas';
import { ratingBand } from '../../domain/kpi/scoring';
import type { UserProfile } from '../../lib/auth';
import { supabase } from '../../lib/supabase';

const cardSchema = z.object({
  code: z.enum(['CM', 'OM', 'HS', 'SS']),
  weight: z.number(),
  indicators: z.array(z.object({
    id: z.string(),
    name: z.string(),
    importance: z.string(),
    description: z.string(),
    formulaDescription: z.string(),
    target: z.string(),
    source: z.string(),
    requiredEvidence: z.string(),
    frequency: z.string(),
    octoberApplicable: z.boolean(),
    octoberInputs: z.object({
      numerator: z.number().nullable(),
      denominator: z.number().nullable(),
      observed: z.number().nullable(),
    }),
  })),
});
const catalogSchema = z.array(cardSchema);
const sourceInputSchema = z.object({
  applicable: z.boolean(),
  numerator: z.number().optional(),
  denominator: z.number().optional(),
  observed: z.number().optional(),
  evidence: z.string().max(2000).optional(),
});
const sourceDataSchema = z.object({ indicators: z.record(z.string(), sourceInputSchema) });
const scorecardRowSchema = z.object({
  card_code: z.enum(['CM', 'OM', 'HS', 'SS']),
  source_data: z.record(z.string(), z.unknown()),
  approved_at: z.string().nullable(),
  approved_by: z.string().uuid().nullable(),
});
const scorecardRowsSchema = z.array(scorecardRowSchema);
type KpiCard = z.infer<typeof cardSchema>;
const cardNames: Record<KpiCard['code'], string> = {
  CM: 'إدارة العقد',
  OM: 'العمليات التشغيلية',
  HS: 'الخدمات الثقيلة',
  SS: 'الخدمات الخفيفة',
};
const region = 'المنطقة الوسطى';
const workOrder = 'TBC005754 & TBC006484';
const projectNumber = 'All';
type IndicatorValues = FormulaInputs & { evidence?: string };

function currentMonth(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function octoberValues(cards: readonly KpiCard[]): Record<string, IndicatorValues> {
  const values: Record<string, IndicatorValues> = {};
  for (const card of cards) {
    for (const indicator of card.indicators) {
      const inputs = indicator.octoberInputs;
      values[indicator.id] = {
        applicable: indicator.octoberApplicable,
        ...(inputs.numerator === null ? {} : { numerator: inputs.numerator }),
        ...(inputs.denominator === null ? {} : { denominator: inputs.denominator }),
        ...(inputs.observed === null ? {} : { observed: inputs.observed }),
      };
    }
  }
  return values;
}

function parseSavedValues(rows: z.infer<typeof scorecardRowsSchema>, month: string, cards: readonly KpiCard[]): Record<string, IndicatorValues> {
  const values = month === '2026-10' ? octoberValues(cards) : {};
  for (const row of rows) {
    const parsed = sourceDataSchema.safeParse(row.source_data);
    if (parsed.success) Object.assign(values, parsed.data.indicators);
  }
  return values;
}

async function loadKpiCatalog(): Promise<KpiCard[]> {
  const response = await fetch('/data/kpi-scorecards.json');
  if (!response.ok) throw new Error(`تعذر تحميل تعريفات المؤشرات (HTTP ${response.status}).`);
  return catalogSchema.parse(await response.json());
}

async function loadScorecards(month: string) {
  if (!supabase) return [];
  const { data, error } = await supabase.from('kpi_scorecards')
    .select('card_code,source_data,approved_at,approved_by')
    .eq('score_month', `${month}-01`)
    .eq('region', region)
    .eq('work_order', workOrder);
  if (error) throw error;
  return scorecardRowsSchema.parse(data);
}

export function ScorecardsPage({ profile }: { profile: UserProfile | null }) {
  const client = useQueryClient();
  const [month, setMonth] = useState(currentMonth);
  const [values, setValues] = useState<Record<string, IndicatorValues>>({});
  const [message, setMessage] = useState('');
  const catalogQuery = useQuery({ queryKey: ['kpi-catalog'], queryFn: loadKpiCatalog, staleTime: Infinity });
  const cards = useMemo(() => catalogQuery.data ?? [], [catalogQuery.data]);
  const scorecards = useQuery({
    queryKey: ['kpi-scorecards', month],
    queryFn: () => loadScorecards(month),
    enabled: Boolean(supabase),
  });
  const canEdit = Boolean(profile && ['admin', 'project_manager', 'area_engineer'].includes(profile.role));
  const canApprove = profile?.role === 'admin' || profile?.role === 'project_manager';
  const savedRows = scorecards.data ?? [];
  const locked = savedRows.some((row) => row.approved_at !== null);
  const total = useMemo(() => calculateMonthlyKpiTotal(values), [values]);
  const cardScores = useMemo(() => Object.fromEntries(cards.map((card) => {
    const inputs = card.indicators.flatMap((indicator) => {
      const input = values[indicator.id];
      return input?.applicable ? [scoreByIndicatorId(indicator.id, input)] : [];
    });
    return [card.code, inputs.length ? inputs.reduce((sum, score) => sum + score, 0) / inputs.length : null];
  })), [cards, values]);

  useEffect(() => {
    if (!cards.length || scorecards.isLoading) return;
    if (scorecards.data) setValues(parseSavedValues(scorecards.data, month, cards));
    else setValues(month === '2026-10' ? octoberValues(cards) : {});
  }, [cards, scorecards.data, scorecards.isLoading, month]);

  const save = useMutation({
    mutationFn: async () => {
      if (!supabase || !profile || !canEdit) throw new Error('لا تملك صلاحية تعديل بطاقة الأداء.');
      if (locked) throw new Error('الشهر معتمد ومقفل.');
      const rows = cards.map((card) => ({
        score_month: `${month}-01`,
        region,
        work_order: workOrder,
        card_code: card.code,
        source_data: {
          indicators: Object.fromEntries(card.indicators.flatMap((indicator) => {
            const input = values[indicator.id];
            return input ? [[indicator.id, input]] : [];
          })),
        },
        approved_at: null,
        approved_by: null,
      }));
      const { error } = await supabase.from('kpi_scorecards').upsert(rows, {
        onConflict: 'score_month,region,work_order,card_code',
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setMessage('تم حفظ بطاقات الشهر.');
      await client.invalidateQueries({ queryKey: ['kpi-scorecards', month] });
    },
    onError: (error: Error) => setMessage(`تعذر الحفظ: ${error.message}`),
  });

  const approve = useMutation({
    mutationFn: async () => {
      if (!supabase || !profile || !canApprove) throw new Error('اعتماد الشهر متاح لمدير المشروع أو مدير النظام.');
      if (savedRows.length !== cards.length) throw new Error('احفظ البطاقات الأربع قبل اعتماد الشهر.');
      const { error } = await supabase.from('kpi_scorecards').update({
        approved_at: new Date().toISOString(),
        approved_by: profile.id,
      })
        .eq('score_month', `${month}-01`)
        .eq('region', region)
        .eq('work_order', workOrder);
      if (error) throw error;
    },
    onSuccess: async () => {
      setMessage('تم اعتماد الشهر وإقفاله.');
      await client.invalidateQueries({ queryKey: ['kpi-scorecards', month] });
    },
    onError: (error: Error) => setMessage(`تعذر اعتماد الشهر: ${error.message}`),
  });

  function updateIndicator(id: string, patch: Partial<IndicatorValues>) {
    setValues((current) => ({
      ...current,
      [id]: { ...(current[id] ?? { applicable: false }), ...patch },
    }));
  }

  const percentage = total === null ? null : total * 100;
  const rating = percentage === null ? null : ratingBand(percentage);

  return (
    <div className="grid gap-5">
      <section className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div><p className="text-sm text-slate-500">المنطقة الوسطى · أمر العمل {workOrder} · رقم المشروع {projectNumber}</p><h2 className="mt-1 text-2xl font-bold text-brand-900">بطاقات الأداء الشهرية</h2></div>
        <label className="grid gap-1 text-sm font-semibold">شهر التقييم<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2" /></label>
      </section>

      {scorecards.error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">تعذر تحميل بيانات مؤشرات الأداء: {scorecards.error.message}</p>}
      {scorecards.isLoading && <p role="status" className="card p-5 text-center">جارٍ تحميل بطاقات الأداء…</p>}
      {catalogQuery.isLoading && <p role="status" className="card p-5 text-center">جارٍ تحميل تعريفات المؤشرات الرسمية…</p>}
      {catalogQuery.error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">تعذر تحميل تعريفات المؤشرات: {catalogQuery.error.message}</p>}
      {!supabase && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">وضع المعاينة: تعرض بيانات أكتوبر الرسمية، ويتطلب الحفظ إعداد Supabase.</p>}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="ملخص نتائج البطاقات">
        {cards.map((card) => {
          const score = cardScores[card.code] as number | null;
          return <article key={card.code} className="card p-4"><p className="text-sm text-slate-500">{cardNames[card.code]} · {card.weight * 100}%</p><p className="mt-2 text-2xl font-bold text-brand-900">{score === null ? '—' : `${(score * 100).toFixed(2)}%`}</p></article>;
        })}
        <article className="card bg-brand-900 p-4 text-white"><p className="text-sm text-white/75">النتيجة الإجمالية</p><p className="mt-2 text-2xl font-bold">{percentage === null ? '—' : `${percentage.toFixed(2)}%`}</p><p className="mt-1 text-xs">{rating === null ? 'أدخل البيانات المنطبقة' : rating === 'excellent' ? 'ممتاز' : rating === 'average' ? 'متوسط' : 'ضعيف'}</p></article>
      </section>

      {cards.map((card) => <section key={card.code} className="card grid gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-2"><div><h3 className="text-lg font-bold text-brand-900">{cardNames[card.code]} ({card.code})</h3><p className="text-sm text-slate-500">الوزن {card.weight * 100}% · متوسط المؤشرات المنطبقة</p></div><strong>{cardScores[card.code] === null ? '—' : `${((cardScores[card.code] as number) * 100).toFixed(2)}%`}</strong></div>
        <div className="grid gap-3">
          {card.indicators.map((indicator) => {
            const input = values[indicator.id] ?? { applicable: false };
            const result = scoreByIndicatorId(indicator.id, input);
            return <article key={indicator.id} className="rounded-xl border border-slate-200 p-3 sm:p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1"><h4 className="font-bold">{indicator.id} · {indicator.name}</h4><p className="mt-1 text-xs leading-5 text-slate-600">{indicator.description}</p></div>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={input.applicable} disabled={!canEdit || locked} onChange={(event) => updateIndicator(indicator.id, { applicable: event.target.checked })} />ينطبق</label>
                <strong className="min-w-16 text-end text-brand-800">{(result * 100).toFixed(2)}%</strong>
              </div>
              <details className="mt-2 text-xs text-slate-500"><summary className="cursor-pointer">المعادلة والمرجع والدليل</summary><div className="mt-2 grid gap-1 leading-5"><p><b>المعادلة:</b> {indicator.formulaDescription}</p><p><b>الهدف:</b> {indicator.target}</p><p><b>المصدر:</b> {indicator.source}</p><p><b>التكرار:</b> {indicator.frequency} · <b>الأهمية:</b> {indicator.importance}</p><p><b>الدليل المطلوب:</b> {indicator.requiredEvidence}</p></div></details>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {indicator.id === 'OM.1' || indicator.id === 'CM.5' || indicator.id === 'CM.6' ? (
                  <NumberField label={indicator.id === 'OM.1' ? 'عدد حالات NCR' : 'القيمة المحققة (من 0 إلى 1)'} value={input.observed} disabled={!canEdit || locked} onChange={(value) => updateIndicator(indicator.id, { observed: value })} />
                ) : <>
                  <NumberField label="البسط / القيمة المحققة" value={input.numerator} disabled={!canEdit || locked} onChange={(value) => updateIndicator(indicator.id, { numerator: value })} />
                  <NumberField label="المقام / المستهدف" value={input.denominator} disabled={!canEdit || locked} onChange={(value) => updateIndicator(indicator.id, { denominator: value })} />
                </>}
                <label className="grid gap-1 text-xs font-semibold text-slate-600">مرجع الدليل<input value={input.evidence ?? ''} disabled={!canEdit || locked} onChange={(event) => updateIndicator(indicator.id, { evidence: event.target.value })} maxLength={2000} className="min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" /></label>
              </div>
            </article>;
          })}
        </div>
      </section>)}

      <section className="card flex flex-wrap items-center gap-3 p-4">
        <button type="button" disabled={!canEdit || locked || save.isPending} onClick={() => save.mutate()} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{save.isPending ? 'جارٍ الحفظ…' : 'حفظ بطاقات الشهر'}</button>
        {canApprove && <button type="button" disabled={locked || approve.isPending || savedRows.length !== cards.length} onClick={() => approve.mutate()} className="rounded-lg border border-brand-700 px-4 py-2 text-sm font-bold text-brand-800 disabled:opacity-50">{approve.isPending ? 'جارٍ الاعتماد…' : 'اعتماد الشهر وإقفاله'}</button>}
        {locked && <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">الشهر معتمد ومقفل</span>}
        <button type="button" onClick={() => window.print()} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold">طباعة / حفظ PDF</button>
        {message && <p role="status" className="w-full text-sm text-slate-700">{message}</p>}
      </section>
    </div>
  );
}

function NumberField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number | undefined;
  disabled: boolean;
  onChange: (value: number | undefined) => void;
}) {
  return <label className="grid gap-1 text-xs font-semibold text-slate-600">{label}<input type="number" min="0" step="any" value={value ?? ''} disabled={disabled} onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))} className="min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal disabled:bg-slate-50" /></label>;
}

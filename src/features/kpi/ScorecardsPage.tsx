import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { calculateMonthlyKpiTotal, scoreByIndicatorId, type FormulaInputs } from '../../domain/kpi/formulas';
import { ratingBand } from '../../domain/kpi/scoring';
import type { UserProfile } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { APP_SCHEMA_SELECT } from '../../lib/schemaColumns';
import { Link, useSearchParams } from 'react-router-dom';
import { summarizeDeliverables, type DeliverableDueDates } from '../../domain/deliverables';
import { KPI_WORK_ORDER } from '../../domain/kpi/config';
import { calculateDiscount } from '../../domain/kpi/discount';

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
  })),
});
const catalogSchema = z.array(cardSchema).length(4);
const indicatorRowSchema = z.object({
  code: z.string(),
  card: z.enum(['CM', 'OM', 'HS', 'SS']),
  seq: z.number().int(),
  name: z.string(),
  importance: z.string().nullable(),
  frequency: z.enum(['monthly', 'quarterly', 'annual']),
  description: z.string().nullable(),
  formula_text: z.string().nullable(),
  target_text: z.string().nullable(),
  source_ref: z.string().nullable(),
  required_data: z.string().nullable(),
});
const weightRowSchema = z.object({
  card: z.enum(['CM', 'OM', 'HS', 'SS']),
  weight: z.coerce.number(),
});
const sourceInputSchema = z.object({
  applicable: z.boolean(),
  numerator: z.number().optional(),
  denominator: z.number().optional(),
  observed: z.number().optional(),
  evidence: z.string().max(2000).optional(),
});
const kpiEntrySchema = z.object({
  indicator_code: z.string(),
  extra: z.record(z.string(), z.unknown()),
});
const kpiMonthSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['draft', 'submitted', 'approved']),
  entries: z.array(kpiEntrySchema),
});
const deliverablesSummarySchema = z.array(z.object({
  due_basis: z.string().nullable(),
  duration_days: z.number().int().nullable(),
  due_date: z.string().nullable(),
  status: z.enum(['not_delivered', 'delivered_pending', 'approved']),
}));
const deliverablesDatesSchema = z.object({
  contract_signing_date: z.string(),
  site_handover_date: z.string(),
  award_letter_date: z.string().nullable(),
});
type KpiCard = z.infer<typeof cardSchema>;
type ScorecardTab = KpiCard['code'] | 'overview' | 'discount';
const cardNames: Record<KpiCard['code'], string> = {
  CM: 'إدارة العقد',
  OM: 'العمليات التشغيلية',
  HS: 'الخدمات الثقيلة',
  SS: 'الخدمات الخفيفة',
};
const region = 'المنطقة الوسطى';
type IndicatorValues = FormulaInputs & { evidence?: string };

function usesObservedValue(indicatorId: string): boolean {
  return indicatorId === 'OM.1' || indicatorId === 'CM.5' || indicatorId === 'CM.6';
}

function hasRequiredInputs(indicatorId: string, input: IndicatorValues): boolean {
  return usesObservedValue(indicatorId)
    ? input.observed !== undefined
    : input.numerator !== undefined && input.denominator !== undefined;
}

function indicatorStatus(indicatorId: string, input: IndicatorValues, score: number): {
  label: string;
  className: string;
} {
  if (!input.applicable) return { label: 'لا ينطبق', className: 'bg-slate-100 text-slate-600' };
  if (!hasRequiredInputs(indicatorId, input)) return { label: 'بانتظار البيانات', className: 'bg-amber-100 text-amber-800' };
  if (score === 1) return { label: 'محقق', className: 'bg-emerald-100 text-emerald-700' };
  if (score >= 0.95) return { label: 'قريب من الهدف', className: 'bg-amber-100 text-amber-800' };
  return { label: 'دون الهدف', className: 'bg-rose-100 text-rose-700' };
}

function localToday(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function currentMonth(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function initialMonth(value: string | null): string {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return currentMonth();
  const parsed = new Date(`${value}-01T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 7) === value ? value : currentMonth();
}

function parseSavedValues(rows: z.infer<typeof kpiEntrySchema>[]): Record<string, IndicatorValues> {
  const values: Record<string, IndicatorValues> = {};
  for (const row of rows) {
    const parsed = sourceInputSchema.safeParse(row.extra.formInput);
    if (parsed.success) values[row.indicator_code] = parsed.data;
  }
  return values;
}

async function loadKpiCatalog(): Promise<KpiCard[]> {
  if (!supabase) throw new Error('يلزم تسجيل الدخول لعرض بيانات مؤشرات الأداء.');
  const [indicatorsResult, weightsResult] = await Promise.all([
    supabase.from('kpi_indicators').select(APP_SCHEMA_SELECT.kpiIndicators).order('card').order('seq'),
    supabase.from('kpi_card_weights').select(APP_SCHEMA_SELECT.kpiWeights),
  ]);
  if (indicatorsResult.error) throw indicatorsResult.error;
  if (weightsResult.error) throw weightsResult.error;
  const indicators = z.array(indicatorRowSchema).parse(indicatorsResult.data);
  const weights = new Map(z.array(weightRowSchema).parse(weightsResult.data).map((row) => [row.card, row.weight]));
  const cards = (['CM', 'OM', 'HS', 'SS'] as const).map((code) => {
    const weight = weights.get(code);
    if (weight === undefined) throw new Error(`تعذر تحميل وزن البطاقة ${code}.`);
    return {
      code,
      weight,
      indicators: indicators.filter((row) => row.card === code).map((row) => ({
        id: row.code,
        name: row.name,
        importance: row.importance ?? '',
        description: row.description ?? '',
        formulaDescription: row.formula_text ?? '',
        target: row.target_text ?? '',
        source: row.source_ref ?? '',
        requiredEvidence: row.required_data ?? '',
        frequency: ({ monthly: 'شهري', quarterly: 'ربع سنوي', annual: 'سنوي' } as const)[row.frequency],
      })),
    };
  });
  return catalogSchema.parse(cards);
}

async function loadScorecards(month: string) {
  if (!supabase) throw new Error('يلزم تسجيل الدخول لعرض بيانات مؤشرات الأداء.');
  const { data: kpiMonth, error: monthError } = await supabase.from('kpi_months')
    .select(APP_SCHEMA_SELECT.kpiMonth)
    .eq('month', `${month}-01`)
    .eq('work_order', KPI_WORK_ORDER)
    .maybeSingle();
  if (monthError) throw monthError;
  if (!kpiMonth) return null;
  const { data: entries, error: entriesError } = await supabase.from('kpi_entries')
    .select(APP_SCHEMA_SELECT.kpiEntries)
    .eq('kpi_month_id', kpiMonth.id);
  if (entriesError) throw entriesError;
  return kpiMonthSchema.parse({ ...kpiMonth, entries });
}

async function loadDeliverablesSummary() {
  if (!supabase) throw new Error('يلزم تسجيل الدخول لعرض بيانات المخرجات.');
  const [deliverablesResult, settingsResult] = await Promise.all([
    supabase.from('deliverables').select(APP_SCHEMA_SELECT.deliverablesSummary),
    supabase.from('app_settings').select(APP_SCHEMA_SELECT.appSettingsDeliverables).eq('id', 1).single(),
  ]);
  if (deliverablesResult.error) throw deliverablesResult.error;
  if (settingsResult.error) throw settingsResult.error;
  const items = deliverablesSummarySchema.parse(deliverablesResult.data);
  const settings = deliverablesDatesSchema.parse(settingsResult.data);
  const dates: DeliverableDueDates = {
    contractSigningDate: settings.contract_signing_date,
    siteHandoverDate: settings.site_handover_date,
    awardLetterDate: settings.award_letter_date,
  };
  return {
    summary: summarizeDeliverables(items.map((item) => ({
      dueBasis: item.due_basis,
      durationDays: item.duration_days,
      dueDateOverride: item.due_date,
      status: item.status,
    })), dates, localToday()),
    contractSigningDate: settings.contract_signing_date,
  };
}

export function ScorecardsPage({ profile }: { profile: UserProfile | null }) {
  const client = useQueryClient();
  const [searchParams] = useSearchParams();
  const [month, setMonth] = useState(() => initialMonth(searchParams.get('month')));
  const [activeTab, setActiveTab] = useState<ScorecardTab>('CM');
  const [activeIndicatorId, setActiveIndicatorId] = useState<string | null>(null);
  const [invoiceAmount, setInvoiceAmount] = useState<number | undefined>();
  const [values, setValues] = useState<Record<string, IndicatorValues>>({});
  const [message, setMessage] = useState('');
  const canEdit = Boolean(profile && ['admin', 'project_manager'].includes(profile.role));
  const catalogQuery = useQuery({ queryKey: ['kpi-catalog'], queryFn: loadKpiCatalog, staleTime: Infinity, enabled: Boolean(supabase && canEdit) });
  const cards = useMemo(() => catalogQuery.data ?? [], [catalogQuery.data]);
  const scorecards = useQuery({
    queryKey: ['kpi-scorecards', month],
    queryFn: () => loadScorecards(month),
    enabled: Boolean(supabase && canEdit),
  });
  const deliverablesSummary = useQuery({
    queryKey: ['deliverables-summary'],
    queryFn: loadDeliverablesSummary,
    enabled: Boolean(supabase && profile),
  });
  const canApprove = profile?.role === 'admin' || profile?.role === 'project_manager';
  const savedRows = scorecards.data?.entries ?? [];
  const locked = scorecards.data?.status === 'approved';
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
    if (scorecards.data) setValues(parseSavedValues(scorecards.data.entries));
    else setValues({});
  }, [cards, scorecards.data, scorecards.isLoading, month]);

  const save = useMutation({
    mutationFn: async () => {
      if (!supabase || !profile || !canEdit) throw new Error('لا تملك صلاحية تعديل بطاقة الأداء.');
      if (locked) throw new Error('الشهر معتمد ومقفل.');
      const { data: kpiMonth, error: monthError } = await supabase.from('kpi_months').upsert({
        month: `${month}-01`,
        work_order: KPI_WORK_ORDER,
        region,
        contractor: 'شركة شلفا لإدارة المرافق',
      }, { onConflict: 'month,work_order' }).select(APP_SCHEMA_SELECT.id).single();
      if (monthError) throw monthError;
      const rows = cards.flatMap((card) => card.indicators.map((indicator) => {
        const input = values[indicator.id];
        return {
          kpi_month_id: kpiMonth.id,
          indicator_code: indicator.id,
          applicable: input?.applicable ?? false,
          numerator: input?.numerator ?? null,
          denominator: input?.denominator ?? null,
          extra: { formInput: input ?? { applicable: false } },
          score: input?.applicable ? scoreByIndicatorId(indicator.id, input) : null,
        };
      }));
      const { error } = await supabase.from('kpi_entries').upsert(rows, {
        onConflict: 'kpi_month_id,indicator_code',
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
      const indicatorCount = cards.reduce((sum, card) => sum + card.indicators.length, 0);
      if (!scorecards.data?.id || savedRows.length !== indicatorCount) throw new Error('احفظ جميع مؤشرات الشهر قبل اعتماد الشهر.');
      const { error } = await supabase.from('kpi_months').update({
        status: 'approved',
        approved_by: profile.id,
      })
        .eq('id', scorecards.data.id);
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
  const selectedCard = cards.find((card) => card.code === activeTab);
  const activeIndicator = selectedCard?.indicators.find((indicator) => indicator.id === activeIndicatorId);
  const activeIndicatorInput = activeIndicator ? values[activeIndicator.id] ?? { applicable: false } : null;
  const activeIndicatorScore = activeIndicator && activeIndicatorInput
    ? scoreByIndicatorId(activeIndicator.id, activeIndicatorInput)
    : null;
  const discountCalculation = useMemo(() => {
    if (!deliverablesSummary.data || percentage === null) return null;
    try {
      return {
        result: calculateDiscount(
          deliverablesSummary.data.contractSigningDate,
          percentage,
          `${month}-01`,
          invoiceAmount,
        ),
        error: null,
      };
    } catch (error) {
      return { result: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, [deliverablesSummary.data, invoiceAmount, month, percentage]);

  return (
    <div className="grid gap-5">
      <section className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div><p className="text-sm text-slate-500">المنطقة الوسطى · أمر العمل {KPI_WORK_ORDER}</p><h2 className="mt-1 text-2xl font-bold text-brand-900">بطاقات الأداء الشهرية</h2></div>
        <label className="grid gap-1 text-sm font-semibold">شهر التقييم<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2" /></label>
      </section>

      {scorecards.error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">تعذر تحميل بيانات مؤشرات الأداء: {scorecards.error.message}</p>}
      {scorecards.isLoading && <p role="status" className="card p-5 text-center">جارٍ تحميل بطاقات الأداء…</p>}
      {catalogQuery.isLoading && <p role="status" className="card p-5 text-center">جارٍ تحميل تعريفات المؤشرات الرسمية…</p>}
      {catalogQuery.error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">تعذر تحميل تعريفات المؤشرات: {catalogQuery.error.message}</p>}
      {!canEdit && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">بيانات مؤشرات الأداء متاحة لمدير النظام ومدير المشروع فقط.</p>}

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5" aria-label="ملخص نتائج البطاقات">
        <article className="card border-amber-200 bg-amber-50 p-3">
          <p className="text-xs text-amber-800">النتيجة الإجمالية</p>
          <p className="mt-1 text-xl font-extrabold text-amber-700">{percentage === null ? '—' : `${percentage.toFixed(2)}%`}</p>
          <p className="text-[11px] text-amber-700">{rating === null ? 'أدخل البيانات المنطبقة' : rating === 'excellent' ? 'ممتاز' : rating === 'average' ? 'متوسط' : 'يحتاج إلى تحسين'}</p>
        </article>
        {cards.map((card) => {
          const score = cardScores[card.code] as number | null;
          return <article key={card.code} className="card border-blue-200 bg-blue-50 p-3">
            <p className="truncate text-xs text-blue-800">{cardNames[card.code]}</p>
            <p className="mt-1 text-xl font-extrabold text-blue-700">{score === null ? '—' : `${(score * 100).toFixed(2)}%`}</p>
            <p className="text-[11px] text-blue-700">من وزن {card.weight * 100}%</p>
          </article>;
        })}
      </section>

      <nav className="flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1" aria-label="بطاقات الأداء">
        <button type="button" aria-pressed={activeTab === 'overview'} onClick={() => setActiveTab('overview')} className={`shrink-0 rounded-lg px-4 py-2.5 text-sm font-bold transition ${activeTab === 'overview' ? 'bg-white text-brand-900 shadow-card' : 'text-slate-600 hover:bg-white/70'}`}>معلومات عامة</button>
        {cards.map((card) => <button key={card.code} type="button" aria-pressed={activeTab === card.code} onClick={() => setActiveTab(card.code)} className={`shrink-0 rounded-lg px-4 py-2.5 text-sm font-bold transition ${activeTab === card.code ? 'bg-white text-brand-900 shadow-card' : 'text-slate-600 hover:bg-white/70'}`}>{cardNames[card.code]}</button>)}
        <button type="button" aria-pressed={activeTab === 'discount'} onClick={() => setActiveTab('discount')} className={`shrink-0 rounded-lg px-4 py-2.5 text-sm font-bold transition ${activeTab === 'discount' ? 'bg-white text-brand-900 shadow-card' : 'text-slate-600 hover:bg-white/70'}`}>الغرامات المباشرة</button>
      </nav>

      {activeTab === 'overview' ? <section className="grid gap-4">
        <article className="card grid gap-3 p-4 sm:grid-cols-3">
          <div><p className="text-xs text-slate-500">شهر التقييم</p><p className="mt-1 font-bold text-brand-900">{month}</p></div>
          <div><p className="text-xs text-slate-500">حالة البطاقة</p><p className="mt-1 font-bold text-brand-900">{locked ? 'معتمدة ومقفلة' : scorecards.data ? 'مسودة قابلة للتعديل' : 'لم تحفظ بعد'}</p></div>
          <div><p className="text-xs text-slate-500">المنطقة · أمر العمل</p><p className="mt-1 font-bold text-brand-900">{region} · {KPI_WORK_ORDER}</p></div>
        </article>
        {deliverablesSummary.error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">تعذر تحميل ملخص المخرجات: {deliverablesSummary.error.message}</p>}
        {deliverablesSummary.data && <Link to="/kpi/deliverables" className="card grid gap-3 p-4 transition hover:border-brand-300" aria-label="فتح متابعة المخرجات التعاقدية">
          <div className="flex items-center justify-between gap-2"><h3 className="font-bold text-brand-900">ملخص المخرجات التعاقدية</h3><span className="text-sm text-brand-700 underline">فتح المتابعة</span></div>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <p>تم التسليم <strong>{deliverablesSummary.data.summary.delivered}</strong></p>
            <p>معتمد <strong>{deliverablesSummary.data.summary.approved}</strong></p>
            <p className={deliverablesSummary.data.summary.late ? 'text-rose-700' : ''}>متأخر <strong>{deliverablesSummary.data.summary.late}</strong></p>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-700" style={{ width: `${deliverablesSummary.data.summary.progressPercent}%` }} /></div>
        </Link>}
      </section> : activeTab === 'discount' ? <section className="card grid gap-5 p-4 sm:p-5">
        <div>
          <h3 className="text-lg font-bold text-brand-900">احتساب الغرامات المباشرة</h3>
          <p className="mt-1 text-sm leading-6 text-slate-500">يُحتسب الاستحقاق وفق نتيجة الأداء الشهرية وشهر العقد. أدخل قيمة الفاتورة لعرض مبلغ الحسم التقديري.</p>
        </div>
        {deliverablesSummary.error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">تعذر تحميل تاريخ توقيع العقد: {deliverablesSummary.error.message}</p>}
        {discountCalculation?.error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">تعذر احتساب الغرامة: {discountCalculation.error}</p>}
        <div className="max-w-sm">
          <NumberField label="قيمة الفاتورة" value={invoiceAmount} disabled={!canEdit || locked} onChange={setInvoiceAmount} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <article className="rounded-xl bg-slate-50 p-4"><p className="text-sm text-slate-500">شهر العقد</p><p className="mt-2 text-xl font-bold text-brand-900">{discountCalculation?.result?.contractMonth ?? '—'}</p></article>
          <article className="rounded-xl bg-slate-50 p-4"><p className="text-sm text-slate-500">نسبة الاستحقاق</p><p className="mt-2 text-xl font-bold text-brand-900">{discountCalculation?.result ? `${discountCalculation.result.payablePercent}%` : '—'}</p></article>
          <article className="rounded-xl bg-slate-50 p-4"><p className="text-sm text-slate-500">الحسم من الفاتورة</p><p className="mt-2 text-xl font-bold text-rose-700">{discountCalculation?.result?.withheldAmount === null || discountCalculation?.result?.withheldAmount === undefined ? '—' : discountCalculation.result.withheldAmount.toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p></article>
        </div>
        {discountCalculation?.result && !discountCalculation.result.accountable && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">لا تطبق الغرامة قبل الشهر الرابع من العقد.</p>}
        {percentage === null && <p role="status" className="text-sm text-slate-500">أكمل مؤشراً واحداً على الأقل لاحتساب نسبة الاستحقاق.</p>}
        {invoiceAmount === undefined && discountCalculation?.result && <p role="status" className="text-sm text-slate-500">أدخل قيمة الفاتورة لاحتساب مبلغ الحسم.</p>}
      </section> : selectedCard && <section className="card grid gap-4 overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 p-4 sm:p-5">
          <div><h3 className="text-lg font-bold text-brand-900">{cardNames[selectedCard.code]}</h3><p className="text-sm text-slate-500">الوزن {selectedCard.weight * 100}% · متوسط المؤشرات المنطبقة</p></div>
          <strong className="text-xl text-brand-900">{cardScores[selectedCard.code] === null ? '—' : `${((cardScores[selectedCard.code] as number) * 100).toFixed(2)}%`}</strong>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px] border-collapse text-sm">
            <thead className="bg-slate-50 text-xs font-bold text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-3 text-center">ينطبق</th>
                <th scope="col" className="px-3 py-3 text-start">المؤشر</th>
                <th scope="col" className="px-3 py-3 text-start">اسم المؤشر</th>
                <th scope="col" className="px-3 py-3 text-start">المدخل 1 (البسط)</th>
                <th scope="col" className="px-3 py-3 text-start">المدخل 2 (المقام)</th>
                <th scope="col" className="px-3 py-3 text-center">الدرجة المستحقة</th>
                <th scope="col" className="px-3 py-3 text-center">الحالة</th>
                <th scope="col" className="px-3 py-3 text-center">الحساب</th>
              </tr>
            </thead>
            <tbody>
              {selectedCard.indicators.map((indicator) => {
                const input = values[indicator.id] ?? { applicable: false };
                const result = scoreByIndicatorId(indicator.id, input);
                const observedOnly = usesObservedValue(indicator.id);
                const status = indicatorStatus(indicator.id, input, result);
                return <tr
                  key={indicator.id}
                  className="border-t border-slate-200 align-middle"
                >
                  <td className="px-3 py-3 text-center"><input type="checkbox" aria-label={`ينطبق ${indicator.id}`} checked={input.applicable} disabled={!canEdit || locked} onChange={(event) => updateIndicator(indicator.id, { applicable: event.target.checked })} /></td>
                  <td className="px-3 py-3 font-bold text-slate-700">
                    <button
                      type="button"
                      aria-label={`عرض معلومات المؤشر ${indicator.id}`}
                      aria-describedby={activeIndicatorId === indicator.id ? `indicator-tooltip-${indicator.id}` : undefined}
                      aria-expanded={activeIndicatorId === indicator.id}
                      onMouseEnter={() => setActiveIndicatorId(indicator.id)}
                      onMouseLeave={() => setActiveIndicatorId(null)}
                      onFocus={() => setActiveIndicatorId(indicator.id)}
                      onBlur={() => setActiveIndicatorId(null)}
                      onClick={() => setActiveIndicatorId(indicator.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') setActiveIndicatorId(null);
                      }}
                      className="rounded px-1 text-brand-800 underline decoration-dotted underline-offset-4 hover:bg-brand-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
                    >{indicator.id}</button>
                  </td>
                  <td className="max-w-[360px] px-3 py-3">
                    <p className="font-bold text-slate-900">{indicator.name}</p>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{indicator.target}</p>
                    <details className="mt-1 text-xs text-slate-500">
                      <summary className="cursor-pointer">تفاصيل المؤشر والدليل</summary>
                      <div className="mt-2 grid gap-1 leading-5">
                        <p>{indicator.description}</p><p><b>المعادلة:</b> {indicator.formulaDescription}</p><p><b>المصدر:</b> {indicator.source}</p>
                        <p><b>التكرار:</b> {indicator.frequency} · <b>الأهمية:</b> {indicator.importance}</p><p><b>الدليل المطلوب:</b> {indicator.requiredEvidence}</p>
                        <label className="mt-1 grid gap-1 font-semibold">مرجع الدليل<input value={input.evidence ?? ''} disabled={!canEdit || locked} onChange={(event) => updateIndicator(indicator.id, { evidence: event.target.value })} maxLength={2000} className="min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" /></label>
                      </div>
                    </details>
                  </td>
                  <td className="px-3 py-3"><NumberField compact label={observedOnly ? indicator.id === 'OM.1' ? 'عدد حالات NCR' : 'القيمة المحققة من 0 إلى 1' : 'المدخل 1 البسط'} value={observedOnly ? input.observed : input.numerator} disabled={!canEdit || locked} onChange={(value) => updateIndicator(indicator.id, observedOnly ? { observed: value } : { numerator: value })} /></td>
                  <td className="px-3 py-3">{observedOnly ? <span className="block text-center text-slate-400">—</span> : <NumberField compact label="المدخل 2 المقام" value={input.denominator} disabled={!canEdit || locked} onChange={(value) => updateIndicator(indicator.id, { denominator: value })} />}</td>
                  <td className="px-3 py-3 text-center font-extrabold text-brand-900">{input.applicable ? `${(result * 100).toFixed(1)}%` : '—'}</td>
                  <td className="px-3 py-3 text-center"><span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${status.className}`}>{status.label}</span></td>
                  <td className="px-3 py-3 text-center"><span className="whitespace-nowrap text-xs font-semibold text-slate-500">حساب تلقائي</span></td>
                </tr>;
          })}
            </tbody>
            <tfoot className="border-t-2 border-slate-200 bg-slate-50">
              <tr><th scope="row" colSpan={5} className="px-3 py-3 text-start">نتيجة {cardNames[selectedCard.code]} · وزن البطاقة {selectedCard.weight * 100}%</th><td className="px-3 py-3 text-center font-extrabold">{cardScores[selectedCard.code] === null ? '—' : `${((cardScores[selectedCard.code] as number) * 100).toFixed(2)}%`}</td><td colSpan={2} /></tr>
            </tfoot>
          </table>
        </div>
      </section>}

      {activeIndicator && activeIndicatorInput && activeIndicatorScore !== null && <aside
        id={`indicator-tooltip-${activeIndicator.id}`}
        role="tooltip"
        className="pointer-events-none fixed left-1/2 top-1/2 z-50 grid w-[min(42rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-2xl sm:p-6"
      >
        <h4 className="border-b border-slate-100 pb-3 text-base font-extrabold text-brand-900">{activeIndicator.id} · {activeIndicator.name}</h4>
        <InfoRow label="الوصف" value={activeIndicator.description} />
        <InfoRow label="معادلة القياس" value={activeIndicator.formulaDescription} />
        <InfoRow label="الهدف" value={activeIndicator.target} />
        <InfoRow label="المصدر" value={activeIndicator.source} />
        <InfoRow label="البيانات المطلوبة" value={activeIndicator.requiredEvidence} />
        <InfoRow label="القيمة المحققة" value={activeIndicatorInput.applicable ? `${(activeIndicatorScore * 100).toFixed(2)}%` : '—'} />
        <InfoRow label="الأهمية" value={activeIndicator.importance || '—'} />
        <InfoRow label="التكرار" value={activeIndicator.frequency || '—'} />
      </aside>}

      <section className="card flex flex-wrap items-center gap-3 p-4">
        <button type="button" disabled={!canEdit || locked || save.isPending} onClick={() => save.mutate()} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{save.isPending ? 'جارٍ الحفظ…' : 'حفظ بطاقات الشهر'}</button>
        {canApprove && <button type="button" disabled={locked || approve.isPending || savedRows.length !== cards.reduce((sum, card) => sum + card.indicators.length, 0)} onClick={() => approve.mutate()} className="rounded-lg border border-brand-700 px-4 py-2 text-sm font-bold text-brand-800 disabled:opacity-50">{approve.isPending ? 'جارٍ الاعتماد…' : 'اعتماد الشهر وإقفاله'}</button>}
        {locked && <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">الشهر معتمد ومقفل</span>}
        <button type="button" onClick={() => window.print()} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold">طباعة / حفظ PDF</button>
        {message && <p role="status" className="w-full text-sm text-slate-700">{message}</p>}
      </section>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-start gap-3 leading-6 sm:grid-cols-[8rem_minmax(0,1fr)]">
    <span className="font-semibold text-slate-500">{label}</span>
    <span className="whitespace-pre-line text-slate-800">{value}</span>
  </div>;
}

function NumberField({
  label,
  value,
  disabled,
  onChange,
  compact = false,
}: {
  label: string;
  value: number | undefined;
  disabled: boolean;
  onChange: (value: number | undefined) => void;
  compact?: boolean;
}) {
  return <label className={compact ? 'block' : 'grid gap-1 text-xs font-semibold text-slate-600'}>
    <span className={compact ? 'sr-only' : undefined}>{label}</span>
    <input type="number" min="0" step="any" value={value ?? ''} disabled={disabled} onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))} className="min-w-0 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm font-normal disabled:bg-slate-50" />
  </label>;
}

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { DEFAULT_STAFFING_RULES, SCHOOL_SIZE_CODES, SCHOOL_SIZE_LABELS, SCHOOL_SIZES, type SchoolSize, type StaffingRuleTable } from '../../domain/staffing';
import { supabase } from '../../lib/supabase';
import { APP_SCHEMA_SELECT } from '../../lib/schemaColumns';

const staffingRulesSchema = z.object({
  small: z.number().int().min(0).max(10),
  small_plus: z.number().int().min(0).max(10),
  medium: z.number().int().min(0).max(10),
  medium_plus: z.number().int().min(0).max(10),
  large: z.number().int().min(0).max(10),
  large_plus: z.number().int().min(0).max(10),
});

function toFormValues(rules: StaffingRuleTable): Record<SchoolSize, string> {
  return {
    small: String(rules.small),
    small_plus: String(rules.small_plus),
    medium: String(rules.medium),
    medium_plus: String(rules.medium_plus),
    large: String(rules.large),
    large_plus: String(rules.large_plus),
  };
}

async function loadStaffingRules(): Promise<StaffingRuleTable> {
  if (!supabase) throw new Error('يلزم إعداد Supabase.');
  const { data, error } = await supabase.from('app_config')
    .select(APP_SCHEMA_SELECT.appConfigValue)
    .eq('key', 'staffing_rules')
    .maybeSingle();
  if (error) throw error;
  return data ? staffingRulesSchema.parse(data.value) : DEFAULT_STAFFING_RULES;
}

export function StaffingRulesSettingsPage({ isAdmin }: { isAdmin: boolean }) {
  const client = useQueryClient();
  const { data: saved, isLoading, error } = useQuery({
    queryKey: ['staffing-rules'],
    queryFn: loadStaffingRules,
  });
  const [values, setValues] = useState<Record<SchoolSize, string>>(toFormValues(DEFAULT_STAFFING_RULES));
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (saved) {
      setValues(toFormValues(saved));
    }
  }, [saved]);

  const save = useMutation({
    mutationFn: async (rules: StaffingRuleTable) => {
      if (!supabase || !isAdmin) throw new Error('تعديل قواعد العمالة متاح لمدير النظام فقط.');
      const { error: saveError } = await supabase.from('app_config').upsert({ key: 'staffing_rules', value: rules });
      if (saveError) throw saveError;
    },
    onSuccess: async () => {
      setMessage('تم حفظ قواعد احتياج عمال النظافة.');
      await Promise.all([
        client.invalidateQueries({ queryKey: ['staffing-rules'] }),
        client.invalidateQueries({ queryKey: ['dashboard-staffing-data'] }),
        client.invalidateQueries({ queryKey: ['cleaner-placement-data'] }),
      ]);
    },
    onError: (saveError: Error) => setMessage(`تعذر الحفظ: ${saveError.message}`),
  });

  async function saveValues() {
    const asNumber = (value: string) => value.trim() === '' ? Number.NaN : Number(value);
    const parsed = staffingRulesSchema.safeParse({
      small: asNumber(values.small),
      small_plus: asNumber(values.small_plus),
      medium: asNumber(values.medium),
      medium_plus: asNumber(values.medium_plus),
      large: asNumber(values.large),
      large_plus: asNumber(values.large_plus),
    });
    if (!parsed.success) {
      setMessage('أدخل أعداداً صحيحة من صفر إلى 10 لكل حجم.');
      return;
    }
    save.mutate(parsed.data);
  }

  return (
    <section className="card grid gap-5 p-5 md:p-6">
      <div>
        <h2 className="text-xl font-bold text-brand-900">قواعد احتياج عمال النظافة حسب الحجم</h2>
        <p className="mt-1 text-sm leading-7 text-slate-500">أولوية احتياج العمالة: تصحيح الحجم اليدوي، ثم استثناء المدرسة، ثم مؤشر الحجم الصريح، ثم عدد الفصول كمرجع احتياطي.</p>
      </div>
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">تعذر تحميل قواعد العمالة: {error.message}</p>}
      {isLoading ? <p role="status">جارٍ تحميل القواعد…</p> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SCHOOL_SIZES.map((size) => <label key={size} className="grid gap-1.5 text-sm font-semibold text-slate-700">
          <span>{SCHOOL_SIZE_LABELS[size]}</span>
          <input
            type="number"
            min="0"
            max="10"
            step="1"
            value={values[size]}
            disabled={!isAdmin}
            aria-label={`عدد العمال المطلوب لحجم ${SCHOOL_SIZE_CODES[size]}`}
            onChange={(event) => setValues((current) => ({ ...current, [size]: event.target.value }))}
            className="rounded-lg border border-slate-300 px-3 py-2.5 font-normal disabled:bg-slate-50"
          />
        </label>)}
      </div>}
      <div>
        {isAdmin
          ? <button type="button" disabled={isLoading || save.isPending} onClick={() => void saveValues()} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">حفظ قواعد العمالة</button>
          : <p className="text-sm text-slate-500">يمكن لمدير النظام تعديل هذه القيم.</p>}
        {message && <p role="status" className="mt-3 text-sm text-slate-700">{message}</p>}
      </div>
    </section>
  );
}

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import type { PlanEligibilityConfig } from '../../domain/planEligibility';
import { supabase } from '../../lib/supabase';

const configSchema = z.object({
  buildingTypeHeader: z.string().trim().min(1),
  independentBuildingValues: z.array(z.string().trim().min(1)).min(1),
  primarySharedValues: z.array(z.string().trim().min(1)).min(1),
  elevatorContractorHeader: z.string().trim().min(1),
  noElevatorValues: z.array(z.string().trim()),
  classCountHeader: z.string().trim().min(1).default('عدد الفصول'),
  schoolSizeHeader: z.string().trim().default(''),
});

const savedSchema = z.object({ key: z.literal('plan_eligibility'), value: configSchema });
type EligibilitySettings = PlanEligibilityConfig & { classCountHeader: string; schoolSizeHeader: string };
const initialConfig: EligibilitySettings = {
  buildingTypeHeader: 'نوع المبنى',
  independentBuildingValues: ['مستقل'],
  primarySharedValues: ['مشترك اساسي'],
  elevatorContractorHeader: 'مقاول المصاعد',
  noElevatorValues: ['لا ينطبق'],
  classCountHeader: 'عدد الفصول',
  schoolSizeHeader: 'حجم المدرسة',
};

async function loadEligibility(): Promise<EligibilitySettings | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('app_settings').select('key,value').eq('key', 'plan_eligibility').maybeSingle();
  if (error) throw error;
  return data ? savedSchema.parse(data).value : null;
}

export function PlanEligibilitySettingsPage() {
  const client = useQueryClient();
  const { data: saved, isLoading } = useQuery({ queryKey: ['plan-eligibility'], queryFn: loadEligibility });
  const [values, setValues] = useState(initialConfig);
  const [message, setMessage] = useState('');
  useEffect(() => { if (saved) setValues(saved); }, [saved]);

  const save = useMutation({
    mutationFn: async (config: EligibilitySettings) => {
      if (!supabase) throw new Error('يلزم إعداد Supabase.');
      const { error } = await supabase.from('app_settings').upsert({ key: 'plan_eligibility', value: config, updated_at: new Date().toISOString() });
      if (error) throw error;
    },
    onSuccess: async () => {
      setMessage('تم حفظ قواعد الأهلية.');
      await client.invalidateQueries({ queryKey: ['plan-eligibility'] });
    },
    onError: (error: Error) => setMessage(`تعذر الحفظ: ${error.message}`),
  });

  function setList(field: 'independentBuildingValues' | 'primarySharedValues' | 'noElevatorValues', text: string) {
    setValues((current) => ({ ...current, [field]: text.split(/\r?\n/).map((value) => value.trim()).filter(Boolean) }));
  }

  async function saveValues() {
    try {
      await save.mutateAsync(configSchema.parse(values));
    } catch (error) {
      setMessage(error instanceof Error ? `تحقق من الإعدادات: ${error.message}` : 'إعدادات غير صالحة.');
    }
  }

  return (
    <section className="card grid gap-5 p-5 md:p-6">
      <div>
        <h2 className="text-xl font-bold text-brand-900">أهلية المدارس للخطط</h2>
        <p className="mt-1 text-sm leading-7 text-slate-500">أدخل القيم كما تظهر تماماً في المصدر. لا تُنشأ الخطط قبل حفظ هذه المطابقة.</p>
      </div>
      {isLoading ? <p role="status">جارٍ تحميل الإعدادات…</p> : <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="عنوان عمود نوع المبنى" value={values.buildingTypeHeader} onChange={(value) => setValues((current) => ({ ...current, buildingTypeHeader: value }))} />
        <TextField label="عنوان عمود مقاول المصاعد" value={values.elevatorContractorHeader} onChange={(value) => setValues((current) => ({ ...current, elevatorContractorHeader: value }))} />
        <TextField label="عنوان عمود عدد الفصول" value={values.classCountHeader} onChange={(value) => setValues((current) => ({ ...current, classCountHeader: value }))} />
        <TextField label="عنوان عمود حجم المدرسة (اختياري)" value={values.schoolSizeHeader} onChange={(value) => setValues((current) => ({ ...current, schoolSizeHeader: value }))} />
        <TextArea label="قيم المبنى المستقل (قيمة في كل سطر)" value={values.independentBuildingValues.join('\n')} onChange={(value) => setList('independentBuildingValues', value)} />
        <TextArea label="قيم المشترك الأساسي (قيمة في كل سطر)" value={values.primarySharedValues.join('\n')} onChange={(value) => setList('primarySharedValues', value)} />
        <TextArea label="قيم عدم وجود مقاول مصاعد (قيمة في كل سطر)" value={values.noElevatorValues.join('\n')} onChange={(value) => setList('noElevatorValues', value)} />
      </div>}
      <div>
        <button type="button" disabled={isLoading || save.isPending} onClick={() => void saveValues()} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">حفظ قواعد الأهلية</button>
        {message && <p role="status" className="mt-3 text-sm text-slate-700">{message}</p>}
      </div>
    </section>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="grid gap-1.5 text-sm font-semibold text-slate-700">{label}<input value={value} onChange={(event) => onChange(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>;
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="grid gap-1.5 text-sm font-semibold text-slate-700">{label}<textarea value={value} onChange={(event) => onChange(event.target.value)} rows={3} className="rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>;
}

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { assertUniqueActiveName, customPlanCreateSchema } from '../../domain/customPlans';
import { supabase } from '../../lib/supabase';
import type { UserProfile } from '../../lib/auth';

export function CustomPlanTypeDialog({ profile, group, onClose }: { profile: UserProfile; group: 'monthly' | 'general'; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState({ name: '', cadence: 'monthly' as const, scope: 'all_in_scope' as const, track_visit_report: true });
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: async () => {
      if (!supabase) throw new Error('يلزم إعداد Supabase.');
      const parsed = customPlanCreateSchema.parse({ ...values, group_key: group });
      const { data: activeTypes, error: listError } = await supabase.from('custom_plan_types').select('id,name,is_active').eq('is_active', true);
      if (listError) throw listError;
      assertUniqueActiveName(parsed.name, (activeTypes ?? []).map((item) => ({ ...item, is_active: Boolean(item.is_active) })));
      const { error: insertError } = await supabase.from('custom_plan_types').insert({ ...parsed, name: parsed.name.trim(), created_by: profile.id });
      if (insertError) throw insertError;
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['custom-plan-types'] }); onClose(); },
    onError: (reason: unknown) => setError(reason instanceof z.ZodError ? reason.issues[0]?.message ?? 'تحقق من البيانات.' : reason instanceof Error ? reason.message : 'تعذر إنشاء الخطة.'),
  });
  return <div className="fixed inset-0 z-30 grid place-items-center bg-slate-950/30 p-4" role="dialog" aria-modal="true" aria-labelledby="custom-plan-title">
    <form className="card w-full max-w-lg grid gap-4 p-6" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
      <h2 id="custom-plan-title" className="text-xl font-bold text-brand-900">إضافة خطة</h2>
      <label className="grid gap-1 text-sm font-semibold">اسم الخطة (بالعربية)<input autoFocus value={values.name} onChange={(event) => setValues({ ...values, name: event.target.value })} className="rounded-lg border border-slate-300 px-3 py-2" required /></label>
      <label className="grid gap-1 text-sm font-semibold">الدورية<select value={values.cadence} onChange={(event) => setValues({ ...values, cadence: event.target.value as 'monthly' })} className="rounded-lg border border-slate-300 px-3 py-2"><option value="monthly">شهرية</option><option value="yearly">سنوية</option></select></label>
      <label className="grid gap-1 text-sm font-semibold">النطاق<select value={values.scope} onChange={(event) => setValues({ ...values, scope: event.target.value as 'all_in_scope' })} className="rounded-lg border border-slate-300 px-3 py-2"><option value="all_in_scope">كل المدارس ضمن النطاق</option><option value="manual">اختيار يدوي</option></select></label>
      <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={values.track_visit_report} onChange={(event) => setValues({ ...values, track_visit_report: event.target.checked })} /> متابعة الزيارة والتقرير</label>
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2">إلغاء</button><button type="submit" disabled={save.isPending} className="rounded-lg bg-brand-700 px-4 py-2 font-bold text-white disabled:opacity-50">حفظ</button></div>
    </form>
  </div>;
}

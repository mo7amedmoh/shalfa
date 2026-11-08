import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { loadXlsx } from '../../lib/xlsx';
import { customPlanTypeSchema, type CustomPlanType } from '../../domain/customPlans';
import type { UserProfile } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { CustomPlanTypeDialog } from '../plans/CustomPlanTypeDialog';

const typeListSchema = z.array(customPlanTypeSchema);

async function loadTypes(): Promise<CustomPlanType[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('custom_plan_types')
    .select('id,name,cadence,scope,track_visit_report,group_key,created_at,is_active').order('created_at');
  if (error) throw error;
  return typeListSchema.parse(data);
}

export function PlanManagementPage({ profile }: { profile: UserProfile }) {
  const queryClient = useQueryClient();
  const [dialogGroup, setDialogGroup] = useState<'monthly' | 'general' | null>(null);
  const [message, setMessage] = useState('');
  const types = useQuery({ queryKey: ['custom-plan-types'], queryFn: loadTypes });

  async function updateType(type: CustomPlanType, active: boolean) {
    if (!supabase) return;
    const word = active ? 'استعادة' : 'إخفاء';
    if (window.prompt(`اكتب ${word} للتأكيد:`) !== word) return;
    const { error } = await supabase.from('custom_plan_types').update({ is_active: active }).eq('id', type.id);
    if (error) throw error;
    await queryClient.invalidateQueries({ queryKey: ['custom-plan-types'] });
  }

  async function deleteType(type: CustomPlanType) {
    if (!supabase) return;
    if (window.prompt('اكتب حذف للتأكيد:') !== 'حذف') return;
    const { data: plans, error: plansError } = await supabase.from('custom_plans').select('id,period').eq('type_id', type.id);
    if (plansError) throw plansError;
    const planIds = (plans ?? []).map((plan) => plan.id);
    const { data: rows, error: rowsError } = planIds.length
      ? await supabase.from('custom_plan_rows').select('*').in('plan_id', planIds)
      : { data: [], error: null };
    if (rowsError) throw rowsError;
    const XLSX = await loadXlsx();
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(plans ?? []), 'الفترات');
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows ?? []), 'الصفوف');
    XLSX.writeFile(book, `نسخة-احتياطية-${type.name}.xlsx`);
    const { error } = await supabase.from('custom_plan_types').delete().eq('id', type.id);
    if (error) throw error;
    await queryClient.invalidateQueries({ queryKey: ['custom-plan-types'] });
  }

  async function checkSchema() {
    if (!supabase) return;
    const { error } = await supabase.from('custom_plan_types').select('id,group_key').limit(1);
    setMessage(error
      ? `فحص المخطط: تنقص أعمدة/تغييرات ترحيل 202611060005_custom_plan_group_and_audit.sql. ${error.message}`
      : 'فحص المخطط: أعمدة الخطط المخصصة موجودة وجاهزة.');
    if (error) console.error('Custom plan schema check failed', error);
  }

  const active = (types.data ?? []).filter((type) => type.is_active);
  const hidden = (types.data ?? []).filter((type) => !type.is_active);
  return <section className="grid gap-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-sm text-slate-500">الإعدادات</p><h2 className="text-2xl font-bold text-brand-900">إدارة الخطط</h2></div>
      <button type="button" onClick={() => void checkSchema()} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">فحص المخطط</button>
    </div>
    {message && <p role="status" className="rounded-lg bg-slate-50 p-3 text-sm">{message}</p>}
    <section className="card grid gap-3 p-5">
      <h3 className="font-bold">إنشاء خطة مخصصة</h3>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setDialogGroup('monthly')} className="rounded-lg border border-brand-200 px-3 py-2 text-sm font-semibold text-brand-800">+ إضافة خطة شهرية</button>
        <button type="button" onClick={() => setDialogGroup('general')} className="rounded-lg border border-brand-200 px-3 py-2 text-sm font-semibold text-brand-800">+ إضافة خطة عامة</button>
      </div>
    </section>
    <section className="card grid gap-3 p-5"><h3 className="font-bold">الخطط النشطة</h3>
      {active.map((type) => <PlanItem key={type.id} type={type} onHide={() => void updateType(type, false)} onDelete={() => void deleteType(type)} />)}
      {!active.length && <p className="text-sm text-slate-500">لا توجد خطط مخصصة نشطة.</p>}
    </section>
    <section className="card grid gap-3 p-5"><h3 className="font-bold">خطط مخفية</h3>
      {hidden.map((type) => <PlanItem key={type.id} type={type} onRestore={() => void updateType(type, true)} />)}
      {!hidden.length && <p className="text-sm text-slate-500">لا توجد خطط مخفية.</p>}
    </section>
    {dialogGroup && <CustomPlanTypeDialog profile={profile} group={dialogGroup} onClose={() => setDialogGroup(null)} />}
  </section>;
}

function PlanItem({ type, onHide, onRestore, onDelete }: { type: CustomPlanType; onHide?: () => void; onRestore?: () => void; onDelete?: () => void }) {
  return <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-2 text-sm">
    <span>{type.name} · {type.group_key === 'monthly' ? 'شهرية' : 'عامة'} · {type.cadence === 'monthly' ? 'شهرية' : 'سنوية'}</span>
    <span className="flex gap-2">{onHide && <button type="button" onClick={onHide} className="text-amber-700">إخفاء</button>}{onRestore && <button type="button" onClick={onRestore} className="text-brand-700">استعادة</button>}{onDelete && <button type="button" onClick={onDelete} className="text-rose-700">حذف</button>}</span>
  </div>;
}

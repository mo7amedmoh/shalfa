import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Save } from 'lucide-react';
import { z } from 'zod';
import { duplicateMinistryRows } from '../../domain/schoolMap';
import { schoolSyncConfigSchema, syncSchools, type SchoolSyncConfig, type SchoolSyncResult } from '../../lib/schoolSync';
import { supabase } from '../../lib/supabase';
import { DuplicateSchoolWarning } from '../schools/SchoolSyncWarnings';

const persistedConfigSchema = z.object({
  key: z.literal('school_sync'),
  value: schoolSyncConfigSchema,
});
const schoolStatusSchema = z.object({
  ministry_number: z.string(),
  source_row: z.number().int().nullable(),
  missing_from_sheet_at: z.string().nullable(),
});

async function loadConfig(): Promise<SchoolSyncConfig | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('app_config').select('key,value').eq('key', 'school_sync').maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return persistedConfigSchema.parse(data).value;
}

async function loadSchoolStatus() {
  if (!supabase) return [];
  const { data, error } = await supabase.from('schools')
    .select('ministry_number:ministry_no,source_row,missing_from_sheet_at')
    .order('source_row');
  if (error) throw error;
  return z.array(schoolStatusSchema).parse(data);
}

export function SyncSettingsPage() {
  const queryClient = useQueryClient();
  const { data: savedConfig, isLoading } = useQuery({ queryKey: ['school-sync-config'], queryFn: loadConfig });
  const schoolStatus = useQuery({ queryKey: ['school-sync-status'], queryFn: loadSchoolStatus });
  const [lastReport, setLastReport] = useState<SchoolSyncResult | null>(null);
  const [values, setValues] = useState<SchoolSyncConfig>({
    tabName: 'قاعدة بيانات المدارس',
    ministryNumberHeader: 'الرقم الوزاري',
    schoolNameHeader: 'اسم المدرسة',
    latitudeHeader: 'الشماليات',
    longitudeHeader: 'الشرقيات',
    intervalMinutes: 60,
  });
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (savedConfig) setValues(savedConfig);
  }, [savedConfig]);

  const saveMutation = useMutation({
    mutationFn: async (config: SchoolSyncConfig) => {
      if (!supabase) throw new Error('يلزم إعداد Supabase.');
      const { error } = await supabase.from('app_config').upsert({
        key: 'school_sync',
        value: config,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setMessage('تم حفظ إعدادات الربط.');
      await queryClient.invalidateQueries({ queryKey: ['school-sync-config'] });
    },
    onError: (error: Error) => setMessage(`تعذر الحفظ: ${error.message}`),
  });
  const syncMutation = useMutation({
    mutationFn: () => syncSchools(values),
    onSuccess: async (result) => {
      setLastReport(result);
      setMessage(`اكتملت المزامنة. جديد: ${result.inserted} · محدث: ${result.updated} · صفوف مكررة للتنبيه: ${result.duplicatesWarned} · معلّمة كمفقودة: ${result.flaggedMissing} · إحداثيات ناقصة/غير صالحة: ${result.invalidCoordinates}`);
      await queryClient.invalidateQueries({ queryKey: ['schools'] });
      await queryClient.invalidateQueries({ queryKey: ['school-sync-status'] });
    },
    onError: (error: Error) => setMessage(`تعذرت المزامنة: ${error.message}`),
  });

  function update(field: keyof SchoolSyncConfig, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  async function save() {
    try {
      const config = schoolSyncConfigSchema.parse(values);
      await saveMutation.mutateAsync(config);
    } catch (error) {
      setMessage(error instanceof Error ? `تحقق من الإعدادات: ${error.message}` : 'إعدادات غير صالحة.');
    }
  }

  return (
    <section className="card grid gap-5 p-5 md:p-6">
      <div>
        <h2 className="text-xl font-bold text-brand-900">إعداد مزامنة المدارس</h2>
        <p className="mt-1 text-sm leading-7 text-slate-500">اضبط اسم التبويب وعناوين الحقول يدوياً. لا تُستخدم الإحداثيات إلا عند تأكيد عموديها.</p>
      </div>
      {schoolStatus.error && <p role="alert" className="text-sm text-rose-800">تعذر تحميل تنبيهات بيانات المدارس: {schoolStatus.error.message}</p>}
      <DuplicateSchoolWarning duplicates={lastReport?.duplicateNumbers ?? duplicateMinistryRows(schoolStatus.data ?? [])} />
      {isLoading ? <p role="status">جارٍ تحميل الإعدادات…</p> : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="اسم تبويب المصدر" value={values.tabName} onChange={(value) => update('tabName', value)} required />
          <Input label="عمود الرقم الوزاري" value={values.ministryNumberHeader} onChange={(value) => update('ministryNumberHeader', value)} required />
          <Input label="عمود اسم المدرسة" value={values.schoolNameHeader} onChange={(value) => update('schoolNameHeader', value)} required />
          <Input label="عمود خط العرض (اختياري)" value={values.latitudeHeader ?? ''} onChange={(value) => update('latitudeHeader', value)} />
          <Input label="عمود خط الطول (اختياري)" value={values.longitudeHeader ?? ''} onChange={(value) => update('longitudeHeader', value)} />
          <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
            فترة المزامنة التلقائية بالدقائق (15–1440)
            <input type="number" min="15" max="1440" step="1" value={values.intervalMinutes} onChange={(event) => setValues((current) => ({ ...current, intervalMinutes: Number(event.target.value) }))} className="rounded-lg border border-slate-300 px-3 py-2.5 font-normal" />
          </label>
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={saveMutation.isPending || isLoading} onClick={() => void save()} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold disabled:opacity-50"><Save size={16} /> حفظ الإعدادات</button>
        <button type="button" disabled={syncMutation.isPending || isLoading || !values.tabName.trim()} onClick={() => syncMutation.mutate()} className="inline-flex items-center gap-2 rounded-lg bg-brand-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"><RefreshCw size={16} /> {syncMutation.isPending ? 'جارٍ المزامنة…' : 'مزامنة الآن'}</button>
      </div>
      {message && <p role="status" className="text-sm text-slate-700">{message}</p>}
      {lastReport && <p className="text-sm text-slate-600">أرقام المدارس الجديدة والمحدثة محفوظة جميعاً. لم تُحذف أي مدرسة؛ تم تعليم السجلات الغائبة بتاريخ فقط.</p>}
      <p className="text-xs leading-6 text-slate-500">لا تُحذف المدارس التي لم تعد في المصدر تلقائياً؛ المزامنة تحدث السجلات المعروفة فقط.</p>
    </section>
  );
}

function Input({
  label,
  value,
  onChange,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
      {label}
      <input required={required} value={value} onChange={(event) => onChange(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2.5 font-normal" />
    </label>
  );
}

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import type { UserProfile } from '../../lib/auth';
import { defaultPreferences, loadUserPreferences, preferencesSchema } from '../../lib/preferences';
import { supabase } from '../../lib/supabase';

type Preferences = z.infer<typeof preferencesSchema>;

export function AccountPage({ profile }: { profile: UserProfile | null }) {
  const queryClient = useQueryClient();
  const { register, handleSubmit, reset, formState: { isSubmitting } } = useForm({ defaultValues: { display_name: profile?.display_name ?? '', phone: profile?.phone ?? '' } });
  const { register: registerPassword, handleSubmit: handlePassword, reset: resetPassword, formState: { isSubmitting: changingPassword } } = useForm<{ password: string; confirmPassword: string }>();
  const { register: registerEmail, handleSubmit: handleEmail, reset: resetEmail, formState: { isSubmitting: linkingEmail } } = useForm<{ email: string }>();
  const [linkedEmail, setLinkedEmail] = useState('');
  const [profileMessage, setProfileMessage] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const [preferencesMessage, setPreferencesMessage] = useState('');
  const [preferences, setPreferences] = useState(defaultPreferences);
  const prefsQuery = useQuery({
    queryKey: ['user-preferences', profile?.id],
    queryFn: () => loadUserPreferences(profile!.id),
    enabled: Boolean(profile?.id),
  });

  useEffect(() => {
    if (profile) reset({ display_name: profile.display_name ?? '', phone: profile.phone ?? '' });
  }, [profile, reset]);

  useEffect(() => {
    if (prefsQuery.data) setPreferences(prefsQuery.data);
  }, [prefsQuery.data]);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void supabase.auth.getUser().then(({ data, error }) => {
      if (error) {
        console.error('تعذر تحميل بيانات البريد المرتبط.', error);
        return;
      }
      const email = data.user?.email ?? '';
      if (active && !email.toLowerCase().endsWith('@shalfa.local')) setLinkedEmail(email);
    });
    return () => { active = false; };
  }, []);

  const savePreferences = useMutation({
    mutationFn: async (value: Preferences) => {
      if (!supabase || !profile) throw new Error('يلزم تسجيل الدخول.');
      const { error } = await supabase.from('profiles').update({ prefs: value }).eq('id', profile.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      setPreferencesMessage('تم حفظ تفضيلات العرض.');
      await queryClient.invalidateQueries({ queryKey: ['user-preferences', profile?.id] });
    },
    onError: (error: Error) => setPreferencesMessage(`تعذر الحفظ: ${error.message}`),
  });

  async function saveProfile(values: { display_name: string; phone: string }) {
    setProfileMessage('');
    if (!supabase || !profile) return setProfileMessage('يلزم تسجيل الدخول.');
    const parsed = z.object({
      display_name: z.string().trim().min(2).max(120),
      phone: z.string().trim().max(30),
    }).safeParse(values);
    if (!parsed.success) return setProfileMessage('أدخل اسماً صحيحاً ورقم تواصل لا يتجاوز 30 خانة.');
    const { error } = await supabase.from('profiles').update({
      full_name: parsed.data.display_name,
      phone: parsed.data.phone || null,
    }).eq('id', profile.id);
    if (error) return setProfileMessage(`تعذر حفظ الملف: ${error.message}`);
    setProfileMessage('تم حفظ بيانات الملف الشخصي.');
  }

  async function changePassword(values: { password: string; confirmPassword: string }) {
    setPasswordMessage('');
    const passwordSchema = z.string().min(12).regex(/[a-z]/).regex(/[A-Z]/).regex(/\d/).regex(/[^A-Za-z0-9]/);
    const passwordResult = passwordSchema.safeParse(values.password);
    if (!passwordResult.success || values.password !== values.confirmPassword) {
      setPasswordMessage('استخدم 12 خانة على الأقل تشمل حرفاً صغيراً وكبيراً ورقماً ورمزاً، وتأكد من تطابق التأكيد.');
      return;
    }
    if (!supabase) return setPasswordMessage('يلزم إعداد Supabase.');
    const { error } = await supabase.auth.updateUser({ password: passwordResult.data });
    if (error) return setPasswordMessage(`تعذر تغيير كلمة المرور: ${error.message}`);
    resetPassword();
    setPasswordMessage('تم تحديث كلمة المرور.');
  }

  async function linkEmail(values: { email: string }) {
    setEmailMessage('');
    const parsed = z.string().email().safeParse(values.email.trim());
    if (!parsed.success || parsed.data.endsWith('@shalfa.local')) {
      setEmailMessage('أدخل بريداً إلكترونياً صالحاً غير البريد الاصطناعي.');
      return;
    }
    if (!supabase) return setEmailMessage('يلزم إعداد Supabase.');
    const { error } = await supabase.auth.updateUser({ email: parsed.data });
    if (error) return setEmailMessage(`تعذر ربط البريد: ${error.message}`);
    resetEmail();
    setEmailMessage('أُرسل طلب التحقق إلى البريد الجديد.');
  }

  async function persistPreferences() {
    try {
      await savePreferences.mutateAsync(preferencesSchema.parse(preferences));
    } catch (error) {
      setPreferencesMessage(error instanceof Error ? `تحقق من التفضيلات: ${error.message}` : 'تفضيلات غير صالحة.');
    }
  }

  return (
    <div className="grid gap-5">
      <section><p className="text-sm text-slate-500">الملف الشخصي والتفضيلات</p><h2 className="mt-1 text-2xl font-bold text-brand-900">حسابي</h2></section>
      <section className="card grid gap-4 p-5">
        <h3 className="font-bold">البيانات الشخصية</h3>
        <label className="grid gap-1 text-sm font-semibold">اسم المستخدم<input readOnly value={profile?.username ?? ''} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-normal" /></label>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={handleSubmit(saveProfile)}>
          <label className="grid gap-1 text-sm font-semibold">الاسم<input {...register('display_name')} required className="rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label>
          <label className="grid gap-1 text-sm font-semibold">رقم التواصل<input {...register('phone')} type="tel" className="rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label>
          <button type="submit" disabled={isSubmitting} className="w-fit rounded-lg bg-brand-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">حفظ البيانات</button>
        </form>
        {profileMessage && <p role="status" className="text-sm text-slate-700">{profileMessage}</p>}
      </section>

      <section className="card grid gap-4 p-5">
        <h3 className="font-bold">البريد الإلكتروني المرتبط</h3>
        <p className="text-sm text-slate-500">{linkedEmail || 'لم يُربط بريد إلكتروني بعد.'}</p>
        <form className="flex flex-col gap-3 sm:flex-row" onSubmit={handleEmail((values) => void linkEmail(values))}>
          <input type="email" placeholder="البريد الإلكتروني" {...registerEmail('email', { required: true })} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2" />
          <button type="submit" disabled={linkingEmail} className="rounded-lg border border-brand-700 px-4 py-2 text-sm font-semibold text-brand-800 disabled:opacity-50">ربط البريد</button>
        </form>
        {emailMessage && <p role="status" className="text-sm text-slate-700">{emailMessage}</p>}
      </section>

      <section className="card grid gap-4 p-5">
        <h3 className="font-bold">تغيير كلمة المرور</h3>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={handlePassword((values) => void changePassword(values))}>
          <input type="password" autoComplete="new-password" placeholder="كلمة المرور الجديدة" {...registerPassword('password', { required: true })} className="rounded-lg border border-slate-300 px-3 py-2" />
          <input type="password" autoComplete="new-password" placeholder="تأكيد كلمة المرور" {...registerPassword('confirmPassword', { required: true })} className="rounded-lg border border-slate-300 px-3 py-2" />
          <button type="submit" disabled={changingPassword} className="w-fit rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50">تحديث كلمة المرور</button>
        </form>
        {passwordMessage && <p role="status" className="text-sm text-slate-700">{passwordMessage}</p>}
      </section>

      <section className="card grid gap-4 p-5">
        <h3 className="font-bold">تفضيلات العرض</h3>
        {prefsQuery.isLoading ? <p role="status">جارٍ تحميل التفضيلات…</p> : <div className="grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1 text-sm font-semibold">الأرقام<select value={preferences.numerals} onChange={(event) => { const value = event.target.value; if (value === 'latin' || value === 'arabic_indic') setPreferences((current) => ({ ...current, numerals: value })); }} className="rounded-lg border border-slate-300 px-3 py-2 font-normal"><option value="latin">لاتينية (0–9)</option><option value="arabic_indic">عربية هندية (٠–٩)</option></select></label>
          <label className="grid gap-1 text-sm font-semibold">تنسيق التاريخ<select value={preferences.date_format} onChange={(event) => { const value = event.target.value; if (value === 'dd/mm/yyyy' || value === 'yyyy/mm/dd') setPreferences((current) => ({ ...current, date_format: value })); }} className="rounded-lg border border-slate-300 px-3 py-2 font-normal"><option value="dd/mm/yyyy">يوم / شهر / سنة</option><option value="yyyy/mm/dd">سنة / شهر / يوم</option></select></label>
          <label className="grid gap-1 text-sm font-semibold">عدد الصفوف في الصفحة<select value={preferences.rows_per_page} onChange={(event) => setPreferences((current) => ({ ...current, rows_per_page: Number(event.target.value) }))} className="rounded-lg border border-slate-300 px-3 py-2 font-normal"><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label>
        </div>}
        <button type="button" disabled={savePreferences.isPending || prefsQuery.isLoading} onClick={() => void persistPreferences()} className="w-fit rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50">حفظ التفضيلات</button>
        {preferencesMessage && <p role="status" className="text-sm text-slate-700">{preferencesMessage}</p>}
      </section>
    </div>
  );
}

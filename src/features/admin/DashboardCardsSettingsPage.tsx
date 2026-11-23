import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  dashboardCardOptions,
  defaultDashboardCardSettings,
  type DashboardCardId,
  type DashboardCardSettings,
} from '../../domain/dashboardCards';
import { loadDashboardCardSettings, saveDashboardCardSettings } from '../../lib/dashboardCards';

const queryKey = ['dashboard-card-settings'];

export function DashboardCardsSettingsPage() {
  const client = useQueryClient();
  const { data: saved, isLoading, error } = useQuery({
    queryKey,
    queryFn: loadDashboardCardSettings,
  });
  const [settings, setSettings] = useState<DashboardCardSettings>(defaultDashboardCardSettings);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (saved) setSettings(saved);
  }, [saved]);

  const save = useMutation({
    mutationFn: saveDashboardCardSettings,
    onSuccess: async () => {
      setMessage('تم حفظ تخصيص لوحة التحكم.');
      await client.invalidateQueries({ queryKey });
    },
    onError: (saveError: Error) => setMessage(`تعذر الحفظ: ${saveError.message}`),
  });

  function toggleCard(id: DashboardCardId, visible: boolean) {
    setSettings((current) => ({
      hiddenIds: visible
        ? current.hiddenIds.filter((hiddenId) => hiddenId !== id)
        : [...current.hiddenIds, id],
    }));
    setMessage('');
  }

  return (
    <section className="card grid gap-5 p-5 md:p-6">
      <div>
        <h2 className="text-xl font-bold text-brand-900">تخصيص لوحة التحكم</h2>
        <p className="mt-1 text-sm leading-7 text-slate-500">
          اختر البطاقات التي تريد إتاحتها للمستخدمين. ستظهر كل بطاقة للمستخدم فقط إذا كانت صلاحيات دوره تسمح بها.
        </p>
      </div>
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">تعذر تحميل التخصيص: {error.message}</p>}
      {isLoading ? <p role="status">جارٍ تحميل إعدادات لوحة التحكم…</p> : (
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="sr-only">البطاقات التي تظهر في لوحة التحكم</legend>
          {dashboardCardOptions.map(({ id, label, permissionHint }) => (
            <label key={id} className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
              <input
                type="checkbox"
                checked={!settings.hiddenIds.includes(id)}
                onChange={(event) => toggleCard(id, event.target.checked)}
                className="mt-1 accent-brand-700"
              />
              <span className="grid gap-1">
                <span className="font-semibold text-slate-800">{label}</span>
                <span className="text-xs text-slate-500">تُعرض حسب صلاحيات المستخدم: {permissionHint}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <div>
        <button
          type="button"
          disabled={isLoading || Boolean(error) || save.isPending}
          onClick={() => save.mutate(settings)}
          className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {save.isPending ? 'جارٍ الحفظ…' : 'حفظ تخصيص لوحة التحكم'}
        </button>
        {message && <p role="status" className="mt-3 text-sm text-slate-700">{message}</p>}
      </div>
    </section>
  );
}

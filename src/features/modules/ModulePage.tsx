import { useParams } from 'react-router-dom';
import { SyncSettingsPage } from '../admin/SyncSettingsPage';
import { PlanEligibilitySettingsPage } from '../admin/PlanEligibilitySettingsPage';
import { ChecklistPage } from '../kpi/ChecklistPage';
import { ScorecardsPage } from '../kpi/ScorecardsPage';
import type { UserProfile } from '../../lib/auth';

type ModuleSection = 'kpi' | 'admin';

const labels: Record<ModuleSection, Record<string, string>> = {
  kpi: {
    scorecards: 'بطاقات الأداء الشهرية',
    checklist: 'قائمة الفحص CM/OM',
    deliverables: 'المخرجات التعاقدية',
  },
  admin: { settings: 'المزامنة والإعدادات' },
};

const descriptions: Record<ModuleSection, string> = {
  kpi: 'مؤشرات ونتائج تُحمّل من الملفات الرسمية بعد توفرها والتحقق من معادلاتها.',
  admin: 'إعدادات النظام والعمليات الإدارية المسموح بها.',
};

export function ModulePage({ section, profile = null }: { section: ModuleSection; profile?: UserProfile | null }) {
  const { type = 'index' } = useParams();
  const title = labels[section][type] ?? 'الوحدة المطلوبة';

  if (section === 'admin' && type === 'settings') {
    return <div className="grid gap-5"><PageHeading title={title} description={descriptions.admin} /><SyncSettingsPage /><PlanEligibilitySettingsPage /></div>;
  }
  if (section === 'kpi' && type in labels.kpi) {
    if (type === 'scorecards') return <ScorecardsPage profile={profile} />;
    if (type === 'checklist') return <ChecklistPage profile={profile} />;
    return <div className="grid gap-5"><PageHeading title={title} description={descriptions.kpi} /><KpiUnavailable /></div>;
  }
  return <section role="alert" className="card p-6 text-center text-slate-600">المسار المطلوب غير متاح.</section>;
}

function PageHeading({ title, description }: { title: string; description: string }) {
  return <section><p className="text-sm text-slate-500">{description}</p><h2 className="mt-1 text-2xl font-bold text-brand-900">{title}</h2></section>;
}

function KpiUnavailable() {
  return (
    <section className="card grid gap-4 p-5">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-7 text-amber-950">
        متابعة المخرجات التعاقدية غير متاحة بعد. بيانات المخرجات الرسمية موجودة في المصنف المرجعي، ويجب تنفيذ شاشة المتابعة وربطها قبل اعتمادها تشغيلياً.
      </div>
      <div className="flex flex-wrap gap-3">
        <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm">إدارة العقد CM <strong className="me-2">—</strong></div>
        <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm">العمليات OM <strong className="me-2">—</strong></div>
        <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm">الخدمات الثقيلة HS <strong className="me-2">—</strong></div>
        <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm">الخدمات الخفيفة SS <strong className="me-2">—</strong></div>
      </div>
      <button type="button" onClick={() => window.print()} className="w-fit rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold">طباعة الصفحة / حفظ PDF</button>
    </section>
  );
}

import { useParams } from 'react-router-dom';
import { SyncSettingsPage } from '../admin/SyncSettingsPage';
import { PlanEligibilitySettingsPage } from '../admin/PlanEligibilitySettingsPage';
import { ScorecardsPage } from '../kpi/ScorecardsPage';
import { DeliverablesPage } from '../kpi/DeliverablesPage';
import type { UserProfile } from '../../lib/auth';

type ModuleSection = 'kpi' | 'admin';

const labels: Record<ModuleSection, Record<string, string>> = {
  kpi: {
    scorecards: 'بطاقات الأداء الشهرية',
    deliverables: 'المخرجات التعاقدية',
  },
  admin: { settings: 'المزامنة والإعدادات' },
};

const descriptions: Record<ModuleSection, string> = {
  kpi: 'متابعة مؤشرات الأداء والمخرجات التعاقدية.',
  admin: 'إعدادات النظام والعمليات الإدارية المسموح بها.',
};

export function ModulePage({ section, profile = null, type: fixedType }: { section: ModuleSection; profile?: UserProfile | null; type?: string }) {
  const { type: routeType = 'index' } = useParams();
  const type = fixedType ?? routeType;
  const title = labels[section][type] ?? 'الوحدة المطلوبة';

  if (section === 'admin' && type === 'settings') {
    return <div className="grid gap-5"><PageHeading title={title} description={descriptions.admin} /><SyncSettingsPage /><PlanEligibilitySettingsPage /></div>;
  }
  if (section === 'kpi' && type in labels.kpi) {
    if (type === 'scorecards') return <ScorecardsPage profile={profile} />;
    if (type === 'deliverables') return <DeliverablesPage profile={profile} />;
    return <section role="alert" className="card p-6 text-center text-slate-600">المسار المطلوب غير متاح.</section>;
  }
  return <section role="alert" className="card p-6 text-center text-slate-600">المسار المطلوب غير متاح.</section>;
}

function PageHeading({ title, description }: { title: string; description: string }) {
  return <section><p className="text-sm text-slate-500">{description}</p><h2 className="mt-1 text-2xl font-bold text-brand-900">{title}</h2></section>;
}

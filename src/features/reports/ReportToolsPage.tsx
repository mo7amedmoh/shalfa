import { Bug, ChevronLeft, FileText, Sparkles, Wrench, Droplets } from 'lucide-react';
import { Link } from 'react-router-dom';
import { reportTools } from '../../domain/reportTools';

const icons = [Sparkles, Wrench, Droplets, Bug] as const;

export function ReportToolsPage() {
  return (
    <div className="grid gap-5" dir="rtl">
      <header>
        <p className="text-sm text-slate-500">أدوات إنشاء وتصدير التقارير</p>
        <h2 className="mt-1 text-2xl font-bold text-brand-900">منجز التقارير</h2>
        <p className="mt-2 text-sm text-slate-600">اختر التطبيق، ثم ارفع قالب التقرير والصور لإعداد النسخة المطلوبة.</p>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        {reportTools.map((tool, index) => {
          const Icon = icons[index] ?? FileText;
          return (
            <Link
              key={tool.id}
              to={`/tools/reports/${tool.id}`}
              className="card group flex min-h-36 items-start gap-4 p-5 transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md"
            >
              <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-800">
                <Icon size={22} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2 font-bold text-brand-900">
                  {tool.label}
                  <ChevronLeft size={18} className="shrink-0 text-slate-400 transition group-hover:-translate-x-1" />
                </span>
                <span className="mt-2 block text-sm leading-6 text-slate-600">{tool.description}</span>
              </span>
            </Link>
          );
        })}
      </div>
      <p className="text-xs leading-6 text-slate-500">
        تُعالج القوالب والصور داخل المتصفح لإنشاء الملف، ولا تُرفع إلى قاعدة بيانات المنصة.
      </p>
    </div>
  );
}

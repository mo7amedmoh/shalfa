import type { SchoolRecord } from './schoolTypes';
import { SCHOOL_SIZE_LABELS } from '../../domain/staffing';

function display(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '—';
}

export function SchoolDetails({ school }: { school: SchoolRecord }) {
  return (
    <div className="grid gap-3 text-xs text-slate-700">
      <dl className="grid gap-1">
        {school.source_columns.map(({ header, value }, index) => (
          <div key={`${index}:${header}`}>
            <dt className="inline font-bold">{header}: </dt>
            <dd className="inline">{display(value)}</dd>
          </div>
        ))}
      </dl>
      <dl className="grid gap-1 border-t border-slate-200 pt-2">
        <div><dt className="inline font-bold">ضمن نطاق الخطط: </dt><dd className="inline">{school.plan_scope ? 'نعم' : 'لا'}</dd></div>
        <div><dt className="inline font-bold">الحجم حسب المدرسة: </dt><dd className="inline">{school.size_source ? SCHOOL_SIZE_LABELS[school.size_source] : 'غير محدد'}</dd></div>
        <div><dt className="inline font-bold">الحجم المرجعي من الفصول: </dt><dd className="inline">{school.size_calc ? SCHOOL_SIZE_LABELS[school.size_calc] : 'غير محدد'}</dd></div>
        <div><dt className="inline font-bold">عدد الفصول: </dt><dd className="inline">{display(school.class_count)}</dd></div>
        <div><dt className="inline font-bold">مقاول مصاعد: </dt><dd className="inline">{school.has_elevator_contractor ? 'موجود' : 'غير موجود'}</dd></div>
        {school.missing_from_sheet_at && <div className="font-bold text-amber-800">هذا السجل غير موجود في آخر نسخة من الورقة.</div>}
      </dl>
    </div>
  );
}

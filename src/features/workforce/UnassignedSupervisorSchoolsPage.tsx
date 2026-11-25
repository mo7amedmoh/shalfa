import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '../../lib/supabase';
import { loadCurrentSchoolSupervisors } from '../../lib/schoolSupervisors';

const schoolSchema = z.array(z.object({
  id: z.string().uuid(),
  name: z.string(),
  ministry_no: z.string(),
}));

async function loadSchoolsWithoutSupervisors() {
  if (!supabase) throw new Error('إعداد الاتصال بقاعدة البيانات غير مكتمل.');
  const [schoolsResult, currentSupervisors] = await Promise.all([
    supabase.from('schools').select('id,name,ministry_no').order('name'),
    loadCurrentSchoolSupervisors(),
  ]);
  if (schoolsResult.error) throw schoolsResult.error;
  const assignments = new Map(currentSupervisors.map((assignment) => [assignment.school_id, assignment]));
  return schoolSchema.parse(schoolsResult.data).map((school) => ({
    ...school,
    maintenanceAssigned: Boolean(assignments.get(school.id)?.maintenance_supervisor_id),
    cleaningAssigned: Boolean(assignments.get(school.id)?.cleaning_supervisor_id),
  }));
}

export function UnassignedSupervisorSchoolsPage() {
  const [searchParams] = useSearchParams();
  const service = searchParams.get('service') === 'cleaning' ? 'cleaning' : 'maintenance';
  const schools = useQuery({ queryKey: ['unassigned-supervisor-schools'], queryFn: loadSchoolsWithoutSupervisors });
  const missing = (schools.data ?? []).filter((school) => service === 'cleaning'
    ? !school.cleaningAssigned
    : !school.maintenanceAssigned);
  const title = service === 'cleaning' ? 'مدارس بلا مشرف نظافة' : 'مدارس بلا مشرف صيانة';

  return <section className="card grid gap-4 p-5" dir="rtl">
    <header>
      <Link to="/workforce" className="text-sm font-semibold text-brand-700 underline">العودة إلى القوى العاملة</Link>
      <h2 className="mt-2 text-2xl font-bold text-brand-900">{title}</h2>
    </header>
    {schools.isLoading && <p role="status">جارٍ تحميل المدارس…</p>}
    {schools.error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">تعذر تحميل قائمة المدارس: {schools.error.message}</p>}
    {!schools.isLoading && !schools.error && <p className="text-sm text-slate-600">{missing.length} مدرسة بلا إسناد حالي.</p>}
    {missing.length > 0 && <ul className="grid gap-2 sm:grid-cols-2">
      {missing.map((school) => <li key={school.id} className="rounded-lg border border-slate-200 p-3">
        <strong className="block text-sm text-slate-900">{school.name}</strong>
        <span className="mt-1 block text-xs text-slate-500">الرقم الوزاري: {school.ministry_no}</span>
      </li>)}
    </ul>}
    {!schools.isLoading && !schools.error && !missing.length && <p className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">كل المدارس لديها إسناد حالي لهذه الخدمة.</p>}
  </section>;
}

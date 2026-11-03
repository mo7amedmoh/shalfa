import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { useDisplayFormat } from '../../app/useDisplayFormat';
import { calculateChecklistProgress, checklistStatuses, type ChecklistStatus } from '../../domain/kpi/checklist';
import type { UserProfile } from '../../lib/auth';
import { supabase } from '../../lib/supabase';

const checklistItemSchema = z.object({
  id: z.string().uuid(),
  code: z.enum(['CM', 'OM']),
  number: z.number().int().positive(),
  axis: z.string(),
  item: z.string(),
  reference: z.string(),
  evidence: z.string(),
  frequency: z.string(),
  owner: z.string(),
  status: z.enum(['done', 'in_progress', 'not_started', 'not_applicable']),
  notes: z.string(),
  updated_at: z.string(),
  isRecommendation: z.boolean(),
});
const checklistCatalogSchema = z.array(checklistItemSchema).min(1);
type ChecklistItem = Omit<z.infer<typeof checklistItemSchema>, 'status' | 'updated_at'> & {
  status: ChecklistStatus;
  updatedAt: string | null;
};
type ChecklistDraft = Pick<ChecklistItem, 'owner' | 'status' | 'notes'>;

function currentValue(item: ChecklistItem, drafts: Record<string, ChecklistDraft>): ChecklistDraft {
  return drafts[item.id] ?? {
    owner: item.owner,
    status: item.status,
    notes: item.notes,
  };
}

const statusLabels: Record<ChecklistStatus, string> = {
  مكتمل: 'مكتمل',
  'جارٍ': 'جارٍ',
  'لم يبدأ': 'لم يبدأ',
  'لا ينطبق': 'لا ينطبق',
};

async function loadChecklist(): Promise<ChecklistItem[]> {
  if (!supabase) throw new Error('يلزم تسجيل الدخول للاتصال بقاعدة البيانات.');
  const { data, error } = await supabase.from('checklist_items')
    .select('id,domain,seq,axis,item,contract_ref,evidence,frequency,owner,status,notes,updated_at,is_recommendation')
    .order('domain')
    .order('seq');
  if (error) throw error;
  return checklistCatalogSchema.parse(data.map((row) => ({
    ...row,
    code: row.domain,
    number: row.seq,
    reference: row.contract_ref ?? '',
    evidence: row.evidence ?? '',
    frequency: row.frequency ?? '',
    owner: row.owner ?? '',
    notes: row.notes ?? '',
    isRecommendation: row.is_recommendation,
  }))).map((item) => ({
    ...item,
    status: ({
      done: 'مكتمل',
      in_progress: 'جارٍ',
      not_started: 'لم يبدأ',
      not_applicable: 'لا ينطبق',
    } as const)[item.status],
    updatedAt: item.updated_at,
  }));
}

export function ChecklistPage({ profile }: { profile: UserProfile | null }) {
  const client = useQueryClient();
  const { formatDateTime, formatNumber } = useDisplayFormat();
  const [searchText, setSearchText] = useState('');
  const [selectedAxis, setSelectedAxis] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState<'all' | ChecklistStatus>('all');
  const [sortBy, setSortBy] = useState<'source' | 'axis' | 'status'>('source');
  const [page, setPage] = useState(1);
  const [drafts, setDrafts] = useState<Record<string, ChecklistDraft>>({});
  const checklist = useQuery({ queryKey: ['kpi-checklist'], queryFn: loadChecklist });
  const items = useMemo(() => checklist.data ?? [], [checklist.data]);
  const canEdit = Boolean(profile && ['admin', 'project_manager'].includes(profile.role));
  const editable = Boolean(supabase && canEdit);
  const axes = useMemo(() => [...new Set(items.map((item) => item.axis))], [items]);
  const filteredItems = useMemo(() => {
    const search = searchText.trim().toLocaleLowerCase();
    const filtered = items.filter((item) => {
      const current = currentValue(item, drafts);
      const matchesSearch = !search || [
        item.id, item.axis, item.item, item.reference, item.evidence, item.frequency, current.owner, current.notes,
      ].some((value) => value.toLocaleLowerCase().includes(search));
      return matchesSearch
        && (selectedAxis === 'all' || item.axis === selectedAxis)
        && (selectedStatus === 'all' || current.status === selectedStatus);
    });
    if (sortBy === 'axis') return filtered.sort((left, right) => left.axis.localeCompare(right.axis, 'ar') || left.number - right.number);
    if (sortBy === 'status') return filtered.sort((left, right) => currentValue(left, drafts).status.localeCompare(currentValue(right, drafts).status, 'ar'));
    return filtered;
  }, [items, drafts, searchText, selectedAxis, selectedStatus, sortBy]);
  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const pageItems = filteredItems.slice((page - 1) * pageSize, page * pageSize);
  const currentItems = useMemo(() => items.map((item) => ({ ...item, ...currentValue(item, drafts) })), [items, drafts]);
  const progressByCode = useMemo(() => ({
    CM: calculateChecklistProgress(currentItems.filter((item) => item.code === 'CM').map((item) => item.status)),
    OM: calculateChecklistProgress(currentItems.filter((item) => item.code === 'OM').map((item) => item.status)),
  }), [currentItems]);
  const axisProgress = useMemo(() => axes.map((axis) => ({
    axis,
    ...calculateChecklistProgress(currentItems.filter((item) => item.axis === axis).map((item) => item.status)),
  })), [axes, currentItems]);

  const save = useMutation({
    mutationFn: async ({ id, draft }: { id: string; draft: ChecklistDraft }) => {
      if (!supabase || !profile || !canEdit) throw new Error('لا تملك صلاحية تعديل قائمة الفحص.');
      const { error } = await supabase.from('checklist_items').update({
        ...draft,
        status: ({
          مكتمل: 'done',
          'جارٍ': 'in_progress',
          'لم يبدأ': 'not_started',
          'لا ينطبق': 'not_applicable',
        } as const)[draft.status],
      }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: async (_data, variables) => {
      setDrafts((current) => {
        const next = { ...current };
        delete next[variables.id];
        return next;
      });
      await client.invalidateQueries({ queryKey: ['kpi-checklist'] });
    },
  });

  function updateDraft(item: ChecklistItem, patch: Partial<ChecklistDraft>) {
    setDrafts((current) => ({
      ...current,
      [item.id]: { ...currentValue(item, current), ...patch },
    }));
  }

  return (
    <div className="grid gap-5">
      <section>
        <p className="text-sm text-slate-500">بنود قائمة الفحص الرسمية من مصنف CM/OM</p>
        <h2 className="mt-1 text-2xl font-bold text-brand-900">قائمة الفحص CM/OM</h2>
      </section>

      {checklist.isLoading && <p role="status" className="card p-5 text-center">جارٍ تحميل بنود قائمة الفحص…</p>}
      {checklist.error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">تعذر تحميل قائمة الفحص: {checklist.error.message}</p>}
      {!editable && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">عرض وتعديل بيانات KPI متاحان لمدير النظام ومدير المشروع فقط.</p>}
      {save.error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">تعذر حفظ البند: {save.error.message}</p>}

      <section className="grid gap-3 sm:grid-cols-2" aria-label="ملخص إنجاز قائمة الفحص">
        {(['CM', 'OM'] as const).map((code) => {
          const progress = progressByCode[code];
          return (
            <article key={code} className="card p-4">
              <p className="font-bold text-brand-900">{code === 'CM' ? 'إدارة العقد CM' : 'إدارة العمليات OM'}</p>
              <p className="mt-2 text-2xl font-bold">{progress.percentage === null ? '—' : `${progress.percentage.toFixed(1)}%`}</p>
              <p className="mt-1 text-xs text-slate-500">
                مكتمل {formatNumber(progress.completed)} من {formatNumber(progress.total - progress.notApplicable)}
                {' · '}لا ينطبق {formatNumber(progress.notApplicable)}
              </p>
            </article>
          );
        })}
      </section>

      <section className="card grid gap-3 p-4">
        <h3 className="font-bold text-brand-900">الإنجاز حسب المحور</h3>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {axisProgress.map((progress) => (
            <div key={progress.axis} className="rounded-lg bg-slate-50 p-3 text-sm">
              <p className="font-semibold">{progress.axis}</p>
              <p className="mt-1 text-slate-600">
                {progress.percentage === null ? '—' : `${progress.percentage.toFixed(1)}%`}
                {' · '}{formatNumber(progress.completed)}/{formatNumber(progress.total - progress.notApplicable)} مكتمل
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="card grid gap-3 p-4">
        <h3 className="font-bold text-brand-900">البحث والتصفية</h3>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="grid gap-1 text-sm font-semibold">بحث
            <input value={searchText} onChange={(event) => { setSearchText(event.target.value); setPage(1); }} className="rounded-lg border border-slate-300 px-3 py-2 font-normal" placeholder="البند أو المرجع أو المسؤول" />
          </label>
          <label className="grid gap-1 text-sm font-semibold">المحور
            <select value={selectedAxis} onChange={(event) => { setSelectedAxis(event.target.value); setPage(1); }} className="rounded-lg border border-slate-300 px-3 py-2 font-normal">
              <option value="all">كل المحاور</option>
              {axes.map((axis) => <option key={axis} value={axis}>{axis}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-semibold">الحالة
            <select value={selectedStatus} onChange={(event) => { setSelectedStatus(event.target.value as 'all' | ChecklistStatus); setPage(1); }} className="rounded-lg border border-slate-300 px-3 py-2 font-normal">
              <option value="all">كل الحالات</option>
              {checklistStatuses.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-semibold">ترتيب حسب
            <select value={sortBy} onChange={(event) => { setSortBy(event.target.value as 'source' | 'axis' | 'status'); setPage(1); }} className="rounded-lg border border-slate-300 px-3 py-2 font-normal">
              <option value="source">ترتيب المصنف</option>
              <option value="axis">المحور</option>
              <option value="status">الحالة</option>
            </select>
          </label>
        </div>
      </section>

      {checklist.data && (
        <section className="grid gap-3" aria-label="بنود قائمة الفحص">
          {pageItems.map((item) => {
            const value = currentValue(item, drafts);
            const dirty = Boolean(drafts[item.id]);
            return (
              <article key={item.id} className="card grid gap-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-brand-700">{item.id} · {item.axis}</p>
                    <h3 className="mt-1 font-bold leading-7">{item.item}</h3>
                  </div>
                  {item.isRecommendation && <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">توصية</span>}
                </div>
                <div className="grid gap-2 text-sm text-slate-600 sm:grid-cols-3">
                  <p><b>المرجع:</b> {item.reference || '—'}</p>
                  <p><b>الدليل / المستند:</b> {item.evidence || '—'}</p>
                  <p><b>التكرار:</b> {item.frequency || '—'}</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 text-sm font-semibold">المسؤول
                    <input value={value.owner} disabled={!editable || save.isPending} maxLength={120} onChange={(event) => updateDraft(item, { owner: event.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 font-normal disabled:bg-slate-50" />
                  </label>
                  <label className="grid gap-1 text-sm font-semibold">الحالة
                    <select value={value.status} disabled={!editable || save.isPending} onChange={(event) => updateDraft(item, { status: event.target.value as ChecklistStatus })} className="rounded-lg border border-slate-300 px-3 py-2 font-normal disabled:bg-slate-50">
                      {checklistStatuses.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm font-semibold sm:col-span-2">ملاحظات
                    <textarea value={value.notes} disabled={!editable || save.isPending} maxLength={2000} rows={2} onChange={(event) => updateDraft(item, { notes: event.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 font-normal disabled:bg-slate-50" />
                  </label>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-slate-500">{item.updatedAt ? `آخر تحديث: ${formatDateTime(item.updatedAt)}` : 'لم يُحفظ تحديث بعد'}</p>
                  <button type="button" disabled={!editable || !dirty || save.isPending} onClick={() => save.mutate({ id: item.id, draft: value })} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
                    {save.isPending && save.variables?.id === item.id ? 'جارٍ الحفظ…' : 'حفظ البند'}
                  </button>
                </div>
              </article>
            );
          })}
          {!filteredItems.length && <p className="card p-6 text-center text-slate-500">لا توجد بنود تطابق البحث والتصفية.</p>}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-500">عرض {formatNumber(filteredItems.length ? (page - 1) * pageSize + 1 : 0)}–{formatNumber(Math.min(page * pageSize, filteredItems.length))} من {formatNumber(filteredItems.length)} بند</p>
            <div className="flex gap-2">
              <button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-50">السابق</button>
              <span className="px-2 py-2 text-sm" aria-live="polite">صفحة {formatNumber(page)} من {formatNumber(pageCount)}</span>
              <button type="button" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-50">التالي</button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

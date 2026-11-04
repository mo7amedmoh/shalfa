import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, ExternalLink, Paperclip, Upload, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import { z } from 'zod';
import { isDeliverableLate, resolveDeliverableDueDate, summarizeDeliverables, type DeliverableDueDates, type DeliverableStatus } from '../../domain/deliverables';
import type { UserProfile } from '../../lib/auth';
import { APP_SCHEMA_SELECT } from '../../lib/schemaColumns';
import { supabase } from '../../lib/supabase';
import { useDisplayFormat } from '../../app/useDisplayFormat';

const deliverableSchema = z.object({
  id: z.string().uuid(),
  seq: z.number().int(),
  clause: z.string().nullable(),
  title: z.string(),
  due_basis: z.string().nullable(),
  duration_days: z.number().int().nullable(),
  duration_text: z.string().nullable(),
  review_cycle: z.string().nullable(),
  due_date: z.string().nullable(),
  status: z.enum(['not_delivered', 'delivered_pending', 'approved']),
  delivered_on: z.string().nullable(),
  approved_on: z.string().nullable(),
  notes: z.string().nullable(),
});
const attachmentSchema = z.object({
  id: z.string().uuid(),
  entity_id: z.string().uuid(),
  storage_path: z.string(),
  file_name: z.string(),
  mime_type: z.string(),
  size_bytes: z.number().int(),
  uploaded_by: z.string().uuid().nullable(),
  created_at: z.string(),
});
const settingsSchema = z.object({
  contract_signing_date: z.string(),
  site_handover_date: z.string(),
  award_letter_date: z.string().nullable(),
});

type Deliverable = z.infer<typeof deliverableSchema>;
type EvidenceAttachment = z.infer<typeof attachmentSchema>;
type DeliverablesData = {
  items: Deliverable[];
  dates: DeliverableDueDates;
  attachments: EvidenceAttachment[];
};
type Filters = { status: DeliverableStatus | 'all'; lateness: 'all' | 'late' | 'on-time' };
type EditorState = {
  item: Deliverable;
  status: DeliverableStatus;
  dueDateOverride: string;
  deliveredOn: string;
  approvedOn: string;
  notes: string;
};
const EMPTY_DELIVERABLES: Deliverable[] = [];
const EMPTY_DUE_DATES: DeliverableDueDates = {
  contractSigningDate: null,
  siteHandoverDate: null,
  awardLetterDate: null,
};

const allowedMimeTypes = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;
const maximumFileBytes = 10 * 1024 * 1024;
const statusNames: Record<DeliverableStatus, string> = {
  not_delivered: 'لم يُسلَّم',
  delivered_pending: 'مُسلَّم بانتظار الاعتماد',
  approved: 'معتمد',
};

function today(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function loadDeliverables(): Promise<DeliverablesData> {
  if (!supabase) throw new Error('إعداد الاتصال بقاعدة البيانات غير مكتمل.');
  const [deliverablesResult, settingsResult] = await Promise.all([
    supabase.from('deliverables').select(APP_SCHEMA_SELECT.deliverables).order('seq'),
    supabase.from('app_settings').select(APP_SCHEMA_SELECT.appSettingsDeliverables).eq('id', 1).single(),
  ]);
  if (deliverablesResult.error) throw deliverablesResult.error;
  if (settingsResult.error) throw settingsResult.error;
  const items = z.array(deliverableSchema).parse(deliverablesResult.data);
  const settings = settingsSchema.parse(settingsResult.data);
  const attachmentsResult = items.length
    ? await supabase.from('attachments')
      .select(APP_SCHEMA_SELECT.deliverableAttachments)
      .eq('entity', 'deliverable')
      .in('entity_id', items.map(({ id }) => id))
      .order('created_at', { ascending: false })
    : { data: [], error: null };
  if (attachmentsResult.error) throw attachmentsResult.error;
  return {
    items,
    dates: {
      contractSigningDate: settings.contract_signing_date,
      siteHandoverDate: settings.site_handover_date,
      awardLetterDate: settings.award_letter_date,
    },
    attachments: z.array(attachmentSchema).parse(attachmentsResult.data),
  };
}

function attachmentSize(bytes: number, formatNumber: (value: string | number) => string): string {
  return `${formatNumber((bytes / 1024 / 1024).toFixed(2))} MB`;
}

function toDueRecord(item: Deliverable): {
  dueBasis: string | null;
  durationDays: number | null;
  durationText: string | null;
  dueDateOverride: string | null;
  status: DeliverableStatus;
} {
  return {
    dueBasis: item.due_basis,
    durationDays: item.duration_days,
    durationText: item.duration_text,
    dueDateOverride: item.due_date,
    status: item.status,
  };
}

export function DeliverablesPage({ profile }: { profile: UserProfile | null }) {
  const queryClient = useQueryClient();
  const { formatNumber, formatDate } = useDisplayFormat();
  const [filters, setFilters] = useState<Filters>({ status: 'all', lateness: 'all' });
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [message, setMessage] = useState('');
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const canEdit = Boolean(profile && ['admin', 'project_manager'].includes(profile.role));
  const query = useQuery({ queryKey: ['contractual-deliverables'], queryFn: loadDeliverables });
  const items = query.data?.items ?? EMPTY_DELIVERABLES;
  const dates = query.data?.dates ?? EMPTY_DUE_DATES;
  const attachmentsByDeliverable = useMemo(() => {
    const groups = new Map<string, EvidenceAttachment[]>();
    for (const attachment of query.data?.attachments ?? []) {
      const current = groups.get(attachment.entity_id) ?? [];
      current.push(attachment);
      groups.set(attachment.entity_id, current);
    }
    return groups;
  }, [query.data?.attachments]);
  const asOf = today();
  const summary = useMemo(() => summarizeDeliverables(items.map(toDueRecord), dates, asOf), [items, dates, asOf]);
  const visibleItems = useMemo(() => items.filter((item) => {
    if (filters.status !== 'all' && item.status !== filters.status) return false;
    const late = isDeliverableLate(toDueRecord(item), dates, asOf);
    return filters.lateness === 'all' || (filters.lateness === 'late' ? late : !late);
  }), [items, dates, asOf, filters]);

  const save = useMutation({
    mutationFn: async (draft: EditorState) => {
      if (!supabase || !canEdit) throw new Error('تعديل المخرجات متاح لمدير النظام ومدير المشروع فقط.');
      const { error } = await supabase.from('deliverables').update({
        status: draft.status,
        due_date: draft.dueDateOverride || null,
        delivered_on: draft.deliveredOn || null,
        approved_on: draft.approvedOn || null,
        notes: draft.notes.trim() || null,
      }).eq('id', draft.item.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      setMessage('تم حفظ بيانات المخرج.');
      setEditor(null);
      await queryClient.invalidateQueries({ queryKey: ['contractual-deliverables'] });
    },
    onError: (error: Error) => setMessage(`تعذر الحفظ: ${error.message}`),
  });

  const upload = useMutation({
    mutationFn: async ({ itemId, file }: { itemId: string; file: File }) => {
      if (!supabase || !canEdit) throw new Error('رفع المرفقات متاح لمدير النظام ومدير المشروع فقط.');
      if (file.size < 1 || file.size > maximumFileBytes) throw new Error('يجب ألا يتجاوز حجم الملف 10 MB.');
      if (!allowedMimeTypes.includes(file.type as (typeof allowedMimeTypes)[number])) {
        throw new Error('نوع الملف غير مسموح به. الصيغ المدعومة PDF وJPG وPNG وWebP وExcel وWord.');
      }
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!userData.user) throw new Error('يلزم تسجيل الدخول لرفع المرفقات.');
      const path = `${userData.user.id}/deliverable/${itemId}/${crypto.randomUUID()}`;
      const { error: storageError } = await supabase.storage.from('evidence').upload(path, file, {
        contentType: file.type,
        upsert: false,
      });
      if (storageError) throw storageError;
      const { error: metadataError } = await supabase.from('attachments').insert({
        entity: 'deliverable',
        entity_id: itemId,
        storage_path: path,
        file_name: file.name,
        mime_type: file.type,
        size_bytes: file.size,
        uploaded_by: userData.user.id,
      });
      if (metadataError) {
        const { error: cleanupError } = await supabase.storage.from('evidence').remove([path]);
        if (cleanupError) {
          throw new Error(`تعذر حفظ بيانات المرفق: ${metadataError.message}. كما تعذر حذف الملف المرفوع: ${cleanupError.message}`);
        }
        throw metadataError;
      }
    },
    onSuccess: async () => {
      setMessage('تم رفع المرفق.');
      await queryClient.invalidateQueries({ queryKey: ['contractual-deliverables'] });
    },
    onError: (error: Error) => setMessage(`تعذر رفع المرفق: ${error.message}`),
  });

  async function prepareAttachmentLink(attachment: EvidenceAttachment) {
    if (!supabase) return;
    const { data, error } = await supabase.storage.from('evidence').createSignedUrl(attachment.storage_path, 300);
    if (error) {
      setMessage(`تعذر فتح المرفق: ${error.message}`);
      return;
    }
    setSignedUrls((current) => ({ ...current, [attachment.id]: data.signedUrl }));
    setMessage(`تم إنشاء رابط مؤقت لملف ${attachment.file_name}.`);
  }

  function exportExcel() {
    const workbook = XLSX.utils.book_new();
    const rows = visibleItems.map((item) => {
      const due = resolveDeliverableDueDate(toDueRecord(item), dates);
      return {
        'البند': item.seq,
        'الفقرة': item.clause ?? '',
        'عنوان المخرج': item.title,
        'أساس الاستحقاق': item.due_basis ?? '',
        'المدة': item.duration_days ?? item.duration_text ?? '',
        'دورية المراجعة': item.review_cycle ?? '',
        'تاريخ الاستحقاق': due.dueDate ?? '',
        'طريقة الحساب': due.hint,
        'الحالة': statusNames[item.status],
        'تاريخ التسليم': item.delivered_on ?? '',
        'تاريخ الاعتماد': item.approved_on ?? '',
        'متأخر': isDeliverableLate({
          dueBasis: item.due_basis,
          durationDays: item.duration_days,
          dueDateOverride: item.due_date,
          status: item.status,
        }, dates, asOf) ? 'نعم' : 'لا',
        'ملاحظات': item.notes ?? '',
        'عدد المرفقات': attachmentsByDeliverable.get(item.id)?.length ?? 0,
      };
    });
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'المخرجات التعاقدية');
    XLSX.writeFile(workbook, 'المخرجات-التعاقدية.xlsx');
  }

  function openEditor(item: Deliverable) {
    setMessage('');
    setEditor({
      item,
      status: item.status,
      dueDateOverride: item.due_date ?? '',
      deliveredOn: item.delivered_on ?? '',
      approvedOn: item.approved_on ?? '',
      notes: item.notes ?? '',
    });
  }

  const currentDue = editor ? resolveDeliverableDueDate({
    dueBasis: editor.item.due_basis,
    durationDays: editor.item.duration_days,
    dueDateOverride: editor.dueDateOverride || null,
    status: editor.status,
  }, dates) : null;

  return (
    <div className="grid gap-5">
      <section className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div><p className="text-sm text-slate-500">متابعة التسليم والاعتماد والمواعيد التعاقدية</p><h2 className="mt-1 text-2xl font-bold text-brand-900">المخرجات التعاقدية</h2></div>
        <button type="button" onClick={exportExcel} disabled={!visibleItems.length} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold disabled:opacity-50"><Download size={16} /> تصدير Excel</button>
      </section>

      {query.error && <p role="alert" className="rounded-lg bg-rose-50 p-4 text-sm text-rose-800">تعذر تحميل المخرجات: {query.error.message}</p>}
      {query.isLoading && <p role="status" className="card p-5 text-center">جارٍ تحميل المخرجات التعاقدية…</p>}
      {!canEdit && <p role="status" className="rounded-lg bg-sky-50 p-3 text-sm text-sky-900">وضع القراءة فقط؛ يمكن لمدير النظام ومدير المشروع تعديل البيانات.</p>}

      {query.data && <>
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="ملخص المخرجات">
          <SummaryCard label="إجمالي المخرجات" value={summary.total} formatNumber={formatNumber} />
          <SummaryCard label="تم التسليم" value={summary.delivered} formatNumber={formatNumber} />
          <SummaryCard label="معتمد" value={summary.approved} formatNumber={formatNumber} />
          <SummaryCard label="متأخر" value={summary.late} formatNumber={formatNumber} warning={summary.late > 0} />
        </section>
        <section className="card grid gap-2 p-4">
          <div className="flex justify-between gap-3 text-sm"><span>نسبة التسليم</span><strong>{formatNumber(summary.progressPercent.toFixed(1))}% · {formatNumber(summary.delivered)} من {formatNumber(summary.total)}</strong></div>
          <div className="h-3 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label="نسبة تسليم المخرجات" aria-valuemin={0} aria-valuemax={100} aria-valuenow={summary.progressPercent}>
            <div className="h-full rounded-full bg-brand-700 transition-all" style={{ width: `${summary.progressPercent}%` }} />
          </div>
        </section>
        {!items.length && <p className="card p-5 text-center text-sm text-slate-600">لا توجد مخرجات محملة. نفّذ <code>npm run seed:deliverables</code> في بيئة موثوقة بعد تهيئة متغيرات الخدمة.</p>}
      </>}

      {query.data && items.length > 0 && <>
        <section className="card grid gap-3 p-4 sm:grid-cols-2" aria-label="تصفية المخرجات">
          <label className="grid gap-1 text-sm font-semibold">الحالة
            <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value as Filters['status'] }))} className="rounded-lg border border-slate-300 px-3 py-2">
              <option value="all">جميع الحالات</option>
              <option value="not_delivered">{statusNames.not_delivered}</option>
              <option value="delivered_pending">{statusNames.delivered_pending}</option>
              <option value="approved">{statusNames.approved}</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm font-semibold">التأخير
            <select value={filters.lateness} onChange={(event) => setFilters((current) => ({ ...current, lateness: event.target.value as Filters['lateness'] }))} className="rounded-lg border border-slate-300 px-3 py-2">
              <option value="all">الكل</option><option value="late">متأخر فقط</option><option value="on-time">غير متأخر</option>
            </select>
          </label>
        </section>

        <section className="card grid gap-3 p-4">
          <div className="flex flex-wrap justify-between gap-2"><h3 className="font-bold">سجل المخرجات ({formatNumber(visibleItems.length)})</h3><span className="text-xs text-slate-500">تاريخ احتساب التأخير: {formatDate(asOf)}</span></div>
          <div className="table-scroll">
            <table className="min-w-[1550px]">
              <thead><tr>
                <th scope="col">#</th><th scope="col">الفقرة</th><th scope="col">عنوان المخرج</th><th scope="col">أساس الاستحقاق</th><th scope="col">المدة</th>
                <th scope="col">دورية المراجعة</th><th scope="col">تاريخ الاستحقاق</th><th scope="col">الحالة</th><th scope="col">تاريخ التسليم</th>
                <th scope="col">تاريخ الاعتماد</th><th scope="col">ملاحظات</th><th scope="col">المرفقات</th><th scope="col">إجراء</th>
              </tr></thead>
              <tbody>{visibleItems.map((item) => {
                const due = resolveDeliverableDueDate(toDueRecord(item), dates);
                const late = isDeliverableLate(toDueRecord(item), dates, asOf);
                const attachments = attachmentsByDeliverable.get(item.id) ?? [];
                return <tr key={item.id} className={late ? 'bg-rose-50' : undefined}>
                  <td>{formatNumber(item.seq)}</td><td>{item.clause ?? '—'}</td>
                  <th scope="row" className="text-start font-semibold text-slate-800">{item.title}</th>
                  <td>{item.due_basis ?? '—'}</td><td>{item.duration_days === null ? item.duration_text ?? '—' : `${formatNumber(item.duration_days)} يوم`}</td>
                  <td>{item.review_cycle ?? '—'}</td>
                  <td title={due.hint} className={late ? 'font-bold text-rose-700' : ''}>
                    {due.dueDate ? formatDate(due.dueDate) : 'غير محسوب'}
                    {due.isOverride && <span className="ms-1 text-xs">(يدوي)</span>}
                    {late && <span className="ms-1 rounded bg-rose-100 px-1 text-xs">متأخر</span>}
                    <p className="max-w-48 whitespace-normal text-[10px] font-normal text-slate-500">{due.hint}</p>
                  </td>
                  <td><span className={`rounded-full px-2 py-1 text-xs font-semibold ${item.status === 'approved' ? 'bg-emerald-100 text-emerald-800' : item.status === 'delivered_pending' ? 'bg-sky-100 text-sky-800' : 'bg-slate-100 text-slate-700'}`}>{statusNames[item.status]}</span></td>
                  <td>{item.delivered_on ? formatDate(item.delivered_on) : '—'}</td><td>{item.approved_on ? formatDate(item.approved_on) : '—'}</td>
                  <td className="max-w-56 whitespace-normal">{item.notes || '—'}</td>
                  <td><button type="button" onClick={() => openEditor(item)} className="inline-flex items-center gap-1 underline"><Paperclip size={14} /> {formatNumber(attachments.length)}</button></td>
                  <td><button type="button" onClick={() => openEditor(item)} className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold">{canEdit ? 'تعديل' : 'عرض'}</button></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        </section>
      </>}

      {message && <p role="status" className="rounded-lg bg-slate-100 p-3 text-sm text-slate-700">{message}</p>}

      {editor && <div className="fixed inset-0 z-[1000] overflow-y-auto bg-slate-950/50 p-3 sm:p-8" role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget && !save.isPending && !upload.isPending) setEditor(null);
      }}>
        <section role="dialog" aria-modal="true" aria-labelledby="deliverable-dialog-title" className="mx-auto grid max-w-3xl gap-4 rounded-2xl bg-white p-5 shadow-2xl">
          <header className="flex items-start justify-between gap-3">
            <div><h3 id="deliverable-dialog-title" className="text-lg font-bold">{editor.item.seq}. {editor.item.title}</h3><p className="mt-1 text-sm text-slate-500">الفقرة {editor.item.clause ?? '—'} · أساس الاستحقاق: {editor.item.due_basis ?? '—'}</p></div>
            <button type="button" onClick={() => setEditor(null)} aria-label="إغلاق" className="rounded-lg p-2 hover:bg-slate-100"><X size={20} /></button>
          </header>
          <div className="grid gap-3 sm:grid-cols-2">
            <p className="rounded-lg bg-slate-50 p-3 text-sm"><b>المدة:</b> {editor.item.duration_days === null ? editor.item.duration_text ?? 'غير محددة' : `${formatNumber(editor.item.duration_days)} يوم`} · <b>دورية المراجعة:</b> {editor.item.review_cycle ?? '—'}</p>
            <div className="rounded-lg bg-slate-50 p-3 text-sm"><b>الموعد الحالي:</b> {currentDue?.dueDate ? formatDate(currentDue.dueDate) : 'غير محسوب'}<p className="mt-1 text-xs text-slate-600">{currentDue?.hint}</p></div>
          </div>
          <label className="grid gap-1 text-sm font-semibold">موعد الاستحقاق اليدوي
            <input type="date" disabled={!canEdit} value={editor.dueDateOverride} onChange={(event) => setEditor({ ...editor, dueDateOverride: event.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 disabled:bg-slate-100" />
          </label>
          {canEdit && editor.dueDateOverride && <button type="button" onClick={() => setEditor({ ...editor, dueDateOverride: '' })} className="w-fit text-xs text-brand-700 underline">مسح الموعد اليدوي والعودة إلى الحساب التلقائي</button>}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-semibold">الحالة
              <select disabled={!canEdit} value={editor.status} onChange={(event) => setEditor({ ...editor, status: event.target.value as DeliverableStatus })} className="rounded-lg border border-slate-300 px-3 py-2 disabled:bg-slate-100">
                <option value="not_delivered">{statusNames.not_delivered}</option>
                <option value="delivered_pending">{statusNames.delivered_pending}</option>
                <option value="approved">{statusNames.approved}</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold">تاريخ التسليم<input type="date" disabled={!canEdit} value={editor.deliveredOn} onChange={(event) => setEditor({ ...editor, deliveredOn: event.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 disabled:bg-slate-100" /></label>
            <label className="grid gap-1 text-sm font-semibold">تاريخ الاعتماد<input type="date" disabled={!canEdit} value={editor.approvedOn} onChange={(event) => setEditor({ ...editor, approvedOn: event.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 disabled:bg-slate-100" /></label>
          </div>
          <label className="grid gap-1 text-sm font-semibold">ملاحظات<textarea disabled={!canEdit} value={editor.notes} onChange={(event) => setEditor({ ...editor, notes: event.target.value })} rows={3} maxLength={4000} className="rounded-lg border border-slate-300 px-3 py-2 disabled:bg-slate-100" /></label>

          <section className="grid gap-2 border-t border-slate-200 pt-4">
            <div className="flex items-baseline justify-between gap-2"><h4 className="font-bold">المرفقات والدليل</h4><span className="text-xs text-slate-500">حد أقصى 10 MB · PDF، JPG، PNG، WebP، Excel، Word</span></div>
            {(attachmentsByDeliverable.get(editor.item.id) ?? []).length ? <ul className="grid gap-2">
              {(attachmentsByDeliverable.get(editor.item.id) ?? []).map((attachment) => <li key={attachment.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <span>{attachment.file_name} <span className="text-xs text-slate-500">({attachmentSize(attachment.size_bytes, formatNumber)})</span></span>
                {signedUrls[attachment.id]
                  ? <a href={signedUrls[attachment.id]} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-700 underline"><ExternalLink size={14} /> فتح الملف</a>
                  : <button type="button" onClick={() => void prepareAttachmentLink(attachment)} className="inline-flex items-center gap-1 text-brand-700 underline"><ExternalLink size={14} /> إنشاء رابط مؤقت</button>}
              </li>)}
            </ul> : <p className="text-sm text-slate-500">لا توجد مرفقات.</p>}
            {canEdit && <label className={`inline-flex w-fit cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold ${upload.isPending ? 'opacity-50' : ''}`}>
              <Upload size={15} />{upload.isPending ? 'جارٍ رفع الملف…' : 'رفع مرفق'}
              <input type="file" disabled={upload.isPending} accept={allowedMimeTypes.join(',')} className="sr-only" onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) upload.mutate({ itemId: editor.item.id, file });
                event.target.value = '';
              }} />
            </label>}
          </section>
          {message && <p role="status" className="rounded-lg bg-slate-100 p-3 text-sm text-slate-700">{message}</p>}
          <footer className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
            <button type="button" onClick={() => setEditor(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold">إغلاق</button>
            {canEdit && <button type="button" disabled={save.isPending || upload.isPending} onClick={() => save.mutate(editor)} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{save.isPending ? 'جارٍ الحفظ…' : 'حفظ التعديلات'}</button>}
          </footer>
        </section>
      </div>}
    </div>
  );
}

function SummaryCard({ label, value, formatNumber, warning = false }: { label: string; value: number; formatNumber: (value: string | number) => string; warning?: boolean }) {
  return <article className={`card p-4 ${warning ? 'border-rose-200 bg-rose-50' : ''}`}><p className="text-sm text-slate-500">{label}</p><p className={`mt-1 text-2xl font-bold ${warning ? 'text-rose-800' : 'text-brand-900'}`}>{formatNumber(value)}</p></article>;
}

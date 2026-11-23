import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, FileDown, FileSignature, PackageCheck, Stamp, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { usePermission } from '../../app/permissionContext';
import { useDisplayFormat } from '../../app/useDisplayFormat';
import { supabase } from '../../lib/supabase';
import {
  canTransitionInventoryRequest,
  getInventoryIssueOutcome,
  inventoryWorkflowQueryKeys,
  inventoryRequestStatusLabels,
  validateApprovalQuantities,
  validateIssueQuantities,
  type InventoryRequestStatus,
} from './inventoryRequestsModel';

const numericSchema = z.union([z.number(), z.string()]).transform(Number);
const nullableNumericSchema = numericSchema.nullable();
const requestLineSchema = z.object({
  item_id: z.string().uuid(),
  qty_requested: numericSchema,
  qty_approved: numericSchema,
  qty_issued: numericSchema,
  note: z.string().nullable(),
});
const requestSchema = z.object({
  id: z.string().uuid(),
  number: z.string(),
  school_id: z.string().uuid(),
  status: z.enum(['submitted', 'approved', 'partially_issued', 'issued']),
  submitted_at: z.string().nullable(),
  approver_stamp_path: z.string().nullable(),
  notes: z.string().nullable(),
  rejected_reason: z.string().nullable(),
  receiver_name: z.string().nullable(),
  items: z.array(requestLineSchema).nullish().transform((items) => items ?? []),
});
const balanceSchema = z.object({
  item_id: z.string().uuid(),
  name: z.string(),
  unit: z.string(),
  available: nullableNumericSchema,
  balance: nullableNumericSchema,
  reserved: numericSchema,
});
const schoolSchema = z.object({ id: z.string().uuid(), name: z.string() });
const stampRowSchema = z.object({ storage_path: z.string() });

type RequestLine = z.infer<typeof requestLineSchema>;
type InventoryBalance = z.infer<typeof balanceSchema>;
type WorkflowRequest = Omit<z.infer<typeof requestSchema>, 'items'> & {
  schoolName: string;
  approverStampUrl: string | null;
  items: Array<RequestLine & { inventoryItem: InventoryBalance }>;
};
type CurrentStamp = { storagePath: string; signedUrl: string };
type WorkflowMode = 'review' | 'issue';
type ApprovalDraftLine = { itemId: string; requested: number; approved: string; removed: boolean };
type IssueDraftLine = {
  itemId: string;
  approved: number;
  alreadyIssued: number;
  remaining: number;
  issuing: string;
};
type Notice = { tone: 'success' | 'error'; text: string };

const statusStyles: Record<InventoryRequestStatus, string> = {
  draft: 'bg-slate-100 text-slate-700',
  submitted: 'bg-blue-50 text-blue-800',
  approved: 'bg-emerald-50 text-emerald-800',
  rejected: 'bg-rose-50 text-rose-800',
  issued: 'bg-violet-50 text-violet-800',
  partially_issued: 'bg-amber-50 text-amber-800',
  cancelled: 'bg-slate-100 text-slate-500',
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'حدث خطأ غير متوقع.';
}

async function loadWorkflowRequests(mode: WorkflowMode): Promise<WorkflowRequest[]> {
  if (!supabase) throw new Error('إعداد الاتصال بقاعدة البيانات غير مكتمل.');
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) throw new Error('انتهت جلسة الدخول. أعد تسجيل الدخول.');

  const requestRows: unknown[] = [];
  for (let start = 0; ; start += 1000) {
    const requestQuery = supabase.from('stock_requests')
      .select('id,number,school_id,status,submitted_at,approver_stamp_path,notes,rejected_reason,receiver_name,items:stock_request_items(item_id,qty_requested,qty_approved,qty_issued,note)')
      .order('submitted_at', { ascending: false });
    const filteredQuery = mode === 'review'
      ? requestQuery.eq('engineer_id', userData.user.id).eq('status', 'submitted')
      : requestQuery.in('status', ['approved', 'partially_issued', 'issued']);
    const { data, error } = await filteredQuery.range(start, start + 999);
    if (error) throw error;
    requestRows.push(...data);
    if (data.length < 1000) break;
  }
  const requests = z.array(requestSchema).parse(requestRows);
  if (!requests.length) return [];

  const itemIds = [...new Set(requests.flatMap((request) => request.items.map((item) => item.item_id)))];
  const schoolIds = [...new Set(requests.map((request) => request.school_id))];
  const stampPaths = [...new Set(requests.flatMap((request) => request.approver_stamp_path ? [request.approver_stamp_path] : []))];
  const [{ data: balancesData, error: balancesError }, { data: schoolsData, error: schoolsError }, stampResults] = await Promise.all([
    supabase.from('inventory_balances')
      .select('item_id,name,unit,available,balance,reserved')
      .in('item_id', itemIds),
    supabase.from('schools')
      .select('id,school_name:name')
      .in('id', schoolIds),
    stampPaths.length
      ? supabase.storage.from('inventory-private').createSignedUrls(stampPaths, 600)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (balancesError) throw balancesError;
  if (schoolsError) throw schoolsError;
  if (stampResults.error) throw stampResults.error;
  const balances = z.array(balanceSchema).parse(balancesData);
  const schools = z.array(schoolSchema).parse(schoolsData);
  const balanceById = new Map(balances.map((item) => [item.item_id, item]));
  const schoolById = new Map(schools.map((school) => [school.id, school.name]));
  const stampUrlByPath = new Map<string, string>();
  for (const result of stampResults.data ?? []) {
    if (result.error) throw new Error(`تعذر فتح ختم الطلب: ${result.error}`);
    if (result.path && result.signedUrl) stampUrlByPath.set(result.path, result.signedUrl);
  }

  return requests.map((request) => ({
    ...request,
    schoolName: schoolById.get(request.school_id) ?? 'مدرسة غير معروفة',
    approverStampUrl: request.approver_stamp_path ? stampUrlByPath.get(request.approver_stamp_path) ?? null : null,
    items: request.items.map((line) => {
      const inventoryItem = balanceById.get(line.item_id);
      if (!inventoryItem) throw new Error(`تعذر تحميل بيانات الصنف في الطلب ${request.number}.`);
      return { ...line, inventoryItem };
    }),
  }));
}

async function loadMyStamp(): Promise<CurrentStamp | null> {
  if (!supabase) throw new Error('إعداد الاتصال بقاعدة البيانات غير مكتمل.');
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) throw new Error('انتهت جلسة الدخول. أعد تسجيل الدخول.');
  const { data, error } = await supabase.from('approver_stamps')
    .select('storage_path')
    .eq('user_id', userData.user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const stamp = stampRowSchema.parse(data);
  const { data: signed, error: signedError } = await supabase.storage
    .from('inventory-private')
    .createSignedUrl(stamp.storage_path, 600);
  if (signedError) throw signedError;
  return { storagePath: stamp.storage_path, signedUrl: signed.signedUrl };
}

function availableText(value: number | null, formatNumber: (value: number) => string): string {
  return value === null ? 'غير مُجرد' : formatNumber(value);
}

function WorkflowNavigation({ mode }: { mode: WorkflowMode }) {
  const canApprove = usePermission('inventory.approve');
  const canIssue = usePermission('inventory.issue');
  return <nav className="flex flex-wrap gap-2" aria-label="شاشات الطلبات">
    {canApprove && <Link to="/inventory/review" aria-current={mode === 'review' ? 'page' : undefined} className={`min-h-9 rounded-lg px-3 py-2 text-xs font-bold ${mode === 'review' ? 'bg-brand-700 text-white' : 'border border-slate-300 text-slate-700'}`}>طلبات للمراجعة</Link>}
    {canIssue && <Link to="/inventory/issue" aria-current={mode === 'issue' ? 'page' : undefined} className={`min-h-9 rounded-lg px-3 py-2 text-xs font-bold ${mode === 'issue' ? 'bg-brand-700 text-white' : 'border border-slate-300 text-slate-700'}`}>صرف الطلبات</Link>}
    {canApprove && <Link to="/inventory/stamp" className="min-h-9 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700">ختمي وتوقيعي</Link>}
  </nav>;
}

export function InventoryReviewPage() {
  return <InventoryWorkflowPage mode="review" />;
}

export function InventoryIssuePage() {
  return <InventoryWorkflowPage mode="issue" />;
}

function InventoryWorkflowPage({ mode }: { mode: WorkflowMode }) {
  const permission = mode === 'review' ? 'inventory.approve' : 'inventory.issue';
  const canAccess = usePermission(permission);
  const canExportOrder = usePermission('inventory.export_order');
  const { formatNumber, formatDateTime } = useDisplayFormat();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [approvalLines, setApprovalLines] = useState<ApprovalDraftLine[]>([]);
  const [issueLines, setIssueLines] = useState<IssueDraftLine[]>([]);
  const [rejectReason, setRejectReason] = useState('');
  const [receiverName, setReceiverName] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [draftVersion, setDraftVersion] = useState(0);
  const requestsQuery = useQuery({
    queryKey: inventoryWorkflowQueryKeys[mode],
    queryFn: () => loadWorkflowRequests(mode),
    enabled: canAccess,
    staleTime: 15_000,
  });
  const stampQuery = useQuery({
    queryKey: inventoryWorkflowQueryKeys.stamp,
    queryFn: loadMyStamp,
    enabled: canAccess && mode === 'review',
    staleTime: 30_000,
  });
  const requests = useMemo(() => requestsQuery.data ?? [], [requestsQuery.data]);
  const selectedRequest = requests.find((request) => request.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedId && requests.length && !requests.some((request) => request.id === selectedId)) {
      setSelectedId(requests[0].id);
      return;
    }
    if (!selectedId && requests.length) setSelectedId(requests[0].id);
  }, [requests, selectedId]);

  useEffect(() => {
    setRejectReason('');
    setReceiverName('');
    setApprovalLines((selectedRequest?.items ?? []).map((line) => ({
      itemId: line.item_id,
      requested: line.qty_requested,
      approved: String(line.qty_requested),
      removed: false,
    })));
    setIssueLines((selectedRequest?.items ?? []).map((line) => ({
      itemId: line.item_id,
      approved: line.qty_approved,
      alreadyIssued: line.qty_issued,
      remaining: line.qty_approved - line.qty_issued,
      issuing: '',
    })));
  }, [selectedRequest, requestsQuery.dataUpdatedAt, draftVersion]);

  const approvalError = validateApprovalQuantities(approvalLines
    .filter((line) => !line.removed)
    .map((line) => ({ requested: line.requested, approved: Number(line.approved) })));
  const issueError = validateIssueQuantities(issueLines.map((line) => ({
    remaining: line.remaining,
    issuing: line.issuing.trim() ? Number(line.issuing) : 0,
  })));

  if (!canAccess) {
    return <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">لا تملك صلاحية هذه الشاشة.</p>;
  }

  async function finishAction(text: string) {
    setNotice({ tone: 'success', text });
    setSelectedId(null);
    setDraftVersion((value) => value + 1);
    await queryClient.invalidateQueries({ queryKey: inventoryWorkflowQueryKeys[mode] });
  }

  async function approveRequest() {
    if (!supabase || !selectedRequest) return;
    if (!canTransitionInventoryRequest('submitted', 'approved')) {
      setNotice({ tone: 'error', text: 'لا يمكن اعتماد الطلب في حالته الحالية.' });
      return;
    }
    if (!stampQuery.data) {
      setNotice({ tone: 'error', text: 'احفظ ختمك وتوقيعك أولًا؛ لا يمكن اعتماد الطلب بدونهما.' });
      return;
    }
    const activeLines = approvalLines.filter((line) => !line.removed);
    const validationError = validateApprovalQuantities(activeLines.map((line) => ({
      requested: line.requested,
      approved: Number(line.approved),
    })));
    if (validationError) {
      setNotice({ tone: 'error', text: validationError });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const { error } = await supabase.rpc('approve_request', {
        p_request_id: selectedRequest.id,
        p_items: activeLines.map((line) => ({ item_id: line.itemId, qty_approved: Number(line.approved) })),
      });
      if (error) throw error;
      await finishAction(`تم اعتماد الطلب ${selectedRequest.number} وتطبيق ختمك وتوقيعك المحفوظين.`);
    } catch (error) {
      setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function rejectRequest() {
    if (!supabase || !selectedRequest) return;
    if (!canTransitionInventoryRequest('submitted', 'rejected')) {
      setNotice({ tone: 'error', text: 'لا يمكن رفض الطلب في حالته الحالية.' });
      return;
    }
    if (!rejectReason.trim()) {
      setNotice({ tone: 'error', text: 'سبب الرفض مطلوب.' });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const { error } = await supabase.rpc('reject_request', {
        p_request_id: selectedRequest.id,
        p_reason: rejectReason.trim(),
      });
      if (error) throw error;
      await finishAction(`تم رفض الطلب ${selectedRequest.number}.`);
    } catch (error) {
      setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function issueRequest() {
    if (!supabase || !selectedRequest) return;
    if (selectedRequest.status !== 'approved' && selectedRequest.status !== 'partially_issued') {
      setNotice({ tone: 'error', text: 'لا يمكن صرف الطلب في حالته الحالية.' });
      return;
    }
    if (!receiverName.trim()) {
      setNotice({ tone: 'error', text: 'اسم المستلم مطلوب.' });
      return;
    }
    const normalizedLines = issueLines.map((line) => ({
      ...line,
      issuingAmount: line.issuing.trim() ? Number(line.issuing) : 0,
    }));
    const validationError = validateIssueQuantities(normalizedLines.map((line) => ({
      remaining: line.remaining,
      issuing: line.issuingAmount,
    })));
    if (validationError) {
      setNotice({ tone: 'error', text: validationError });
      return;
    }
    for (const line of normalizedLines.filter((item) => item.issuingAmount > 0)) {
      const requestLine = selectedRequest.items.find((item) => item.item_id === line.itemId)!;
      const available = requestLine.inventoryItem.available === null
        ? null
        : requestLine.inventoryItem.available + line.remaining;
      if (available === null) {
        setNotice({ tone: 'error', text: `لا يمكن صرف ${requestLine.inventoryItem.name} لأنه غير مُجرد.` });
        return;
      }
      if (line.issuingAmount > available) {
        setNotice({ tone: 'error', text: `المتاح من ${requestLine.inventoryItem.name} لا يكفي للصرف؛ المتاح الآن ${formatNumber(available)} ${requestLine.inventoryItem.unit}.` });
        return;
      }
    }

    const outcomeLines = normalizedLines.map((line) => ({
      approved: line.approved,
      alreadyIssued: line.alreadyIssued,
      issuing: line.issuingAmount,
    }));
    const outcome = getInventoryIssueOutcome(outcomeLines);
    setBusy(true);
    setNotice(null);
    try {
      const { error } = await supabase.rpc('issue_request', {
        p_request_id: selectedRequest.id,
        p_items: normalizedLines
          .filter((line) => line.issuingAmount > 0)
          .map((line) => ({ item_id: line.itemId, qty_issued: line.issuingAmount })),
        p_receiver_name: receiverName.trim(),
      });
      if (error) throw error;
      await finishAction(outcome === 'issued'
        ? `تم صرف الطلب ${selectedRequest.number} بالكامل للمستلم ${receiverName.trim()}.`
        : `تم صرف الطلب ${selectedRequest.number} جزئيًا للمستلم ${receiverName.trim()}.`);
    } catch (error) {
      const message = errorMessage(error);
      const clearMessage = message.includes('الرصيد المتاح لا يكفي')
        ? `تعذر الصرف: الرصيد المتاح لا يكفي. حدّث الصفحة ثم راجع الكميات. (${message})`
        : message;
      setNotice({ tone: 'error', text: clearMessage });
    } finally {
      setBusy(false);
    }
  }

  const title = mode === 'review' ? 'طلبات للمراجعة' : 'صرف الطلبات';
  const requestCountLabel = mode === 'review' ? 'طلب بانتظار اعتمادك' : 'طلب جاهز للصرف';
  return <div className="grid gap-5" dir="rtl">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-sm text-slate-500">{mode === 'review' ? 'مراجعة الطلبات المسندة إلى منطقتك' : 'صرف الطلبات المعتمدة كليًا أو جزئيًا'}</p>
        <h2 className="mt-1 text-2xl font-extrabold text-brand-900">{title}</h2>
      </div>
      <WorkflowNavigation mode={mode} />
    </header>

    {notice && <p role={notice.tone === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-4 py-3 text-sm ${notice.tone === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>{notice.text}</p>}
    {requestsQuery.error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">تعذر تحميل الطلبات: {errorMessage(requestsQuery.error)}</p>}
    {mode === 'review' && stampQuery.error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">تعذر تحميل الختم المحفوظ: {errorMessage(stampQuery.error)}</p>}

    <div className="grid gap-4 lg:grid-cols-[minmax(260px,0.75fr)_minmax(0,1.5fr)]">
      <section className="card grid content-start gap-3 p-4" aria-label={title}>
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-bold text-brand-900">{title}</h3>
          <span className="text-xs text-slate-500">{formatNumber(requests.length)} {requestCountLabel}</span>
        </div>
        {requestsQuery.isLoading ? <p role="status" className="py-6 text-center text-sm text-slate-500">جارٍ تحميل الطلبات…</p>
          : requests.length ? <ul className="grid gap-2">
            {requests.map((request) => <li key={request.id} className="grid gap-2">
              <button type="button" onClick={() => { setNotice(null); setSelectedId(request.id); }} aria-pressed={selectedId === request.id} className={`grid w-full gap-1 rounded-lg border p-3 text-start ${selectedId === request.id ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <bdi dir="ltr" className="font-mono font-bold text-brand-900">{request.number}</bdi>
                  <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${statusStyles[request.status]}`}>{inventoryRequestStatusLabels[request.status]}</span>
                </span>
                <span className="truncate text-sm font-semibold text-slate-700">{request.schoolName}</span>
                <span className="text-xs text-slate-500">{formatNumber(request.items.length)} أصناف · {request.submitted_at ? formatDateTime(request.submitted_at) : '—'}</span>
              </button>
              {canExportOrder && <Link to={`/inventory/order/${request.id}`} className="inline-flex min-h-9 w-fit items-center gap-1 rounded-lg border border-brand-200 px-3 text-xs font-bold text-brand-800 hover:bg-brand-50">
                <FileDown size={14} aria-hidden="true" />{request.status === 'submitted' ? 'معاينة مسودة' : 'تصدير أمر الصرف'}
              </Link>}
            </li>)}
          </ul> : <p className="rounded-lg bg-slate-50 p-4 text-center text-sm text-slate-500">{mode === 'review' ? 'لا توجد طلبات بانتظار مراجعتك.' : 'لا توجد طلبات معتمدة للصرف.'}</p>}
      </section>

      <section className="card grid content-start gap-4 p-4 sm:p-5" aria-label="تفاصيل الطلب">
        {!selectedRequest ? <p className="py-8 text-center text-sm text-slate-500">اختر طلبًا لعرض تفاصيله.</p> : <>
          <div className="grid gap-2 border-b border-slate-100 pb-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-extrabold text-brand-900"><bdi dir="ltr">{selectedRequest.number}</bdi></h3>
              <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusStyles[selectedRequest.status]}`}>{inventoryRequestStatusLabels[selectedRequest.status]}</span>
            </div>
            <p className="text-sm font-semibold text-slate-700">{selectedRequest.schoolName}</p>
            {selectedRequest.submitted_at && <p className="text-xs text-slate-500">تاريخ الإرسال: {formatDateTime(selectedRequest.submitted_at)}</p>}
            {selectedRequest.notes && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{selectedRequest.notes}</p>}
            {mode === 'issue' && selectedRequest.approverStampUrl && <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <img src={selectedRequest.approverStampUrl} alt="الختم والتوقيع المحفوظان عند الاعتماد" className="h-16 w-24 rounded border border-slate-200 bg-white object-contain p-1" />
              <p className="text-xs font-semibold text-slate-700">ختم المهندس وتوقيعه كما حُفظا عند اعتماد هذا الطلب.</p>
            </div>}
            {canExportOrder && <Link to={`/inventory/order/${selectedRequest.id}`} className="inline-flex min-h-9 w-fit items-center gap-1 rounded-lg border border-brand-200 px-3 text-xs font-bold text-brand-800 hover:bg-brand-50">
              <FileDown size={14} aria-hidden="true" />{mode === 'review' ? 'معاينة مسودة' : 'تصدير أمر الصرف'}
            </Link>}
          </div>

          {mode === 'review' ? <>
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-brand-100 bg-brand-50 p-3">
              {stampQuery.data?.signedUrl
                ? <img src={stampQuery.data.signedUrl} alt="الختم والتوقيع المحفوظان" className="h-16 w-24 rounded border border-slate-200 bg-white object-contain p-1" />
                : <Stamp size={22} className="text-amber-700" aria-hidden="true" />}
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-bold text-slate-800">{stampQuery.data ? 'سيُطبّق ختمك وتوقيعك المحفوظان عند الاعتماد.' : 'لا يوجد ختم وتوقيع محفوظان؛ الاعتماد متوقف.'}</p>
                <Link to="/inventory/stamp" className="mt-1 inline-block font-semibold text-brand-800 underline">صفحة ختمي وتوقيعي</Link>
              </div>
            </div>

            <div className="grid gap-2">
              <h4 className="font-bold text-slate-800">الأصناف والكميات</h4>
              {approvalLines.map((line) => {
                const details = selectedRequest.items.find((item) => item.item_id === line.itemId);
                if (!details) return null;
                return <div key={line.itemId} className={`grid gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_112px_auto] sm:items-center ${line.removed ? 'border-rose-200 bg-rose-50 opacity-70' : 'border-slate-200'}`}>
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800">{details.inventoryItem.name}</p>
                    <p className="text-xs text-slate-500">المطلوب {formatNumber(line.requested)} {details.inventoryItem.unit} · المتاح {availableText(details.inventoryItem.available, formatNumber)}</p>
                    {line.removed && <p className="text-xs font-semibold text-rose-700">سيُحذف هذا البند عند الاعتماد.</p>}
                  </div>
                  {!line.removed && <label className="grid gap-1 text-xs font-semibold text-slate-600">الكمية المعتمدة
                    <input type="number" min="0.001" max={line.requested} step="any" value={line.approved} onChange={(event) => setApprovalLines((current) => current.map((item) => item.itemId === line.itemId ? { ...item, approved: event.target.value } : item))} disabled={busy} className="min-h-10 rounded-lg border border-slate-300 px-2 text-sm" />
                  </label>}
                  <button type="button" onClick={() => setApprovalLines((current) => current.map((item) => item.itemId === line.itemId ? { ...item, removed: !item.removed } : item))} disabled={busy} className="inline-flex min-h-9 items-center justify-center gap-1 rounded-lg border border-rose-200 px-3 text-xs font-semibold text-rose-700 disabled:opacity-50">
                    {line.removed ? <Check size={14} aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />}{line.removed ? 'إبقاء البند' : 'حذف البند'}
                  </button>
                </div>;
              })}
            </div>
            <label className="grid gap-1 text-sm font-semibold text-slate-700">سبب الرفض (إلزامي عند الرفض)
              <textarea value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} rows={2} disabled={busy} className="rounded-lg border border-slate-300 p-3 text-sm" />
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void approveRequest()} disabled={busy || stampQuery.isLoading || !stampQuery.data || Boolean(approvalError)} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-700 px-4 text-sm font-bold text-white disabled:opacity-50">
                <Check size={16} aria-hidden="true" />{busy ? 'جارٍ الاعتماد…' : 'اعتماد الطلب'}
              </button>
              <button type="button" onClick={() => void rejectRequest()} disabled={busy || !rejectReason.trim()} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-rose-300 px-4 text-sm font-bold text-rose-800 disabled:opacity-50">
                رفض الطلب
              </button>
              {approvalError && <p className="self-center text-xs text-rose-700">{approvalError}</p>}
            </div>
          </> : selectedRequest.status === 'issued' ? <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
            تم صرف الطلب للمستلم {selectedRequest.receiver_name ?? 'غير محدد'}.
          </p> : <>
            <div className="grid gap-2">
              <h4 className="font-bold text-slate-800">الكميات المصروفة فعليًا</h4>
              {issueLines.map((line) => {
                const details = selectedRequest.items.find((item) => item.item_id === line.itemId);
                if (!details) return null;
                const available = details.inventoryItem.available === null
                  ? null
                  : details.inventoryItem.available + line.remaining;
                return <div key={line.itemId} className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-[minmax(0,1fr)_112px] sm:items-center">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800">{details.inventoryItem.name}</p>
                    <p className="text-xs text-slate-500">
                      معتمد {formatNumber(line.approved)} · صُرف سابقًا {formatNumber(line.alreadyIssued)} · المتبقي {formatNumber(line.remaining)} {details.inventoryItem.unit}
                    </p>
                    <p className={`text-xs font-semibold ${available === null || available < line.remaining ? 'text-amber-800' : 'text-emerald-800'}`}>
                      المتاح للصرف الآن: {availableText(available, formatNumber)} {available === null ? '' : details.inventoryItem.unit}
                    </p>
                  </div>
                  <label className="grid gap-1 text-xs font-semibold text-slate-600">يصرف الآن
                    <input type="number" min="0" max={line.remaining} step="any" inputMode="decimal" value={line.issuing} onChange={(event) => setIssueLines((current) => current.map((item) => item.itemId === line.itemId ? { ...item, issuing: event.target.value } : item))} disabled={busy || line.remaining <= 0} className="min-h-10 rounded-lg border border-slate-300 px-2 text-sm" />
                  </label>
                </div>;
              })}
            </div>
            <label className="grid gap-1 text-sm font-semibold text-slate-700">اسم المستلم (إلزامي)
              <input value={receiverName} onChange={(event) => setReceiverName(event.target.value)} disabled={busy} className="min-h-10 rounded-lg border border-slate-300 px-3" />
            </label>
            {issueError && <p className="text-xs text-rose-700">{issueError}</p>}
            <button type="button" onClick={() => void issueRequest()} disabled={busy || Boolean(issueError) || !receiverName.trim()} className="inline-flex min-h-10 w-fit items-center gap-2 rounded-lg bg-brand-700 px-4 text-sm font-bold text-white disabled:opacity-50">
              <PackageCheck size={16} aria-hidden="true" />{busy ? 'جارٍ تسجيل الصرف…' : 'صرف الكميات المدخلة'}
            </button>
          </>}
        </>}
      </section>
    </div>
  </div>;
}

async function validateTransparentPng(file: File): Promise<void> {
  if (file.type !== 'image/png' || file.size < 1 || file.size > 5 * 1024 * 1024) {
    throw new Error('اختر صورة PNG لا يتجاوز حجمها 5 ميجابايت.');
  }
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 4_000_000) throw new Error('أبعاد صورة الختم كبيرة جدًا.');
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('تعذر فحص شفافية صورة الختم.');
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let hasTransparentPixel = false;
    let hasVisiblePixel = false;
    for (let alphaIndex = 3; alphaIndex < pixels.length; alphaIndex += 4) {
      if (pixels[alphaIndex] < 255) hasTransparentPixel = true;
      if (pixels[alphaIndex] > 0) hasVisiblePixel = true;
      if (hasTransparentPixel && hasVisiblePixel) break;
    }
    if (!hasTransparentPixel || !hasVisiblePixel) {
      throw new Error('يجب أن تحتوي صورة الختم على توقيع مرئي وخلفية شفافة.');
    }
  } finally {
    bitmap.close();
  }
}

export function InventoryApprovalStampPage() {
  const canApprove = usePermission('inventory.approve');
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const stampQuery = useQuery({
    queryKey: inventoryWorkflowQueryKeys.stamp,
    queryFn: loadMyStamp,
    enabled: canApprove,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!file) {
      setFilePreview(null);
      return;
    }
    const preview = URL.createObjectURL(file);
    setFilePreview(preview);
    return () => URL.revokeObjectURL(preview);
  }, [file]);

  if (!canApprove) {
    return <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">لا تملك صلاحية حفظ ختم الاعتماد.</p>;
  }

  async function saveStamp() {
    if (!supabase || !file) return;
    setError('');
    setNotice('');
    setBusy(true);
    let uploadedPath: string | null = null;
    try {
      await validateTransparentPng(file);
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!userData.user) throw new Error('انتهت جلسة الدخول. أعد تسجيل الدخول.');
      const userId = userData.user.id;
      const oldPath = stampQuery.data?.storagePath ?? null;
      uploadedPath = `${userId}/${crypto.randomUUID()}.png`;
      const { error: uploadError } = await supabase.storage.from('inventory-private').upload(uploadedPath, file, {
        contentType: 'image/png',
        upsert: false,
      });
      if (uploadError) throw uploadError;

      const saveResult = oldPath
        ? await supabase.from('approver_stamps').update({ storage_path: uploadedPath }).eq('user_id', userId).select('user_id').maybeSingle()
        : await supabase.from('approver_stamps').insert({ user_id: userId, storage_path: uploadedPath }).select('user_id').single();
      if (saveResult.error) throw saveResult.error;
      if (!saveResult.data) throw new Error('تعذر ربط صورة الختم بحسابك؛ أعد المحاولة.');

      uploadedPath = null;
      await queryClient.invalidateQueries({ queryKey: inventoryWorkflowQueryKeys.stamp });
      setFile(null);
      setNotice('تم حفظ ختمك وتوقيعك الخاصين بنجاح. يحتفظ النظام بالنسخ السابقة المرتبطة بالطلبات المعتمدة.');
    } catch (reason) {
      if (uploadedPath) {
        const { error: cleanupError } = await supabase.storage.from('inventory-private').remove([uploadedPath]);
        if (cleanupError) {
          setError(`${errorMessage(reason)} وتعذر حذف الملف المرفوع: ${cleanupError.message}`);
          setBusy(false);
          return;
        }
      }
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  return <div className="mx-auto grid max-w-3xl gap-5" dir="rtl">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-sm text-slate-500">ختمك وتوقيعك لا يراهما إلا أنت والمصرح لهم</p>
        <h2 className="mt-1 text-2xl font-extrabold text-brand-900">ختمي وتوقيعي</h2>
      </div>
      <Link to="/inventory/review" className="min-h-9 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700">طلبات للمراجعة</Link>
    </header>
    {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    {notice && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
    <section className="card grid gap-4 p-4 sm:p-6">
      <p className="text-sm leading-6 text-slate-600">ارفع صورة PNG شفافة لختمك وتوقيعك. تُحفظ الصورة في مساحة خاصة، ويشترط وجودها لاعتماد الطلبات المسندة إليك.</p>
      {stampQuery.isLoading ? <p role="status" className="text-sm text-slate-500">جارٍ تحميل الختم…</p>
        : stampQuery.error ? <p role="alert" className="text-sm text-rose-800">تعذر تحميل الختم المحفوظ: {errorMessage(stampQuery.error)}</p>
          : stampQuery.data ? <div className="grid gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <span className="text-sm font-bold text-emerald-900">الختم والتوقيع الحاليان</span>
            <img src={stampQuery.data.signedUrl} alt="معاينة الختم والتوقيع المحفوظين" className="max-h-48 max-w-full rounded border border-slate-200 bg-white object-contain p-2" />
          </div> : <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">لم تحفظ ختمًا بعد؛ لن تتمكن من اعتماد الطلبات حتى تحفظه.</p>}
      <label className="grid gap-1 text-sm font-semibold text-slate-700">صورة PNG شفافة
        <input type="file" accept="image/png,.png" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setError(''); }} disabled={busy} className="block w-full text-sm file:me-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:font-semibold" />
      </label>
      {filePreview && <img src={filePreview} alt="معاينة الختم الجديد" className="max-h-48 max-w-full justify-self-start rounded border border-slate-200 bg-[linear-gradient(45deg,#eee_25%,transparent_25%),linear-gradient(-45deg,#eee_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#eee_75%),linear-gradient(-45deg,transparent_75%,#eee_75%)] bg-[length:16px_16px] bg-[position:0_0,0_8px,8px_-8px,-8px_0] object-contain p-2" />}
      <button type="button" onClick={() => void saveStamp()} disabled={busy || !file} className="inline-flex min-h-10 w-fit items-center gap-2 rounded-lg bg-brand-700 px-4 text-sm font-bold text-white disabled:opacity-50">
        <FileSignature size={16} aria-hidden="true" />{busy ? 'جارٍ حفظ الختم…' : 'حفظ الختم والتوقيع'}
      </button>
    </section>
  </div>;
}

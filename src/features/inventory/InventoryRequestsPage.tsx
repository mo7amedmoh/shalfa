import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Clock3, FileDown, Plus, Search, Send, Trash2, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { usePermission } from '../../app/permissionContext';
import { useDisplayFormat } from '../../app/useDisplayFormat';
import { supabase } from '../../lib/supabase';
import {
  canCancelInventoryRequest,
  getSuggestedInventoryItems,
  hasQuantityWarning,
  inventoryRequestQueryKeys,
  inventoryRequestStatusLabels,
  type InventoryRequestStatus,
  type RecentInventoryItem,
} from './inventoryRequestsModel';

const numericSchema = z.union([z.number(), z.string()]).transform(Number);
const nullableNumericSchema = numericSchema.nullable();
const schoolSchema = z.object({ id: z.string().uuid(), school_name: z.string() });
const itemSchema = z.object({
  item_id: z.string().uuid(),
  name: z.string(),
  logix_code: z.string().nullable(),
  unit: z.string(),
  available: nullableNumericSchema,
  is_active: z.boolean(),
});
const requestLineSchema = z.object({
  item_id: z.string().uuid(),
  qty_requested: numericSchema,
});
const requestSchema = z.object({
  id: z.string().uuid(),
  number: z.string(),
  school_id: z.string().uuid(),
  status: z.enum(['draft', 'submitted', 'approved', 'rejected', 'issued', 'partially_issued', 'cancelled']),
  submitted_at: z.string().nullable(),
  items: z.array(requestLineSchema).nullish().transform((items) => items ?? []),
});
const suggestionSchema = z.object({
  item_id: z.string().uuid(),
  name: z.string(),
  logix_code: z.string().nullable(),
  unit: z.string(),
  available: nullableNumericSchema,
  last_requested_at: z.string(),
});

type RequestSchool = z.infer<typeof schoolSchema>;
type RequestItem = z.infer<typeof itemSchema>;
type StockRequest = z.infer<typeof requestSchema>;
type SelectedRequestItem = { itemId: string; quantity: string };
type Notice = { tone: 'success' | 'error'; text: string };

const statusStyles: Record<InventoryRequestStatus, string> = {
  draft: 'bg-slate-100 text-slate-700 ring-slate-200',
  submitted: 'bg-blue-50 text-blue-800 ring-blue-200',
  approved: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  rejected: 'bg-rose-50 text-rose-800 ring-rose-200',
  issued: 'bg-violet-50 text-violet-800 ring-violet-200',
  partially_issued: 'bg-amber-50 text-amber-800 ring-amber-200',
  cancelled: 'bg-slate-100 text-slate-500 ring-slate-200',
};

async function loadRequestSchools(): Promise<RequestSchool[]> {
  if (!supabase) throw new Error('إعداد الاتصال بقاعدة البيانات غير مكتمل.');
  const { data, error } = await supabase.from('schools')
    .select('id,school_name:name')
    .order('name');
  if (error) throw error;
  return z.array(schoolSchema).parse(data);
}

async function loadRequestItems(): Promise<RequestItem[]> {
  if (!supabase) throw new Error('إعداد الاتصال بقاعدة البيانات غير مكتمل.');
  const rows: unknown[] = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabase.from('inventory_balances')
      .select('item_id,name,logix_code,unit,available,is_active')
      .eq('is_active', true)
      .order('name')
      .range(start, start + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return z.array(itemSchema).parse(rows);
}

async function loadMyRequests(): Promise<StockRequest[]> {
  if (!supabase) throw new Error('إعداد الاتصال بقاعدة البيانات غير مكتمل.');
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) throw new Error('انتهت جلسة الدخول. أعد تسجيل الدخول لعرض طلباتك.');

  const rows: unknown[] = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabase.from('stock_requests')
      .select('id,number,school_id,status,submitted_at,items:stock_request_items(item_id,qty_requested)')
      .eq('requester_id', userData.user.id)
      .order('submitted_at', { ascending: false })
      .range(start, start + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return z.array(requestSchema).parse(rows);
}

async function loadSuggestedItems(): Promise<RecentInventoryItem[]> {
  if (!supabase) throw new Error('إعداد الاتصال بقاعدة البيانات غير مكتمل.');
  const { data, error } = await supabase.rpc('recent_inventory_request_items');
  if (error) throw error;
  return z.array(suggestionSchema).parse(data);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'حدث خطأ غير متوقع.';
}

function availableLabel(value: number | null, formatNumber: (value: number) => string): string {
  return value === null ? 'غير مُجرد' : `المتاح ${formatNumber(value)}`;
}

export function InventoryRequestsPage() {
  const canRequest = usePermission('inventory.request');
  const canViewInventory = usePermission('inventory.view');
  const canExportOrder = usePermission('inventory.export_order');
  const { formatNumber, formatDateTime } = useDisplayFormat();
  const queryClient = useQueryClient();
  const [schoolId, setSchoolId] = useState('');
  const [search, setSearch] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedItems, setSelectedItems] = useState<SelectedRequestItem[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [savingAction, setSavingAction] = useState<'draft' | 'send' | null>(null);
  const [requestAction, setRequestAction] = useState<{ id: string; action: 'submit' | 'cancel' } | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const schools = useQuery({
    queryKey: inventoryRequestQueryKeys.schools,
    queryFn: loadRequestSchools,
    enabled: canRequest,
    staleTime: 30_000,
  });
  const items = useQuery({
    queryKey: inventoryRequestQueryKeys.items,
    queryFn: loadRequestItems,
    enabled: canRequest,
    staleTime: 30_000,
  });
  const requests = useQuery({
    queryKey: inventoryRequestQueryKeys.requests,
    queryFn: loadMyRequests,
    enabled: canRequest,
    staleTime: 15_000,
  });
  const suggestions = useQuery({
    queryKey: inventoryRequestQueryKeys.suggestions,
    queryFn: loadSuggestedItems,
    enabled: canRequest,
    staleTime: 60_000,
  });

  const filteredItems = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    return (items.data ?? []).filter((item) => !normalizedSearch
      || item.name.toLocaleLowerCase().includes(normalizedSearch)
      || (item.logix_code ?? '').toLocaleLowerCase().includes(normalizedSearch)).slice(0, 8);
  }, [items.data, search]);
  const suggestedItems = useMemo(
    () => getSuggestedInventoryItems(suggestions.data ?? []),
    [suggestions.data],
  );
  const itemById = useMemo(() => new Map((items.data ?? []).map((item) => [item.item_id, item])), [items.data]);
  const schoolNames = useMemo(
    () => new Map((schools.data ?? []).map((school) => [school.id, school.school_name])),
    [schools.data],
  );
  const hasValidItems = selectedItems.length > 0 && selectedItems.every((selected) => {
    const quantity = Number(selected.quantity);
    return Number.isFinite(quantity) && quantity > 0;
  });

  function addItem(item: Pick<RequestItem, 'item_id'>) {
    setSelectedItems((current) => current.some((selected) => selected.itemId === item.item_id)
      ? current
      : [...current, { itemId: item.item_id, quantity: '1' }]);
  }

  function updateQuantity(itemId: string, quantity: string) {
    setSelectedItems((current) => current.map((selected) => selected.itemId === itemId
      ? { ...selected, quantity }
      : selected));
  }

  async function refreshRequests() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: inventoryRequestQueryKeys.requests }),
      queryClient.invalidateQueries({ queryKey: inventoryRequestQueryKeys.suggestions }),
    ]);
  }

  async function saveDraft(sendAfterSave: boolean) {
    setNotice(null);
    if (!canRequest) {
      setNotice({ tone: 'error', text: 'لا تملك صلاحية إنشاء طلبات قطع الغيار.' });
      return;
    }
    if (!supabase) {
      setNotice({ tone: 'error', text: 'إعداد الاتصال بقاعدة البيانات غير مكتمل.' });
      return;
    }
    if (!schoolId) {
      setNotice({ tone: 'error', text: 'اختر المدرسة أولًا.' });
      return;
    }
    if (!hasValidItems) {
      setNotice({ tone: 'error', text: 'أضف صنفًا واحدًا على الأقل وأدخل كمية أكبر من صفر.' });
      return;
    }

    setSavingAction(sendAfterSave ? 'send' : 'draft');
    let savedRequestId: string | null = null;
    try {
      const { data, error } = await supabase.rpc('save_stock_request_draft', {
        p_school_id: schoolId,
        p_items: selectedItems.map((selected) => ({
          item_id: selected.itemId,
          qty_requested: Number(selected.quantity),
        })),
        p_notes: notes.trim() || null,
      });
      if (error) throw error;
      savedRequestId = z.string().uuid().parse(data);
      setSelectedItems([]);
      setNotes('');

      const { data: savedRequest, error: savedRequestError } = await supabase.from('stock_requests')
        .select('number')
        .eq('id', savedRequestId)
        .single();
      if (savedRequestError) throw savedRequestError;

      if (sendAfterSave) {
        const { error: submitError } = await supabase.rpc('submit_request', { p_request_id: savedRequestId });
        if (submitError) {
          setNotice({
            tone: 'error',
            text: `حُفظ الطلب ${savedRequest.number} كمسودة، لكن تعذر إرساله: ${errorMessage(submitError)}`,
          });
          return;
        }
        setNotice({ tone: 'success', text: `تم إرسال الطلب ${savedRequest.number} إلى المهندس المسند.` });
      } else {
        setNotice({ tone: 'success', text: `تم حفظ الطلب ${savedRequest.number} كمسودة.` });
      }
    } catch (error) {
      setNotice({
        tone: 'error',
        text: savedRequestId
          ? `تم حفظ المسودة، لكن تعذر إكمال العملية: ${errorMessage(error)}`
          : errorMessage(error),
      });
    } finally {
      setSavingAction(null);
      await refreshRequests();
    }
  }

  async function runRequestAction(request: StockRequest, action: 'submit' | 'cancel') {
    if (!supabase || !canRequest) {
      setNotice({ tone: 'error', text: 'لا تملك صلاحية تنفيذ هذا الإجراء.' });
      return;
    }
    setNotice(null);
    setConfirmCancelId(null);
    setRequestAction({ id: request.id, action });
    try {
      const { error } = action === 'submit'
        ? await supabase.rpc('submit_request', { p_request_id: request.id })
        : await supabase.rpc('cancel_request', { p_request_id: request.id });
      if (error) throw error;
      setNotice({
        tone: 'success',
        text: action === 'submit'
          ? `تم إرسال الطلب ${request.number} إلى المهندس المسند.`
          : `تم إلغاء الطلب ${request.number}.`,
      });
    } catch (error) {
      setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      setRequestAction(null);
      await refreshRequests();
    }
  }

  if (!canRequest) {
    return <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">لا تملك صلاحية طلب قطع الغيار.</p>;
  }

  return (
    <div className="grid gap-5" dir="rtl">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">إنشاء الطلبات ومتابعتها</p>
          <h2 className="mt-1 text-2xl font-extrabold text-brand-900">طلبات قطع الغيار</h2>
        </div>
        {canViewInventory && (
          <Link to="/inventory" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            عرض المخزون <ArrowLeft size={16} aria-hidden="true" />
          </Link>
        )}
      </header>

      {notice && (
        <p role={notice.tone === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-4 py-3 text-sm ${notice.tone === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>
          {notice.text}
        </p>
      )}

      {(schools.error || items.error) && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <b>تعذر تحميل بيانات إنشاء الطلب.</b>
          {schools.error && <p className="mt-1 break-words">المدارس: {errorMessage(schools.error)}</p>}
          {items.error && <p className="mt-1 break-words">أصناف المخزون: {errorMessage(items.error)}</p>}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
        <section className="card grid content-start gap-4 p-4 sm:p-5" aria-labelledby="create-request-title">
          <div>
            <h3 id="create-request-title" className="text-lg font-bold text-brand-900">إنشاء طلب جديد</h3>
            <p className="mt-1 text-sm text-slate-500">يمكنك حفظه كمسودة أو إرساله مباشرة إلى المهندس المسند.</p>
          </div>

          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            المدرسة
            <select
              value={schoolId}
              onChange={(event) => setSchoolId(event.target.value)}
              disabled={schools.isLoading || Boolean(schools.error)}
              className="min-h-11 rounded-lg border border-slate-300 px-3"
            >
              <option value="">{schools.isLoading ? 'جارٍ تحميل المدارس…' : 'اختر المدرسة'}</option>
              {(schools.data ?? []).map((school) => (
                <option key={school.id} value={school.id}>{school.school_name}</option>
              ))}
            </select>
          </label>

          <div className="grid gap-2">
            <label htmlFor="request-item-search" className="text-sm font-semibold text-slate-700">إضافة أصناف</label>
            <span className="relative">
              <Search size={17} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                id="request-item-search"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="ابحث باسم الصنف أو كود Logix"
                className="min-h-11 w-full rounded-lg border border-slate-300 py-2 pe-3 ps-10 text-sm"
              />
            </span>
            <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200">
              {items.isLoading ? (
                <p role="status" className="p-3 text-sm text-slate-500">جارٍ تحميل الأصناف…</p>
              ) : filteredItems.length ? filteredItems.map((item) => {
                const isSelected = selectedItems.some((selected) => selected.itemId === item.item_id);
                return (
                  <div key={item.item_id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 last:border-b-0">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-800">{item.name}</p>
                      <p className="text-xs text-slate-500">
                        {item.logix_code ? <bdi dir="ltr" className="font-mono">{item.logix_code}</bdi> : 'بلا كود'}
                        {' · '}{item.unit}{' · '}{availableLabel(item.available, formatNumber)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => addItem(item)}
                      disabled={isSelected}
                      className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-brand-200 px-3 text-xs font-bold text-brand-800 hover:bg-brand-50 disabled:cursor-default disabled:opacity-60"
                    >
                      {isSelected ? <Check size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
                      {isSelected ? 'مضاف' : 'إضافة'}
                    </button>
                  </div>
                );
              }) : <p className="p-3 text-sm text-slate-500">{items.data?.length ? 'لا توجد أصناف تطابق البحث.' : 'لا توجد أصناف نشطة متاحة للطلب.'}</p>}
            </div>
          </div>

          <div className="grid gap-2">
            <h4 className="text-sm font-bold text-slate-800">أصناف الطلب</h4>
            {selectedItems.length ? (
              <ul className="grid gap-2">
                {selectedItems.map((selected) => {
                  const item = itemById.get(selected.itemId);
                  if (!item) return null;
                  const quantity = Number(selected.quantity);
                  const quantityWarning = hasQuantityWarning(quantity, item.available);
                  return (
                    <li key={item.item_id} className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-[minmax(0,1fr)_112px_auto] sm:items-center">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-800">{item.name}</p>
                        <p className="text-xs text-slate-500">{availableLabel(item.available, formatNumber)}</p>
                        {quantityWarning && (
                          <p className="mt-1 text-xs font-semibold text-amber-800">الكمية المطلوبة أكبر من المتاح؛ سيُرسل الطلب مع هذا التنبيه.</p>
                        )}
                      </div>
                      <label className="grid gap-1 text-xs font-semibold text-slate-600">
                        الكمية
                        <input
                          type="number"
                          min="0.001"
                          step="any"
                          inputMode="decimal"
                          value={selected.quantity}
                          onChange={(event) => updateQuantity(item.item_id, event.target.value)}
                          aria-label={`كمية ${item.name}`}
                          className="min-h-10 rounded-lg border border-slate-300 px-2 text-sm"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => setSelectedItems((current) => current.filter((entry) => entry.itemId !== item.item_id))}
                        aria-label={`حذف ${item.name} من الطلب`}
                        className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border border-rose-200 px-3 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                      >
                        <Trash2 size={15} aria-hidden="true" />حذف
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">أضف صنفًا واحدًا على الأقل إلى الطلب.</p>}
          </div>

          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            ملاحظات (اختياري)
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} className="rounded-lg border border-slate-300 p-3 text-sm" />
          </label>

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void saveDraft(false)} disabled={savingAction !== null || !schoolId || !hasValidItems} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              <Clock3 size={16} aria-hidden="true" />حفظ كمسودة
            </button>
            <button type="button" onClick={() => void saveDraft(true)} disabled={savingAction !== null || !schoolId || !hasValidItems} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand-700 px-4 py-2 text-sm font-bold text-white hover:bg-brand-800 disabled:opacity-50">
              <Send size={16} aria-hidden="true" />{savingAction === 'send' ? 'جارٍ الإرسال…' : 'حفظ وإرسال'}
            </button>
          </div>
        </section>

        <section className="card grid content-start gap-3 p-4 sm:p-5" aria-labelledby="recent-request-items-title">
          <div>
            <h3 id="recent-request-items-title" className="text-lg font-bold text-brand-900">الأصناف المقترحة</h3>
            <p className="mt-1 text-sm text-slate-500">آخر 10 أصناف طلبتها.</p>
          </div>
          {suggestions.error ? (
            <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">تعذر تحميل الأصناف المقترحة: {errorMessage(suggestions.error)}</p>
          ) : suggestions.isLoading ? (
            <p role="status" className="text-sm text-slate-500">جارٍ تحميل الأصناف المقترحة…</p>
          ) : suggestedItems.length ? (
            <ul className="grid gap-2">
              {suggestedItems.map((item) => {
                const isSelected = selectedItems.some((selected) => selected.itemId === item.item_id);
                return (
                  <li key={item.item_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-800">{item.name}</p>
                      <p className="text-xs text-slate-500">{availableLabel(item.available, formatNumber)} · {item.unit}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => addItem(item)}
                      disabled={isSelected}
                      className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-brand-200 px-3 text-xs font-bold text-brand-800 hover:bg-brand-50 disabled:opacity-60"
                    >
                      <Plus size={14} aria-hidden="true" />{isSelected ? 'مضاف' : 'إضافة'}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">ستظهر هنا الأصناف التي سبق أن طلبتها.</p>}
        </section>
      </div>

      <section className="card grid gap-3 p-4 sm:p-5" aria-labelledby="my-requests-title">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="my-requests-title" className="text-lg font-bold text-brand-900">طلباتي</h3>
          {requests.data && <span className="text-sm text-slate-500">{formatNumber(requests.data.length)} طلب</span>}
        </div>
        {requests.isLoading ? (
          <p role="status" className="py-4 text-center text-sm text-slate-500">جارٍ تحميل طلباتك…</p>
        ) : requests.error ? (
          <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">تعذر تحميل طلباتك: {errorMessage(requests.error)}</p>
        ) : requests.data?.length ? (
          <ul className="grid gap-3">
            {requests.data.map((request) => {
              const canCancel = canCancelInventoryRequest(request.status);
              const actionBusy = requestAction?.id === request.id;
              return (
                <li key={request.id} className="grid gap-3 rounded-xl border border-slate-200 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <bdi dir="ltr" className="font-mono text-sm font-bold text-brand-900">{request.number}</bdi>
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${statusStyles[request.status]}`}>
                        {inventoryRequestStatusLabels[request.status]}
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-semibold text-slate-700">{schoolNames.get(request.school_id) ?? 'مدرسة غير معروفة'}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {request.items.length ? `${formatNumber(request.items.length)} أصناف` : 'لا توجد أصناف'}
                      {' · '}{request.submitted_at ? formatDateTime(request.submitted_at) : 'لم يُرسل بعد'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canExportOrder && (
                      <Link
                        to={`/inventory/order/${request.id}`}
                        className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-brand-200 px-3 text-xs font-bold text-brand-800 hover:bg-brand-50"
                      >
                        <FileDown size={14} aria-hidden="true" />معاينة أمر الصرف
                      </Link>
                    )}
                    {request.status === 'draft' && (
                      <button
                        type="button"
                        onClick={() => void runRequestAction(request, 'submit')}
                        disabled={actionBusy}
                        className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-brand-700 px-3 text-xs font-bold text-white hover:bg-brand-800 disabled:opacity-50"
                      >
                        <Send size={14} aria-hidden="true" />إرسال للمهندس
                      </button>
                    )}
                    {canCancel && (confirmCancelId === request.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void runRequestAction(request, 'cancel')}
                          disabled={actionBusy}
                          className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-rose-700 px-3 text-xs font-bold text-white hover:bg-rose-800 disabled:opacity-50"
                        >
                          <Check size={14} aria-hidden="true" />تأكيد الإلغاء
                        </button>
                        <button type="button" onClick={() => setConfirmCancelId(null)} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700">
                          <X size={14} aria-hidden="true" />تراجع
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmCancelId(request.id)}
                        disabled={actionBusy}
                        className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-rose-200 px-3 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                      >
                        <X size={14} aria-hidden="true" />إلغاء الطلب
                      </button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : <p className="rounded-lg bg-slate-50 p-4 text-center text-sm text-slate-500">لا توجد طلبات حتى الآن.</p>}
      </section>
    </div>
  );
}

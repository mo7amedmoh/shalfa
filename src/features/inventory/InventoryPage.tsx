import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, FileUp, History, Image as ImageIcon, Package, Pencil, Plus, Search, X, ZoomIn } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { usePermission, usePermissions } from '../../app/permissionContext';
import { useDisplayFormat } from '../../app/useDisplayFormat';
import { supabase } from '../../lib/supabase';
import { filterInventoryItems, getInventoryShortageCounts, type InventoryStatus } from './inventoryModel';
import {
  parseOpeningBalance,
  getInventoryImportMatches,
  normalizeInventoryImportText,
  resolveInventoryImportMatch,
  summarizeInventoryImport,
  validateInventoryImportRows,
  type ExistingInventoryItem,
  type ImportSummary,
  type InventoryImportRow,
  type InventoryImportValidation,
} from './inventoryImportModel';
import { parseInventoryWorkbook } from './inventoryExcelImport';

const numericSchema = z.union([z.number(), z.string()]).transform(Number);
const nullableNumericSchema = numericSchema.nullable();
const balanceSchema = z.object({
  item_id: z.string().uuid(),
  logix_code: z.string().nullable(),
  name: z.string(),
  unit: z.string(),
  category_id: z.string().uuid(),
  photo_path: z.string().nullable(),
  notes: z.string().nullable(),
  min_stock: nullableNumericSchema,
  is_active: z.boolean(),
  balance: nullableNumericSchema,
  reserved: numericSchema,
  available: nullableNumericSchema,
  status: z.enum(['available', 'low', 'out', 'uncounted']),
});
const categorySchema = z.object({ id: z.string().uuid(), name: z.string() });
const movementSchema = z.object({
  id: z.string().uuid(),
  movement_type: z.enum(['opening', 'receipt', 'issue', 'adjustment']),
  quantity: numericSchema,
  reason: z.string().nullable(),
  created_at: z.string(),
  request_id: z.string().uuid().nullable(),
});

type InventoryCategory = z.infer<typeof categorySchema>;
type InventoryItem = z.infer<typeof balanceSchema> & { category_name: string; photo_url: string | null };
type InventoryMovement = z.infer<typeof movementSchema>;
type ItemDraft = {
  name: string;
  logixCode: string;
  unit: string;
  categoryId: string;
  minStock: string;
  notes: string;
};
type InventoryPermission = 'inventory.manage_items' | 'inventory.receive_stock' | 'inventory.adjust';

const EMPTY_INVENTORY_ITEMS: InventoryItem[] = [];

const statusLabels: Record<InventoryStatus, string> = {
  available: 'متوفر',
  low: 'منخفض',
  out: 'نافد',
  uncounted: 'غير مُجرد',
};
const movementLabels: Record<InventoryMovement['movement_type'], string> = {
  opening: 'جرد افتتاحي',
  receipt: 'توريد',
  issue: 'صرف',
  adjustment: 'تسوية',
};
const statusStyles: Record<InventoryStatus, string> = {
  available: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  low: 'bg-amber-50 text-amber-800 ring-amber-200',
  out: 'bg-rose-50 text-rose-800 ring-rose-200',
  uncounted: 'bg-slate-100 text-slate-700 ring-slate-200',
};

function getInventoryImportRowMessages(
  row: InventoryImportRow,
  issues: InventoryImportValidation,
  blockingOnly = false,
): string[] {
  const entries = [
    { message: 'اسم الصنف مفقود', active: issues.missingName, blocking: true },
    { message: 'كود Logix مفقود', active: issues.missingCode, blocking: false },
    { message: 'كود Logix مكرر', active: issues.duplicateCode, blocking: false },
    { message: 'الوحدة مفقودة', active: issues.missingUnit, blocking: true },
    { message: 'القسم مفقود', active: issues.missingCategory, blocking: true },
    { message: 'هل تقصد «سباكة»؟', active: issues.misspelledCategory, blocking: true },
    { message: 'الرصيد يحتاج إلى تصحيح', active: issues.invalidBalance, blocking: true },
    { message: `${row.valueErrors.length} خلية خطأ`, active: issues.unresolvedValueErrors, blocking: true },
    { message: 'تعذرت قراءة صورة مضمّنة', active: issues.unreadableImages, blocking: true },
    { message: 'تطابق متعدد؛ سيُضاف كسجل جديد ما لم تختر سجلًا للتحديث', active: issues.ambiguousMatch, blocking: false },
  ];
  return entries
    .filter((entry) => entry.active && (!blockingOnly || entry.blocking))
    .map((entry) => entry.message);
}

async function loadInventory(): Promise<{ items: InventoryItem[]; categories: InventoryCategory[] }> {
  if (!supabase) throw new Error('إعداد الاتصال بقاعدة البيانات غير مكتمل.');

  const balanceRows: unknown[] = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabase.from('inventory_balances')
      .select('item_id,logix_code,name,unit,category_id,photo_path,notes,min_stock,is_active,balance,reserved,available,status')
      .order('name')
      .range(start, start + 999);
    if (error) throw error;
    balanceRows.push(...data);
    if (data.length < 1000) break;
  }
  const { data: categoryData, error: categoryError } = await supabase.from('inventory_categories')
    .select('id,name')
    .order('name');
  if (categoryError) throw categoryError;

  const balances = z.array(balanceSchema).parse(balanceRows);
  const categories = z.array(categorySchema).parse(categoryData);
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  const paths = [...new Set(balances.flatMap((item) => item.photo_path && !/^https?:\/\//i.test(item.photo_path)
    ? [item.photo_path]
    : []))];
  const signedUrls = new Map<string, string>();
  if (paths.length) {
    const { data, error } = await supabase.storage.from('inventory-private').createSignedUrls(paths, 600);
    if (error) throw error;
    for (const result of data) {
      if (result.error) throw new Error(`تعذر فتح صورة صنف المخزون: ${result.error}`);
      if (result.path && result.signedUrl) signedUrls.set(result.path, result.signedUrl);
    }
  }

  return {
    categories,
    items: balances.map((item) => ({
      ...item,
      category_name: categoryNames.get(item.category_id) ?? 'قسم غير معروف',
      photo_url: item.photo_path
        ? /^https?:\/\//i.test(item.photo_path) ? item.photo_path : signedUrls.get(item.photo_path) ?? null
        : null,
    })),
  };
}

async function loadItemMovements(itemId: string): Promise<InventoryMovement[]> {
  if (!supabase) throw new Error('إعداد الاتصال بقاعدة البيانات غير مكتمل.');
  const { data, error } = await supabase.from('inventory_movements')
    .select('id,movement_type,quantity,reason,created_at,request_id')
    .eq('item_id', itemId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return z.array(movementSchema).parse(data);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'حدث خطأ غير متوقع.';
}

function formatQuantity(value: number | null, formatNumber: (value: number) => string): string {
  return value === null ? '—' : formatNumber(value);
}

export function InventoryPage() {
  const canView = usePermission('inventory.view');
  const permissions = usePermissions(['inventory.manage_items', 'inventory.receive_stock', 'inventory.adjust'] as const);
  const canManageItems = permissions.has('inventory.manage_items');
  const canReceive = permissions.has('inventory.receive_stock');
  const canAdjust = permissions.has('inventory.adjust');
  const { formatNumber, formatDateTime } = useDisplayFormat();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<InventoryStatus | 'all'>('all');
  const shortagesOnly = searchParams.get('shortages') === 'true';
  const [editorItem, setEditorItem] = useState<InventoryItem | null | undefined>(undefined);
  const [movementTarget, setMovementTarget] = useState<{ item: InventoryItem; type: 'opening' | 'receipt' | 'adjustment' } | null>(null);
  const [detailsItem, setDetailsItem] = useState<InventoryItem | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [inventoryImportOpen, setInventoryImportOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [savingItem, setSavingItem] = useState(false);
  const [savingMovement, setSavingMovement] = useState(false);
  const [savingImport, setSavingImport] = useState(false);
  const inventory = useQuery({
    queryKey: ['inventory-balances', 'page'],
    queryFn: loadInventory,
    enabled: canView,
    staleTime: 30_000,
  });
  const movements = useQuery({
    queryKey: ['inventory-movements', detailsItem?.item_id],
    queryFn: () => loadItemMovements(detailsItem!.item_id),
    enabled: Boolean(detailsItem),
  });
  const categories = inventory.data?.categories ?? [];
  const items = inventory.data?.items ?? EMPTY_INVENTORY_ITEMS;
  const importMatchItems = useMemo<ExistingInventoryItem[]>(() => items.map((item) => ({
    id: item.item_id,
    logixCode: item.logix_code,
    name: item.name,
    categoryName: item.category_name,
    photoPath: item.photo_path,
  })), [items]);
  const duplicateLogixCodes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      const code = item.logix_code ? normalizeInventoryImportText(item.logix_code) : '';
      if (code) counts.set(code, (counts.get(code) ?? 0) + 1);
    }
    return new Set([...counts].filter(([, count]) => count > 1).map(([code]) => code));
  }, [items]);
  const shortages = useMemo(() => getInventoryShortageCounts(items), [items]);
  const visibleItems = useMemo(() => filterInventoryItems(items, {
    search,
    categoryId: categoryFilter,
    status: statusFilter,
    shortagesOnly,
  }), [items, search, categoryFilter, statusFilter, shortagesOnly]);

  function setShortagesFilter(enabled: boolean) {
    const next = new URLSearchParams(searchParams);
    if (enabled) next.set('shortages', 'true');
    else next.delete('shortages');
    setSearchParams(next, { replace: true });
  }

  async function saveItem(draft: ItemDraft, photo: File | null, item: InventoryItem | null) {
    if (!supabase || !canManageItems) throw new Error('لا تملك صلاحية إدارة أصناف المخزون.');
    const name = draft.name.trim();
    const unit = draft.unit.trim();
    if (!name || !unit || !draft.categoryId) throw new Error('أدخل اسم الصنف ووحدته والقسم.');
    const minStock = draft.minStock.trim() ? Number(draft.minStock) : null;
    if (minStock !== null && (!Number.isFinite(minStock) || minStock < 0)) {
      throw new Error('الحد الأدنى يجب أن يكون رقمًا غير سالب.');
    }
    if (photo && (!['image/jpeg', 'image/png', 'image/webp'].includes(photo.type) || photo.size < 1 || photo.size > 5 * 1024 * 1024)) {
      throw new Error('اختر صورة JPG أو PNG أو WebP لا يتجاوز حجمها 5 ميجابايت.');
    }

    const itemId = item?.item_id ?? crypto.randomUUID();
    let photoPath = item?.photo_path ?? null;
    let uploadedPath: string | null = null;
    if (photo) {
      const extension = photo.type === 'image/png' ? 'png' : photo.type === 'image/webp' ? 'webp' : 'jpg';
      uploadedPath = `items/${itemId}/${crypto.randomUUID()}.${extension}`;
      const { error } = await supabase.storage.from('inventory-private').upload(uploadedPath, photo, {
        contentType: photo.type,
        upsert: false,
      });
      if (error) throw error;
      photoPath = uploadedPath;
    }

    const { error } = await supabase.rpc('save_inventory_item', {
      p_item_id: itemId,
      p_is_new: !item,
      p_logix_code: draft.logixCode.trim() || null,
      p_name: name,
      p_unit: unit,
      p_category_id: draft.categoryId,
      p_photo_path: photoPath,
      p_min_stock: minStock,
      p_notes: draft.notes.trim() || null,
    });
    if (error) {
      if (uploadedPath) {
        const { error: cleanupError } = await supabase.storage.from('inventory-private').remove([uploadedPath]);
        if (cleanupError) {
          throw new Error(`تعذر حفظ الصنف: ${error.message}. وتعذر حذف الصورة المرفوعة: ${cleanupError.message}`);
        }
      }
      throw error;
    }

    let cleanupNotice = '';
    if (uploadedPath && item?.photo_path?.startsWith('items/')) {
      const { error } = await supabase.storage.from('inventory-private').remove([item.photo_path]);
      if (error) cleanupNotice = ` تم حفظ الصنف، لكن تعذر حذف الصورة السابقة: ${error.message}`;
    }
    await queryClient.invalidateQueries({ queryKey: ['inventory-balances'] });
    return cleanupNotice || (item ? 'تم تحديث الصنف.' : 'تمت إضافة الصنف.');
  }

  async function recordMovement(
    item: InventoryItem,
    type: 'opening' | 'receipt' | 'adjustment',
    quantity: number,
    reason: string,
  ) {
    if (!supabase) throw new Error('إعداد الاتصال بقاعدة البيانات غير مكتمل.');
    const requiredPermission: InventoryPermission = type === 'receipt' ? 'inventory.receive_stock' : 'inventory.adjust';
    if (!permissions.has(requiredPermission)) throw new Error('لا تملك صلاحية تسجيل هذه الحركة.');
    if (type === 'adjustment' && !reason.trim()) throw new Error('سبب التسوية مطلوب.');
    const { error } = await supabase.rpc('record_inventory_movement', {
      p_item_id: item.item_id,
      p_movement_type: type,
      p_quantity: quantity,
      p_reason: reason.trim() || null,
    });
    if (error) throw error;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['inventory-balances'] }),
      queryClient.invalidateQueries({ queryKey: ['inventory-movements', item.item_id] }),
    ]);
  }

  async function submitItemEditor(draft: ItemDraft, photo: File | null, item: InventoryItem | null) {
    setSavingItem(true);
    setNotice('');
    try {
      const result = await saveItem(draft, photo, item);
      setEditorItem(undefined);
      setNotice(result);
    } finally {
      setSavingItem(false);
    }
  }

  async function submitMovement(type: 'opening' | 'receipt' | 'adjustment', quantity: number, reason: string) {
    if (!movementTarget) return;
    setSavingMovement(true);
    setNotice('');
    try {
      await recordMovement(movementTarget.item, type, quantity, reason);
      setMovementTarget(null);
      setNotice(type === 'receipt' ? 'تم تسجيل التوريد.' : type === 'opening' ? 'تم تسجيل الجرد الافتتاحي.' : 'تم تسجيل التسوية.');
    } finally {
      setSavingMovement(false);
    }
  }

  async function saveInventoryImport(rows: InventoryImportRow[]): Promise<ImportSummary> {
    if (!supabase || !canManageItems) throw new Error('لا تملك صلاحية استيراد أصناف المخزون.');
    const validation = validateInventoryImportRows(rows, importMatchItems);
    if (validation.some((entry, index) => !entry.canImport && !rows[index].ignored)) {
      throw new Error('أصلح مشكلات الصفوف أو تجاهلها قبل الحفظ.');
    }

    const importRows = rows.filter((row) => !row.ignored);
    const inventoryItemById = new Map(items.map((item) => [item.item_id, item]));
    const uploadedPaths: string[] = [];
    const rowsForRpc: Array<Record<string, string | number | null>> = [];
    const replacedPhotos: string[] = [];
    try {
      for (const row of importRows) {
        const code = row.logixCode.trim();
        const matches = getInventoryImportMatches(row, importMatchItems);
        const existing = resolveInventoryImportMatch(row, matches);
        const itemId = existing?.id ?? crypto.randomUUID();
        const existingItem = existing ? inventoryItemById.get(existing.id) : undefined;
        const selectedImage = row.images.find((image) => image.id === row.selectedImageId);
        let photoPath: string | null = null;
        if (selectedImage?.blob) {
          photoPath = `items/${itemId}/${crypto.randomUUID()}.webp`;
          const { error } = await supabase.storage.from('inventory-private').upload(photoPath, selectedImage.blob, {
            contentType: 'image/webp',
            upsert: false,
          });
          if (error) throw error;
          uploadedPaths.push(photoPath);
          if (existingItem?.photo_path?.startsWith('items/') && existingItem.photo_path !== photoPath) replacedPhotos.push(existingItem.photo_path);
        }
        rowsForRpc.push({
          item_id: itemId,
          existing_item_id: existing?.id ?? null,
          logix_code: code || null,
          name: row.name.trim(),
          unit: row.unit.trim(),
          category: row.category.trim(),
          notes: row.notes.trim() || null,
          photo_path: photoPath,
          opening_balance: parseOpeningBalance(row) ?? null,
        });
      }

      const { data, error } = await supabase.rpc('import_inventory_items', { p_rows: rowsForRpc });
      if (error) throw error;
      const saved = z.object({ inserted: z.number().int().nonnegative(), updated: z.number().int().nonnegative() }).parse(data);

      let cleanupNotice = '';
      if (replacedPhotos.length) {
        const { error: cleanupError } = await supabase.storage.from('inventory-private').remove([...new Set(replacedPhotos)]);
        if (cleanupError) cleanupNotice = `تعذر حذف بعض الصور السابقة: ${cleanupError.message}`;
      }
      await queryClient.invalidateQueries({ queryKey: ['inventory-balances'] });
      const summary = summarizeInventoryImport(saved.inserted, saved.updated, rows.filter((row) => row.ignored).length);
      setNotice([
        `اكتمل الاستيراد: ${summary.inserted} جديد، ${summary.updated} محدّث، ${summary.ignored} متجاهل.`,
        cleanupNotice,
      ].filter(Boolean).join(' '));
      return summary;
    } catch (error) {
      if (uploadedPaths.length) {
        const { error: cleanupError } = await supabase.storage.from('inventory-private').remove(uploadedPaths);
        if (cleanupError) {
          throw new Error(`تعذر إتمام الاستيراد: ${errorMessage(error)}. وتعذر حذف الصور المرفوعة: ${cleanupError.message}`);
        }
      }
      throw error;
    }
  }

  return (
    <div className="grid gap-5" dir="rtl">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">الأصناف والأرصدة وحركات المستودع</p>
          <h2 className="mt-1 text-2xl font-extrabold text-brand-900">المخزون</h2>
        </div>
        {canManageItems && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setInventoryImportOpen(true)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-brand-700 px-4 py-2 text-sm font-bold text-brand-800 hover:bg-brand-50">
              <FileUp size={18} aria-hidden="true" />
              استيراد من Excel
            </button>
            <button type="button" onClick={() => setEditorItem(null)} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand-700 px-4 py-2 text-sm font-bold text-white hover:bg-brand-800">
              <Plus size={18} aria-hidden="true" />
              إضافة صنف
            </button>
          </div>
        )}
      </header>

      <button
        type="button"
        aria-pressed={shortagesOnly}
        onClick={() => setShortagesFilter(!shortagesOnly)}
        className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-3 text-start transition ${shortagesOnly ? 'border-amber-400 bg-amber-100' : 'border-amber-200 bg-amber-50 hover:border-amber-400'}`}
      >
        <span className="inline-flex items-center gap-2 font-bold text-amber-950">
          <span aria-hidden="true">⚠</span>
          {formatNumber(shortages.out)} صنف نافد · {formatNumber(shortages.low)} منخفض
        </span>
        <span className="text-xs font-semibold text-amber-800">{shortagesOnly ? 'إظهار كل الأصناف' : 'عرض النواقص فقط'}</span>
      </button>

      {notice && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{notice}</p>}

      <section className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[minmax(240px,1fr)_220px_200px_auto] lg:items-end" aria-label="فلاتر الأصناف">
        <label className="grid gap-1 text-sm font-semibold text-slate-700">
          البحث
          <span className="relative">
            <Search size={17} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="اسم الصنف أو كود Logix"
              className="min-h-10 w-full rounded-lg border border-slate-300 py-2 pe-3 ps-10 text-sm"
              aria-label="البحث باسم الصنف أو كود Logix"
            />
          </span>
        </label>
        <label className="grid gap-1 text-sm font-semibold text-slate-700">
          القسم
          <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm">
            <option value="all">كل الأقسام</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold text-slate-700">
          الحالة
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as InventoryStatus | 'all')} className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm">
            <option value="all">كل الحالات</option>
            {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-slate-700">
          <input type="checkbox" checked={shortagesOnly} onChange={(event) => setShortagesFilter(event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-700" />
          النواقص فقط
        </label>
      </section>

      {inventory.isLoading ? (
        <p role="status" className="card p-8 text-center text-slate-500">جارٍ تحميل الأصناف والأرصدة…</p>
      ) : inventory.error ? (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <b>تعذر تحميل بيانات المخزون.</b>
          <p className="mt-1 break-words">{inventory.error.message}</p>
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="card grid justify-items-center gap-2 p-10 text-center">
          <Package size={30} className="text-slate-400" aria-hidden="true" />
          <p className="font-bold text-slate-700">{items.length ? 'لا توجد أصناف تطابق الفلاتر.' : 'لا توجد أصناف مخزون بعد.'}</p>
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm md:block">
            <table className="w-full min-w-[1120px] border-collapse text-sm">
              <thead className="bg-slate-50 text-xs font-bold text-slate-600">
                <tr>
                  {['الصورة', 'الصنف', 'كود Logix', 'الوحدة', 'القسم', 'الرصيد', 'المحجوز', 'المتاح', 'الحالة', 'الحد الأدنى', 'إجراءات'].map((heading) => <th key={heading} scope="col" className="whitespace-nowrap px-3 py-3 text-start">{heading}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleItems.map((item) => (
                  <tr key={item.item_id} className="hover:bg-slate-50/70">
                    <td className="px-3 py-2"><ItemPhoto item={item} onPreview={setPreviewUrl} /></td>
                    <th scope="row" className="px-3 py-2 text-start font-semibold text-slate-800">
                      {item.name}
                      {!item.is_active && <span className="ms-2 text-xs font-normal text-slate-500">غير نشط</span>}
                    </th>
                    <td className="px-3 py-2">{item.logix_code
                      ? <span className="inline-flex flex-wrap items-center gap-1">
                        <bdi dir="ltr" className="font-mono text-slate-700">{item.logix_code}</bdi>
                        {duplicateLogixCodes.has(normalizeInventoryImportText(item.logix_code)) && <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-900">كود مكرر</span>}
                      </span>
                      : <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">بلا كود</span>}</td>
                    <td className="px-3 py-2">{item.unit}</td>
                    <td className="px-3 py-2">{item.category_name}</td>
                    <td className="px-3 py-2 font-semibold">{formatQuantity(item.balance, formatNumber)}</td>
                    <td className="px-3 py-2">{formatNumber(item.reserved)}</td>
                    <td className="px-3 py-2 font-semibold">{formatQuantity(item.available, formatNumber)}</td>
                    <td className="px-3 py-2"><StatusBadge status={item.status} /></td>
                    <td className="px-3 py-2">{formatQuantity(item.min_stock, formatNumber)}</td>
                    <td className="px-3 py-2"><ItemActions
                      item={item}
                      canManageItems={canManageItems}
                      canReceive={canReceive}
                      canAdjust={canAdjust}
                      onDetails={setDetailsItem}
                      onEdit={setEditorItem}
                      onMovement={(target, type) => setMovementTarget({ item: target, type })}
                    /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 md:hidden">
            {visibleItems.map((item) => (
              <article key={item.item_id} className="card grid gap-3 p-4">
                <div className="flex min-w-0 items-start gap-3">
                  <ItemPhoto item={item} onPreview={setPreviewUrl} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-bold text-brand-900">{item.name}</h3>
                      <StatusBadge status={item.status} />
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{item.category_name} · {item.unit}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                      {item.logix_code ? <bdi dir="ltr" className="font-mono">{item.logix_code}</bdi> : <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold">بلا كود</span>}
                      {item.logix_code && duplicateLogixCodes.has(normalizeInventoryImportText(item.logix_code)) && <span className="rounded-full bg-amber-100 px-2 py-1 font-bold text-amber-900">كود مكرر</span>}
                    </p>
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg bg-slate-50 p-3 text-sm">
                  <Metric label="الرصيد" value={formatQuantity(item.balance, formatNumber)} />
                  <Metric label="المحجوز" value={formatNumber(item.reserved)} />
                  <Metric label="المتاح" value={formatQuantity(item.available, formatNumber)} />
                  <Metric label="الحد الأدنى" value={formatQuantity(item.min_stock, formatNumber)} />
                </dl>
                <ItemActions
                  item={item}
                  canManageItems={canManageItems}
                  canReceive={canReceive}
                  canAdjust={canAdjust}
                  onDetails={setDetailsItem}
                  onEdit={setEditorItem}
                  onMovement={(target, type) => setMovementTarget({ item: target, type })}
                />
              </article>
            ))}
          </div>
        </>
      )}

      {editorItem !== undefined && (
        <ItemEditorDialog
          key={editorItem?.item_id ?? 'new'}
          item={editorItem}
          categories={categories}
          busy={savingItem}
          onClose={() => setEditorItem(undefined)}
          onSave={submitItemEditor}
        />
      )}
      {movementTarget && (
        <MovementDialog
          key={`${movementTarget.item.item_id}-${movementTarget.type}`}
          item={movementTarget.item}
          type={movementTarget.type}
          busy={savingMovement}
          onClose={() => setMovementTarget(null)}
          onSubmit={submitMovement}
        />
      )}
      {detailsItem && (
        <ItemDetailsDialog
          item={detailsItem}
          movements={movements.data ?? []}
          loading={movements.isLoading}
          error={movements.error ? errorMessage(movements.error) : null}
          formatNumber={formatNumber}
          formatDateTime={formatDateTime}
          onClose={() => setDetailsItem(null)}
        />
      )}
      {previewUrl && <ImagePreviewDialog src={previewUrl} onClose={() => setPreviewUrl(null)} />}
      {inventoryImportOpen && (
        <InventoryImportDialog
          busy={savingImport}
          existingItems={importMatchItems}
          onClose={() => setInventoryImportOpen(false)}
          onImport={async (rows) => {
            setSavingImport(true);
            try {
              return await saveInventoryImport(rows);
            } finally {
              setSavingImport(false);
            }
          }}
        />
      )}
    </div>
  );
}

function ItemPhoto({ item, onPreview }: { item: InventoryItem; onPreview: (url: string) => void }) {
  return item.photo_url
    ? <button type="button" onClick={() => onPreview(item.photo_url!)} className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-lg border border-slate-200 bg-white" aria-label={`تكبير صورة ${item.name}`}>
      <img src={item.photo_url} alt="" className="h-full w-full object-cover" />
    </button>
    : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-slate-400" aria-label="لا توجد صورة">
      <ImageIcon size={20} aria-hidden="true" />
    </span>;
}

function StatusBadge({ status }: { status: InventoryStatus }) {
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${statusStyles[status]}`}>{statusLabels[status]}</span>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-0.5 font-bold text-slate-800">{value}</dd></div>;
}

function ItemActions({
  item, canManageItems, canReceive, canAdjust, onDetails, onEdit, onMovement,
}: {
  item: InventoryItem;
  canManageItems: boolean;
  canReceive: boolean;
  canAdjust: boolean;
  onDetails: (item: InventoryItem) => void;
  onEdit: (item: InventoryItem) => void;
  onMovement: (item: InventoryItem, type: 'opening' | 'receipt' | 'adjustment') => void;
}) {
  return <div className="flex flex-wrap items-center gap-1.5">
    <button type="button" onClick={() => onDetails(item)} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
      <History size={15} aria-hidden="true" />الحركات
    </button>
    {canManageItems && <button type="button" onClick={() => onEdit(item)} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
      <Pencil size={14} aria-hidden="true" />تعديل
    </button>}
    {canReceive && item.status !== 'uncounted' && <button type="button" onClick={() => onMovement(item, 'receipt')} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-emerald-200 px-2.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-50">
      <ArrowDownToLine size={14} aria-hidden="true" />توريد
    </button>}
    {canAdjust && <button type="button" onClick={() => onMovement(item, item.status === 'uncounted' ? 'opening' : 'adjustment')} className="min-h-9 rounded-lg border border-amber-200 px-2.5 text-xs font-semibold text-amber-800 hover:bg-amber-50">
      {item.status === 'uncounted' ? 'جرد افتتاحي' : 'تسوية'}
    </button>}
  </div>;
}

function Dialog({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return <div className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-slate-950/50 p-3 sm:p-5" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section role="dialog" aria-modal="true" aria-label={title} className={`my-auto max-h-[calc(100dvh-1.5rem)] w-full overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl sm:p-6 ${wide ? 'max-w-5xl' : 'max-w-xl'}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-lg font-extrabold text-brand-900">{title}</h3>
        <button type="button" aria-label="إغلاق" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"><X size={19} /></button>
      </div>
      {children}
    </section>
  </div>;
}

function InventoryImportDialog({
  busy, existingItems, onClose, onImport,
}: {
  busy: boolean;
  existingItems: ExistingInventoryItem[];
  onClose: () => void;
  onImport: (rows: InventoryImportRow[]) => Promise<ImportSummary>;
}) {
  const [rows, setRows] = useState<InventoryImportRow[]>([]);
  const [error, setError] = useState('');
  const [loadingFile, setLoadingFile] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [imagesUnavailable, setImagesUnavailable] = useState(false);
  const [continueWithoutImages, setContinueWithoutImages] = useState(false);
  const previewUrls = useRef<string[]>([]);
  const loadToken = useRef(0);
  const validation = useMemo(() => validateInventoryImportRows(rows, existingItems), [rows, existingItems]);
  const readyCount = validation.filter((entry) => entry.canImport).length;
  const ignoredCount = rows.filter((row) => row.ignored).length;
  const blockedRows = rows.flatMap((row, index) => !row.ignored && !validation[index].canImport
    ? [{ rowNumber: row.rowNumber, reasons: getInventoryImportRowMessages(row, validation[index], true) }]
    : []);

  useEffect(() => () => {
    loadToken.current += 1;
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  function releaseCurrentPreviews() {
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
    previewUrls.current = [];
  }

  async function loadFile(file: File | undefined) {
    if (!file) return;
    const token = ++loadToken.current;
    releaseCurrentPreviews();
    setRows([]);
    setSummary(null);
    setImagesUnavailable(false);
    setContinueWithoutImages(false);
    setError('');
    setLoadingFile(true);
    try {
      const parsedWorkbook = await parseInventoryWorkbook(file);
      if (token !== loadToken.current) {
        parsedWorkbook.rows.flatMap((row) => row.images.map((image) => image.previewUrl).filter((url): url is string => Boolean(url)))
          .forEach((url) => URL.revokeObjectURL(url));
        return;
      }
      previewUrls.current = parsedWorkbook.rows.flatMap((row) => row.images.map((image) => image.previewUrl).filter((url): url is string => Boolean(url)));
      setRows(parsedWorkbook.rows);
      setImagesUnavailable(parsedWorkbook.imagesUnavailable);
    } catch (reason) {
      if (token === loadToken.current) setError(errorMessage(reason));
    } finally {
      if (token === loadToken.current) setLoadingFile(false);
    }
  }

  function updateRow(index: number, patch: Partial<InventoryImportRow>) {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  }

  async function save() {
    setError('');
    if (imagesUnavailable && !continueWithoutImages) {
      setError('أكد المتابعة بدون الصور المضمنة أو أعد حفظ الملف في Excel ثم اختره مجددًا.');
      return;
    }
    const invalidRows = validation.some((entry, index) => !entry.canImport && !rows[index].ignored);
    if (invalidRows) {
      setError('أصلح مشكلات الصفوف أو تجاهل الصفوف غير الصالحة قبل الحفظ.');
      return;
    }
    if (readyCount === 0) {
      setSummary({ inserted: 0, updated: 0, ignored: ignoredCount });
      return;
    }
    try {
      setSummary(await onImport(rows));
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  if (summary) {
    return <Dialog title="اكتمل استيراد الأصناف" onClose={onClose}>
      <div className="grid gap-4">
        {imagesUnavailable && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">تم الاستيراد بدون الصور المضمنة بناءً على تأكيدك.</p>}
        <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 font-semibold text-emerald-900">
          {summary.inserted} صنف جديد · {summary.updated} محدّث · {summary.ignored} متجاهل
        </p>
        <button type="button" onClick={onClose} className="min-h-10 rounded-lg bg-brand-700 px-4 text-sm font-bold text-white">إغلاق</button>
      </div>
    </Dialog>;
  }

  return <Dialog title="استيراد أصناف من Excel" onClose={busy ? () => undefined : onClose} wide>
    <div className="grid gap-4">
      <p className="text-sm leading-6 text-slate-600">
        اختر ملف .xlsx. ستتم مطابقة الأصناف ذات كود Logix، وتُسجل حركة افتتاحية فقط عندما يحتوي الرصيد على رقم؛ الرصيد الفارغ يبقى غير مُجرد.
      </p>
      <label className="grid gap-1 text-sm font-semibold text-slate-700">
        ملف Excel
        <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          void loadFile(file);
        }} className="block w-full text-sm file:me-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:font-semibold" disabled={busy || loadingFile} />
      </label>
      {loadingFile && <p role="status" className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">جارٍ قراءة الأصناف واستخراج الصور…</p>}
      {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      {imagesUnavailable && <div role="alert" className="grid gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
        <p>تعذر فكّ أحد رسومات الملف. أُزيلت الصور المضمنة من المعاينة؛ أعد حفظ الملف في Excel لإعادة المحاولة، أو أكّد المتابعة بدون صور.</p>
        <label className="inline-flex items-start gap-2 font-semibold">
          <input type="checkbox" checked={continueWithoutImages} onChange={(event) => setContinueWithoutImages(event.target.checked)} disabled={busy} className="mt-0.5 h-4 w-4 rounded border-amber-400" />
          أتابع الاستيراد بدون صور
        </label>
      </div>}
      {rows.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-3 text-sm">
            <b>{rows.length} صفًا · {readyCount} جاهز للحفظ · {blockedRows.length} يحتاج معالجة · {ignoredCount} متجاهل</b>
            <span className="text-slate-600">صحّح الحقول أو تجاهل الصف قبل المتابعة.</span>
          </div>
          {blockedRows.length > 0 && <div role="alert" className="grid gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
            <b>الحفظ متوقف بسبب الصفوف التالية (كود Logix المفقود أو المكرر لا يوقف الحفظ):</b>
            <div className="flex flex-wrap gap-2">
              {blockedRows.map(({ rowNumber, reasons }) => <button
                key={rowNumber}
                type="button"
                onClick={() => document.getElementById(`inventory-import-row-${rowNumber}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                className="rounded-md border border-rose-300 bg-white px-2 py-1 text-start text-xs font-semibold hover:bg-rose-100"
              >
                صف {rowNumber}: {reasons.join('، ')}
              </button>)}
            </div>
          </div>}
          <div className="grid max-h-[52vh] gap-3 overflow-y-auto pe-1">
            {rows.map((row, index) => {
              const issues = validation[index];
              const messages = getInventoryImportRowMessages(row, issues);
              return <article id={`inventory-import-row-${row.rowNumber}`} key={row.rowNumber} className={`grid gap-3 rounded-xl border p-3 ${row.ignored ? 'border-slate-200 bg-slate-50 opacity-70' : messages.length ? 'border-amber-200 bg-amber-50/40' : 'border-slate-200'}`}>
                <header className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <b>صف Excel {row.rowNumber}</b>
                    <p className="mt-1 text-xs text-amber-800">{row.ignored ? 'سيتم تجاهل هذا الصف' : messages.length ? messages.join(' · ') : 'جاهز للاستيراد'}</p>
                  </div>
                  <label className="inline-flex min-h-8 shrink-0 items-center gap-2 text-xs font-semibold text-slate-700">
                    <input type="checkbox" checked={row.ignored} onChange={(event) => updateRow(index, { ignored: event.target.checked })} disabled={busy} className="h-4 w-4 rounded border-slate-300" />
                    تجاهل الصف
                  </label>
                </header>
                {!row.ignored && <>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <label className="grid gap-1 text-xs font-semibold text-slate-700">الصنف
                      <input value={row.name} onChange={(event) => updateRow(index, { name: event.target.value })} disabled={busy} className="min-h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm" />
                    </label>
                    <label className="grid gap-1 text-xs font-semibold text-slate-700">كود Logix
                      <input value={row.logixCode} onChange={(event) => updateRow(index, { logixCode: event.target.value })} disabled={busy} dir="ltr" className="min-h-9 rounded-lg border border-slate-300 bg-white px-2 text-start text-sm" />
                    </label>
                    <label className="grid gap-1 text-xs font-semibold text-slate-700">الوحدة
                      <input value={row.unit} onChange={(event) => updateRow(index, { unit: event.target.value })} disabled={busy} className="min-h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm" />
                    </label>
                    <label className="grid gap-1 text-xs font-semibold text-slate-700">القسم
                      <input value={row.category} onChange={(event) => updateRow(index, { category: event.target.value })} disabled={busy} className="min-h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm" />
                    </label>
                    <label className="grid gap-1 text-xs font-semibold text-slate-700">الرصيد (اتركه فارغًا لغير مُجرد)
                      <input inputMode="decimal" value={row.balanceText} onChange={(event) => updateRow(index, { balanceText: event.target.value, balanceState: 'edited' })} disabled={busy} dir="ltr" className="min-h-9 rounded-lg border border-slate-300 bg-white px-2 text-start text-sm" />
                    </label>
                    <label className="grid gap-1 text-xs font-semibold text-slate-700 sm:col-span-2">ملاحظات
                      <input value={row.notes} onChange={(event) => updateRow(index, { notes: event.target.value })} disabled={busy} className="min-h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm" />
                    </label>
                  </div>
                  {issues.missingCode && <p className="text-xs font-semibold text-amber-900">كود Logix مفقود؛ سيُستورد الصنف بلا كود.</p>}
                  {(() => {
                    const matches = getInventoryImportMatches(row, existingItems);
                    if (matches.length < 2) return null;
                    return <div className="grid gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <p className="text-xs font-semibold text-amber-950">
                        عُثر على {matches.length} أصناف مطابقة بالاسم والكود؛ اختر سجلًا للتحديث أو اترك الاختيار فارغًا لإضافة صنف جديد.
                      </p>
                      <select
                        value={row.matchAsNew ? '__new__' : row.existingMatchId ?? ''}
                        onChange={(event) => updateRow(index, {
                          existingMatchId: event.target.value && event.target.value !== '__new__' ? event.target.value : null,
                          matchAsNew: event.target.value === '__new__',
                        })}
                        disabled={busy}
                        className="min-h-10 rounded-lg border border-amber-300 bg-white px-3 text-sm"
                        aria-label={`اختيار الصنف المطابق لصف Excel ${row.rowNumber}`}
                      >
                        <option value="">اختر الصنف المطابق</option>
                        {matches.map((item) => <option key={item.id} value={item.id}>
                          {item.name} · {item.categoryName} · {item.logixCode || 'بلا كود'} · {item.id.slice(0, 8)}
                        </option>)}
                        <option value="__new__">إضافة كصنف جديد</option>
                      </select>
                    </div>;
                  })()}
                  {issues.misspelledCategory && <button type="button" onClick={() => updateRow(index, { category: 'سباكة' })} disabled={busy} className="w-fit rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-bold text-amber-900">تصحيح «سبكة» إلى «سباكة»</button>}
                  {row.valueErrors.length > 0 && <div className="grid gap-1 text-xs text-rose-800">
                    <b>خلايا Excel التي تحتوي أخطاء:</b>
                    <span>{row.valueErrors.join('، ')}</span>
                    <label className="inline-flex items-center gap-2 font-semibold">
                      <input type="checkbox" checked={row.ignoreValueErrors} onChange={(event) => updateRow(index, { ignoreValueErrors: event.target.checked })} disabled={busy} className="h-4 w-4 rounded border-slate-300" />
                      تجاهل قيم الخلايا الخاطئة في هذا الصف
                    </label>
                  </div>}
                  {row.images.length > 0 && <div className="grid gap-2">
                    <b className="text-xs text-slate-700">صور الصف</b>
                    <div className="flex flex-wrap gap-2">
                      {row.images.map((image) => <label key={image.id} className={`inline-flex items-center gap-2 rounded-lg border bg-white p-2 text-xs ${row.selectedImageId === image.id ? 'border-brand-600' : 'border-slate-200'}`}>
                        {image.previewUrl
                          ? <img src={image.previewUrl} alt="" className="h-12 w-12 rounded object-contain" />
                          : <span className="grid h-12 w-12 place-items-center rounded bg-slate-100 text-rose-700">تعذر</span>}
                        {row.images.length > 1 && image.previewUrl && <input type="radio" name={`inventory-import-image-${row.rowNumber}`} checked={row.selectedImageId === image.id} onChange={() => updateRow(index, { selectedImageId: image.id })} disabled={busy} aria-label={`اختيار الصورة ${image.id}`} />}
                        {image.error && <span className="max-w-36 text-rose-700">{image.error}</span>}
                      </label>)}
                    </div>
                    {issues.unreadableImages && <label className="inline-flex items-center gap-2 text-xs font-semibold text-amber-900">
                      <input type="checkbox" checked={row.skipUnreadableImages} onChange={(event) => updateRow(index, { skipUnreadableImages: event.target.checked })} disabled={busy} className="h-4 w-4 rounded border-slate-300" />
                      متابعة الصف بدون الصور التي تعذر قراءتها
                    </label>}
                  </div>}
                </>}
              </article>;
            })}
          </div>
        </>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} disabled={busy} className="min-h-10 rounded-lg border border-slate-300 px-4 text-sm font-semibold disabled:opacity-50">إلغاء</button>
        {rows.length > 0 && <button type="button" onClick={() => void save()} disabled={busy || loadingFile || (imagesUnavailable && !continueWithoutImages) || validation.some((entry, index) => !entry.canImport && !rows[index].ignored)} className="min-h-10 rounded-lg bg-brand-700 px-4 text-sm font-bold text-white disabled:opacity-50">
          {busy ? 'جارٍ الحفظ…' : `حفظ ${readyCount} صنف`}
        </button>}
      </div>
    </div>
  </Dialog>;
}

function ItemEditorDialog({
  item, categories, busy, onClose, onSave,
}: {
  item: InventoryItem | null;
  categories: InventoryCategory[];
  busy: boolean;
  onClose: () => void;
  onSave: (draft: ItemDraft, photo: File | null, item: InventoryItem | null) => Promise<void>;
}) {
  const [draft, setDraft] = useState<ItemDraft>({
    name: item?.name ?? '',
    logixCode: item?.logix_code ?? '',
    unit: item?.unit ?? '',
    categoryId: item?.category_id ?? categories[0]?.id ?? '',
    notes: item?.notes ?? '',
    minStock: item?.min_stock === null || item?.min_stock === undefined ? '' : String(item.min_stock),
  });
  const [photo, setPhoto] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [busyLocal, setBusyLocal] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusyLocal(true);
    try {
      await onSave(draft, photo, item);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyLocal(false);
    }
  }

  return <Dialog title={item ? 'تعديل صنف' : 'إضافة صنف'} onClose={onClose}>
    <form className="grid gap-3" onSubmit={(event) => void submit(event)}>
      <label className="grid gap-1 text-sm font-semibold text-slate-700">اسم الصنف
        <input required value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} className="min-h-10 rounded-lg border border-slate-300 px-3" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold text-slate-700">كود Logix <span className="font-normal text-slate-500">اختياري؛ سيظهر الصنف «بلا كود» إذا تُرك فارغًا.</span>
          <input value={draft.logixCode} onChange={(event) => setDraft((current) => ({ ...current, logixCode: event.target.value }))} dir="ltr" className="min-h-10 rounded-lg border border-slate-300 px-3 text-start" />
        </label>
        <label className="grid gap-1 text-sm font-semibold text-slate-700">الوحدة
          <input required value={draft.unit} onChange={(event) => setDraft((current) => ({ ...current, unit: event.target.value }))} placeholder="قطعة، علبة…" className="min-h-10 rounded-lg border border-slate-300 px-3" />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold text-slate-700">القسم
          <select required value={draft.categoryId} onChange={(event) => setDraft((current) => ({ ...current, categoryId: event.target.value }))} className="min-h-10 rounded-lg border border-slate-300 px-3" disabled={!categories.length}>
            {categories.length ? categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>) : <option value="">لا توجد أقسام متاحة</option>}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold text-slate-700">الحد الأدنى
          <input type="number" min="0" step="any" value={draft.minStock} onChange={(event) => setDraft((current) => ({ ...current, minStock: event.target.value }))} className="min-h-10 rounded-lg border border-slate-300 px-3" />
        </label>
      </div>
      <label className="grid gap-1 text-sm font-semibold text-slate-700">الصورة
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setPhoto(event.target.files?.[0] ?? null)} className="block w-full text-sm file:me-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:font-semibold" />
      </label>
      <label className="grid gap-1 text-sm font-semibold text-slate-700">ملاحظات
        <textarea rows={2} value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} className="rounded-lg border border-slate-300 p-3" />
      </label>
      {item?.photo_url && !photo && <img src={item.photo_url} alt={`صورة ${item.name}`} className="h-20 w-20 rounded-lg border border-slate-200 object-cover" />}
      {!categories.length && <p className="text-xs text-amber-800">أضف قسمًا للمخزون قبل إنشاء الأصناف.</p>}
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      <div className="mt-2 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} className="min-h-10 rounded-lg border border-slate-300 px-4 text-sm font-semibold">إلغاء</button>
        <button type="submit" disabled={busy || busyLocal || !categories.length} className="min-h-10 rounded-lg bg-brand-700 px-4 text-sm font-bold text-white disabled:opacity-50">
          {busy || busyLocal ? 'جارٍ الحفظ…' : 'حفظ الصنف'}
        </button>
      </div>
    </form>
  </Dialog>;
}

function MovementDialog({
  item, type, busy, onClose, onSubmit,
}: {
  item: InventoryItem;
  type: 'opening' | 'receipt' | 'adjustment';
  busy: boolean;
  onClose: () => void;
  onSubmit: (type: 'opening' | 'receipt' | 'adjustment', quantity: number, reason: string) => Promise<void>;
}) {
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busyLocal, setBusyLocal] = useState(false);
  const title = type === 'opening' ? 'الجرد الافتتاحي' : type === 'receipt' ? 'تسجيل توريد' : 'تسوية رصيد';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const amount = Number(quantity);
    if (!Number.isFinite(amount) || (type === 'opening' ? amount < 0 : type === 'receipt' ? amount <= 0 : amount === 0)) {
      setError(type === 'opening' ? 'أدخل رصيدًا افتتاحيًا غير سالب.' : 'أدخل كمية غير صفرية بالإشارة المناسبة.');
      return;
    }
    if (type === 'adjustment' && !reason.trim()) {
      setError('سبب التسوية مطلوب.');
      return;
    }
    setBusyLocal(true);
    try {
      await onSubmit(type, amount, reason);
    } catch (reasonValue) {
      setError(errorMessage(reasonValue));
    } finally {
      setBusyLocal(false);
    }
  }

  return <Dialog title={title} onClose={onClose}>
    <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
      <p className="text-sm text-slate-600">{item.name} · {item.unit}</p>
      <label className="grid gap-1 text-sm font-semibold text-slate-700">
        {type === 'opening' ? 'الرصيد الفعلي عند الجرد' : type === 'receipt' ? 'كمية التوريد' : 'فرق التسوية (+/-)'}
        <input type="number" step="any" min={type === 'opening' || type === 'receipt' ? 0 : undefined} value={quantity} onChange={(event) => setQuantity(event.target.value)} required className="min-h-11 rounded-lg border border-slate-300 px-3" />
      </label>
      <label className="grid gap-1 text-sm font-semibold text-slate-700">
        {type === 'adjustment' ? 'سبب التسوية (إلزامي)' : 'ملاحظة (اختيارية)'}
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} required={type === 'adjustment'} rows={3} className="rounded-lg border border-slate-300 p-3" />
      </label>
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="min-h-10 rounded-lg border border-slate-300 px-4 text-sm font-semibold">إلغاء</button>
        <button type="submit" disabled={busy || busyLocal} className="min-h-10 rounded-lg bg-brand-700 px-4 text-sm font-bold text-white disabled:opacity-50">{busy || busyLocal ? 'جارٍ التسجيل…' : 'تسجيل الحركة'}</button>
      </div>
    </form>
  </Dialog>;
}

function ItemDetailsDialog({
  item, movements, loading, error, formatNumber, formatDateTime, onClose,
}: {
  item: InventoryItem;
  movements: InventoryMovement[];
  loading: boolean;
  error: string | null;
  formatNumber: (value: number) => string;
  formatDateTime: (value: string) => string;
  onClose: () => void;
}) {
  return <Dialog title={`حركات ${item.name}`} onClose={onClose} wide>
    <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg bg-slate-50 p-3 text-sm">
      <span>الرصيد: <b>{formatQuantity(item.balance, formatNumber)}</b></span>
      <span>المحجوز: <b>{formatNumber(item.reserved)}</b></span>
      <span>المتاح: <b>{formatQuantity(item.available, formatNumber)}</b></span>
      <StatusBadge status={item.status} />
    </div>
    {loading ? <p role="status" className="py-8 text-center text-sm text-slate-500">جارٍ تحميل سجل الحركات…</p>
      : error ? <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>
        : movements.length ? (
          <div className="max-h-[60vh] overflow-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[600px] text-sm">
              <thead className="sticky top-0 bg-slate-50 text-xs text-slate-600">
                <tr><th className="px-3 py-2 text-start">الوقت</th><th className="px-3 py-2 text-start">الحركة</th><th className="px-3 py-2 text-start">الكمية</th><th className="px-3 py-2 text-start">السبب / الطلب</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {movements.map((movement) => <tr key={movement.id}>
                  <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(movement.created_at)}</td>
                  <td className="px-3 py-2">{movementLabels[movement.movement_type]}</td>
                  <td className="px-3 py-2 font-bold"><bdi dir="ltr">{formatNumber(movement.quantity)}</bdi></td>
                  <td className="px-3 py-2">{movement.reason ?? (movement.request_id ? `طلب ${movement.request_id.slice(0, 8)}` : '—')}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
        ) : <p className="py-8 text-center text-sm text-slate-500">لا توجد حركات مسجلة لهذا الصنف.</p>}
  </Dialog>;
}

function ImagePreviewDialog({ src, onClose }: { src: string; onClose: () => void }) {
  return <Dialog title="صورة الصنف" onClose={onClose} wide>
    <img src={src} alt="صورة الصنف" className="mx-auto max-h-[75vh] max-w-full rounded-lg object-contain" />
    <button type="button" onClick={onClose} className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-4 text-sm font-semibold">
      <ZoomIn size={16} aria-hidden="true" />إغلاق الصورة
    </button>
  </Dialog>;
}

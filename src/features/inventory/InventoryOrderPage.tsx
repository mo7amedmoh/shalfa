import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { z } from 'zod';
import { usePermission } from '../../app/permissionContext';
import { supabase } from '../../lib/supabase';
import {
  createInventoryOrderRows,
  formatInventoryOrderDate,
  isApprovedInventoryOrder,
  type InventoryOrderLine,
  type InventoryOrderStatus,
} from './inventoryOrderModel';

const orderLineSchema = z.object({
  logixCode: z.string().nullable(),
  name: z.string(),
  unit: z.string(),
  quantity: z.number(),
  note: z.string().nullable(),
});
const orderDetailsSchema = z.object({
  orderDate: z.string(),
  schoolName: z.string(),
  supervisorName: z.string(),
  engineerName: z.string(),
  stampPath: z.string().nullable(),
  items: z.array(orderLineSchema),
});
const orderPayloadSchema = z.object({
  requestId: z.string().uuid(),
  number: z.string(),
  status: z.enum(['draft', 'submitted', 'approved', 'rejected', 'issued', 'partially_issued', 'cancelled']),
  receiverName: z.string().nullable(),
  snapshot: orderDetailsSchema.nullable(),
  preview: orderDetailsSchema.nullable(),
});

type OrderPayload = z.infer<typeof orderPayloadSchema>;
type OrderDetails = z.infer<typeof orderDetailsSchema>;

const fixtureItems = [
  ['14218', 'دهان جدران أبيض', 'جالون', 2],
  ['11108', 'تيب دهان', 'حبة', 12],
  ['2273', 'فريون R-410 هانيويل', 'اسطوانة', 2],
  ['3696', 'محبس زاوية', 'حبة', 10],
  ['13553', 'شطاف كامل', 'حبة', 15],
  ['14049', 'لي سخان 80 سم', 'حبة', 10],
  ['2671', 'فيش ثلاثي 13 امبير', 'حبة', 10],
  ['2672', 'مفتاح مكيف 7*7', 'حبة', 20],
  ['9428', 'مروحة شفط بلاستيك 30*30', 'حبة', 3],
  ['11093', 'تلوين دهان ألوان', 'حبة', 6],
  ['5676', 'خلاط مغسلة', 'حبة', 5],
  ['1573', 'لمبة ليد 120 وات', 'حبة', 80],
  ['0', 'لمبة قالوظ 9 وات', '', 6],
  ['7868', 'كشاف خارجي 200 وات الرائد', 'حبة', 4],
  ['4870', 'كلبسات 12مم', 'حبة', 15],
  ['4203', 'رولة دهان كبير', 'حبة', 3],
  ['10167', 'رولة دهان صغير كاملة', 'حبة', 3],
  ['10162', 'فرشة دهان 2 بوصة', 'حبة', 5],
  ['11106', 'تيب كهرباء', 'حبة', 5],
  ['5839', 'تيب سباكة', 'حبة', 5],
  ['10163', 'فرشة دهان 4 بوصة', 'حبة', 5],
] as const;

const fixtureStamp = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22240%22 height=%22100%22 viewBox=%220 0 240 100%22%3E%3Cpath d=%22M8 68c36-24 36 8 68-7s46 8 67-12 42 13 86-19%22 fill=%22none%22 stroke=%22%231e3a8a%22 stroke-width=%224%22 stroke-linecap=%22round%22/%3E%3Ctext x=%22120%22 y=%2290%22 text-anchor=%22middle%22 font-size=%2216%22 fill=%22%231e3a8a%22%3E%D8%B9%D8%A8%D8%AF%D8%A7%D9%84%D9%84%D9%87%20%D8%A7%D9%84%D8%B3%D9%8A%D8%AF%20%D8%B1%D8%A7%D8%B6%D9%8A%3C/text%3E%3C/svg%3E';

async function loadInventoryOrder(requestId: string): Promise<{ payload: OrderPayload; stampUrl: string | null }> {
  if (!supabase) throw new Error('إعداد الاتصال بقاعدة البيانات غير مكتمل.');
  const { data, error } = await supabase.rpc('load_inventory_export_order', { p_request_id: requestId });
  if (error) throw error;
  const payload = orderPayloadSchema.parse(data);
  const approved = isApprovedInventoryOrder(payload.status);
  const details = approved ? payload.snapshot : payload.preview;
  if (!details) {
    throw new Error(approved
      ? 'لا توجد نسخة محفوظة لأمر الصرف لهذا الطلب. لا يمكن إنشاء نموذج غير مطابق لبيانات الاعتماد.'
      : 'تعذر تحميل بيانات معاينة المسودة.');
  }
  let stampUrl: string | null = null;
  if (approved) {
    if (!details.stampPath) throw new Error('نسخة الاعتماد المحفوظة لا تتضمن ختم المهندس.');
    const { data: signed, error: signedError } = await supabase.storage
      .from('inventory-private')
      .createSignedUrl(details.stampPath, 600);
    if (signedError) throw signedError;
    stampUrl = signed.signedUrl;
  }
  return { payload, stampUrl };
}

function InventoryOrderSheet({
  number,
  status,
  receiverName,
  details,
  stampUrl,
}: {
  number: string;
  status: InventoryOrderStatus;
  receiverName: string | null;
  details: OrderDetails;
  stampUrl: string | null;
}) {
  const approved = isApprovedInventoryOrder(status);
  const lines: InventoryOrderLine[] = details.items;
  const rows = createInventoryOrderRows(lines);
  return (
    <article className={`inventory-order-sheet${approved ? '' : ' inventory-order-sheet--draft'}`} dir="rtl">
      {!approved && <div className="inventory-order-watermark" aria-hidden="true">مسودة</div>}
      <header className="inventory-order-header">
        <div className="inventory-order-logos" dir="ltr">
          <img className="inventory-order-tbc-logo" src="/brand/logo-tbc.png" alt="TBC" />
          <img className="inventory-order-shalfa-logo" src="/brand/logo.png" alt="شلفا" />
        </div>
        <h1>نموذج طلب صرف مواد قطع غيار من مستودع السلي</h1>
      </header>

      <div className="inventory-order-identifiers">
        <p><strong>التاريخ /</strong> <bdi dir="ltr">{formatInventoryOrderDate(details.orderDate)}</bdi></p>
        <p><strong>الرقم:</strong> <bdi dir="ltr">{number}</bdi></p>
      </div>

      <section className="inventory-order-parties">
        <div className="inventory-order-parties-right">
          <p className="inventory-order-warehouse">الأستاذ / امين المستودع</p>
          <p><strong>امل صرف الاتي للمشرف</strong> {details.supervisorName}</p>
        </div>
        <div className="inventory-order-parties-left">
          <p><strong>مشروع :</strong> TBC</p>
          <p><strong>مدرسة:</strong> {details.schoolName}</p>
        </div>
      </section>

      <h2 className="inventory-order-section-title">طلب مواد صيانة</h2>
      <table className="inventory-order-table">
        <colgroup>
          <col className="inventory-order-col-number" />
          <col className="inventory-order-col-code" />
          <col className="inventory-order-col-name" />
          <col className="inventory-order-col-unit" />
          <col className="inventory-order-col-quantity" />
          <col className="inventory-order-col-note" />
        </colgroup>
        <thead>
          <tr>
            <th>م</th>
            <th>الكود</th>
            <th>اسم الصنف</th>
            <th>الوحدة</th>
            <th>العدد</th>
            <th>ملاحظات</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td><bdi dir="ltr">{row.number}</bdi></td>
              <td><bdi dir="ltr">{row.logixCode}</bdi></td>
              <td className="inventory-order-item-name">{row.name}</td>
              <td>{row.unit}</td>
              <td><bdi dir="ltr">{row.quantity}</bdi></td>
              <td>{row.note}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <footer className="inventory-order-footer">
        <p className="inventory-order-thanks">ولكم جزيل الشكر</p>
        <div className="inventory-order-signatures">
          <p className="inventory-order-receiver"><strong>المستلم /</strong> {receiverName ?? ''}</p>
          <div className="inventory-order-engineer">
            <strong>مسؤول القسم:</strong>
            {approved && stampUrl && <img src={stampUrl} alt="ختم وتوقيع المهندس عند الاعتماد" />}
            <p><strong>التوقيع /</strong> {approved ? details.engineerName : ''}</p>
          </div>
        </div>
      </footer>
    </article>
  );
}

export function InventoryOrderPage() {
  const canExport = usePermission('inventory.export_order');
  const { requestId } = useParams();
  useEffect(() => {
    document.body.classList.add('inventory-order-print-mode');
    return () => document.body.classList.remove('inventory-order-print-mode');
  }, []);
  const orderQuery = useQuery({
    queryKey: ['inventory-export-order', requestId],
    queryFn: () => loadInventoryOrder(requestId ?? ''),
    enabled: canExport && Boolean(requestId),
    staleTime: 0,
  });
  const order = orderQuery.data;
  const approved = order ? isApprovedInventoryOrder(order.payload.status) : false;
  const details = order ? (approved ? order.payload.snapshot : order.payload.preview) : null;

  if (!canExport) {
    return <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">لا تملك صلاحية تصدير أوامر الصرف.</p>;
  }
  if (!requestId) {
    return <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">معرّف الطلب غير صالح.</p>;
  }

  return (
    <div className="inventory-order-print-root" dir="rtl">
      <div className="inventory-order-actions">
        <button type="button" onClick={() => window.print()} disabled={!details} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand-700 px-4 text-sm font-bold text-white disabled:opacity-50">
          <Printer size={16} aria-hidden="true" />طباعة / حفظ PDF
        </button>
        {details && <span className="text-sm text-slate-500">{approved ? 'نسخة ثابتة من بيانات الاعتماد.' : 'معاينة غير معتمدة؛ لن يظهر ختم المهندس.'}</span>}
      </div>
      {orderQuery.isLoading && <p role="status" className="rounded-lg bg-white p-4 text-sm text-slate-600">جارٍ تحميل أمر الصرف…</p>}
      {orderQuery.error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">تعذر تحميل أمر الصرف: {orderQuery.error instanceof Error ? orderQuery.error.message : 'حدث خطأ غير متوقع.'}</p>}
      {order && details && <InventoryOrderSheet
        number={order.payload.number}
        status={order.payload.status}
        receiverName={order.payload.receiverName}
        details={details}
        stampUrl={order.stampUrl}
      />}
    </div>
  );
}

export function DevInventoryOrderFixture() {
  useEffect(() => {
    document.body.classList.add('inventory-order-print-mode');
    return () => document.body.classList.remove('inventory-order-print-mode');
  }, []);
  const items = useMemo(() => fixtureItems.map(([logixCode, name, unit, quantity]) => ({
    logixCode,
    name,
    unit,
    quantity,
    note: null,
  })), []);
  const details: OrderDetails = {
    orderDate: '2026-11-22T12:00:00+03:00',
    schoolName: 'الروضة الثامنة 8',
    supervisorName: 'عماد الدكش',
    engineerName: 'عبدالله السيد راضي',
    stampPath: 'fixture/stamp.png',
    items,
  };
  return <main className="inventory-order-print-root" dir="rtl">
    <div className="inventory-order-actions"><span>معاينة نموذج مطابق لبيانات المرجع</span></div>
    <InventoryOrderSheet number="SR-2026-0042" status="approved" receiverName="عماد الدكش" details={details} stampUrl={fixtureStamp} />
  </main>;
}

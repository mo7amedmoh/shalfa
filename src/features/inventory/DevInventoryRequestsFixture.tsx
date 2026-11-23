import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PermissionProvider } from '../../app/PermissionProvider';
import { InventoryRequestsPage } from './InventoryRequestsPage';
import { inventoryRequestQueryKeys } from './inventoryRequestsModel';

const schoolIds = {
  north: '00000000-0000-4000-8000-000000000101',
  south: '00000000-0000-4000-8000-000000000102',
};

const itemIds = {
  lamp: '00000000-0000-4000-8000-000000000111',
  valve: '00000000-0000-4000-8000-000000000112',
  breaker: '00000000-0000-4000-8000-000000000113',
  hose: '00000000-0000-4000-8000-000000000114',
};

const sampleItems = [
  { item_id: itemIds.lamp, name: 'مصباح LED 18 واط', logix_code: 'LX-10452', unit: 'قطعة', available: 4, is_active: true },
  { item_id: itemIds.valve, name: 'صمام تحكم نحاسي', logix_code: null, unit: 'قطعة', available: 0, is_active: true },
  { item_id: itemIds.breaker, name: 'قاطع كهربائي 32 أمبير', logix_code: 'LX-20881', unit: 'قطعة', available: 20, is_active: true },
  { item_id: itemIds.hose, name: 'خرطوم تغذية', logix_code: 'LX-39810', unit: 'متر', available: null, is_active: true },
];

const sampleRequests = [
  {
    id: '00000000-0000-4000-8000-000000000121',
    number: 'SR-2026-0042',
    school_id: schoolIds.north,
    status: 'submitted',
    submitted_at: '2026-11-22T09:30:00Z',
    items: [{ item_id: itemIds.lamp, qty_requested: 6 }, { item_id: itemIds.valve, qty_requested: 2 }],
  },
  {
    id: '00000000-0000-4000-8000-000000000122',
    number: 'SR-2026-0041',
    school_id: schoolIds.south,
    status: 'draft',
    submitted_at: null,
    items: [{ item_id: itemIds.breaker, qty_requested: 3 }],
  },
  {
    id: '00000000-0000-4000-8000-000000000120',
    number: 'SR-2026-0038',
    school_id: schoolIds.north,
    status: 'approved',
    submitted_at: '2026-11-18T12:15:00Z',
    items: [{ item_id: itemIds.hose, qty_requested: 20 }],
  },
];

export function DevInventoryRequestsFixture() {
  const [queryClient] = useState(() => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(inventoryRequestQueryKeys.schools, [
      { id: schoolIds.north, school_name: 'مدرسة النور الابتدائية' },
      { id: schoolIds.south, school_name: 'مدرسة الازدهار المتوسطة' },
    ]);
    client.setQueryData(inventoryRequestQueryKeys.items, sampleItems);
    client.setQueryData(inventoryRequestQueryKeys.requests, sampleRequests);
    client.setQueryData(inventoryRequestQueryKeys.suggestions, [
      { ...sampleItems[0], last_requested_at: '2026-11-22T09:30:00Z' },
      { ...sampleItems[1], last_requested_at: '2026-11-20T08:00:00Z' },
      { ...sampleItems[2], last_requested_at: '2026-11-18T12:15:00Z' },
      { ...sampleItems[3], last_requested_at: '2026-11-15T11:00:00Z' },
    ]);
    return client;
  });

  return (
    <QueryClientProvider client={queryClient}>
      <PermissionProvider permissions={['inventory.request', 'inventory.view']}>
        <div className="min-h-screen bg-slate-50">
          <header className="flex min-h-16 items-center border-b border-slate-200 bg-white px-4 md:px-8">
            <div>
              <p className="text-xs text-slate-500">شركة شلفا لإدارة المرافق</p>
              <h1 className="font-bold text-brand-900">طلبات قطع الغيار</h1>
            </div>
            <span className="me-auto rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900">معاينة ببيانات تجريبية</span>
          </header>
          <main className="mx-auto max-w-[1600px] px-4 py-5 md:px-8 md:py-7">
            <InventoryRequestsPage />
          </main>
        </div>
      </PermissionProvider>
    </QueryClientProvider>
  );
}

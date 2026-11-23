import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PermissionProvider } from '../../app/PermissionProvider';
import { InventoryPage } from './InventoryPage';

const categoryIds = {
  electrical: '00000000-0000-4000-8000-000000000001',
  plumbing: '00000000-0000-4000-8000-000000000002',
};

const previewData = {
  categories: [
    { id: categoryIds.electrical, name: 'كهرباء' },
    { id: categoryIds.plumbing, name: 'سباكة' },
  ],
  items: [
    {
      item_id: '00000000-0000-4000-8000-000000000011',
      logix_code: 'LX-10452',
      name: 'مصباح LED 18 واط',
      unit: 'قطعة',
      category_id: categoryIds.electrical,
      category_name: 'كهرباء',
      photo_path: null,
      notes: null,
      min_stock: 10,
      is_active: true,
      balance: 6,
      reserved: 2,
      available: 4,
      status: 'low',
      photo_url: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2264%22 height=%2264%22 viewBox=%220 0 64 64%22%3E%3Crect width=%2264%22 height=%2264%22 rx=%2212%22 fill=%22%23fef3c7%22/%3E%3Cpath d=%22M24 43h16m-14-6c-8-7-4-20 6-20s14 13 6 20l-2 3h-12z%22 fill=%22%23f59e0b%22 stroke=%22%23b45309%22 stroke-width=%223%22 stroke-linejoin=%22round%22/%3E%3C/svg%3E',
    },
    {
      item_id: '00000000-0000-4000-8000-000000000012',
      logix_code: null,
      name: 'صمام تحكم نحاسي',
      unit: 'قطعة',
      category_id: categoryIds.plumbing,
      category_name: 'سباكة',
      photo_path: null,
      notes: 'مقاس 1 بوصة',
      min_stock: 2,
      is_active: true,
      balance: 0,
      reserved: 0,
      available: 0,
      status: 'out',
      photo_url: null,
    },
    {
      item_id: '00000000-0000-4000-8000-000000000013',
      logix_code: 'LX-20881',
      name: 'قاطع كهربائي 32 أمبير',
      unit: 'قطعة',
      category_id: categoryIds.electrical,
      category_name: 'كهرباء',
      photo_path: null,
      notes: null,
      min_stock: 3,
      is_active: true,
      balance: 24,
      reserved: 4,
      available: 20,
      status: 'available',
      photo_url: null,
    },
    {
      item_id: '00000000-0000-4000-8000-000000000014',
      logix_code: 'LX-39810',
      name: 'خرطوم تغذية',
      unit: 'متر',
      category_id: categoryIds.plumbing,
      category_name: 'سباكة',
      photo_path: null,
      notes: null,
      min_stock: null,
      is_active: true,
      balance: null,
      reserved: 0,
      available: null,
      status: 'uncounted',
      photo_url: null,
    },
  ],
};

export function DevInventoryFixture() {
  const [queryClient] = useState(() => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['inventory-balances', 'page'], previewData);
    return client;
  });

  return (
    <QueryClientProvider client={queryClient}>
      <PermissionProvider permissions={[
        'inventory.view',
        'inventory.manage_items',
        'inventory.receive_stock',
        'inventory.adjust',
      ]}>
        <div className="min-h-screen bg-slate-50">
          <header className="flex min-h-16 items-center border-b border-slate-200 bg-white px-4 md:px-8">
            <div>
              <p className="text-xs text-slate-500">شركة شلفا لإدارة المرافق</p>
              <h1 className="font-bold text-brand-900">المخزون</h1>
            </div>
            <span className="me-auto rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900">معاينة ببيانات تجريبية</span>
          </header>
          <main className="mx-auto max-w-[1600px] px-4 py-5 md:px-8 md:py-7">
            <InventoryPage />
          </main>
        </div>
      </PermissionProvider>
    </QueryClientProvider>
  );
}

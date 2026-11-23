import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PermissionProvider } from '../../app/PermissionProvider';
import {
  InventoryApprovalStampPage,
  InventoryIssuePage,
  InventoryReviewPage,
} from './InventoryWorkflowPages';
import { inventoryWorkflowQueryKeys } from './inventoryRequestsModel';

type WorkflowMode = 'review' | 'issue' | 'stamp';

const requestIds = {
  review: '00000000-0000-4000-8000-000000000221',
  issue: '00000000-0000-4000-8000-000000000222',
};
const itemIds = {
  lamp: '00000000-0000-4000-8000-000000000231',
  valve: '00000000-0000-4000-8000-000000000232',
  hose: '00000000-0000-4000-8000-000000000233',
};
const schoolId = '00000000-0000-4000-8000-000000000241';
const stampSvg = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22240%22 height=%22120%22 viewBox=%220 0 240 120%22%3E%3Crect width=%22240%22 height=%22120%22 rx=%2212%22 fill=%22white%22 stroke=%22%230e7490%22 stroke-width=%224%22/%3E%3Ccircle cx=%2260%22 cy=%2260%22 r=%2238%22 fill=%22none%22 stroke=%22%230e7490%22 stroke-width=%223%22/%3E%3Ctext x=%2260%22 y=%2265%22 text-anchor=%22middle%22 font-size=%2212%22 fill=%22%230e7490%22%3E%D8%A7%D9%84%D9%85%D9%87%D9%86%D8%AF%D8%B3%3C/text%3E%3Cpath d=%22M112 76c18-35 22 17 42-15s18 22 48-10%22 fill=%22none%22 stroke=%22%230e7490%22 stroke-width=%224%22 stroke-linecap=%22round%22/%3E%3C/svg%3E';

const sampleBalances = [
  { item_id: itemIds.lamp, name: 'مصباح LED 18 واط', unit: 'قطعة', balance: 12, reserved: 5, available: 7 },
  { item_id: itemIds.valve, name: 'صمام تحكم نحاسي', unit: 'قطعة', balance: null, reserved: 0, available: null },
  { item_id: itemIds.hose, name: 'خرطوم تغذية', unit: 'متر', balance: 18, reserved: 8, available: 10 },
];

const sampleReviewRequests = [{
  id: requestIds.review,
  number: 'SR-2026-0042',
  school_id: schoolId,
  status: 'submitted',
  submitted_at: '2026-11-23T09:30:00+03:00',
  notes: 'تسرب في دورات المياه، مع أولوية للصمام.',
  rejected_reason: null,
  receiver_name: null,
  schoolName: 'مدرسة النور الابتدائية',
  approverStampUrl: stampSvg,
  items: [
    { item_id: itemIds.lamp, qty_requested: 8, qty_approved: 0, qty_issued: 0, note: null, inventoryItem: sampleBalances[0] },
    { item_id: itemIds.valve, qty_requested: 2, qty_approved: 0, qty_issued: 0, note: null, inventoryItem: sampleBalances[1] },
  ],
}];

const sampleIssueRequests = [{
  id: requestIds.issue,
  number: 'SR-2026-0040',
  school_id: schoolId,
  status: 'partially_issued',
  submitted_at: '2026-11-20T12:15:00+03:00',
  notes: 'صرف عاجل للصيانة.',
  rejected_reason: null,
  receiver_name: 'أحمد العتيبي',
  schoolName: 'مدرسة الازدهار المتوسطة',
  approverStampUrl: stampSvg,
  items: [
    { item_id: itemIds.lamp, qty_requested: 6, qty_approved: 6, qty_issued: 2, note: null, inventoryItem: sampleBalances[0] },
    { item_id: itemIds.hose, qty_requested: 5, qty_approved: 5, qty_issued: 0, note: null, inventoryItem: sampleBalances[2] },
  ],
}];

function seedWorkflowClient(mode: WorkflowMode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60 * 60 * 1000 } } });
  if (mode === 'review') {
    client.setQueryData(inventoryWorkflowQueryKeys.review, sampleReviewRequests);
    client.setQueryData(inventoryWorkflowQueryKeys.stamp, { storagePath: 'demo/stamp.png', signedUrl: stampSvg });
  } else if (mode === 'issue') {
    client.setQueryData(inventoryWorkflowQueryKeys.issue, sampleIssueRequests);
  } else {
    client.setQueryData(inventoryWorkflowQueryKeys.stamp, { storagePath: 'demo/stamp.png', signedUrl: stampSvg });
  }
  return client;
}

export function DevInventoryWorkflowFixture({ mode }: { mode: WorkflowMode }) {
  const [queryClient] = useState(() => seedWorkflowClient(mode));
  const title = mode === 'review' ? 'طلبات للمراجعة' : mode === 'issue' ? 'صرف الطلبات' : 'ختمي وتوقيعي';
  return <QueryClientProvider client={queryClient}>
    <PermissionProvider permissions={['inventory.approve', 'inventory.issue']}>
      <div className="min-h-screen bg-slate-50">
        <header className="flex min-h-16 items-center border-b border-slate-200 bg-white px-4 md:px-8">
          <div>
            <p className="text-xs text-slate-500">شركة شلفا لإدارة المرافق</p>
            <h1 className="font-bold text-brand-900">{title}</h1>
          </div>
          <span className="me-auto rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900">معاينة ببيانات تجريبية</span>
        </header>
        <main className="mx-auto max-w-[1600px] px-4 py-5 md:px-8 md:py-7">
          {mode === 'review' ? <InventoryReviewPage />
            : mode === 'issue' ? <InventoryIssuePage />
              : <InventoryApprovalStampPage />}
        </main>
      </div>
    </PermissionProvider>
  </QueryClientProvider>;
}

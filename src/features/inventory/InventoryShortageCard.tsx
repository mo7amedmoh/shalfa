import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Package } from 'lucide-react';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { usePermission } from '../../app/permissionContext';
import { useDisplayFormat } from '../../app/useDisplayFormat';
import { supabase } from '../../lib/supabase';
import { getInventoryShortageCounts } from './inventoryModel';

const shortageSchema = z.array(z.object({
  status: z.enum(['available', 'low', 'out', 'uncounted']),
}));

async function loadShortageSummary() {
  if (!supabase) throw new Error('إعداد الاتصال بقاعدة البيانات غير مكتمل.');
  const { data, error } = await supabase.from('inventory_balances').select('status');
  if (error) throw error;
  return getInventoryShortageCounts(shortageSchema.parse(data));
}

export function InventoryShortageCard() {
  const canViewInventory = usePermission('inventory.view');
  const { formatNumber } = useDisplayFormat();
  const summary = useQuery({
    queryKey: ['inventory-balances', 'summary'],
    queryFn: loadShortageSummary,
    enabled: canViewInventory,
    staleTime: 30_000,
  });

  if (!canViewInventory) return null;
  const shortageTotal = (summary.data?.out ?? 0) + (summary.data?.low ?? 0);

  return (
    <Link
      to="/inventory?shortages=true"
      className="card flex min-h-24 items-center justify-between gap-4 border-amber-200 bg-amber-50 p-4 transition hover:border-amber-400"
      aria-label="فتح نواقص المستودع"
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-800">
          <Package size={22} aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <b className="block text-brand-900">نواقص المستودع</b>
          <span className="mt-1 block text-sm text-slate-600">
            {summary.isLoading
              ? 'جارٍ تحميل الأرصدة…'
              : summary.error
                ? 'تعذر تحميل ملخص النواقص'
                : `${formatNumber(summary.data?.out ?? 0)} نافد · ${formatNumber(summary.data?.low ?? 0)} منخفض`}
          </span>
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2 text-sm font-bold text-amber-800">
        {shortageTotal > 0
          ? <AlertTriangle size={18} aria-hidden="true" />
          : null}
        عرض النواقص ←
      </span>
    </Link>
  );
}

import { z } from 'zod';
import { supabase } from './supabase';

const residenceRowSchema = z.object({
  id: z.string().uuid(),
  residence_no: z.string().nullable(),
});

export async function revealResidenceNumbers(kind: 'employees' | 'gatekeepers', ids: string[]): Promise<Map<string, string>> {
  return readResidenceNumbers(ids, (batch) => {
    if (!supabase) throw new Error('يلزم إعداد الاتصال بقاعدة البيانات.');
    return supabase.rpc('reveal_residence', { p_kind: kind, p_ids: batch });
  });
}

export async function exportGatekeeperResidenceNumbers(ids: string[]): Promise<Map<string, string>> {
  return readResidenceNumbers(ids, (batch) => {
    if (!supabase) throw new Error('يلزم إعداد الاتصال بقاعدة البيانات.');
    return supabase.rpc('export_gatekeeper_residence', { p_ids: batch });
  });
}

async function readResidenceNumbers(
  ids: string[],
  fetchBatch: (ids: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<Map<string, string>> {
  if (!supabase) throw new Error('يلزم إعداد الاتصال بقاعدة البيانات.');
  const uniqueIds = [...new Set(ids)];
  const numbers = new Map<string, string>();

  for (let offset = 0; offset < uniqueIds.length; offset += 500) {
    const { data, error } = await fetchBatch(uniqueIds.slice(offset, offset + 500));
    if (error) throw error;
    for (const row of z.array(residenceRowSchema).parse(data)) {
      if (row.residence_no) numbers.set(row.id, row.residence_no);
    }
  }

  return numbers;
}

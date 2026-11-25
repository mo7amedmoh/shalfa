import { z } from 'zod';
import type { CurrentSchoolSupervisors } from '../domain/schoolSupervisors';
import { supabase } from './supabase';

const currentSupervisorsSchema = z.array(z.object({
  school_id: z.string().uuid(),
  maintenance_supervisor_id: z.string().uuid().nullable(),
  maintenance_supervisor_name: z.string().nullable(),
  cleaning_supervisor_id: z.string().uuid().nullable(),
  cleaning_supervisor_name: z.string().nullable(),
}));

async function loadSupervisorPage(schoolIds: readonly string[] | null, from: number, to: number) {
  if (!supabase) throw new Error('إعداد الاتصال بقاعدة البيانات غير مكتمل.');
  let query = supabase.from('school_current_supervisors')
    .select('school_id,maintenance_supervisor_id,maintenance_supervisor_name,cleaning_supervisor_id,cleaning_supervisor_name')
    .order('school_id')
    .range(from, to);
  if (schoolIds) query = query.in('school_id', [...schoolIds]);
  const { data, error } = await query;
  if (error) throw error;
  return currentSupervisorsSchema.parse(data);
}

export async function loadCurrentSchoolSupervisors(
  schoolIds?: readonly string[],
): Promise<CurrentSchoolSupervisors[]> {
  if (!supabase) throw new Error('إعداد الاتصال بقاعدة البيانات غير مكتمل.');
  if (schoolIds && !schoolIds.length) return [];

  const ids = schoolIds ? [...new Set(schoolIds)] : null;
  const batches = ids ? Array.from({ length: Math.ceil(ids.length / 500) }, (_, index) => ids.slice(index * 500, (index + 1) * 500)) : [null];
  const results: CurrentSchoolSupervisors[] = [];
  for (const batch of batches) {
    let from = 0;
    while (true) {
      const page = await loadSupervisorPage(batch, from, from + 999);
      results.push(...page);
      if (page.length < 1000) break;
      from += page.length;
    }
  }
  return results;
}

export async function loadSheetSupervisorFallback(): Promise<boolean> {
  if (!supabase) return true;
  const { data, error } = await supabase.from('app_config')
    .select('value')
    .eq('key', 'use_sheet_supervisor_fallback')
    .maybeSingle();
  if (error) throw error;
  return data ? z.boolean().parse(data.value) : true;
}

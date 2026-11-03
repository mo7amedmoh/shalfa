import { z } from 'zod';
import { supabase } from './supabase';

export const preferencesSchema = z.object({
  numerals: z.enum(['latin', 'arabic_indic']),
  date_format: z.enum(['dd/mm/yyyy', 'yyyy/mm/dd']),
  rows_per_page: z.number().int().min(10).max(100),
});

export type UserPreferences = z.infer<typeof preferencesSchema>;
export const defaultPreferences: UserPreferences = {
  numerals: 'latin',
  date_format: 'dd/mm/yyyy',
  rows_per_page: 25,
};

export async function loadUserPreferences(userId: string): Promise<UserPreferences> {
  if (!supabase) return defaultPreferences;
  const { data, error } = await supabase.from('profiles').select('prefs').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data ? preferencesSchema.parse(data.prefs) : defaultPreferences;
}

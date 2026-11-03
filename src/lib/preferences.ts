import { z } from 'zod';
import { supabase } from './supabase';

export const preferencesSchema = z.object({
  numerals: z.enum(['latin', 'arabic_indic']),
  date_format: z.enum(['dd/mm/yyyy', 'yyyy/mm/dd']),
  rows_per_page: z.number().int().min(10).max(100),
});

const persistedPreferencesSchema = z.object({
  numerals: z.enum(['latin', 'arabic_indic']).optional(),
  date_format: z.string().optional(),
  rows_per_page: z.number().int().optional(),
  page_size: z.number().int().optional(),
}).passthrough();

export type UserPreferences = z.infer<typeof preferencesSchema>;
export const defaultPreferences: UserPreferences = {
  numerals: 'latin',
  date_format: 'dd/mm/yyyy',
  rows_per_page: 25,
};

export function normalizePreferences(value: unknown): UserPreferences {
  const persisted = persistedPreferencesSchema.parse(value);
  const dateFormat = persisted.date_format === 'yyyy/mm/dd' || persisted.date_format === 'dd/mm/yyyy'
    ? persisted.date_format
    : defaultPreferences.date_format;
  return preferencesSchema.parse({
    numerals: persisted.numerals ?? defaultPreferences.numerals,
    date_format: dateFormat,
    rows_per_page: persisted.rows_per_page ?? persisted.page_size ?? defaultPreferences.rows_per_page,
  });
}

export async function loadUserPreferences(userId: string): Promise<UserPreferences> {
  if (!supabase) return defaultPreferences;
  const { data, error } = await supabase.from('profiles').select('prefs').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data ? normalizePreferences(data.prefs) : defaultPreferences;
}

import { z } from 'zod';
import { supabase } from './supabase';
import { APP_SCHEMA_SELECT } from './schemaColumns';

export const userProfileSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  role: z.enum(['admin', 'project_manager', 'area_engineer', 'report_follower', 'supervisor', 'viewer']),
  display_name: z.string().nullable(),
  phone: z.string().nullable(),
  employee_id: z.string().uuid().nullable(),
});

export type UserProfile = z.infer<typeof userProfileSchema>;

export function loginEmail(email: string): string {
  const parsed = z.string().trim().email().safeParse(email);
  if (!parsed.success) throw new Error('البريد الإلكتروني غير صالح.');
  return parsed.data.toLowerCase();
}

export async function signInWithEmail(email: string, password: string): Promise<void> {
  if (!supabase) throw new Error('لم يتم إعداد الاتصال بقاعدة البيانات.');
  const { error } = await supabase.auth.signInWithPassword({
    email: loginEmail(email),
    password,
  });
  if (error) throw error;
}

export async function getUserProfile(userId: string): Promise<UserProfile> {
  if (!supabase) throw new Error('لم يتم إعداد الاتصال بقاعدة البيانات.');
  const { data, error } = await supabase.from('profiles')
    .select(APP_SCHEMA_SELECT.profile)
    .eq('id', userId)
    .single();
  if (error) throw error;
  return userProfileSchema.parse(data);
}

import { z } from 'zod';
import { supabase } from './supabase';

export const userProfileSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  role: z.enum(['admin', 'project_manager', 'area_engineer', 'report_follower', 'supervisor', 'viewer']),
  display_name: z.string(),
  phone: z.string().nullable(),
});

export type UserProfile = z.infer<typeof userProfileSchema>;

export function usernameEmail(username: string): string {
  const parsed = z.string().regex(/^[a-zA-Z0-9._-]{3,40}$/).safeParse(username.trim());
  if (!parsed.success) throw new Error('اسم المستخدم غير صالح.');
  return `${parsed.data.toLowerCase()}@shalfa.local`;
}

export async function signInWithUsername(username: string, password: string): Promise<void> {
  if (!supabase) throw new Error('لم يتم إعداد الاتصال بقاعدة البيانات.');
  const { error } = await supabase.auth.signInWithPassword({
    email: usernameEmail(username),
    password,
  });
  if (error) throw error;
}

export async function getUserProfile(userId: string): Promise<UserProfile> {
  if (!supabase) throw new Error('لم يتم إعداد الاتصال بقاعدة البيانات.');
  const { data, error } = await supabase.from('user_profiles').select('id, username, role, display_name, phone').eq('id', userId).single();
  if (error) throw error;
  return userProfileSchema.parse(data);
}

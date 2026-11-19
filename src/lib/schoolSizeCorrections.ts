import { z } from 'zod';
import { SCHOOL_SIZES, type SchoolSize } from '../domain/staffing';
import { APP_SCHEMA_SELECT } from './schemaColumns';
import { supabase } from './supabase';

const correctionSchema = z.object({
  school_id: z.string().uuid(),
  corrected_size: z.enum(SCHOOL_SIZES),
  updated_by: z.string().uuid(),
  updated_at: z.string(),
});
const profileSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string().nullable(),
});

export type SchoolSizeCorrectionDetails = {
  schoolId: string;
  correctedSize: SchoolSize;
  updatedByName: string | null;
  updatedAt: string;
};

export async function loadSchoolSizeCorrections(): Promise<SchoolSizeCorrectionDetails[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('school_size_corrections')
    .select(APP_SCHEMA_SELECT.schoolSizeCorrection);
  if (error) throw error;
  const corrections = z.array(correctionSchema).parse(data);
  const actorIds = [...new Set(corrections.map(({ updated_by }) => updated_by))];
  if (!actorIds.length) return [];

  const { data: profiles, error: profilesError } = await supabase.from('profiles')
    .select('id,full_name')
    .in('id', actorIds);
  if (profilesError) throw profilesError;
  const actorNames = new Map(z.array(profileSchema).parse(profiles)
    .map(({ id, full_name }) => [id, full_name?.trim() || 'مستخدم غير معروف']));

  return corrections.map(({ school_id, corrected_size, updated_by, updated_at }) => ({
    schoolId: school_id,
    correctedSize: corrected_size,
    updatedByName: actorNames.get(updated_by) ?? null,
    updatedAt: updated_at,
  }));
}

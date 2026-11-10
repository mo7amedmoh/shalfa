import { z } from 'zod';

export const employeeCategorySchema = z.enum([
  'engineer',
  'supervisor',
  'admin_staff',
  'technician',
  'driver',
  'cleaner',
  'gatekeeper',
]);

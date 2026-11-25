import { schoolPersonDefault } from './imports';

export type CurrentSchoolSupervisors = {
  school_id: string;
  maintenance_supervisor_id: string | null;
  maintenance_supervisor_name: string | null;
  cleaning_supervisor_id: string | null;
  cleaning_supervisor_name: string | null;
};

export type ResolvedPlanSupervisor = {
  supervisorId: string | null;
  supervisorName: string | null;
};

export function currentSupervisorForPlan(
  current: CurrentSchoolSupervisors | null | undefined,
  planType: string,
): ResolvedPlanSupervisor | null {
  if (!current) return null;
  if (planType === 'cleaning') {
    return current.cleaning_supervisor_id || current.cleaning_supervisor_name
      ? { supervisorId: current.cleaning_supervisor_id, supervisorName: current.cleaning_supervisor_name }
      : null;
  }
  if (planType === 'maintenance') {
    return current.maintenance_supervisor_id || current.maintenance_supervisor_name
      ? { supervisorId: current.maintenance_supervisor_id, supervisorName: current.maintenance_supervisor_name }
      : null;
  }
  return null;
}

export function resolvePlanSupervisor(input: {
  planType: string;
  supervisorId: string | null;
  supervisorName: string | null;
  current?: CurrentSchoolSupervisors | null;
  schoolSourceFields?: Record<string, unknown> | null;
  useSheetFallback?: boolean;
}): ResolvedPlanSupervisor {
  if (input.supervisorId) {
    return { supervisorId: input.supervisorId, supervisorName: input.supervisorName?.trim() || null };
  }

  const assigned = currentSupervisorForPlan(input.current, input.planType);
  if (assigned?.supervisorId || assigned?.supervisorName) return assigned;

  const savedName = input.supervisorName?.trim();
  if (savedName) return { supervisorId: null, supervisorName: savedName };

  if (input.useSheetFallback !== false && (input.planType === 'maintenance' || input.planType === 'cleaning')) {
    const sheetName = schoolPersonDefault(
      { source_fields: input.schoolSourceFields ?? {} },
      'supervisor',
      input.planType,
    );
    if (sheetName) return { supervisorId: null, supervisorName: sheetName };
  }

  return { supervisorId: null, supervisorName: null };
}

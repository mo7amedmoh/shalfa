import { schoolPersonDefault } from './imports';
import { isKnownGatekeeperName } from './supervisorMigration';
import { isSupervisorEligibleEmployee } from './workforce';

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

export function resolveEligibleSchoolSupervisor(input: {
  current?: CurrentSchoolSupervisors | null;
  planType: string;
  schoolSourceFields: Record<string, unknown>;
  employeeById?: ReadonlyMap<string, {
    full_name: string;
    category: string | null;
    job_title?: string | null;
    jobTitle?: string | null;
  }>;
  excludedSupervisorNames?: readonly string[];
  useSheetFallback?: boolean;
}): ResolvedPlanSupervisor {
  if (input.planType !== 'maintenance' && input.planType !== 'cleaning') {
    return { supervisorId: null, supervisorName: null };
  }
  const isCleaning = input.planType === 'cleaning';
  const assignedId = isCleaning
    ? input.current?.cleaning_supervisor_id
    : input.current?.maintenance_supervisor_id;
  const assignedName = isCleaning
    ? input.current?.cleaning_supervisor_name
    : input.current?.maintenance_supervisor_name;
  const employee = assignedId ? input.employeeById?.get(assignedId) : undefined;
  const assigned = excludeIneligibleSupervisor({
    supervisorId: assignedId ?? null,
    supervisorName: employee?.full_name ?? assignedName ?? null,
  }, {
    employeeById: input.employeeById,
    excludedSupervisorNames: input.excludedSupervisorNames,
  });
  if (assigned.supervisorName?.trim()) {
    return { ...assigned, supervisorName: assigned.supervisorName.trim() };
  }

  const sheetName = schoolPersonDefault(
    { source_fields: input.schoolSourceFields },
    'supervisor',
    input.planType,
    null,
    input.useSheetFallback ?? true,
  );
  return excludeIneligibleSupervisor({
    supervisorId: null,
    supervisorName: sheetName || null,
  }, {
    excludedSupervisorNames: input.excludedSupervisorNames,
  });
}

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
  const assigned = currentSupervisorForPlan(input.current, input.planType);
  if (assigned?.supervisorId || assigned?.supervisorName) return assigned;

  if (input.supervisorId) {
    return { supervisorId: input.supervisorId, supervisorName: input.supervisorName?.trim() || null };
  }

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

/**
 * Clears a resolved supervisor when the assigned employee is ineligible to supervise
 * (e.g. a gatekeeper) or when an unassigned name matches a known gatekeeper.
 */
export function excludeIneligibleSupervisor(
  supervisor: ResolvedPlanSupervisor,
  options: {
    employeeById?: ReadonlyMap<string, { category: string | null; job_title?: string | null; jobTitle?: string | null }>;
    excludedSupervisorNames?: readonly string[];
  },
): ResolvedPlanSupervisor {
  const assignedEmployee = supervisor.supervisorId
    ? options.employeeById?.get(supervisor.supervisorId)
    : undefined;
  const isIneligible = assignedEmployee
    ? !isSupervisorEligibleEmployee({
        category: assignedEmployee.category,
        jobTitle: assignedEmployee.jobTitle ?? assignedEmployee.job_title ?? null,
      })
    : isKnownGatekeeperName(supervisor.supervisorName ?? '', options.excludedSupervisorNames ?? []);
  return isIneligible ? { supervisorId: null, supervisorName: null } : supervisor;
}

export type GeneralPlanStatus = 'pending' | 'in_progress' | 'complete';

export interface GeneralPlanProgress {
  total: number;
  pending: number;
  inProgress: number;
  complete: number;
  completionPercent: number;
}

export function summarizeGeneralPlanProgress(statuses: readonly GeneralPlanStatus[]): GeneralPlanProgress {
  const pending = statuses.filter((status) => status === 'pending').length;
  const inProgress = statuses.filter((status) => status === 'in_progress').length;
  const complete = statuses.filter((status) => status === 'complete').length;
  return {
    total: statuses.length,
    pending,
    inProgress,
    complete,
    completionPercent: statuses.length ? (complete / statuses.length) * 100 : 0,
  };
}

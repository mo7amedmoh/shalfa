export const checklistStatuses = ['مكتمل', 'جارٍ', 'لم يبدأ', 'لا ينطبق'] as const;

export type ChecklistStatus = (typeof checklistStatuses)[number];

export interface ChecklistProgress {
  total: number;
  completed: number;
  inProgress: number;
  notStarted: number;
  notApplicable: number;
  percentage: number | null;
}

export function calculateChecklistProgress(statuses: readonly ChecklistStatus[]): ChecklistProgress {
  const completed = statuses.filter((status) => status === 'مكتمل').length;
  const inProgress = statuses.filter((status) => status === 'جارٍ').length;
  const notStarted = statuses.filter((status) => status === 'لم يبدأ').length;
  const notApplicable = statuses.filter((status) => status === 'لا ينطبق').length;
  const denominator = statuses.length - notApplicable;

  return {
    total: statuses.length,
    completed,
    inProgress,
    notStarted,
    notApplicable,
    percentage: denominator === 0 ? null : completed / denominator * 100,
  };
}

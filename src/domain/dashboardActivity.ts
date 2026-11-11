export interface DashboardActivityEvent {
  action: string;
  entity: string | null;
  details: Record<string, unknown> | null;
}

function detailsObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function countDetail(details: Record<string, unknown> | null, ...keys: string[]): number | null {
  if (!details) return null;
  for (const key of keys) {
    const value = details[key];
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  }
  return null;
}

export function formatDashboardActivity(event: DashboardActivityEvent): string | null {
  const action = event.action.toLocaleLowerCase();
  const details = detailsObject(event.details);
  if (action === 'bulk_update_plan_rows') {
    const rows = countDetail(details, 'rows');
    const visits = countDetail(details, 'visits_marked');
    const reports = countDetail(details, 'reports_marked');
    const parts = [
      rows === null ? null : `${rows} صف`,
      visits === null ? null : `${visits} زيارة`,
      reports === null ? null : `${reports} تقرير`,
    ].filter((part): part is string => part !== null);
    return `تحديث جماعي للخطة${parts.length ? `: ${parts.join('، ')}` : ''}.`;
  }
  if (['sync', 'school_sync', 'schools_sync'].includes(action) && event.entity === 'schools') {
    const rows = countDetail(details, 'rows', 'schools', 'count');
    return rows === null ? 'اكتملت مزامنة المدارس.' : `اكتملت مزامنة ${rows} مدرسة.`;
  }
  if (action === 'approve' || action.startsWith('approve_') ||
      (action === 'update' && ['kpi_months', 'deliverables'].includes(event.entity ?? '') &&
        detailsObject(details?.new)?.status === 'approved')) {
    const month = detailsObject(details?.new)?.month;
    return event.entity === 'kpi_months' && typeof month === 'string'
      ? `تم اعتماد بطاقة الأداء لشهر ${month}.`
      : 'تم اعتماد سجل.';
  }
  if (action === 'import' || action.startsWith('import_') || action === 'bulk_import') {
    const rows = countDetail(details, 'rows', 'imported', 'count');
    return rows === null ? 'اكتمل استيراد البيانات.' : `تم استيراد ${rows} سجل.`;
  }
  return null;
}

export type DeliverableStatus = 'not_delivered' | 'delivered_pending' | 'approved';

export type DeliverableDueBasis =
  | 'التوقيع'
  | 'استلام الموقع'
  | 'الترسية'
  | 'نهاية العقد'
  | 'حسب الخطة'
  | string;

export type DeliverableDueDates = {
  contractSigningDate: string | null;
  siteHandoverDate: string | null;
  awardLetterDate: string | null;
};

export type DeliverableRecord = {
  dueBasis: DeliverableDueBasis | null;
  durationDays: number | null;
  durationText?: string | null;
  dueDateOverride: string | null;
  status: DeliverableStatus;
};

export type DeliverableDueResult = {
  dueDate: string | null;
  isOverride: boolean;
  hint: string;
};

export type DeliverableSummary = {
  total: number;
  delivered: number;
  approved: number;
  late: number;
  progressPercent: number;
};

function validDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function computeDeliverableDueDate(
  basis: DeliverableDueBasis | null,
  durationDays: number | null,
  dates: DeliverableDueDates,
): string | null {
  if (durationDays === null || !Number.isInteger(durationDays) || durationDays < 0) return null;
  const baseDate = basis === 'التوقيع'
    ? dates.contractSigningDate
    : basis === 'استلام الموقع'
      ? dates.siteHandoverDate
      : basis === 'الترسية'
        ? dates.awardLetterDate
        : null;
  if (!validDate(baseDate)) return null;
  const due = new Date(`${baseDate}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() + durationDays);
  return due.toISOString().slice(0, 10);
}

export function resolveDeliverableDueDate(
  deliverable: DeliverableRecord,
  dates: DeliverableDueDates,
): DeliverableDueResult {
  const computed = computeDeliverableDueDate(deliverable.dueBasis, deliverable.durationDays, dates);
  if (deliverable.dueDateOverride) {
    return {
      dueDate: deliverable.dueDateOverride,
      isOverride: true,
      hint: computed
        ? `موعد يدوي (الموعد المحسوب: ${computed}).`
        : 'موعد يدوي؛ لا يتوفر تاريخ أساس للحساب التلقائي.',
    };
  }
  if (computed) {
    return {
      dueDate: computed,
      isOverride: false,
      hint: `تاريخ ${deliverable.dueBasis} (${baseDateForBasis(deliverable.dueBasis, dates)}) + ${deliverable.durationDays} يومًا.`,
    };
  }
  const reason = deliverable.durationDays === null
    ? deliverable.durationText
      ? `المدة «${deliverable.durationText}» وصفية ولا يمكن حساب تاريخ منفرد منها تلقائياً.`
      : 'لا توجد مدة محددة في المصنف.'
    : deliverable.dueBasis === 'نهاية العقد' || deliverable.dueBasis === 'حسب الخطة'
      ? `أساس الاستحقاق «${deliverable.dueBasis}» لا يقابله تاريخ في إعدادات العقد.`
      : 'تاريخ الأساس غير متاح في إعدادات العقد.';
  return { dueDate: null, isOverride: false, hint: reason };
}

function baseDateForBasis(basis: DeliverableDueBasis | null, dates: DeliverableDueDates): string {
  if (basis === 'التوقيع') return dates.contractSigningDate ?? 'غير محدد';
  if (basis === 'استلام الموقع') return dates.siteHandoverDate ?? 'غير محدد';
  if (basis === 'الترسية') return dates.awardLetterDate ?? 'غير محدد';
  return 'غير محدد';
}

export function isDeliverableLate(
  deliverable: DeliverableRecord,
  dates: DeliverableDueDates,
  asOf: string,
): boolean {
  const dueDate = resolveDeliverableDueDate(deliverable, dates).dueDate;
  return Boolean(dueDate && dueDate < asOf && deliverable.status === 'not_delivered');
}

export function summarizeDeliverables<T extends DeliverableRecord>(
  deliverables: readonly T[],
  dates: DeliverableDueDates,
  asOf: string,
): DeliverableSummary {
  const total = deliverables.length;
  const delivered = deliverables.filter(({ status }) => status !== 'not_delivered').length;
  const approved = deliverables.filter(({ status }) => status === 'approved').length;
  const late = deliverables.filter((deliverable) => isDeliverableLate(deliverable, dates, asOf)).length;
  return {
    total,
    delivered,
    approved,
    late,
    progressPercent: total ? (delivered / total) * 100 : 0,
  };
}

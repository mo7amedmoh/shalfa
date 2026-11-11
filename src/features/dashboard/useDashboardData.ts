import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { dashboardAccessForRole } from '../../domain/dashboardAccess';
import { countDashboardActions, staffingRowsForEligibleSchools, summarizeDashboardServices, summarizeSupervisorCompliance, summarizeWorkforce, type DashboardStaffingRow, type WorkforceSummary } from '../../domain/dashboard';
import { formatDashboardActivity } from '../../domain/dashboardActivity';
import { summarizeDeliverables } from '../../domain/deliverables';
import { KPI_WORK_ORDER } from '../../domain/kpi/config';
import { ratingBand } from '../../domain/kpi/scoring';
import { eligibleSchoolIds } from '../../domain/planEligibility';
import { lateVisitRows, summarizeDashboardVerdict, type ReportPlanMetricRow } from '../../domain/planReport';
import type { PlanEligibilityConfig } from '../../domain/planEligibility';
import type { PlanType } from '../../domain/types';
import type { UserProfile } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { APP_SCHEMA_SELECT } from '../../lib/schemaColumns';

const planTypeSchema = z.enum(['maintenance', 'cleaning', 'security_safety', 'elevators']);
const planSchema = z.object({
  id: z.string().uuid(),
  plan_type: planTypeSchema,
  late_by_planned_date: z.boolean(),
  monthly_plan_rows: z.array(z.object({
    id: z.string().uuid(),
    school: z.object({ name: z.string() }).nullable(),
    planned_date: z.string(),
    visited: z.boolean(),
    visited_at: z.string().nullable(),
    report_done: z.boolean(),
    report_completed_at: z.string().nullable(),
    supervisor_id: z.string().uuid().nullable(),
    supervisor_name: z.string().nullable(),
  })),
});
const sourceSchoolSchema = z.object({
  id: z.string().uuid(),
  source_fields: z.record(z.string(), z.unknown()),
  size_source: z.enum(['small', 'medium', 'large']).nullable(),
});
const assignmentSchema = z.object({ school_id: z.string().uuid() });
const gatekeeperSchema = z.object({ school_id: z.string().uuid() });
const sizeCorrectionSchema = z.object({ school_id: z.string().uuid(), corrected_size: z.string() });
const exceptionSchemaRow = z.object({ school_id: z.string().uuid(), required_count: z.number().int(), reason: z.string() });
const eligibilitySchema = z.object({
  buildingTypeHeader: z.string(),
  independentBuildingValues: z.array(z.string()),
  primarySharedValues: z.array(z.string()),
  elevatorContractorHeader: z.string(),
  noElevatorValues: z.array(z.string()),
  classCountHeader: z.string().default('عدد الفصول'),
  schoolSizeHeader: z.string().default(''),
});
const exceptionSchema = z.object({ requiredCleaners: z.number().int().min(0), reason: z.string().trim().min(1) });
const syncSchema = z.object({ synced_at: z.string().nullable() });
const deliverableSchema = z.object({
  due_basis: z.string().nullable(),
  duration_days: z.number().int().nullable(),
  due_date: z.string().nullable(),
  status: z.enum(['not_delivered', 'delivered_pending', 'approved']),
});
const deliverableSettingsSchema = z.object({
  contract_signing_date: z.string(),
  site_handover_date: z.string(),
  award_letter_date: z.string().nullable(),
});
const kpiSchema = z.object({ id: z.string().uuid(), status: z.enum(['draft', 'submitted', 'approved']) });
const kpiTotalsSchema = z.object({
  month: z.string(),
  status: z.enum(['draft', 'submitted', 'approved']),
  contract_month: z.number().int().nullable(),
  total_score: z.number().nullable(),
  payable_factor: z.number().nullable(),
});
const auditEventSchema = z.object({
  id: z.number(),
  action: z.string(),
  entity: z.string().nullable(),
  details: z.record(z.string(), z.unknown()).nullable(),
  created_at: z.string(),
});

type EligibilitySettings = PlanEligibilityConfig & { classCountHeader: string; schoolSizeHeader: string };
type DashboardPlanRow = ReportPlanMetricRow & {
  id: string;
  planId: string;
  lateByPlannedDate: boolean;
  schoolName: string;
  supervisorId: string | null;
  supervisorName: string | null;
};
type DashboardDeliverable = {
  dueBasis: string | null;
  durationDays: number | null;
  dueDateOverride: string | null;
  status: 'not_delivered' | 'delivered_pending' | 'approved';
};
type StaffingData = {
  rows: DashboardStaffingRow[];
  configured: boolean;
  workforce: WorkforceSummary | null;
};
type DeliverablesData = {
  items: DashboardDeliverable[];
  dates: { contractSigningDate: string | null; siteHandoverDate: string | null; awardLetterDate: string | null };
};
type DashboardKpi = {
  month: string;
  status: 'draft' | 'submitted' | 'approved';
  contractMonth: number | null;
  scorePercent: number | null;
  rating: ReturnType<typeof ratingBand> | null;
  payablePercent: number | null;
};
type DashboardActivity = { id: number; at: string; message: string };
export type DashboardFilter = { month: string; supervisorId: string; serviceType: PlanType | 'all' };

const EMPTY_PLAN_ROWS: DashboardPlanRow[] = [];

function localDate(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function asOfForMonth(month: string): string {
  const today = localDate();
  if (month === today.slice(0, 7)) return today;
  const firstDay = new Date(`${month}-01T00:00:00Z`);
  const endOfMonth = new Date(Date.UTC(firstDay.getUTCFullYear(), firstDay.getUTCMonth() + 1, 0));
  const selectedEnd = endOfMonth.toISOString().slice(0, 10);
  return selectedEnd < today ? selectedEnd : new Date(firstDay.getTime() - 86_400_000).toISOString().slice(0, 10);
}

function previousMonth(month: string): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
}

async function loadPlanRows(month: string): Promise<DashboardPlanRow[]> {
  if (!supabase) throw new Error('إعداد الاتصال بقاعدة البيانات غير مكتمل.');
  const { data, error } = await supabase.from('monthly_plans')
    .select(APP_SCHEMA_SELECT.monthlyPlanDashboard)
    .eq('month', `${month}-01`);
  if (error) throw error;
  return z.array(planSchema).parse(data).flatMap((plan) => plan.monthly_plan_rows.map((row) => ({
    id: row.id,
    planId: plan.id,
    lateByPlannedDate: plan.late_by_planned_date,
    schoolName: row.school?.name ?? 'مدرسة غير معروفة',
    month,
    planType: plan.plan_type,
    plannedDate: row.planned_date,
    visited: row.visited,
    visitedDate: row.visited_at,
    reportDone: row.report_done,
    reportCompletedDate: row.report_completed_at,
    supervisorId: row.supervisor_id,
    supervisorName: row.supervisor_name,
  })));
}

async function loadStaffingData(): Promise<StaffingData> {
  if (!supabase) throw new Error('إعداد الاتصال بقاعدة البيانات غير مكتمل.');
  const [schoolsResult, assignmentsResult, overridesResult, exceptionsResult, configResult, gatekeepersResult] = await Promise.all([
    supabase.from('schools').select(APP_SCHEMA_SELECT.schoolsDashboard),
    supabase.from('cleaner_assignments').select(APP_SCHEMA_SELECT.cleanerAssignmentSchool),
    supabase.from('school_size_corrections').select(APP_SCHEMA_SELECT.schoolSizeCorrection),
    supabase.from('staffing_exceptions').select(APP_SCHEMA_SELECT.staffingException),
    supabase.from('app_config').select(APP_SCHEMA_SELECT.appConfigValue).eq('key', 'plan_eligibility').maybeSingle(),
    supabase.from('gatekeepers').select(APP_SCHEMA_SELECT.gatekeeperDashboard),
  ]);
  for (const result of [schoolsResult, assignmentsResult, overridesResult, exceptionsResult, configResult, gatekeepersResult]) {
    if (result.error) throw result.error;
  }
  if (!configResult.data) return { rows: [], configured: false, workforce: null };

  const config = eligibilitySchema.parse(configResult.data.value);
  const assignmentCounts = new Map<string, number>();
  for (const { school_id } of z.array(assignmentSchema).parse(assignmentsResult.data)) {
    assignmentCounts.set(school_id, (assignmentCounts.get(school_id) ?? 0) + 1);
  }
  const overrides = new Map<string, { correctedSize: string | null; exception: z.infer<typeof exceptionSchema> | null }>();
  for (const row of z.array(sizeCorrectionSchema).parse(overridesResult.data)) {
    overrides.set(row.school_id, { correctedSize: row.corrected_size, exception: null });
  }
  for (const row of z.array(exceptionSchemaRow).parse(exceptionsResult.data)) {
    const current = overrides.get(row.school_id) ?? { correctedSize: null, exception: null };
    current.exception = exceptionSchema.parse({ requiredCleaners: row.required_count, reason: row.reason });
    overrides.set(row.school_id, current);
  }
  const schools = z.array(sourceSchoolSchema).parse(schoolsResult.data);
  const dashboardSchools = schools.map((school) => {
    const override = overrides.get(school.id);
    return {
      id: school.id,
      sourceFields: school.source_fields,
      assignedCleaners: assignmentCounts.get(school.id) ?? 0,
      declaredSize: override?.correctedSize
        ?? school.size_source
        ?? (config.schoolSizeHeader ? String(school.source_fields[config.schoolSizeHeader] ?? '') : null),
      exception: override?.exception,
    };
  });
  const eligibility: EligibilitySettings = config;
  const rows = staffingRowsForEligibleSchools(dashboardSchools, eligibility);
  const eligibleSchools = new Set(eligibleSchoolIds(dashboardSchools, 'maintenance', config));
  const assignedGatekeepers = new Set(z.array(gatekeeperSchema).parse(gatekeepersResult.data)
    .map(({ school_id }) => school_id)
    .filter((schoolId) => eligibleSchools.has(schoolId)));
  return {
    rows,
    configured: true,
    workforce: summarizeWorkforce(
      rows,
      eligibleSchools.size,
      assignedGatekeepers.size,
    ),
  };
}

async function loadLastSchoolSync(): Promise<string | null> {
  if (!supabase) throw new Error('إعداد الاتصال بقاعدة البيانات غير مكتمل.');
  const { data, error } = await supabase.from('schools')
    .select(APP_SCHEMA_SELECT.schoolsSyncTime)
    .not('synced_at', 'is', null)
    .order('synced_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  return z.array(syncSchema).parse(data)[0]?.synced_at ?? null;
}

async function loadDeliverables(): Promise<DeliverablesData> {
  if (!supabase) throw new Error('إعداد الاتصال بقاعدة البيانات غير مكتمل.');
  const [deliverablesResult, settingsResult] = await Promise.all([
    supabase.from('deliverables').select(APP_SCHEMA_SELECT.deliverablesSummary),
    supabase.from('app_settings').select(APP_SCHEMA_SELECT.appSettingsDeliverables).eq('id', 1).single(),
  ]);
  if (deliverablesResult.error) throw deliverablesResult.error;
  if (settingsResult.error) throw settingsResult.error;
  const settings = deliverableSettingsSchema.parse(settingsResult.data);
  return {
    items: z.array(deliverableSchema).parse(deliverablesResult.data).map((item) => ({
      dueBasis: item.due_basis,
      durationDays: item.duration_days,
      dueDateOverride: item.due_date,
      status: item.status,
    })),
    dates: {
      contractSigningDate: settings.contract_signing_date,
      siteHandoverDate: settings.site_handover_date,
      awardLetterDate: settings.award_letter_date,
    },
  };
}

async function loadPreviousKpiStatus(month: string): Promise<'draft' | 'submitted' | 'approved' | null> {
  if (!supabase) throw new Error('إعداد الاتصال بقاعدة البيانات غير مكتمل.');
  const priorMonth = previousMonth(month);
  const { data, error } = await supabase.from('kpi_months')
    .select(APP_SCHEMA_SELECT.kpiMonth)
    .eq('month', `${priorMonth}-01`)
    .eq('work_order', KPI_WORK_ORDER)
    .maybeSingle();
  if (error) throw error;
  return data ? kpiSchema.parse(data).status : null;
}

async function loadLatestKpi(month: string): Promise<DashboardKpi | null> {
  if (!supabase) throw new Error('إعداد الاتصال بقاعدة البيانات غير مكتمل.');
  const query = supabase.from('kpi_month_totals')
    .select(APP_SCHEMA_SELECT.kpiDashboardTotals)
    .eq('work_order', KPI_WORK_ORDER);
  const { data: selectedData, error: selectedError } = await query
    .eq('month', `${month}-01`)
    .maybeSingle();
  if (selectedError) throw selectedError;
  let data = selectedData;
  if (!data) {
    const { data: latestData, error: latestError } = await supabase.from('kpi_month_totals')
      .select(APP_SCHEMA_SELECT.kpiDashboardTotals)
      .eq('work_order', KPI_WORK_ORDER)
      .order('month', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestError) throw latestError;
    data = latestData;
  }
  if (!data) return null;
  const kpi = kpiTotalsSchema.parse(data);
  const scorePercent = kpi.total_score === null ? null : kpi.total_score * 100;
  return {
    month: kpi.month,
    status: kpi.status,
    contractMonth: kpi.contract_month,
    scorePercent,
    rating: scorePercent === null ? null : ratingBand(scorePercent),
    payablePercent: kpi.payable_factor === null ? null : kpi.payable_factor * 100,
  };
}

async function loadRecentActivity(month: string): Promise<DashboardActivity[]> {
  if (!supabase) throw new Error('إعداد الاتصال بقاعدة البيانات غير مكتمل.');
  const [year, monthNumber] = month.split('-').map(Number);
  const monthStart = new Date(year, monthNumber - 1, 1);
  const nextMonthStart = new Date(year, monthNumber, 1);
  const { data, error } = await supabase.from('audit_log')
    .select(APP_SCHEMA_SELECT.auditLog)
    .in('action', ['bulk_update_plan_rows', 'sync', 'school_sync', 'schools_sync', 'approve', 'import', 'bulk_import', 'UPDATE'])
    .gte('at', monthStart.toISOString())
    .lt('at', nextMonthStart.toISOString())
    .order('at', { ascending: false })
    .limit(250);
  if (error) throw error;
  return z.array(auditEventSchema).parse(data)
    .flatMap((event) => {
      const message = formatDashboardActivity(event);
      return message ? [{ id: event.id, at: event.created_at, message }] : [];
    })
    .slice(0, 5);
}

export function useDashboardData(profile: UserProfile | null, filters: DashboardFilter) {
  const access = dashboardAccessForRole(profile?.role);
  const month = filters.month;
  const asOf = asOfForMonth(month);
  const plans = useQuery({
    queryKey: ['dashboard-plan-rows', profile?.id, profile?.role, month],
    queryFn: () => loadPlanRows(month),
    enabled: access.plans,
    staleTime: 60_000,
  });
  const staffing = useQuery({
    queryKey: ['dashboard-staffing-data', profile?.id, profile?.role],
    queryFn: loadStaffingData,
    enabled: access.staffing,
    staleTime: 60_000,
  });
  const syncTime = useQuery({
    queryKey: ['dashboard-school-sync-time', profile?.id],
    queryFn: loadLastSchoolSync,
    enabled: access.syncTime,
    staleTime: 60_000,
  });
  const deliverables = useQuery({
    queryKey: ['dashboard-deliverables', profile?.id, profile?.role],
    queryFn: loadDeliverables,
    enabled: access.deliverables,
    staleTime: 60_000,
  });
  const previousKpi = useQuery({
    queryKey: ['dashboard-previous-kpi-status', profile?.id, profile?.role, month],
    queryFn: () => loadPreviousKpiStatus(month),
    enabled: access.kpi,
    staleTime: 60_000,
  });
  const latestKpi = useQuery({
    queryKey: ['dashboard-latest-kpi', profile?.id, profile?.role, month],
    queryFn: () => loadLatestKpi(month),
    enabled: access.kpi,
    staleTime: 60_000,
  });
  const activity = useQuery({
    queryKey: ['dashboard-recent-activity', profile?.id, profile?.role, month],
    queryFn: () => loadRecentActivity(month),
    enabled: access.activity,
    staleTime: 60_000,
  });

  const allRows = plans.data ?? EMPTY_PLAN_ROWS;
  const deliverableSummary = useMemo(() => deliverables.data
    ? summarizeDeliverables(deliverables.data.items, deliverables.data.dates, asOf)
    : null, [deliverables.data, asOf]);
  const supervisorRows = useMemo(() => allRows.filter((row) => {
    if (!filters.supervisorId) return true;
    if (!filters.supervisorId.startsWith('name:')) return row.supervisorId === filters.supervisorId;
    return !row.supervisorId && `name:${row.supervisorName ?? ''}` === filters.supervisorId;
  }), [allRows, filters.supervisorId]);
  const filteredRows = useMemo(() => supervisorRows.filter((row) =>
    filters.serviceType === 'all' || row.planType === filters.serviceType,
  ), [supervisorRows, filters.serviceType]);
  const compliance = useMemo(() => summarizeSupervisorCompliance(
    filteredRows.filter((row) => row.planType === 'maintenance').map((row) => ({
      supervisorId: row.supervisorId,
      supervisorName: row.supervisorName,
      plannedDate: row.plannedDate,
      visited: row.visited,
      visitedDate: row.visitedDate,
    })),
    asOf,
  ), [filteredRows, asOf]);
  const supervisors = useMemo(() => [...new Map(allRows
    .filter((row) => row.supervisorId || row.supervisorName)
    .map((row) => {
      const id = row.supervisorId ?? `name:${row.supervisorName ?? ''}`;
      return [id, { id, name: row.supervisorName ?? 'مشرف غير محدد' }] as const;
    })).values()].sort((a, b) => a.name.localeCompare(b.name, 'ar')), [allRows]);
  const services = useMemo(() => summarizeDashboardServices(supervisorRows, month, asOf)
    .filter((service) => filters.serviceType === 'all' || service.planType === filters.serviceType),
  [supervisorRows, month, asOf, filters.serviceType]);
  const verdict = useMemo(() => summarizeDashboardVerdict(filteredRows, month, asOf), [filteredRows, month, asOf]);
  const actionTotals = plans.data ? countDashboardActions({
    rows: filteredRows,
    month,
    asOf,
    staffing: staffing.data?.rows ?? [],
    deliverables: deliverables.data?.items ?? [],
    deliverableDates: deliverables.data?.dates ?? {
      contractSigningDate: null,
      siteHandoverDate: null,
      awardLetterDate: null,
    },
    previousKpiStatus: previousKpi.data ?? null,
  }) : null;
  const actionCounts = access.actions && actionTotals ? {
    lateVisits: actionTotals.lateVisits,
    visitedWithoutReport: actionTotals.visitedWithoutReport,
    cleanerShortage: staffing.data?.workforce?.cleaners.shortage,
    deliverablesDueSoon: access.deliverables && deliverables.data ? actionTotals.deliverablesDueSoon : undefined,
    previousKpiNotApproved: access.kpi && previousKpi.data !== undefined ? actionTotals.previousKpiNotApproved : undefined,
  } : null;
  const lateVisits = lateVisitRows(filteredRows, asOf);
  const lateItems = filteredRows
    .filter((row) => lateVisits.has(row) && !row.visited)
    .sort((left, right) => left.plannedDate.localeCompare(right.plannedDate))
    .slice(0, 5);

  return {
    access,
    month,
    asOf,
    allRows: access.plans ? allRows : EMPTY_PLAN_ROWS,
    supervisorRows: access.plans ? supervisorRows : EMPTY_PLAN_ROWS,
    filteredRows: access.plans ? filteredRows : EMPTY_PLAN_ROWS,
    supervisors: access.plans ? supervisors : [],
    services: access.plans ? services : [],
    verdict: access.plans ? verdict : summarizeDashboardVerdict([], month, asOf),
    actionCounts,
    lateVisitCount: actionTotals?.lateVisits ?? 0,
    staffingConfigured: access.staffing && (staffing.data?.configured ?? false),
    lastSchoolSyncAt: access.syncTime ? syncTime.data ?? null : null,
    compliance: access.plans ? compliance : [],
    workforce: access.workforce ? staffing.data?.workforce ?? null : null,
    deliverableSummary: access.deliverables ? deliverableSummary : null,
    latestKpi: access.kpi ? latestKpi.data ?? null : null,
    recentActivity: access.activity ? activity.data ?? [] : [],
    lateItems: access.reportFollowerView ? lateItems : [],
    plansLoading: access.plans && plans.isLoading,
    plansError: plans.error,
    staffingLoading: access.staffing && staffing.isLoading,
    staffingError: staffing.error,
    syncTimeLoading: access.syncTime && syncTime.isLoading,
    syncTimeError: syncTime.error,
    deliverablesLoading: access.deliverables && deliverables.isLoading,
    deliverablesError: deliverables.error,
    kpiLoading: access.kpi && latestKpi.isLoading,
    kpiError: latestKpi.error,
    activityLoading: access.activity && activity.isLoading,
    activityError: activity.error,
    previousKpiLoading: access.kpi && previousKpi.isLoading,
    previousKpiError: previousKpi.error,
  };
}

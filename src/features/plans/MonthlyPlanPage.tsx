import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { Download, Pencil } from 'lucide-react';
import { loadXlsx } from '../../lib/xlsx';
import { exportBrandedXlsx } from '../../lib/brandedXlsx';
import {
  cleaningSupervisorName,
  cleaningSupervisorUpdates,
  isPlanRowOverdue,
  matchesPlanCompletionFilters,
  matchesPlanSchoolSearch,
  type PlanCompletionFilter,
} from '../../domain/plans';
import {
  buildPlanEditReason,
  getPlanEditWarnings,
  planEditWarningLabel,
  requiresVisitEditReason,
} from '../../domain/planRowEdit';
import { eligibleSchoolIds, type PlanEligibilityConfig } from '../../domain/planEligibility';
import { schoolPersonDefault } from '../../domain/imports';
import type { ScheduleAssignment } from '../../domain/planScheduler';
import type { PlanType } from '../../domain/types';
import type { UserProfile } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { APP_SCHEMA_SELECT } from '../../lib/schemaColumns';
import { useDisplayFormat } from '../../app/useDisplayFormat';
import { usePermission } from '../../app/permissionContext';
import { ImportWizardLauncher } from '../imports/ImportWizard';
import { BulkPlanUpdates } from './BulkPlanUpdates';
import { MonthlyPlanRedistribution } from './MonthlyPlanRedistribution';
import { MonthlyPlanRowEditDialog } from './MonthlyPlanRowEditDialog';
import { SupervisorPlanGenerator } from './SupervisorPlanGenerator';

const sourceSchoolSchema = z.object({
  id: z.string().uuid(),
  school_name: z.string(),
  ministry_number: z.string(),
  ministry_key: z.string(),
  source_fields: z.record(z.string(), z.unknown()),
  neighbourhood: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
});
const eligibilitySchema = z.object({
  buildingTypeHeader: z.string(),
  independentBuildingValues: z.array(z.string()),
  primarySharedValues: z.array(z.string()),
  elevatorContractorHeader: z.string(),
  noElevatorValues: z.array(z.string()),
});
const planSchema = z.object({
  id: z.string().uuid(),
  plan_month: z.string(),
  late_by_planned_date: z.boolean(),
});
const rowSchema = z.object({
  id: z.string().uuid(),
  school_id: z.string().uuid(),
  planned_date: z.string(),
  visited: z.boolean(),
  visited_at: z.string().nullable(),
  report_completed_at: z.string().nullable(),
  engineer_id: z.string().uuid().nullable(),
  supervisor_id: z.string().uuid().nullable(),
  supervisor_name: z.string().nullable(),
  engineer_name: z.string().nullable(),
  contractor_name: z.string().nullable(),
  original_planned_date: z.string().nullable(),
  original_school_id: z.string().uuid().nullable(),
  original_supervisor_id: z.string().uuid().nullable(),
  edited_at: z.string().nullable(),
  edited_by: z.string().uuid().nullable(),
  school: z.object({
    school_name: z.string(),
    ministry_number: z.string(),
    ministry_key: z.string(),
    source_fields: z.record(z.string(), z.unknown()),
  }).nullable(),
});
type PlanRow = z.infer<typeof rowSchema>;
type CandidateData = { schools: z.infer<typeof sourceSchoolSchema>[]; eligibility: PlanEligibilityConfig | null };

const planTitles: Record<PlanType, string> = {
  maintenance: 'الصيانة',
  cleaning: 'النظافة',
  security_safety: 'الأمن والسلامة',
  elevators: 'المصاعد',
};

async function loadCandidates(): Promise<CandidateData> {
  if (!supabase) return { schools: [], eligibility: null };
  const [schoolsResult, settingsResult] = await Promise.all([
    supabase.from('schools').select(APP_SCHEMA_SELECT.schoolsPlanGenerator).order('name'),
    supabase.from('app_config').select(APP_SCHEMA_SELECT.appConfigValue).eq('key', 'plan_eligibility').maybeSingle(),
  ]);
  if (schoolsResult.error) throw schoolsResult.error;
  if (settingsResult.error) throw settingsResult.error;
  const schools = z.array(sourceSchoolSchema).parse(schoolsResult.data);
  const eligibility = settingsResult.data
    ? eligibilitySchema.parse(settingsResult.data.value)
    : null;
  return { schools, eligibility };
}

async function loadPlans(planType: PlanType) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('monthly_plans')
    .select(APP_SCHEMA_SELECT.monthlyPlanList)
    .eq('plan_type', planType)
    .order('month', { ascending: false });
  if (error) throw error;
  return z.array(planSchema).parse(data);
}

async function loadPlanRows(planId: string): Promise<PlanRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('monthly_plan_rows')
    .select(APP_SCHEMA_SELECT.monthlyPlanRows)
    .eq('plan_id', planId)
    .order('planned_date');
  if (error) throw error;
  return z.array(rowSchema).parse(data);
}

function localDate(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function currentMonth(): string {
  return localDate().slice(0, 7);
}

function validInitialMonth(value: string | null): string {
  if (!value || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return currentMonth();
  const parsed = new Date(`${value}-01T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 7) === value ? value : currentMonth();
}

export function MonthlyPlanPage({ planType, profile }: { planType: PlanType; profile: UserProfile | null }) {
  const queryClient = useQueryClient();
  const { formatNumber, formatDate } = useDisplayFormat();
  const [searchParams] = useSearchParams();
  const [month, setMonth] = useState(() => validInitialMonth(searchParams.get('month')));
  const [activePlanId, setActivePlanId] = useState('');
  const [actualDates, setActualDates] = useState<Record<string, { visited: string; report: string }>>({});
  const [plannedDates, setPlannedDates] = useState<Record<string, string>>({});
  const [newPlanLateByPlannedDate, setNewPlanLateByPlannedDate] = useState(true);
  const [activePlanLateByPlannedDate, setActivePlanLateByPlannedDate] = useState(true);
  const [visitFilter, setVisitFilter] = useState<PlanCompletionFilter>('all');
  const [reportFilter, setReportFilter] = useState<PlanCompletionFilter>('all');
  const [schoolSearch, setSchoolSearch] = useState('');
  const [exportingPlan, setExportingPlan] = useState(false);
  const [message, setMessage] = useState('');
  const [editingRowId, setEditingRowId] = useState('');
  const [redistributionOpen, setRedistributionOpen] = useState(false);
  const candidates = useQuery({ queryKey: ['monthly-plan-candidates'], queryFn: loadCandidates });
  const plans = useQuery({ queryKey: ['monthly-plans', planType], queryFn: () => loadPlans(planType) });
  const eligibleIds = useMemo(() => {
    if (!candidates.data?.eligibility) return [];
    return eligibleSchoolIds(
      candidates.data.schools.map((school) => ({ id: school.id, sourceFields: school.source_fields })),
      planType,
      candidates.data.eligibility,
    );
  }, [candidates.data, planType]);
  const eligibleSchools = useMemo(() => {
    const eligible = new Set(eligibleIds);
    return candidates.data?.schools.filter((school) => eligible.has(school.id)) ?? [];
  }, [candidates.data, eligibleIds]);
  const activePlan = plans.data?.find((plan) => plan.id === activePlanId);
  const rows = useQuery({
    queryKey: ['monthly-plan-rows', activePlanId],
    queryFn: () => loadPlanRows(activePlanId),
    enabled: Boolean(activePlanId),
  });
  const canEditSchedule = usePermission('plans.edit_rows');
  const canCreate = usePermission('plans.create_delete');
  const canUpdate = usePermission('plans.record_visit_report');
  const canRedistribute = usePermission('plans.redistribute_remaining');
  const editSupervisors = useQuery({
    queryKey: ['monthly-plan-edit-supervisors'],
    queryFn: async () => {
      if (!supabase) return [];
      const { data, error } = await supabase.from('employees')
        .select('id,full_name')
        .eq('category', 'supervisor')
        .eq('status', 'active')
        .order('full_name');
      if (error) throw error;
      return z.array(z.object({ id: z.string().uuid(), full_name: z.string() })).parse(data);
    },
    enabled: canEditSchedule,
  });
  const editableRows = useMemo(() => (rows.data ?? []).map((row) => ({
    ...row,
    plannedDate: row.planned_date,
    supervisorId: row.supervisor_id,
  })), [rows.data]);
  const editingRow = editableRows.find((row) => row.id === editingRowId);
  const loadError = candidates.error ?? plans.error ?? rows.error;
  const loadErrorMessage = loadError instanceof Error ? loadError.message : String(loadError ?? '');
  const loadErrorDetails = /late_by_planned_date/i.test(loadErrorMessage)
    ? `طبّق الترحيل 202611110001_monthly_late_accounting.sql. ${loadErrorMessage}`
    : /original_planned_date|edited_at|original_school_id|original_supervisor_id/i.test(loadErrorMessage)
      ? `طبّق الترحيل 202611170002_plan_row_edits.sql. ${loadErrorMessage}`
      : /ministry_key/i.test(loadErrorMessage)
        ? `طبّق الترحيل 202611070001_ministry_key.sql. ${loadErrorMessage}`
        : loadErrorMessage;

  useEffect(() => {
    if (!plans.data?.length) return;
    const planForMonth = plans.data.find((plan) => plan.plan_month.slice(0, 7) === month);
    if (planForMonth) setActivePlanId(planForMonth.id);
    else setActivePlanId('');
  }, [plans.data, month]);
  useEffect(() => {
    if (activePlan) setActivePlanLateByPlannedDate(activePlan.late_by_planned_date);
  }, [activePlan]);
  useEffect(() => {
    if (!rows.data) return;
    setActualDates(Object.fromEntries(rows.data.map((row) => [row.id, {
      visited: row.visited_at ?? '',
      report: row.report_completed_at ?? '',
    }])));
    setPlannedDates(Object.fromEntries(rows.data.map((row) => [row.id, row.planned_date])));
  }, [rows.data]);

  const createPlan = useMutation({
    mutationFn: async ({ assignments, lateByPlannedDate }: { assignments: ScheduleAssignment[]; lateByPlannedDate: boolean }) => {
      if (!supabase || !profile) throw new Error('يلزم تسجيل الدخول لإنشاء الخطة.');
      if (!canCreate) throw new Error('لا تملك صلاحية إنشاء الخطط.');
      if (!candidates.data?.eligibility) throw new Error('يلزم اعتماد قواعد أهلية المدارس أولاً.');
      const currentEligible = new Set(eligibleIds);
      if (!assignments.length || assignments.some((assignment) => !currentEligible.has(assignment.schoolId))) {
        throw new Error('اختر مدرسة واحدة على الأقل من المدارس المؤهلة.');
      }
      if (new Set(assignments.map((assignment) => assignment.schoolId)).size !== assignments.length
        || assignments.some((assignment) => {
        const parsed = new Date(`${assignment.plannedDate}T00:00:00.000Z`);
        return !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== assignment.plannedDate || assignment.plannedDate.slice(0, 7) !== month;
      })) {
        throw new Error('تأكد من عدم تكرار المدارس، وأن جميع المواعيد تقع ضمن الشهر المحدد.');
      }
      const { data: createdPlan, error: createError } = await supabase
        .from('monthly_plans')
        .insert({ month: `${month}-01`, plan_type: planType, created_by: profile.id, late_by_planned_date: lateByPlannedDate })
        .select(APP_SCHEMA_SELECT.id)
        .single();
      if (createError) throw createError;
      const { error: rowsError } = await supabase.from('monthly_plan_rows').insert(
        assignments.map((assignment) => ({
          plan_id: createdPlan.id,
          school_id: assignment.schoolId,
          planned_date: assignment.plannedDate,
          supervisor_id: assignment.supervisorId,
          supervisor_name: assignment.supervisorName,
        })),
      );
      if (rowsError) {
        const { error: rollbackError } = await supabase.from('monthly_plans').delete().eq('id', createdPlan.id);
        if (rollbackError) throw new Error(`تعذر حفظ صفوف الخطة، كما تعذر حذف الخطة الفارغة: ${rowsError.message}; ${rollbackError.message}`);
        throw rowsError;
      }
      return createdPlan.id as string;
    },
    onSuccess: async (createdPlanId) => {
      setActivePlanId(createdPlanId);
      setMessage('تم إنشاء الخطة وحفظ مواعيد المدارس.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['monthly-plans', planType] }),
        queryClient.invalidateQueries({ queryKey: ['monthly-plan-rows', createdPlanId] }),
      ]);
    },
    onError: (error: Error) => setMessage(`تعذر إنشاء الخطة: ${error.message}`),
  });

  const updateLateAccounting = useMutation({
    mutationFn: async () => {
      if (!supabase || !profile || !activePlan) throw new Error('اختر خطة أولاً.');
      if (!canCreate) throw new Error('لا تملك صلاحية تعديل إعداد احتساب التأخر.');
      const { error } = await supabase.from('monthly_plans')
        .update({ late_by_planned_date: activePlanLateByPlannedDate })
        .eq('id', activePlan.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      setMessage('تم تحديث طريقة احتساب التأخر.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['monthly-plans', planType] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-plan-rows'] }),
        queryClient.invalidateQueries({ queryKey: ['monthly-report'] }),
      ]);
    },
    onError: (error: Error) => setMessage(`تعذر تحديث طريقة احتساب التأخر: ${error.message}`),
  });

  const updateCleaningSupervisors = useMutation({
    mutationFn: async () => {
      if (!supabase || !activePlan || planType !== 'cleaning') throw new Error('اختر خطة نظافة أولاً.');
      if (!canCreate) throw new Error('لا تملك صلاحية تحديث أسماء المشرفين.');
      const updates = cleaningSupervisorUpdates((rows.data ?? []).map((row) => ({
        id: row.id,
        supervisorName: row.supervisor_name,
        schoolSourceFields: row.school?.source_fields ?? null,
      })));
      if (!updates.length) return 0;
      if (!window.confirm(`سيتم استبدال أسماء المشرفين في ${updates.length} صفاً بالأسماء الواردة في قاعدة بيانات المدارس. هل تريد المتابعة؟`)) {
        throw new Error('تم إلغاء تحديث أسماء المشرفين.');
      }

      const rowsByName = new Map<string, string[]>();
      for (const update of updates) {
        const ids = rowsByName.get(update.supervisorName) ?? [];
        ids.push(update.id);
        rowsByName.set(update.supervisorName, ids);
      }
      for (const [supervisorName, rowIds] of rowsByName) {
        const { error } = await supabase.from('monthly_plan_rows')
          .update({ supervisor_id: null, supervisor_name: supervisorName })
          .eq('plan_id', activePlan.id)
          .in('id', rowIds);
        if (error) throw error;
      }

      const { data, error } = await supabase.from('monthly_plan_rows')
        .select('id,supervisor_name')
        .eq('plan_id', activePlan.id)
        .in('id', updates.map((update) => update.id));
      if (error) throw new Error(`تعذر التحقق من أسماء المشرفين المحفوظة: ${error.message}`);
      const savedNames = new Map((data ?? []).map((row) => [row.id, row.supervisor_name]));
      const notSaved = updates.filter((update) => savedNames.get(update.id) !== update.supervisorName);
      if (notSaved.length) throw new Error(`لم تُحفظ أسماء المشرفين في ${notSaved.length} صفاً. تحقق من صلاحيات قاعدة البيانات.`);
      return updates.length;
    },
    onSuccess: (count) => setMessage(count
      ? `تم تحديث أسماء مشرفي النظافة في ${count} صفاً من قاعدة بيانات المدارس.`
      : 'أسماء مشرفي الخطة مطابقة بالفعل لقاعدة بيانات المدارس.'),
    onError: (error: Error) => setMessage(`تعذر تحديث أسماء مشرفي النظافة: ${error.message}`),
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['monthly-plan-rows', activePlanId] }),
        queryClient.invalidateQueries({ queryKey: ['monthly-report'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-plan-rows'] }),
      ]);
    },
  });

  const updateRow = useMutation({
    mutationFn: async ({ rowId, field, value }: { rowId: string; field: 'visited_at' | 'report_completed_at'; value: string | null }) => {
      if (!supabase) throw new Error('يلزم إعداد Supabase.');
      if (field === 'report_completed_at' && value && !rows.data?.find((row) => row.id === rowId)?.visited_at) {
        throw new Error('لا يمكن إكمال التقرير قبل تسجيل الزيارة.');
      }
      const { error } = await supabase.from('monthly_plan_rows').update({
        [field === 'visited_at' ? 'visited_date' : 'report_done_date']: value || null,
        [field === 'visited_at' ? 'visited' : 'report_done']: Boolean(value),
      }).eq('id', rowId);
      if (error) throw error;
    },
    onSuccess: async () => {
      setMessage('تم تحديث تاريخ التنفيذ.');
      await queryClient.invalidateQueries({ queryKey: ['monthly-plan-rows', activePlanId] });
    },
    onError: (error: Error) => setMessage(`تعذر تحديث السجل: ${error.message}`),
  });

  const editPlanRow = useMutation({
    mutationFn: async ({ rowId, changes, reason }: { rowId: string; changes: Record<string, string | null>; reason: string | null }) => {
      if (!supabase || !profile) throw new Error('يلزم تسجيل الدخول لتعديل صف الخطة.');
      if (!canEditSchedule) throw new Error('تعديل صفوف الخطة متاح لمدير النظام ومدير المشروع فقط.');
      const { error } = await supabase.rpc('edit_plan_row', {
        p_plan_kind: 'monthly',
        p_row_id: rowId,
        p_changes: changes,
        p_reason: reason,
      });
      if (error) {
        const migrationHint = error.code === 'PGRST202' || error.code === '42883'
          ? ' يلزم تطبيق ترحيل 202611170002_plan_row_edits.sql.'
          : '';
        throw new Error(`${error.message}${migrationHint}`);
      }
    },
    onSuccess: async () => {
      setEditingRowId('');
      setMessage('تم تعديل صف الخطة وتسجيل التغيير في سجل التدقيق.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['monthly-plan-rows', activePlanId] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-plan-rows'] }),
        queryClient.invalidateQueries({ queryKey: ['monthly-report'] }),
      ]);
    },
    onError: (error: Error) => setMessage(`تعذر تعديل صف الخطة: ${error.message}`),
  });

  function savePlannedDate(row: PlanRow) {
    const plannedDate = plannedDates[row.id] ?? row.planned_date;
    if (!plannedDate || plannedDate === row.planned_date) return;
    const warnings = getPlanEditWarnings({
      plannedDate,
      supervisorId: row.supervisor_id,
      rows: editableRows,
      excludedRowIds: [row.id],
      scheduleChanged: true,
    });
    if (warnings.length && !window.confirm(`تنبيهات الموعد الجديد:\n${warnings.map(planEditWarningLabel).join('\n')}\nهل تريد المتابعة؟`)) {
      setPlannedDates((current) => ({ ...current, [row.id]: row.planned_date }));
      return;
    }

    let reason = '';
    if (requiresVisitEditReason({
      visited: row.visited || Boolean(row.visited_at),
      schoolChanged: false,
      dateChanged: true,
    })) {
      const enteredReason = window.prompt('اكتب سبب تغيير موعد صف تمت زيارته:');
      if (!enteredReason?.trim()) {
        setPlannedDates((current) => ({ ...current, [row.id]: row.planned_date }));
        return;
      }
      reason = enteredReason;
    }

    editPlanRow.mutate({
      rowId: row.id,
      changes: { planned_date: plannedDate },
      reason: buildPlanEditReason(reason, warnings),
    });
  }

  const deletePlan = useMutation({
    mutationFn: async ({ rowsOnly }: { rowsOnly: boolean }) => {
      if (!supabase || !profile || !activePlan) throw new Error('اختر خطة أولاً.');
      if (!canCreate) throw new Error('لا تملك صلاحية الحذف.');
      const currentRows = rows.data ?? [];
      const visited = currentRows.filter((row) => row.visited_at).length;
      const reports = currentRows.filter((row) => row.report_completed_at).length;
      const answer = window.prompt(`سيتم حذف ${currentRows.length} صفاً، ${visited} زيارة، ${reports} تقريراً. اكتب حذف للتأكيد.`);
      if (answer !== 'حذف') throw new Error('لم يتم تأكيد الحذف.');
      const XLSX = await loadXlsx();
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(currentRows), 'نسخة احتياطية');
      XLSX.writeFile(book, `نسخة-خطة-${planType}-${activePlan.plan_month.slice(0, 7)}.xlsx`);
      const { error: rowError } = await supabase.from('monthly_plan_rows').delete().eq('plan_id', activePlan.id);
      if (rowError) throw rowError;
      if (!rowsOnly) {
        const { error } = await supabase.from('monthly_plans').delete().eq('id', activePlan.id);
        if (error) throw error;
      }
    },
    onSuccess: async () => {
      setMessage('تم الحذف وتحديث الصفحة.');
      setActivePlanId('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['monthly-plans', planType] }),
        queryClient.invalidateQueries({ queryKey: ['monthly-plan-rows', activePlanId] }),
      ]);
    },
    onError: (error: Error) => setMessage(error.message),
  });
  const deleteRow = useMutation({
    mutationFn: async (rowId: string) => {
      if (!supabase || !canCreate) throw new Error('لا تملك صلاحية الحذف.');
      const answer = window.prompt('اكتب حذف لتأكيد حذف هذا الصف.');
      if (answer !== 'حذف') throw new Error('لم يتم تأكيد الحذف.');
      const { error } = await supabase.from('monthly_plan_rows').delete().eq('id', rowId);
      if (error) throw error;
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['monthly-plan-rows', activePlanId] }); },
    onError: (error: Error) => setMessage(error.message),
  });

  const today = localDate();
  const completedVisits = rows.data?.filter((row) => row.visited_at).length ?? 0;
  const completedReports = rows.data?.filter((row) => row.report_completed_at).length ?? 0;
  const cleaningSupervisorChanges = useMemo(
    () => cleaningSupervisorUpdates((rows.data ?? []).map((row) => ({
      id: row.id,
      supervisorName: row.supervisor_name,
      schoolSourceFields: row.school?.source_fields ?? null,
    }))),
    [rows.data],
  );
  const missingSupervisorCount = (rows.data ?? []).filter((row) => {
    if (planType === 'elevators' || planType === 'security_safety') return false;
    const supervisorName = planType === 'cleaning'
      ? cleaningSupervisorName({
        id: row.id,
        supervisorName: row.supervisor_name,
        schoolSourceFields: row.school?.source_fields ?? null,
      })
      : row.supervisor_name;
    return !row.supervisor_id && !supervisorName;
  }).length;
  const filteredPlanRows = useMemo(
    () => (rows.data ?? []).filter((row) => matchesPlanCompletionFilters({
      visitedAt: row.visited_at,
      reportCompletedAt: row.report_completed_at,
    }, visitFilter, reportFilter) && matchesPlanSchoolSearch({
      schoolName: row.school?.school_name ?? null,
      ministryNumber: row.school?.ministry_number ?? null,
      ministryKey: row.school?.ministry_key ?? null,
    }, schoolSearch)),
    [rows.data, visitFilter, reportFilter, schoolSearch],
  );
  const monthEnd = month && /^\d{4}-\d{2}$/.test(month)
    ? new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10)
    : '';
  const schedulerSchools = eligibleSchools.map((school) => ({
    id: school.id,
    name: school.school_name,
    ministryNumber: school.ministry_number,
    supervisorName: schoolPersonDefault({ source_fields: school.source_fields }, 'supervisor', planType) || null,
    neighbourhood: school.neighbourhood,
    latitude: school.latitude,
    longitude: school.longitude,
  }));
  const exportPlan = async () => {
    if (!activePlan || !filteredPlanRows.length || exportingPlan) return;
    setExportingPlan(true);
    setMessage('');
    try {
      const includesContractor = planType === 'security_safety' || planType === 'elevators';
      await exportBrandedXlsx(`خطة-${planTitles[planType]}-${activePlan.plan_month.slice(0, 7)}.xlsx`, [{
        name: 'الخطة',
        title: `خطة ${planTitles[planType]} - ${activePlan.plan_month.slice(0, 7)}`,
        columns: [
          'الرقم الوزاري', 'اسم المدرسة', 'الموعد المخطط',
          ...(includesContractor ? ['الشركة'] : []),
          'اسم المشرف', 'تاريخ الزيارة', 'تاريخ إنجاز التقرير', 'الحالة',
        ],
        rows: filteredPlanRows.map((row) => {
          const overdue = activePlan.late_by_planned_date
            ? isPlanRowOverdue({
              plannedDate: row.planned_date,
              visitedAt: row.visited_at,
              reportCompletedAt: row.report_completed_at,
            }, today)
            : today > monthEnd && !row.report_completed_at;
          const supervisorName = planType === 'cleaning'
            ? cleaningSupervisorName({
              id: row.id,
              supervisorName: row.supervisor_name,
              schoolSourceFields: row.school?.source_fields ?? null,
            })
            : row.supervisor_name;
          return [
            row.school?.ministry_number ?? '',
            row.school?.school_name ?? row.school_id,
            plannedDates[row.id] ?? row.planned_date,
            ...(includesContractor ? [row.contractor_name ?? ''] : []),
            supervisorName ?? '',
            actualDates[row.id]?.visited ?? row.visited_at ?? '',
            actualDates[row.id]?.report ?? row.report_completed_at ?? '',
            overdue ? 'متأخر' : row.visited_at && row.report_completed_at ? 'مكتمل' : 'قيد المتابعة',
          ];
        }),
      }]);
    } catch (error) {
      setMessage(`تعذر تصدير الخطة: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setExportingPlan(false);
    }
  };

  return (
    <div className="monthly-plan-page grid gap-5">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-sm text-slate-500">الخطط الشهرية · متابعة المدارس والإنجاز</p>
        <h2 className="mt-1 text-2xl font-bold text-brand-900">خطة {planTitles[planType]}</h2></div>
        <div className="flex flex-wrap gap-2"><ImportWizardLauncher target={{ kind: 'monthly', planType }} profile={profile} />
          {activePlan && canCreate && <><button type="button" onClick={() => deletePlan.mutate({ rowsOnly: true })} className="rounded-lg border border-rose-300 px-3 py-2 text-sm text-rose-800">مسح صفوف الخطة</button><button type="button" onClick={() => deletePlan.mutate({ rowsOnly: false })} className="rounded-lg bg-rose-700 px-3 py-2 text-sm text-white">حذف الخطة</button></>}</div>
      </section>
      {loadError && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">تعذر تحميل بيانات الخطط أو المدارس: {loadErrorDetails}</div>}

      <section className="card grid gap-4 p-5">
        <div>
          <h3 className="font-bold text-slate-900">إنشاء خطة وتوزيع المواعيد</h3>
          <p className="mt-1 text-sm text-slate-500">المدارس المؤهلة تُحدد من قواعد المدير. لا تُستخدم قيم مصدر غير معتمدة.</p>
        </div>
        {!candidates.data?.eligibility ? (
          <div className="rounded-lg bg-amber-50 p-4 text-sm leading-7 text-amber-950">لم تُعتمد مطابقة أهلية المدارس. اطلب من مدير النظام ضبطها في «المزامنة والإعدادات» قبل إنشاء الخطة.</div>
        ) : <>
          <div className="grid items-start gap-3 sm:grid-cols-2">
            <label className="grid min-w-0 grid-rows-[1.25rem_2.75rem_2.5rem] gap-1 text-sm font-semibold">
              <span>الشهر</span>
              <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="box-border h-11 w-full rounded-lg border border-slate-300 px-3 py-2" />
              <span aria-hidden="true" />
            </label>
            <label className="grid min-w-0 grid-rows-[1.25rem_2.75rem_2.5rem] gap-1 text-sm font-semibold">
              <span>{activePlan ? 'احتساب التأخر في الخطة الحالية' : 'احتساب التأخر للخطة الجديدة'}</span>
              <span className="flex h-11 min-w-0 gap-2">
                <select
                  value={(activePlan ? activePlanLateByPlannedDate : newPlanLateByPlannedDate) ? 'planned-date' : 'performance'}
                  onChange={(event) => {
                    const byPlannedDate = event.target.value === 'planned-date';
                    if (activePlan) setActivePlanLateByPlannedDate(byPlannedDate);
                    else setNewPlanLateByPlannedDate(byPlannedDate);
                  }}
                  disabled={!canCreate}
                  className="box-border h-11 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2"
                >
                  <option value="planned-date">حسب التاريخ المخطط لكل زيارة</option>
                  <option value="performance">حسب وتيرة الإنجاز حتى نهاية الشهر</option>
                </select>
                {activePlan && canCreate && <button
                  type="button"
                  onClick={() => updateLateAccounting.mutate()}
                  disabled={updateLateAccounting.isPending || activePlanLateByPlannedDate === activePlan.late_by_planned_date}
                  className="h-11 shrink-0 rounded-lg bg-brand-700 px-3 text-xs font-bold text-white disabled:opacity-50"
                >
                  حفظ
                </button>}
              </span>
              <span className="text-xs font-normal leading-5 text-slate-500">
                {activePlan
                  ? 'يُطبّق الحفظ الاختيار على الخطة المنشأة ويحدّث مؤشرات التأخر.'
                  : 'وتيرة الإنجاز توزّع المطلوب على أيام العمل للشهر وتحتسب الفرق عن الزيارات المنجزة.'}
              </span>
            </label>
          </div>
          {candidates.isLoading ? <p role="status">جارٍ تحميل المدارس…</p> : !monthEnd ? <p role="alert" className="text-sm text-rose-700">اختر شهراً صالحاً.</p> : eligibleSchools.length === 0 ? <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">لا توجد مدارس مؤهلة وفق المطابقة الحالية.</p> : (
            <SupervisorPlanGenerator
              key={`${planType}-${month}`}
              schools={schedulerSchools}
              initialSchoolIds={eligibleIds}
              maintenanceMode={planType === 'maintenance'}
              startDate={`${month}-01`}
              endDate={monthEnd}
              minDate={`${month}-01`}
              maxDate={monthEnd}
              disabled={!canCreate}
              saving={createPlan.isPending}
              onSave={(assignments) => createPlan.mutate({ assignments, lateByPlannedDate: newPlanLateByPlannedDate })}
            />
          )}
        </>}
        {!canCreate && <p className="text-xs text-slate-500">إنشاء الخطة متاح لمهندس المنطقة أو مدير المشروع أو مدير النظام.</p>}
        {message && <p role="status" className="text-sm text-slate-700">{message}</p>}
      </section>

      <section className="card grid gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h3 className="font-bold text-slate-900">الخطط المنشأة</h3><p className="mt-1 text-sm text-slate-500">زيارة: {formatNumber(completedVisits)} · تقرير مكتمل: {formatNumber(completedReports)}</p></div>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="اختر خطة للشهر" value={activePlanId} onChange={(event) => setActivePlanId(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2">
              {(plans.data ?? []).map((plan) => <option key={plan.id} value={plan.id}>{plan.plan_month.slice(0, 7)}</option>)}
              {!plans.data?.length && <option value="">لا توجد خطط</option>}
            </select>
            {activePlan && planType === 'cleaning' && canCreate && rows.data && <button
              type="button"
              onClick={() => updateCleaningSupervisors.mutate()}
              disabled={updateCleaningSupervisors.isPending || !cleaningSupervisorChanges.length}
              className="rounded-lg border border-brand-700 px-3 py-2 text-sm font-semibold text-brand-800 disabled:opacity-50"
              title="تحديث أسماء المشرفين من عمود «اسم المشرف (نظافة)» في قاعدة بيانات المدارس"
            >
              {updateCleaningSupervisors.isPending
                ? 'جارٍ تحديث الأسماء…'
                : `تحديث المشرفين من قاعدة المدارس (${formatNumber(cleaningSupervisorChanges.length)})`}
            </button>}
            {activePlan && canRedistribute && rows.data && <button
                type="button"
                onClick={() => setRedistributionOpen(true)}
                className="rounded-lg bg-brand-700 px-3 py-2 text-sm font-semibold text-white"
            >
                إعادة توزيع المتبقي
            </button>}
          </div>
        </div>
        {activePlan && rows.data && <div className="flex flex-wrap items-end gap-3 rounded-lg bg-slate-50 p-3">
          <label className="grid min-w-56 flex-1 gap-1 text-sm font-semibold">
            البحث عن مدرسة
            <input
              type="search"
              value={schoolSearch}
              onChange={(event) => setSchoolSearch(event.target.value)}
              placeholder="اسم المدرسة أو الرقم الوزاري"
              aria-label="البحث باسم المدرسة أو الرقم الوزاري"
              className="min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2"
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold">حالة الزيارة
            <select value={visitFilter} onChange={(event) => setVisitFilter(event.target.value as PlanCompletionFilter)} className="rounded-lg border border-slate-300 bg-white px-3 py-2">
              <option value="all">جميع المدارس</option>
              <option value="completed">تمت زيارتها</option>
              <option value="incomplete">لم تتم زيارتها</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm font-semibold">حالة التقرير
            <select value={reportFilter} onChange={(event) => setReportFilter(event.target.value as PlanCompletionFilter)} className="rounded-lg border border-slate-300 bg-white px-3 py-2">
              <option value="all">جميع الحالات</option>
              <option value="completed">تم تقريرها</option>
              <option value="incomplete">لم يتم تقريرها</option>
            </select>
          </label>
          <span className="text-sm text-slate-500">عرض {formatNumber(filteredPlanRows.length)} من {formatNumber(rows.data.length)} مدرسة</span>
        </div>}
        {rows.isLoading ? <p role="status">جارٍ تحميل صفوف الخطة…</p> : !activePlan ? <p className="rounded-lg bg-slate-50 p-5 text-center text-sm text-slate-500">لا توجد خطة من هذا النوع بعد.</p> : (
          <>
            <details className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <summary className="cursor-pointer text-sm font-bold text-brand-900">جودة بيانات الخطة</summary>
              <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                <QualityBadge label="صفوف دون مشرف" count={missingSupervisorCount} />
                <QualityBadge label="صفوف دون موعد مخطط" count={(rows.data ?? []).filter((row) => !row.planned_date).length} />
                <QualityBadge label="تقارير مرفوعة دون زيارة" count={(rows.data ?? []).filter((row) => Boolean(row.report_completed_at) && !row.visited_at).length} />
              </div>
            </details>
            <BulkPlanUpdates
              key={activePlan.id}
              planKind="monthly"
              planId={activePlan.id}
              disabled={!canUpdate}
              rows={(rows.data ?? []).map((row) => ({
                id: row.id,
                schoolName: row.school?.school_name ?? row.school_id,
                ministryNumber: row.school?.ministry_number ?? '',
                ministryKey: row.school?.ministry_key ?? '',
                supervisorName: planType === 'cleaning'
                  ? cleaningSupervisorName({
                    id: row.id,
                    supervisorName: row.supervisor_name,
                    schoolSourceFields: row.school?.source_fields ?? null,
                  })
                  : row.supervisor_name,
                visited: row.visited,
                visitedAt: row.visited_at,
                reportAt: row.report_completed_at,
              }))}
              allSchools={(candidates.data?.schools ?? []).map((school) => ({
                schoolName: school.school_name,
                ministryNumber: school.ministry_number,
                ministryKey: school.ministry_key,
              }))}
              onUpdated={() => Promise.all([
                queryClient.invalidateQueries({ queryKey: ['monthly-plan-rows', activePlanId] }),
                queryClient.invalidateQueries({ queryKey: ['dashboard-plan-rows'] }),
              ]).then(() => undefined)}
            />
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void exportPlan()}
                disabled={!filteredPlanRows.length || exportingPlan}
                className="inline-flex items-center gap-2 rounded-lg border border-brand-700 px-3 py-2 text-sm font-semibold text-brand-800 disabled:opacity-50"
              >
                <Download size={16} aria-hidden="true" />
                {exportingPlan ? 'جارٍ التصدير…' : 'تصدير Excel'}
              </button>
            </div>
            <div className="table-scroll monthly-plan-table-scroll">
              <table className="monthly-plan-table">
                <thead><tr><th>المدرسة</th><th>الموعد المخطط</th>{planType === 'security_safety' || planType === 'elevators' ? <th>الشركة</th> : null}<th>تاريخ الزيارة</th><th>تاريخ إنجاز التقرير</th><th>الحالة والإجراءات</th></tr></thead>
                <tbody>{filteredPlanRows.map((row) => {
                  const dates = actualDates[row.id] ?? { visited: row.visited_at ?? '', report: row.report_completed_at ?? '' };
                  const overdue = activePlan.late_by_planned_date
                    ? isPlanRowOverdue({
                      plannedDate: row.planned_date,
                      visitedAt: row.visited_at,
                      reportCompletedAt: row.report_completed_at,
                    }, today)
                    : today > monthEnd && !row.report_completed_at;
                  const supervisorName = planType === 'cleaning'
                    ? cleaningSupervisorName({
                      id: row.id,
                      supervisorName: row.supervisor_name,
                      schoolSourceFields: row.school?.source_fields ?? null,
                    })
                    : row.supervisor_name;
                  return <tr key={row.id}>
                    <td>{row.school?.school_name ?? row.school_id}<small className="block text-xs text-slate-400">{row.school?.ministry_number}</small>{supervisorName && <small className="block text-xs text-slate-500">المشرف: {supervisorName}</small>}</td>
                    <td>
                      {canEditSchedule ? <DateEditor
                        value={plannedDates[row.id] ?? row.planned_date}
                        onChange={(value) => setPlannedDates((current) => ({ ...current, [row.id]: value }))}
                        onSave={() => savePlannedDate(row)}
                        label="حفظ الموعد"
                        inputLabel={`الموعد المخطط لمدرسة ${row.school?.school_name ?? ''}`}
                        disabled={editPlanRow.isPending
                          || !(plannedDates[row.id] ?? row.planned_date)
                          || (plannedDates[row.id] ?? row.planned_date) === row.planned_date}
                      /> : formatDate(row.planned_date)}
                      {row.edited_at && <span
                        className="ms-2 inline-flex rounded-full bg-indigo-50 px-2 py-1 text-[0.68rem] font-semibold text-indigo-800"
                        title={`الموعد الأصلي: ${row.original_planned_date ? formatDate(row.original_planned_date) : 'غير متاح'}`}
                        aria-label={`معدّلة. الموعد الأصلي: ${row.original_planned_date ? formatDate(row.original_planned_date) : 'غير متاح'}`}
                      >معدّلة</span>}
                    </td>
                    {(planType === 'security_safety' || planType === 'elevators') && <td>{row.contractor_name ?? '—'}</td>}
                    <td><DateEditor value={dates.visited} onChange={(value) => setActualDates((current) => ({ ...current, [row.id]: { ...dates, visited: value } }))} onSave={() => updateRow.mutate({ rowId: row.id, field: 'visited_at', value: dates.visited || null })} label="حفظ الزيارة" inputLabel="تاريخ الزيارة" disabled={!canUpdate || updateRow.isPending} /></td>
                    <td><DateEditor value={dates.report} onChange={(value) => setActualDates((current) => ({ ...current, [row.id]: { ...dates, report: value } }))} onSave={() => updateRow.mutate({ rowId: row.id, field: 'report_completed_at', value: dates.report || null })} label="حفظ التقرير" inputLabel="تاريخ إنجاز التقرير" disabled={!canUpdate || updateRow.isPending} /></td>
                    <td>
                      <span>{overdue ? <span className="rounded-full bg-rose-50 px-2 py-1 text-xs text-rose-800">متأخر</span> : row.visited_at && row.report_completed_at ? 'مكتمل' : 'قيد المتابعة'}</span>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {canEditSchedule && <button type="button" className="inline-flex items-center gap-1 rounded border border-brand-200 px-2 py-1 text-xs font-semibold text-brand-800" onClick={() => {
                          editPlanRow.reset();
                          setEditingRowId(row.id);
                        }}><Pencil size={13} aria-hidden="true" />تعديل</button>}
                        {canCreate && <button type="button" className="text-xs text-rose-700 underline" onClick={() => deleteRow.mutate(row.id)}>حذف الصف</button>}
                      </div>
                    </td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
            {rows.data?.length === 0 && <p className="text-sm text-slate-500">لا توجد مدارس في هذه الخطة.</p>}
            {rows.data && rows.data.length > 0 && filteredPlanRows.length === 0 && <p className="text-sm text-slate-500">لا توجد مدارس تطابق البحث والفلاتر المحددة.</p>}
          </>
        )}
      </section>
      <p className="text-xs leading-6 text-slate-400">تُستثنى الجمعة والسبت افتراضياً ويمكن تعديل أيام العطلة عند التوزيع. قواعد الأهلية قابلة للتهيئة؛ راجع <Link to="/schools" className="text-brand-700 underline">بيانات المدارس</Link>.</p>
      {editingRow && <MonthlyPlanRowEditDialog
        row={editingRow}
        rows={editableRows}
        allSchools={(candidates.data?.schools ?? []).map((school) => ({
          id: school.id,
          school_name: school.school_name,
          ministry_number: school.ministry_number,
          ministry_key: school.ministry_key,
        }))}
        eligibleSchools={eligibleSchools.map((school) => ({
          id: school.id,
          school_name: school.school_name,
          ministry_number: school.ministry_number,
          ministry_key: school.ministry_key,
        }))}
        supervisors={editSupervisors.data ?? []}
        supervisorError={editSupervisors.error instanceof Error ? editSupervisors.error.message : undefined}
        saving={editPlanRow.isPending}
        error={editPlanRow.error instanceof Error ? editPlanRow.error.message : undefined}
        onClose={() => {
          if (!editPlanRow.isPending) setEditingRowId('');
        }}
        onSave={(request) => editPlanRow.mutate(request)}
      />}
      {redistributionOpen && activePlan && <MonthlyPlanRedistribution
        planId={activePlan.id}
        planMonth={activePlan.plan_month}
        rows={(rows.data ?? []).map((row) => ({
          id: row.id,
          schoolId: row.school_id,
          schoolName: row.school?.school_name ?? row.school_id,
          supervisorId: row.supervisor_id,
          supervisorName: row.supervisor_name,
          plannedDate: row.planned_date,
          visited: row.visited,
        }))}
        onClose={() => setRedistributionOpen(false)}
        onSaved={() => setMessage('تمت إعادة توزيع الزيارات المتبقية وتسجيل التغييرات.')}
      />}
    </div>
  );
}

function DateEditor({ value, onChange, onSave, label, inputLabel, disabled }: {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  label: string;
  inputLabel: string;
  disabled: boolean;
}) {
  return <div className="flex items-center gap-2">
    <input type="date" aria-label={inputLabel} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} className="rounded border border-slate-300 px-2 py-1 disabled:bg-slate-50" />
    <button type="button" onClick={onSave} disabled={disabled} className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50">{label}</button>
  </div>;
}

function QualityBadge({ label, count }: { label: string; count: number }) {
  return <div className={`flex items-center justify-between rounded-lg border px-3 py-2 ${count ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>
    <span>{label}</span><strong>{count}</strong>
  </div>;
}

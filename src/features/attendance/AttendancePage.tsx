import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Check, FileDown, FileSpreadsheet, LockKeyhole, Printer, Search, Upload, X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { getAbsentRosterIds, isBulkAttendanceDateAllowed, getAttendanceDays, summarizeAttendance } from '../../domain/attendance';
import { normalizeAttendanceIdentity, planAttendanceRosterImport } from '../../domain/attendanceImport';
import { getStampBytes, uploadStamp } from '../../lib/privateAssets';
import { useDisplayFormat } from '../../app/useDisplayFormat';
import { usePermission } from '../../app/permissionContext';
import { supabase } from '../../lib/supabase';
import { loadXlsx } from '../../lib/xlsx';
import { exportAttendanceXlsx } from './attendanceExcel';
import { printAttendancePdf } from './attendancePdf';

const rosterSchema = z.object({
  id: z.string().uuid(),
  month: z.string(),
  sort_no: z.number().int(),
  school_name: z.string(),
  school_id: z.string().uuid().nullable(),
  worker_name: z.string(),
  worker_id_number: z.string().nullable(),
  assignment_id: z.string().uuid().nullable(),
  source: z.enum(['placement', 'import']),
  remarks: z.string().nullable(),
});

const markSchema = z.object({ roster_id: z.string().uuid(), day: z.string() });
const monthSchema = z.object({
  month: z.string(),
  locked: z.boolean(),
  non_working_weekdays: z.array(z.number().int().min(0).max(6)),
});

type AttendanceRoster = z.infer<typeof rosterSchema>;
type AttendanceMark = z.infer<typeof markSchema>;
type AttendanceData = {
  rosters: AttendanceRoster[];
  marks: AttendanceMark[];
  settings: z.infer<typeof monthSchema> | null;
};
type AttendanceMutation = {
  month: string;
  rosterIds: string[];
  days: string[];
  present: boolean;
  source: 'cell' | 'bulk';
};
type AttendanceImportRow = {
  school_name: string;
  worker_name: string;
  worker_id_number: string | null;
  sourceRow: number;
  duplicateIdentity: boolean;
  invalidIdentity: boolean;
  errors: string[];
};
type AttendanceImportColumns = {
  school: string;
  worker: string;
  identity: string;
};
type ReplaceRosterMutation = {
  month: string;
  rows: Array<{
    sort_no: number;
    school_name: string;
    worker_name: string;
    worker_id_number: string | null;
  }>;
  confirmAttendanceDeletion: boolean;
};

const MONTH_NAMES = new Intl.DateTimeFormat('ar-SA-u-ca-gregory', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const ROW_HEIGHT = 46;
const OVERSCAN_ROWS = 5;
const ATTENDANCE_MIGRATION = '202611210001_attendance_rosters.sql';
const ATTENDANCE_MARKS_PAGINATION_MIGRATION = '202611210005_attendance_marks_pagination.sql';
const ATTENDANCE_MARKS_PAGE_SIZE = 1000;
const DEFAULT_NON_WORKING_WEEKDAYS = [5];

function currentIsoDate(): string {
  const date = new Date();
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function monthIsoDate(month: string): string {
  return `${month}-01`;
}

function previousIsoDate(date: string): string {
  const previous = new Date(`${date}T00:00:00.000Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return previous.toISOString().slice(0, 10);
}

function findImportColumn(headers: readonly string[], aliases: readonly string[]): string {
  const index = headers.findIndex((header) => {
    const normalized = header.trim().toLocaleLowerCase().replace(/\s+/g, '');
    return aliases.includes(normalized);
  });
  return index < 0 ? '' : String(index);
}

function monthLabel(month: string, formatNumber: (value: string | number) => string): string {
  const date = new Date(`${month}-01T00:00:00.000Z`);
  const label = MONTH_NAMES.format(date);
  return formatNumber(label);
}

function defaultBulkDate(month: string, today: string): string {
  const days = getAttendanceDays(month, [5]);
  if (today.slice(0, 7) === month) return today;
  if (month < today.slice(0, 7)) return days[days.length - 1].date;
  return days[0].date;
}

function friendlyDatabaseError(error: Error): string {
  const databaseError = error as Error & { code?: string };
  if (['PGRST202', '42883'].includes(databaseError.code ?? '') && error.message.includes('get_attendance_marks')) {
    return `يلزم تطبيق ${ATTENDANCE_MARKS_PAGINATION_MIGRATION} لقراءة سجلات التحضير.`;
  }
  if (['PGRST202', 'PGRST205', '42883', '42P01'].includes(databaseError.code ?? '')) {
    return `تعذر الوصول إلى جداول أو دوال التحضير. يلزم تطبيق ${ATTENDANCE_MIGRATION} أولاً.`;
  }
  return error.message;
}

async function loadAttendance(month: string): Promise<AttendanceData> {
  if (!supabase) throw new Error('يلزم إعداد اتصال قاعدة البيانات لعرض تحضير العمالة.');
  const client = supabase;
  const [monthResult, rosterResult, marks] = await Promise.all([
    client.from('attendance_months')
      .select('month,locked,non_working_weekdays')
      .eq('month', monthIsoDate(month))
      .maybeSingle(),
    client.from('attendance_rosters_with_identity')
      .select('id,month,sort_no,school_name,school_id,worker_name,worker_id_number,assignment_id,source,remarks')
      .eq('month', monthIsoDate(month))
      .order('sort_no', { ascending: true }),
    loadAttendanceMarks(client, month),
  ]);
  for (const result of [monthResult, rosterResult]) {
    if (result.error) throw result.error;
  }
  return {
    settings: monthResult.data ? monthSchema.parse(monthResult.data) : null,
    rosters: z.array(rosterSchema).parse(rosterResult.data),
    marks,
  };
}

async function loadAttendanceMarks(client: NonNullable<typeof supabase>, month: string): Promise<AttendanceMark[]> {
  const marks: AttendanceMark[] = [];
  for (let offset = 0; ; offset += ATTENDANCE_MARKS_PAGE_SIZE) {
    const { data, error } = await client.rpc('get_attendance_marks', {
      p_month: monthIsoDate(month),
      p_offset: offset,
      p_limit: ATTENDANCE_MARKS_PAGE_SIZE,
    });
    if (error) throw error;
    const page = z.array(markSchema).parse(data);
    marks.push(...page);
    if (page.length < ATTENDANCE_MARKS_PAGE_SIZE) return marks;
  }
}

function getMonthOptions(today: string): string[] {
  const [year, month] = today.slice(0, 7).split('-').map(Number);
  return Array.from({ length: 25 }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 - index, 1));
    return date.toISOString().slice(0, 7);
  });
}

export function AttendancePage() {
  const queryClient = useQueryClient();
  const { formatNumber } = useDisplayFormat();
  const canManage = usePermission('attendance.manage');
  const canImport = usePermission('attendance.import');
  const canExport = usePermission('attendance.export');
  const today = currentIsoDate();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [search, setSearch] = useState('');
  const [schoolFilter, setSchoolFilter] = useState('');
  const [message, setMessage] = useState('');
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [bulkSelectedDays, setBulkSelectedDays] = useState<string[]>([]);
  const [absenceFilterDate, setAbsenceFilterDate] = useState<string | null>(null);
  const [optimisticMarks, setOptimisticMarks] = useState<Record<string, boolean>>({});
  const [pendingCells, setPendingCells] = useState<Set<string>>(() => new Set());
  const [remarkDrafts, setRemarkDrafts] = useState<Record<string, string>>({});
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importHeaders, setImportHeaders] = useState<string[]>([]);
  const [importDataRows, setImportDataRows] = useState<string[][]>([]);
  const [importColumns, setImportColumns] = useState<AttendanceImportColumns>({ school: '', worker: '', identity: '' });
  const [importError, setImportError] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [uploadingStamp, setUploadingStamp] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stampFileInputRef = useRef<HTMLInputElement>(null);
  const promptedMonths = useRef(new Set<string>());
  const [scrollTop, setScrollTop] = useState(0);

  const attendanceQuery = useQuery({
    queryKey: ['attendance-roster', month],
    queryFn: () => loadAttendance(month),
    enabled: canManage,
  });
  const data = attendanceQuery.data;
  const nonWorkingWeekdays = data?.settings?.non_working_weekdays ?? DEFAULT_NON_WORKING_WEEKDAYS;
  const locked = data?.settings?.locked ?? false;
  const days = useMemo(() => getAttendanceDays(month, nonWorkingWeekdays), [month, nonWorkingWeekdays]);
  const marksByRoster = useMemo(() => {
    const result = new Map<string, Set<string>>();
    for (const mark of data?.marks ?? []) {
      const dates = result.get(mark.roster_id) ?? new Set<string>();
      dates.add(mark.day);
      result.set(mark.roster_id, dates);
    }
    return result;
  }, [data?.marks]);
  const absenceAlerts = useMemo(() => {
    if (month !== today.slice(0, 7) || !data) return [];
    const yesterday = previousIsoDate(today);
    return [
      { date: today, label: 'اليوم' },
      { date: yesterday, label: 'أمس' },
    ].flatMap(({ date, label }) => {
      if (date.slice(0, 7) !== month || date > today) return [];
      const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
      if (nonWorkingWeekdays.includes(weekday)) return [];
      const absentIds = getAbsentRosterIds(
        data.rosters.map((row) => row.id),
        new Set(data.marks.filter((mark) => mark.day === date).map((mark) => mark.roster_id)),
        date,
        month,
        nonWorkingWeekdays,
        today,
      );
      return absentIds.length > 0 ? [{ date, label, absentIds }] : [];
    });
  }, [data, month, nonWorkingWeekdays, today]);
  const selectedImportColumns = [importColumns.school, importColumns.worker, importColumns.identity];
  const importMappingReady = selectedImportColumns.every((column) => column !== '')
    && new Set(selectedImportColumns).size === selectedImportColumns.length;
  const mappedImportRows = useMemo<AttendanceImportRow[]>(() => {
    if (!importMappingReady) return [];
    const schoolIndex = Number(importColumns.school);
    const workerIndex = Number(importColumns.worker);
    const identityIndex = Number(importColumns.identity);
    const rows = importDataRows.flatMap((cells, index) => {
      if (cells.every((cell) => !cell.trim())) return [];
      const schoolName = cells[schoolIndex]?.trim() ?? '';
      const workerName = cells[workerIndex]?.trim() ?? '';
      const identityValue = normalizeAttendanceIdentity(cells[identityIndex] ?? '');
      return [{
        school_name: schoolName,
        worker_name: workerName,
        worker_id_number: identityValue || null,
        sourceRow: index + 2,
        duplicateIdentity: false,
        invalidIdentity: !/^\d{10}$/.test(identityValue),
        errors: [
          ...(!schoolName ? ['اسم المدرسة مطلوب'] : []),
          ...(!workerName ? ['اسم العامل مطلوب'] : []),
        ],
      }];
    });
    const identityCounts = new Map<string, number>();
    for (const row of rows) {
      if (row.worker_id_number) identityCounts.set(row.worker_id_number, (identityCounts.get(row.worker_id_number) ?? 0) + 1);
    }
    return rows.map((row) => ({
      ...row,
      duplicateIdentity: Boolean(row.worker_id_number && (identityCounts.get(row.worker_id_number) ?? 0) > 1),
    }));
  }, [importColumns.identity, importColumns.school, importColumns.worker, importDataRows, importMappingReady]);
  const importPlan = useMemo(() => {
    if (!importMappingReady) return { deleted: [], addedCount: 0, deletedWithAttendanceCount: 0 };
    return planAttendanceRosterImport(
      data?.rosters ?? [],
      mappedImportRows.map((row) => row.worker_id_number),
      new Set((data?.marks ?? []).map((mark) => mark.roster_id)),
    );
  }, [data?.marks, data?.rosters, importMappingReady, mappedImportRows]);
  const schoolNames = useMemo(
    () => [...new Set((data?.rosters ?? []).map((row) => row.school_name))].sort((a, b) => a.localeCompare(b, 'ar')),
    [data?.rosters],
  );
  const filteredRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return (data?.rosters ?? []).filter((row) =>
      (!schoolFilter || row.school_name === schoolFilter)
      && (!query || `${row.school_name} ${row.worker_name}`.toLocaleLowerCase().includes(query)),
    ).filter((row) => !absenceFilterDate || !marksByRoster.get(row.id)?.has(absenceFilterDate));
  }, [absenceFilterDate, data?.rosters, marksByRoster, schoolFilter, search]);
  const createRoster = useMutation({
    mutationFn: async (targetMonth: string) => {
      if (!supabase || !canManage) throw new Error('لا تملك صلاحية إنشاء كشف التحضير.');
      const { data: count, error } = await supabase.rpc('create_month_roster', {
        p_month: monthIsoDate(targetMonth),
      });
      if (error) throw error;
      return count;
    },
    onSuccess: async (count, targetMonth) => {
      setMessage(`تم إنشاء كشف الشهر وإضافة ${formatNumber(count ?? 0)} عاملاً.`);
      await queryClient.invalidateQueries({ queryKey: ['attendance-roster', targetMonth] });
    },
    onError: (error: Error) => setMessage(`تعذر إنشاء كشف التحضير: ${friendlyDatabaseError(error)}`),
  });

  const replaceRoster = useMutation({
    mutationFn: async ({ month: targetMonth, rows, confirmAttendanceDeletion }: ReplaceRosterMutation) => {
      if (!supabase || !canImport) throw new Error('لا تملك صلاحية استيراد كشف التحضير.');
      const { data: count, error } = await supabase.rpc('replace_roster', {
        p_month: monthIsoDate(targetMonth),
        p_rows: rows,
        p_confirm_attendance_deletion: confirmAttendanceDeletion,
      });
      if (error) throw error;
      return { count, month: targetMonth };
    },
    onSuccess: async ({ count, month: targetMonth }) => {
      setImportDialogOpen(false);
      setImportHeaders([]);
      setImportDataRows([]);
      setImportColumns({ school: '', worker: '', identity: '' });
      setImportError('');
      setMessage(`تم استبدال قائمة الشهر وإضافة ${formatNumber(count ?? 0)} عاملاً مع الاحتفاظ بتحضير العمال المطابقين بالهوية.`);
      await queryClient.invalidateQueries({ queryKey: ['attendance-roster', targetMonth] });
    },
    onError: (error: Error) => setImportError(`تعذر استيراد قائمة العمال: ${friendlyDatabaseError(error)}`),
  });

  const lockMonth = useMutation({
    mutationFn: async (targetMonth: string) => {
      if (!supabase || !canManage) throw new Error('لا تملك صلاحية قفل الشهر.');
      const { data: wasLocked, error } = await supabase.rpc('lock_attendance_month', {
        p_month: monthIsoDate(targetMonth),
      });
      if (error) throw error;
      return { wasLocked: Boolean(wasLocked), month: targetMonth };
    },
    onSuccess: async ({ wasLocked, month: targetMonth }) => {
      setMessage(wasLocked
        ? `تم قفل شهر ${monthLabel(targetMonth, formatNumber)}.`
        : 'هذا الشهر مقفل بالفعل.');
      await queryClient.invalidateQueries({ queryKey: ['attendance-roster', targetMonth] });
    },
    onError: (error: Error) => setMessage(`تعذر قفل الشهر: ${friendlyDatabaseError(error)}`),
  });

  const setAttendance = useMutation({
    mutationFn: async ({ rosterIds, days: selectedDays, present }: AttendanceMutation) => {
      if (!supabase || !canManage) throw new Error('لا تملك صلاحية تعديل التحضير.');
      let completedDays = 0;
      for (const day of selectedDays) {
        const { data: changedCount, error } = await supabase.rpc('set_attendance', {
          p_roster_ids: rosterIds,
          p_day: day,
          p_present: present,
        });
        if (error) {
          const reason = friendlyDatabaseError(error);
          if (completedDays > 0) {
            throw new Error(`تم حفظ التحضير في ${formatNumber(completedDays)} يومًا، ثم تعذر إكمال العملية: ${reason}`);
          }
          throw error;
        }
        if (present && changedCount !== rosterIds.length) {
          const reason = `لم يؤكد الخادم تحضير جميع العمال ليوم ${day} (${formatNumber(Number(changedCount ?? 0))} من ${formatNumber(rosterIds.length)}).`;
          if (completedDays > 0) {
            throw new Error(`تم حفظ التحضير في ${formatNumber(completedDays)} يومًا، ثم تعذر إكمال العملية: ${reason}`);
          }
          throw new Error(reason);
        }
        completedDays += 1;
      }
    },
    onSuccess: async (_count, variables) => {
      queryClient.setQueryData<AttendanceData>(['attendance-roster', variables.month], (previous) => {
        if (!previous) return previous;
        const selected = new Set(variables.rosterIds);
        const selectedDays = new Set(variables.days);
        const marks = previous.marks.filter((mark) => !(selected.has(mark.roster_id) && selectedDays.has(mark.day)));
        if (variables.present) {
          for (const rosterId of variables.rosterIds) {
            for (const day of variables.days) marks.push({ roster_id: rosterId, day });
          }
        }
        return { ...previous, marks };
      });
      setOptimisticMarks((current) => {
        const next = { ...current };
        for (const rosterId of variables.rosterIds) {
          for (const day of variables.days) delete next[`${rosterId}:${day}`];
        }
        return next;
      });
      if (variables.source === 'bulk') {
        setBulkDialogOpen(false);
        setBulkSelectedDays([]);
        setMessage(variables.days.length === 1
          ? `تم تحضير ${formatNumber(variables.rosterIds.length)} عاملاً ليوم ${variables.days[0]}.`
          : `تم تحضير ${formatNumber(variables.rosterIds.length)} عاملاً في ${formatNumber(variables.days.length)} يومًا.`);
      }
    },
    onError: (error: Error, variables) => {
      setOptimisticMarks((current) => {
        const next = { ...current };
        for (const rosterId of variables.rosterIds) {
          for (const day of variables.days) delete next[`${rosterId}:${day}`];
        }
        return next;
      });
      setMessage(`تعذر حفظ التحضير: ${friendlyDatabaseError(error)}`);
    },
    onSettled: async (_result, mutationError, variables) => {
      setPendingCells((current) => {
        const next = new Set(current);
        for (const rosterId of variables.rosterIds) {
          for (const day of variables.days) next.delete(`${rosterId}:${day}`);
        }
        return next;
      });
      const queryKey = ['attendance-roster', variables.month] as const;
      await queryClient.invalidateQueries({ queryKey });
      if (!mutationError && variables.present) {
        if (queryClient.getQueryState(queryKey)?.status === 'error') {
          setMessage('تم إرسال التحضير، لكن تعذرت إعادة قراءة البيانات للتحقق من حفظه. تحقق من الاتصال بقاعدة البيانات ثم حدّث الصفحة.');
          return;
        }
        const selectedMarks = new Set(variables.rosterIds.flatMap((rosterId) =>
          variables.days.map((day) => `${rosterId}:${day}`),
        ));
        const confirmedCount = queryClient.getQueryData<AttendanceData>(queryKey)?.marks
          .filter((mark) => selectedMarks.has(`${mark.roster_id}:${mark.day}`)).length ?? 0;
        if (confirmedCount !== selectedMarks.size) {
          setMessage(`تعذر التحقق من حفظ التحضير: أُعيد تحميل ${formatNumber(confirmedCount)} من ${formatNumber(selectedMarks.size)} علامة فقط. حدّث الصفحة وتحقق من الاتصال بقاعدة البيانات.`);
        }
      }
    },
  });

  const saveRemark = useMutation({
    mutationFn: async ({ rosterId, remarks, month: targetMonth }: { rosterId: string; remarks: string; month: string }) => {
      if (!supabase || !canManage) throw new Error('لا تملك صلاحية تعديل الملاحظات.');
      const { error } = await supabase.from('attendance_rosters')
        .update({ remarks: remarks || null })
        .eq('id', rosterId)
        .eq('month', monthIsoDate(targetMonth));
      if (error) throw error;
      return { rosterId, remarks, month: targetMonth };
    },
    onSuccess: async ({ rosterId, remarks, month: targetMonth }) => {
      queryClient.setQueryData<AttendanceData>(['attendance-roster', targetMonth], (previous) => previous
        ? { ...previous, rosters: previous.rosters.map((row) => row.id === rosterId ? { ...row, remarks: remarks || null } : row) }
        : previous);
      setRemarkDrafts((current) => {
        const next = { ...current };
        delete next[rosterId];
        return next;
      });
      setMessage('تم حفظ الملاحظة.');
      await queryClient.invalidateQueries({ queryKey: ['attendance-roster', targetMonth] });
    },
    onError: (error: Error) => setMessage(`تعذر حفظ الملاحظة: ${friendlyDatabaseError(error)}`),
  });

  useEffect(() => {
    setBulkSelectedDays([]);
    setAbsenceFilterDate(null);
    setOptimisticMarks({});
    setPendingCells(new Set());
    setRemarkDrafts({});
    setScrollTop(0);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [month, today]);

  useEffect(() => {
    setScrollTop(0);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [search, schoolFilter]);

  useEffect(() => {
    if (!canManage || attendanceQuery.isLoading || attendanceQuery.error || !data
      || data.rosters.length > 0 || promptedMonths.current.has(month) || createRoster.isPending) return;
    promptedMonths.current.add(month);
    if (window.confirm(`لا توجد قائمة عمال لشهر ${monthLabel(month, formatNumber)}. هل تريد إنشاءها من التسكين الحالي؟`)) {
      createRoster.mutate(month);
    }
  }, [attendanceQuery.isLoading, attendanceQuery.error, canManage, createRoster, data, formatNumber, month]);

  if (!canManage) {
    return <p role="alert" className="card p-5 text-sm text-rose-800">صفحة تحضير العمالة متاحة لمدير النظام ومدير المشروع فقط.</p>;
  }

  const presentDates = (rosterId: string) => marksByRoster.get(rosterId) ?? new Set<string>();
  const isMarked = (rosterId: string, day: string) =>
    optimisticMarks[`${rosterId}:${day}`] ?? presentDates(rosterId).has(day);
  const totalsByRoster = new Map(filteredRows.map((row) => [
    row.id,
    summarizeAttendance(presentDates(row.id), days),
  ]));

  const viewportHeight = scrollRef.current?.clientHeight ?? 540;
  const firstVisible = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS);
  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN_ROWS * 2;
  const virtualRows = filteredRows.slice(firstVisible, firstVisible + visibleCount);
  const topSpacerHeight = firstVisible * ROW_HEIGHT;
  const bottomSpacerHeight = Math.max(0, (filteredRows.length - firstVisible - virtualRows.length) * ROW_HEIGHT);
  const columnCount = 4 + days.length + 2 + 5 + 1;
  const bulkAvailableDays = days.filter((day) =>
    isBulkAttendanceDateAllowed(day.date, month, nonWorkingWeekdays, today),
  );
  const bulkSelectionAllowed = bulkSelectedDays.length > 0
    && bulkSelectedDays.every((day) => bulkAvailableDays.some((availableDay) => availableDay.date === day));
  const allBulkDaysSelected = bulkAvailableDays.length > 0 && bulkSelectedDays.length === bulkAvailableDays.length;

  function toggleAttendance(rosterId: string, day: string) {
    if (locked || days.find((item) => item.date === day)?.isNonWorking) return;
    const key = `${rosterId}:${day}`;
    if (pendingCells.has(key)) return;
    const present = !isMarked(rosterId, day);
    setOptimisticMarks((current) => ({ ...current, [key]: present }));
    setPendingCells((current) => new Set(current).add(key));
    setAttendance.mutate({ month, rosterIds: [rosterId], days: [day], present, source: 'cell' });
  }

  function requestBulkAttendance(day?: string) {
    const defaultDay = defaultBulkDate(month, today);
    const selectedDay = day ?? (isBulkAttendanceDateAllowed(defaultDay, month, nonWorkingWeekdays, today)
      ? defaultDay
      : bulkAvailableDays[bulkAvailableDays.length - 1]?.date);
    setBulkSelectedDays(selectedDay && bulkAvailableDays.some((availableDay) => availableDay.date === selectedDay)
      ? [selectedDay]
      : []);
    setBulkDialogOpen(true);
  }

  function confirmBulkAttendance() {
    if (!bulkSelectionAllowed || locked || filteredRows.length === 0 || setAttendance.isPending) return;
    const rosterIds = filteredRows.map((row) => row.id);
    const selectedDays = bulkAvailableDays
      .filter((day) => bulkSelectedDays.includes(day.date))
      .map((day) => day.date);
    setOptimisticMarks((current) => {
      const next = { ...current };
      for (const rosterId of rosterIds) {
        for (const day of selectedDays) next[`${rosterId}:${day}`] = true;
      }
      return next;
    });
    setPendingCells((current) => {
      const next = new Set(current);
      for (const rosterId of rosterIds) {
        for (const day of selectedDays) next.add(`${rosterId}:${day}`);
      }
      return next;
    });
    setAttendance.mutate({ month, rosterIds, days: selectedDays, present: true, source: 'bulk' });
  }

  function saveRemarkOnBlur(row: AttendanceRoster) {
    const remarks = remarkDrafts[row.id];
    if (remarks === undefined || remarks === (row.remarks ?? '') || saveRemark.isPending) return;
    saveRemark.mutate({ rosterId: row.id, remarks, month });
  }

  function startCreateRoster() {
    if (window.confirm(`سيتم إنشاء قائمة شهر ${monthLabel(month, formatNumber)} من التسكين الحالي. متابعة؟`)) {
      createRoster.mutate(month);
    }
  }

  function toggleAbsenceFilter(date: string) {
    setAbsenceFilterDate((current) => current === date ? null : date);
    setSearch('');
    setSchoolFilter('');
  }

  function startMonthLock() {
    if (locked || lockMonth.isPending) return;
    if (window.confirm(`سيتم قفل شهر ${monthLabel(month, formatNumber)} ولن يمكن تعديل تحضيره أو استيراد قائمته. هل تريد المتابعة؟`)) {
      lockMonth.mutate(month);
    }
  }

  function openImportDialog() {
    setImportHeaders([]);
    setImportDataRows([]);
    setImportColumns({ school: '', worker: '', identity: '' });
    setImportError('');
    setImportDialogOpen(true);
  }

  async function handleImportFile(file: File) {
    if (!/\.(xlsx|csv)$/i.test(file.name)) {
      setImportError('اختر ملف Excel بامتداد .xlsx أو ملف CSV.');
      return;
    }
    setImportHeaders([]);
    setImportDataRows([]);
    setImportColumns({ school: '', worker: '', identity: '' });
    setImportBusy(true);
    setImportError('');
    try {
      const XLSX = await loadXlsx();
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', raw: false });
      const firstSheet = workbook.SheetNames[0];
      if (!firstSheet) throw new Error('الملف لا يحتوي على ورقة بيانات.');
      const values = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[firstSheet], {
        header: 1,
        defval: '',
        raw: false,
      });
      const headers = (values[0] ?? []).map((value) => String(value ?? '').trim());
      if (headers.length < 3 || headers.every((header) => !header)) {
        throw new Error('يجب أن يحتوي الصف الأول على عناوين أعمدة المدرسة والاسم والهوية.');
      }
      const rows = values.slice(1).map((row) =>
        headers.map((_, index) => String(row[index] ?? '').trim()),
      );
      setImportHeaders(headers);
      setImportDataRows(rows);
      setImportColumns({
        school: findImportColumn(headers, ['المدرسة', 'مدرسة', 'اسمالمدرسة', 'school', 'schoolname']),
        worker: findImportColumn(headers, ['الاسم', 'اسم العامل', 'اسمالعامل', 'name', 'worker', 'workername']),
        identity: findImportColumn(headers, ['الهوية', 'رقمالهوية', 'الهويةالوطنية', 'رقمالهويةالوطنية', 'identity', 'id', 'residenceno']),
      });
    } catch (error) {
      setImportError(`تعذر قراءة ملف الاستيراد: ${error instanceof Error ? error.message : 'خطأ غير معروف'}`);
    } finally {
      setImportBusy(false);
    }
  }

  async function downloadImportTemplate() {
    try {
      const XLSX = await loadXlsx();
      const worksheet = XLSX.utils.aoa_to_sheet([['المدرسة', 'الاسم', 'الهوية'], ['', '', '']]);
      worksheet['!cols'] = [{ wch: 30 }, { wch: 30 }, { wch: 18 }];
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'قائمة العمال');
      XLSX.writeFile(workbook, 'نموذج-استيراد-العمالة.xlsx');
    } catch (error) {
      setMessage(`تعذر تحميل نموذج الاستيراد: ${error instanceof Error ? error.message : 'خطأ غير معروف'}`);
    }
  }

  async function exportAttendance() {
    if (!canExport || !data || data.rosters.length === 0 || exporting) return;
    setExporting(true);
    setMessage('');
    try {
      const stampBytes = await getStampBytes();
      await exportAttendanceXlsx({
        month,
        rows: data.rosters,
        marks: data.marks,
        days,
        stampBytes,
      });
      setMessage(`تم تصدير كشف تحضير شهر ${monthLabel(month, formatNumber)}.`);
    } catch (error) {
      setMessage(`تعذر تصدير ملف Excel: ${error instanceof Error ? error.message : 'خطأ غير معروف'}`);
    } finally {
      setExporting(false);
    }
  }

  async function exportAttendancePdf() {
    if (!canExport || !data || data.rosters.length === 0 || exportingPdf) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      setMessage('تعذر فتح نافذة الطباعة. اسمح بالنوافذ المنبثقة لهذه الصفحة.');
      return;
    }
    setExportingPdf(true);
    setMessage('');
    try {
      const stampBytes = await getStampBytes();
      await printAttendancePdf({
        month,
        rows: data.rosters,
        marks: data.marks,
        days,
        stampBytes,
      }, printWindow);
      setMessage(`تم فتح صفحة تصدير PDF لشهر ${monthLabel(month, formatNumber)}.`);
    } catch (error) {
      printWindow.close();
      setMessage(`تعذر تصدير ملف PDF: ${error instanceof Error ? error.message : 'خطأ غير معروف'}`);
    } finally {
      setExportingPdf(false);
    }
  }

  async function handleStampUpload(file: File) {
    setUploadingStamp(true);
    setMessage('');
    try {
      await uploadStamp(file);
      setMessage('تم رفع الختم إلى التخزين الخاص بنجاح. يمكنك الآن إعادة التصدير.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذر رفع الختم إلى التخزين الخاص.');
    } finally {
      setUploadingStamp(false);
    }
  }

  function saveImportedRoster() {
    if (locked || !importMappingReady || mappedImportRows.length === 0 || replaceRoster.isPending) return;
    const invalidRows = mappedImportRows.filter((row) => row.errors.length > 0);
    if (invalidRows.length > 0) {
      setImportError(`أكمل المدرسة والاسم في ${formatNumber(invalidRows.length)} صفوف قبل الحفظ.`);
      return;
    }
    let confirmAttendanceDeletion = false;
    if (importPlan.deletedWithAttendanceCount > 0) {
      const confirmed = window.confirm(
        `سيُحذف ${formatNumber(importPlan.deleted.length)} عاملًا، منهم ${formatNumber(importPlan.deletedWithAttendanceCount)} لديهم تحضير مسجل وسيُحذف تحضيرهم. هل تؤكد حذفهم؟`,
      );
      if (!confirmed) return;
      confirmAttendanceDeletion = true;
    }
    setImportError('');
    replaceRoster.mutate({
      month,
      confirmAttendanceDeletion,
      rows: mappedImportRows.map(({ school_name, worker_name, worker_id_number }, index) => ({
        sort_no: index + 1,
        school_name,
        worker_name,
        worker_id_number,
      })),
    });
  }

  return (
    <div className="attendance-page grid gap-4">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">سجل حضور عمال النظافة حسب الشهر والمدرسة</p>
          <h2 className="mt-1 text-2xl font-bold text-brand-900">تحضير العمالة</h2>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-sm font-semibold">
            الشهر
            <span className="relative">
              <CalendarDays size={17} className="pointer-events-none absolute inset-inline-start-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <select
                aria-label="اختر شهر التحضير"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
                className="min-w-52 rounded-lg border border-slate-300 bg-white py-2 ps-10 pe-3"
              >
                {getMonthOptions(today).map((option) => (
                  <option key={option} value={option}>{monthLabel(option, formatNumber)}</option>
                ))}
              </select>
            </span>
          </label>
          {!locked && (
            <button
              type="button"
              onClick={startMonthLock}
              disabled={lockMonth.isPending}
              className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 disabled:opacity-50"
            >
              <LockKeyhole size={16} /> {lockMonth.isPending ? 'جارٍ قفل الشهر…' : 'قفل الشهر'}
            </button>
          )}
          {canImport && <button
            type="button"
            onClick={() => void downloadImportTemplate()}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
          >
            <FileDown size={16} /> تحميل نموذج الاستيراد
          </button>}
          {canExport && <button
            type="button"
            onClick={() => void exportAttendance()}
            disabled={!data || data.rosters.length === 0 || attendanceQuery.isLoading || exporting
              || setAttendance.isPending || replaceRoster.isPending}
            className="inline-flex items-center gap-2 rounded-lg border border-brand-700 bg-white px-3 py-2 text-sm font-bold text-brand-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FileSpreadsheet size={16} /> {exporting ? 'جارٍ التصدير…' : 'تصدير Excel'}
          </button>}
          {canExport && <button
            type="button"
            onClick={() => void exportAttendancePdf()}
            disabled={!data || data.rosters.length === 0 || attendanceQuery.isLoading || exportingPdf
              || setAttendance.isPending || replaceRoster.isPending}
            className="inline-flex items-center gap-2 rounded-lg border border-rose-700 bg-white px-3 py-2 text-sm font-bold text-rose-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Printer size={16} /> {exportingPdf ? 'جارٍ تجهيز PDF…' : 'تصدير PDF'}
          </button>}
          <button
            type="button"
            onClick={() => stampFileInputRef.current?.click()}
            disabled={uploadingStamp}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Upload size={16} /> {uploadingStamp ? 'جارٍ رفع الختم…' : 'رفع الختم'}
          </button>
          <input
            ref={stampFileInputRef}
            type="file"
            accept=".png,image/png"
            disabled={uploadingStamp}
            className="sr-only"
            aria-label="اختر ملف الختم PNG"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void handleStampUpload(file);
              event.currentTarget.value = '';
            }}
          />
          {canImport && <button
            type="button"
            onClick={openImportDialog}
            disabled={!canImport || locked || !data || attendanceQuery.isLoading || replaceRoster.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-700 px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Upload size={16} /> استيراد قائمة العمال
          </button>}
        </div>
      </section>

      {absenceAlerts.length > 0 && (
        <section
          role="status"
          aria-label="تنبيه غياب العمال"
          className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"
        >
          <strong className="me-1">تنبيه الغياب:</strong>
          {absenceAlerts.map((alert) => (
            <button
              key={alert.date}
              type="button"
              aria-pressed={absenceFilterDate === alert.date}
              onClick={() => toggleAbsenceFilter(alert.date)}
              className={`rounded-lg px-3 py-1.5 font-semibold hover:bg-amber-100 ${absenceFilterDate === alert.date ? 'bg-amber-200' : 'bg-white/80'}`}
            >
              {alert.label}: {formatNumber(alert.absentIds.length)} عامل غير حاضر
            </button>
          ))}
          {absenceFilterDate && (
            <button
              type="button"
              onClick={() => setAbsenceFilterDate(null)}
              className="ms-auto underline underline-offset-2"
            >إظهار الجميع</button>
          )}
        </section>
      )}

      {attendanceQuery.error && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          تعذر تحميل كشف التحضير: {friendlyDatabaseError(attendanceQuery.error)}
        </div>
      )}
      {message && <div role="status" className="rounded-lg bg-brand-50 p-3 text-sm text-brand-900">{message}</div>}
      {locked && (
        <div role="status" className="flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <LockKeyhole size={17} /> هذا الشهر مقفل؛ لا يمكن تعديل الحضور أو استيراد القائمة أو الملاحظات.
        </div>
      )}

      <section className="card grid gap-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="relative min-w-48 flex-1 text-sm font-semibold">
            البحث بالمدرسة أو العامل
            <Search size={16} className="pointer-events-none absolute inset-inline-start-3 top-9 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 py-2 ps-9 pe-3"
              placeholder="اكتب اسم المدرسة أو العامل"
            />
          </label>
          <label className="grid min-w-48 gap-1 text-sm font-semibold">
            المدرسة
            <select
              value={schoolFilter}
              onChange={(event) => setSchoolFilter(event.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2"
            >
              <option value="">كل المدارس</option>
              {schoolNames.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <button
            type="button"
            disabled={locked || filteredRows.length === 0 || attendanceQuery.isLoading}
            onClick={() => requestBulkAttendance()}
            className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            تحضير الكل · {formatNumber(filteredRows.length)}
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span>انقر خلية اليوم لتبديل علامة الحضور. أيام عدم العمل غير قابلة للتحضير.</span>
          <span aria-live="polite">{formatNumber(filteredRows.length)} عاملًا ظاهرًا</span>
        </div>
      </section>

      {attendanceQuery.isLoading ? (
        <p role="status" className="card p-8 text-center text-slate-500">جارٍ تحميل كشف التحضير…</p>
      ) : data?.rosters.length === 0 ? (
        <section className="card grid justify-items-center gap-3 p-8 text-center">
          <p className="font-semibold text-slate-700">لا توجد قائمة عمال لهذا الشهر.</p>
          <button
            type="button"
            onClick={startCreateRoster}
            disabled={createRoster.isPending || locked}
            className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {createRoster.isPending ? 'جارٍ إنشاء القائمة…' : 'إنشاء القائمة من التسكين الحالي'}
          </button>
        </section>
      ) : data && (
        <section className="card grid min-w-0 gap-3 p-3 sm:p-4">
          {filteredRows.length === 0 ? (
            <p className="p-5 text-center text-sm text-slate-500">لا توجد نتائج مطابقة للفلاتر.</p>
          ) : (
            <div
              ref={scrollRef}
              className="attendance-table-scroll"
              role="region"
              aria-label="جدول تحضير العمالة"
              tabIndex={0}
              onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            >
              <table className="attendance-table" dir="rtl">
                <colgroup>
                  <col className="attendance-col-number" />
                  <col className="attendance-col-school" />
                  <col className="attendance-col-worker" />
                  <col className="attendance-col-identity" />
                  {days.map((day) => <col key={day.date} className="attendance-col-day" />)}
                  <col className="attendance-col-present" />
                  <col className="attendance-col-days-off" />
                  {['A', 'UL', 'AL', 'SL', 'HL'].map((status) => <col key={status} className="attendance-col-status" />)}
                  <col className="attendance-col-remarks" />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col" className="attendance-pin attendance-pin-1">S.No</th>
                    <th scope="col" className="attendance-pin attendance-pin-2">اسم المدرسة</th>
                    <th scope="col" className="attendance-pin attendance-pin-3">الاسم</th>
                    <th scope="col" className="attendance-pin attendance-pin-4">الهوية</th>
                    {days.map((day) => (
                      <th
                        key={day.date}
                        scope="col"
                        className={day.isNonWorking || day.isFriday ? 'attendance-off-day' : ''}
                      >
                        <button
                          type="button"
                          disabled={locked || day.isNonWorking}
                          onClick={() => requestBulkAttendance(day.date)}
                          title={day.isNonWorking ? 'يوم عدم عمل' : `تحضير كل العمال ليوم ${day.day}`}
                        >{formatNumber(day.day)}</button>
                      </th>
                    ))}
                    <th scope="col">Present Days</th>
                    <th scope="col">Day Offs</th>
                    <th scope="col">A</th>
                    <th scope="col">UL</th>
                    <th scope="col">AL</th>
                    <th scope="col">SL</th>
                    <th scope="col">HL</th>
                    <th scope="col">Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {topSpacerHeight > 0 && <tr aria-hidden="true"><td colSpan={columnCount} style={{ height: topSpacerHeight, padding: 0, border: 0 }} /></tr>}
                  {virtualRows.map((row) => {
                    const summary = totalsByRoster.get(row.id) ?? { presentDays: 0, dayOffs: 0 };
                    return (
                      <tr key={row.id} className="attendance-data-row">
                        <td className="attendance-pin attendance-pin-1 text-center" dir="ltr">{formatNumber(row.sort_no)}</td>
                        <td className="attendance-pin attendance-pin-2 attendance-truncate" title={row.school_name}>{row.school_name}</td>
                        <td className="attendance-pin attendance-pin-3 attendance-truncate" title={row.worker_name}>{row.worker_name}</td>
                        <td className="attendance-pin attendance-pin-4 text-center" dir="ltr">{row.worker_id_number || '—'}</td>
                        {days.map((day) => {
                          const key = `${row.id}:${day.date}`;
                          const marked = isMarked(row.id, day.date);
                          return (
                            <td key={day.date} className={day.isNonWorking || day.isFriday ? 'attendance-off-day' : ''}>
                              <button
                                type="button"
                                disabled={locked || day.isNonWorking || pendingCells.has(key)}
                                aria-label={`${marked ? 'إلغاء حضور' : 'تسجيل حضور'} ${row.worker_name}، ${row.school_name}، يوم ${formatNumber(day.day)}`}
                                aria-pressed={marked}
                                onClick={() => toggleAttendance(row.id, day.date)}
                                className={`attendance-mark-button ${marked ? 'is-marked' : ''}`}
                              >{marked ? <Check size={17} strokeWidth={3} /> : null}</button>
                            </td>
                          );
                        })}
                        <td className="text-center font-bold">{formatNumber(summary.presentDays)}</td>
                        <td className="text-center">{formatNumber(summary.dayOffs)}</td>
                        <td />
                        <td />
                        <td />
                        <td />
                        <td />
                        <td>
                          <input
                            aria-label={`ملاحظات ${row.worker_name}`}
                            value={remarkDrafts[row.id] ?? row.remarks ?? ''}
                            disabled={locked || saveRemark.isPending}
                            onChange={(event) => setRemarkDrafts((current) => ({ ...current, [row.id]: event.target.value }))}
                            onBlur={() => saveRemarkOnBlur(row)}
                            className="attendance-remarks-input"
                          />
                        </td>
                      </tr>
                    );
                  })}
                  {bottomSpacerHeight > 0 && <tr aria-hidden="true"><td colSpan={columnCount} style={{ height: bottomSpacerHeight, padding: 0, border: 0 }} /></tr>}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {bulkDialogOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="attendance-bulk-title">
          <section className="grid w-full max-w-lg gap-4 rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="attendance-bulk-title" className="text-lg font-bold text-brand-900">تأكيد التحضير الجماعي</h3>
                <p className="mt-1 text-sm text-slate-600">سيتم تسجيل الحضور للعاملين الظاهرين في الأيام المحددة بعد تطبيق الفلاتر.</p>
              </div>
              <button type="button" aria-label="إغلاق" onClick={() => setBulkDialogOpen(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={18} /></button>
            </div>
            <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={allBulkDaysSelected}
                disabled={bulkAvailableDays.length === 0 || setAttendance.isPending}
                onChange={(event) => setBulkSelectedDays(event.target.checked
                  ? bulkAvailableDays.map((day) => day.date)
                  : [])}
                className="size-4 accent-brand-700"
              />
              تحديد جميع أيام العمل المتاحة ({formatNumber(bulkAvailableDays.length)})
            </label>
            <div className="grid max-h-56 grid-cols-3 gap-2 overflow-y-auto rounded-lg border border-slate-200 p-3 sm:grid-cols-4">
              {bulkAvailableDays.map((day) => (
                <label key={day.date} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={bulkSelectedDays.includes(day.date)}
                    disabled={setAttendance.isPending}
                    onChange={(event) => setBulkSelectedDays((current) => event.target.checked
                      ? [...current, day.date]
                      : current.filter((selectedDay) => selectedDay !== day.date))}
                    className="size-4 accent-brand-700"
                  />
                  يوم {formatNumber(day.day)}
                </label>
              ))}
              {bulkAvailableDays.length === 0 && (
                <p className="col-span-full p-2 text-sm text-amber-800">لا توجد أيام عمل متاحة للتحضير في هذا الشهر.</p>
              )}
            </div>
            <div className={`rounded-lg p-3 text-sm ${bulkSelectionAllowed ? 'bg-brand-50 text-brand-900' : 'bg-amber-50 text-amber-900'}`}>
              {bulkSelectionAllowed
                ? `سيتم تحضير ${formatNumber(filteredRows.length)} عاملًا في ${formatNumber(bulkSelectedDays.length)} يومًا.`
                : 'حدد يوم عمل واحدًا على الأقل؛ الجمعة والأيام المستقبلية غير متاحة.'}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setBulkDialogOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold">إلغاء</button>
              <button
                type="button"
                disabled={!bulkSelectionAllowed || locked || filteredRows.length === 0 || setAttendance.isPending}
                onClick={confirmBulkAttendance}
                className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {setAttendance.isPending ? 'جارٍ الحفظ…' : `تأكيد تحضير ${formatNumber(filteredRows.length)} عاملًا`}
              </button>
            </div>
          </section>
        </div>
      )}

      {importDialogOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="attendance-import-title">
          <section className="grid w-full max-w-5xl gap-4 rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="attendance-import-title" className="text-lg font-bold text-brand-900">استيراد قائمة العمال</h3>
                <p className="mt-1 text-sm text-slate-600">ستُستبدل قائمة هذا الشهر فقط، مع الاحتفاظ بتحضير العامل المطابق برقم الهوية.</p>
              </div>
              <button
                type="button"
                aria-label="إغلاق"
                disabled={replaceRoster.isPending}
                onClick={() => setImportDialogOpen(false)}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50"
              ><X size={18} /></button>
            </div>
            <label className="grid gap-1 text-sm font-semibold">
              ملف Excel (.xlsx) أو CSV
              <input
                type="file"
                accept=".xlsx,.csv"
                disabled={importBusy || locked || replaceRoster.isPending}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (file) void handleImportFile(file);
                  event.currentTarget.value = '';
                }}
                className="rounded-lg border border-slate-300 p-2 text-sm"
              />
            </label>
            {importBusy && <p role="status" className="text-sm text-slate-600">جارٍ قراءة الملف…</p>}
            {importHeaders.length > 0 && (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  {([
                    ['school', 'عمود المدرسة'],
                    ['worker', 'عمود الاسم'],
                    ['identity', 'عمود الهوية'],
                  ] as const).map(([field, label]) => (
                    <label key={field} className="grid gap-1 text-sm font-semibold">
                      {label}
                      <select
                        value={importColumns[field]}
                        onChange={(event) => setImportColumns((current) => ({ ...current, [field]: event.target.value }))}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2"
                      >
                        <option value="">اختر عمودًا</option>
                        {importHeaders.map((header, index) => (
                          <option key={`${index}:${header}`} value={String(index)}>{header || `عمود ${formatNumber(index + 1)}`}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                {!importMappingReady && (
                  <p role="alert" className="text-sm text-amber-800">عيّن عمودًا مختلفًا لكل من المدرسة والاسم والهوية.</p>
                )}
                {importMappingReady && (
                  <>
                    <div className="flex flex-wrap gap-3 rounded-lg bg-slate-50 p-3 text-sm font-semibold text-slate-800">
                      <span>سيُحذف {formatNumber(importPlan.deleted.length)} وسيُضاف {formatNumber(importPlan.addedCount)}</span>
                      <span>تحذيرات التكرار: {formatNumber(mappedImportRows.filter((row) => row.duplicateIdentity).length)}</span>
                      <span>هويات غير مكونة من 10 أرقام: {formatNumber(mappedImportRows.filter((row) => row.invalidIdentity).length)}</span>
                    </div>
                    {mappedImportRows.some((row) => row.errors.length > 0) && (
                      <p role="alert" className="text-sm text-rose-700">
                        أكمل اسم المدرسة والعامل في كل صف قبل الحفظ ({formatNumber(mappedImportRows.filter((row) => row.errors.length > 0).length)} صفوف ناقصة).
                      </p>
                    )}
                    {mappedImportRows.length === 0 ? (
                      <p className="text-sm text-slate-500">لا توجد صفوف بيانات للمعاينة.</p>
                    ) : (
                      <div className="max-h-72 overflow-auto rounded-lg border border-slate-200">
                        <table className="w-full text-start text-sm">
                          <thead className="sticky top-0 bg-slate-100 text-slate-700">
                            <tr>
                              <th className="p-2">الصف</th>
                              <th className="p-2">المدرسة</th>
                              <th className="p-2">الاسم</th>
                              <th className="p-2">الهوية</th>
                              <th className="p-2">ملاحظات</th>
                            </tr>
                          </thead>
                          <tbody>
                            {mappedImportRows.slice(0, 100).map((row) => (
                              <tr key={row.sourceRow} className="border-t border-slate-100">
                                <td className="p-2">{formatNumber(row.sourceRow)}</td>
                                <td className="p-2">{row.school_name || '—'}</td>
                                <td className="p-2">{row.worker_name || '—'}</td>
                                <td className="p-2" dir="ltr">{row.worker_id_number || '—'}</td>
                                <td className="p-2">
                                  {row.errors.map((error) => <span key={error} className="me-2 text-rose-700">{error}</span>)}
                                  {row.duplicateIdentity && <span className="me-2 text-amber-700">هوية مكررة</span>}
                                  {row.invalidIdentity && <span className="text-amber-700">الهوية لا تتكون من 10 أرقام</span>}
                                  {!row.errors.length && !row.duplicateIdentity && !row.invalidIdentity && '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {mappedImportRows.length > 100 && (
                          <p className="p-2 text-xs text-slate-500">تُعرض أول 100 صف؛ سيشمل الاستيراد جميع الصفوف.</p>
                        )}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
            {importError && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{importError}</p>}
            {locked && <p role="alert" className="text-sm text-amber-800">الشهر مقفل ولا يمكن استيراد قائمته.</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setImportDialogOpen(false)}
                disabled={replaceRoster.isPending}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50"
              >إلغاء</button>
              <button
                type="button"
                onClick={saveImportedRoster}
                disabled={locked || !importMappingReady || mappedImportRows.length === 0
                  || mappedImportRows.some((row) => row.errors.length > 0)
                  || importBusy || replaceRoster.isPending}
                className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >{replaceRoster.isPending ? 'جارٍ استبدال القائمة…' : 'حفظ القائمة'}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

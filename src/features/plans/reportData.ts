import { useMemo } from 'react';
import type { AxisSummary, PlanReportView, ReportPlanRow } from '../../domain/planReport';

export type ReportFormatNumber = (value: string | number) => string;
export type ReportService = {
  id: string; label: string; planned: number; visited: number; visitRemaining: number; visitPercent: number;
  reportsDone: number; reportRemaining: number; reportPercent: number; overallPercent: number; expectedVisits: number;
  pillTone: 'on-track' | 'slightly-behind' | 'far-behind' | 'no-plan';
};
export type ReportSupervisor = { id: string; name: string; planned: number; visited: number; donePercent: number; latePercent: number };
export type ReportData = {
  monthLabel: string; asOfLabel: string; schools: number; planned: number;
  lastUpdate: string; status: { late: boolean; label: string }; logoPath: string; services: ReportService[];
  totalService: ReportService; summaryCards: Array<{ label: string; value: number; tone: string }>;
  supervisors: ReportSupervisor[]; chart: { points: Array<{ x: number; yActual: number; yPlanned: number; actualVisible: boolean }>; xLabels: Array<{ x: number; label: string }>; yTicks: Array<{ y: number; label: string }>; todayX: number; todayY: number; forecastY: number; forecastPoints: boolean; todayLabel: string; max: number };
  reports: { percent: number; uploaded: number; remaining: number; total: number; byService: Array<{ id: string; label: string; uploaded: number; planned: number }> }; formatNumber: ReportFormatNumber;
  lateItems: Array<{ id: string; schoolName: string; kind: string; plannedDate: string; daysLate: number; supervisorName: string }>;
  cleaningSupervisors: Array<{ id: string; name: string; planned: number; visited: number; reportsDone: number }>;
  Header?: unknown; Services?: unknown; Summary?: unknown; Supervisors?: unknown; Cumulative?: unknown; Reports?: unknown;
};

const labels: Record<string, string> = { maintenance: 'الصيانة والتكييف', cleaning: 'النظافة', security_safety: 'الأمن والسلامة', elevators: 'المصاعد' };
const formatDate = (date: string, formatNumber: ReportFormatNumber) => formatNumber(`${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`);
const formatMonth = (month: string, formatNumber: ReportFormatNumber) => `${new Intl.DateTimeFormat('ar-SA', { month: 'long' }).format(new Date(`${month}-01T00:00:00Z`))} ${formatNumber(month.slice(0, 4))}`;

function service(axis: AxisSummary, expectedVisits: number): ReportService {
  const overallPercent = axis.planned ? ((axis.visited + axis.reportsDone) / (2 * axis.planned)) * 100 : 0;
  const expectedPercent = axis.planned ? (expectedVisits / axis.planned) * 100 : 0;
  const gap = overallPercent - expectedPercent;
  return {
    id: axis.axis, label: labels[axis.axis], planned: axis.planned, visited: axis.visited,
    visitRemaining: Math.max(0, axis.planned - axis.visited), visitPercent: axis.visitPercent,
    reportsDone: axis.reportsDone, reportRemaining: Math.max(0, axis.planned - axis.reportsDone),
    reportPercent: axis.reportPercent, overallPercent, expectedVisits,
    pillTone: !axis.planned ? 'no-plan' : gap >= -5 ? 'on-track' : gap >= -15 ? 'slightly-behind' : 'far-behind',
  };
}

export function buildReportData(view: PlanReportView, rows: readonly ReportPlanRow[], month: string, asOf: string, formatNumber: ReportFormatNumber): ReportData {
  const services = (['maintenance', 'cleaning', 'security_safety', 'elevators'] as const).map((id) => {
    const axis = view.axes.find((item) => item.axis === id)!;
    return service(axis, rows.filter((row) => row.planType === id && row.plannedDate <= asOf).length);
  });
  const totalAxis = services.reduce((total, item) => ({ ...total, planned: total.planned + item.planned, visited: total.visited + item.visited, visitRemaining: total.visitRemaining + item.visitRemaining, reportsDone: total.reportsDone + item.reportsDone, reportRemaining: total.reportRemaining + item.reportRemaining }), { planned: 0, visited: 0, visitRemaining: 0, reportsDone: 0, reportRemaining: 0 });
  const totalOverall = totalAxis.planned ? ((totalAxis.visited + totalAxis.reportsDone) / (2 * totalAxis.planned)) * 100 : 0;
  const totalExpected = rows.filter((row) => row.plannedDate <= asOf).length;
  const totalService: ReportService = { id: 'total', label: 'الإجمالي', ...totalAxis, visitPercent: totalAxis.planned ? (totalAxis.visited / totalAxis.planned) * 100 : 0, reportPercent: totalAxis.planned ? (totalAxis.reportsDone / totalAxis.planned) * 100 : 0, overallPercent: totalOverall, expectedVisits: totalExpected, pillTone: totalAxis.planned ? (totalOverall - (totalExpected / totalAxis.planned) * 100 >= -5 ? 'on-track' : totalOverall - (totalExpected / totalAxis.planned) * 100 >= -15 ? 'slightly-behind' : 'far-behind') : 'no-plan' };
  const days = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const elapsed = Math.min(days, Math.max(0, Number(asOf.slice(8, 10))));
  const max = Math.max(1, totalAxis.planned);
  const points = view.daily.map((day, index) => ({ x: 70 + (880 * index / Math.max(1, view.daily.length - 1)), yActual: 260 - (200 * day.actual / max), yPlanned: 260 - (200 * day.planned / max), actualVisible: day.date <= asOf }));
  const todayIndex = Math.min(view.daily.length - 1, Math.max(0, elapsed - 1));
  const todayPoint = points[todayIndex] ?? points[0] ?? { x: 50, yActual: 260, yPlanned: 260 };
  const forecastY = 260 - (200 * Math.min(max, view.forecast.estimate ?? view.forecast.actual) / max);
  const xLabels = [1, 5, 10, 15, 20, 25, days].filter((day, index, list) => day <= days && list.indexOf(day) === index).map((day) => ({ x: 70 + (880 * (day - 1) / Math.max(1, days - 1)), label: formatNumber(day) }));
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => ({ y: 260 - (200 * fraction), label: formatNumber(Math.round(max * fraction)) }));
  const lateStart = view.lateItems.filter((item) => item.kind === 'visit').sort((a, b) => a.plannedDate.localeCompare(b.plannedDate))[0]?.plannedDate;
  const lateStartLabel = lateStart ? `${formatNumber(lateStart.slice(8, 10))}/${formatNumber(lateStart.slice(5, 7))}` : `${formatNumber(asOf.slice(8, 10))}/${formatNumber(asOf.slice(5, 7))}`;
  const late = view.metrics.lateVisits;
  const cleaningSupervisors = view.supervisors.filter((supervisor) => rows.some((row) => row.planType === 'cleaning' && (row.supervisorId ?? `name:${row.supervisorName}`) === supervisor.id)).map((supervisor) => ({ id: supervisor.id, name: supervisor.name, planned: supervisor.planned, visited: supervisor.visited, reportsDone: supervisor.reportsDone }));
  const latestUpdatedAt = rows.map((row) => row.updatedAt).filter((value): value is string => Boolean(value)).sort().at(-1);
  const lastUpdate = latestUpdatedAt ? `${formatDate(latestUpdatedAt.slice(0, 10), formatNumber)} · ${latestUpdatedAt.slice(11, 16)}` : 'غير متاح';
  return {
    monthLabel: formatMonth(month, formatNumber), asOfLabel: formatDate(asOf, formatNumber), schools: new Set(rows.map((row) => row.schoolId)).size, planned: totalAxis.planned, lastUpdate, status: late ? { late: true, label: `متأخر ${formatNumber(Math.max(0, view.metrics.expectedVisits - view.metrics.visited))} زيارة عن المتوقع اليوم · بدأ التأخر ${lateStartLabel}` } : { late: false, label: 'على المسار' }, logoPath: '/brand/logo.png', services, totalService, summaryCards: [{ label: 'الزيارات المخططة', value: totalAxis.planned, tone: 'navy' }, { label: 'الزيارات المنجزة', value: totalAxis.visited, tone: 'green' }, { label: 'التقارير المرفوعة', value: totalAxis.reportsDone, tone: 'navy' }, { label: 'زيارات متأخرة', value: view.metrics.lateVisits, tone: 'red' }, { label: 'تمت بدون تقرير', value: Math.max(0, totalAxis.visited - services.reduce((sum, item) => sum + (view.axes.find((axis) => axis.axis === item.id)?.completed ?? 0), 0)), tone: 'amber' }], supervisors: view.supervisors.filter((supervisor) => rows.some((row) => row.planType === 'maintenance' && (row.supervisorId ?? `name:${row.supervisorName}`) === supervisor.id)).map((supervisor) => ({ id: supervisor.id, name: supervisor.name, planned: supervisor.planned, visited: supervisor.visited, donePercent: supervisor.planned ? (supervisor.visited / supervisor.planned) * 100 : 0, latePercent: supervisor.planned ? (supervisor.lateVisits / supervisor.planned) * 100 : 0 })), chart: { points, xLabels, yTicks, todayX: todayPoint.x, todayY: todayPoint.yActual, forecastY, forecastPoints: Boolean(view.forecast.estimate), todayLabel: formatNumber(Number(asOf.slice(8, 10))) + '/' + formatNumber(Number(asOf.slice(5, 7))), max: totalAxis.planned, },     reports: { percent: totalAxis.planned ? (totalAxis.reportsDone / totalAxis.planned) * 100 : 0, uploaded: totalAxis.reportsDone, remaining: totalAxis.reportRemaining, total: totalAxis.planned, byService: services.map((item) => ({ id: item.id, label: item.label, uploaded: item.reportsDone, planned: item.planned })) }, formatNumber,
    lateItems: view.lateItems.slice(0, 60).map((item) => ({ id: item.id, schoolName: item.schoolName, kind: item.kind === 'visit' ? 'زيارة' : 'تقرير', plannedDate: item.plannedDate, daysLate: item.daysLate, supervisorName: item.supervisorName })),
    cleaningSupervisors,
  };
}

export function useReportData(view: PlanReportView, rows: readonly ReportPlanRow[], month: string, asOf: string, formatNumber: ReportFormatNumber): ReportData {
  return useMemo(() => buildReportData(view, rows, month, asOf, formatNumber), [view, rows, month, asOf, formatNumber]);
}

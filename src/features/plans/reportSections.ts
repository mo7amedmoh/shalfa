import type { ComponentType } from 'react';
import { CumulativeSection, HeaderSection, ReportsSection, ServicesSection, SupervisorsSection, SummarySection, LateItemsSection, CleaningSupervisorsSection, type ReportSectionProps } from './reportSectionComponents';

export type ReportSection = {
  id: string;
  title: string;
  component: ComponentType<ReportSectionProps>;
  defaultOrder: number;
  visible: boolean;
};

export const reportSections: readonly ReportSection[] = [
  { id: 'header', title: 'رأس التقرير', component: HeaderSection, defaultOrder: 1, visible: true },
  { id: 'services', title: 'ملخص الخدمات', component: ServicesSection, defaultOrder: 2, visible: true },
  { id: 'summary', title: 'الملخص', component: SummarySection, defaultOrder: 3, visible: true },
  { id: 'supervisors', title: 'الزيارات حسب المشرف', component: SupervisorsSection, defaultOrder: 4, visible: true },
  { id: 'cumulative', title: 'تراكمي الزيارات', component: CumulativeSection, defaultOrder: 5, visible: true },
  { id: 'reports', title: 'ملخص التقارير', component: ReportsSection, defaultOrder: 6, visible: true },
  { id: 'late-items', title: 'متابعة المتأخرات', component: LateItemsSection, defaultOrder: 7, visible: false },
  { id: 'cleaning-supervisors', title: 'مشرفو النظافة', component: CleaningSupervisorsSection, defaultOrder: 8, visible: false },
];

export type ReportLayoutItem = { id: string; visible: boolean };
export const defaultReportLayout: readonly ReportLayoutItem[] = reportSections.map(({ id, visible }) => ({ id, visible }));

export function normalizeReportLayout(value: unknown): ReportLayoutItem[] {
  const persisted = Array.isArray(value) ? value : [];
  const byId = new Map(persisted.filter((item): item is ReportLayoutItem => Boolean(item && typeof item === 'object' && typeof (item as ReportLayoutItem).id === 'string' && typeof (item as ReportLayoutItem).visible === 'boolean')).map((item) => [item.id, item]));
  const position = (id: string) => { const index = persisted.findIndex((item) => Boolean(item && typeof item === 'object' && (item as ReportLayoutItem).id === id)); return index < 0 ? 999 : index; };
  return reportSections.map((section) => ({ id: section.id, visible: byId.get(section.id)?.visible ?? section.visible }))
    .sort((a, b) => position(a.id) - position(b.id));
}

export function getReportLayout(layout: readonly ReportLayoutItem[] = defaultReportLayout): readonly ReportSection[] {
  const order = new Map(layout.map((item, index) => [item.id, { ...item, index }]));
  return reportSections.filter((section) => order.get(section.id)?.visible ?? section.visible)
    .sort((a, b) => (order.get(a.id)?.index ?? a.defaultOrder) - (order.get(b.id)?.index ?? b.defaultOrder));
}

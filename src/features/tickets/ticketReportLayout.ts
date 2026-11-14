export const ticketReportSections = [
  { id: 'header', title: 'رأس التقرير', visible: true },
  { id: 'summary', title: 'ملخص البلاغات', visible: true },
  { id: 'sla-trend', title: 'مقارنة الالتزام التراكمي بـ SLA', visible: true },
  { id: 'supervisors', title: 'حالة البلاغات وSLA حسب المشرف', visible: true },
  { id: 'schools', title: 'المدارس الأعلى في عدد البلاغات', visible: true },
  { id: 'categories', title: 'تصنيف البلاغات', visible: true },
  { id: 'repeats', title: 'البلاغات المتكررة', visible: true },
] as const;

export type TicketReportSectionId = (typeof ticketReportSections)[number]['id'];
export type TicketReportLayoutItem = { id: TicketReportSectionId; visible: boolean };

export const defaultTicketReportLayout: readonly TicketReportLayoutItem[] = ticketReportSections.map(
  ({ id, visible }) => ({ id, visible }),
);

function isLayoutItem(value: unknown): value is TicketReportLayoutItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as { id?: unknown; visible?: unknown };
  return ticketReportSections.some((section) => section.id === item.id) && typeof item.visible === 'boolean';
}

export function normalizeTicketReportLayout(value: unknown): TicketReportLayoutItem[] {
  const persisted = Array.isArray(value) ? value : [];
  const byId = new Map(
    persisted.filter(isLayoutItem).map((item) => [item.id, item]),
  );
  const position = (id: TicketReportSectionId) => {
    const index = persisted.findIndex((item) => isLayoutItem(item) && item.id === id);
    return index < 0 ? 999 : index;
  };
  return ticketReportSections
    .map((section) => ({ id: section.id, visible: byId.get(section.id)?.visible ?? section.visible }))
    .sort((left, right) => position(left.id) - position(right.id));
}

export function getTicketReportLayout(
  layout: readonly TicketReportLayoutItem[] = defaultTicketReportLayout,
): TicketReportLayoutItem[] {
  const order = new Map(layout.map((item, index) => [item.id, { ...item, index }]));
  return ticketReportSections
    .filter((section) => order.get(section.id)?.visible ?? section.visible)
    .sort((left, right) => (order.get(left.id)?.index ?? 999) - (order.get(right.id)?.index ?? 999))
    .map(({ id }) => ({ id, visible: true }));
}

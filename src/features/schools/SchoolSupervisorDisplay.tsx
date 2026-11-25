import { Link } from 'react-router-dom';
import { usePermission } from '../../app/permissionContext';
import { normalizeImportName } from '../../domain/imports';

export function SchoolSupervisorDisplay({
  employeeId,
  employeeName,
  sheetName,
}: {
  employeeId: string | null;
  employeeName: string | null;
  sheetName: string;
}) {
  const canViewWorkforce = usePermission('workforce.view');
  const assigned = Boolean(employeeId && employeeName?.trim());
  const shownName = assigned ? employeeName!.trim() : sheetName.trim() || 'غير محدد';
  const differsFromSheet = assigned && Boolean(sheetName.trim())
    && normalizeImportName(employeeName) !== normalizeImportName(sheetName);
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {assigned && canViewWorkforce
        ? <Link to={`/workforce?employeeId=${encodeURIComponent(employeeId!)}`} className="font-semibold text-brand-800 underline">{shownName}</Link>
        : <span className="font-semibold">{shownName}</span>}
      {!assigned && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">غير مسنّد</span>}
      {differsFromSheet && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">يخالف الشيت</span>}
    </span>
  );
}

export function TablePagination({
  label,
  totalRows,
  pageSize,
  currentPage,
  pageCount,
  onPageChange,
  formatNumber,
}: {
  label: string;
  totalRows: number;
  pageSize: number;
  currentPage: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  formatNumber: (value: number) => string;
}) {
  if (totalRows <= pageSize) return null;
  const firstRow = (currentPage - 1) * pageSize + 1;
  const lastRow = Math.min(currentPage * pageSize, totalRows);

  return <nav className="table-pagination" aria-label={`التنقل بين صفحات ${label}`}>
    <span aria-live="polite" className="table-pagination-summary">
      عرض {formatNumber(firstRow)}–{formatNumber(lastRow)} من {formatNumber(totalRows)}
    </span>
    <div className="table-pagination-controls">
      <button
        type="button"
        aria-label={`الصفحة السابقة - ${label}`}
        disabled={currentPage === 1}
        onClick={() => onPageChange(currentPage - 1)}
      >السابق</button>
      <span>صفحة {formatNumber(currentPage)} من {formatNumber(pageCount)}</span>
      <button
        type="button"
        aria-label={`الصفحة التالية - ${label}`}
        disabled={currentPage === pageCount}
        onClick={() => onPageChange(currentPage + 1)}
      >التالي</button>
    </div>
  </nav>;
}

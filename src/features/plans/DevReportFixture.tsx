import { MonthlyReportPage } from './MonthlyReportPage';
import type { ReportPlanRow } from '../../domain/planReport';

const axes = ['maintenance', 'cleaning', 'elevators', 'security_safety'] as const;
function fixtureRows(month: string): ReportPlanRow[] {
  const names = ['مشرف أ', 'مشرف ب', 'مشرف ج'];
  return Array.from({ length: 48 }, (_, index) => {
    const axis = axes[index % axes.length];
    const day = String((index % 20) + 1).padStart(2, '0');
    const visited = index % 5 !== 0;
    return {
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, month, planType: axis,
      plannedDate: `${month}-${day}`, visited, visitedDate: visited ? `${month}-${day}` : null,
      reportDone: index % 6 !== 0, reportCompletedDate: index % 6 !== 0 ? `${month}-${day}` : null,
      engineerId: null, engineerName: null,
      supervisorId: axis === 'maintenance' || axis === 'cleaning' ? `00000000-0000-4000-9000-${String((index % 3) + 1).padStart(12, '0')}` : null,
      supervisorName: axis === 'maintenance' || axis === 'cleaning' ? names[index % 3] : null,
      contractorName: axis === 'elevators' || axis === 'security_safety' ? `شركة تجريبية ${axis === 'elevators' ? 'أ' : 'ب'}` : null,
      schoolId: `00000000-0000-4000-a000-${String(index + 1).padStart(12, '0')}`,
      schoolName: `مدرسة تجريبية ${index + 1}`, ministryNumber: `D-${String(index + 1).padStart(3, '0')}`,
      neighbourhood: 'حي تجريبي', hasCleaner: true,
    };
  });
}
export function DevReportFixture() {
  return <MonthlyReportPage fixture={{ current: fixtureRows('2026-11'), previous: fixtureRows('2026-10') }} />;
}

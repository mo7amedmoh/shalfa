import { describe, expect, it } from 'vitest';
import { summarizeGatekeeperCoverage } from './gatekeeperCoverage';

describe('gatekeeper coverage', () => {
  it('reports in-scope gaps, unlinked gatekeepers, and out-of-scope records separately', () => {
    const coverage = summarizeGatekeeperCoverage([
      { id: 'one', name: 'مدرسة أولى', ministryNumber: '100', inScope: true },
      { id: 'two', name: 'مدرسة ثانية', ministryNumber: '200', inScope: true },
      { id: 'three', name: 'مدرسة خارج النطاق', ministryNumber: '300', inScope: false },
    ], [
      { schoolId: 'one', employeeId: null },
      { schoolId: 'three', employeeId: 'employee-3' },
      { schoolId: 'missing-school', employeeId: null },
    ]);

    expect(coverage).toMatchObject({
      gatekeeperRows: 3,
      inScopeSchools: 2,
      schoolsWithGatekeeper: 1,
      unlinkedInScopeRows: 1,
      outOfScopeRows: 2,
    });
    expect(coverage.schoolsWithoutGatekeeper.map((school) => school.id)).toEqual(['two']);
  });
});

import { describe, expect, it } from 'vitest';
import { staffingRowsForEligibleSchools, summarizeDashboardPlans, summarizeDashboardStaffing, summarizeDashboardVisits, summarizeWorkforce } from './dashboard';

describe('dashboard summaries', () => {
  it('calculates independent current-plan completion rates', () => {
    expect(summarizeDashboardPlans([
      { planType: 'maintenance', visitedAt: '2026-11-02', reportCompletedAt: '2026-11-03' },
      { planType: 'maintenance', visitedAt: null, reportCompletedAt: null },
      { planType: 'elevators', visitedAt: null, reportCompletedAt: null },
    ])).toMatchObject([
      { planType: 'maintenance', total: 2, visited: 1, reportsCompleted: 1, visitPercent: 50, reportPercent: 50 },
      { planType: 'cleaning', total: 0, visitPercent: 0, reportPercent: 0 },
      { planType: 'security_safety', total: 0 },
      { planType: 'elevators', total: 1 },
    ]);
  });

  it('excludes schools with unknown class counts from requirements but reports missing counts', () => {
    expect(summarizeDashboardStaffing([
      { requiredCleaners: 2, assignedCleaners: 1, shortage: 1, surplus: 0 },
      { requiredCleaners: null, assignedCleaners: 0, shortage: 0, surplus: 0 },
    ])).toEqual({ schools: 2, required: 2, assigned: 1, shortage: 1, surplus: 0, missingClassCount: 1 });
  });

  it('applies configured eligibility and class-count staffing in the domain layer', () => {
    const schools = [
      { id: 'independent', sourceFields: { 'نوع المبنى': 'مستقل', 'عدد الفصول': '13', 'حجم المدرسة': 'صغير' }, assignedCleaners: 1, declaredSize: 'صغير' },
      { id: 'other', sourceFields: { 'نوع المبنى': 'ملحق', 'عدد الفصول': '22' }, assignedCleaners: 0 },
    ];
    expect(staffingRowsForEligibleSchools(schools, {
      buildingTypeHeader: 'نوع المبنى',
      independentBuildingValues: ['مستقل'],
      primarySharedValues: [],
      elevatorContractorHeader: 'مقاول المصاعد',
      noElevatorValues: [],
      classCountHeader: 'عدد الفصول',
      schoolSizeHeader: 'حجم المدرسة',
    })).toMatchObject([{ requiredCleaners: 2, assignedCleaners: 1, shortage: 1, sizeCorrected: true }]);
  });

  it('aggregates all current monthly plan rows', () => {
    expect(summarizeDashboardVisits(summarizeDashboardPlans([
      { planType: 'maintenance', visitedAt: '2026-11-02', reportCompletedAt: null },
      { planType: 'cleaning', visitedAt: null, reportCompletedAt: null },
    ]))).toEqual({ total: 2, visited: 1, reportsCompleted: 0 });
  });

  it('summarizes gatekeepers and cleaners into total shortage and surplus', () => {
    expect(summarizeWorkforce([
      { size: 'large', requiredCleaners: 3, assignedCleaners: 2, shortage: 1, surplus: 0 },
      { size: 'small', requiredCleaners: 1, assignedCleaners: 2, shortage: 0, surplus: 1 },
    ], 182, 180)).toMatchObject({
      gatekeepers: { required: 182, assigned: 180, shortage: 2, surplus: 0 },
      cleaners: { required: 4, assigned: 4, shortage: 1, surplus: 1 },
      total: { required: 186, assigned: 184, shortage: 3, surplus: 1 },
    });
    expect(summarizeWorkforce([
      { size: 'large', requiredCleaners: 3, assignedCleaners: 2, shortage: 1, surplus: 0 },
      { size: 'small', requiredCleaners: 1, assignedCleaners: 2, shortage: 0, surplus: 1 },
    ], 182, 180).cleaners.bySize).toEqual({
      small: { required: 1, assigned: 2, shortage: 0, surplus: 1 },
      medium: { required: 0, assigned: 0, shortage: 0, surplus: 0 },
      large: { required: 3, assigned: 2, shortage: 1, surplus: 0 },
    });
  });
});

import { describe, expect, it } from 'vitest';
import { excludeIneligibleSupervisor, resolveEligibleSchoolSupervisor, resolvePlanSupervisor } from './schoolSupervisors';

describe('excludeIneligibleSupervisor', () => {
  it('clears a supervisor assigned to an employee who is a gatekeeper or has a gatekeeper job title', () => {
    const employeeById = new Map([
      ['g1', { category: 'gatekeeper', job_title: 'حارس مدرسة' }],
      ['g2', { category: 'supervisor', job_title: 'حارس' }],
      ['s1', { category: 'supervisor', job_title: 'مشرف صيانة' }],
    ]);

    expect(excludeIneligibleSupervisor(
      { supervisorId: 'g1', supervisorName: 'أحمد' },
      { employeeById },
    )).toEqual({ supervisorId: null, supervisorName: null });

    expect(excludeIneligibleSupervisor(
      { supervisorId: 'g2', supervisorName: 'سالم' },
      { employeeById },
    )).toEqual({ supervisorId: null, supervisorName: null });

    expect(excludeIneligibleSupervisor(
      { supervisorId: 's1', supervisorName: 'خالد' },
      { employeeById },
    )).toEqual({ supervisorId: 's1', supervisorName: 'خالد' });
  });

  it('clears an unassigned supervisor name that matches a known gatekeeper name', () => {
    expect(excludeIneligibleSupervisor(
      { supervisorId: null, supervisorName: ' حَارِس المدرسة ' },
      { excludedSupervisorNames: ['حارس المدرسة'] },
    )).toEqual({ supervisorId: null, supervisorName: null });

    expect(excludeIneligibleSupervisor(
      { supervisorId: null, supervisorName: 'مشرف صيانة' },
      { excludedSupervisorNames: ['حارس المدرسة'] },
    )).toEqual({ supervisorId: null, supervisorName: 'مشرف صيانة' });
  });
});

describe('resolveEligibleSchoolSupervisor', () => {
  const current = {
    school_id: 'school',
    maintenance_supervisor_id: 'maintenance',
    maintenance_supervisor_name: 'مشرف الصيانة المسند',
    cleaning_supervisor_id: 'cleaning',
    cleaning_supervisor_name: 'مشرف النظافة المسند',
  };
  const employeeById = new Map([
    ['maintenance', { full_name: 'مشرف الصيانة المسند', category: 'supervisor', job_title: 'مشرف صيانة' }],
    ['cleaning', { full_name: 'مشرف النظافة المسند', category: 'supervisor', job_title: 'مشرف نظافة' }],
  ]);

  it('prefers workforce assignments for the matching plan service', () => {
    const shared = {
      current,
      schoolSourceFields: { 'مشرف الصيانة': 'من الشيت', 'مشرف النظافة': 'من الشيت' },
      employeeById,
    };
    expect(resolveEligibleSchoolSupervisor({ ...shared, planType: 'maintenance' }))
      .toEqual({ supervisorId: 'maintenance', supervisorName: 'مشرف الصيانة المسند' });
    expect(resolveEligibleSchoolSupervisor({ ...shared, planType: 'cleaning' }))
      .toEqual({ supervisorId: 'cleaning', supervisorName: 'مشرف النظافة المسند' });
  });

  describe('resolvePlanSupervisor', () => {
    it('prioritizes the current workforce assignment over a stale saved plan name', () => {
      expect(resolvePlanSupervisor({
        planType: 'maintenance',
        supervisorId: 'old-id',
        supervisorName: 'اسم قديم',
        current: {
          school_id: 'school',
          maintenance_supervisor_id: 'current-id',
          maintenance_supervisor_name: 'مشرف الإسناد الحالي',
          cleaning_supervisor_id: null,
          cleaning_supervisor_name: null,
        },
        schoolSourceFields: { 'مشرف الصيانة': 'مشرف من المبنى' },
      })).toEqual({ supervisorId: 'current-id', supervisorName: 'مشرف الإسناد الحالي' });
    });

    it('keeps a saved name when no current assignment exists and uses the building fallback last', () => {
      expect(resolvePlanSupervisor({
        planType: 'cleaning',
        supervisorId: null,
        supervisorName: 'اسم محفوظ',
        current: null,
        schoolSourceFields: { 'اسم مشرف النظافة': 'مشرف المبنى للنظافة' },
      })).toEqual({ supervisorId: null, supervisorName: 'اسم محفوظ' });
    });
  });

  it('falls back to the service-specific building supervisor when the assignment is ineligible', () => {
    const result = resolveEligibleSchoolSupervisor({
      current: {
        ...current,
        maintenance_supervisor_id: 'guard',
        maintenance_supervisor_name: 'حارس مدرسة',
      },
      planType: 'maintenance',
      schoolSourceFields: { 'مشرف الصيانة': 'مشرف المبنى', 'مشرف النظافة': 'مشرف النظافة بالمبنى' },
      employeeById: new Map([
        ['guard', { full_name: 'حارس مدرسة', category: 'supervisor', job_title: 'حارس مدرسة' }],
      ]),
      excludedSupervisorNames: ['حارس مدرسة'],
    });

    expect(result).toEqual({ supervisorId: null, supervisorName: 'مشرف المبنى' });
    expect(resolveEligibleSchoolSupervisor({
      planType: 'cleaning',
      schoolSourceFields: { 'مشرف الصيانة': 'مشرف المبنى', 'مشرف النظافة': 'مشرف النظافة بالمبنى' },
    })).toEqual({ supervisorId: null, supervisorName: 'مشرف النظافة بالمبنى' });
  });

  it('uses the building name when an assignment cannot be resolved to a display name', () => {
    expect(resolveEligibleSchoolSupervisor({
      current: {
        ...current,
        maintenance_supervisor_id: 'unavailable',
        maintenance_supervisor_name: null,
      },
      planType: 'maintenance',
      schoolSourceFields: { 'مشرف الصيانة': 'مشرف المبنى' },
      employeeById: new Map(),
    })).toEqual({ supervisorId: null, supervisorName: 'مشرف المبنى' });
  });
});

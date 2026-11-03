import { describe, expect, it } from 'vitest';
import { mapSchoolContactColumns, schoolContactFields } from './schoolContacts';

describe('mapSchoolContactColumns', () => {
  it('maps repeated contact headers by their confirmed order', () => {
    const headers = [
      'اسم مهندس المقاول', 'رقم الاتصال',
      'اسم المشرف (صيانة)', 'رقم الاتصال',
      'اسم المشرف (نظافة)', 'رقم التواصل',
      'البواب', 'رقم الاتصال',
      'اسم المدير / ة', 'رقم الاتصال',
      'اسم مهندس المرافق', 'رقم الاتصال',
    ];
    const values = ['اسم 1', '111', 'اسم 2', '222', 'اسم 3', '333', 'اسم 4', '444', 'اسم 5', '555', 'اسم 6', '666'];

    expect(mapSchoolContactColumns(headers, values)).toEqual({
      contractor_engineer: '111',
      maintenance_supervisor: '222',
      cleaning_supervisor: '333',
      gatekeeper: '444',
      school_principal: '555',
      facilities_engineer: '666',
    });
    expect(schoolContactFields).toHaveLength(6);
  });

  it('rejects a changed number of contact columns to avoid shifting the mapping', () => {
    expect(() => mapSchoolContactColumns(['رقم الاتصال'], ['111'])).toThrow('متوقع ستة أعمدة');
  });
});

import { describe, expect, it } from 'vitest';
import {
  parseEmployeeImportRows,
  suggestEmployeeImportColumnMap,
} from './employeeImport';

describe('employee import parsing', () => {
  it('preserves unknown categories for server-side review instead of coercing them', () => {
    const [row] = parseEmployeeImportRows([{
      'اسم الموظف': 'موظف تجريبي',
      'الرقم الوظيفي': 'AB-012',
      'الفئة الوظيفية': 'مراقب ميداني',
      'رقم الهوية': '١٢٣٤٥٦٧٨٩٠',
    }]);

    expect(row).toMatchObject({
      employee_no: 'AB-012',
      category: 'مراقب ميداني',
      residence_no: '١٢٣٤٥٦٧٨٩٠',
    });
  });

  it('maps Arabic employee labels and retains optional manager, rating and review fields', () => {
    const [row] = parseEmployeeImportRows([{
      'اسم الموظف': 'موظف تجريبي',
      'الرقم الوظيفي': '0012A',
      'الفئة الوظيفية': 'إداري',
      'رقم الجوال': '0500000000',
      'الرقم الوظيفي للمدير': 'M-1',
      'التقييم': '87.5',
      'مراجعة الاسم': 'نعم',
      'الحالة': 'منتهي الخدمة',
    }]);

    expect(row).toMatchObject({
      employee_no: '0012A',
      category: 'admin_staff',
      phone: '0500000000',
      manager_number: 'M-1',
      rating: 87.5,
      review_name: 'نعم',
      status: 'terminated',
    });
  });

  it('suggests editable column mappings from Arabic and English headings', () => {
    expect(suggestEmployeeImportColumnMap([
      'اسم الموظف',
      'Employee No',
      'المسمى الوظيفي',
      'الفئة الوظيفية',
      'رقم الجوال',
      'رقم الإقامة',
      'تاريخ المباشرة',
      'الحالة',
      'مراجعة الاسم',
    ])).toMatchObject({
      full_name: 'اسم الموظف',
      employee_no: 'Employee No',
      job_title: 'المسمى الوظيفي',
      category: 'الفئة الوظيفية',
      phone: 'رقم الجوال',
      residence_no: 'رقم الإقامة',
      hire_date: 'تاريخ المباشرة',
      status: 'الحالة',
      review_name: 'مراجعة الاسم',
    });
  });

  it('parses rows using a user-selected column map and the Arabic value labels', () => {
    const [row] = parseEmployeeImportRows([{
      'اسم العامل': 'مها السالم',
      'الرقم الداخلي': 'A-12',
      التصنيف: 'سائق',
      'وضع الموظف': 'نشط',
    }], {
      full_name: 'اسم العامل',
      employee_no: 'الرقم الداخلي',
      category: 'التصنيف',
      status: 'وضع الموظف',
    });

    expect(row).toMatchObject({
      full_name: 'مها السالم',
      employee_no: 'A-12',
      category: 'driver',
      status: 'active',
    });
  });
});

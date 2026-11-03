export const schoolContactFields = [
  { key: 'contractor_engineer', label: 'مهندس المقاول' },
  { key: 'maintenance_supervisor', label: 'مشرف الصيانة' },
  { key: 'cleaning_supervisor', label: 'مشرف النظافة' },
  { key: 'gatekeeper', label: 'البواب' },
  { key: 'school_principal', label: 'مدير المدرسة' },
  { key: 'facilities_engineer', label: 'مهندس المرافق' },
] as const;

export const schoolContactsExtraKey = '_school_contacts';

export type SchoolContactKey = (typeof schoolContactFields)[number]['key'];
export type SchoolContacts = Record<SchoolContactKey, string>;

const contactHeaders = new Set(['رقم الاتصال', 'رقم التواصل']);

export function mapSchoolContactColumns(headers: readonly string[], values: readonly string[]): SchoolContacts {
  const indexes = headers.flatMap((header, index) =>
    contactHeaders.has(header.trim().toLocaleLowerCase()) ? [index] : [],
  );
  if (indexes.length !== schoolContactFields.length) {
    throw new Error(`متوقع ستة أعمدة لأرقام التواصل، لكن عُثر على ${indexes.length}.`);
  }
  return Object.fromEntries(schoolContactFields.map(({ key }, index) => [
    key,
    values[indexes[index]]?.trim() ?? '',
  ])) as SchoolContacts;
}

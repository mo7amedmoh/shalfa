import type { DuplicateMinistryNumber } from '../../lib/schoolSync';

export function DuplicateSchoolWarning({ duplicates }: { duplicates: readonly DuplicateMinistryNumber[] }) {
  if (!duplicates.length) return null;
  return (
    <section role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
      <h3 className="font-bold">تنبيه: أرقام وزارية مكررة في المصدر</h3>
      <ul className="mt-2 grid gap-1">
        {duplicates.map(({ ministryNumber, rows }) => (
          <li key={ministryNumber}>الرقم الوزاري {ministryNumber} — صفوف المصدر: {rows.join('، ')}</li>
        ))}
      </ul>
    </section>
  );
}

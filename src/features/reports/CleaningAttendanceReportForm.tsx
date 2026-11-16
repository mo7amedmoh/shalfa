import { useEffect, useState, type ChangeEvent } from 'react';
import { ArrowRight, FileDown, ImagePlus, Search, Trash2, Upload } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { normalizeMinistryNumber } from '../../domain/imports';
import { APP_SCHEMA_SELECT } from '../../lib/schemaColumns';
import { supabase } from '../../lib/supabase';
import {
  exportCleaningAttendancePdf,
  exportCleaningAttendancePowerPoint,
  prepareReportPhoto,
  sanitizeFilePart,
  type ReportPhoto,
} from './reportExports';

const imageAccept = 'image/jpeg,image/png,image/bmp,image/webp';
const schoolSearchSchema = z.object({
  id: z.string().uuid(),
  school_name: z.string(),
  ministry_number: z.string(),
  ministry_key: z.string().nullable(),
});
type ReportSchool = z.infer<typeof schoolSearchSchema>;

function reportFileName(school: string, extension: 'pptx' | 'pdf'): string {
  return `تحضير عمالة النظافة - ${sanitizeFilePart(school)}.${extension}`;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

async function searchSchools(query: string): Promise<ReportSchool[]> {
  if (!supabase) throw new Error('إعداد الاتصال بقاعدة البيانات غير مكتمل.');
  const namePattern = `%${escapeLikePattern(query)}%`;
  const codePattern = `%${escapeLikePattern(normalizeMinistryNumber(query))}%`;
  const rawCodePattern = `%${escapeLikePattern(query)}%`;
  const [nameResult, normalizedCodeResult, rawCodeResult] = await Promise.all([
    supabase.from('schools').select(APP_SCHEMA_SELECT.reportSchoolSearch + ',ministry_key')
      .ilike('name', namePattern).order('name').limit(8),
    supabase.from('schools').select(APP_SCHEMA_SELECT.reportSchoolSearch + ',ministry_key')
      .ilike('ministry_key', codePattern).order('ministry_no').limit(8),
    supabase.from('schools').select(APP_SCHEMA_SELECT.reportSchoolSearch + ',ministry_key')
      .ilike('ministry_no', rawCodePattern).order('ministry_no').limit(8),
  ]);
  if (nameResult.error) throw nameResult.error;
  if (normalizedCodeResult.error) throw normalizedCodeResult.error;
  if (rawCodeResult.error) throw rawCodeResult.error;
  const matches = z.array(schoolSearchSchema).parse([
    ...(nameResult.data ?? []),
    ...(normalizedCodeResult.data ?? []),
    ...(rawCodeResult.data ?? []),
  ]);
  return Array.from(new Map(matches.map((candidate) => [candidate.id, candidate])).values()).slice(0, 8);
}

export function CleaningAttendanceReportForm() {
  const [template, setTemplate] = useState<File | null>(null);
  const [schoolSearch, setSchoolSearch] = useState('');
  const [debouncedSchoolSearch, setDebouncedSchoolSearch] = useState('');
  const [ministryCode, setMinistryCode] = useState('');
  const [school, setSchool] = useState<ReportSchool | null>(null);
  const [photos, setPhotos] = useState<ReportPhoto[]>([]);
  const [format, setFormat] = useState<'pptx' | 'pdf'>('pptx');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSchoolSearch(schoolSearch.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [schoolSearch]);

  const schoolSearchResults = useQuery({
    queryKey: ['cleaning-attendance-school-search', debouncedSchoolSearch],
    queryFn: () => searchSchools(debouncedSchoolSearch),
    enabled: Boolean(supabase && debouncedSchoolSearch.length >= 2 && !school),
    staleTime: 60_000,
  });

  async function onTemplateChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    setError('');
    setStatus('');
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pptx')) {
      setTemplate(null);
      setError('اختر قالب PowerPoint بامتداد .pptx.');
      return;
    }
    setTemplate(file);
  }

  function chooseSchool(candidate: ReportSchool) {
    setSchool(candidate);
    setMinistryCode(candidate.ministry_number);
    setSchoolSearch(candidate.ministry_number);
    setError('');
    setStatus('تم اختيار المدرسة وتعبئة الرقم الوزاري.');
  }

  function handleSchoolSearchChange(value: string) {
    setSchoolSearch(value);
    setSchool(null);
    setMinistryCode('');
    setError('');
    setStatus('');
  }

  async function addPhotos(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length) return;
    setError('');
    try {
      const uniqueFiles = files.filter((file, index) => (
        !photos.some((photo) => photo.file.name === file.name
          && photo.file.size === file.size
          && photo.file.lastModified === file.lastModified)
        && !files.slice(0, index).some((other) => other.name === file.name
          && other.size === file.size
          && other.lastModified === file.lastModified)
      ));
      const addedPhotos = await Promise.all(uniqueFiles.map(prepareReportPhoto));
      setPhotos((previous) => [...previous, ...addedPhotos]);
      if (addedPhotos.length) setStatus(`تمت إضافة ${addedPhotos.length} صورة.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'تعذر تجهيز الصور.');
    }
  }

  function removePhoto(index: number) {
    setPhotos((previous) => previous.filter((_, photoIndex) => photoIndex !== index));
  }

  async function exportReport() {
    setError('');
    setStatus('');
    if (!template) {
      setError('ارفع قالب PowerPoint أولاً.');
      return;
    }
    if (!school || !ministryCode.trim()) {
      setError('اختر المدرسة من نتائج البحث عن الاسم أو الرقم الوزاري.');
      return;
    }
    if (!photos.length) {
      setError('أرفق صورة واحدة على الأقل.');
      return;
    }

    setBusy(true);
    setStatus('جارٍ إنشاء التقرير…');
    try {
      const fileExtension = format;
      const fileName = reportFileName(school.school_name, fileExtension);
      if (format === 'pptx') {
        await exportCleaningAttendancePowerPoint(
          template,
          school.school_name,
          normalizeMinistryNumber(ministryCode),
          photos,
          fileName,
        );
      } else {
        await exportCleaningAttendancePdf(
          template,
          school.school_name,
          normalizeMinistryNumber(ministryCode),
          photos,
          fileName,
        );
      }
      setStatus('تم إنشاء التقرير وتنزيله بنجاح.');
    } catch (reason) {
      setStatus('');
      setError(reason instanceof Error ? reason.message : 'تعذر إنشاء التقرير.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5" dir="rtl">
      <div>
        <Link to="/tools/reports" className="inline-flex items-center gap-2 text-sm font-semibold text-brand-800 hover:underline">
          <ArrowRight size={16} /> العودة إلى منجز التقارير
        </Link>
        <h2 className="mt-3 text-2xl font-bold text-brand-900">منجز تقارير تحضير عمالة النظافة</h2>
        <p className="mt-1 text-sm text-slate-500">ارفع القالب، وابحث عن المدرسة برقمها الوزاري أو اسمها، ثم أرفق الصور.</p>
      </div>

      <section className="card grid gap-4 p-5">
        <label className="grid gap-2 text-sm font-semibold text-slate-700">
          <span>قالب التقرير (PowerPoint .pptx)</span>
          <span className="flex flex-wrap items-center gap-3">
            <span className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 font-semibold text-brand-800 hover:bg-slate-50">
              <Upload size={16} /> اختيار القالب
              <input
                type="file"
                accept=".pptx"
                className="sr-only"
                onChange={(event) => void onTemplateChange(event)}
                disabled={busy}
              />
            </span>
            <span className="font-normal text-slate-500">{template?.name ?? 'لم يتم اختيار القالب'}</span>
          </span>
        </label>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            <span className="inline-flex items-center gap-2"><Search size={16} /> الرقم الوزاري أو اسم المدرسة</span>
            <input
              value={schoolSearch}
              onChange={(event) => handleSchoolSearchChange(event.target.value)}
              placeholder="اكتب الرقم الوزاري أو اسم المدرسة"
              className="rounded-lg border border-slate-300 px-3 py-2 text-start font-normal"
              dir="auto"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={!school && debouncedSchoolSearch.length >= 2}
              aria-controls="cleaning-attendance-school-results"
              disabled={busy}
            />
          </label>
          <label className="grid content-start gap-1 text-sm font-semibold text-slate-700">
            اسم المدرسة
            <input
              value={school?.school_name ?? ''}
              readOnly
              placeholder="يظهر اسم المدرسة بعد البحث"
              className="rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 font-normal"
            />
          </label>
        </div>

        {!school && debouncedSchoolSearch.length >= 2 && (
          <div id="cleaning-attendance-school-results" className="grid gap-2 rounded-lg border border-slate-200 p-3" role="listbox" aria-label="نتائج البحث عن المدارس">
            {!supabase ? (
              <p role="alert" className="text-sm text-rose-700">تعذر البحث عن المدارس: إعداد الاتصال بقاعدة البيانات غير مكتمل.</p>
            ) : schoolSearchResults.isFetching ? (
              <p className="text-sm text-slate-500">جارٍ البحث عن المدارس…</p>
            ) : schoolSearchResults.error ? (
              <p role="alert" className="text-sm text-rose-700">تعذر البحث عن المدارس: {schoolSearchResults.error.message}</p>
            ) : schoolSearchResults.data?.length ? (
              schoolSearchResults.data.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  role="option"
                  aria-selected="false"
                  onClick={() => chooseSchool(candidate)}
                  className="flex flex-wrap justify-between gap-2 rounded-lg px-3 py-2 text-start text-sm hover:bg-brand-50"
                >
                  <span>{candidate.school_name}</span>
                  <span className="text-slate-500">{candidate.ministry_number}</span>
                </button>
              ))
            ) : (
              <p className="text-sm text-slate-500">لا توجد مدرسة مطابقة؛ تحقق من الاسم أو الرقم الوزاري.</p>
            )}
          </div>
        )}

        <section className="grid gap-3 rounded-xl border border-slate-200 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-bold text-brand-900">صور العمالة</h3>
              <p className="mt-1 text-xs text-slate-500">سيتم إنشاء شريحة مستقلة لكل صورة.</p>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-brand-700 px-3 py-2 text-sm font-semibold text-brand-800 hover:bg-brand-50">
              <ImagePlus size={16} /> إرفاق الصور
              <input
                type="file"
                multiple
                accept={imageAccept}
                className="sr-only"
                onChange={(event) => void addPhotos(event)}
                disabled={busy}
              />
            </label>
          </div>
          {photos.length > 0 ? (
            <ul className="grid gap-2 sm:grid-cols-2">
              {photos.map((photo, index) => (
                <li key={`${photo.file.name}-${photo.file.lastModified}-${index}`} className="flex min-w-0 items-center gap-2 rounded-lg bg-slate-50 p-2 text-sm">
                  <img src={photo.dataUrl} alt="" className="size-12 shrink-0 rounded object-cover" />
                  <span className="min-w-0 flex-1 truncate" title={photo.file.name}>{photo.file.name}</span>
                  <button
                    type="button"
                    aria-label={`حذف ${photo.file.name}`}
                    onClick={() => removePhoto(index)}
                    disabled={busy}
                    className="rounded p-2 text-rose-700 hover:bg-rose-50"
                  >
                    <Trash2 size={16} />
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-slate-500">لم يتم إرفاق صور بعد.</p>}
        </section>

        <label className="grid max-w-sm gap-1 text-sm font-semibold text-slate-700">
          صيغة التصدير
          <select
            value={format}
            onChange={(event) => setFormat(event.target.value as 'pptx' | 'pdf')}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2"
            disabled={busy}
          >
            <option value="pptx">PowerPoint (.pptx)</option>
            <option value="pdf">PDF (.pdf)</option>
          </select>
        </label>

        {format === 'pdf' && (
          <p className="text-xs leading-6 text-slate-500">
            يُحوّل العرض الناتج إلى PDF داخل المتصفح؛ تظهر الشرائح الأولى والأخيرة والقالب المرفوع، وتُدرج كل صورة في صفحة مستقلة.
          </p>
        )}
        {status && <p role="status" className="text-sm text-slate-600">{status}</p>}
        {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
        <button
          type="button"
          onClick={() => void exportReport()}
          disabled={busy}
          className="inline-flex w-fit items-center gap-2 rounded-lg bg-brand-800 px-5 py-3 font-bold text-white hover:bg-brand-900 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <FileDown size={18} /> {busy ? 'جارٍ إنشاء التقرير…' : 'إنشاء التقرير وتصديره'}
        </button>
      </section>
    </div>
  );
}

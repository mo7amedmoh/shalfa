import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { ArrowRight, FileDown, ImagePlus, Search, Trash2, Upload } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { reportTools, type ReportToolId } from '../../domain/reportTools';
import { reportSchoolNeighbourhood } from '../../domain/reportSchools';
import { exportReportPdf } from '../../lib/reportPdf';
import { APP_SCHEMA_SELECT } from '../../lib/schemaColumns';
import { supabase } from '../../lib/supabase';
import {
  exportDeepCleaningWorkbook,
  exportMaintenanceWorkbook,
  exportPowerPointReport,
  maintenanceCategoryDefinitions,
  sanitizeFilePart,
  type PhotoCategory,
  type ReportPhoto,
  type SchoolReportDetails,
} from './reportExports';

const imageAccept = 'image/jpeg,image/png,image/bmp,image/webp';
type ExportFormat = 'xlsx' | 'pptx' | 'pdf';
type PhotoState = Record<string, ReportPhoto[]>;
const reportSchoolSchema = z.object({
  id: z.string().uuid(),
  school_name: z.string(),
  ministry_number: z.string(),
  neighbourhood: z.string().nullable(),
  source_fields: z.record(z.string(), z.unknown()),
});
const reportStatusRowSchema = z.object({
  id: z.string().uuid(),
  report_done: z.boolean(),
  report_done_date: z.string().nullable(),
  visited: z.boolean().optional(),
});
type ReportSchool = z.infer<typeof reportSchoolSchema>;
type PlanReportStatus = {
  kind: 'monthly' | 'general';
  rowId: string;
  reportDone: boolean;
  reportDoneDate: string | null;
  visited: boolean;
  reportDate: string;
};

const roleCategories = {
  maintenance: maintenanceCategoryDefinitions.filter((category) => category.section === 'maintenance'),
  hvac: maintenanceCategoryDefinitions.filter((category) => category.section === 'hvac'),
};

function normalizeMinistryCode(value: string): string {
  const digits: Record<string, string> = {
    '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
    '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  };
  return value.normalize('NFKC').trim().replace(/[٠-٩۰-۹]/g, (digit) => digits[digit] ?? digit).replace(/\s/g, '');
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

async function searchReportSchools(query: string): Promise<ReportSchool[]> {
  if (!supabase) return [];
  const namePattern = `%${escapeLikePattern(query)}%`;
  const codePattern = `%${escapeLikePattern(normalizeMinistryCode(query))}%`;
  const [nameResult, codeResult] = await Promise.all([
    supabase.from('schools').select(APP_SCHEMA_SELECT.reportSchoolSearch)
      .ilike('name', namePattern).order('name').limit(8),
    supabase.from('schools').select(APP_SCHEMA_SELECT.reportSchoolSearch)
      .ilike('ministry_no', codePattern).order('ministry_no').limit(8),
  ]);
  if (nameResult.error) throw nameResult.error;
  if (codeResult.error) throw codeResult.error;
  const schools = z.array(reportSchoolSchema).parse([...(nameResult.data ?? []), ...(codeResult.data ?? [])]);
  return Array.from(new Map(schools.map((school) => [school.id, school])).values()).slice(0, 8);
}

async function findPlanReportStatus(
  toolId: ReportToolId,
  schoolId: string,
  reportDate: string,
): Promise<PlanReportStatus | null> {
  if (!supabase) return null;
  const monthlyPlanType = toolId === 'cleaning' ? 'cleaning' : toolId === 'maintenance' ? 'maintenance' : null;
  const generalPlanType = toolId === 'tank-washing' ? 'tank_washing' : toolId === 'pest-control' ? 'pest_control' : null;
  if (!monthlyPlanType && !generalPlanType) return null;
  const kind = monthlyPlanType ? 'monthly' : 'general';
  const plansResult = kind === 'monthly'
    ? await supabase.from('monthly_plans').select(APP_SCHEMA_SELECT.id)
      .eq('plan_type', monthlyPlanType).eq('month', `${reportDate.slice(0, 7)}-01`)
      .order('created_at', { ascending: false })
    : await supabase.from('general_plans').select(APP_SCHEMA_SELECT.id)
      .eq('plan_type', generalPlanType).eq('year', Number(reportDate.slice(0, 4)));
  if (plansResult.error) throw plansResult.error;
  const planIds = (plansResult.data ?? []).map(({ id }) => id);
  if (!planIds.length) return null;
  const rowsResult = kind === 'monthly'
    ? await supabase.from('monthly_plan_rows')
      .select('id,plan_id,report_done,report_done_date,visited')
      .in('plan_id', planIds).eq('school_id', schoolId)
    : await supabase.from('general_plan_rows')
      .select('id,plan_id,report_done,report_done_date')
      .in('plan_id', planIds).eq('school_id', schoolId);
  if (rowsResult.error) throw rowsResult.error;
  const rowSchema = reportStatusRowSchema.extend({ plan_id: z.string().uuid() });
  const rows = z.array(rowSchema).parse(rowsResult.data);
  const row = rows.sort((left, right) => planIds.indexOf(left.plan_id) - planIds.indexOf(right.plan_id))[0];
  if (!row) return null;
  return {
    kind,
    rowId: row.id,
    reportDone: row.report_done,
    reportDoneDate: row.report_done_date,
    visited: kind === 'general' || row.visited === true,
    reportDate,
  };
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`تعذر قراءة الصورة ${file.name}.`));
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error(`تعذر قراءة الصورة ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

async function toPngDataUrl(dataUrl: string, fileName: string): Promise<string> {
  const image = new Image();
  image.src = dataUrl;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(`صيغة الصورة ${fileName} غير مدعومة في المتصفح.`));
  });
  const scale = Math.min(1, 2000 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('تعذر تجهيز الصورة للتصدير.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

function initialFileName(toolId: ReportToolId, school: string, extension: string): string {
  const name = sanitizeFilePart(school);
  if (toolId === 'cleaning') return `${name}-تقرير-التنظيف-العميق.${extension}`;
  if (toolId === 'maintenance') return `تقرير-الصيانة-والتكييف-${name}.${extension}`;
  if (toolId === 'pest-control') return `تقرير-مكافحة-الآفات-${name}.${extension}`;
  return `${name}-رش-مبيدات-وغسيل-خزانات.${extension}`;
}

export function ReportGeneratorPage() {
  const { toolId } = useParams();
  const tool = reportTools.find((candidate) => candidate.id === toolId);
  if (!tool) {
    return <section role="alert" className="card p-6 text-center text-slate-600">التطبيق المطلوب غير متاح.</section>;
  }
  return <ReportGeneratorForm key={tool.id} toolId={tool.id} title={tool.label} />;
}

function ReportGeneratorForm({ toolId, title }: { toolId: ReportToolId; title: string }) {
  const isExcelTool = toolId === 'cleaning' || toolId === 'maintenance';
  const isMaintenance = toolId === 'maintenance';
  const isTank = toolId === 'tank-washing' || toolId === 'pest-control';
  const reportElement = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const [template, setTemplate] = useState<File | null>(null);
  const [schoolSearch, setSchoolSearch] = useState('');
  const [debouncedSchoolSearch, setDebouncedSchoolSearch] = useState('');
  const [selectedSchool, setSelectedSchool] = useState<ReportSchool | null>(null);
  const [school, setSchool] = useState('');
  const [ministryCode, setMinistryCode] = useState('');
  const [district, setDistrict] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [mode, setMode] = useState<'before-after' | 'general'>('before-after');
  const [format, setFormat] = useState<ExportFormat>(isExcelTool ? 'xlsx' : 'pptx');
  const [photos, setPhotos] = useState<PhotoState>({});
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [planReportStatus, setPlanReportStatus] = useState<PlanReportStatus | null>(null);
  const [savingPlanReport, setSavingPlanReport] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSchoolSearch(schoolSearch.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [schoolSearch]);

  const schoolSearchResults = useQuery({
    queryKey: ['report-school-search', debouncedSchoolSearch],
    queryFn: () => searchReportSchools(debouncedSchoolSearch),
    enabled: Boolean(supabase && debouncedSchoolSearch.length >= 2 && !selectedSchool),
    staleTime: 60_000,
  });

  const chooseSchool = useCallback((candidate: ReportSchool) => {
    setSelectedSchool(candidate);
    setSchool(candidate.school_name);
    setMinistryCode(candidate.ministry_number);
    setDistrict(reportSchoolNeighbourhood({
      neighbourhood: candidate.neighbourhood,
      sourceFields: candidate.source_fields,
    }));
    setSchoolSearch(`${candidate.school_name} · ${candidate.ministry_number}`);
    setError('');
    setStatus('تم اختيار المدرسة وتعبئة بياناتها.');
  }, []);

  useEffect(() => {
    const query = schoolSearch.trim();
    if (!query || selectedSchool || schoolSearchResults.isLoading || schoolSearchResults.error) return;
    const code = normalizeMinistryCode(query);
    const exactSchool = schoolSearchResults.data?.find((candidate) => (
      normalizeMinistryCode(candidate.ministry_number) === code
      || candidate.school_name.trim().toLocaleLowerCase() === query.toLocaleLowerCase()
    ));
    if (exactSchool) chooseSchool(exactSchool);
  }, [chooseSchool, schoolSearch, schoolSearchResults.data, schoolSearchResults.error, schoolSearchResults.isLoading, selectedSchool]);

  const categories = useMemo<PhotoCategory[]>(() => maintenanceCategoryDefinitions.map((category) => ({
    name: category.name,
    requiredCount: category.requiredCount,
    photos: photos[category.name] ?? [],
  })), [photos]);
  const maintenancePhotos = categories.filter((category) => roleCategories.maintenance.some((item) => item.name === category.name));
  const hvacPhotos = categories.filter((category) => roleCategories.hvac.some((item) => item.name === category.name));
  const imageGroups = useMemo(() => {
    if (isMaintenance) return categories.map((category) => ({ title: category.name, photos: category.photos }));
    if (isTank && mode === 'before-after') {
      return [
        { title: 'صور قبل الأعمال', photos: photos.before ?? [] },
        { title: 'صور بعد الأعمال', photos: photos.after ?? [] },
      ];
    }
    return [{ title: isTank ? 'الصور العامة' : 'صور التنظيف العميق', photos: photos.general ?? [] }];
  }, [categories, isMaintenance, isTank, mode, photos]);

  const templateKind = isTank ? '.pptx' : '.xlsx';

  function onTemplateChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    setError('');
    if (file && !file.name.toLowerCase().endsWith(templateKind)) {
      setTemplate(null);
      setError(`اختر قالبًا بامتداد ${templateKind}.`);
      return;
    }
    setTemplate(file);
  }

  async function addPhotos(key: string, event: ChangeEvent<HTMLInputElement>, maximum?: number) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length) return;
    setError('');
    try {
      const current = photos[key] ?? [];
      const uniqueFiles = files.filter((file, index) => {
        const duplicate = current.some((photo) => photo.file.name === file.name
          && photo.file.size === file.size
          && photo.file.lastModified === file.lastModified);
        const duplicateInSelection = files.slice(0, index).some((other) => other.name === file.name
          && other.size === file.size
          && other.lastModified === file.lastModified);
        return !duplicate && !duplicateInSelection;
      });
      const remaining = maximum === undefined ? uniqueFiles.length : Math.max(0, maximum - current.length);
      const selected = uniqueFiles.slice(0, remaining);
      const next = await Promise.all(selected.map(async (file) => {
        const dataUrl = await readDataUrl(file);
        return { file, dataUrl, pngDataUrl: await toPngDataUrl(dataUrl, file.name) };
      }));
      setPhotos((previous) => ({ ...previous, [key]: [...(previous[key] ?? []), ...next] }));
      if (uniqueFiles.length > selected.length) {
        setStatus(`الفئة تستوعب ${maximum} صور فقط.`);
      } else {
        setStatus(`${selected.length} صورة أضيفت بنجاح.`);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'تعذر تجهيز الصور.');
    }
  }

  function removePhoto(key: string, index: number) {
    setPhotos((previous) => ({
      ...previous,
      [key]: (previous[key] ?? []).filter((_, photoIndex) => photoIndex !== index),
    }));
  }

  function handleSchoolSearchChange(value: string) {
    setSchoolSearch(value);
    setSelectedSchool(null);
    setSchool('');
    setMinistryCode('');
    setDistrict('');
    setPlanReportStatus(null);
    setError('');
    setStatus('');
  }

  function validateBeforeExport(): SchoolReportDetails | null {
    setError('');
    if (!template) {
      setError(`ارفع قالب التقرير بامتداد ${templateKind} أولاً.`);
      return null;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError('حدد تاريخ التقرير لتحديد فترة الخطة.');
      return null;
    }
    if (!selectedSchool || !school.trim() || !ministryCode.trim()) {
      setError('ابحث عن المدرسة بالاسم أو الرقم الوزاري واخترها من النتائج.');
      return null;
    }
    if (isMaintenance) {
      const incomplete = categories.find((category) => category.photos.length !== category.requiredCount);
      if (incomplete) {
        setError(`فئة «${incomplete.name}» تحتاج إلى ${incomplete.requiredCount} صور.`);
        return null;
      }
    }
    return { school: school.trim(), ministryCode: ministryCode.trim(), district, date };
  }

  async function exportReport() {
    const details = validateBeforeExport();
    if (!details) return;
    setBusy(true);
    setStatus('جارٍ إنشاء التقرير…');
    try {
      const fileExtension: ExportFormat = format === 'pdf' ? 'pdf' : isExcelTool ? 'xlsx' : 'pptx';
      const fileName = initialFileName(toolId, details.school, fileExtension);
      if (format === 'pdf') {
        if (!reportElement.current) throw new Error('تعذر تجهيز معاينة التقرير للتصدير.');
        await exportReportPdf(reportElement.current, fileName, ['header']);
      } else if (toolId === 'cleaning') {
        await exportDeepCleaningWorkbook(template!, details, photos.general ?? [], fileName);
      } else if (isMaintenance) {
        await exportMaintenanceWorkbook(template!, details, maintenancePhotos, hvacPhotos, fileName);
      } else if (isTank) {
        await exportPowerPointReport(
          template!,
          details,
          mode,
          photos.before ?? [],
          photos.after ?? [],
          photos.general ?? [],
          fileName,
        );
      }
      setStatus('تم إنشاء التقرير وتنزيله بنجاح.');
      setPlanReportStatus(null);
      if (selectedSchool) {
        try {
          const currentPlanStatus = await findPlanReportStatus(toolId, selectedSchool.id, details.date);
          if (!currentPlanStatus) {
            setStatus('تم تنزيل التقرير، لكن لا يوجد سجل لهذه المدرسة في خطة الفترة المحددة.');
          } else if (currentPlanStatus.reportDone) {
            setStatus('تم تنزيل التقرير، وحالته مسجلة مسبقاً ضمن الخطة.');
          } else {
            setPlanReportStatus(currentPlanStatus);
          }
        } catch (reason) {
          setError(`تم تنزيل التقرير، لكن تعذر التحقق من حالة الخطة: ${reason instanceof Error ? reason.message : 'خطأ غير معروف.'}`);
        }
      }
    } catch (reason) {
      setStatus('');
      setError(reason instanceof Error ? reason.message : 'تعذر إنشاء التقرير.');
    } finally {
      setBusy(false);
    }
  }

  async function updatePlanReportStatus() {
    if (!supabase || !planReportStatus) return;
    setSavingPlanReport(true);
    setError('');
    try {
      const { error: updateError } = await supabase
        .from(planReportStatus.kind === 'monthly' ? 'monthly_plan_rows' : 'general_plan_rows')
        .update({ report_done: true, report_done_date: planReportStatus.reportDate })
        .eq('id', planReportStatus.rowId);
      if (updateError) throw updateError;
      setPlanReportStatus(null);
      setStatus('تم تحديث حالة التقرير في الخطة إلى «تم إنجاز التقرير».');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['monthly-plan-rows'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-plan-rows'] }),
        queryClient.invalidateQueries({ queryKey: ['general-plan-rows'] }),
      ]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'تعذر تحديث حالة التقرير في الخطة.');
    } finally {
      setSavingPlanReport(false);
    }
  }

  function groupPhotos(key: string, label: string, maximum?: number) {
    const selected = photos[key] ?? [];
    return (
      <section key={key} className="card grid gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-bold text-brand-900">{label}</h3>
            <p className="mt-1 text-xs text-slate-500">
              {maximum === undefined ? `تم اختيار ${selected.length} صورة` : `تم اختيار ${selected.length} من ${maximum} صور`}
            </p>
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-brand-700 px-3 py-2 text-sm font-semibold text-brand-800 hover:bg-brand-50">
            <ImagePlus size={16} /> اختيار الصور
            <input
              type="file"
              multiple
              accept={imageAccept}
              className="sr-only"
              disabled={busy || (maximum !== undefined && selected.length >= maximum)}
              onChange={(event) => void addPhotos(key, event, maximum)}
            />
          </label>
        </div>
        {selected.length > 0 && (
          <ul className="grid gap-2 sm:grid-cols-2">
            {selected.map((photo, index) => (
              <li key={`${photo.file.name}-${photo.file.lastModified}-${index}`} className="flex min-w-0 items-center gap-2 rounded-lg bg-slate-50 p-2 text-sm">
                <img src={photo.dataUrl} alt="" className="size-12 shrink-0 rounded object-cover" />
                <span className="min-w-0 flex-1 truncate" title={photo.file.name}>{photo.file.name}</span>
                <button type="button" aria-label={`حذف ${photo.file.name}`} onClick={() => removePhoto(key, index)} className="rounded p-2 text-rose-700 hover:bg-rose-50">
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  return (
    <div className="grid gap-5" dir="rtl">
      <div>
        <Link to="/tools/reports" className="inline-flex items-center gap-2 text-sm font-semibold text-brand-800 hover:underline">
          <ArrowRight size={16} /> العودة إلى منجز التقارير
        </Link>
        <h2 className="mt-3 text-2xl font-bold text-brand-900">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">ارفع القالب والصور المطلوبة، ثم أنشئ ملف التقرير على جهازك.</p>
      </div>

      <section className="card grid gap-4 p-5">
        <label className="grid gap-2 text-sm font-semibold text-slate-700">
          <span>قالب التقرير ({templateKind})</span>
          <span className="flex flex-wrap items-center gap-3">
            <span className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 font-semibold text-brand-800 hover:bg-slate-50">
              <Upload size={16} /> اختيار القالب
              <input type="file" accept={isTank ? '.pptx' : '.xlsx'} className="sr-only" onChange={onTemplateChange} disabled={busy} />
            </span>
            <span className="font-normal text-slate-500">{template?.name ?? 'لم يتم اختيار القالب'}</span>
          </span>
        </label>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            <span className="inline-flex items-center gap-2"><Search size={16} /> اسم المدرسة أو الرقم الوزاري</span>
            <input
              value={schoolSearch}
              onChange={(event) => handleSchoolSearchChange(event.target.value)}
              placeholder="اكتب جزءاً من الاسم أو الرقم الوزاري"
              className="rounded-lg border border-slate-300 px-3 py-2 text-start font-normal"
              dir="auto"
              disabled={busy || savingPlanReport}
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            تاريخ التقرير والفترة
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 font-normal" disabled={savingPlanReport} />
          </label>
          {selectedSchool && (
            <>
              <label className="grid gap-1 text-sm font-semibold text-slate-700">
                اسم المدرسة
                <input value={school} readOnly className="rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 font-normal" />
              </label>
              <label className="grid gap-1 text-sm font-semibold text-slate-700">
                الرقم الوزاري
                <input value={ministryCode} readOnly className="rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-start font-normal" dir="auto" />
              </label>
              {isTank && (
                <label className="grid gap-1 text-sm font-semibold text-slate-700">
                  الحي / المنطقة
                  <input value={district} readOnly className="rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 font-normal" />
                </label>
              )}
            </>
          )}
          {isTank && (
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              نوع التقرير
              <select value={mode} onChange={(event) => setMode(event.target.value as 'before-after' | 'general')} className="rounded-lg border border-slate-300 bg-white px-3 py-2">
                <option value="before-after">قبل / بعد</option>
                <option value="general">عام</option>
              </select>
              <span className="text-xs font-normal leading-5 text-slate-500">
                {mode === 'general' ? 'حتى 12 صورة في كل شريحة.' : 'حتى 6 صور قبل و6 صور بعد في كل شريحة.'}
              </span>
            </label>
          )}
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            صيغة التصدير
            <select value={format} onChange={(event) => setFormat(event.target.value as ExportFormat)} className="rounded-lg border border-slate-300 bg-white px-3 py-2">
              {isExcelTool ? <option value="xlsx">Excel (.xlsx)</option> : <option value="pptx">PowerPoint (.pptx)</option>}
              <option value="pdf">PDF (.pdf)</option>
            </select>
          </label>
        </div>
        {!selectedSchool && schoolSearch.trim().length >= 2 && (
          <div className="grid gap-2 rounded-lg border border-slate-200 p-3" aria-live="polite">
            {!supabase ? <p role="alert" className="text-sm text-rose-700">تعذر البحث عن المدارس: إعداد الاتصال بقاعدة البيانات غير مكتمل.</p>
              : schoolSearchResults.isLoading ? <p className="text-sm text-slate-500">جارٍ البحث عن المدارس…</p>
              : schoolSearchResults.error ? <p role="alert" className="text-sm text-rose-700">تعذر البحث عن المدارس: {schoolSearchResults.error.message}</p>
                : schoolSearchResults.data?.length ? schoolSearchResults.data.map((candidate) => (
                  <button key={candidate.id} type="button" onClick={() => chooseSchool(candidate)} className="flex flex-wrap justify-between gap-2 rounded-lg px-3 py-2 text-start text-sm hover:bg-brand-50">
                    <span>{candidate.school_name}</span><span className="text-slate-500">{candidate.ministry_number}</span>
                  </button>
                )) : <p className="text-sm text-slate-500">لا توجد مدرسة مطابقة. جرّب الاسم أو الرقم الوزاري.</p>}
          </div>
        )}
        {status && <p role="status" className="text-sm text-slate-600">{status}</p>}
        {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      </section>

      {planReportStatus && (
        <section className="card grid gap-3 border border-brand-200 bg-brand-50 p-4" aria-live="polite">
          {planReportStatus.kind === 'monthly' && !planReportStatus.visited ? (
            <p className="text-sm text-amber-900">تم تصدير التقرير، لكن لا يمكن تسجيل إنجازه في الخطة الشهرية قبل تسجيل زيارة المدرسة.</p>
          ) : (
            <p className="text-sm text-brand-900">تم تصدير التقرير. هل ترغب بتحديث حالة المدرسة في الخطة إلى «تم إنجاز التقرير»؟</p>
          )}
          <div className="flex flex-wrap gap-2">
            {planReportStatus.visited && <button type="button" onClick={() => void updatePlanReportStatus()} disabled={savingPlanReport} className="rounded-lg bg-brand-800 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{savingPlanReport ? 'جارٍ التحديث…' : 'تحديث الحالة'}</button>}
            <button type="button" onClick={() => setPlanReportStatus(null)} disabled={savingPlanReport} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50">ليس الآن</button>
          </div>
        </section>
      )}

      {isMaintenance ? (
        <div className="grid gap-4 md:grid-cols-2">
          {categories.map((category) => groupPhotos(category.name, category.name, category.requiredCount))}
        </div>
      ) : isTank ? (
        <div className="grid gap-4 md:grid-cols-2">
          {mode === 'before-after'
            ? <>{groupPhotos('before', 'صور قبل الأعمال')}{groupPhotos('after', 'صور بعد الأعمال')}</>
            : groupPhotos('general', 'الصور العامة')}
        </div>
      ) : groupPhotos('general', 'صور التقرير')}

      <button type="button" onClick={() => void exportReport()} disabled={busy || savingPlanReport || Boolean(planReportStatus)} className="inline-flex w-fit items-center gap-2 rounded-lg bg-brand-800 px-5 py-3 font-bold text-white hover:bg-brand-900 disabled:cursor-not-allowed disabled:opacity-60">
        <FileDown size={18} /> {busy ? 'جارٍ إنشاء التقرير…' : 'إنشاء وتصدير التقرير'}
      </button>

      <div className="fixed left-[-20000px] top-0 -z-10" aria-hidden="true">
        <div ref={reportElement} className="report-design-page grid w-[1056px] gap-5 bg-white p-8 text-slate-900" dir="rtl">
          <header data-section-id="header" className="grid gap-2 border-b-2 border-brand-800 pb-4">
            <h1 className="text-2xl font-bold text-brand-900">{title}</h1>
            <p>اسم المدرسة: {school || '—'} · الرقم الوزاري: {ministryCode || '—'}</p>
            {district && <p>الحي / المنطقة: {district}</p>}
            {date && <p>التاريخ: {date}</p>}
          </header>
          {imageGroups.map((group) => (
            <section key={group.title} data-section-id={group.title} className="grid gap-3">
              <h2 className="border-b border-slate-300 pb-2 text-lg font-bold">{group.title}</h2>
              {group.photos.length ? (
                <div className="grid grid-cols-3 gap-3">
                  {group.photos.map((photo, index) => (
                    <figure key={`${photo.file.name}-${index}`} className="grid gap-1 rounded border border-slate-200 p-2">
                      <img src={photo.dataUrl} alt="" className="h-52 w-full object-contain" />
                      <figcaption className="truncate text-center text-xs">{photo.file.name}</figcaption>
                    </figure>
                  ))}
                </div>
              ) : <p className="text-sm text-slate-500">لا توجد صور مضافة.</p>}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

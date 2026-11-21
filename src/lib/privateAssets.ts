import { supabase } from './supabase';

const PRIVATE_ASSETS_BUCKET = 'private-assets';
const STAMP_OBJECT = 'riyad-sig.png';
const MAX_STAMP_SIZE = 5 * 1024 * 1024;

type StorageDownloadError = Error & {
  status?: number | string;
  statusCode?: number | string;
};

function isPermissionError(error: StorageDownloadError): boolean {
  const status = Number(error.statusCode ?? error.status);
  return status === 401 || status === 403
    || /permission|forbidden|unauthorized|row-level security/i.test(error.message);
}

function isMissingObjectError(error: StorageDownloadError): boolean {
  return Number(error.statusCode ?? error.status) === 404
    || /object not found|file not found|does not exist/i.test(error.message);
}

export async function uploadStamp(file: File): Promise<void> {
  if (!supabase) {
    throw new Error('تعذر رفع الختم: اتصال Supabase غير مُعد.');
  }
  if (!file.name.toLocaleLowerCase().endsWith('.png')
    || (file.type && file.type !== 'image/png')
    || file.size === 0
    || file.size > MAX_STAMP_SIZE) {
    throw new Error('اختر ملف PNG صالحًا لا يتجاوز حجمه 5 ميجابايت.');
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    throw new Error(`تعذر التحقق من جلسة المستخدم لرفع الختم: ${sessionError.message}`);
  }
  if (!sessionData.session) {
    throw new Error('تعذر رفع الختم: سجّل الدخول بحساب مدير النظام أو مدير المشروع.');
  }

  const { error } = await supabase.storage
    .from(PRIVATE_ASSETS_BUCKET)
    .upload(STAMP_OBJECT, file, { contentType: 'image/png', upsert: true });
  if (error) {
    const storageError = error as StorageDownloadError;
    if (isPermissionError(storageError)) {
      throw new Error('تعذر رفع الختم: لا تملك الصلاحية. طبّق ترحيل private_assets_upload لحساب مدير النظام أو مدير المشروع.');
    }
    throw new Error(`تعذر رفع الختم إلى التخزين الخاص: ${storageError.message}`);
  }
}

export async function getStampBytes(): Promise<Uint8Array> {
  if (!supabase) {
    throw new Error('تعذر تحميل الختم: اتصال Supabase غير مُعد.');
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    throw new Error(`تعذر التحقق من جلسة المستخدم لتحميل الختم: ${sessionError.message}`);
  }
  if (!sessionData.session) {
    throw new Error('تعذر تحميل الختم: سجّل الدخول بحساب مدير النظام أو مدير المشروع.');
  }

  const { data, error } = await supabase.storage
    .from(PRIVATE_ASSETS_BUCKET)
    .download(STAMP_OBJECT);
  if (error) {
    const storageError = error as StorageDownloadError;
    if (isPermissionError(storageError)) {
      throw new Error('تعذر تحميل الختم: لا تملك صلاحية القراءة. يلزم حساب مدير النظام أو مدير المشروع.');
    }
    if (isMissingObjectError(storageError)) {
      throw new Error('تعذر تحميل الختم: الملف riyad-sig.png غير موجود في bucket private-assets. استخدم زر «رفع الختم» في الصفحة بعد تطبيق ترحيلات private-assets.');
    }
    throw new Error(`تعذر تحميل الختم من التخزين الخاص: ${storageError.message}`);
  }

  return new Uint8Array(await data.arrayBuffer());
}

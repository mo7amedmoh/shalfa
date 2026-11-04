import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';

const databaseName = 'shalfa-offline-cache';
const storeName = 'query-cache';
const cacheKey = 'schools';

function openDatabase(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) return Promise.reject(new Error('IndexedDB غير متاح لحفظ بيانات المدارس دون اتصال.'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('تعذر فتح قاعدة البيانات المحلية.'));
    request.onblocked = () => reject(new Error('قاعدة البيانات المحلية مشغولة في نافذة أخرى.'));
  });
}

export const schoolCachePersister: Persister = {
  async persistClient(client: PersistedClient) {
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).put(client, cacheKey);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('تعذر حفظ بيانات المدارس محلياً.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('أُلغيت عملية حفظ بيانات المدارس.'));
    }).finally(() => database.close());
  },
  async restoreClient() {
    const database = await openDatabase();
    return new Promise<PersistedClient | undefined>((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readonly');
      const request = transaction.objectStore(storeName).get(cacheKey);
      request.onsuccess = () => resolve(request.result as PersistedClient | undefined);
      request.onerror = () => reject(request.error ?? new Error('تعذر قراءة بيانات المدارس المحفوظة.'));
      transaction.oncomplete = () => database.close();
      transaction.onabort = () => {
        database.close();
        reject(transaction.error ?? new Error('أُلغيت عملية قراءة بيانات المدارس.'));
      };
    });
  },
  async removeClient() {
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).delete(cacheKey);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('تعذر حذف نسخة المدارس المحلية.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('أُلغيت عملية حذف نسخة المدارس المحلية.'));
    }).finally(() => database.close());
  },
};

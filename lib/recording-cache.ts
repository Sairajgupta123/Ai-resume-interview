"use client";

export type CachedRecording = {
  chunks: Blob[];
  mimeType: string;
};

const DATABASE_NAME = "mzobs-interview-recordings";
const STORE_NAME = "chunks";
const DATABASE_VERSION = 1;
let databasePromise: Promise<IDBDatabase> | null = null;

function openRecordingDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("Durable browser recording storage is unavailable."));
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: "key" });
        store.createIndex("sessionId", "sessionId", { unique: false });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = null;
      };
      resolve(database);
    };
    request.onerror = () => {
      databasePromise = null;
      reject(request.error || new Error("Could not open local recording storage."));
    };
    request.onblocked = () => {
      databasePromise = null;
      reject(new Error("Local recording storage is blocked by another browser tab."));
    };
  });
  return databasePromise;
}

export async function cacheRecordingChunk(sessionId: string, index: number, blob: Blob, mimeType: string) {
  if (!sessionId || blob.size < 1) return;
  const database = await openRecordingDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put({
      key: sessionId + ":" + String(index).padStart(10, "0"),
      sessionId,
      index,
      mimeType,
      blob,
      savedAt: Date.now()
    });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Could not persist a recording segment."));
    transaction.onabort = () => reject(transaction.error || new Error("Recording segment persistence was interrupted."));
  });
}

export async function getCachedRecording(sessionId: string): Promise<CachedRecording | null> {
  const database = await openRecordingDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).index("sessionId").getAll(sessionId);
    let rows: Array<{ index: number; mimeType: string; blob: Blob }> = [];
    let failed = false;
    const fail = (error: Error) => {
      if (failed) return;
      failed = true;
      reject(error);
    };

    request.onsuccess = () => {
      rows = (request.result as Array<{ index: number; mimeType: string; blob: Blob }>).sort((a, b) => a.index - b.index);
    };
    request.onerror = () => fail(request.error || new Error("Could not recover saved recording segments."));
    transaction.oncomplete = () => {
      if (failed) return;
      if (!rows.length) {
        resolve(null);
        return;
      }
      // Wait for the read transaction to complete before exposing its snapshot.
      // A missing segment would silently concatenate an incomplete video.
      const hasGap = rows.some((row, index) => !Number.isSafeInteger(row.index) || row.index !== index || !(row.blob instanceof Blob) || row.blob.size < 1);
      const mimeType = rows[0].mimeType || "video/webm";
      const hasMixedTypes = rows.some(row => (row.mimeType || "video/webm") !== mimeType);
      if (hasGap || hasMixedTypes) {
        fail(new Error("Saved recording segments are incomplete or inconsistent. The video cannot be safely recovered."));
        return;
      }
      resolve({ chunks: rows.map(row => row.blob), mimeType });
    };
    transaction.onerror = () => fail(transaction.error || new Error("Could not recover saved recording segments."));
    transaction.onabort = () => fail(transaction.error || new Error("Recording recovery was interrupted."));
  });
}

export async function clearCachedRecording(sessionId: string) {
  const database = await openRecordingDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.index("sessionId").openKeyCursor(IDBKeyRange.only(sessionId));
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        store.delete(cursor.primaryKey);
        cursor.continue();
      }
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Could not clear saved recording segments."));
    transaction.onabort = () => reject(transaction.error || new Error("Could not clear saved recording segments."));
  });
}

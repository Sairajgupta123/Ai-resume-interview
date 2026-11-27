"use client";

export type CachedRecording = {
  chunks: Blob[];
  mimeType: string;
  complete: boolean;
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
  // Validate caller-controlled metadata before touching Blob properties or opening
  // IndexedDB. A malformed value should reject cleanly, never throw an incidental
  // TypeError such as reading .size from null.
  if (typeof sessionId !== "string" || !sessionId.trim() || sessionId.length > 256 ||
      !Number.isSafeInteger(index) || index < 0 ||
      !(blob instanceof Blob) ||
      typeof mimeType !== "string" || !mimeType.trim()) {
    throw new Error("Recording segment metadata is invalid.");
  }
  if (blob.size < 1) return;
  const database = await openRecordingDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const saveChunk = () => store.put({
      key: sessionId + ":" + String(index).padStart(10, "0"),
      sessionId,
      index,
      mimeType,
      blob,
      savedAt: Date.now()
    });
    const markStarted = () => store.put({
      key: sessionId + ":meta",
      sessionId,
      recordType: "metadata",
      status: "recording",
      mimeType,
      updatedAt: Date.now()
    });

    // A new recording starts at index zero. Remove any longer, stale recording
    // from the same interview in this transaction before saving its first chunk.
    // This prevents old trailing chunks from being appended during recovery.
    if (index === 0) {
      const cursorRequest = store.index("sessionId").openKeyCursor(IDBKeyRange.only(sessionId));
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor) {
          store.delete(cursor.primaryKey);
          cursor.continue();
        } else {
          markStarted();
          saveChunk();
        }
      };
      cursorRequest.onerror = () => transaction.abort();
    } else {
      saveChunk();
    }

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Could not persist a recording segment."));
    transaction.onabort = () => reject(transaction.error || new Error("Recording segment persistence was interrupted."));
  });
}

export async function markCachedRecordingComplete(sessionId: string, mimeType: string) {
  if (typeof sessionId !== "string" || !sessionId.trim() || sessionId.length > 256 ||
      typeof mimeType !== "string" || !mimeType.trim()) {
    throw new Error("Recording completion metadata is invalid.");
  }
  const database = await openRecordingDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put({
      key: sessionId + ":meta",
      sessionId,
      recordType: "metadata",
      status: "complete",
      mimeType,
      updatedAt: Date.now()
    });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Could not finalize local recording metadata."));
    transaction.onabort = () => reject(transaction.error || new Error("Recording finalization was interrupted."));
  });
}

export async function getCachedRecording(sessionId: string): Promise<CachedRecording | null> {
  if (typeof sessionId !== "string" || !sessionId.trim() || sessionId.length > 256) {
    throw new Error("Recording session identifier is invalid.");
  }
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
      const metadata = rows.find(row => (row as { recordType?: string }).recordType === "metadata") as unknown as { status?: string; mimeType?: string } | undefined;
      const chunks = rows.filter(row => (row as { recordType?: string }).recordType !== "metadata");
      const hasGap = chunks.some((row, index) => !Number.isSafeInteger(row.index) || row.index !== index || !(row.blob instanceof Blob) || row.blob.size < 1);
      const mimeType = metadata?.mimeType || chunks[0]?.mimeType || "video/webm";
      const hasMixedTypes = chunks.some(row => (row.mimeType || "video/webm") !== mimeType);
      const complete = metadata?.status === "complete";
      if (hasGap || hasMixedTypes) {
        fail(new Error("Saved recording segments are incomplete or inconsistent. The video cannot be safely recovered."));
        return;
      }
      resolve({ chunks: chunks.map(row => row.blob), mimeType, complete });
    };
    transaction.onerror = () => fail(transaction.error || new Error("Could not recover saved recording segments."));
    transaction.onabort = () => fail(transaction.error || new Error("Recording recovery was interrupted."));
  });
}

export async function clearCachedRecording(sessionId: string) {
  if (typeof sessionId !== "string" || !sessionId.trim() || sessionId.length > 256) {
    throw new Error("Recording session identifier is invalid.");
  }
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

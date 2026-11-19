"use client";

/**
 * Client-side video blob store (IndexedDB).
 *
 * Uploaded video files are kept in IndexedDB on the current device — no server
 * involved. Config/course records reference a stored file as "idb:<id>"; call
 * resolveSrc() to turn that into a playable object URL. Same demo caveat as the
 * admin store: this is per-browser and not a substitute for real file storage.
 * For production, upload to object storage (e.g. Supabase Storage/S3) instead.
 */

const DB_NAME = "kodelab-media";
const STORE = "videos";
export const IDB_PREFIX = "idb:";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function newVideoId(): string {
  return `vid_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function isStoredVideo(src: string | undefined): boolean {
  return !!src && src.startsWith(IDB_PREFIX);
}

export async function putVideo(id: string, blob: Blob): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function getVideo(id: string): Promise<Blob | undefined> {
  const db = await openDb();
  const blob = await new Promise<Blob | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result as Blob | undefined);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return blob;
}

export async function deleteVideo(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/** Turn a src ("idb:<id>" or a plain URL) into a playable URL. Returns an
 *  object URL for stored files (caller must revoke it) and null on failure. */
export async function resolveSrc(
  src: string
): Promise<{ url: string; revoke: boolean } | null> {
  if (!isStoredVideo(src)) return { url: src, revoke: false };
  const id = src.slice(IDB_PREFIX.length);
  const blob = await getVideo(id);
  if (!blob) return null;
  return { url: URL.createObjectURL(blob), revoke: true };
}

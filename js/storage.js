// Persistence: imported MIDI files live in IndexedDB (they survive reloads and stay on
// this device); small preferences live in localStorage. Every access is guarded so the
// app still works in private windows or with storage disabled.

const DB_NAME = 'nocturne-piano';
const STORE = 'midi';
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const t = db.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      const req = fn(store);
      t.oncomplete = () => resolve(req?.result ?? true);
      t.onerror = () => resolve(null);
      t.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** @returns {Promise<Array<{id, title, fileName, data: ArrayBuffer, added}>>} */
export async function listMidi() {
  return (await tx('readonly', (s) => s.getAll())) || [];
}

export async function saveMidi(record) {
  return tx('readwrite', (s) => s.put(record));
}

export async function deleteMidi(id) {
  return tx('readwrite', (s) => s.delete(id));
}

export function loadPrefs(key, fallback) {
  try {
    const raw = localStorage.getItem(`nocturne:${key}`);
    return raw ? { ...fallback, ...JSON.parse(raw) } : { ...fallback };
  } catch {
    return { ...fallback };
  }
}

export function savePrefs(key, value) {
  try { localStorage.setItem(`nocturne:${key}`, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

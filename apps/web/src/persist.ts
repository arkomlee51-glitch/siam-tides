import type { GameState } from '@siam/engine';

const DB = 'siam-tides';
const STORE = 'saves';
const KEY = 'current';

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest,
): Promise<T | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Autosave is best-effort: a failure must never break the game. */
export const saveGame = (state: GameState): Promise<unknown> =>
  withStore('readwrite', (store) => store.put(state, KEY));

export async function loadSave(): Promise<GameState | null> {
  const saved = await withStore<GameState>('readonly', (store) => store.get(KEY));
  return saved && saved.schemaVersion === 1 && !saved.ended ? saved : null;
}

export const clearSave = (): Promise<unknown> => withStore('readwrite', (store) => store.delete(KEY));

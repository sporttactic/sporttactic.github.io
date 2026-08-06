/* db.js — lightweight IndexedDB wrapper for offline-first storage */
const DB = (() => {
  const DB_NAME = 'handballtactix';
  const DB_VERSION = 1;
  const STORES = [
    'clubs', 'teams', 'players', 'coaches', 'seasons',
    'matches', 'events', 'videos', 'exercises', 'reports',
    'tactics', 'opponents', 'training', 'settings'
  ];
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        STORES.forEach(s => {
          if (!db.objectStoreNames.contains(s)) {
            db.createObjectStore(s, { keyPath: 'id' });
          }
        });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  async function tx(store, mode) {
    const db = await open();
    return db.transaction(store, mode).objectStore(store);
  }

  const api = {
    async getAll(store) {
      const os = await tx(store, 'readonly');
      return new Promise((res, rej) => {
        const r = os.getAll();
        r.onsuccess = () => res(r.result || []);
        r.onerror = () => rej(r.error);
      });
    },
    async get(store, id) {
      const os = await tx(store, 'readonly');
      return new Promise((res, rej) => {
        const r = os.get(id);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    },
    async put(store, obj) {
      const os = await tx(store, 'readwrite');
      return new Promise((res, rej) => {
        const r = os.put(obj);
        r.onsuccess = () => res(obj);
        r.onerror = () => rej(r.error);
      });
    },
    async bulkPut(store, arr) {
      const os = await tx(store, 'readwrite');
      arr.forEach(o => os.put(o));
      return new Promise((res, rej) => {
        os.transaction.oncomplete = () => res(true);
        os.transaction.onerror = () => rej(os.transaction.error);
      });
    },
    async remove(store, id) {
      const os = await tx(store, 'readwrite');
      return new Promise((res, rej) => {
        const r = os.delete(id);
        r.onsuccess = () => res(true);
        r.onerror = () => rej(r.error);
      });
    },
    async clear(store) {
      const os = await tx(store, 'readwrite');
      return new Promise((res, rej) => {
        const r = os.clear();
        r.onsuccess = () => res(true);
        r.onerror = () => rej(r.error);
      });
    },
    STORES
  };
  return api;
})();

/* backup.js — unattended backups.

   The coach picks a file once and the app rewrites it on a timer, so a season's
   work survives a lost laptop without anyone having to remember to export.
   Where the browser has no file access (iPad, Firefox) the same timer falls
   back to an ordinary download. */
window.AUTOBK = (() => {
  const K_MIN = 'stx_autobk_min';      // 0 = off
  const K_LAST = 'stx_autobk_last';
  const K_NAME = 'stx_autobk_name';
  const MINUTES = [0, 5, 15, 30, 60, 180, 720];
  // The file handle lives in its own tiny database: settings.js walks every
  // store of the app database when it builds a backup, and a handle is not
  // something that can be serialised into one.
  const DB_NAME = 'sporttactic-backup';
  let timer = null;
  let busy = false;

  const supported = () => typeof window.showSaveFilePicker === 'function';
  const num = k => { try { return +(localStorage.getItem(k) || 0) || 0; } catch { return 0; } };
  const str = k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
  const put = (k, v) => { try { localStorage.setItem(k, String(v)); } catch { /* private mode */ } };

  function open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('h')) r.result.createObjectStore('h'); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function idb(mode, fn) {
    try {
      const db = await open();
      return await new Promise((res, rej) => {
        const t = db.transaction('h', mode), q = fn(t.objectStore('h'));
        q.onsuccess = () => res(q.result);
        q.onerror = () => rej(q.error);
      });
    } catch (e) { return null; }
  }
  const getHandle = () => idb('readonly', s => s.get('file'));
  const setHandle = h => idb('readwrite', s => s.put(h, 'file'));
  const dropHandle = () => idb('readwrite', s => s.delete('file'));

  // Chrome forgets write permission across reloads, so it is asked for again —
  // which needs a click, hence `ask` only from a button handler.
  async function writable(h, ask) {
    if (!h || !h.queryPermission) return false;
    const opt = { mode: 'readwrite' };
    if (await h.queryPermission(opt) === 'granted') return true;
    if (!ask) return false;
    return await h.requestPermission(opt) === 'granted';
  }

  const fileName = () => 'sporttactic-backup-' + new Date().toISOString().slice(0, 10) + '.json';

  // Let the coach pick the file to keep rewriting. Must be called from a click.
  async function chooseFile() {
    if (!supported()) return null;
    try {
      const h = await window.showSaveFilePicker({
        suggestedName: fileName(),
        types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }]
      });
      await setHandle(h);
      put(K_NAME, h.name || '');
      return h;
    } catch (e) { return null; }   // the picker was cancelled
  }
  async function forgetFile() { await dropHandle(); put(K_NAME, ''); }

  async function runOnce(manual) {
    if (busy) return false;
    busy = true;
    try {
      const json = JSON.stringify(await Backup.build(), null, 2);
      const h = await getHandle();
      if (h && await writable(h, !!manual)) {
        const w = await h.createWritable();
        await w.write(json);
        await w.close();
      } else if (manual || !h) {
        // No file to write into — hand it to the download folder instead.
        if (!Backup.download(json, fileName())) { busy = false; return false; }
      } else {
        busy = false;
        return false;                                  // a file is set but the write was not allowed
      }
      put(K_LAST, Date.now());
      busy = false;
      return true;
    } catch (e) { busy = false; return false; }
  }

  function start() {
    if (timer) { clearInterval(timer); timer = null; }
    const min = num(K_MIN);
    if (!min) return;
    // A tick that cannot write is skipped silently; the next one tries again.
    timer = setInterval(() => {
      if (Date.now() - num(K_LAST) >= min * 60000) runOnce(false);
    }, 60000);
  }

  return {
    MINUTES, supported, start,
    minutes: () => num(K_MIN),
    setMinutes: m => { put(K_MIN, MINUTES.indexOf(+m) >= 0 ? +m : 0); start(); },
    last: () => num(K_LAST),
    fileLabel: () => str(K_NAME),
    hasFile: async () => !!await getHandle(),
    chooseFile, forgetFile,
    now: () => runOnce(true)
  };
})();

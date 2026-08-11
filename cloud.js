/* cloud.js — one shared JSON database on Google Drive.

   The whole idea in two sentences: one person (an admin or a head coach) keeps
   the team's database as a single JSON file in their own Google Drive, and
   everybody else points their app at that file. Coaches you invite as editors
   can write to it; players read it. Nobody has to run a server and nobody has
   to understand Drive permissions — the coach presses one button and hands out
   a short team code.

   Two ways in, so a player never has to sign in to anything:
     · signed in  — the file is fetched with the member's own Google account,
                    which is also the only way to write.
     · team code  — the file is shared as "anyone with the link may view" and is
                    read with the team's Drive API key. No account, no sign-in.

   Merging is per record: whichever copy of a row has the newer updatedAt wins.
   Deletions do not travel that way, so the two "replace" directions exist for
   when a coach wants their copy to simply be the truth. */
const TeamCloud = (() => {
  const FILE_NAME = 'sporttactic-team-db.json';
  const CFG_KEY = 'cloudCfg';
  const FORMAT = 1;
  // Device preferences (theme, language, the Google client id) are personal, so
  // the settings store stays out of the shared file — except the member list,
  // which every coach needs to see the same way.
  const SHARED_SETTINGS = ['accessMembers'];
  const AUTO_MINUTES = [0, 5, 15, 30, 60, 180];

  let timer = null;
  let busy = false;
  const listeners = new Set();

  function syncStores() { return DB.STORES.filter(s => s !== 'settings'); }

  // ---- Configuration -----------------------------------------------------
  // { fileId, apiKey, teamName, owner, autoMin, lastPullAt, lastPushAt, lastErr }
  function cfg() {
    const rec = Store.find('settings', CFG_KEY);
    const v = (rec && rec.value && typeof rec.value === 'object') ? rec.value : {};
    return {
      fileId: String(v.fileId || ''),
      apiKey: String(v.apiKey || ''),
      teamName: String(v.teamName || ''),
      owner: !!v.owner,
      autoMin: +v.autoMin || 0,
      lastPullAt: +v.lastPullAt || 0,
      lastPushAt: +v.lastPushAt || 0,
      lastErr: String(v.lastErr || '')
    };
  }
  async function setCfg(patch) {
    const next = Object.assign(cfg(), patch || {});
    await Store.setSetting(CFG_KEY, next);
    emit();
    return next;
  }
  async function forget() {
    await Store.setSetting(CFG_KEY, {});
    stop();
    emit();
  }
  const isLinked = () => !!cfg().fileId;
  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function emit() { listeners.forEach(fn => { try { fn(); } catch (e) { /* a dead view must not stop the sync */ } }); }

  // ---- Team code ---------------------------------------------------------
  // Short enough to send in a text message, and it carries everything a member
  // needs: which file, which key, and what the team is called.
  function utf8b64(s) {
    const u8 = new TextEncoder().encode(s);
    let bin = '';
    for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
    return btoa(bin);
  }
  function b64utf8(b) {
    const bin = atob(b);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(u8);
  }
  function makeCode() {
    const c = cfg();
    if (!c.fileId) return '';
    const payload = { v: 1, i: c.fileId, n: c.teamName || '' };
    if (c.apiKey) payload.k = c.apiKey;
    return 'STX1-' + utf8b64(JSON.stringify(payload))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function readCode(text) {
    const s = String(text == null ? '' : text).trim().replace(/\s+/g, '');
    if (s.slice(0, 5).toUpperCase() !== 'STX1-') return null;
    let b = s.slice(5).replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    try {
      const o = JSON.parse(b64utf8(b));
      return o && o.i ? { fileId: String(o.i), apiKey: String(o.k || ''), teamName: String(o.n || '') } : null;
    } catch (e) { return null; }
  }
  // A coach will paste whatever they have: the code, the whole Drive address
  // out of the browser bar, or the bare id. All three are accepted.
  function parseTarget(text) {
    const code = readCode(text);
    if (code) return code;
    const s = String(text == null ? '' : text).trim();
    let m = /\/d\/([a-zA-Z0-9_-]{16,})/.exec(s) || /[?&]id=([a-zA-Z0-9_-]{16,})/.exec(s);
    if (m) return { fileId: m[1], apiKey: '', teamName: '' };
    if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return { fileId: s, apiKey: '', teamName: '' };
    return null;
  }

  // ---- The document ------------------------------------------------------
  async function snapshot() {
    const data = {};
    for (const s of syncStores()) data[s] = await Store.pack(await DB.getAll(s));
    const shared = (await DB.getAll('settings')).filter(r => SHARED_SETTINGS.indexOf(r.id) >= 0);
    if (shared.length) data.settings = await Store.pack(shared);
    return {
      app: 'SportTactic', kind: 'team-db', format: FORMAT,
      updatedAt: Date.now(),
      team: cfg().teamName || (Store.activeTeam() ? Store.activeTeam().name : ''),
      by: Access.role(),
      data
    };
  }
  function isTeamDb(doc) {
    return !!(doc && typeof doc === 'object' && doc.data && typeof doc.data === 'object');
  }
  // Row-level merge: the newer updatedAt wins, and a row only one side knows
  // about is simply kept.
  function mergeRows(mine, theirs) {
    const map = new Map();
    (mine || []).forEach(r => { if (r && typeof r.id === 'string') map.set(r.id, r); });
    (theirs || []).forEach(r => {
      if (!r || typeof r.id !== 'string') return;
      const cur = map.get(r.id);
      if (!cur || (+r.updatedAt || 0) > (+cur.updatedAt || 0)) map.set(r.id, r);
    });
    return [...map.values()];
  }

  // ---- Transport ---------------------------------------------------------
  const signedIn = () => !!(window.Drive && Drive.isConnected());
  async function readRemote() {
    const c = cfg();
    if (!c.fileId) throw new Error('not-linked');
    // The signed-in read is tried first: it is the only one that sees a file
    // shared with named people rather than with the link.
    if (window.Drive && (signedIn() || !c.apiKey)) {
      try { return await Drive.downloadJson(c.fileId); }
      catch (e) { if (!c.apiKey) throw e; }
    }
    return Drive.publicDownload(c.fileId, c.apiKey);
  }
  async function writeRemote(doc) {
    const c = cfg();
    if (!c.fileId) throw new Error('not-linked');
    return Drive.uploadJson('', doc, { fileId: c.fileId });
  }

  // ---- Applying what came down -------------------------------------------
  // The read-only pass-key lock guards hand edits; it deliberately does not
  // block a pull, because the shared file is exactly what a locked player copy
  // is supposed to follow.
  async function applyDoc(doc, mode) {
    if (!isTeamDb(doc)) throw new Error('bad-file');
    const replace = mode === 'replace';
    let n = 0;
    for (const s of syncStores()) {
      if (!Array.isArray(doc.data[s])) continue;
      const theirs = Store.unpack(doc.data[s]).filter(r => r && typeof r.id === 'string');
      const rows = replace ? theirs : mergeRows(await DB.getAll(s), theirs);
      if (replace) await DB.clear(s);
      if (rows.length) await DB.bulkPut(s, rows);
      n += theirs.length;
    }
    if (Array.isArray(doc.data.settings)) {
      const rows = Store.unpack(doc.data.settings).filter(r => r && SHARED_SETTINGS.indexOf(r.id) >= 0);
      if (rows.length) { await DB.bulkPut('settings', rows); n += rows.length; }
    }
    await Store.loadAll();
    return n;
  }

  // ---- The four things a coach can actually press ------------------------
  async function pull(mode) {
    if (busy) throw new Error('busy');
    busy = true;
    try {
      const n = await applyDoc(await readRemote(), mode);
      await setCfg({ lastPullAt: Date.now(), lastErr: '' });
      return n;
    } catch (e) {
      await setCfg({ lastErr: msg(e) });
      throw e;
    } finally { busy = false; emit(); }
  }
  async function push(mode) {
    if (!Access.can('cloud.write')) throw new Error('not-allowed');
    if (busy) throw new Error('busy');
    busy = true;
    try {
      let doc = await snapshot();
      if (mode !== 'replace') {
        // Merge on top of whatever is up there, so two coaches saving at the
        // same time do not wipe each other's work.
        let remote = null;
        try { remote = await readRemote(); } catch (e) { remote = null; }
        if (isTeamDb(remote)) {
          for (const s of syncStores()) {
            if (!Array.isArray(remote.data[s])) continue;
            doc.data[s] = mergeRows(remote.data[s], doc.data[s] || []);
          }
          if (Array.isArray(remote.data.settings) && !Array.isArray(doc.data.settings)) {
            doc.data.settings = remote.data.settings;
          }
        }
      }
      await writeRemote(doc);
      await setCfg({ lastPushAt: Date.now(), lastErr: '' });
      return true;
    } catch (e) {
      await setCfg({ lastErr: msg(e) });
      throw e;
    } finally { busy = false; emit(); }
  }
  // What the automatic timer and the single Sync button do: take everything
  // new from the file, then put everything new of ours back.
  async function sync() {
    const got = await pull('merge');
    if (Access.can('cloud.write') && signedIn()) await push('merge');
    return got;
  }
  const msg = e => String((e && e.message) || e || '').slice(0, 200);

  // ---- Setting it up -----------------------------------------------------
  // Owner side: make (or find) the file, fill it with what is on this device,
  // and open it to the link so a code is enough for everybody else.
  async function createShared(teamName, opts) {
    opts = opts || {};
    if (!Access.can('cloud.setup')) throw new Error('not-allowed');
    const folder = await Drive.ensureFolder('SportTactic', null);
    const existing = await Drive.findFile(FILE_NAME, folder);
    await setCfg({ teamName: teamName || '', owner: true, apiKey: opts.apiKey || cfg().apiKey });
    const doc = await snapshot();
    const res = existing
      ? await Drive.uploadJson('', doc, { fileId: existing.id })
      : await Drive.uploadJson(FILE_NAME, doc, { parent: folder });
    const fileId = (res && res.id) || (existing && existing.id);
    await setCfg({ fileId, lastPushAt: Date.now(), lastErr: '' });
    if (opts.linkShare !== false) { try { await Drive.shareAnyone(fileId, 'reader'); } catch (e) { /* the named invites still work */ } }
    return fileId;
  }
  // Invite the people on the access list: coaches and admins as editors,
  // players as viewers. Google sends them the mail.
  async function inviteMembers(list) {
    const c = cfg();
    if (!c.fileId) throw new Error('not-linked');
    const out = [];
    for (const m of list || []) {
      const entry = { id: m.id, email: m.email, role: m.role, ok: false, error: '' };
      try { await Drive.shareWith(c.fileId, m.email, Access.driveRole(m.role)); entry.ok = true; }
      catch (e) { entry.error = msg(e); }
      out.push(entry);
    }
    await Access.markInvited(out.filter(o => o.ok).map(o => o.id));
    return out;
  }
  // Member side: one paste and a first download.
  async function join(text) {
    const t = parseTarget(text);
    if (!t) throw new Error('bad-code');
    await setCfg({ fileId: t.fileId, apiKey: t.apiKey || cfg().apiKey, teamName: t.teamName || cfg().teamName, owner: false });
    return pull('merge');
  }

  // ---- Automatic sync ----------------------------------------------------
  function stop() { if (timer) { clearInterval(timer); timer = null; } }
  // A background read must never be able to open Google's sign-in window, so
  // the timer only fires when this device can already read the file on its own.
  const canSyncQuietly = () => signedIn() || !!cfg().apiKey;
  function start() {
    stop();
    const c = cfg();
    if (!c.fileId || !c.autoMin) return;
    timer = setInterval(() => {
      if (!canSyncQuietly()) return;
      sync().catch(() => { /* offline; the next tick tries again */ });
    }, c.autoMin * 60000);
  }
  async function setAuto(min) {
    await setCfg({ autoMin: Math.max(0, +min || 0) });
    start();
  }

  return {
    AUTO_MINUTES, FILE_NAME,
    cfg, setCfg, forget, isLinked, onChange, signedIn, canSyncQuietly,
    makeCode, readCode, parseTarget,
    snapshot, pull, push, sync,
    createShared, inviteMembers, join,
    start, stop, setAuto
  };
})();
window.TeamCloud = TeamCloud;

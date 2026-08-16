/* cloud.js — shared modular database on Google Drive.

   The whole idea in two sentences: one person (an admin or a head coach) keeps
   the team's database in a dedicated folder in their own Google Drive, split
   into small modular area databases (squad, training, tactics, matches, etc.).
   Coaches you invite as editors can write to it; players only retrieve/sync data.
   Nobody has to run a server — the coach presses one button and hands out
   a short team code.

   Two ways in, so a player never has to sign in to anything:
     · signed in  — the files are fetched with the member's own Google account,
                    which is also the only way for staff to write.
     · team code  — the files are shared as "anyone with the link may view" and are
                    read with the team's Drive API key. No account, no sign-in.

   Merging is per record: whichever copy of a row has the newer updatedAt wins.
   Deletions do not travel that way, so the two "replace" directions exist for
   when a coach wants their copy to simply be the truth. */
const TeamCloud = (() => {
  const FILE_NAME = 'sporttactic-team-db.json';
  const MANIFEST_NAME = 'sporttactic-team-manifest.json';
  const CFG_KEY = 'cloudCfg';
  const FORMAT = 2;

  // Functional area definitions mapping to stores
  const AREA_MAP = {
    squad: ['clubs', 'teams', 'seasons', 'players', 'coaches'],
    matches: ['matches', 'events'],
    training: ['training', 'exercises'],
    tactics: ['tactics'],
    planner: ['planner'],
    video: ['videos'],
    opponents: ['opponents'],
    reports: ['reports'],
    personal: ['personal'],
    settings: ['settings']
  };

  const areaFileName = area => 'sporttactic-area-' + area + '.json';

  // Device preferences (theme, language, the Google client id) are personal, so
  // the settings store stays out of the shared file — except the member list,
  // which every coach needs to see the same way, the player profile, which is
  // the whole point of handing a code to a player, and the role password hashes
  // that decide what a joining device may be. The readable words never travel.
  const SHARED_SETTINGS = ['accessMembers', 'memberProfile', 'roleKeys'];
  const AUTO_MINUTES = [0, 5, 15, 30, 60, 180];
  const MAX_ROWS_PER_STORE = 200000;
  const MEMBER_AUTO_MIN = 15;

  let timer = null;
  let activeSyncPromise = null;
  let coachSyncingState = false;
  const listeners = new Set();

  function syncStores() { return DB.STORES.filter(s => s !== 'settings'); }

  // ---- Concurrency & Lock Management -------------------------------------
  // Instead of throwing 'busy' when multiple operations overlap (e.g. background
  // auto-sync + user clicking sync), concurrent sync requests share the in-flight
  // promise, returning the result smoothly without error.
  function isBusy() { return !!activeSyncPromise; }
  function isCoachSyncing() { return coachSyncingState; }

  function runExclusive(fn) {
    if (activeSyncPromise) {
      return activeSyncPromise;
    }
    const p = (async () => {
      try {
        return await fn();
      } finally {
        activeSyncPromise = null;
      }
    })();
    activeSyncPromise = p;
    return p;
  }

  // Remote lock check: coach holds lock while actively publishing updates
  function isRemoteLocked(doc) {
    if (!doc || !doc.syncLock || !doc.syncLock.locked) return false;
    // Lock expires after 3 minutes (180,000 ms) as safety guard against abandoned writes
    return (Date.now() - (+doc.syncLock.at || 0)) < 180000;
  }

  // ---- Configuration -----------------------------------------------------
  // { fileId, apiKey, teamName, owner, autoMin, lastPullAt, lastPushAt, lastErr, folderId }
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
      lastSkipped: +v.lastSkipped || 0,
      lastErr: String(v.lastErr || ''),
      folderId: String(v.folderId || '')
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
  function emit(info) { listeners.forEach(fn => { try { fn(info); } catch (e) { /* a dead view must not stop the sync */ } }); }

  // ---- Team code ---------------------------------------------------------
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
    const payload = { v: 2, i: c.fileId, n: c.teamName || '' };
    if (c.apiKey) payload.k = c.apiKey;
    const keys = (window.Access && Access.roleKeys) ? Access.roleKeys() : null;
    if (keys) payload.r = keys;
    const cid = Store.find('settings', 'driveClientId');
    if (cid && cid.value) payload.c = String(cid.value);
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
      if (!o || !o.i) return null;
      const out = { fileId: String(o.i), apiKey: String(o.k || ''), teamName: String(o.n || '') };
      if (o.r && typeof o.r === 'object' && o.r.salt && o.r.roles) out.roleKeys = o.r;
      if (o.c) out.clientId = String(o.c);
      return out;
    } catch (e) { return null; }
  }
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
    const pol = Privacy.policy();
    const data = {};
    for (const s of syncStores()) {
      if (!Privacy.mayShare(pol, s)) continue;
      const rows = await DB.getAll(s);
      if (!rows.length) continue;
      data[s] = await Store.pack(Privacy.redactRows(s, rows, pol));
    }
    const out = Privacy.keepTeams(data, pol);
    Object.keys(out).forEach(s => { if (Array.isArray(out[s]) && !out[s].length) delete out[s]; });
    const shared = (await DB.getAll('settings')).filter(r => SHARED_SETTINGS.indexOf(r.id) >= 0);
    if (shared.length) out.settings = await Store.pack(shared);
    return {
      app: 'SportTactic',
      kind: 'team-manifest',
      format: FORMAT,
      updatedAt: Date.now(),
      team: cfg().teamName || (Store.activeTeam() ? Store.activeTeam().name : ''),
      by: Access.role(),
      policy: pol,
      protected: Privacy.protectedPaths(pol),
      data: out
    };
  }
  function isTeamDb(doc) {
    return !!(doc && typeof doc === 'object' && (doc.data || doc.areas || doc.parts));
  }
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
  function countNew(mine, theirs) {
    const map = new Map((mine || []).map(r => [r && r.id, r]));
    return (theirs || []).filter(r => {
      const cur = r && map.get(r.id);
      return !cur || (+r.updatedAt || 0) > (+cur.updatedAt || 0);
    }).length;
  }

  // ---- Transport ---------------------------------------------------------
  const signedIn = () => !!(window.Drive && Drive.isConnected());

  async function readOne(fileId) {
    const c = cfg();
    if (window.Drive && (signedIn() || !c.apiKey)) {
      try { return await Drive.downloadJson(fileId); }
      catch (e) { if (!c.apiKey) throw e; }
    }
    return Drive.publicDownload(fileId, c.apiKey);
  }

  // Reads remote database — supports both new multi-area modular databases in a folder
  // and legacy single-file / part-based team databases.
  // When coach is actively synchronizing, connected devices lock and wait until finished.
  async function readRemote() {
    const c = cfg();
    if (!c.fileId) throw new Error('not-linked');
    let head;
    try { head = await readOne(c.fileId); }
    catch (e) { if (/too large/i.test(msg(e))) e.oversize = true; throw e; }
    if (!head || typeof head !== 'object') throw new Error('not-a-team-file');

    // If coach is currently syncing, lock and wait until finished
    if (!c.owner && isRemoteLocked(head)) {
      coachSyncingState = true;
      emit({ coachSyncing: true, by: (head.syncLock && head.syncLock.by) || 'Coach' });
      const startWait = Date.now();
      while (isRemoteLocked(head) && (Date.now() - startWait < 60000)) {
        await new Promise(r => setTimeout(r, 2500));
        try { head = await readOne(c.fileId); } catch (e) { break; }
      }
      coachSyncingState = false;
      emit({ coachSyncing: false });
    }

    if (!head.data || typeof head.data !== 'object') head.data = {};

    // 1. Modular Multi-Area Database (format 2)
    if (head.areas && typeof head.areas === 'object') {
      const areas = head.areas;
      for (const [areaKey, info] of Object.entries(areas)) {
        if (!info || !info.fileId) continue;
        try {
          const areaDoc = await readOne(info.fileId);
          if (areaDoc && areaDoc.data && typeof areaDoc.data === 'object') {
            Object.assign(head.data, areaDoc.data);
          }
        } catch (err) {
          if (!c.apiKey && !signedIn()) throw err;
        }
      }
      return head;
    }

    // 2. Legacy part files (format 1 backward compatibility)
    const parts = (head && Array.isArray(head.parts)) ? head.parts.filter(p => p && p.store && p.fileId) : [];
    if (!parts.length) return head;
    for (const p of parts) {
      const doc = await readOne(p.fileId);
      const rows = (doc && Array.isArray(doc.rows)) ? doc.rows : null;
      if (!rows) throw new Error('part-unreadable');
      head.data[p.store] = (head.data[p.store] || []).concat(rows);
    }
    return head;
  }

  // Writes modular area database files to the coach's team folder on Google Drive.
  // When coach starts push, remote manifest is locked so players/coaches connected
  // by team code wait and are locked until upload finishes.
  async function writeRemote(doc) {
    const c = cfg();
    if (!c.fileId) throw new Error('not-linked');

    const rootFolder = await Drive.ensureFolder('SportTactic', null);
    const safeName = (c.teamName || (Store.activeTeam() ? Store.activeTeam().name : '') || 'Team').trim().replace(/[/\\?%*:|"<>]/g, '-');
    const teamFolder = c.folderId ? c.folderId : await Drive.ensureFolder(safeName, rootFolder);
    if (!c.folderId) await setCfg({ folderId: teamFolder });

    const existingAreas = (doc.areas && typeof doc.areas === 'object') ? doc.areas : {};
    const updatedAreas = Object.assign({}, existingAreas);

    // 1. If owner/coach, lock manifest before uploading area files
    if (c.owner) {
      try {
        const lockManifest = {
          app: 'SportTactic',
          kind: 'team-manifest',
          format: FORMAT,
          team: doc.team || c.teamName || '',
          updatedAt: Date.now(),
          by: Access.role() || 'Coach',
          syncLock: { locked: true, by: Access.role() || 'Coach', at: Date.now() },
          areas: existingAreas,
          parts: []
        };
        await Drive.uploadJson('', lockManifest, { fileId: c.fileId });
      } catch (e) { /* ignore pre-lock network issues */ }
    }

    // 2. Upload area files
    for (const [areaKey, storeList] of Object.entries(AREA_MAP)) {
      const areaData = {};
      let hasContent = false;
      for (const s of storeList) {
        if (Array.isArray(doc.data[s]) && doc.data[s].length) {
          areaData[s] = doc.data[s];
          hasContent = true;
        }
      }

      const existingInfo = updatedAreas[areaKey];
      const curFileId = existingInfo && existingInfo.fileId;

      if (hasContent) {
        const areaDoc = {
          app: 'SportTactic',
          kind: 'team-area',
          format: FORMAT,
          area: areaKey,
          updatedAt: Date.now(),
          data: areaData
        };

        const res = curFileId
          ? await Drive.uploadJson('', areaDoc, { fileId: curFileId })
          : await Drive.uploadJson(areaFileName(areaKey), areaDoc, { parent: teamFolder });

        const fileId = (res && res.id) || curFileId;
        if (fileId) {
          if (!curFileId) {
            try { await Drive.shareAnyone(fileId, 'reader'); } catch (e) { /* ignore */ }
          }
          updatedAreas[areaKey] = { fileId, updatedAt: Date.now() };
        }
      } else if (curFileId && c.owner) {
        try {
          await Drive.uploadJson('', { app: 'SportTactic', kind: 'team-area', format: FORMAT, area: areaKey, updatedAt: Date.now(), data: {} }, { fileId: curFileId });
        } catch (e) { /* ignore */ }
      }
    }

    // 3. Prepare final manifest with syncLock released (null)
    const manifest = {
      app: 'SportTactic',
      kind: 'team-manifest',
      format: FORMAT,
      team: doc.team || c.teamName || '',
      updatedAt: Date.now(),
      by: Access.role(),
      policy: doc.policy || Privacy.policy(),
      protected: doc.protected || Privacy.protectedPaths(doc.policy || Privacy.policy()),
      syncLock: null,
      areas: updatedAreas,
      parts: []
    };

    return Drive.uploadJson('', manifest, { fileId: c.fileId });
  }

  // ---- Applying what came down -------------------------------------------
  async function applyDoc(doc, mode) {
    if (!isTeamDb(doc)) throw new Error('bad-file');
    const replace = mode === 'replace';
    const guarded = {};
    (Array.isArray(doc.protected) ? doc.protected : []).forEach(p => {
      const i = String(p).indexOf('.');
      if (i < 1) return;
      const s = p.slice(0, i);
      (guarded[s] || (guarded[s] = [])).push(p.slice(i + 1));
    });
    let n = 0;
    for (const s of syncStores()) {
      if (!Array.isArray(doc.data[s])) continue;
      if (doc.data[s].length > MAX_ROWS_PER_STORE) throw new Error('too many records in ' + s);
      const theirs = Store.unpack(doc.data[s]).filter(r => r && typeof r.id === 'string');
      const mine = await DB.getAll(s);
      const keep = guarded[s] || [];
      if (keep.length) {
        const byId = new Map(mine.map(r => [r.id, r]));
        theirs.forEach(r => {
          const local = byId.get(r.id);
          if (!local) return;
          keep.forEach(f => {
            if (local[f] === undefined) delete r[f]; else r[f] = local[f];
          });
        });
      }
      const rows = replace ? theirs : mergeRows(mine, theirs);
      if (replace) await DB.clear(s);
      if (rows.length) await DB.bulkPut(s, rows);
      n += replace ? theirs.length : countNew(mine, theirs);
    }
    if (Array.isArray(doc.data.settings)) {
      const theirs = Store.unpack(doc.data.settings).filter(r => r && SHARED_SETTINGS.indexOf(r.id) >= 0);
      const mine = (await DB.getAll('settings')).filter(r => SHARED_SETTINGS.indexOf(r.id) >= 0);
      const rows = replace ? theirs : mergeRows(mine, theirs);
      if (rows.length) { await DB.bulkPut('settings', rows); n += replace ? theirs.length : countNew(mine, theirs); }
    }
    if (!cfg().owner && doc.policy && typeof doc.policy === 'object') {
      await DB.bulkPut('settings', [{ id: 'sharePolicy', value: doc.policy, updatedAt: Date.now() }]);
    }
    await Store.loadAll();
    await Store.adoptUnscoped();
    return n;
  }

  function revoked(doc) {
    if (cfg().owner || !window.Access || !Access.teamLock) return false;
    const lock = Access.teamLock();
    if (!lock) return false;
    const teams = doc && doc.data && doc.data.teams;
    if (!Array.isArray(teams) || !teams.length) return false;
    if (teams.some(t => t && t.id === lock)) return false;
    const keys = Access.roleKeys();
    if (!keys || !keys.teams) return false;
    return !keys.teams[lock];
  }

  async function cutOff() {
    stop();
    forget();
    try { if (window.Drive && Drive.disconnect) Drive.disconnect(); } catch (e) { /* already gone */ }
    for (const s of DB.STORES) { if (s !== 'settings') await DB.clear(s); }
    const now = Date.now();
    await DB.bulkPut('settings', [
      { id: 'roleClaim', value: null, updatedAt: now },
      { id: 'roleKeys', value: null, updatedAt: now },
      { id: 'memberProfile', value: null, updatedAt: now },
      { id: 'sharePolicy', value: null, updatedAt: now },
      { id: 'accessMembers', value: null, updatedAt: now },
      { id: 'role', value: 'Coach', updatedAt: now }
    ]);
    await Store.loadAll();
    emit({ revoked: true });
  }

  // Internal pull implementation (called within runExclusive)
  async function pullInternal(mode) {
    let got = 0;
    try {
      const doc = await readRemote();
      got = await applyDoc(doc, mode);
      await setCfg({ lastPullAt: Date.now(), lastErr: '' });
      if (revoked(doc)) { await cutOff(); got = 0; return 0; }
      return got;
    } catch (e) {
      await setCfg({ lastErr: e && e.oversize ? (cfg().owner ? 'oversize-owner' : 'oversize') : msg(e) });
      throw e;
    } finally { emit({ pulled: got }); }
  }

  // Internal push implementation (called within runExclusive)
  async function pushInternal(mode) {
    const roleTier = window.Access ? Access.tier() : 'player';
    if (roleTier === 'player') throw new Error('not-allowed');
    if (!Access.can('cloud.write') && !mayContribute()) throw new Error('not-allowed');

    try {
      let doc = await snapshot();
      let remote = null;
      try {
        remote = await readRemote();
      } catch (e) {
        if (!e || !e.oversize || !cfg().owner) throw e;
        mode = 'replace';
      }
      const owner = cfg().owner;
      doc.areas = (remote && remote.areas && typeof remote.areas === 'object') ? remote.areas : {};
      doc.parts = (remote && Array.isArray(remote.parts)) ? remote.parts : [];

      if (!owner && isTeamDb(remote)) {
        const pol = (remote.policy && typeof remote.policy === 'object') ? remote.policy : Privacy.defaults();
        doc.policy = pol;
        doc.protected = Array.isArray(remote.protected) ? remote.protected : doc.protected;
        for (const s of syncStores()) {
          const theirs = Array.isArray(remote.data[s]) ? remote.data[s] : null;
          if (!Privacy.mayEdit(pol, s)) { if (theirs) doc.data[s] = theirs; else delete doc.data[s]; continue; }
          if (!Privacy.mayDelete(pol, s) && theirs) doc.data[s] = mergeRows(theirs, doc.data[s] || []);
        }
      } else if (mode !== 'replace' && isTeamDb(remote)) {
        for (const s of syncStores()) {
          if (!Array.isArray(remote.data[s])) continue;
          if (!doc.data[s]) { doc.data[s] = remote.data[s]; continue; }
          doc.data[s] = mergeRows(remote.data[s], doc.data[s]);
        }
        if (Array.isArray(remote.data.settings) && !Array.isArray(doc.data.settings)) {
          doc.data.settings = remote.data.settings;
        }
      }
      doc.data = Privacy.keepTeams(doc.data, doc.policy);
      await writeRemote(doc);
      await setCfg({ lastPushAt: Date.now(), lastErr: '' });
      return true;
    } catch (e) {
      await setCfg({ lastErr: e && e.oversize ? (cfg().owner ? 'oversize-owner' : 'oversize') : msg(e) });
      throw e;
    } finally { emit(); }
  }

  // Public pull & push wrapped in runExclusive to prevent busy errors
  async function pull(mode) {
    return runExclusive(() => pullInternal(mode));
  }

  async function push(mode) {
    const roleTier = window.Access ? Access.tier() : 'player';
    if (roleTier === 'player') throw new Error('not-allowed');
    return runExclusive(() => pushInternal(mode));
  }

  // Full synchronization:
  // - For player: ONLY retrieves (pulls) data, never pushes.
  // - For coach/admin: pulls latest, then pushes local changes.
  async function sync() {
    return runExclusive(async () => {
      let got = 0;
      try {
        got = await pullInternal('merge');
      } catch (e) {
        if (!e || !e.oversize || !cfg().owner || !signedIn()) throw e;
        await pushInternal('replace');
        return 0;
      }

      // Player can ONLY retrieve data (pull). Only staff/coaches with cloud.write push.
      const roleTier = window.Access ? Access.tier() : 'player';
      const isOwner = cfg().owner;
      const mayWrite = isOwner || (roleTier !== 'player' && Access.can('cloud.write'));

      if (!cfg().fileId || !mayWrite) return got;

      if (mayWrite && !signedIn()) {
        await setCfg({ lastErr: 'signin' });
        throw new Error('signin');
      }
      if (mayWrite) await pushInternal('merge');
      return got;
    });
  }

  function mayContribute() {
    const c = cfg();
    if (!c.fileId || c.owner) return false;
    const roleTier = window.Access ? Access.tier() : 'player';
    if (roleTier === 'player') return false;
    if (!window.Privacy || !Privacy.contributes(Privacy.policy())) return false;
    return syncStores().some(s => Privacy.mayEdit(Privacy.policy(), s));
  }
  const msg = e => String((e && e.message) || e || '').slice(0, 200);

  // ---- Setting it up -----------------------------------------------------
  // Coach: creates a dedicated team folder on Google Drive and sets up modular area databases
  async function createShared(teamName, opts) {
    opts = opts || {};
    if (!Access.can('cloud.setup')) throw new Error('not-allowed');

    const rootFolder = await Drive.ensureFolder('SportTactic', null);
    const safeName = (teamName || (Store.activeTeam() ? Store.activeTeam().name : '') || 'Team').trim().replace(/[/\\?%*:|"<>]/g, '-');
    const teamFolder = await Drive.ensureFolder(safeName, rootFolder);
    await Drive.setTeamFolderId(teamFolder);

    let manifestFile = await Drive.findFile(MANIFEST_NAME, teamFolder);
    if (!manifestFile) manifestFile = await Drive.findFile(FILE_NAME, teamFolder);
    if (!manifestFile) manifestFile = await Drive.findFile(FILE_NAME, rootFolder);

    await setCfg({
      teamName: teamName || '',
      owner: true,
      apiKey: opts.apiKey || cfg().apiKey,
      folderId: teamFolder
    });

    const snap = await snapshot();
    const manifest = {
      app: 'SportTactic',
      kind: 'team-manifest',
      format: FORMAT,
      team: teamName || '',
      updatedAt: Date.now(),
      by: Access.role(),
      policy: snap.policy,
      protected: snap.protected,
      syncLock: null,
      areas: {},
      parts: []
    };

    const res = manifestFile
      ? await Drive.uploadJson('', manifest, { fileId: manifestFile.id })
      : await Drive.uploadJson(MANIFEST_NAME, manifest, { parent: teamFolder });

    const fileId = (res && res.id) || (manifestFile && manifestFile.id);
    await setCfg({ fileId, lastPushAt: Date.now(), lastErr: '' });

    if (opts.linkShare !== false) {
      try { await Drive.shareAnyone(fileId, 'reader'); } catch (e) { /* ignore */ }
      try { await Drive.shareAnyone(teamFolder, 'reader'); } catch (e) { /* ignore */ }
    }

    // Write the area database files in the team folder
    await push('replace');
    return fileId;
  }

  // Invite members by email with appropriate Drive roles across folder, manifest & area files
  async function inviteMembers(list) {
    const c = cfg();
    if (!c.fileId) throw new Error('not-linked');
    const out = [];

    let manifest = null;
    try { manifest = await readOne(c.fileId); } catch (e) { /* ignore */ }
    const fileIds = [c.fileId];
    if (manifest && manifest.areas) {
      Object.values(manifest.areas).forEach(a => { if (a && a.fileId) fileIds.push(a.fileId); });
    }
    if (manifest && Array.isArray(manifest.parts)) {
      manifest.parts.forEach(p => { if (p && p.fileId) fileIds.push(p.fileId); });
    }
    const folderId = c.folderId || await Drive.getTeamFolderId();
    if (folderId) fileIds.push(folderId);

    for (const m of list || []) {
      const dRole = Access.driveRole(m.role);
      const entry = { id: m.id, email: m.email, role: m.role, ok: false, error: '' };
      try {
        for (const fid of fileIds) {
          try { await Drive.shareWith(fid, m.email, dRole); } catch (err) { /* ignore individual file permission errors */ }
        }
        entry.ok = true;
      } catch (e) { entry.error = msg(e); }
      out.push(entry);
    }
    await Access.markInvited(out.filter(o => o.ok).map(o => o.id));
    return out;
  }

  // Member side: join with code and perform first data retrieval
  async function join(text) {
    const t = parseTarget(text);
    if (!t) throw new Error('bad-code');
    if (t.clientId && window.Drive && !(await Drive.getClientId())) {
      try { await Drive.setClientId(t.clientId); } catch (e) { /* ignore */ }
    }
    await setCfg({ fileId: t.fileId, apiKey: t.apiKey || cfg().apiKey, teamName: t.teamName || cfg().teamName, owner: false });
    const n = await pull('merge');
    if (!cfg().autoMin) await setAuto(MEMBER_AUTO_MIN);
    if (t.roleKeys && window.Access && !Access.roleKeys()) await Access.adoptRoleKeys(t.roleKeys);
    return n;
  }

  // ---- Automatic sync ----------------------------------------------------
  function stop() { if (timer) { clearInterval(timer); timer = null; } }
  const canSyncQuietly = () => signedIn() || !!cfg().apiKey;

  function start() {
    stop();
    const c = cfg();
    if (!c.fileId) return;
    if (!c.owner && canSyncQuietly() && !isBusy()) {
      pull('merge').catch(() => { /* offline; timer retries */ });
    }
    if (!c.autoMin) return;
    timer = setInterval(() => {
      if (!canSyncQuietly() || isBusy()) return;
      sync().catch(() => { /* offline; next tick retries */ });
    }, c.autoMin * 60000);
  }

  async function setAuto(min) {
    await setCfg({ autoMin: Math.max(0, +min || 0) });
    start();
  }

  return {
    AUTO_MINUTES, FILE_NAME, MANIFEST_NAME, AREA_MAP,
    cfg, setCfg, forget, isLinked, onChange, signedIn, canSyncQuietly, mayContribute, isBusy, isCoachSyncing,
    makeCode, readCode, parseTarget,
    snapshot, pull, push, sync,
    createShared, inviteMembers, join,
    start, stop, setAuto
  };
})();
window.TeamCloud = TeamCloud;

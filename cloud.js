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
  // which every coach needs to see the same way, the player profile, which is
  // the whole point of handing a code to a player, and the role password hashes
  // that decide what a joining device may be. The readable words never travel.
  const SHARED_SETTINGS = ['accessMembers', 'memberProfile', 'roleKeys'];
  const AUTO_MINUTES = [0, 5, 15, 30, 60, 180];
  const MAX_ROWS_PER_STORE = 50000;
  // What a device gets when it joins with a code. The coach's own copy keeps
  // whatever they chose.
  const MEMBER_AUTO_MIN = 15;

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
  function emit(info) { listeners.forEach(fn => { try { fn(info); } catch (e) { /* a dead view must not stop the sync */ } }); }

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
    // The role password hashes ride along, so a player who pastes the code can
    // be checked against their word straight away — before the first sync, and
    // even if the file has not caught up yet. Only hashes travel, never a word.
    const keys = (window.Access && Access.roleKeys) ? Access.roleKeys() : null;
    if (keys) payload.r = keys;
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
      return out;
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
  // What actually leaves the device: only the blocks the policy shares, only
  // the squads it names, with the personal fields treated the way the coach
  // chose. The policy travels with it so the other side knows what it may
  // change.
  async function snapshot() {
    const pol = Privacy.policy();
    const data = {};
    for (const s of syncStores()) {
      if (!Privacy.mayShare(pol, s)) continue;
      data[s] = await Store.pack(Privacy.redactRows(s, await DB.getAll(s), pol));
    }
    const out = Privacy.keepTeams(data, pol);
    const shared = (await DB.getAll('settings')).filter(r => SHARED_SETTINGS.indexOf(r.id) >= 0);
    if (shared.length) out.settings = await Store.pack(shared);
    return {
      app: 'SportTactic', kind: 'team-db', format: FORMAT,
      updatedAt: Date.now(),
      team: cfg().teamName || (Store.activeTeam() ? Store.activeTeam().name : ''),
      by: Access.role(),
      policy: pol,
      protected: Privacy.protectedPaths(pol),
      data: out
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
  // How much of what came down is actually news. Counting everything received
  // would report the whole club on every routine pull and announce an update
  // that changed nothing.
  function countNew(mine, theirs) {
    const map = new Map((mine || []).map(r => [r && r.id, r]));
    return (theirs || []).filter(r => {
      const cur = r && map.get(r.id);
      return !cur || (+r.updatedAt || 0) > (+cur.updatedAt || 0);
    }).length;
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
    // A masked phone number must never land on top of the real one, so every
    // field the sender redacted is kept from the local copy instead.
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
      // Whoever wrote the shared file chooses how many rows it carries. A
      // device that follows a code must not let that fill its storage.
      if (doc.data[s].length > MAX_ROWS_PER_STORE) throw new Error('shared file too large');
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
      // These rows are written on this device too, so the newer one wins exactly
      // like every other store. A blind overwrite here used to undo a change
      // that had not been pushed yet — new role passwords, for instance, went
      // back to the previous set and the word handed out stopped working.
      const mine = (await DB.getAll('settings')).filter(r => SHARED_SETTINGS.indexOf(r.id) >= 0);
      const rows = replace ? theirs : mergeRows(mine, theirs);
      if (rows.length) { await DB.bulkPut('settings', rows); n += replace ? theirs.length : countNew(mine, theirs); }
    }
    // The club's policy is the club's to set, so a copy that follows the file
    // takes it as it stands. It is what decides here whether this device may
    // send anything back, and it is on the fixed list, so the copy cannot
    // quietly grant itself more than the coach gave it. Written straight to the
    // database because that same list blocks it going through the store.
    if (!cfg().owner && doc.policy && typeof doc.policy === 'object') {
      await DB.bulkPut('settings', [{ id: 'sharePolicy', value: doc.policy, updatedAt: Date.now() }]);
    }
    await Store.loadAll();
    // The planner, the matches and everything else a squad owns are read through
    // Store.scoped(), so a row that arrived without one has to be given a squad
    // or it is on the device and on no screen.
    await Store.adoptUnscoped();
    return n;
  }

  // ---- The four things a coach can actually press ------------------------
  async function pull(mode) {
    if (busy) throw new Error('busy');
    busy = true;
    let got = 0;
    try {
      got = await applyDoc(await readRemote(), mode);
      await setCfg({ lastPullAt: Date.now(), lastErr: '' });
      return got;
    } catch (e) {
      await setCfg({ lastErr: msg(e) });
      throw e;
    } finally { busy = false; emit({ pulled: got }); }
  }
  async function push(mode) {
    if (!Access.can('cloud.write') && !mayContribute()) throw new Error('not-allowed');
    if (busy) throw new Error('busy');
    busy = true;
    try {
      let doc = await snapshot();
      let remote = null;
      try { remote = await readRemote(); } catch (e) { remote = null; }
      const owner = cfg().owner;
      // The owner's policy is the one that counts, so a member sends back the
      // copy they found and only touches the blocks it lets them touch.
      if (!owner && isTeamDb(remote)) {
        const pol = (remote.policy && typeof remote.policy === 'object') ? remote.policy : Privacy.defaults();
        doc.policy = pol;
        doc.protected = Array.isArray(remote.protected) ? remote.protected : doc.protected;
        for (const s of syncStores()) {
          const theirs = Array.isArray(remote.data[s]) ? remote.data[s] : null;
          if (!Privacy.mayEdit(pol, s)) { if (theirs) doc.data[s] = theirs; else delete doc.data[s]; continue; }
          // Without delete rights a removal here must not remove it for everyone.
          if (!Privacy.mayDelete(pol, s) && theirs) doc.data[s] = mergeRows(theirs, doc.data[s] || []);
        }
      } else if (mode !== 'replace' && isTeamDb(remote)) {
        // Merge on top of whatever is up there, so two coaches saving at the
        // same time do not wipe each other's work.
        for (const s of syncStores()) {
          if (!Array.isArray(remote.data[s])) continue;
          if (!doc.data[s]) { doc.data[s] = remote.data[s]; continue; }
          doc.data[s] = mergeRows(remote.data[s], doc.data[s]);
        }
        if (Array.isArray(remote.data.settings) && !Array.isArray(doc.data.settings)) {
          doc.data.settings = remote.data.settings;
        }
      }
      // A squad the file leaves out must not walk back in through the merge, so
      // what is already up there is filtered by the same rule as what we send.
      doc.data = Privacy.keepTeams(doc.data, doc.policy);
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
    if ((Access.can('cloud.write') || mayContribute()) && signedIn()) await push('merge');
    return got;
  }
  // A copy that follows somebody else's file may still send its own work up,
  // when the owner turned contributions on and left at least one block open.
  // Google decides the rest: writing to the file needs a signed-in account the
  // owner invited as an editor, which no API key can stand in for.
  function mayContribute() {
    const c = cfg();
    if (!c.fileId || c.owner) return false;
    if (!window.Privacy || !Privacy.contributes(Privacy.policy())) return false;
    return syncStores().some(s => Privacy.mayEdit(Privacy.policy(), s));
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
    const n = await pull('merge');
    // A player who pasted a code wants the squad, the fixtures and the training
    // plan to stay right — not to go looking for a sync setting. So following a
    // file turns the timer on by itself; the coach's own copy is left alone,
    // because when to publish is their decision.
    if (!cfg().autoMin) await setAuto(MEMBER_AUTO_MIN);
    // The file is the authority on the role passwords; the set carried in the
    // code is the fallback for a club whose file has not been synced since the
    // words were made.
    if (t.roleKeys && window.Access && !Access.roleKeys()) await Access.adoptRoleKeys(t.roleKeys);
    return n;
  }

  // ---- Automatic sync ----------------------------------------------------
  function stop() { if (timer) { clearInterval(timer); timer = null; } }
  // A background read must never be able to open Google's sign-in window, so
  // the timer only fires when this device can already read the file on its own.
  const canSyncQuietly = () => signedIn() || !!cfg().apiKey;
  function start() {
    stop();
    const c = cfg();
    if (!c.fileId) return;
    // A copy that follows somebody else's file is only as fresh as its last
    // pull. Opening the app is itself a reason to refresh — without this a
    // player reads yesterday's team sheet until the first timer tick, and with
    // the timer off they would never see a change at all.
    if (!c.owner && canSyncQuietly()) pull('merge').catch(() => { /* offline; the timer retries */ });
    if (!c.autoMin) return;
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
    cfg, setCfg, forget, isLinked, onChange, signedIn, canSyncQuietly, mayContribute,
    makeCode, readCode, parseTarget,
    snapshot, pull, push, sync,
    createShared, inviteMembers, join,
    start, stop, setAuto
  };
})();
window.TeamCloud = TeamCloud;

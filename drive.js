/* drive.js — Google Drive backup, data sync & coach<->player messaging.
   Client-side only: Google Identity Services (OAuth token model) + Drive REST v3.
   The user supplies their own OAuth Client ID (Google Cloud Console → Web app)
   in Settings; nothing is hard-coded. The whole feature loads lazily, so the app
   keeps working offline (old iPads) until the user chooses to connect. */
const Drive = (() => {
  // drive.file only reaches files this app created, which is all the backup and
  // the team folder need. The full `drive` scope is a RESTRICTED scope: Google
  // blocks unverified apps that ask for it, which is what produced the bare
  // "400 — the request is malformed" page.
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const GIS_SRC = 'https://accounts.google.com/gsi/client';
  const BACKUP_NAME = 'sporttactic-backup.json';
  const ROOT_FOLDER = 'SportTactic';
  // A real client id looks like 1234567890-abcdef.apps.googleusercontent.com.
  const CLIENT_ID_RE = /[0-9]+-[a-z0-9_.-]+\.apps\.googleusercontent\.com/i;
  // The access token used to live only in memory, so every page refresh threw
  // it away and made the coach click "Sign in" again even seconds later. It is
  // short-lived anyway (about an hour) and scoped to drive.file only, so
  // keeping it in localStorage across a reload is no bigger a risk than the
  // session Google itself already holds in its own cookies — and it is never
  // let near a backup file or the shared team database (see PREF_SECRETS in
  // settings.js and CFG_KEY handling in cloud.js).
  const TOKEN_KEY = 'stx_drive_token';

  let token = null;          // { access_token, expires }
  let tokenClient = null;
  let gisLoading = null;

  function now() { return Date.now(); }

  function loadStoredToken() {
    try {
      const raw = localStorage.getItem(TOKEN_KEY);
      if (!raw) return null;
      const v = JSON.parse(raw);
      return (v && v.access_token && (+v.expires || 0) > now() + 5000) ? v : null;
    } catch (e) { return null; }
  }
  function persistToken(t) {
    try {
      if (t) localStorage.setItem(TOKEN_KEY, JSON.stringify(t));
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* private mode */ }
  }
  // Picked up once, when the module first loads — that is, on every page
  // refresh — so a still-valid sign-in survives the reload instead of forcing
  // a fresh popup for a token that was good for another 50 minutes.
  token = loadStoredToken();

  // ---- Configuration (persisted in the settings store) ----
  // Coaches paste whole lines out of the Cloud Console ("Client ID: 123-abc…",
  // quotes, a stray newline), and any of those make Google answer with a 400
  // instead of the sign-in screen — so only the id itself is ever kept.
  function normClientId(v) {
    const m = CLIENT_ID_RE.exec(String(v == null ? '' : v));
    return m ? m[0] : '';
  }
  async function getClientId() {
    const id = await Store.getSetting('driveClientId', '');
    return (id || '').trim();
  }
  async function setClientId(id) {
    const raw = String(id == null ? '' : id).trim();
    const next = raw ? (normClientId(raw) || raw) : '';
    // Re-saving the same id must not drop the token: the setup wizard writes it
    // again on the way out, and doing so used to undo the sign-in the test had
    // just made, leaving the card saying Google was not connected.
    if (next === await getClientId()) return;
    await Store.setSetting('driveClientId', next);
    token = null; tokenClient = null;
    persistToken(null);
  }
  async function isConfigured() { return !!(await getClientId()); }
  function isConnected() { return !!(token && token.access_token && token.expires > now() + 5000); }

  // ---- Google Identity Services loader ----
  function loadGis() {
    if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
    if (gisLoading) return gisLoading;
    gisLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = GIS_SRC; s.async = true; s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => { gisLoading = null; reject(new Error('Could not load Google sign-in (offline?)')); };
      document.head.appendChild(s);
    });
    return gisLoading;
  }

  async function connect() {
    const clientId = normClientId(await getClientId());
    // Everything below is checked BEFORE Google is opened: a malformed request
    // only earns a blank "400 That's an error" page with nothing to act on.
    if (!clientId) throw new Error(tr('drive.errNoId', 'No valid Google OAuth Client ID. It must look like 1234567890-abc.apps.googleusercontent.com — see the guide next to the field.'));
    if (location.protocol !== 'http:' && location.protocol !== 'https:') {
      throw new Error(tr('drive.errOrigin', 'Google sign-in needs the app to be served over http:// or https://. Opening the file directly from disk cannot work.'));
    }
    await loadGis();
    return new Promise((resolve, reject) => {
      try {
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: SCOPE,
          callback: (resp) => {
            if (resp && resp.access_token) {
              token = {
                access_token: resp.access_token,
                expires: now() + (resp.expires_in ? resp.expires_in * 1000 : 3600000)
              };
              persistToken(token);
              resolve(token);
            } else {
              reject(new Error(explain(resp && resp.error)));
            }
          },
          error_callback: (err) => reject(new Error(explain(err && (err.type || err.message))))
        });
        tokenClient.requestAccessToken(token ? {} : { prompt: 'consent' });
      } catch (e) { reject(e); }
    });
  }

  const tr = (k, fallback) => (typeof T === 'function' && T(k) !== k) ? T(k) : fallback;
  // Google's own codes say nothing useful to a coach.
  function explain(code) {
    const c = String(code || '');
    if (c.indexOf('popup_closed') >= 0 || c.indexOf('popup_failed') >= 0) return tr('drive.errPopup', 'The Google sign-in window was closed or blocked. Allow pop-ups for this site and try again.');
    if (c.indexOf('access_denied') >= 0) return tr('drive.errDenied', 'Google refused access. Add your own e-mail under Test users on the OAuth consent screen.');
    if (c.indexOf('idpiframe') >= 0 || c.indexOf('origin') >= 0) return tr('drive.errOriginList', 'This address is not listed under Authorised JavaScript origins for that Client ID.');
    return c || tr('drive.errGeneric', 'Google did not complete the sign-in.');
  }

  function disconnect() {
    if (token && window.google && google.accounts && google.accounts.oauth2) {
      try { google.accounts.oauth2.revoke(token.access_token, () => {}); } catch (e) { /* ignore */ }
    }
    token = null;
    persistToken(null);
  }

  async function ensureToken() {
    if (isConnected()) return token.access_token;
    await connect();
    return token.access_token;
  }

  // ---- Low-level REST ----
  async function api(path, opts) {
    const at = await ensureToken();
    opts = opts || {};
    opts.headers = Object.assign({ Authorization: 'Bearer ' + at }, opts.headers || {});
    const res = await fetch('https://www.googleapis.com/' + path, opts);
    if (!res.ok) {
      let detail = '';
      try { detail = await res.text(); } catch (e) { /* ignore */ }
      throw new Error('Drive API ' + res.status + (detail ? ': ' + detail.slice(0, 180) : ''));
    }
    const ct = res.headers.get('content-type') || '';
    return ct.indexOf('application/json') >= 0 ? res.json() : res.text();
  }

  function esc(v) { return String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

  // ---- Guarded download --------------------------------------------------
  // A team code is a file id somebody handed out, so the file on the other end
  // is not necessarily the one the coach meant. Reading it straight into
  // res.json() lets a wrong — or hostile — id hang the app for ever or pull a
  // multi-gigabyte body into memory until the tab dies. So every read of a
  // shared file is bounded three ways: a deadline, a declared-size check and a
  // hard cap while the body streams in.
  // Matches the backup import limit. Files written before the split existed are
  // one lump, and refusing to open them leaves the club no way back in: opening
  // one is what lets the next push rewrite it in pieces. Still a hard stop, so a
  // hostile file cannot read a phone out of memory.
  const MAX_JSON_BYTES = 96 * 1024 * 1024;
  const FETCH_TIMEOUT = 45000;

  async function fetchJson(url, opts) {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => { if (ctl) ctl.abort(); }, FETCH_TIMEOUT);
    let res;
    try {
      res = await fetch(url, Object.assign({}, opts, ctl ? { signal: ctl.signal } : null));
    } catch (e) {
      clearTimeout(timer);
      throw new Error(e && e.name === 'AbortError' ? 'timeout' : String((e && e.message) || e));
    }
    try {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const len = +res.headers.get('content-length');
      if (len > MAX_JSON_BYTES) throw new Error('file too large');
      const text = await readCapped(res);
      const doc = JSON.parse(text);
      if (!doc || typeof doc !== 'object') throw new Error('not a team file');
      return doc;
    } finally { clearTimeout(timer); }
  }

  // Content-Length is optional and can lie, so the body is also counted as it
  // arrives and the connection dropped the moment it goes over. Decoded in
  // place rather than through a Blob: Blob.arrayBuffer() only landed in Safari
  // 14, and this has to work on the phones the app still supports.
  async function readCapped(res) {
    if (!res.body || typeof res.body.getReader !== 'function') {
      const text = await res.text();
      if (text.length > MAX_JSON_BYTES) throw new Error('file too large');
      return text;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let text = '';
    let seen = 0;
    for (;;) {
      const step = await reader.read();
      if (step.done) break;
      seen += step.value.byteLength;
      if (seen > MAX_JSON_BYTES) { try { reader.cancel(); } catch (e) { /* already gone */ } throw new Error('file too large'); }
      text += dec.decode(step.value, { stream: true });
    }
    return text + dec.decode();
  }

  async function listFiles(q, spaces) {
    const qs = 'q=' + encodeURIComponent(q) +
      '&spaces=' + (spaces || 'drive') +
      '&fields=' + encodeURIComponent('files(id,name,modifiedTime)') +
      '&pageSize=200';
    const r = await api('drive/v3/files?' + qs);
    return (r && r.files) || [];
  }

  async function findFile(name, parent, spaces) {
    let q = "name='" + esc(name) + "' and trashed=false";
    if (parent) q += " and '" + esc(parent) + "' in parents";
    const files = await listFiles(q, spaces);
    return files[0] || null;
  }

  // Create (POST) or update (PATCH) a JSON file via multipart upload.
  async function uploadJson(name, obj, opts) {
    opts = opts || {};
    const meta = name ? { name: name } : {};
    if (!opts.fileId) {
      if (opts.spaces === 'appDataFolder') meta.parents = ['appDataFolder'];
      else if (opts.parent) meta.parents = [opts.parent];
    }
    const boundary = 'stx' + Math.random().toString(36).slice(2);
    const body =
      '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(meta) + '\r\n' +
      '--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' +
      JSON.stringify(obj) + '\r\n' +
      '--' + boundary + '--';
    const path = 'upload/drive/v3/files' + (opts.fileId ? '/' + opts.fileId : '') +
      '?uploadType=multipart&fields=id,name';
    return api(path, {
      method: opts.fileId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'multipart/related; boundary=' + boundary },
      body: body
    });
  }

  async function downloadJson(fileId) {
    const at = await ensureToken();
    return fetchJson('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '?alt=media', {
      headers: { Authorization: 'Bearer ' + at }
    });
  }

  async function ensureFolder(name, parent) {
    let q = "mimeType='application/vnd.google-apps.folder' and name='" + esc(name) + "' and trashed=false";
    if (parent) q += " and '" + esc(parent) + "' in parents";
    const found = await listFiles(q);
    if (found[0]) return found[0].id;
    const meta = { name: name, mimeType: 'application/vnd.google-apps.folder' };
    if (parent) meta.parents = [parent];
    const r = await api('drive/v3/files?fields=id', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta)
    });
    return r.id;
  }

  // Same lookup as ensureFolder, minus the "create it if missing" half — used
  // to check whether a folder already exists without conjuring a new one.
  async function findFolder(name, parent) {
    let q = "mimeType='application/vnd.google-apps.folder' and name='" + esc(name) + "' and trashed=false";
    if (parent) q += " and '" + esc(parent) + "' in parents";
    const found = await listFiles(q);
    return found[0] || null;
  }

  // A browser reset wipes the fileId/folderId this app remembered, but not the
  // team folder still sitting in this Google account's own Drive — drive.file
  // access to what the app created survives that. Lists the folders under
  // SportTactic so a coach can pick theirs back up instead of starting over.
  async function listTeamFolders() {
    const root = await findFolder(ROOT_FOLDER, null);
    if (!root) return [];
    const q = "mimeType='application/vnd.google-apps.folder' and trashed=false and '" + esc(root.id) + "' in parents";
    const found = await listFiles(q);
    return found.slice().sort((a, b) => (b.modifiedTime || '').localeCompare(a.modifiedTime || ''));
  }

  async function shareWith(fileId, email, role) {
    return api('drive/v3/files/' + fileId + '/permissions?sendNotificationEmail=true', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'user', role: role || 'writer', emailAddress: email })
    });
  }

  // "Anyone with the link may view". This is what lets a player read the shared
  // team database without a Google account and without the app asking them for
  // one — the file id alone is the ticket, so it must only ever hold squad data
  // the coach is happy to hand out.
  async function shareAnyone(fileId, role) {
    return api('drive/v3/files/' + fileId + '/permissions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'anyone', role: role || 'reader' })
    });
  }
  async function unshareAnyone(fileId) {
    const r = await api('drive/v3/files/' + fileId + '/permissions?fields=' + encodeURIComponent('permissions(id,type)'));
    const anyone = ((r && r.permissions) || []).filter(p => p.type === 'anyone');
    for (const p of anyone) {
      await api('drive/v3/files/' + fileId + '/permissions/' + p.id, { method: 'DELETE' });
    }
    return anyone.length;
  }
  async function listPermissions(fileId) {
    const r = await api('drive/v3/files/' + fileId + '/permissions?fields=' +
      encodeURIComponent('permissions(id,type,role,emailAddress)'));
    return (r && r.permissions) || [];
  }
  function fileLink(fileId) { return 'https://drive.google.com/file/d/' + fileId + '/view'; }

  // Read a file that is shared with "anyone with the link" using nothing but an
  // API key — no OAuth, so a player can pull the squad on a device that has
  // never seen a Google sign-in screen.
  async function publicDownload(fileId, apiKey) {
    return fetchJson('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) +
      '?alt=media&key=' + encodeURIComponent(apiKey));
  }

  // ---- Backup / restore (private appDataFolder) ----
  function buildDump() {
    const dump = {};
    for (const s of DB.STORES) dump[s] = Store.all(s);
    return dump;
  }
  async function backupNow() {
    const existing = await findFile(BACKUP_NAME, null, 'appDataFolder');
    const res = await uploadJson(BACKUP_NAME, buildDump(), {
      fileId: existing ? existing.id : null, spaces: 'appDataFolder'
    });
    await Store.setSetting('driveBackupAt', now());
    return res;
  }
  async function restoreNow() {
    const existing = await findFile(BACKUP_NAME, null, 'appDataFolder');
    if (!existing) throw new Error('No backup found on Google Drive.');
    const dump = await downloadJson(existing.id);
    for (const s of DB.STORES) {
      if (dump[s]) { await DB.clear(s); await DB.bulkPut(s, dump[s]); }
    }
    await Store.loadAll();
    return true;
  }
  async function lastBackupAt() { return await Store.getSetting('driveBackupAt', 0); }

  // The same file, but in a VISIBLE /SportTactic folder instead of the hidden
  // appDataFolder, so the coach can open, share and download it from Drive
  // themselves. The caller supplies the dump, so the full-fidelity backup built
  // by settings.js (Blobs base64-encoded) is what lands on Drive.
  async function uploadBackup(dump) {
    const root = await ensureFolder(ROOT_FOLDER, null);
    const existing = await findFile(BACKUP_NAME, root);
    const res = await uploadJson(BACKUP_NAME, dump, existing ? { fileId: existing.id } : { parent: root });
    await Store.setSetting('driveBackupAt', now());
    return res;
  }
  async function downloadBackup() {
    const root = await ensureFolder(ROOT_FOLDER, null);
    const existing = await findFile(BACKUP_NAME, root);
    return existing ? await downloadJson(existing.id) : null;
  }

  // ---- Team sync (shared folder) ----
  async function ensureTeamFolder(teamName) {
    const root = await ensureFolder(ROOT_FOLDER, null);
    const folder = await ensureFolder(teamName || 'Team', root);
    await Store.setSetting('driveTeamFolderId', folder);
    return folder;
  }
  async function getTeamFolderId() { return await Store.getSetting('driveTeamFolderId', ''); }
  async function setTeamFolderId(id) { await Store.setSetting('driveTeamFolderId', (id || '').trim()); }

  // ---- Per-player channel (one JSON file per player on the coach's Drive) ----
  // File name: player-<id>.json inside the team folder. A single document holds
  // BOTH the coach<->player messages AND the training the player shares back, so
  // the coach owns/controls it and the player (invited by email) can write to it.
  function channelName(playerId) { return 'player-' + playerId + '.json'; }

  function fullName(p) {
    return ((p.firstName || '') + ' ' + (p.lastName || '')).trim() || (p.name || '');
  }
  function skeleton(player, teamName) {
    return {
      v: 1,
      playerId: player.id,
      playerName: fullName(player),
      email: player.email || '',
      team: teamName || '',
      messages: [],
      training: { updatedAt: 0, sessions: [] }
    };
  }
  function normalize(data) {
    if (!data || typeof data !== 'object') data = {};
    if (typeof data.v !== 'number') data.v = 1;
    if (!Array.isArray(data.messages)) data.messages = [];
    if (!data.training || typeof data.training !== 'object') data.training = { updatedAt: 0, sessions: [] };
    if (!Array.isArray(data.training.sessions)) data.training.sessions = [];
    return data;
  }
  function newMsg(from, fromName, text) {
    return {
      id: 'm_' + now().toString(36) + Math.random().toString(36).slice(2, 6),
      from: from, fromName: fromName || '', text: String(text), at: now()
    };
  }

  // Find (optionally create) a player's channel file. Returns { fileId, data }.
  async function ensureChannel(folderId, player, teamName, create) {
    const name = channelName(player.id);
    const existing = await findFile(name, folderId);
    if (existing) {
      let data; try { data = normalize(await downloadJson(existing.id)); } catch (e) { data = skeleton(player, teamName); }
      return { fileId: existing.id, data: data };
    }
    if (!create) return { fileId: null, data: skeleton(player, teamName) };
    const res = await uploadJson(name, skeleton(player, teamName), { parent: folderId });
    return { fileId: res.id, data: skeleton(player, teamName) };
  }

  // Read a channel file by id (returns normalized data, or null if unreadable).
  async function readChannel(fileId) {
    try { return normalize(await downloadJson(fileId)); } catch (e) { return null; }
  }

  // Read the latest version, let the caller mutate it, then write it back. This
  // read-modify-write keeps the coach's messages and the player's training from
  // clobbering each other when both sides edit the same file.
  async function updateChannel(fileId, mutate) {
    let data; try { data = normalize(await downloadJson(fileId)); } catch (e) { data = normalize(null); }
    mutate(data);
    await uploadJson('', data, { fileId: fileId });
    return data;
  }

  // Coach: create/connect the team folder and a shared file for every player
  // that has an email, inviting each one by email with writer access.
  async function setupTeam(teamName, players) {
    const folderId = await ensureTeamFolder(teamName);
    const results = [];
    for (const p of players) {
      const entry = { playerId: p.id, email: p.email || '', fileId: null, shared: false, error: '' };
      if (!p.email) { entry.error = 'no-email'; results.push(entry); continue; }
      try {
        const ch = await ensureChannel(folderId, p, teamName, true);
        entry.fileId = ch.fileId;
        try { await shareWith(ch.fileId, p.email, 'writer'); entry.shared = true; }
        catch (e) { entry.error = String((e && e.message) || e); }
      } catch (e) { entry.error = String((e && e.message) || e); }
      results.push(entry);
    }
    return { folderId: folderId, results: results };
  }

  // Coach: append a message to a player's channel.
  async function coachSend(fileId, fromName, text) {
    return updateChannel(fileId, d => { d.messages.push(newMsg('coach', fromName, text)); d.coachUpdatedAt = now(); });
  }

  // Coach: read every player channel file in the team folder.
  async function coachReadAll(folderId) {
    const files = await listFiles("name contains 'player-' and '" + esc(folderId) + "' in parents and trashed=false");
    const out = [];
    for (const f of files) {
      try { const data = normalize(await downloadJson(f.id)); if (data.playerId) out.push(Object.assign({ fileId: f.id }, data)); }
      catch (e) { /* skip unreadable file */ }
    }
    return out;
  }

  // Player: find the channel file(s) the coach shared with me by email invite.
  async function findMyChannels() {
    const files = await listFiles("name contains 'player-' and sharedWithMe = true and trashed=false");
    const out = [];
    for (const f of files) {
      let data = null; try { data = normalize(await downloadJson(f.id)); } catch (e) { /* ignore */ }
      out.push({ fileId: f.id, name: f.name, playerId: (data && data.playerId) || '', playerName: (data && data.playerName) || '' });
    }
    return out;
  }

  // Player: append a reply to their channel.
  async function playerSend(fileId, fromName, text) {
    return updateChannel(fileId, d => { d.messages.push(newMsg('player', fromName, text)); d.playerUpdatedAt = now(); });
  }

  // Player: write their training sessions into their channel file.
  async function playerPushTraining(fileId, sessions) {
    return updateChannel(fileId, d => { d.training = { updatedAt: now(), sessions: sessions || [] }; d.playerUpdatedAt = now(); });
  }

  return {
    getClientId, setClientId, normClientId, isConfigured, isConnected,
    connect, disconnect,
    backupNow, restoreNow, lastBackupAt, uploadBackup, downloadBackup,
    ensureTeamFolder, getTeamFolderId, setTeamFolderId, shareWith,
    channelName, ensureChannel, readChannel, updateChannel,
    setupTeam, coachSend, coachReadAll, findMyChannels, playerSend, playerPushTraining,
    // Low-level helpers, used by cloud.js for the shared team database.
    ensureFolder, findFolder, listTeamFolders, findFile, uploadJson, downloadJson, listFiles,
    shareAnyone, unshareAnyone, listPermissions, fileLink, publicDownload
  };
})();
window.Drive = Drive;

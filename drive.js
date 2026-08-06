/* drive.js — Google Drive backup, data sync & coach<->player messaging.
   Client-side only: Google Identity Services (OAuth token model) + Drive REST v3.
   The user supplies their own OAuth Client ID (Google Cloud Console → Web app)
   in Settings; nothing is hard-coded. The whole feature loads lazily, so the app
   keeps working offline (old iPads) until the user chooses to connect. */
const Drive = (() => {
  const SCOPE = 'https://www.googleapis.com/auth/drive';
  const GIS_SRC = 'https://accounts.google.com/gsi/client';
  const BACKUP_NAME = 'sporttactic-backup.json';
  const ROOT_FOLDER = 'SportTactic';

  let token = null;          // { access_token, expires }
  let tokenClient = null;
  let gisLoading = null;

  function now() { return Date.now(); }

  // ---- Configuration (persisted in the settings store) ----
  async function getClientId() {
    const id = await Store.getSetting('driveClientId', '');
    return (id || '').trim();
  }
  async function setClientId(id) {
    await Store.setSetting('driveClientId', (id || '').trim());
    token = null; tokenClient = null;
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
    const clientId = await getClientId();
    if (!clientId) throw new Error('No Google Client ID configured.');
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
              resolve(token);
            } else {
              reject(new Error(resp && resp.error ? resp.error : 'Authorization failed'));
            }
          },
          error_callback: (err) => reject(new Error(err && err.message ? err.message : 'Authorization cancelled'))
        });
        tokenClient.requestAccessToken({ prompt: token ? '' : 'consent' });
      } catch (e) { reject(e); }
    });
  }

  function disconnect() {
    if (token && window.google && google.accounts && google.accounts.oauth2) {
      try { google.accounts.oauth2.revoke(token.access_token, () => {}); } catch (e) { /* ignore */ }
    }
    token = null;
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
    const res = await fetch('https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media', {
      headers: { Authorization: 'Bearer ' + at }
    });
    if (!res.ok) throw new Error('Download failed: ' + res.status);
    return res.json();
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

  async function shareWith(fileId, email, role) {
    return api('drive/v3/files/' + fileId + '/permissions?sendNotificationEmail=true', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'user', role: role || 'writer', emailAddress: email })
    });
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
    getClientId, setClientId, isConfigured, isConnected,
    connect, disconnect,
    backupNow, restoreNow, lastBackupAt,
    ensureTeamFolder, getTeamFolderId, setTeamFolderId, shareWith,
    channelName, ensureChannel, readChannel, updateChannel,
    setupTeam, coachSend, coachReadAll, findMyChannels, playerSend, playerPushTraining
  };
})();
window.Drive = Drive;

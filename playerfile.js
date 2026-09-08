/* playerfile.js — one JSON file per player: the private line between the coach
   and that player.

   The file is made the moment the player is created and deleted the moment the
   player is, so a squad and its files can never drift apart. It is a row in the
   club's own database and travels with the squad exactly like every other row;
   when the two ends do not share a synced copy, Get message and Upload message
   carry the thread through the player's own folder on Google Drive. */
const PlayerFile = (() => {
  const STORE = 'playerfiles';
  const MAX_MSG = 500;          // a conversation, not a log — the oldest fall off
  const MAX_LEN = 2000;
  const AUTO_MINUTES = [1, 5, 10];
  const AUTO_KEY = 'stx_pfile_auto_min';
  const DRIVE_SYNC_MS = 2 * 60 * 1000; // keep every player file current on Drive

  const esc = s => UI.esc(s);
  const t = (k, fallback) => { const r = T(k); return r === k ? fallback : r; };
  function autoMinutes() {
    let n = 5;
    try { n = +(localStorage.getItem(AUTO_KEY) || 5); } catch (e) { /* private mode */ }
    return AUTO_MINUTES.indexOf(n) >= 0 ? n : 5;
  }
  function setAutoMinutes(n) {
    n = +n;
    if (AUTO_MINUTES.indexOf(n) < 0) n = 5;
    try { localStorage.setItem(AUTO_KEY, String(n)); } catch (e) { /* private mode */ }
    return n;
  }

  const fileId = playerId => 'pf_' + playerId;
  const nameOf = p => [p && p.firstName, p && p.lastName].filter(Boolean).join(' ').trim()
    || t('pfile.player', 'Player');

  function get(playerId) { return playerId ? Store.find(STORE, fileId(playerId)) : undefined; }
  function messages(playerId) { const f = get(playerId); return (f && f.messages) || []; }

  // Which end of the line this device writes from. A following copy holding the
  // player's key is the player, whatever role it calls itself.
  function side(player) {
    try {
      if (player && player.id && window.Access && Access.readMode && Access.readMode() && holdsKey(player.id)) return 'player';
      if (window.Access && Access.tier && Access.role) {
        return Access.tier(Access.role()) === 'player' ? 'player' : 'coach';
      }
    } catch (e) { /* roles not set up on this device */ }
    return 'coach';
  }
  const sideLabel = s => s === 'player' ? t('pfile.player', 'Player') : t('pfile.coach', 'Coach');
  function myName(player) {
    if (side(player) === 'player') return nameOf(player);
    let n = '';
    try { n = localStorage.getItem('stx_mail_name') || ''; } catch (e) { /* private mode */ }
    if (n) return n;
    return (window.Access && Access.label) ? Access.label(Access.role()) : t('pfile.coach', 'Coach');
  }
  // ---- Message key --------------------------------------------------------
  // The file syncs to every copy, so anybody could otherwise answer in anybody's
  // name. The coach generates one word per player and hands it over; only a
  // salted hash travels in the file, and the word itself never leaves the two
  // devices that hold it.
  const KEY_ITER = 310000;
  const KEY_LEN = 16;
  const KEY_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no 0/O, 1/I/L
  const HELD = 'stx_pfile_keys';                          // this device only

  const cryptoOk = () => !!(window.crypto && crypto.subtle && crypto.getRandomValues);
  const b64 = buf => { let s = ''; new Uint8Array(buf).forEach(b => { s += String.fromCharCode(b); }); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function hashWord(word, salt, iter) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(word), 'PBKDF2', false, ['deriveBits']);
    return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, 256));
  }
  // The dashes are only there to be read off a screen: the 16 characters alone
  // are what is hashed, so a key pasted with them, without them or in lower case
  // is the same key.
  const canonKey = s => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const prettyKey = s => (canonKey(s).match(/.{1,4}/g) || []).join('-');
  function makeWord() {
    const r = crypto.getRandomValues(new Uint8Array(KEY_LEN));
    return prettyKey([...r].map(n => KEY_CHARS[n % KEY_CHARS.length]).join(''));
  }
  function heldKeys() {
    try { const v = JSON.parse(localStorage.getItem(HELD) || '{}'); return (v && typeof v === 'object') ? v : {}; }
    catch (e) { return {}; }
  }
  function holdKey(playerId, word, hash) {
    const all = heldKeys();
    all[playerId] = { word, set: String(hash).slice(0, 12) };
    try { localStorage.setItem(HELD, JSON.stringify(all)); } catch (e) { /* private mode */ }
  }
  // Deriving the hash costs a third of a second, so the word is verified once
  // and the answer remembered against the hash it was checked against — a key
  // the coach replaces stops working the moment the new one arrives.
  function holdsKey(playerId) {
    const f = get(playerId);
    const k = f && f.key;
    if (!k || !k.hash) return false;
    const held = heldKeys()[playerId];
    return !!held && held.set === String(k.hash).slice(0, 12);
  }
  const heldWord = playerId => (heldKeys()[playerId] || {}).word || '';
  // A key a player typed in before the coach's own arrived is provisional: the
  // coach has never seen that word, so their dialog treats it as none.
  const hasKey = playerId => { const f = get(playerId); return !!(f && f.key && f.key.hash && !f.key.prov); };

  async function newKey(player) {
    if (!player || !player.id || !cryptoOk()) return '';
    const file = get(player.id) || await ensure(player);
    if (!file) return '';
    const word = makeWord();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await hashWord(canonKey(word), salt, KEY_ITER);
    await Store.save(STORE, Object.assign({}, file, {
      key: { salt: b64(salt), iter: KEY_ITER, hash, at: Date.now() }
    }));
    holdKey(player.id, word, hash);
    // The key is put beside the player file on Drive as it is made, because that
    // document is the only thing the player's copy can check the word against.
    if (driveOn()) { try { await driveSync(player, 'push'); } catch (e) { /* the buttons can send it later */ } }
    return word;
  }
  // Is this the word the key block in the file was made from?
  async function sameWord(word, k) {
    if (!k || !k.hash || !k.salt) return false;
    try { return (await hashWord(word, unb64(k.salt), +k.iter || KEY_ITER)) === k.hash; }
    catch (e) { return false; }
  }
  // Returns true, or why it was refused: 'len' for the wrong length, 'bad' for
  // a key that does not match the one the file carries.
  async function claimKey(player, typed) {
    const word = canonKey(typed);
    if (word.length !== KEY_LEN) return 'len';
    if (!cryptoOk()) return 'bad';
    let f = get(player && player.id) || await ensure(player);
    if (!f) return 'bad';
    // A copy the coach's key has never reached asks Drive for the player's own
    // folder and reads it off the document there, so the word is checked for
    // real rather than believed.
    if (!f.key || !f.key.hash || f.key.prov) {
      if (await driveKey(player)) f = get(player.id) || f;
    }
    if (await sameWord(word, f.key)) {
      holdKey(player.id, prettyKey(word), f.key.hash);
      return true;
    }
    // The word does not match the key sitting here. A key the coach replaced
    // after this copy last synced would otherwise turn the word they are
    // reading out away for good, so Drive is asked once more before it is.
    if (f.key && f.key.hash && !f.key.prov) {
      if (!await driveKey(player)) return 'bad';
      f = get(player.id) || f;
      if (!await sameWord(word, f.key)) return 'bad';
      holdKey(player.id, prettyKey(word), f.key.hash);
      return true;
    }
    // Neither the squad nor Drive has the coach's key — a club that never syncs
    // would otherwise leave the player locked out for good. The word handed over
    // is taken on trust and written in, so the player can answer now; it is
    // marked provisional so the coach's own key replaces it when they meet. A
    // word only this copy has ever seen is no proof of anything, so a second
    // one simply takes its place: a mistyped one must not lock the player out.
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await hashWord(word, salt, KEY_ITER);
    await Store.save(STORE, Object.assign({}, get(player.id) || f, {
      key: { salt: b64(salt), iter: KEY_ITER, hash, at: Date.now(), prov: 1 }
    }), { playerFileKey: true });
    holdKey(player.id, prettyKey(word), hash);
    // A copy that refused the write (a frozen backup) never really took the key.
    return holdsKey(player.id) ? true : 'bad';
  }

  // A frozen backup stays frozen. The coach's own copy writes freely; a copy
  // that only follows the club needs the player's key.
  function canWrite(player) {
    // A valid key permits writes only to this player's private file, including
    // on an otherwise locked/read-only player copy.
    if (player && holdsKey(player.id)) return true;
    if (window.Store && Store.locked && Store.locked()) return false;
    if (!(window.Access && Access.readMode && Access.readMode())) return true;
    return false;
  }

  async function ensure(player) {
    if (!player || !player.id) return null;
    const name = nameOf(player);
    const cur = get(player.id);
    if (cur) {
      // A renamed or transferred player keeps the same file.
      if (cur.name === name && cur.teamId === (player.teamId || cur.teamId)) return cur;
      return await Store.save(STORE, Object.assign({}, cur, { name, teamId: player.teamId || cur.teamId }));
    }
    return await Store.save(STORE, {
      id: fileId(player.id), playerId: player.id, teamId: player.teamId || '',
      sport: player.sport || '', name, createdAt: Date.now(), messages: []
    });
  }
  async function remove(playerId) {
    if (!playerId || !Store.raw(STORE, fileId(playerId))) return false;
    return await Store.remove(STORE, fileId(playerId));
  }
  async function post(player, text) {
    const body = String(text == null ? '' : text).trim().slice(0, MAX_LEN);
    if (!body || !player || !player.id || !canWrite(player)) return null;
    const file = get(player.id) || await ensure(player);
    if (!file) return null;
    const msg = { id: Store.uid('msg'), at: Date.now(), side: side(player), by: myName(player), text: body };
    const saved = await Store.save(STORE, Object.assign({}, file, {
      messages: (file.messages || []).concat([msg]).slice(-MAX_MSG)
    }), { playerFileKey: holdsKey(player.id) });
    if (saved) await saveToDrive(player);
    return saved;
  }

  // Squads that existed before player files did get theirs here, and a file
  // whose player is gone is cleared out.
  async function sweep() {
    if (!canWrite()) return 0;
    let n = 0;
    try {
      const players = Store.all('players');
      const ids = new Set(players.map(p => p.id));
      for (const p of players) { if (!get(p.id)) { await ensure(p); n++; } }
      // A delete travels to every copy, so an empty squad is treated as a squad
      // that has not arrived yet rather than one whose files are all orphans.
      if (players.length) {
        for (const f of Store.all(STORE)) { if (!ids.has(f.playerId)) { await Store.remove(STORE, f.id); n++; } }
      }
    } catch (e) { /* a boot repair never blocks the app */ }
    return n;
  }

  const stamp = at => {
    const d = new Date(at);
    return isNaN(d) ? '' : UI.fmtDate(at) + ' ' + d.toTimeString().slice(0, 5);
  };

  // Messages that arrive from outside are rebuilt field by field: a Drive
  // document decides nothing about the row it lands in.
  function cleanMsgs(list, known) {
    return (Array.isArray(list) ? list : []).slice(0, MAX_MSG)
      .filter(m => m && typeof m === 'object' && m.text && !known.has(m.id))
      .map(m => ({
        id: String(m.id || Store.uid('msg')).slice(0, 40),
        at: +m.at || Date.now(),
        side: m.side === 'player' ? 'player' : 'coach',
        by: String(m.by == null ? '' : m.by).slice(0, 60),
        text: String(m.text).slice(0, MAX_LEN)
      }));
  }

  // ---- Google Drive: one folder per player, one JSON inside it ------------
  // SportTactic / <squad> / Players / <Player Name> / <Player Name>.json.
  // Whichever end writes first makes the folder and the file and shares it with
  // the other, so a player holding the key can send a message before the coach
  // has ever opened Drive and the coach still gets it back.
  const DRIVE_DIR = 'Players';
  const driveOn = () => !!(window.Drive && Drive.isConnected && Drive.isConnected());
  const safeName = s => String(s || '').replace(/[/\\?%*:|"<>]+/g, '-').trim();
  const playerDir = player => safeName(nameOf(player)) || String(player.id);
  const driveName = player => playerDir(player) + '.json';
  const qEsc = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const driveDoc = (player, file, messages) => ({
    app: 'SportTactic', kind: 'player-file', v: 1,
    playerId: player.id, playerName: nameOf(player),
    teamId: (file && file.teamId) || '', sport: (file && file.sport) || '',
    // Salt and hash only, never the word: this is what the player's copy checks
    // the key they were handed against. A key only taken on trust is not
    // published, so it can never stand in for the coach's own.
    key: (file && file.key && file.key.hash && !file.key.prov)
      ? { salt: file.key.salt, iter: file.key.iter, hash: file.key.hash, at: file.key.at } : null,
    updatedAt: Date.now(), messages: messages
  });

  // The player's own folder as this account can build it. ensureFolder finds an
  // existing one, so the coach lands on theirs and a player on their own. The
  // team folder id in settings is deliberately not written here: it belongs to
  // the coach's cloud setup and a player copy must not overwrite it.
  async function ownFolder(player) {
    const root = await Drive.ensureFolder('SportTactic', null);
    const t = Store.activeTeam();
    const team = await Drive.ensureFolder(safeName(t && t.name) || 'Team', root);
    const players = await Drive.ensureFolder(DRIVE_DIR, team);
    return await Drive.ensureFolder(playerDir(player), players);
  }
  // The Players folder this copy already knows about, and the player's own
  // folder inside it when it has been made.
  async function knownFolder(player) {
    let team = '';
    try { team = await Drive.getTeamFolderId(); } catch (e) { team = ''; }
    if (!team && window.TeamCloud && TeamCloud.cfg) team = TeamCloud.cfg().folderId || '';
    if (!team) return null;
    try {
      const dir = await Drive.findFolder(DRIVE_DIR, team);
      if (!dir) return null;
      const own = await Drive.findFolder(playerDir(player), dir.id);
      return { players: dir.id, own: (own && own.id) || '' };
    } catch (e) { return null; }
  }
  // The same path as ownFolder, walked by name and creating nothing: it is how a
  // copy with no team folder id of its own still finds the player's folder.
  async function foundFolder(player) {
    try {
      const root = await Drive.findFolder('SportTactic', null);
      if (!root) return '';
      const t = Store.activeTeam();
      const team = await Drive.findFolder(safeName(t && t.name) || 'Team', root.id);
      if (!team) return '';
      const players = await Drive.findFolder(DRIVE_DIR, team.id);
      if (!players) return '';
      const own = await Drive.findFolder(playerDir(player), players.id);
      return (own && own.id) || '';
    } catch (e) { return ''; }
  }
  // The other end, so the file it does not own is still reachable to it.
  function shareTargets(player) {
    const norm = e => (window.MAIL && MAIL.normEmail) ? MAIL.normEmail(e) : String(e || '').trim();
    const out = [];
    if (side(player) === 'player') (Store.coaches() || []).forEach(c => { const e = norm(c.email); if (e) out.push(e); });
    else { const e = norm(player.email); if (e) out.push(e); }
    return out.slice(0, 5);
  }

  // The file in the player's folder, the one shared with this account, or a new
  // one. Copies made before each player had a folder of their own sit straight
  // in Players, so that is looked at too. The answer is kept: finding it again
  // costs four requests, and the dialog asks every few seconds.
  const driveIds = {};
  const driveDirty = new Set();
  const driveBusy = new Set();
  let driveTimer = null;
  async function driveFile(player, create) {
    if (driveIds[player.id]) return driveIds[player.id];
    const name = driveName(player);
    const known = await knownFolder(player);
    if (known) {
      if (known.own) { const hit = await Drive.findFile(name, known.own); if (hit) return (driveIds[player.id] = hit.id); }
      const flat = await Drive.findFile(name, known.players);
      if (flat) return (driveIds[player.id] = flat.id);
    }
    const byName = await foundFolder(player);
    if (byName) { const hit = await Drive.findFile(name, byName); if (hit) return (driveIds[player.id] = hit.id); }
    const shared = await Drive.listFiles("name='" + qEsc(name) + "' and sharedWithMe = true and trashed=false");
    if (shared && shared[0]) return (driveIds[player.id] = shared[0].id);
    if (!create) return '';
    const res = await Drive.uploadJson(name, driveDoc(player, get(player.id), []), { parent: await ownFolder(player) });
    const id = (res && res.id) || '';
    if (id) {
      driveIds[player.id] = id;
      for (const to of shareTargets(player)) {
        try { await Drive.shareWith(id, to, 'writer'); } catch (e) { /* the invite can be sent later */ }
      }
    }
    return id;
  }

  // A key block read from a Drive document. It replaces one this copy only took
  // on trust, and one the coach has since replaced; the word itself is never in
  // there, so nothing but the right to check a word is being handed over.
  async function adoptKey(player, inKey) {
    if (!inKey || typeof inKey !== 'object' || !inKey.hash || !inKey.salt) return false;
    const cur = get(player.id) || await ensure(player);
    if (!cur) return false;
    const mine = cur.key;
    if (mine && mine.hash && !mine.prov && (+inKey.at || 0) <= (+mine.at || 0)) return false;
    await Store.save(STORE, Object.assign({}, cur, {
      key: { salt: String(inKey.salt), iter: +inKey.iter || KEY_ITER, hash: String(inKey.hash), at: +inKey.at || Date.now() }
    }), { playerFileKey: true });
    return true;
  }
  // Fetch the coach's key alone, without touching the thread — what Use key
  // calls before it decides whether the typed word is the right one.
  async function driveKey(player) {
    if (!driveOn()) return false;
    let fileId = '';
    try { fileId = await driveFile(player, false); } catch (e) { return false; }
    if (!fileId) return false;
    let doc = null;
    try { doc = await Drive.downloadJson(fileId); }
    catch (e) { delete driveIds[player.id]; return false; }
    return await adoptKey(player, doc && doc.key);
  }

  // Read what is on Drive and add whatever this copy has not seen; a push then
  // writes the whole thread back. The player sends their message with a push
  // and the coach retrieves it with a pull. A pull never creates the file: the
  // coach fetching from an empty copy must not lay a blank one over the
  // player's.
  async function driveSync(player, mode) {
    const push = mode !== 'pull';
    if (!player || !player.id) return { ok: false, why: 'nofile' };
    if (!driveOn()) return { ok: false, why: 'off' };
    const local = get(player.id) || await ensure(player);
    if (!local) return { ok: false, why: 'nofile' };
    let fileId = '';
    try { fileId = await driveFile(player, push); } catch (e) { return { ok: false, why: 'net' }; }
    if (!fileId) return { ok: false, why: 'nofile' };
    let remote = null;
    try { remote = await Drive.downloadJson(fileId); }
    catch (e) { remote = null; delete driveIds[player.id]; }
    await adoptKey(player, remote && remote.key);
    const mine = local.messages || [];
    const seen = new Set(mine.map(m => m.id));
    const got = cleanMsgs(remote && remote.messages, seen);
    const merged = mine.concat(got).sort((a, b) => a.at - b.at).slice(-MAX_MSG);
    if (got.length) await Store.save(STORE, Object.assign({}, get(player.id) || local, { messages: merged }),
      { playerFileKey: holdsKey(player.id) });
    if (push) {
      // The record is re-read: a key adopted a moment ago has to go back up with
      // the thread, not be written over by the copy held before the merge.
      try { await Drive.uploadJson('', driveDoc(player, get(player.id) || local, merged), { fileId }); }
      catch (e) { delete driveIds[player.id]; return { ok: false, why: 'net', got: got.length }; }
    }
    return { ok: true, got: got.length, total: merged.length };
  }

  // Save a locally changed player file immediately. Failed writes remain
  // dirty and are retried by the two-minute background synchronization.
  async function saveToDrive(player) {
    if (!player || !player.id) return { ok: false, why: 'nofile' };
    driveDirty.add(player.id);
    if (!driveOn() || driveBusy.has(player.id)) {
      return { ok: false, why: driveOn() ? 'busy' : 'off' };
    }
    driveBusy.add(player.id);
    try {
      const result = await driveSync(player, 'push');
      if (result.ok) driveDirty.delete(player.id);
      return result;
    } finally {
      driveBusy.delete(player.id);
    }
  }

  // Every two minutes merge changes from Drive and upload local edits that did
  // not make it there immediately. This runs even when no dialog is open.
  async function syncAll() {
    if (!driveOn()) return;
    let players = [];
    try { players = Store.all('players') || []; } catch (e) { return; }
    for (const player of players) {
      if (!player || !player.id || driveBusy.has(player.id)) continue;
      driveBusy.add(player.id);
      try {
        const result = await driveSync(player, driveDirty.has(player.id) ? 'push' : 'pull');
        if (result.ok) driveDirty.delete(player.id);
      } catch (e) { /* the next two-minute pass retries */ }
      finally { driveBusy.delete(player.id); }
    }
  }

  function startDriveSync() {
    if (driveTimer) clearInterval(driveTimer);
    driveTimer = setInterval(syncAll, DRIVE_SYNC_MS);
  }

  async function clearAll(player) {
    const file = get(player && player.id);
    if (!file || !canWrite(player)) return false;
    await Store.save(STORE, Object.assign({}, file, { messages: [] }),
      { playerFileKey: holdsKey(player.id) });
    await saveToDrive(player);
    return true;
  }

  // The conversation itself, so a view that only wants to show it does not have
  // to open the whole dialog.
  function threadHtml(player) {
    const list = player ? messages(player.id) : [];
    return `<div class="pf-thread">
      ${list.length ? list.map(m => `
        <div class="pf-msg ${m.side === 'player' ? 'from-player' : 'from-coach'}">
          <div class="pf-meta">${esc(m.by || sideLabel(m.side))} \u00b7 ${esc(sideLabel(m.side))} \u00b7 ${esc(stamp(m.at))}</div>
          <div class="pf-text">${esc(m.text)}</div>
        </div>`).join('') : `<p class="hint">${esc(t('pfile.empty', 'Nothing written in this file yet.'))}</p>`}
    </div>`;
  }

  async function copyText(txt) {
    try { await navigator.clipboard.writeText(txt); return true; }
    catch (e) {
      // Safari, and any page without clipboard permission, still has to work.
      const ta = document.createElement('textarea');
      ta.value = txt;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      ta.remove();
      return ok;
    }
  }

  // Coach side: make the word, read it back, hand it over.
  function keyDialog(player, onDone) {
    const back = () => { if (typeof onDone === 'function') onDone(); };
    const open = () => {
      const word = heldWord(player.id);
      const made = hasKey(player.id);
      const stale = made && !word;      // generated on another device
      UI.modal({
        title: t('pfile.key', 'Message key') + ' \u2014 ' + nameOf(player),
        width: 520,
        body: `
          <p class="hint">${esc(t('pfile.keyIntro', 'Hand this word to the player. It is what lets their copy write in this file, and nothing else \u2014 it opens no other part of the club.'))}</p>
          ${word ? `<div class="pf-key" id="pf_key">${esc(word)}</div>`
    : `<p class="hint">${esc(stale
      ? t('pfile.keyElsewhere', 'A key exists, but it was generated on another device and only that one can read it. Generate a new one to replace it.')
      : t('pfile.keyNone', 'No key has been generated for this player yet.'))}</p>`}
          <p class="hint">${esc(t('pfile.keyPrivacy', 'Only a salted hash of the word travels with the squad. The word itself stays on this device and on the one the player types it into.'))}</p>
          ${made ? `<p class="hint">${esc(t('pfile.keyReplace', 'Generating a new key replaces the old one, and a copy still holding it stops being able to write.'))}</p>` : ''}`,
        footer: `<button class="btn ghost" data-close2>${esc(T('common.close'))}</button>
          <button class="btn" data-copy ${word ? '' : 'disabled'}>\u29c9 ${esc(t('pfile.keyCopy', 'Copy key'))}</button>
          <button class="btn primary" data-gen>\u{1F511} ${esc(made ? t('pfile.keyNew', 'Generate new key') : t('pfile.keyGen', 'Generate message key'))}</button>`,
        onOpen: (m, close) => {
          m.querySelector('[data-close2]').onclick = () => { close(); back(); };
          m.querySelector('[data-copy]').onclick = async () => {
            const ok = await copyText(heldWord(player.id));
            UI.toast(ok ? t('pfile.keyCopied', 'Message key copied') : t('pfile.keyCopyFail', 'Could not copy \u2014 read the word off the screen instead'), ok ? 'success' : 'error');
          };
          m.querySelector('[data-gen]').onclick = async () => {
            const btn = m.querySelector('[data-gen]');
            btn.disabled = true;
            const w = await newKey(player);
            btn.disabled = false;
            if (!w) return UI.toast(t('pfile.keyFailed', 'A key could not be generated on this device'), 'error');
            close();
            UI.toast(t('pfile.keyMade', 'Message key generated'), 'success');
            open();
          };
        }
      });
    };
    open();
  }

  // Player side: type the word the coach handed over, once, on this device.
  function claimDialog(player, onDone) {
    const held = holdsKey(player.id);
    const waiting = !held && !hasKey(player.id);
    UI.modal({
      title: t('pfile.key', 'Message key') + ' \u2014 ' + nameOf(player),
      width: 480,
      body: `
        <p class="hint">${esc(held
    ? t('pfile.keyHeld', 'This copy holds the key for this player and may write in the file.')
    : t('pfile.keyAsk', 'Type the message key the coach gave you. It is only needed once on this device.'))}</p>
        ${waiting ? `<p class="hint">${esc(t('pfile.keyTrust', 'The coach\u2019s key has not reached this copy yet, so the word you type is taken on trust and you can write straight away. It is checked for real the next time this copy and the coach\u2019s meet.'))}</p>` : ''}
        <label class="field"><span>${esc(t('pfile.key', 'Message key'))}</span>
          <input id="pf_key_in" maxlength="24" autocomplete="off" spellcheck="false" placeholder="ABCD-EFGH-JKMN-PQRS"></label>`,
      footer: `<button class="btn ghost" data-close2>${esc(T('common.close'))}</button>
        <button class="btn primary" data-claim>${esc(t('pfile.keyUse', 'Use key'))}</button>`,
      onOpen: (m, close) => {
        const inp = m.querySelector('#pf_key_in');
        inp.focus();
        const done = () => { close(); if (typeof onDone === 'function') onDone(); };
        m.querySelector('[data-close2]').onclick = done;
        const claim = async () => {
          const btn = m.querySelector('[data-claim]');
          btn.disabled = true;
          const r = await claimKey(player, inp.value);
          btn.disabled = false;
          if (r === 'len') return UI.toast(t('pfile.keyLen', 'A message key is 16 characters'), 'error');
          if (r !== true) return UI.toast(t('pfile.keyBad', 'That key was not accepted'), 'error');
          UI.toast(t('pfile.keyOk', 'Key accepted \u2014 you can write in your file'), 'success');
          done();
        };
        inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); claim(); } };
        m.querySelector('[data-claim]').onclick = claim;
      }
    });
  }

  // Read the file and write the next line in it. `onDone` runs when the dialog
  // is closed, so the view that opened it can come back.
  function dialog(player, onDone) {
    if (!player || !player.id) return;
    const open = () => {
      const writable = canWrite(player);
      const staff = !(window.Access && Access.readMode && Access.readMode());
      const list = messages(player.id);
      UI.modal({
        title: t('pfile.title', 'Player file') + ' \u2014 ' + nameOf(player),
        width: 620,
        body: `
          <p class="hint">${esc(t('pfile.intro', 'A line kept between the coach and this player. It lives with the squad, so both ends read and write the same file.'))}</p>
          ${threadHtml(player)}
          <label class="field"><span>${esc(t('pfile.write', 'Write'))}</span>
            <textarea id="pf_text" rows="3" maxlength="${MAX_LEN}" ${writable ? '' : 'disabled'}
              placeholder="${esc(t('pfile.ph', 'Write to the other end\u2026'))}"></textarea></label>
          <p class="hint">${esc(writable
            ? t('pfile.signedAs', 'Signed as') + ': ' + myName(player) + ' \u00b7 ' + sideLabel(side(player))
            : staff ? t('pfile.readOnly', 'This copy is read-only, so the file can be read but not written to.')
              : t('pfile.needKey', 'Writing needs the message key the coach generates for you. Press Message key and type it in.'))}</p>
          <label class="field"><span>${esc(t('pfile.autoUpdate', 'Auto update'))}</span>
            <select id="pf_auto">${AUTO_MINUTES.map(n => `<option value="${n}" ${n === autoMinutes() ? 'selected' : ''}>${n} ${esc(n === 1 ? t('pfile.minute', 'minute') : t('pfile.minutes', 'minutes'))}</option>`).join('')}</select>
          </label>`,
        footer: `<button class="btn ghost" data-close2>${esc(T('common.close'))}</button>
          ${staff ? `<button class="btn" data-get>\u2b73 ${esc(t('pfile.dl', 'Get message'))}</button>
          <button class="btn" data-send>\u2b71 ${esc(t('pfile.up', 'Upload message'))}</button>` : ''}
          <button class="btn" data-key>\u{1F511} ${esc(t('pfile.key', 'Message key'))}</button>
          ${staff ? `<button class="btn danger" data-wipe ${list.length ? '' : 'disabled'}>${esc(t('pfile.clear', 'Clear all messages'))}</button>` : ''}
          <button class="btn primary" data-post ${writable ? '' : 'disabled'}>${esc(t('pfile.send', 'Write'))}</button>`,
        onOpen: (m, close) => {
          const box = m.querySelector('.pf-thread');
          if (box) box.scrollTop = box.scrollHeight;
          const inp = m.querySelector('#pf_text');
          if (inp && writable) inp.focus();
          // The dialog stays open and writable after a line is added: only the
          // thread is redrawn, so the next message can be typed straight away.
          const refresh = () => {
            const cur = m.querySelector('.pf-thread');
            if (cur) {
              const holder = document.createElement('div');
              holder.innerHTML = threadHtml(player);
              const next = holder.firstElementChild;
              cur.replaceWith(next);
              next.scrollTop = next.scrollHeight;
            }
            const wipe = m.querySelector('[data-wipe]');
            if (wipe) wipe.disabled = !messages(player.id).length;
          };
          m.querySelector('[data-close2]').onclick = () => { close(); if (typeof onDone === 'function') onDone(); };
          m.querySelector('[data-key]').onclick = () => { close(); (staff ? keyDialog : claimDialog)(player, open); };
          const wipe = m.querySelector('[data-wipe]');
          if (wipe) wipe.onclick = () => UI.confirm(t('pfile.clearAsk', 'Remove every message in this player file? The key and the file itself stay.'), async () => {
            if (!await clearAll(player)) return;
            refresh();
            UI.toast(t('pfile.cleared', 'Player file emptied'), 'success');
          });
          const driveFail = r => {
            if (r.why === 'off') UI.toast(t('pfile.driveOff', 'Google Drive is not connected \u2014 set it up under Settings.'), 'error');
            else if (r.why === 'nofile') UI.toast(t('pfile.driveNone', 'Nothing has been sent to Drive for this player yet.'), 'error');
            else UI.toast(t('pfile.driveFail', 'Drive could not be reached'), 'error');
          };
          // pending is a push that never got through. It is the only way a
          // message leaves a copy whose Drive buttons are hidden, so the next
          // turn of the poll sends it instead of only asking.
          let busy = false, pending = false;
          const drive = async (btn, mode) => {
            btn.disabled = true;
            busy = true;
            const r = await driveSync(player, mode);
            busy = false;
            btn.disabled = false;
            if (!r.ok) return driveFail(r);
            refresh();
            if (mode === 'pull') {
              UI.toast(r.got ? t('pfile.driveGot', 'Fetched from Drive') + ' (' + r.got + ')'
                : t('pfile.driveNothing', 'Nothing new on Drive'), r.got ? 'success' : 'info');
            } else UI.toast(t('pfile.driveSent', 'Player file is up to date on Drive'), 'success');
          };
          const getBtn = m.querySelector('[data-get]');
          if (getBtn) getBtn.onclick = () => drive(getBtn, 'pull');
          const sendBtn = m.querySelector('[data-send]');
          if (sendBtn) sendBtn.onclick = () => drive(sendBtn, 'push');
          // Both ends sit on the same file, so each keeps looking for what the
          // other one wrote for as long as the dialog is open. The modal being
          // off the page is what stops it, which covers every way out.
          let poll = null;
          const autoSync = async () => {
            if (!m.isConnected) { if (poll) clearInterval(poll); return; }
            if (busy || !driveOn()) return;
            busy = true;
            const r = await driveSync(player, pending ? 'push' : 'pull');
            busy = false;
            if (!r.ok) return;
            pending = false;
            if (r.got) refresh();
          };
          const startPoll = minutes => {
            if (poll) clearInterval(poll);
            poll = setInterval(autoSync, setAutoMinutes(minutes) * 60 * 1000);
          };
          const auto = m.querySelector('#pf_auto');
          if (auto) auto.onchange = () => startPoll(auto.value);
          startPoll(autoMinutes());
          m.querySelector('[data-post]').onclick = async () => {
            const text = inp.value.trim();
            if (!text) return UI.toast(t('pfile.needText', 'Write something first'), 'error');
            const btn = m.querySelector('[data-post]');
            btn.disabled = true;
            const saved = await post(player, text);
            btn.disabled = false;
            if (!saved) return UI.toast(t('pfile.needKey', 'Writing needs the message key the coach generates for you.'), 'error');
            inp.value = '';
            inp.focus();
            refresh();
            UI.toast(t('pfile.saved', 'Written in the player file'), 'success');
            // post() already saved to Drive. If that attempt failed, the
            // two-minute background pass retries it automatically.
            pending = driveDirty.has(player.id);
          };
        }
      });
    };
    open();
  }

  return {
    STORE, fileId, get, messages, ensure, remove, post, sweep, dialog, threadHtml, clearAll, canWrite, side,
    newKey, claimKey, holdsKey, hasKey, keyDialog, claimDialog, driveSync, driveName, syncAll, startDriveSync
  };
})();
if (typeof window !== 'undefined') {
  window.PlayerFile = PlayerFile;
  PlayerFile.startDriveSync();
}

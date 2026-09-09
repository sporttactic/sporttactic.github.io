/* playerfile.js â€” one JSON file per player: the private line between the coach
   and that player.

   The file is made the moment the player is created and deleted the moment the
   player is, so a squad and its files can never drift apart. It is a row in the
   club's own database and travels with the squad exactly like every other row;
   when the two ends do not share a synced copy, the thread goes through the
   player's own folder on Google Drive — written there as it is typed and
   fetched back with Get message. */
const PlayerFile = (() => {
  const STORE = 'playerfiles';
  const MAX_MSG = 500;          // a conversation, not a log â€” the oldest fall off
  const MAX_LEN = 2000;
  const AUTO_MINUTES = [1, 5, 10];
  const AUTO_KEY = 'stx_pfile_auto_min';

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
  // Shared/player copies can carry one display-name field instead of the roster pair.
  const nameOf = p => [p && p.firstName, p && p.lastName].filter(Boolean).join(' ').trim()
    || String(p && (p.name || p.playerName || p.displayName) || '').trim()
    || t('pfile.player', 'Player');

  function get(playerId) { return playerId ? Store.find(STORE, fileId(playerId)) : undefined; }
  function messages(playerId) { const f = get(playerId); return (f && f.messages) || []; }

  // Which end of the line this device writes from. A following copy holding the
  // player's key is the player, whatever role it calls itself.
  function side(player) {
    try {
      if (player && player.id && window.Access && Access.readMode && Access.readMode() && holdsWord(player.id)) return 'player';
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
  const HELD = 'stx_pfile_keys';        // this device only, when IndexedDB is not available
  const HELD_DB = 'pfileKeys';          // the same map as a settings row, so it lives in IndexedDB

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
  // The words this device holds. Kept in IndexedDB beside the rest of the app's
  // data (a settings row never enters the shared file or an exported pack), with
  // localStorage as the fallback for a browser that refuses the database. Read
  // synchronously, because every render asks whether this copy may write.
  function heldKeys() {
    const row = (window.Store && Store.find) ? Store.find('settings', HELD_DB) : null;
    if (row && row.value && typeof row.value === 'object') return Object.assign({}, row.value);
    try { const v = JSON.parse(localStorage.getItem(HELD) || '{}'); return (v && typeof v === 'object') ? v : {}; }
    catch (e) { return {}; }
  }
  async function holdKey(playerId, word, hash) {
    const all = heldKeys();
    all[playerId] = { word, set: String(hash).slice(0, 12) };
    try { localStorage.setItem(HELD, JSON.stringify(all)); } catch (e) { /* private mode */ }
    try { await Store.setSetting(HELD_DB, all); } catch (e) { /* no database on this device */ }
    return all;
  }
  // Deriving the hash costs a third of a second, so the word is verified once
  // and the answer remembered against the hash it was checked against â€” a key
  // the coach replaces stops working the moment the new one arrives.
  function holdsKey(playerId) {
    const f = get(playerId);
    const k = f && f.key;
    if (!k || !k.hash || k.prov) return false;
    const held = heldKeys()[playerId];
    return !!held && held.set === String(k.hash).slice(0, 12);
  }
  // The same question while the coach's own key is still on its way: a word
  // taken on trust writes in the local file, but never speaks for Drive.
  function holdsWord(playerId) {
    if (holdsKey(playerId)) return true;
    const f = get(playerId);
    const k = f && f.key;
    const held = heldKeys()[playerId];
    return !!(k && k.hash && k.prov && held && held.set === String(k.hash).slice(0, 12));
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
    // The OAuth client id is public configuration, not a secret. Carrying it
    // with the key lets the player sign in from this dialog without having to
    // understand or visit the coach-only Google Drive settings.
    let clientId = '';
    try {
      if (window.Drive && Drive.getClientId) clientId = await Drive.getClientId();
    } catch (e) { /* Drive may not be configured yet */ }
    await Store.save(STORE, Object.assign({}, file, {
      key: { salt: b64(salt), iter: KEY_ITER, hash, at: Date.now(), clientId: clientId || '' }
    }));
    await holdKey(player.id, word, hash);
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
  // Adopt the coach's public OAuth configuration only after the message key
  // has been verified. This changes no permissions; Google still shows its own
  // account consent window before issuing a Drive token.
  async function useKeyDriveConfig(k) {
    if (!k || !k.clientId || !window.Drive || !Drive.setClientId) return false;
    try {
      const id = Drive.normClientId ? Drive.normClientId(k.clientId) : String(k.clientId);
      if (!id) return false;
      if (!Drive.getClientId || (await Drive.getClientId()) !== id) await Drive.setClientId(id);
      return true;
    } catch (e) { return false; }
  }

  // Returns true for a key checked against the coach's own, 'trust' for one
  // taken on trust because that key has not reached this device yet, or why it
  // was refused: 'len' for the wrong length, 'bad' for a word that does not
  // match the key the file already carries.
  async function claimKey(player, typed) {
    const word = canonKey(typed);
    if (word.length !== KEY_LEN) return 'len';
    if (!cryptoOk()) return 'bad';
    const f = get(player && player.id) || await ensure(player);
    if (!f) return 'bad';

    // Prefer the current Drive copy when it is reachable, but do not require a
    // Drive connection just to check a key. The coach-generated key block is
    // already carried by the synced player file and contains the OAuth client
    // configuration needed to make that first player-side connection.
    if (driveOn()) await driveKey(player);
    const current = get(player.id) || f;
    const key = current && current.key;
    if (key && key.hash && !key.prov) {
      if (!await sameWord(word, key)) return 'bad';
      await holdKey(player.id, prettyKey(word), key.hash);
      await useKeyDriveConfig(key);
      return true;
    }
    // The coach's key has not arrived here yet, so there is nothing to judge the
    // word by. Refusing it would strand a player whose copy simply has not
    // synced since the key was made, so it is taken on trust and marked
    // provisional: it writes in the local file and speaks for nothing on Drive
    // until the coach's own key arrives and matches it.
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await hashWord(word, salt, KEY_ITER);
    await Store.save(STORE, Object.assign({}, current, {
      key: { salt: b64(salt), iter: KEY_ITER, hash, at: Date.now(),
        clientId: (key && key.clientId) || '', prov: true }
    }), { playerFileKey: true });
    await holdKey(player.id, prettyKey(word), hash);
    return 'trust';
  }

  // The word held here against a key block that has since been replaced — by a
  // squad sync or by Drive — is matched again, so a player who typed the right
  // word is not quietly locked out the moment the real key lands.
  async function verifyHeld(player) {
    const id = player && player.id;
    if (!id || !cryptoOk() || holdsKey(id)) return false;
    const word = canonKey(heldWord(id));
    const key = (get(id) || {}).key;
    if (!word || !key || !key.hash || key.prov) return false;
    if (!await sameWord(word, key)) return false;
    await holdKey(id, prettyKey(word), key.hash);
    await useKeyDriveConfig(key);
    return true;
  }

  // A frozen backup stays frozen. The coach's own copy writes freely; a copy
  // that only follows the club needs the player's key.
  function canWrite(player) {
    // A valid key permits writes only to this player's private file, including
    // on an otherwise locked/read-only player copy.
    if (player && holdsWord(player.id)) return true;
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
    }), { playerFileKey: holdsWord(player.id) });
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

  // Clear all messages is a per-side watermark rather than a delete, because a
  // merge only ever adds: without one, the other end simply puts the cleared
  // messages back the next time it writes.
  const clearMark = doc => {
    const c = (doc && doc.cleared) || {};
    return { coach: +c.coach || 0, player: +c.player || 0 };
  };
  const bothMarks = (a, b) => ({ coach: Math.max(a.coach, b.coach), player: Math.max(a.player, b.player) });
  const keptBy = (mark, m) => (+m.at || 0) > mark[m.side === 'player' ? 'player' : 'coach'];

  // ---- Google Drive: one JSON per player in the Players folder ------------
  // <squad database folder> / Players / <Player Name> / <Player Name>.json.
  // Whichever end writes first makes the folders and the file and shares it
  // with the other, so a player holding the key can send a message before the
  // coach has ever opened Drive and the coach still gets it back.
  const DRIVE_DIR = 'Players';
  const driveOn = () => !!(window.Drive && Drive.isConnected && Drive.isConnected());
  const safeName = s => String(s || '').replace(/[/\\?%*:|"<>]+/g, '-').trim();
  const playerDir = player => safeName(nameOf(player)) || String(player.id);
  const driveName = player => playerDir(player) + '.json';
  // Try the current name, the name retained by the player file, and the legacy id name.
  const driveNames = player => {
    const local = get(player && player.id);
    const names = [driveName(player)];
    if (local && local.name) names.push((safeName(local.name) || String(player.id)) + '.json');
    names.push('player-' + String(player.id) + '.json');
    return names.filter((name, i, all) => name && all.indexOf(name) === i);
  };
  const qEsc = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const driveDoc = (player, file, messages, cleared) => ({
    app: 'SportTactic', kind: 'player-file', v: 1,
    playerId: player.id, playerName: nameOf(player),
    teamId: (file && file.teamId) || '', sport: (file && file.sport) || '',
    // Salt and hash only, never the word: this is what the player's copy checks
    // the key they were handed against. A key only taken on trust is not
    // published, so it can never stand in for the coach's own.
    key: (file && file.key && file.key.hash && !file.key.prov)
      ? { salt: file.key.salt, iter: file.key.iter, hash: file.key.hash, at: file.key.at,
          clientId: file.key.clientId || '' } : null,
    cleared: cleared || clearMark(file),
    updatedAt: Date.now(), messages: messages
  });

  // The squad's database folder on Drive as this copy already knows it: the
  // coach's own setting, or the id a copy that joined by team code resolved
  // from the shared manifest. Nothing is searched for or created here.
  async function teamFolder() {
    let id = '';
    try { id = await Drive.getTeamFolderId(); } catch (e) { id = ''; }
    if (!id && window.TeamCloud && TeamCloud.cfg) {
      try { id = TeamCloud.cfg().folderId || ''; } catch (e) { id = ''; }
    }
    return id;
  }
  // <database folder> / Players / <Player Name> / <Player Name>.json, built as
  // far as this account is allowed to. The squad's own database folder is used
  // whenever this copy may write in it, so coach and player land on one file;
  // an account that may not build the same path in its own Drive instead and
  // shares what it writes with the other end. The team folder id in settings is
  // deliberately not written here: it belongs to the coach's cloud setup and a
  // player copy must not overwrite it.
  async function ownFolder(player) {
    const club = await teamFolder();
    if (club) {
      try { return await Drive.ensureFolder(playerDir(player), await Drive.ensureFolder(DRIVE_DIR, club)); }
      catch (e) { /* no right to create in the club folder; use this account's own */ }
    }
    const root = await Drive.ensureFolder('SportTactic', null);
    const t = Store.activeTeam();
    const team = await Drive.ensureFolder(safeName(t && t.name) || 'Team', root);
    return await Drive.ensureFolder(playerDir(player), await Drive.ensureFolder(DRIVE_DIR, team));
  }
  // The Players folder this copy already knows about, and the player's own
  // folder inside it when it has been made.
  async function knownFolder(player) {
    const team = await teamFolder();
    if (!team) return null;
    try {
      const dir = await Drive.findFolder(DRIVE_DIR, team);
      if (!dir) return null;
      const own = await Drive.findFolder(playerDir(player), dir.id);
      return { players: dir.id, own: (own && own.id) || '' };
    } catch (e) { return null; }
  }
  // The same path as ownFolder, walked by name and creating nothing: it is how a
  // copy with no team folder id of its own still finds the Players folder.
  async function foundFolder(player) {
    try {
      const root = await Drive.findFolder('SportTactic', null);
      if (!root) return null;
      const t = Store.activeTeam();
      const team = await Drive.findFolder(safeName(t && t.name) || 'Team', root.id);
      if (!team) return null;
      const players = await Drive.findFolder(DRIVE_DIR, team.id);
      if (!players) return null;
      const own = await Drive.findFolder(playerDir(player), players.id);
      return { players: players.id, own: (own && own.id) || '' };
    } catch (e) { return null; }
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

  // Keep the exact Drive id in the shared player-file row. A file shared with a
  // player is not reliably discoverable by name under Drive's narrow
  // `drive.file` OAuth scope, but it is reachable by id. Carrying the id with
  // the squad also makes the connection survive a reload on either device.
  async function rememberDriveId(player, id) {
    id = String(id || '');
    if (!player || !player.id || !id) return id;
    driveIds[player.id] = id;
    const file = get(player.id);
    if (file && file.driveId !== id) {
      await Store.save(STORE, Object.assign({}, file, { driveId: id }),
        { playerFileKey: holdsWord(player.id) });
    }
    return id;
  }

  async function forgetDriveId(player) {
    if (!player || !player.id) return;
    delete driveIds[player.id];
    const file = get(player.id);
    if (file && file.driveId) {
      const next = Object.assign({}, file);
      delete next.driveId;
      await Store.save(STORE, next, { playerFileKey: holdsWord(player.id) });
    }
  }

  async function driveFile(player, create) {
    if (driveIds[player.id]) return driveIds[player.id];
    const local = get(player.id);
    if (local && local.driveId) return (driveIds[player.id] = String(local.driveId));
    const names = driveNames(player);
    const name = names[0];
    // The player's own folder first, then the Players folder itself, where
    // copies made before each player had a folder of their own still sit.
    const lookIn = async dir => {
      if (!dir) return '';
      for (const candidate of names) {
        for (const parent of [dir.own, dir.players]) {
          if (!parent) continue;
          const hit = await Drive.findFile(candidate, parent);
          if (hit) return await rememberDriveId(player, hit.id);
        }
      }
      return '';
    };
    const inKnown = await lookIn(await knownFolder(player));
    if (inKnown) return inKnown;
    const inFound = await lookIn(await foundFolder(player));
    if (inFound) return inFound;
    // Search all app-visible files by every compatible exact player filename.
    for (const candidate of names) {
      const visible = await Drive.listFiles("name='" + qEsc(candidate) + "' and trashed=false");
      if (visible && visible[0]) return await rememberDriveId(player, visible[0].id);
      const shared = await Drive.listFiles("name='" + qEsc(candidate) + "' and sharedWithMe and trashed=false");
      if (shared && shared[0]) return await rememberDriveId(player, shared[0].id);
    }
    if (!create) return '';
    const res = await Drive.uploadJson(name, driveDoc(player, get(player.id), []), { parent: await ownFolder(player) });
    const id = (res && res.id) || '';
    if (id) {
      await rememberDriveId(player, id);
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
      key: { salt: String(inKey.salt), iter: +inKey.iter || KEY_ITER, hash: String(inKey.hash),
        at: +inKey.at || Date.now(), clientId: String(inKey.clientId || '') }
    }), { playerFileKey: true });
    return true;
  }
  // Fetch the coach's key alone, without touching the thread â€” what Use key
  // calls before it decides whether the typed word is the right one.
  async function driveKey(player) {
    if (!driveOn()) return false;
    let fileId = '';
    try { fileId = await driveFile(player, false); } catch (e) { return false; }
    if (!fileId) return false;
    let doc = null;
    try { doc = await Drive.downloadJson(fileId); }
    catch (e) { await forgetDriveId(player); return false; }
    const downloaded = doc && doc.key;
    if (await adoptKey(player, downloaded)) return true;

    // adoptKey deliberately does nothing when this exact coach key is already
    // present. That is still a successful fetch: requiring an adoption here
    // made every valid key look wrong once the player file had already synced.
    const current = get(player.id);
    const local = current && current.key;
    return !!(downloaded && local && !local.prov
      && String(downloaded.hash) === String(local.hash)
      && String(downloaded.salt) === String(local.salt)
      && (+downloaded.iter || KEY_ITER) === (+local.iter || KEY_ITER));
  }

  // A verified message key is enough to reach Google sign-in. The player does
  // not need access to Settings; the client id arrived with the coach's key.
  async function connectWithKey(player) {
    if (driveOn()) return true;
    if (!player || !holdsWord(player.id) || !window.Drive || !Drive.connect) return false;
    const f = get(player.id);
    await useKeyDriveConfig(f && f.key);
    try {
      await Drive.connect();
      return driveOn();
    } catch (e) { return false; }
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

    // A player copy writes only with the coach's own key: the block it holds
    // came down with the squad and is the one it publishes, so a locally
    // invented key can never become the authoritative one. Without that key a
    // player copy may still read an existing file, never make one.
    const playerCopy = side(player) === 'player';
    const keyed = !playerCopy || holdsKey(player.id);
    let fileId = '';
    try { fileId = await driveFile(player, push && keyed); }
    catch (e) { return { ok: false, why: 'net' }; }
    if (!fileId) return { ok: false, why: keyed ? 'nofile' : 'badkey' };

    let remote = null;
    try { remote = await Drive.downloadJson(fileId); }
    catch (e) {
      // A remembered id may point at a deleted or replaced file. Clear it and
      // retry the full filename lookup during this operation, rather than
      // requiring a second press of Get message.
      await forgetDriveId(player);
      try {
        fileId = await driveFile(player, false);
        if (fileId) remote = await Drive.downloadJson(fileId);
      } catch (e2) {
        await forgetDriveId(player);
        fileId = '';
      }
      if (!fileId && push && keyed) {
        try {
          fileId = await driveFile(player, true);
          remote = fileId ? await Drive.downloadJson(fileId) : null;
        } catch (e3) { return { ok: false, why: 'net' }; }
      } else if (!fileId) {
        return { ok: false, why: keyed ? 'net' : 'badkey' };
      }
    }

    if (playerCopy) {
      // Recheck the held word against the key currently inside the Google file
      // before every merge or upload. Replacing a key therefore revokes an old
      // player copy before it can write again. A file that carries no key of
      // its own yet is judged by the coach key that arrived with the squad.
      const word = canonKey(heldWord(player.id));
      const remoteKey = (remote && remote.key) || null;
      const localKey = (get(player.id) || local).key;
      const against = (remoteKey && remoteKey.hash) ? remoteKey
        : (localKey && localKey.hash && !localKey.prov ? localKey : null);
      if (!word || !against || !await sameWord(word, against)) {
        return { ok: false, why: 'badkey' };
      }
      await adoptKey(player, remoteKey);
      const verified = get(player.id);
      if (!verified || !verified.key || verified.key.hash !== against.hash) {
        return { ok: false, why: 'badkey' };
      }
      await holdKey(player.id, prettyKey(word), verified.key.hash);
    } else {
      await adoptKey(player, remote && remote.key);
    }

    // Whatever either end has cleared stays cleared, on both copies.
    const store = get(player.id) || local;
    const mark = bothMarks(clearMark(store), clearMark(remote));
    const mine = (store.messages || []).filter(m => keptBy(mark, m));
    const seen = new Set((store.messages || []).map(m => m.id));
    const got = cleanMsgs(remote && remote.messages, seen).filter(m => keptBy(mark, m));
    const merged = mine.concat(got).sort((a, b) => a.at - b.at).slice(-MAX_MSG);
    if (merged.length !== (store.messages || []).length || got.length
      || mark.coach !== clearMark(store).coach || mark.player !== clearMark(store).player) {
      await Store.save(STORE, Object.assign({}, store, { messages: merged, cleared: mark }),
        { playerFileKey: holdsWord(player.id) });
    }
    if (push) {
      try { await Drive.uploadJson('', driveDoc(player, get(player.id) || store, merged, mark), { fileId }); }
      catch (e) {
        await forgetDriveId(player);
        return { ok: false, why: 'net', got: got.length };
      }
    }
    return { ok: true, got: got.length, total: merged.length };
  }

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

  // At the interval selected in either player-file dialog, merge changes from
  // Drive and retry local edits. This also runs while no dialog is open.
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
      } catch (e) { /* the next scheduled pass retries */ }
      finally { driveBusy.delete(player.id); }
    }
  }

  function startDriveSync() {
    if (driveTimer) clearInterval(driveTimer);
    driveTimer = setInterval(syncAll, autoMinutes() * 60 * 1000);
  }
  // A player who has just connected Google must publish their local private
  // file immediately. A normal clean background pass pulls, so waiting for the
  // timer could leave the account connected without creating its Drive file.
  async function googleConnected() {
    if (!driveOn()) return;
    let players = [];
    try { players = Store.all('players') || []; } catch (e) { return; }
    for (const player of players) {
      // A held message key identifies the player represented by this device.
      // Never publish another squad member's private file from a player login.
      if (!player || !player.id || !holdsKey(player.id) || driveBusy.has(player.id)) continue;
      driveBusy.add(player.id);
      try {
        const result = await driveSync(player, 'push');
        if (result.ok) driveDirty.delete(player.id);
      } catch (e) { /* the scheduled pass retries failed writes */ }
      finally { driveBusy.delete(player.id); }
    }
  }

  // Each end clears only what it wrote: what the other one said is theirs.
  async function clearAll(player) {
    const file = get(player && player.id);
    if (!file || !canWrite(player)) return false;
    const mark = clearMark(file);
    mark[side(player) === 'player' ? 'player' : 'coach'] = Date.now();
    await Store.save(STORE, Object.assign({}, file, {
      cleared: mark,
      messages: (file.messages || []).filter(msg => keptBy(mark, msg))
    }), { playerFileKey: holdsWord(player.id) });
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
    const trusted = !held && holdsWord(player.id);
    UI.modal({
      title: t('pfile.key', 'Message key') + ' \u2014 ' + nameOf(player),
      width: 480,
      body: `
        <p class="hint">${esc(held
    ? t('pfile.keyHeld', 'This copy holds the key for this player and may write in the file.')
    : t('pfile.keyAsk', 'Type the message key the coach gave you. It is only needed once on this device.'))}</p>
        ${held ? '' : `<p class="hint">${esc(t('pfile.keyTrust', 'The key you type is checked against this player\u2019s file on Google Drive. If that cannot be reached, the word is taken on trust so you can write straight away, and checked for real the next time this copy and the coach\u2019s meet.'))}</p>`}
        ${trusted ? `<p class="hint">${esc(t('pfile.keyTaken', 'A key is being held on trust here. It is checked for real as soon as the coach copy can be reached.'))}</p>` : ''}
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
          if (r === 'off') return UI.toast(t('pfile.driveOff', 'Google Drive must be connected before the message key can be checked.'), 'error');
          if (r !== true && r !== 'trust') return UI.toast(t('pfile.keyBad', 'That key was not accepted'), 'error');
          UI.toast(r === 'trust'
            ? t('pfile.keyTaken', 'A key is being held on trust here. It is checked for real as soon as the coach copy can be reached.')
            : t('pfile.keyOk', 'Key accepted \u2014 you can write in your file'), 'success');
          // The key carries the coach's public OAuth configuration, so Google
          // can be signed in to from here: the player never needs Settings.
          if (!driveOn()) {
            btn.disabled = true;
            const on = await connectWithKey(player);
            btn.disabled = false;
            if (!on) UI.toast(t('pfile.driveOff', 'Google Drive is not connected \u2014 set it up under Settings.'), 'error');
          }
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
      const mySide = side(player);
      // Only a copy that is neither read-only nor this player's own generates
      // keys; every other one is offered the box to type the coach's key into.
      const staff = !(window.Access && Access.readMode && Access.readMode()) && mySide !== 'player';
      const list = messages(player.id);
      const hasMine = list.some(msg => msg.side === mySide);
      UI.modal({
        title: t('pfile.title', 'Player file') + ' \u2014 ' + nameOf(player),
        width: 620,
        headActions: `<label class="pf-auto"><span>${esc(t('pfile.autoUpdate', 'Auto update'))}</span>
          <select id="pf_auto" aria-label="${esc(t('pfile.autoUpdate', 'Auto update'))}">${AUTO_MINUTES.map(n => `<option value="${n}" ${n === autoMinutes() ? 'selected' : ''}>${n} ${esc(n === 1 ? t('pfile.minute', 'minute') : t('pfile.minutes', 'minutes'))}</option>`).join('')}</select>
        </label>`,
        body: `
          <p class="hint">${esc(t('pfile.intro', 'A line kept between the coach and this player. It lives with the squad, so both ends read and write the same file.'))}</p>
          ${threadHtml(player)}
          <label class="field"><span>${esc(t('pfile.write', 'Write'))}</span>
            <textarea id="pf_text" rows="3" maxlength="${MAX_LEN}" ${writable ? '' : 'disabled'}
              placeholder="${esc(t('pfile.ph', 'Write to the other end\u2026'))}"></textarea></label>
          <p class="hint">${esc(writable
            ? t('pfile.signedAs', 'Signed as') + ': ' + myName(player) + ' \u00b7 ' + sideLabel(mySide)
            : staff ? t('pfile.readOnly', 'This copy is read-only, so the file can be read but not written to.')
              : t('pfile.needKey', 'Writing needs the message key the coach generates for you. Press Message key and type it in.'))}</p>
`,
        footer: `<button class="btn ghost" data-close2>${esc(T('common.close'))}</button>
          <button class="btn" data-get>\u2b73 ${esc(t('pfile.dl', 'Get message'))}</button>
          <button class="btn" data-key>\u{1F511} ${esc(t('pfile.key', 'Message key'))}</button>
          ${writable ? `<button class="btn danger" data-wipe data-member-ok ${hasMine ? '' : 'disabled'}>${esc(t('pfile.clear', 'Clear all messages'))}</button>` : ''}
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
            if (wipe) wipe.disabled = !messages(player.id).some(msg => msg.side === mySide);
          };
          m.querySelector('[data-close2]').onclick = () => { close(); if (typeof onDone === 'function') onDone(); };
          m.querySelector('[data-key]').onclick = () => { close(); (staff ? keyDialog : claimDialog)(player, open); };
          const wipe = m.querySelector('[data-wipe]');
          if (wipe) wipe.onclick = () => UI.confirm(t('pfile.clearAsk', 'Remove every message you have written in this player file? What the other end wrote stays, and so do the key and the file itself.'), async () => {
            if (!await clearAll(player)) return;
            refresh();
            busy = true;
            pending = !await pushNow();
            busy = false;
            UI.toast(t('pfile.cleared', 'Your messages were removed'), 'success');
          });
          const driveFail = r => {
            if (r.why === 'off') UI.toast(t('pfile.driveOff', 'Google Drive is not connected \u2014 set it up under Settings.'), 'error');
            else if (r.why === 'badkey') UI.toast(t('pfile.keyBad', 'The message key does not match the key in this player file.'), 'error');
            else if (r.why === 'nofile') UI.toast(t('pfile.driveNone', 'Nothing has been sent to Drive for this player yet.'), 'error');
            else UI.toast(t('pfile.driveFail', 'Drive could not be reached'), 'error');
          };
          // pending is a push that never got through, retried by the poll.
          let busy = false, pending = false;
          // There is no upload button: whatever is written here goes to Drive
          // by itself, signing in with the message key when that is all this
          // device was given.
          const pushNow = async () => {
            if (!driveDirty.has(player.id)) return true;
            // A copy that does not use Drive at all is not nagged about it: the
            // line is saved either way and the poll sends it if Drive appears.
            if (!driveOn() && !await connectWithKey(player)) {
              if (holdsWord(player.id)) driveFail({ why: 'off' });
              return false;
            }
            const r = await driveSync(player, 'push');
            if (!r.ok) { driveFail(r); return false; }
            driveDirty.delete(player.id);
            return true;
          };
          const getBtn = m.querySelector('[data-get]');
          if (getBtn) getBtn.onclick = async () => {
            getBtn.disabled = true;
            busy = true;
            if (!driveOn() && !await connectWithKey(player)) driveFail({ why: 'off' });
            else {
              const r = await driveSync(player, 'pull');
              if (!r.ok) driveFail(r);
              else {
                refresh();
                UI.toast(r.got ? t('pfile.driveGot', 'Fetched from Drive') + ' (' + r.got + ')'
                  : t('pfile.driveNothing', 'Nothing new on Drive'), r.got ? 'success' : 'info');
              }
            }
            busy = false;
            getBtn.disabled = false;
          };
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
            startDriveSync();
          };
          const auto = m.querySelector('#pf_auto');
          if (auto) auto.onchange = () => startPoll(auto.value);
          startPoll(autoMinutes());
          m.querySelector('[data-post]').onclick = async () => {
            const text = inp.value.trim();
            if (!text) return UI.toast(t('pfile.needText', 'Write something first'), 'error');
            const btn = m.querySelector('[data-post]');
            btn.disabled = true;
            busy = true;
            const saved = await post(player, text);
            if (!saved) {
              busy = false;
              btn.disabled = false;
              return UI.toast(t('pfile.needKey', 'Writing needs the message key the coach generates for you.'), 'error');
            }
            inp.value = '';
            refresh();
            // post() already tried Drive; this covers a copy that still has to
            // sign in. A push that gets nowhere is left to the poll to retry.
            const sent = await pushNow();
            pending = !sent;
            busy = false;
            btn.disabled = false;
            inp.focus();
            if (sent) UI.toast(t('pfile.driveSent', 'Message sent to the Drive folder'), 'success');
            else UI.toast(t('pfile.saved', 'Written in the player file'), 'success');
          };
        }
      });
    };
    // A key that arrived after the word was typed is matched against it first,
    // so the dialog knows whether this copy may write before it draws itself.
    verifyHeld(player).then(open, open);
  }

  return {
    STORE, fileId, get, messages, ensure, remove, post, sweep, dialog, threadHtml, clearAll, canWrite, side,
    newKey, claimKey, holdsKey, holdsWord, verifyHeld, hasKey, keyDialog, claimDialog, driveSync, driveName, syncAll,
    startDriveSync, googleConnected
  };
})();
if (typeof window !== 'undefined') {
  window.PlayerFile = PlayerFile;
  PlayerFile.startDriveSync();
  // A restored Google token must publish pending player data immediately too.
  setTimeout(() => {
    if (window.Drive && Drive.isConnected && Drive.isConnected()) {
      PlayerFile.googleConnected().catch(() => {});
    }
  }, 0);
}


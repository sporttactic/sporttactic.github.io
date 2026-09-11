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

  // A row this device adopted as the player's own end of the line: it was built
  // from the file on Drive rather than from a squad, so nothing else on the
  // device says who this copy speaks for.
  const claimed = playerId => { const f = get(playerId); return !!(f && f.mine); };

  // Which end of the line this device writes from. A following copy holding the
  // player's key is the player, whatever role it calls itself.
  function side(player) {
    try {
      if (player && player.id && claimed(player.id)) return 'player';
      if (player && player.id && window.Access && Access.readMode && Access.readMode() && holdsWord(player.id)) return 'player';
      if (window.Access && Access.tier && Access.role) {
        return Access.tier(Access.role()) === 'player' ? 'player' : 'coach';
      }
    } catch (e) { /* roles not set up on this device */ }
    return 'coach';
  }
  const sideLabel = s => s === 'player' ? t('pfile.player', 'Player') : t('pfile.coach', 'Coach');
  // Only a copy that speaks for somebody else's file has to prove itself with
  // the message key: one that FOLLOWS the club's database, or one that adopted
  // a single player file straight off Drive. Switching the club's own device to
  // the Player role changes who a message is signed by, not whether that device
  // owns the file.
  const memberPlayer = player => side(player) === 'player'
    && !!(claimed(player && player.id) || (window.Access && Access.following && Access.following()));
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
  async function holdKey(playerId, word, hash, trust) {
    const all = heldKeys();
    all[playerId] = { word, set: String(hash || '').slice(0, 12), trust: !!trust };
    try { localStorage.setItem(HELD, JSON.stringify(all)); } catch (e) { /* private mode */ }
    try { await Store.setSetting(HELD_DB, all); } catch (e) { /* no database on this device */ }
    return all;
  }
  async function dropKey(playerId) {
    const all = heldKeys();
    if (!all[playerId]) return;
    delete all[playerId];
    try { localStorage.setItem(HELD, JSON.stringify(all)); } catch (e) { /* private mode */ }
    try { await Store.setSetting(HELD_DB, all); } catch (e) { /* no database on this device */ }
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
  // The same question while the coach's own key is still on its way. A word
  // taken on trust is kept on this device alone — never written into the file,
  // where it would overwrite the real key everybody else is checked against.
  function holdsWord(playerId) {
    if (holdsKey(playerId)) return true;
    const held = heldKeys()[playerId];
    return !!(held && held.trust && held.word);
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
  // taken on trust because that key could not be reached to check it against,
  // or why it was refused: 'len' for the wrong length, 'nocrypto' where the
  // browser withholds the hashing needed, 'bad' for a word that does not match
  // the coach's current key.
  async function claimKey(player, typed) {
    const word = canonKey(typed);
    if (word.length !== KEY_LEN) return 'len';
    // Browsers only expose crypto.subtle on a secure origin, so opening the app
    // over plain http makes every key impossible to check.
    if (!cryptoOk()) return 'nocrypto';
    const f = get(player && player.id) || await ensure(player);
    if (!f) return 'bad';

    // Prefer the current Drive copy when it is reachable, but do not require a
    // Prefer the current Drive copy when it is reachable, but do not require a
    // Drive connection just to check a key. The coach-generated key block is
    // already carried by the synced player file and contains the OAuth client
    // configuration needed to make that first player-side connection.
    const fresh = driveOn() ? await driveKey(player) : false;
    const current = get(player.id) || f;
    const key = current && current.key;
    if (key && key.hash && !key.prov && await sameWord(word, key)) {
      await holdKey(player.id, prettyKey(word), key.hash);
      await useKeyDriveConfig(key);
      return true;
    }
    // Judged against the coach's own key, just read from Drive, a word that does
    // not match is simply the wrong word.
    if (fresh) return 'bad';
    // Nothing here could be confirmed: the coach's key has not arrived yet, or
    // the block this copy holds is older than the word that was handed over.
    // Refusing would strand a player holding the right word, so it is kept on
    // trust — on this device only, never written into the file — and checked
    // for real as soon as the coach's own key can be reached.
    await holdKey(player.id, prettyKey(word), '', true);
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
    if (await sameWord(word, key)) {
      await holdKey(id, prettyKey(word), key.hash);
      await useKeyDriveConfig(key);
      return true;
    }
    // The real key is here and the word does not match it, so the word was
    // wrong: the trust it was given on arrival is withdrawn.
    await dropKey(id);
    return false;
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
    const mine = side(player);
    // A line written in the same millisecond as a Clear would otherwise fall
    // under that watermark and vanish without a word.
    const at = Math.max(Date.now(), clearMark(file)[mine] + 1);
    const msg = { id: Store.uid('msg'), at, side: mine, by: myName(player), text: body };
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

  // ---- Google Drive: one JSON per player in the Squad folder ---------------
  // <squad database folder> / Squad / <Player Name>.json.
  // Whichever end writes first makes the Squad folder and the file and shares
  // it with the other, so a player holding the key can send a message before
  // the coach has ever opened Drive and the coach still gets it back.
  const DRIVE_DIR = 'Squad';
  // Earlier builds filed the same document under Players/, and under a folder
  // per player inside it. Both are still read, so an existing thread is found
  // where it lies instead of a second file being made beside it.
  const LEGACY_DIRS = ['Players'];
  const driveOn = () => !!(window.Drive && Drive.isConnected && Drive.isConnected());
  const safeName = s => String(s || '').replace(/[/\\?%*:|"<>]+/g, '-').trim();
  // The file is addressed by the name on the player's profile, so two players
  // carrying the same name would otherwise land in one document and read each
  // other's private thread. Whoever already holds a file keeps it (the stored
  // id is looked up first); the rest take their own id into the name.
  function twinned(player) {
    const mine = safeName(nameOf(player));
    if (!mine || !player || !player.id) return false;
    let squad = [];
    try { squad = Store.all('players') || []; } catch (e) { return false; }
    return squad.some(p => p && p.id !== player.id
      && String(p.teamId || '') === String(player.teamId || '')
      && safeName(nameOf(p)) === mine);
  }
  const playerDir = player => {
    const base = safeName(nameOf(player)) || String(player.id);
    return twinned(player) ? base + ' (' + String(player.id).slice(-4) + ')' : base;
  };
  const driveName = player => playerDir(player) + '.json';
  // Try the current name, the name retained by the player file, and the legacy id name.
  const driveNames = player => {
    const local = get(player && player.id);
    const names = [driveName(player)];
    // A shared name must never fall back to the plain file: that one is the
    // other player's thread.
    if (local && local.name && !twinned(player)) names.push((safeName(local.name) || String(player.id)) + '.json');
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

  // A copy that owns the club's data may build folders on Drive; one that only
  // follows the club must never create anything, or it builds a second tree in
  // its own account and the two ends stop sharing a file.
  const ownsData = () => !(window.Access && Access.following && Access.following());

  // The squad's shared database folder on Drive: the coach's own setting, the id
  // a team-code copy resolved from the manifest, or the parent of the shared
  // database file itself — that file sits in the team folder, so its parent is
  // the team folder, and it is reachable by id on every copy it was shared with.
  // Nothing is ever looked up by name: under the drive.file scope a name search
  // cannot see another account's folder and would build a duplicate here.
  // Only a coach copy asking to create may make the team folder itself.
  async function teamFolder(create) {
    let id = '';
    try { id = await Drive.getTeamFolderId(); } catch (e) { id = ''; }
    if (!id && window.TeamCloud && TeamCloud.cfg) {
      try { id = TeamCloud.cfg().folderId || ''; } catch (e) { id = ''; }
    }
    if (!id && Drive.getParent && window.TeamCloud && TeamCloud.cfg) {
      let shared = '';
      try { shared = TeamCloud.cfg().fileId || ''; } catch (e) { shared = ''; }
      if (shared) {
        try { id = await Drive.getParent(shared); } catch (e) { id = ''; }
        if (id) { try { await Drive.setTeamFolderId(id); } catch (e) { /* device-local cache only */ } }
      }
    }
    if (!id && create && ownsData() && Drive.ensureTeamFolder) {
      const t = Store.activeTeam();
      try { id = await Drive.ensureTeamFolder(safeName(t && t.name) || 'Team'); } catch (e) { id = ''; }
    }
    return id;
  }
  // <shared team folder> / Squad, the one place a player file is ever made. It
  // is the folder the whole club already shares, so the coach and the player
  // write to a single document instead of one each.
  async function squadFolder(create) {
    const club = await teamFolder(create);
    if (!club) return '';
    if (!create) {
      let dir = null;
      try { dir = await Drive.findFolder(DRIVE_DIR, club); } catch (e) { dir = null; }
      return (dir && dir.id) || '';
    }
    try { return await Drive.ensureFolder(DRIVE_DIR, club); } catch (e) { return ''; }
  }
  // Every folder this player's file could be lying in under one team folder,
  // current layout first: Squad, then the legacy Players folder, then the
  // per-player folder older builds made inside each of them. Nothing is
  // created here.
  async function dirsUnder(teamId, player) {
    const out = [];
    for (const name of [DRIVE_DIR].concat(LEGACY_DIRS)) {
      let dir = null;
      try { dir = await Drive.findFolder(name, teamId); } catch (e) { dir = null; }
      if (!dir) continue;
      out.push(dir.id);
      let own = null;
      try { own = await Drive.findFolder(playerDir(player), dir.id); } catch (e) { own = null; }
      if (own) out.push(own.id);
    }
    return out;
  }
  // The folders under the database folder this copy already knows about.
  async function knownFolder(player) {
    const team = await teamFolder(false);
    if (!team) return [];
    return await dirsUnder(team, player);
  }
  // Where earlier builds put the file when no team folder was known: this
  // account's own SportTactic tree. Read-only, so a thread that landed there
  // before is still found and carried on rather than abandoned.
  async function foundFolder(player) {
    try {
      const root = await Drive.findFolder('SportTactic', null);
      if (!root) return [];
      const t = Store.activeTeam();
      const team = await Drive.findFolder(safeName(t && t.name) || 'Team', root.id);
      if (!team) return [];
      return await dirsUnder(team.id, player);
    } catch (e) { return []; }
  }
  // The other end, so the file it does not own is still reachable to it.
  function shareTargets(player) {
    const norm = e => (window.MAIL && MAIL.normEmail) ? MAIL.normEmail(e) : String(e || '').trim();
    const out = [];
    if (memberPlayer(player)) (Store.coaches() || []).forEach(c => { const e = norm(c.email); if (e) out.push(e); });
    else { const e = norm(player.email); if (e) out.push(e); }
    return out.slice(0, 5);
  }
  // One file, written by both ends, so the other end needs writer access to it —
  // and needs it whenever its address turns up, not only in the instant the file
  // was made. A player whose e-mail was filled in afterwards is invited on the
  // next push; an address already invited is never sent again.
  async function ensureShared(player, id) {
    if (!id || !window.Drive || !Drive.shareWith) return;
    const want = shareTargets(player);
    if (!want.length) return;
    const file = get(player.id);
    // The record is tied to the file it was granted on: a replaced file starts over.
    const done = (file && file.sharedId === id && Array.isArray(file.sharedWith)) ? file.sharedWith : [];
    const missing = want.filter(e => done.indexOf(e) < 0);
    if (!missing.length) return;
    const added = [];
    for (const to of missing) {
      try { await Drive.shareWith(id, to, 'writer'); added.push(to); }
      catch (e) { /* an invite Drive refuses now is retried on the next push */ }
    }
    const cur = added.length && get(player.id);
    if (cur) {
      await Store.save(STORE, Object.assign({}, cur, { sharedId: id, sharedWith: done.concat(added) }),
        { playerFileKey: holdsWord(player.id) });
    }
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
    // The id carried by the squad row wins over anything this device resolved
    // for itself: it is the one pointer both ends share, so preferring it is
    // what keeps them on a single file.
    const local = get(player.id);
    if (local && local.driveId) return (driveIds[player.id] = String(local.driveId));
    if (driveIds[player.id]) return driveIds[player.id];
    const names = driveNames(player);
    const name = names[0];
    // The Squad folder first, then the folders earlier builds filed the same
    // document in, so an existing thread is picked up rather than replaced.
    const lookIn = async dirs => {
      for (const candidate of names) {
        for (const parent of (dirs || [])) {
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
    // The file is only ever made by a copy that owns the club's data, and only
    // in the shared team folder. A player copy creating one in its own Drive
    // would split the one thread in two for good.
    if (memberPlayer(player) || !ownsData()) return '';
    const parent = await squadFolder(true);
    if (!parent) return '';
    const res = await Drive.uploadJson(name, driveDoc(player, get(player.id), []), { parent: parent });
    const id = (res && res.id) || '';
    if (id) {
      await rememberDriveId(player, id);
      await ensureShared(player, id);
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
    catch (e) { return false; }   // a key that cannot be read must not cost the file pointer
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
    if (!player || !window.Drive || !Drive.connect) return false;
    // A player copy needs the key to get this far; a copy that owns the data may
    // always re-authorise here, since a Google token only lasts about an hour.
    if (memberPlayer(player) && !holdsWord(player.id)) return false;
    const f = get(player.id);
    await useKeyDriveConfig(f && f.key);
    try {
      await Drive.connect();
      return driveOn();
    } catch (e) { return false; }
  }

  // ---- The player's own end, on a device that never held the squad ---------
  // A player is handed three things: the name on their profile, the message key
  // and a Google account the coach's copy shared the file with. That is enough
  // to find the file, rebuild the two rows this app keeps for it and join the
  // conversation — no team code, no copy of the club's database.

  // A Drive id out of whatever the coach pasted over: a share link, an "open"
  // URL or the bare id itself.
  function driveIdFrom(link) {
    const raw = String(link == null ? '' : link).trim();
    if (!raw) return '';
    const inUrl = /\/d\/([-\w]{20,})|[?&]id=([-\w]{20,})/.exec(raw);
    if (inUrl) return inUrl[1] || inUrl[2];
    return /^[-\w]{20,}$/.test(raw) ? raw : '';
  }
  const isPlayerDoc = doc => !!(doc && typeof doc === 'object'
    && doc.kind === 'player-file' && doc.playerId && doc.playerName);

  async function readDoc(id) {
    try { const doc = await Drive.downloadJson(id); return isPlayerDoc(doc) ? doc : null; }
    catch (e) { return null; }
  }

  // The player's file on Drive, addressed by the name on their profile. The
  // coach's copy made it and invited this account, so it is looked for both
  // among the files this account can already see and among the ones shared
  // with it. Nothing is created here: a name that finds nothing means the
  // coach has not written to it yet, not that a second file should be made.
  async function findMine(name) {
    const wanted = safeName(String(name == null ? '' : name).trim().replace(/\s+/g, ' '));
    if (!wanted || !driveOn()) return null;
    const file = wanted + '.json';
    const seen = new Set();
    for (const q of ["name='" + qEsc(file) + "' and trashed=false",
      "name='" + qEsc(file) + "' and sharedWithMe and trashed=false"]) {
      let list = [];
      try { list = await Drive.listFiles(q); } catch (e) { list = []; }
      for (const hit of (list || [])) {
        if (!hit || !hit.id || seen.has(hit.id)) continue;
        seen.add(hit.id);
        const doc = await readDoc(hit.id);
        if (doc) return { doc: doc, id: hit.id };
      }
    }
    return null;
  }

  // Rebuild the squad row and the player file from the document itself. The
  // coach's own player id travels in it, so the rows made here address the very
  // same file instead of starting a second thread beside it.
  async function adoptDoc(doc, driveFileId) {
    if (!isPlayerDoc(doc)) return null;
    const id = String(doc.playerId).slice(0, 60);
    const name = String(doc.playerName).trim().replace(/\s+/g, ' ').slice(0, 80);
    if (!name) return null;
    const cut = name.indexOf(' ');
    const known = Store.raw('players', id);
    const player = await Store.save('players', Object.assign(
      { position: '', status: 'active' }, known, {
        id: id,
        firstName: cut < 0 ? name : name.slice(0, cut),
        lastName: cut < 0 ? '' : name.slice(cut + 1),
        teamId: String(doc.teamId || (known && known.teamId) || '').slice(0, 60),
        sport: String(doc.sport || (known && known.sport) || '').slice(0, 40)
      }));
    if (!player) return null;
    const cur = get(id);
    await Store.save(STORE, Object.assign(
      { id: fileId(id), playerId: id, createdAt: Date.now(), messages: [] }, cur, {
        name: name, teamId: player.teamId || '', sport: player.sport || '',
        mine: true, driveId: String(driveFileId || (cur && cur.driveId) || '')
      }), { playerFileKey: true });
    driveIds[id] = String(driveFileId || '');
    return player;
  }

  // The whole player-side join in one call, so it can be driven from a dialog
  // or straight from a test. `why` says which step refused.
  async function openMine(name, word, link) {
    const clean = String(name == null ? '' : name).trim().replace(/\s+/g, ' ');
    if (!clean) return { ok: false, why: 'noname' };
    if (!window.Drive) return { ok: false, why: 'nogoogle' };
    let configured = false;
    try { configured = !!(Drive.isConfigured && await Drive.isConfigured()); }
    catch (e) { configured = false; }
    if (!configured) return { ok: false, why: 'nogoogle' };
    if (!driveOn()) {
      try { await Drive.connect(); } catch (e) { /* reported as off below */ }
      if (!driveOn()) return { ok: false, why: 'off' };
    }

    let found = null;
    const pasted = driveIdFrom(link);
    if (pasted) {
      const doc = await readDoc(pasted);
      if (!doc) return { ok: false, why: 'noaccess' };
      found = { doc: doc, id: pasted };
    }
    if (!found) {
      try { found = await findMine(clean); }
      catch (e) { return { ok: false, why: 'net' }; }
    }
    if (!found) return { ok: false, why: 'notfound' };
    // The key is what proves which of the two ends this device is, so a file
    // the coach has not generated one for cannot be joined yet.
    if (!found.doc.key || !found.doc.key.hash) return { ok: false, why: 'nokey' };

    const player = await adoptDoc(found.doc, found.id);
    if (!player) return { ok: false, why: 'notfound' };
    await adoptKey(player, found.doc.key);
    const ok = await claimKey(player, word);
    if (ok !== true) return { ok: false, why: ok === 'bad' ? 'badkey' : ok, player: player };
    const pulled = await driveSync(player, 'pull');
    if (!pulled.ok) return { ok: false, why: pulled.why, player: player };
    return { ok: true, player: player, got: pulled.got || 0 };
  }
  // The files this device has adopted as its own end, newest line first.
  function minePlayers() {
    return Store.all(STORE).filter(f => f && f.mine)
      .map(f => Store.find('players', f.playerId))
      .filter(Boolean);
  }

  // Read what is on Drive and add whatever this copy has not seen; a push then
  // writes the whole thread back. The player sends their message with a push
  // and the coach retrieves it with a pull. A pull never creates the file: the
  // coach fetching from an empty copy must not lay a blank one over the
  // player's.

  // Why no file could be reached, so the dialog can say what to do about it
  // rather than blaming the network for a club that has no shared folder yet.
  async function noFileWhy(player, keyed) {
    if (!keyed) return 'badkey';
    if (memberPlayer(player) || !ownsData()) return 'noaccess';
    return (await teamFolder(false)) ? 'nofile' : 'noteam';
  }

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
    const playerCopy = memberPlayer(player);
    const keyed = !playerCopy || holdsKey(player.id);
    let fileId = '';
    try { fileId = await driveFile(player, push && keyed); }
    catch (e) { return { ok: false, why: 'net' }; }
    if (!fileId) return { ok: false, why: await noFileWhy(player, keyed) };

    let remote = null;
    try { remote = await Drive.downloadJson(fileId); }
    catch (e) {
      // The id the squad carries is the coach's own file. A player copy that
      // cannot reach it has not been given access to it yet, and making a
      // second file here would split the one thread in two for good.
      if (playerCopy && local.driveId && String(local.driveId) === fileId) {
        return { ok: false, why: 'noaccess' };
      }
      // Otherwise a remembered id may point at a deleted or replaced file.
      // Clear it and retry the full filename lookup during this operation,
      // rather than requiring a second press of Get message.
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
      if (!fileId) return { ok: false, why: await noFileWhy(player, keyed) };
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
    // The id breaks a tie, so two lines written in the same millisecond come out
    // in the same order on both ends rather than one order each.
    const merged = mine.concat(got)
      .sort((a, b) => a.at - b.at || String(a.id).localeCompare(String(b.id)))
      .slice(-MAX_MSG);
    if (merged.length !== (store.messages || []).length || got.length
      || mark.coach !== clearMark(store).coach || mark.player !== clearMark(store).player) {
      await Store.save(STORE, Object.assign({}, store, { messages: merged, cleared: mark }),
        { playerFileKey: holdsWord(player.id) });
    }
    if (push) {
      try { await Drive.uploadJson('', driveDoc(player, get(player.id) || store, merged, mark), { fileId }); }
      catch (e) {
        if (playerCopy && local.driveId && String(local.driveId) === fileId) {
          return { ok: false, why: 'noaccess', got: got.length };
        }
        await forgetDriveId(player);
        return { ok: false, why: 'net', got: got.length };
      }
      await ensureShared(player, fileId);
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
  // Whatever was written while the account was away has to go up the moment it
  // comes back. A normal clean background pass pulls, so waiting for the timer
  // would leave Google connected with nothing published.
  async function googleConnected() {
    if (!driveOn()) return;
    let players = [];
    try { players = Store.all('players') || []; } catch (e) { return; }
    for (const player of players) {
      if (!player || !player.id || driveBusy.has(player.id)) continue;
      // A held message key identifies the player this device speaks for; a copy
      // that owns the data publishes whatever it has queued for anybody. Never
      // another squad member's private file from a player login.
      if (!holdsKey(player.id) && !driveDirty.has(player.id)) continue;
      driveBusy.add(player.id);
      try {
        const result = await driveSync(player, 'push');
        if (result.ok) driveDirty.delete(player.id);
      } catch (e) { /* the scheduled pass retries failed writes */ }
      finally { driveBusy.delete(player.id); }
    }
  }

  // Make sure this player has a file and that it exists on Drive, shared with
  // the player's own account. Addressing a message to a name calls this, so the
  // player can reach the file the moment the coach writes the first line.
  async function publish(player) {
    if (!player || !player.id) return { ok: false, why: 'nofile' };
    await ensure(player);
    return await saveToDrive(player);
  }

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const normEmail = e => (window.MAIL && MAIL.normEmail) ? MAIL.normEmail(e) : String(e == null ? '' : e).trim();
  // Hand the player's own Google account writer access to their file in the
  // coach's Squad folder. Both ends write the one document, so reader access
  // would be useless. The file has to exist before a permission can sit on it,
  // so the Squad folder and the named file are made here when the coach has
  // not written the first line yet.
  async function inviteAccount(player, email) {
    const to = normEmail(email);
    if (!to || !EMAIL_RE.test(to)) return { ok: false, why: 'bademail' };
    if (!player || !player.id) return { ok: false, why: 'nofile' };
    if (!driveOn()) { try { await Drive.connect(); } catch (e) { /* reported below */ } }
    if (!driveOn()) return { ok: false, why: 'off' };
    // The background pass writes the same document, so the two must not
    // overlap: one of the two uploads would otherwise carry the older thread.
    if (driveBusy.has(player.id)) return { ok: false, why: 'busy' };
    await ensure(player);
    driveBusy.add(player.id);
    let id = '';
    try {
      try { id = await driveFile(player, true); } catch (e) { return { ok: false, why: 'net' }; }
      if (!id) return { ok: false, why: await noFileWhy(player, true) };
      const pushed = await driveSync(player, 'push');
      if (!pushed.ok) return { ok: false, why: pushed.why };
      driveDirty.delete(player.id);
    } finally { driveBusy.delete(player.id); }
    try { await Drive.shareWith(id, to, 'writer'); }
    catch (e) { return { ok: false, why: 'share' }; }
    const file = get(player.id);
    if (file) {
      const done = (file.sharedId === id && Array.isArray(file.sharedWith)) ? file.sharedWith : [];
      await Store.save(STORE, Object.assign({}, file, {
        sharedId: id, sharedWith: done.indexOf(to) < 0 ? done.concat([to]) : done
      }), { playerFileKey: holdsWord(player.id) });
    }
    // Kept on the profile so every later push keeps the invitation alive by
    // itself, and so the coach never has to type the address twice.
    const known = Store.raw('players', player.id);
    if (known && !normEmail(known.email)) {
      try { await Store.save('players', Object.assign({}, known, { email: to })); }
      catch (e) { /* a read-only roster still keeps the share */ }
    }
    return { ok: true, id: id, link: (window.Drive && Drive.fileLink) ? Drive.fileLink(id) : '' };
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

  // A link straight to the file on Drive, once it has one. A Google account
  // that cannot turn up a shared file by name on its own can still open it by
  // id, so this is what makes the invitation work everywhere.
  function fileLink(player) {
    const f = get(player && player.id);
    const id = f && f.driveId;
    return (id && window.Drive && Drive.fileLink) ? Drive.fileLink(id) : '';
  }
  // Everything the player is handed, in one block to paste into a message: the
  // name their file is addressed by, the word that proves which end they are,
  // and the link to the file itself.
  function inviteText(player) {
    const link = fileLink(player);
    return [
      t('pfile.mineName', 'Player profile name') + ': ' + nameOf(player),
      t('pfile.key', 'Message key') + ': ' + (heldWord(player.id) || '\u2014'),
      link ? t('pfile.mineLink', 'File link') + ': ' + link : ''
    ].filter(Boolean).join('\n');
  }

  // Coach side: make the word, read it back, hand it over.
  function keyDialog(player, onDone) {
    const back = () => { if (typeof onDone === 'function') onDone(); };
    const open = () => {
      const word = heldWord(player.id);
      const made = hasKey(player.id);
      const stale = made && !word;      // generated on another device
      const link = fileLink(player);
      const row = get(player.id) || {};
      const invited = Array.isArray(row.sharedWith) ? row.sharedWith : [];
      const shared = normEmail(player.email) || '';
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
          <p class="hint">${esc(link
    ? t('pfile.inviteReady', 'Copy invitation sends the player everything they need: the name their file is addressed by, this key, and a link straight to the file.')
    : t('pfile.inviteNone', 'The file reaches Drive the first time something is written in it or Google is connected. Until then there is no link to send with the key.'))}</p>
          ${made ? `<p class="hint">${esc(t('pfile.keyReplace', 'Generating a new key replaces the old one, and a copy still holding it stops being able to write.'))}</p>` : ''}
          <label class="field"><span>${esc(t('pfile.inviteMail', 'Player Google account'))}</span>
            <input id="pf_share" type="email" autocomplete="off" spellcheck="false" placeholder="player@gmail.com" value="${esc(shared)}">
            <span class="hint">${esc(t('pfile.inviteMailHint', 'Gives that Google account writer access to this file in the Squad folder, so the player can answer in it. The Squad folder and the file are made now if they do not exist yet.'))}</span></label>
          ${invited.length ? `<p class="hint">${esc(t('pfile.inviteDone', 'Already invited') + ': ' + invited.join(', '))}</p>` : ''}`,
        footer: `<button class="btn ghost" data-close2>${esc(T('common.close'))}</button>
          <button class="btn" data-copy ${word ? '' : 'disabled'}>\u29c9 ${esc(t('pfile.keyCopy', 'Copy key'))}</button>
          <button class="btn" data-invite ${word ? '' : 'disabled'}>\u29c9 ${esc(t('pfile.invite', 'Copy invitation'))}</button>
          <button class="btn" data-share>${esc(t('pfile.inviteSend', 'Give access'))}</button>
          <button class="btn primary" data-gen>\u{1F511} ${esc(made ? t('pfile.keyNew', 'Generate new key') : t('pfile.keyGen', 'Generate message key'))}</button>`,
        onOpen: (m, close) => {
          m.querySelector('[data-close2]').onclick = () => { close(); back(); };
          m.querySelector('[data-copy]').onclick = async () => {
            const ok = await copyText(heldWord(player.id));
            UI.toast(ok ? t('pfile.keyCopied', 'Message key copied') : t('pfile.keyCopyFail', 'Could not copy \u2014 read the word off the screen instead'), ok ? 'success' : 'error');
          };
          m.querySelector('[data-invite]').onclick = async () => {
            const ok = await copyText(inviteText(player));
            UI.toast(ok ? t('pfile.inviteCopied', 'Invitation copied \u2014 send it to the player') : t('pfile.keyCopyFail', 'Could not copy \u2014 read the word off the screen instead'), ok ? 'success' : 'error');
          };
          m.querySelector('[data-share]').onclick = async () => {
            const btn = m.querySelector('[data-share]');
            const box = m.querySelector('#pf_share');
            btn.disabled = true;
            let r;
            try { r = await inviteAccount(player, box.value); }
            catch (e) { r = { ok: false, why: 'net' }; }
            btn.disabled = false;
            if (r.ok) {
              close();
              UI.toast(t('pfile.inviteOk', 'That Google account can now write in the file'), 'success');
              return open();
            }
            if (r.why === 'bademail') return UI.toast(t('pfile.inviteBadMail', 'Type the Google address the player signs in with'), 'error');
            if (r.why === 'busy') return UI.toast(t('pfile.inviteBusy', 'This file is being synced right now \u2014 try again in a moment'), 'error');
            if (r.why === 'noteam') return UI.toast(t('pfile.noTeam', 'Set up the shared team database first, under Settings. The player file is made in that shared folder so the coach and the player write to one document.'), 'error');
            if (r.why === 'off') return UI.toast(t('pfile.driveOff', 'Google Drive is not connected \u2014 set it up under Settings.'), 'error');
            if (r.why === 'share') return UI.toast(t('pfile.inviteFail', 'Google refused that invitation. Check the address is a Google account.'), 'error');
            UI.toast(t('pfile.driveFail', 'Drive could not be reached'), 'error');
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
          if (r === 'nocrypto') return UI.toast(t('pfile.keyNoCrypto', 'This device cannot check message keys. The app has to be opened over https:// for the browser to allow it.'), 'error');
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

  // Player side, on a device that holds nothing else: the name on the profile,
  // the word the coach handed over, and the Google account the file was shared
  // with. Only that one file is opened — none of the rest of the club comes
  // with it.
  function mineDialog(onDone) {
    const back = () => { if (typeof onDone === 'function') onDone(); };
    const known = minePlayers();
    UI.modal({
      title: t('pfile.mine', 'My player file'),
      width: 540,
      body: `
        <p class="hint">${esc(t('pfile.mineIntro', 'Open the file your coach writes to you in. Type the name on your player profile exactly as the coach has it and the message key they gave you, then sign in with the Google account the file was shared with.'))}</p>
        ${known.length ? `<p class="hint">${esc(t('pfile.mineOpened', 'Already opened on this device'))}</p>
        <div class="row" style="flex:0;flex-wrap:wrap;margin-bottom:10px">
          ${known.map(p => `<button class="btn sm" data-open="${esc(p.id)}">${esc(nameOf(p))}</button>`).join('')}
        </div>` : ''}
        <label class="field"><span>${esc(t('pfile.mineName', 'Player profile name'))}</span>
          <input id="pf_mine_name" autocomplete="off" spellcheck="false" placeholder="Alex Jones"></label>
        <label class="field"><span>${esc(t('pfile.key', 'Message key'))}</span>
          <input id="pf_mine_key" maxlength="24" autocomplete="off" spellcheck="false" placeholder="ABCD-EFGH-JKMN-PQRS"></label>
        <label class="field"><span>${esc(t('pfile.mineLink', 'File link'))}</span>
          <input id="pf_mine_link" autocomplete="off" spellcheck="false" placeholder="https://drive.google.com/file/d/\u2026">
          <span class="hint">${esc(t('pfile.mineLinkHint', 'Only needed if the name alone does not find the file. It is in the invitation the coach copies out of the message key window.'))}</span></label>
        <p class="hint">${esc(t('pfile.mineHint', 'Nothing else of the club is opened or copied here \u2014 only your own file, and only the Google account it was shared with can reach it.'))}</p>`,
      footer: `<button class="btn ghost" data-close2>${esc(T('common.close'))}</button>
        <button class="btn primary" data-mine>${esc(t('pfile.mineOpen', 'Open my file'))}</button>`,
      onOpen: (m, close) => {
        const name = m.querySelector('#pf_mine_name');
        const key = m.querySelector('#pf_mine_key');
        const link = m.querySelector('#pf_mine_link');
        name.focus();
        m.querySelector('[data-close2]').onclick = () => { close(); back(); };
        m.querySelectorAll('[data-open]').forEach(b => { b.onclick = () => {
          const p = Store.find('players', b.dataset.open);
          if (!p) return UI.toast(t('pfile.mineGone', 'That file is no longer on this device'), 'error');
          close();
          dialog(p, onDone);
        }; });
        const fail = why => {
          if (why === 'noname') return UI.toast(t('pfile.mineNeedName', 'Type the name on your player profile'), 'error');
          if (why === 'nogoogle') return UI.toast(t('pfile.mineNoGoogle', 'Google Drive has to be set up on this device first \u2014 Settings, then Shared team database.'), 'error');
          if (why === 'off') return UI.toast(t('pfile.driveOff', 'Google Drive is not connected \u2014 set it up under Settings.'), 'error');
          if (why === 'notfound') return UI.toast(t('pfile.mineNotFound', 'No file with that name could be reached from this Google account. Check the spelling with your coach, or paste the file link they sent.'), 'error');
          if (why === 'noaccess') return UI.toast(t('pfile.driveShare', 'This file has not been shared with your Google account yet. The coach opening the player file once is what sends the invitation.'), 'error');
          if (why === 'nokey') return UI.toast(t('pfile.mineNoKey', 'Your coach has not generated a message key for this file yet. Ask them for one.'), 'error');
          if (why === 'len') return UI.toast(t('pfile.keyLen', 'A message key is 16 characters'), 'error');
          if (why === 'nocrypto') return UI.toast(t('pfile.keyNoCrypto', 'This device cannot check message keys. The app has to be opened over https:// for the browser to allow it.'), 'error');
          if (why === 'badkey' || why === 'bad') return UI.toast(t('pfile.keyBad', 'That key was not accepted'), 'error');
          return UI.toast(t('pfile.driveFail', 'Drive could not be reached'), 'error');
        };
        const go = async () => {
          const btn = m.querySelector('[data-mine]');
          btn.disabled = true;
          let r;
          try { r = await openMine(name.value, key.value, link.value); }
          catch (e) { r = { ok: false, why: 'net' }; }
          btn.disabled = false;
          if (!r.ok) return fail(r.why);
          close();
          UI.toast(t('pfile.mineOk', 'Your file is open'), 'success');
          dialog(r.player, onDone);
        };
        [name, key, link].forEach(el => { el.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); go(); } }; });
        m.querySelector('[data-mine]').onclick = go;
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
            else if (r.why === 'noteam') UI.toast(t('pfile.noTeam', 'Set up the shared team database first, under Settings. The player file is made in that shared folder so the coach and the player write to one document.'), 'error');
            else if (r.why === 'noaccess') UI.toast(t('pfile.driveShare', 'This file has not been shared with your Google account yet. The coach opening the player file once is what sends the invitation.'), 'error');
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
            if (!driveOn() && !await connectWithKey(player)) {
              // Only a copy that never set Google up at all stays quiet about it.
              let setUp = false;
              try { setUp = !!(window.Drive && Drive.isConfigured && await Drive.isConfigured()); }
              catch (e) { setUp = false; }
              if (setUp || holdsWord(player.id)) driveFail({ why: 'off' });
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
    startDriveSync, googleConnected, publish, inviteAccount,
    findMine, adoptDoc, openMine, minePlayers, mineDialog, inviteText, fileLink, driveIdFrom
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


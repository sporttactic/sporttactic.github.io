/* playerfile.js — one JSON file per player: the private line between the coach
   and that player.

   The file is made the moment the player is created and deleted the moment the
   player is, so a squad and its files can never drift apart. Nothing is sent
   anywhere: the file is a row in the club's own database and travels with the
   squad exactly like every other row, so the coach writes from their copy and
   the player reads and answers from theirs. */
const PlayerFile = (() => {
  const STORE = 'playerfiles';
  const MAX_MSG = 500;          // a conversation, not a log — the oldest fall off
  const MAX_LEN = 2000;

  const esc = s => UI.esc(s);
  const t = (k, fallback) => { const r = T(k); return r === k ? fallback : r; };

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
  const hasKey = playerId => { const f = get(playerId); return !!(f && f.key && f.key.hash); };

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
    return word;
  }
  // Returns true, or why it was refused: 'nokey' when no key has reached this
  // copy yet, 'len' for the wrong length, 'bad' for a key that does not match.
  async function claimKey(player, typed) {
    const word = canonKey(typed);
    const f = get(player && player.id);
    const k = f && f.key;
    if (!k || !k.hash || !k.salt) return 'nokey';
    if (word.length !== KEY_LEN) return 'len';
    if (!cryptoOk()) return 'bad';
    let hash;
    try { hash = await hashWord(word, unb64(k.salt), +k.iter || KEY_ITER); }
    catch (e) { return 'bad'; }
    if (hash !== k.hash) return 'bad';
    holdKey(player.id, prettyKey(word), hash);
    return true;
  }

  // A frozen backup stays frozen. The coach's own copy writes freely; a copy
  // that only follows the club needs the player's key.
  function canWrite(player) {
    if (window.Store && Store.locked && Store.locked()) return false;
    if (!(window.Access && Access.readMode && Access.readMode())) return true;
    return !!(player && holdsKey(player.id));
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
    return await Store.save(STORE, Object.assign({}, file, {
      messages: (file.messages || []).concat([msg]).slice(-MAX_MSG)
    }));
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

  // The file as a JSON download, so the two ends can hand messages over — and
  // the key with them — when they do not share a synced copy. Only the salt and
  // the PBKDF2 hash travel, exactly as they do through the squad file; the word
  // itself never leaves the two devices that hold it.
  function download(player) {
    const file = get(player.id);
    if (!file) return;
    const safe = nameOf(player).replace(/[^\w\-]+/g, '_') || 'player';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
    a.download = 'playerfile-' + safe + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  // The other half of the download. Everything is rebuilt field by field: the
  // file comes from outside and decides nothing about the row it lands in.
  // Returns the number added, or a negative code for a file that was refused.
  async function upload(player, blob) {
    if (!player || !player.id || !blob) return -1;
    let data = null;
    try { data = JSON.parse(await readText(blob)); } catch (e) { return -1; }
    if (!data || typeof data !== 'object' || !Array.isArray(data.messages)) return -1;
    if (data.playerId && data.playerId !== player.id) return -2;
    const cur0 = get(player.id) || await ensure(player);
    if (!cur0) return -1;
    // Taking the key over is how a copy with none earns the right to write, so
    // it happens before the write check rather than behind it.
    const inKey = data.key;
    const mine = cur0.key;
    let adopted = false;
    if (inKey && typeof inKey === 'object' && inKey.hash && inKey.salt
      && (!mine || !mine.hash || (+inKey.at || 0) > (+mine.at || 0))) {
      await Store.save(STORE, Object.assign({}, cur0, {
        key: { salt: String(inKey.salt), iter: +inKey.iter || KEY_ITER, hash: String(inKey.hash), at: +inKey.at || Date.now() }
      }));
      adopted = true;
    }
    if (!canWrite(player)) return adopted ? -4 : -3;
    const cur = get(player.id) || await ensure(player);
    if (!cur) return -1;
    const seen = new Set((cur.messages || []).map(m => m.id));
    const add = data.messages.slice(0, MAX_MSG)
      .filter(m => m && typeof m === 'object' && m.text && !seen.has(m.id))
      .map(m => ({
        id: String(m.id || Store.uid('msg')).slice(0, 40),
        at: +m.at || Date.now(),
        side: m.side === 'player' ? 'player' : 'coach',
        by: String(m.by == null ? '' : m.by).slice(0, 60),
        text: String(m.text).slice(0, MAX_LEN)
      }));
    if (!add.length) return 0;
    const merged = (cur.messages || []).concat(add).sort((a, b) => a.at - b.at).slice(-MAX_MSG);
    await Store.save(STORE, Object.assign({}, cur, { messages: merged }));
    return add.length;
  }
  // FileReader rather than blob.text(): the app still runs on iPads that have no
  // Blob.prototype.text.
  function readText(blob) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result || ''));
      r.onerror = () => rej(r.error);
      r.readAsText(blob);
    });
  }

  async function clearAll(player) {
    const file = get(player && player.id);
    if (!file || !canWrite(player)) return false;
    await Store.save(STORE, Object.assign({}, file, { messages: [] }));
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
    const waiting = !hasKey(player.id);
    UI.modal({
      title: t('pfile.key', 'Message key') + ' \u2014 ' + nameOf(player),
      width: 480,
      body: `
        <p class="hint">${esc(held
    ? t('pfile.keyHeld', 'This copy holds the key for this player and may write in the file.')
    : t('pfile.keyAsk', 'Type the message key the coach gave you. It is only needed once on this device.'))}</p>
        ${waiting ? `<p class="hint">${esc(t('pfile.keyMissing', 'No key has reached this copy yet. Sync the squad, or have the coach send the file from Download message and load it here with Upload message.'))}</p>` : ''}
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
          if (r === 'nokey') return UI.toast(t('pfile.keyMissing', 'No key has reached this copy yet. Sync the squad, or have the coach send the file from Download message and load it here with Upload message.'), 'error');
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
              : t('pfile.needKey', 'Writing needs the message key the coach generates for you. Press Message key and type it in.'))}</p>`,
        footer: `<button class="btn ghost" data-close2>${esc(T('common.close'))}</button>
          <button class="btn" data-dl ${list.length ? '' : 'disabled'}>\u2b73 ${esc(t('pfile.dl', 'Download message'))}</button>
          <label class="btn" style="cursor:pointer">\u2b71 ${esc(t('pfile.up', 'Upload message'))}<input id="pf_up" type="file" accept="application/json" hidden></label>
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
            const dl = m.querySelector('[data-dl]');
            if (dl) dl.disabled = !messages(player.id).length;
            const wipe = m.querySelector('[data-wipe]');
            if (wipe) wipe.disabled = !messages(player.id).length;
          };
          m.querySelector('[data-close2]').onclick = () => { close(); if (typeof onDone === 'function') onDone(); };
          m.querySelector('[data-dl]').onclick = () => download(player);
          m.querySelector('[data-key]').onclick = () => { close(); (staff ? keyDialog : claimDialog)(player, open); };
          const wipe = m.querySelector('[data-wipe]');
          if (wipe) wipe.onclick = () => UI.confirm(t('pfile.clearAsk', 'Remove every message in this player file? The key and the file itself stay.'), async () => {
            if (!await clearAll(player)) return;
            refresh();
            UI.toast(t('pfile.cleared', 'Player file emptied'), 'success');
          });
          const up = m.querySelector('#pf_up');
          if (up) up.onchange = async e => {
            const f = e.target.files && e.target.files[0];
            e.target.value = '';
            if (!f) return;
            const n = await upload(player, f);
            if (n > 0) { refresh(); UI.toast(t('pfile.upOk', 'Messages added') + ' (' + n + ')', 'success'); }
            else if (n === 0) UI.toast(t('pfile.upNone', 'Nothing new in that file'));
            else if (n === -4) { close(); UI.toast(t('pfile.upKey', 'Message key loaded \u2014 type it in to start writing'), 'success'); open(); }
            else if (n === -2) UI.toast(t('pfile.upWrong', 'That file belongs to another player'), 'error');
            else if (n === -3) UI.toast(t('pfile.needKey', 'Writing needs the message key the coach generates for you.'), 'error');
            else UI.toast(t('pfile.upBad', 'That file could not be read as a player file'), 'error');
          };
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
          };
        }
      });
    };
    open();
  }

  return {
    STORE, fileId, get, messages, ensure, remove, post, sweep, dialog, threadHtml, download, upload, clearAll, canWrite, side,
    newKey, claimKey, holdsKey, hasKey, keyDialog, claimDialog
  };
})();
if (typeof window !== 'undefined') window.PlayerFile = PlayerFile;

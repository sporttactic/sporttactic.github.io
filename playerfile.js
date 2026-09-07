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

  // Which end of the line this device writes from.
  function side() {
    try {
      if (window.Access && Access.tier && Access.role) {
        return Access.tier(Access.role()) === 'player' ? 'player' : 'coach';
      }
    } catch (e) { /* roles not set up on this device */ }
    return 'coach';
  }
  const sideLabel = s => s === 'player' ? t('pfile.player', 'Player') : t('pfile.coach', 'Coach');
  function myName(player) {
    if (side() === 'player') return nameOf(player);
    let n = '';
    try { n = localStorage.getItem('stx_mail_name') || ''; } catch (e) { /* private mode */ }
    if (n) return n;
    return (window.Access && Access.label) ? Access.label(Access.role()) : t('pfile.coach', 'Coach');
  }
  // A frozen backup stays frozen; everything else may write here.
  function canWrite() {
    if (window.Store && Store.locked && Store.locked()) return false;
    if (window.Access && Access.blocks && Access.blocks(STORE, { id: fileId('x') })) return false;
    return true;
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
    if (!body || !player || !player.id) return null;
    const file = get(player.id) || await ensure(player);
    if (!file) return null;
    const msg = { id: Store.uid('msg'), at: Date.now(), side: side(), by: myName(player), text: body };
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

  // The file as a JSON download — the coach can hand it over or file it away.
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

  // Read the file and write the next line in it. `onDone` runs when the dialog
  // is closed, so the view that opened it can come back.
  function dialog(player, onDone) {
    if (!player || !player.id) return;
    const writable = canWrite();
    const open = () => {
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
            ? t('pfile.signedAs', 'Signed as') + ': ' + myName(player) + ' \u00b7 ' + sideLabel(side())
            : t('pfile.readOnly', 'This copy is read-only, so the file can be read but not written to.'))}</p>`,
        footer: `<button class="btn ghost" data-close2>${esc(T('common.close'))}</button>
          <button class="btn" data-dl ${list.length ? '' : 'disabled'}>\u2b73 JSON</button>
          <button class="btn primary" data-post ${writable ? '' : 'disabled'}>${esc(t('pfile.send', 'Write in the file'))}</button>`,
        onOpen: (m, close) => {
          const box = m.querySelector('.pf-thread');
          if (box) box.scrollTop = box.scrollHeight;
          const inp = m.querySelector('#pf_text');
          if (inp && writable) inp.focus();
          m.querySelector('[data-close2]').onclick = () => { close(); if (typeof onDone === 'function') onDone(); };
          m.querySelector('[data-dl]').onclick = () => download(player);
          m.querySelector('[data-post]').onclick = async () => {
            const text = inp.value.trim();
            if (!text) return UI.toast(t('pfile.needText', 'Write something first'), 'error');
            await post(player, text);
            close();
            UI.toast(t('pfile.saved', 'Written in the player file'), 'success');
            open();                       // straight back in, with the new line in place
          };
        }
      });
    };
    open();
  }

  return { STORE, fileId, get, messages, ensure, remove, post, sweep, dialog, threadHtml, download, canWrite, side };
})();
if (typeof window !== 'undefined') window.PlayerFile = PlayerFile;

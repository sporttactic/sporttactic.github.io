/* Settings view */
window.Views = window.Views || {};

// ---- Full-fidelity JSON backup ----------------------------------------
// Every object store is read straight from IndexedDB (not the in-memory cache)
// and Blobs are base64-encoded by Store.pack, because JSON.stringify silently
// turns a Blob into `{}` — that is how recorded animation clips used to vanish.
const BACKUP_FORMAT = 2;
// A restore reads the whole file into a string and then parses it, so the
// ceiling has to be checked before either happens.
const MAX_BACKUP_BYTES = 96 * 1024 * 1024;
// Everything the app keeps outside IndexedDB lives in localStorage under `stx_`:
// the athlete name, the scouting focus areas, the progression filters, which
// panels are folded open, the mail setup. A backup that skipped them restored a
// half-configured app, so they travel with it — except the OpenAI key, which is
// a credential and must never end up in a file that gets mailed around.
const PREF_PREFIX = 'stx_';
// stx_lock is decided by the guard inside the file being imported, never by a
// preference copied out of someone else's device. stx_drive_token is a live
// Google OAuth access token kept only so a page refresh does not force a fresh
// sign-in — it must never ride along in a backup or export either.
const PREF_SECRETS = ['stx_ai_key', 'stx_lock', 'stx_drive_token'];
function readPrefs() {
  const out = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || k.indexOf(PREF_PREFIX) !== 0 || PREF_SECRETS.indexOf(k) >= 0) continue;
      out[k] = localStorage.getItem(k);
    }
  } catch (e) { /* private mode */ }
  return out;
}
function writePrefs(prefs) {
  if (!prefs || typeof prefs !== 'object') return 0;
  let n = 0;
  try {
    Object.keys(prefs).forEach(k => {
      if (k.indexOf(PREF_PREFIX) !== 0 || PREF_SECRETS.indexOf(k) >= 0) return;
      const v = prefs[k];
      if (typeof v !== 'string') return;
      localStorage.setItem(k, v); n++;
    });
  } catch (e) { /* private mode / quota */ }
  return n;
}
async function buildBackup(stores) {
  const list = stores && stores.length ? stores : DB.STORES;
  const data = {};
  const counts = {};
  for (const s of list) {
    const rows = await DB.getAll(s);
    data[s] = await Store.pack(rows);
    counts[s] = rows.length;
  }
  const dump = {
    app: 'SportTactic', format: BACKUP_FORMAT,
    exportedAt: new Date().toISOString(),
    stores: list.slice(), counts, data
  };
  // Only a whole-app backup carries the preferences; a picked share does not.
  if (!stores || !stores.length) dump.prefs = readPrefs();
  return dump;
}
async function restoreBackup(dump) {
  if (!dump || typeof dump !== 'object') throw new Error('bad backup');
  // format 2 nests everything under `data`; format 1 files are flat.
  const data = dump.data && typeof dump.data === 'object' ? dump.data : dump;
  const found = DB.STORES.filter(s => Array.isArray(data[s]));
  if (!found.length) throw new Error('no stores in backup');
  for (const s of found) {
    await DB.clear(s);
    await DB.bulkPut(s, Store.unpack(data[s]));
  }
  writePrefs(dump.prefs);
  // A file exported with a pass key opens read-only; an ordinary one hands the
  // device back its full editing rights.
  Store.setLock(dump.guard && dump.guard.readOnly ? dump.guard : null);
}
function downloadJson(json, name) {
  let url = '';
  try {
    url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener'; a.style.display = 'none';
    // Firefox and iPadOS ignore a click on an anchor that is not in the document.
    document.body.appendChild(a);
    a.click();
    a.remove();
    return true;
  } catch (e) { return false; }
  finally { if (url) setTimeout(() => URL.revokeObjectURL(url), 20000); }
}
// The unattended backup timer lives in backup.js and needs these two.
window.Backup = { build: buildBackup, restore: restoreBackup, download: downloadJson, unlock: unlockDialog };

// ---- Pass key ------------------------------------------------------------
// A backup can be exported with a pass key. It then opens read-only wherever it
// is imported, and only someone who knows the key can switch editing back on.
// The key itself never travels — only a PBKDF2 hash of it and its salt.
const GUARD_ITER = 310000;
const cryptoOk = () => !!(window.crypto && crypto.subtle && crypto.getRandomValues);
function b64(buf) { let s = ''; new Uint8Array(buf).forEach(b => { s += String.fromCharCode(b); }); return btoa(s); }
function unb64(s) { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
async function guardHash(key, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: GUARD_ITER, hash: 'SHA-256' }, base, 256);
  return b64(bits);
}
async function makeGuard(key) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { v: 1, readOnly: true, salt: b64(salt), hash: await guardHash(key, salt) };
}
async function checkGuard(guard, key) {
  if (!guard || !guard.salt || !guard.hash || !cryptoOk()) return false;
  try { return await guardHash(key, unb64(guard.salt)) === guard.hash; } catch (e) { return false; }
}
function unlockDialog(onDone) {
  const guard = Store.lockInfo();
  UI.modal({
    title: T('lock.unlockTitle'),
    width: 480,
    body: `<p>${UI.esc(T('lock.unlockIntro'))}</p>
      <label class="field"><span>${UI.esc(T('lock.key'))}</span>
        <input id="lockKey" type="password" autocomplete="off" spellcheck="false"></label>
      <p class="hint">${UI.esc(T('lock.unlockHint'))}</p>`,
    footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button>
      <button class="btn primary" data-go>${UI.esc(T('lock.unlock'))}</button>`,
    onOpen: (m, close) => {
      const inp = m.querySelector('#lockKey');
      inp.focus();
      const go = async () => {
        if (!await checkGuard(guard, inp.value)) return UI.toast(T('lock.wrong'), 'error');
        Store.setLock(null);
        close();
        UI.toast(T('lock.unlocked'), 'success');
        if (typeof onDone === 'function') onDone(); else App.render();
      };
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
      m.querySelector('[data-close2]').onclick = close;
      m.querySelector('[data-go]').onclick = go;
    }
  });
}

// ---- "Send to Coach": pick what actually leaves the device ---------------
// Grouped the way a coach thinks about the data, not the way it is stored.
const SHARE_GROUPS = [
  { id: 'squad', stores: ['clubs', 'teams', 'players', 'coaches', 'seasons'], key: 'settings.shareGSquad', def: 'Squad, staff and teams', sensitive: true },
  { id: 'matches', stores: ['matches', 'events'], key: 'settings.shareGMatches', def: 'Matches and logged events' },
  { id: 'training', stores: ['training', 'exercises'], key: 'settings.shareGTraining', def: 'Training sessions and drill library' },
  { id: 'planner', stores: ['planner'], key: 'nav.planner', def: 'Event planner' },
  { id: 'personal', stores: ['personal'], key: 'settings.shareGPersonal', def: 'Personal training and max tests', sensitive: true },
  { id: 'opponents', stores: ['opponents'], key: 'settings.shareGOpponents', def: 'Opponent analysis' },
  { id: 'reports', stores: ['reports'], key: 'settings.shareGReports', def: 'Saved reports' }
];
// A backup is the whole app, so it offers the two blocks a mailed share does not.
const EXPORT_GROUPS = SHARE_GROUPS.concat([
  { id: 'tactics', stores: ['tactics'], key: 'tactics.savedAnims', def: 'Saved animations' },
  { id: 'video', stores: ['videos'], key: 'nav.video', def: 'Video bookmarks' }
]);

// ---- Export Backup: pick what travels, and whether it can be edited ------
function exportDialog() {
  const tt = (k, f) => { const r = T(k); return r === k ? f : r; };
  const count = g => g.stores.reduce((n, s) => n + (Store.all(s) || []).length, 0);
  const row = g => {
    const n = count(g);
    return `<label class="check-row share-row">
      <input type="checkbox" data-grp="${g.id}" ${n ? 'checked' : ''} ${n ? '' : 'disabled'}>
      <span>${UI.esc(tt(g.key, g.def))}
        ${g.sensitive ? `<span class="tag warn">${UI.esc(tt('settings.shareSensitive', 'personal data'))}</span>` : ''}
        <span class="share-n">${n ? n + ' ' + UI.esc(tt('settings.shareRecords', 'records')) : UI.esc(tt('settings.shareEmpty', 'nothing saved yet'))}</span>
      </span>
    </label>`;
  };
  UI.modal({
    title: T('settings.exportBackup'),
    width: 620,
    body: `<p>${UI.esc(T('settings.exportIntro'))}</p>
      <div class="row" style="flex:0;margin-bottom:6px">
        <button type="button" class="btn sm" data-all>${UI.esc(tt('settings.shareAll', 'Select all'))}</button>
        <button type="button" class="btn sm" data-none>${UI.esc(tt('settings.shareNone', 'Select none'))}</button>
      </div>
      ${EXPORT_GROUPS.map(row).join('')}
      <label class="field" style="margin-top:12px"><span>${UI.esc(T('settings.exportKey'))}</span>
        <input id="exp_key" type="password" autocomplete="off" spellcheck="false" placeholder="${UI.esc(T('settings.exportKeyPh'))}" ${Store.locked() ? 'disabled' : ''}>
        <span class="hint">${UI.esc(Store.locked() ? T('settings.exportStaysLocked') : T('settings.exportKeyHint'))}</span></label>
      ${cryptoOk() ? '' : `<p class="hint mail-note">${UI.esc(T('settings.exportNoCrypto'))}</p>`}
      <p class="hint" id="expTotal"></p>`,
    footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button>
      <button class="btn primary" data-go>${UI.esc(tt('settings.shareDownload', 'Download file'))}</button>`,
    onOpen: (m, close) => {
      const boxes = [...m.querySelectorAll('[data-grp]')];
      const chosen = () => EXPORT_GROUPS.filter(g => { const b = boxes.find(x => x.dataset.grp === g.id); return b && b.checked && !b.disabled; });
      const total = () => {
        const picked = chosen();
        const n = picked.reduce((sum, g) => sum + count(g), 0);
        m.querySelector('#expTotal').textContent = n + ' ' + tt('settings.shareRecords', 'records') + ' \u00b7 ' + picked.length + '/' + EXPORT_GROUPS.length;
        m.querySelector('[data-go]').disabled = !picked.length;
      };
      boxes.forEach(b => b.onchange = total);
      m.querySelector('[data-all]').onclick = () => { boxes.forEach(b => { if (!b.disabled) b.checked = true; }); total(); };
      m.querySelector('[data-none]').onclick = () => { boxes.forEach(b => b.checked = false); total(); };
      total();
      m.querySelector('[data-close2]').onclick = close;
      m.querySelector('[data-go]').onclick = async () => {
        const picked = chosen();
        if (!picked.length) return;
        const key = m.querySelector('#exp_key').value.trim();
        if (key && key.length < 4) return UI.toast(T('settings.exportKeyShort'), 'error');
        if (key && !cryptoOk()) return UI.toast(T('settings.exportNoCrypto'), 'error');
        // Everything ticked means a true whole-app backup, preferences included.
        const whole = EXPORT_GROUPS.every(g => !count(g) || picked.indexOf(g) >= 0);
        try {
          const dump = await buildBackup(whole ? [] : [...new Set(picked.flatMap(g => g.stores))]);
          if (key) dump.guard = await makeGuard(key);
          else if (Store.locked()) dump.guard = Store.lockInfo();   // a read-only copy stays read-only
          downloadJson(JSON.stringify(dump, null, 2), 'sporttactic-backup-' + new Date().toISOString().slice(0, 10) + '.json');
          close();
          UI.toast(key || Store.locked() ? T('settings.exportedLocked') : T('settings.exported'), 'success');
        } catch (e) { UI.toast(T('settings.exportFailed'), 'error'); }
      };
    }
  });
}

// ---- The readable report ------------------------------------------------
// What gets mailed is written for a person, not for a parser: the file download
// stays the machine-readable backup.
function shareReport(groups) {
  const tt = (k, f) => { const r = T(k); return r === k ? f : r; };
  const has = id => groups.some(g => g.id === id);
  const d = v => { const x = new Date(v); return isNaN(x) ? '\u2014' : x.toISOString().slice(0, 10); };
  const pad = (s, n) => String(s == null ? '' : s).padEnd(n).slice(0, n);
  const out = [];
  const head = t => { out.push('', '=== ' + t.toUpperCase() + ' ===', ''); };

  const team = Store.activeTeam();
  out.push('SportTactic \u2014 ' + tt('settings.shareReportTitle', 'shared data'));
  if (team) out.push(tt('settings.shareReportTeam', 'Team') + ': ' + team.name + (team.division ? ' \u00b7 ' + team.division : '') + (team.category ? ' \u00b7 ' + team.category : ''));
  out.push(tt('tactics.sport', 'Sport') + ': ' + SPORTS.name(App.getSport(), I18N.getLang()));
  out.push(tt('settings.shareReportDate', 'Exported') + ': ' + d(Date.now()));

  if (has('squad')) {
    const players = Store.players();
    head(tt('teams.squad', 'Squad') + ' (' + players.length + ')');
    players.slice().sort((a, b) => (+a.number || 0) - (+b.number || 0)).forEach(p => {
      out.push('#' + pad(p.number || '?', 4) + pad([p.firstName, p.lastName].filter(Boolean).join(' '), 24)
        + pad(p.position || '', 16)
        + pad(p.height ? p.height + ' cm' : '', 9) + pad(p.weight ? p.weight + ' kg' : '', 9)
        + pad(tt('status.' + (p.status || 'active'), p.status || 'active'), 12)
        + (p.email || ''));
      if (p.status === 'injured' && p.injuryNote) out.push('      \u21b3 ' + p.injuryNote);
    });
    const staff = Store.coaches();
    if (staff.length) {
      out.push('', tt('teams.staff', 'Staff') + ':');
      staff.forEach(c => out.push('  ' + pad(c.name || '', 24) + pad(c.role || '', 20) + (c.email || '')));
    }
  }

  if (has('matches')) {
    const list = Store.matches().slice().sort((a, b) => (a.date || 0) - (b.date || 0));
    head(tt('matches.title', 'Matches') + ' (' + list.length + ')');
    list.forEach(m => {
      const played = m.status === 'finished' || m.homeScore || m.awayScore;
      const score = played ? m.homeScore + ':' + m.awayScore : '\u2013';
      out.push(pad(d(m.date), 12) + pad((m.home ? tt('common.vs', 'vs') : tt('common.at', '@')) + ' ' + (m.opponent || ''), 26)
        + pad(score, 9) + pad(m.type || '', 14) + (m.venue || ''));
      const evs = Store.matchEvents(m.id) || [];
      if (evs.length) {
        const tally = {};
        evs.forEach(e => { tally[e.type] = (tally[e.type] || 0) + 1; });
        out.push('      ' + Object.keys(tally).map(k => k + ' ' + tally[k]).join(', '));
      }
    });
  }

  if (has('training')) {
    const list = Store.scoped('training').slice().sort((a, b) => (a.date || 0) - (b.date || 0));
    head(tt('training.title', 'Training') + ' (' + list.length + ')');
    list.forEach(s => {
      out.push(pad(d(s.date), 12) + pad(s.title || '', 30) + pad(s.duration ? s.duration + ' min' : '', 10) + (s.focus || ''));
      const names = (s.exercises || []).map(id => { const e = Store.find('exercises', id); return e && e.title; }).filter(Boolean);
      if (names.length) out.push('      ' + names.join(', '));
    });
  }

  if (has('personal')) {
    const list = Store.scoped('personal').slice().sort((a, b) => (a.date || 0) - (b.date || 0));
    head(tt('personal.title', 'Personal tests') + ' (' + list.length + ')');
    list.forEach(r => {
      out.push(pad(d(r.date), 12) + pad(r.playerName || '', 22) + (r.sessionTitle || ''));
      (r.exercises || []).forEach(e => {
        out.push('      ' + pad(e.name, 26) + e.sets + ' \u00d7 ' + e.reps + (e.value > 0 ? ' @ ' + e.value + ' ' + (e.unit || '') : ''));
      });
      (r.tests || []).forEach(t => {
        const rm = (t.unit === 'kg' && t.value > 0 && t.reps > 1) ? '  (1RM \u2248 ' + Math.round(t.value * (1 + t.reps / 30)) + ' kg)' : '';
        out.push('      ' + pad(t.name, 26) + t.value + ' ' + (t.unit || '') + (t.reps > 1 ? ' \u00d7 ' + t.reps : '') + rm);
      });
      if (r.notes) out.push('      ' + r.notes);
    });
  }

  if (has('opponents')) {
    const list = Store.scoped('opponents');
    head(tt('opponents.title', 'Opponents') + ' (' + list.length + ')');
    list.forEach(o => {
      out.push(o.name || '');
      if (o.formation) out.push('      ' + tt('opponents.formation', 'Formation') + ': ' + o.formation);
      if (o.keyPlayers) out.push('      ' + tt('opponents.keyPlayers', 'Key players') + ': ' + o.keyPlayers);
      if (o.tendencies) out.push('      ' + tt('opponents.tendencies', 'Tendencies') + ': ' + o.tendencies);
    });
  }

  if (has('reports')) {
    const list = Store.all('reports');
    head(tt('reports.title', 'Saved reports') + ' (' + list.length + ')');
    list.forEach(r => out.push(pad(d(r.date || r.updatedAt), 12) + (r.title || r.type || '')));
  }

  return out.join('\n');
}

function shareDialog() {
  const tt = (k, f) => { const r = T(k); return r === k ? f : r; };
  const count = g => g.stores.reduce((n, s) => n + (Store.all(s) || []).length, 0);
  const row = g => {
    const n = count(g);
    return `<label class="check-row share-row">
      <input type="checkbox" data-grp="${g.id}" ${g.off || !n ? '' : 'checked'} ${n ? '' : 'disabled'}>
      <span>${UI.esc(tt(g.key, g.def))}
        ${g.sensitive ? `<span class="tag warn">${UI.esc(tt('settings.shareSensitive', 'personal data'))}</span>` : ''}
        <span class="share-n">${n ? n + ' ' + UI.esc(tt('settings.shareRecords', 'records')) : UI.esc(tt('settings.shareEmpty', 'nothing saved yet'))}</span>
      </span>
    </label>`;
  };
  UI.modal({
    title: T('settings.sendCoach'),
    width: 620,
    body: `<p>${UI.esc(tt('settings.shareIntro', 'Tick what should go in the file. Anything left unticked never leaves this device.'))}</p>
      <div class="row" style="flex:0;margin-bottom:6px">
        <button type="button" class="btn sm" data-all>${UI.esc(tt('settings.shareAll', 'Select all'))}</button>
        <button type="button" class="btn sm" data-none>${UI.esc(tt('settings.shareNone', 'Select none'))}</button>
      </div>
      ${SHARE_GROUPS.map(row).join('')}
      <p class="hint mail-note">${UI.esc(tt('settings.shareWarn', 'The squad block carries mobile numbers, e-mail addresses, injury notes and each person\u2019s private chat key. Only send it to someone entitled to see them, and only over a channel you trust.'))}</p>
      <label class="field"><span>${UI.esc(tt('settings.shareTo', 'Send to'))}</span>
        <input id="shareTo" type="email" autocomplete="off" spellcheck="false" placeholder="${UI.esc(T('teams.emailPh'))}">
        <span class="hint">${UI.esc(MAIL.canSendDirect()
      ? tt('settings.shareToHint', 'Send writes a readable report into the mail. Download file writes the same data as a backup the other coach can import.')
      : tt('settings.shareToOff', 'Sending is switched off until EmailJS is set up under Send e-mail. You can still download the file.'))}</span></label>
      <p class="hint" id="shareTotal"></p>`,
    footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button>
      <button class="btn" data-go>${UI.esc(tt('settings.shareDownload', 'Download file'))}</button>
      <button class="btn primary" data-send>${UI.esc(tt('settings.shareSend', 'Send'))}</button>`,
    onOpen: (m, close) => {
      const boxes = [...m.querySelectorAll('[data-grp]')];
      const chosen = () => SHARE_GROUPS.filter(g => { const b = boxes.find(x => x.dataset.grp === g.id); return b && b.checked && !b.disabled; });
      const stores = () => [...new Set(chosen().flatMap(g => g.stores))];
      const total = () => {
        const picked = chosen();
        const n = picked.reduce((sum, g) => sum + count(g), 0);
        m.querySelector('#shareTotal').textContent = n + ' ' + tt('settings.shareRecords', 'records') + ' \u00b7 ' + picked.length + '/' + SHARE_GROUPS.length;
        m.querySelector('[data-go]').disabled = !picked.length;
        m.querySelector('[data-send]').disabled = !picked.length || !MAIL.canSendDirect();
      };
      boxes.forEach(b => b.onchange = total);
      m.querySelector('[data-all]').onclick = () => { boxes.forEach(b => { if (!b.disabled) b.checked = true; }); total(); };
      m.querySelector('[data-none]').onclick = () => { boxes.forEach(b => b.checked = false); total(); };
      total();
      // Locked dialog: Cancel is the only way out, so nothing is lost by a stray click.
      m.querySelector('[data-close2]').onclick = close;
      m.querySelector('[data-go]').onclick = async () => {
        if (!stores().length) return;
        try {
          const json = JSON.stringify(await buildBackup(stores()), null, 2);
          downloadJson(json, 'sporttactic-share-' + new Date().toISOString().slice(0, 10) + '.json');
          close();
          UI.toast(T('settings.shareDownloaded'), 'success');
        } catch (e) { UI.toast(T('settings.exportFailed'), 'error'); }
      };
      const send = m.querySelector('[data-send]');
      send.onclick = async () => {
        const to = MAIL.normEmail(m.querySelector('#shareTo').value.trim());
        if (!to) return UI.toast(tt('settings.shareNeedTo', 'Write the address to send it to'), 'error');
        const picked = chosen();
        if (!picked.length) return;
        send.disabled = true;
        try {
          const body = shareReport(picked);
          // EmailJS caps a request at 50 KB.
          if (body.length > 45000) {
            UI.toast(tt('settings.shareTooBig', 'Too much to put in a mail \u2014 untick a block or use Download file'), 'error');
            return;
          }
          await MAIL.sendDirect(to, tt('settings.shareMailSubject', 'SportTactic data'), body);
          close();
          UI.toast(tt('settings.shareSent', 'Sent') + ' \u00b7 ' + to, 'success');
        } catch (e) {
          UI.toast(T('mail.sendFailed') + ': ' + String(e && e.message ? e.message : e).slice(0, 160), 'error');
        } finally { send.disabled = false; }
      };
    }
  });
}

// ---- Spreadsheet export -----------------------------------------------
// A leading =, +, - or @ makes Sheets and Excel treat the value as a formula,
// so every cell is prefixed with an apostrophe when it starts with one.
function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
function squadCsv() {
  const head = ['Number', 'First name', 'Last name', 'Position', 'Height cm', 'Weight kg', 'Mobile', 'E-mail', 'Status'];
  const rows = Store.players().map(p => [p.number, p.firstName, p.lastName, p.position, p.height, p.weight, p.phone, p.email, p.status]);
  return [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
}
function downloadCsv(text, name) {
  const a = document.createElement('a');
  // The BOM makes Sheets and Excel read the file as UTF-8.
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 20000);
}

// ---- Explain dialogs ---------------------------------------------------
function guideDialog(title, intro, steps, tail) {
  UI.modal({
    title,
    width: 680,
    body: `<p>${intro}</p><ol class="ai-guide">${steps.map(s => `<li>${s}</li>`).join('')}</ol>${tail || ''}`,
    footer: `<button class="btn primary" data-close2>${T('common.close')}</button>`,
    onOpen: (m, close) => { m.querySelector('[data-close2]').onclick = close; }
  });
}

// Long intervals read better as hours than as "every 720 minutes".
function everyLabel(m) {
  if (!m) return T('settings.autoOff');
  return m % 60 === 0 && m >= 120
    ? T('settings.autoHours').replace('{0}', m / 60)
    : T('settings.autoMin').replace('{0}', m);
}

// ---- Shared team database on Google Drive -------------------------------
// One JSON file in one person's Drive is the team's database. Everybody else
// points at that file with a short code. Everything below exists to keep that
// true without asking a coach to understand OAuth, folders or permissions.

function fmtWhen(ts) {
  if (!ts) return T('cloud.never');
  return UI.fmtDate(ts) + ' ' + new Date(ts).toTimeString().slice(0, 5);
}

// Sync stores a token rather than a sentence, so the wording follows the
// language the coach is reading in right now.
const CLOUD_ERR = { 'oversize': 'cloud.oversize', 'oversize-owner': 'cloud.oversizeOwner', 'signin': 'cloud.signinNeeded' };
function cloudErrText(err) {
  return CLOUD_ERR[err] ? T(CLOUD_ERR[err]) : err;
}

// The three or four sentences that get somebody with a phone and no patience
// from nothing to a working shared database.
function cloudGuide() {
  guideDialog(T('cloud.guideTitle'), UI.esc(T('cloud.guideIntro')), [
    UI.esc(T('cloud.guide1')), UI.esc(T('cloud.guide2')), UI.esc(T('cloud.guide3')),
    UI.esc(T('cloud.guide4')), UI.esc(T('cloud.guide5'))
  ], `<p class="hint">${UI.esc(T('cloud.guideTail'))}</p>`);
}

// ---- The Google setup wizard --------------------------------------------
// Connecting Google is the one genuinely technical part of the whole feature.
// Instead of a page of instructions it is one short screen per step: the exact
// value to paste sits behind a Copy button, the Google page it belongs on is
// one click away, and the last step proves the setup works before the coach
// walks away thinking it does.
const GOOGLE_PAGES = {
  project: 'https://console.cloud.google.com/projectcreate',
  driveApi: 'https://console.cloud.google.com/apis/library/drive.googleapis.com',
  // Google replaced the old "OAuth consent screen" page with the Auth Platform,
  // where the External choice now lives inside Get started and the test users
  // sit on their own Audience page.
  authPlatform: 'https://console.cloud.google.com/auth/overview',
  audience: 'https://console.cloud.google.com/auth/audience',
  clients: 'https://console.cloud.google.com/auth/clients',
  credentials: 'https://console.cloud.google.com/apis/credentials'
};
const WIZ_STEP_KEY = 'stx_gwiz_step';
const API_KEY_RE = /^AIza[0-9A-Za-z_\-]{10,}$/;

async function copyText(txt) {
  try { await navigator.clipboard.writeText(txt); return true; }
  catch (e) {
    // Safari and any page without clipboard permission still need to work.
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
// A value the coach must paste into Google, with the button that grabs it.
function wizCopy(label, value, note) {
  return `<div class="wiz-copy">
    <span class="wiz-copy-label">${UI.esc(label)}</span>
    <code class="wiz-copy-val">${UI.esc(value)}</code>
    <button type="button" class="btn sm" data-copy="${UI.esc(value)}">${UI.esc(T('cloud.copy'))}</button>
    ${note ? `<span class="hint wiz-copy-note">${UI.esc(note)}</span>` : ''}
  </div>`;
}
function wizOpen(label, url) {
  return `<a class="btn primary wiz-open" href="${UI.esc(url)}" target="_blank" rel="noopener">${UI.esc(label)} \u2197</a>`;
}
// Troubleshooting kept folded away, so the step itself stays four lines long.
function wizHelp(title, lines) {
  return `<details class="wiz-help"><summary>${UI.esc(title)}</summary>
    <ul>${lines.map(l => `<li>${UI.esc(l)}</li>`).join('')}</ul></details>`;
}
// The scope the app asks for. Google shows it on the consent screen and wants
// it listed under Data Access before an app can be published.
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
// Where the app normally lives, offered when the copy this is running from has
// no address Google can use.
const HOME_ORIGIN = 'https://sporttactic.net';
// Google accepts https anywhere, and http only on localhost. A page opened from
// disk reports "file://" or "null", which is not an origin at all.
function originUsable() {
  if (location.protocol === 'https:') return true;
  return location.protocol === 'http:' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
}
// Trailing slash, a path or a stray space are the three things Google rejects.
function cleanOrigin(v) {
  const s = String(v == null ? '' : v).trim();
  if (!/^https?:\/\/[^\s/]+/i.test(s)) return '';
  try { return new URL(s).origin; } catch (e) { return ''; }
}
// Every address that should go in as a Test user, taken from the access list
// and the squad so nobody has to be remembered or retyped.
function wizTestUsers() {
  const seen = new Set();
  const out = [];
  const add = e => {
    const v = Access.normEmail(e);
    if (v && v.indexOf('@') > 0 && !seen.has(v)) { seen.add(v); out.push(v); }
  };
  Access.members().forEach(m => add(m.email));
  Access.suggestions().forEach(s => add(s.email));
  return out;
}
// Things that make the whole setup impossible, said before Google is opened
// rather than after it answers with a blank error page.
function wizBlockers() {
  const out = [];
  const p = location.protocol;
  if (p !== 'http:' && p !== 'https:') out.push(T('gw.blockFile'));
  else if (p === 'http:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') out.push(T('gw.blockHttp'));
  return out;
}
// Turns whatever went wrong into the one thing the coach should go and fix.
function wizExplain(err) {
  const s = String((err && err.message) || err || '');
  if (/accessNotConfigured|has not been used|SERVICE_DISABLED|403/.test(s)) return T('gw.failApiOff');
  if (/redirect_uri_mismatch|origin|idpiframe/i.test(s)) return T('gw.failOrigin').replace('{0}', location.origin);
  if (/access_denied|denied/i.test(s)) return T('gw.failTestUser');
  if (/popup/i.test(s)) return T('gw.failPopup');
  if (/client id|client_id/i.test(s)) return T('gw.failClientId');
  if (/Failed to fetch|NetworkError|offline/i.test(s)) return T('gw.failOffline');
  return s.slice(0, 200);
}

function googleWizard(onDone) {
  const LAST = 6;
  let step = 0;
  try { step = Math.min(LAST, Math.max(0, parseInt(localStorage.getItem(WIZ_STEP_KEY), 10) || 0)); } catch (e) { step = 0; }
  let clientId = '', apiKey = '', tested = false;

  const origin = location.origin;
  const users = wizTestUsers();
  const blockers = wizBlockers();
  // What goes into Google's origin list: this address when it can be used, or
  // the one the coach says the team will actually open the app on.
  let pubOrigin = originUsable() ? origin : HOME_ORIGIN;
  // Google asks for the same address three times; it is typed once here.
  let ownerMail = '';

  const idOk = () => !!Drive.normClientId(clientId);
  const keyOk = () => !apiKey || API_KEY_RE.test(apiKey.trim());

  function body(m) {
    const host = m.querySelector('#wizBody');
    const bar = m.querySelector('#wizBar');
    bar.innerHTML = Array.from({ length: LAST + 1 }, (_, i) =>
      `<span class="wiz-dot${i === step ? ' on' : ''}${i < step ? ' done' : ''}"></span>`).join('');
    m.querySelector('#wizStepNo').textContent = T('gw.stepOf').replace('{0}', step + 1).replace('{1}', LAST + 1);
    host.innerHTML = SCREENS[step]();
    wire(m, host);
    const back = m.querySelector('[data-back]');
    const next = m.querySelector('[data-next]');
    back.disabled = step === 0;
    next.textContent = step === LAST ? T('common.close') : T('gw.next');
    next.disabled = (step === 4 && !idOk()) || (step === 5 && !keyOk());
    try { localStorage.setItem(WIZ_STEP_KEY, String(step)); } catch (e) { /* private mode */ }
  }

  // An app opened from disk, or served over plain http, has no address Google
  // can accept — so instead of offering that to paste it asks where the team
  // will really open it.
  function originBlock() {
    if (originUsable()) return wizCopy(T('gw.s4Origin'), origin, T('gw.s4OriginNote'));
    const why = location.protocol === 'http:' ? T('gw.s4NoOriginHttp') : T('gw.s4NoOriginFile');
    return `<div class="wiz-warn">
        <b>${UI.esc(T('gw.s4NoOrigin'))}</b>
        <p>${UI.esc(why)}</p>
      </div>
      <label class="field"><span>${UI.esc(T('gw.s4Where'))}</span>
        <input id="wiz_origin" spellcheck="false" autocomplete="off" placeholder="${UI.esc(HOME_ORIGIN)}" value="${UI.esc(pubOrigin)}">
        <span class="hint" id="wiz_origin_state"></span></label>
      <div class="wiz-copy">
        <span class="wiz-copy-label">${UI.esc(T('gw.s4Origin'))}</span>
        <code class="wiz-copy-val" id="wiz_origin_out">${UI.esc(pubOrigin)}</code>
        <button type="button" class="btn sm" data-copy-from="#wiz_origin_out">${UI.esc(T('cloud.copy'))}</button>
      </div>`;
  }

  const SCREENS = [    // 0 — what this is and whether it can work here at all
    () => `<h3 class="wiz-h">${UI.esc(T('gw.s0Title'))}</h3>
      <p>${UI.esc(T('gw.s0Intro'))}</p>
      <ul class="wiz-list">
        <li>${UI.esc(T('gw.s0Need1'))}</li>
        <li>${UI.esc(T('gw.s0Need2'))}</li>
        <li>${UI.esc(T('gw.s0Need3'))}</li>
      </ul>
      ${blockers.length
        ? `<p class="wiz-bad">${blockers.map(UI.esc).join('<br>')}</p>`
        : `<p class="wiz-good">${UI.esc(T('gw.s0Ready'))}</p>`}
      <p class="hint">${UI.esc(T('gw.s0Tail'))}</p>`,

    // 1 — the project
    () => `<h3 class="wiz-h">${UI.esc(T('gw.s1Title'))}</h3>
      <p>${UI.esc(T('gw.s1Intro'))}</p>
      ${wizOpen(T('gw.s1Open'), GOOGLE_PAGES.project)}
      ${wizCopy(T('gw.s1Name'), 'SportTactic', T('gw.s1NameNote'))}
      <p class="hint">${UI.esc(T('gw.s1Tail'))}</p>`,

    // 2 — switch the Drive API on
    () => `<h3 class="wiz-h">${UI.esc(T('gw.s2Title'))}</h3>
      <p>${UI.esc(T('gw.s2Intro'))}</p>
      ${wizOpen(T('gw.s2Open'), GOOGLE_PAGES.driveApi)}
      <p class="hint">${UI.esc(T('gw.s2Tail'))}</p>`,

    // 3 — the Auth Platform, then the test users, pre-collected
    () => `<h3 class="wiz-h">${UI.esc(T('gw.s3Title'))}</h3>
      <p>${UI.esc(T('gw.s3Intro'))}</p>
      ${wizOpen(T('gw.s3Open'), GOOGLE_PAGES.authPlatform)}
      <label class="field"><span>${UI.esc(T('gw.yourMail'))}</span>
        <input id="wiz_mail" type="email" spellcheck="false" autocomplete="off" placeholder="coach@klub.dk" value="${UI.esc(ownerMail)}">
        <span class="hint">${UI.esc(T('gw.yourMailHint'))}</span></label>
      <ol class="wiz-list">
        <li>${UI.esc(T('gw.s3A'))}</li>
        <li>${UI.esc(T('gw.s3B'))}</li>
        <li>${UI.esc(T('gw.s3C'))}</li>
        <li>${UI.esc(T('gw.s3D'))}</li>
      </ol>
      ${wizCopy(T('gw.fAppName'), 'SportTactic')}
      <div class="wiz-copy">
        <span class="wiz-copy-label">${UI.esc(T('gw.fSupportMail'))}</span>
        <code class="wiz-copy-val" id="wiz_mail_out">${UI.esc(ownerMail || '\u2014')}</code>
        <button type="button" class="btn sm" data-copy-from="#wiz_mail_out">${UI.esc(T('cloud.copy'))}</button>
        <span class="hint wiz-copy-note">${UI.esc(T('gw.fSupportMailNote'))}</span>
      </div>
      <p class="hint">${UI.esc(T('gw.s3Old'))}</p>
      ${wizHelp(T('gw.s3HelpT'), [T('gw.s3H1'), T('gw.s3H2'), T('gw.s3H3'), T('gw.s3H4')])}
      <h4 class="wiz-sub">${UI.esc(T('gw.s3UsersTitle'))}</h4>
      <p>${UI.esc(T('gw.s3UsersIntro'))}</p>
      ${wizOpen(T('gw.s3OpenUsers'), GOOGLE_PAGES.audience)}
      ${users.length
        ? `<div class="wiz-copy wiz-users">
             <span class="wiz-copy-label">${UI.esc(T('gw.s3Users').replace('{0}', users.length))}</span>
             <code class="wiz-copy-val">${UI.esc(users.join(', '))}</code>
             <button type="button" class="btn sm" data-copy="${UI.esc(users.join(', '))}">${UI.esc(T('gw.s3CopyUsers'))}</button>
           </div>`
        : `<p class="hint">${UI.esc(T('gw.s3NoUsers'))}</p>`}
      <p class="hint">${UI.esc(T('gw.s3Tail'))}</p>`,

    // 4 — the client id, with the origin ready to paste
    () => `<h3 class="wiz-h">${UI.esc(T('gw.s4Title'))}</h3>
      <p>${UI.esc(T('gw.s4Intro'))}</p>
      ${wizOpen(T('gw.s4Open'), GOOGLE_PAGES.clients)}
      <ol class="wiz-list"><li>${UI.esc(T('gw.s4A'))}</li><li>${UI.esc(T('gw.s4B'))}</li></ol>
      ${wizCopy(T('gw.fClientName'), 'SportTactic web')}
      ${originBlock()}
      <label class="field"><span>${UI.esc(T('cloud.clientId'))}</span>
        <input id="wiz_id" spellcheck="false" autocomplete="off" placeholder="1234567890-abc.apps.googleusercontent.com" value="${UI.esc(clientId)}">
        <span class="hint" id="wiz_id_state"></span></label>
      ${wizHelp(T('gw.s4HelpT'), [T('gw.s4H1'), T('gw.s4H2'), T('gw.s4H3'), T('gw.s4H4')])}`,

    // 5 — the optional api key
    () => `<h3 class="wiz-h">${UI.esc(T('gw.s5Title'))}</h3>
      <p>${UI.esc(T('gw.s5Intro'))}</p>
      ${wizOpen(T('gw.s5Open'), GOOGLE_PAGES.credentials)}
      <ol class="wiz-list"><li>${UI.esc(T('gw.s5A'))}</li><li>${UI.esc(T('gw.s5B'))}</li></ol>
      <label class="field"><span>${UI.esc(T('cloud.apiKey'))}</span>
        <input id="wiz_key" spellcheck="false" autocomplete="off" placeholder="AIza…" value="${UI.esc(apiKey)}">
        <span class="hint" id="wiz_key_state"></span></label>
      <p class="hint">${UI.esc(T('gw.s5Tail'))}</p>
      ${wizHelp(T('gw.s5HelpT'), [T('gw.s5H1'), T('gw.s5H2'), T('gw.s5H3')])}`,

    // 6 — prove it works
    () => `<h3 class="wiz-h">${UI.esc(T('gw.s6Title'))}</h3>
      <p>${UI.esc(T('gw.s6Intro'))}</p>
      <button type="button" class="btn primary" id="wizTest">${UI.esc(T('gw.s6Test'))}</button>
      <div id="wizResult" class="wiz-result"></div>
      <h4 class="wiz-sub">${UI.esc(T('gw.sumTitle'))}</h4>
      <p class="hint">${UI.esc(T('gw.sumHint'))}</p>
      <div class="wiz-copy">
        <span class="wiz-copy-label">${UI.esc(T('gw.sumLabel'))}</span>
        <code class="wiz-copy-val wiz-sum" id="wiz_sum">${UI.esc(checklist())}</code>
        <button type="button" class="btn sm" data-copy-from="#wiz_sum">${UI.esc(T('gw.sumCopy'))}</button>
      </div>
      ${wizHelp(T('gw.s6HelpT'), [T('gw.s6H1'), T('gw.s6H2'), T('gw.s6H3'), T('gw.s6H4')])}`
  ];

  // Everything the setup needs on one clipboard — handy when somebody else in
  // the club does the Google half.
  function checklist() {
    return [
      T('gw.fProject') + ': SportTactic',
      T('gw.fApi') + ': Google Drive API',
      T('gw.fAppName') + ': SportTactic',
      T('gw.fSupportMail') + ': ' + (ownerMail || '?'),
      T('gw.fAudience') + ': External',
      T('gw.fTestUsers') + ': ' + (users.join(', ') || '?'),
      T('gw.fClientType') + ': Web application',
      T('gw.fOrigin') + ': ' + (pubOrigin || '?'),
      T('gw.fRedirect') + ': ' + T('gw.fRedirectNone'),
      T('gw.fScope') + ': ' + DRIVE_SCOPE
    ].join('\n');
  }

  function wire(m, host) {
    const mail = host.querySelector('#wiz_mail');
    if (mail) {
      const out = host.querySelector('#wiz_mail_out');
      const check = () => {
        ownerMail = Access.normEmail(mail.value);
        out.textContent = (ownerMail && ownerMail.indexOf('@') > 0) ? ownerMail : '\u2014';
      };
      mail.oninput = check;
      check();
    }
    const org = host.querySelector('#wiz_origin');
    if (org) {
      const st = host.querySelector('#wiz_origin_state');
      const out = host.querySelector('#wiz_origin_out');
      const check = () => {
        const clean = cleanOrigin(org.value);
        pubOrigin = clean;
        out.textContent = clean || '\u2014';
        st.textContent = !org.value.trim() ? T('gw.s4WhereHint')
          : clean ? '\u2713 ' + T('gw.looksRight')
            : T('gw.s4BadOrigin');
        st.className = 'hint ' + (!org.value.trim() ? '' : clean ? 'wiz-good' : 'wiz-bad');
      };
      org.oninput = check;
      org.onpaste = () => setTimeout(check, 0);
      check();
    }
    const id = host.querySelector('#wiz_id');
    if (id) {
      const st = host.querySelector('#wiz_id_state');
      const check = () => {
        clientId = id.value;
        const clean = Drive.normClientId(clientId);
        st.textContent = !clientId.trim() ? T('cloud.clientIdHint')
          : clean ? '\u2713 ' + T('gw.looksRight')
            : T('cloud.badClientId');
        st.className = 'hint ' + (!clientId.trim() ? '' : clean ? 'wiz-good' : 'wiz-bad');
        m.querySelector('[data-next]').disabled = !clean;
      };
      id.oninput = check;
      // A whole line copied out of the console still yields the id itself.
      id.onpaste = () => setTimeout(check, 0);
      check();
    }
    const key = host.querySelector('#wiz_key');
    if (key) {
      const st = host.querySelector('#wiz_key_state');
      const check = () => {
        apiKey = key.value;
        const v = apiKey.trim();
        st.textContent = !v ? T('gw.keyOptional') : API_KEY_RE.test(v) ? '\u2713 ' + T('gw.looksRight') : T('gw.badKey');
        st.className = 'hint ' + (!v ? '' : API_KEY_RE.test(v) ? 'wiz-good' : 'wiz-bad');
        m.querySelector('[data-next]').disabled = !!v && !API_KEY_RE.test(v);
      };
      key.oninput = check;
      check();
    }
    const test = host.querySelector('#wizTest');
    if (test) test.onclick = () => runTest(m, host);
  }

  // Saves what was typed, opens Google, then makes one real Drive call — which
  // is the only way to catch the API being left switched off.
  async function runTest(m, host) {
    const out = host.querySelector('#wizResult');
    const btn = host.querySelector('#wizTest');
    btn.disabled = true;
    out.className = 'wiz-result';
    out.textContent = T('gw.testing');
    try {
      await Drive.setClientId(clientId);
      await TeamCloud.setCfg({ apiKey: apiKey.trim() });
      await Drive.connect();
      await Drive.listFiles("trashed=false and name='__sporttactic_probe__'");
      tested = true;
      out.className = 'wiz-result wiz-good';
      out.innerHTML = `<b>${UI.esc(T('gw.testOk'))}</b><p>${UI.esc(T('gw.testOkTail'))}</p>`;
      m.querySelector('[data-next]').textContent = T('gw.finish');
      if (onDone) onDone();
    } catch (e) {
      out.className = 'wiz-result wiz-bad';
      out.innerHTML = `<b>${UI.esc(T('gw.testFail'))}</b><p>${UI.esc(wizExplain(e))}</p>`;
    } finally { btn.disabled = false; }
  }

  UI.modal({
    title: T('gw.title'),
    width: 680,
    body: `<div class="wiz-top"><span id="wizBar" class="wiz-bar"></span><span class="hint" id="wizStepNo"></span></div>
      <div id="wizBody"></div>`,
    footer: `<button class="btn ghost" data-close2>${T('common.close')}</button>
      <button class="btn" data-back>${T('gw.back')}</button>
      <button class="btn primary" data-next>${T('gw.next')}</button>`,
    onOpen: async (m, close) => {
      clientId = await Drive.getClientId();
      apiKey = TeamCloud.cfg().apiKey;
      ownerMail = await Store.getSetting('ownerEmail', '');
      // Falling back to the first coach or admin already on the access list.
      if (!ownerMail) {
        const staffMember = Access.members().find(x => Access.isStaff(x.role));
        ownerMail = (staffMember && staffMember.email) || '';
      }
      // Copy buttons work the same on every screen, so they are handled once.
      m.addEventListener('click', async e => {
        const b = e.target.closest('[data-copy],[data-copy-from]');
        if (!b) return;
        const src = b.dataset.copyFrom ? m.querySelector(b.dataset.copyFrom) : null;
        const val = src ? src.textContent : b.dataset.copy;
        if (!val || val === '\u2014') return UI.toast(T('gw.nothingToCopy'), 'error');
        const ok = await copyText(val);
        UI.toast(ok ? T('cloud.copied') : T('gw.copyFailed'), ok ? 'success' : 'error');
      });
      m.querySelector('[data-close2]').onclick = async () => {
        // Nothing is lost by closing half-way: what was typed is kept.
        if (clientId.trim()) await Drive.setClientId(clientId);
        if (apiKey.trim()) await TeamCloud.setCfg({ apiKey: apiKey.trim() });
        if (ownerMail) await Store.setSetting('ownerEmail', ownerMail);
        close();
        if (onDone) onDone();
      };
      m.querySelector('[data-back]').onclick = () => { if (step > 0) { step--; body(m); } };
      m.querySelector('[data-next]').onclick = async () => {
        if (step < LAST) { step++; body(m); return; }
        if (clientId.trim()) await Drive.setClientId(clientId);
        if (apiKey.trim()) await TeamCloud.setCfg({ apiKey: apiKey.trim() });
        if (ownerMail) await Store.setSetting('ownerEmail', ownerMail);
        try { localStorage.removeItem(WIZ_STEP_KEY); } catch (e) { /* private mode */ }
        close();
        if (tested) UI.toast(T('cloud.connected'), 'success');
        if (onDone) onDone();
      };
      body(m);
    }
  });
}

// ---- What the team code shares ------------------------------------------
// Three questions per block of data — shared at all, may they change it, may
// they delete from it — plus how the handful of personal fields are treated on
// the way out.
function sharePolicyDialog(onDone) {
  const pol = Privacy.policy();
  const count = g => g.stores.reduce((n, s) => n + (Store.all(s) || []).length, 0);

  const groupRow = g => {
    const r = pol.groups[g.id];
    const n = count(g);
    const off = !pol.contribute;
    return `<div class="pol-row" data-grp="${g.id}">
      <span class="pol-name">${UI.esc(T('pol.g' + g.id))}
        <span class="share-n">${n} ${UI.esc(T('settings.shareRecords'))}</span></span>
      <span class="pol-opts">
        <label class="pol-chk"><input type="checkbox" data-p="share" ${r.share ? 'checked' : ''}> ${UI.esc(T('pol.share'))}</label>
        <label class="pol-chk"><input type="checkbox" data-p="edit" ${r.edit ? 'checked' : ''} ${r.share && !off ? '' : 'disabled'}> ${UI.esc(T('pol.edit'))}</label>
        <label class="pol-chk"><input type="checkbox" data-p="del" ${r.del ? 'checked' : ''} ${r.share && r.edit && !off ? '' : 'disabled'}> ${UI.esc(T('pol.del'))}</label>
      </span>
    </div>`;
  };
  // A live example, so "partial" or "fake" is something you can see rather than
  // a word you have to trust.
  const sample = (f, mode) => {
    const demo = { email: 'anna.nielsen@klub.dk', phone: '+45 20 30 40 50', lastName: 'Nielsen', injuryNote: 'Knee, back in 3 weeks', height: 182, weight: 78, notes: 'Shoulder rehab' }[f.id];
    const v = Privacy.redactValue(demo, f.kind, mode, 7);
    return v === undefined ? T('pol.gone') : String(v);
  };
  const fieldRow = f => {
    const mode = pol.fields[f.id];
    return `<div class="pol-row" data-fld="${f.id}">
      <span class="pol-name">${UI.esc(T('pol.f' + f.id))}
        <span class="share-n">${UI.esc(f.stores.map(s => T('pol.g' + (Privacy.groupOf(s) || {}).id)).filter((v, i, a) => a.indexOf(v) === i).join(', '))}</span></span>
      <span class="pol-opts">
        <select data-mode>${Privacy.MODES.map(m => `<option value="${m}" ${m === mode ? 'selected' : ''}>${UI.esc(T('pol.m' + m))}</option>`).join('')}</select>
        <code class="pol-sample">${UI.esc(sample(f, mode))}</code>
      </span>
    </div>`;
  };

  UI.modal({
    title: T('pol.title'),
    width: 720,
    body: `<p>${UI.esc(T('pol.intro'))}</p>
      <div class="callout-warn">${UI.esc(T('pol.warn'))}</div>
      <h4 class="pol-h">${UI.esc(T('pol.twoWay'))}</h4>
      <label class="check-row"><input type="checkbox" id="polContrib" ${pol.contribute ? 'checked' : ''}>
        <span>${UI.esc(T('pol.contribute'))}</span></label>
      <p class="hint">${UI.esc(T('pol.contributeHint'))}</p>
      <p class="hint">${UI.esc(T('pol.contributeNeeds'))}</p>
      <h4 class="pol-h">${UI.esc(T('pol.blocks'))}</h4>
      <p class="hint">${UI.esc(T('pol.blocksHint'))}</p>
      ${Privacy.GROUPS.map(groupRow).join('')}
      <h4 class="pol-h">${UI.esc(T('pol.personal'))}</h4>
      <p class="hint">${UI.esc(T('pol.personalHint'))}</p>
      ${Privacy.FIELDS.map(fieldRow).join('')}
      <p class="hint">${UI.esc(T('pol.never'))}</p>
      <p class="hint" id="polSum"></p>`,
    footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button>
      <button class="btn" data-reset>${UI.esc(T('pol.reset'))}</button>
      <button class="btn primary" data-go>${T('common.save')}</button>`,
    onOpen: (m, close) => {
      const sum = () => {
        const s = Privacy.summary(pol);
        m.querySelector('#polSum').textContent = T('pol.summary')
          .replace('{0}', s.blocks).replace('{1}', s.totalBlocks)
          .replace('{2}', s.records).replace('{3}', s.hidden);
      };
      m.querySelectorAll('[data-grp]').forEach(row => {
        const g = row.dataset.grp;
        row.querySelectorAll('input[data-p]').forEach(box => box.onchange = () => {
          pol.groups[g][box.dataset.p] = box.checked;
          // Edit needs sharing; delete needs edit.
          if (!pol.groups[g].share) { pol.groups[g].edit = false; pol.groups[g].del = false; }
          if (!pol.groups[g].edit) pol.groups[g].del = false;
          row.querySelector('[data-p="edit"]').checked = pol.groups[g].edit;
          row.querySelector('[data-p="edit"]').disabled = !pol.groups[g].share || !pol.contribute;
          row.querySelector('[data-p="del"]').checked = pol.groups[g].del;
          row.querySelector('[data-p="del"]').disabled = !pol.groups[g].edit || !pol.contribute;
          sum();
        });
      });
      // Nothing may come back at all until this is on, so the per-block Edit and
      // Delete ticks are meaningless without it and are shown as such.
      const contrib = m.querySelector('#polContrib');
      const syncContrib = () => {
        pol.contribute = contrib.checked;
        m.querySelectorAll('[data-grp]').forEach(row => {
          const g = pol.groups[row.dataset.grp];
          row.querySelector('[data-p="edit"]').disabled = !g.share || !pol.contribute;
          row.querySelector('[data-p="del"]').disabled = !g.edit || !pol.contribute;
        });
      };
      contrib.onchange = syncContrib;
      m.querySelectorAll('[data-fld]').forEach(row => {
        const f = Privacy.FIELDS.find(x => x.id === row.dataset.fld);
        const sel = row.querySelector('[data-mode]');
        sel.onchange = () => {
          pol.fields[f.id] = sel.value;
          row.querySelector('.pol-sample').textContent = sample(f, sel.value);
          sum();
        };
      });
      sum();
      m.querySelector('[data-close2]').onclick = close;
      m.querySelector('[data-reset]').onclick = async () => {
        await Privacy.reset();
        close();
        UI.toast(T('pol.savedMsg'), 'success');
        sharePolicyDialog(onDone);
      };
      m.querySelector('[data-go]').onclick = async () => {
        if (sharingLocked()) { UI.toast(T('mem.blocked'), 'error'); return; }
        await Privacy.save(pol);
        const sent = await pushShareChange();
        close();
        UI.toast(T('pol.savedMsg'), 'success');
        if (!sent) UI.toast(T('mem.pushFailed'), 'error');
        if (onDone) onDone();
      };
    }
  });
}

// ---- What a copy made with the team code may do --------------------------
// The other half of handing out a code: the policy above decides what a player
// may SEE, this decides what they may DO with it and which modules are even on
// their menu. It is saved with the shared file, so it reaches every device that
// joined without anybody having to be told anything.

// Which shared blocks a module has to have before it shows anything. The
// player's own health and max tests are not here: that block stays off until
// the coach turns it on deliberately.
const AREA_BLOCKS = {
  dashboard: ['squad', 'matches'], teams: ['squad'], matches: ['matches'],
  planner: ['planner'], scouting: ['squad', 'matches'], statistics: ['squad', 'matches'],
  tactics: ['tactics'], video: ['video'], training: ['training'],
  opponents: ['opponents'], reports: ['reports']
};
// Leaving a module on a joined copy's menu is a promise that there is something
// in it, so the blocks it reads are shared with it.
async function shareForAreas(routes) {
  const p = Privacy.policy();
  let opened = 0;
  (routes || []).forEach(r => (AREA_BLOCKS[r] || []).forEach(g => {
    if (p.groups[g] && !p.groups[g].share) { p.groups[g].share = true; opened++; }
  }));
  if (opened) await Privacy.save(p);
  return opened;
}
// A module/policy change only reaches a joined copy on its next sync — which
// for most devices is a manual button press, so a coach who ticks "Event
// Planner" here and closes the dialog would otherwise see nothing change
// until they remembered to press Sync. Push it now, the same way a fresh set
// of role passwords already does, and say so if it could not go out.
async function pushShareChange() {
  if (!(window.TeamCloud && TeamCloud.isLinked() && window.Access && Access.can('cloud.write'))) return true;
  try {
    if (!TeamCloud.signedIn()) await Drive.connect();
    await TeamCloud.push('merge');
    return true;
  } catch (e) { return false; }
}
// A device that itself joined somebody else's file with no more than a
// read-only player role is not allowed to change what that file shares — the
// write is refused deep inside Store.save (see access.js's FIXED_SETTINGS) —
// but nothing before this used to check that first, so the dialog closed with
// a "saved" toast while nothing had actually changed. Checked up front so the
// coach is told why instead of being left to wonder.
function sharingLocked() { return !!(window.Access && Access.readMode()); }
function memberLabel() {
  const p = Access.profile();
  if (!p.readOnly) return T('mem.stateFull');
  const shown = App.ROUTES.filter(r => p.hide.indexOf(r) < 0).length;
  return T('mem.stateRead').replace('{0}', shown).replace('{1}', App.ROUTES.length);
}
function memberModeDialog(onDone) {
  const p = Access.profile();
  const open = Access.OPEN_ROUTES.map(r => T('nav.' + r)).join(', ');
  // A profile saved by an earlier build has no coach list at all.
  const coachHide = Array.isArray(p.coachHide) ? p.coachHide : [];
  const moduleRow = r => `<label class="check-row menu-row">
    <input type="checkbox" data-mod="${r}" ${p.hide.indexOf(r) < 0 || r === 'settings' ? 'checked' : ''} ${r === 'settings' ? 'disabled' : ''}>
    <span>${UI.esc(T('nav.' + r))}${r === 'settings' ? ` <span class="tag">${T('settings.menuAlways')}</span>` : ''}</span>
  </label>`;
  const coachRow = r => `<label class="check-row menu-row">
    <input type="checkbox" data-cmod="${r}" ${coachHide.indexOf(r) < 0 || r === 'settings' ? 'checked' : ''} ${r === 'settings' ? 'disabled' : ''}>
    <span>${UI.esc(T('nav.' + r))}${r === 'settings' ? ` <span class="tag">${T('settings.menuAlways')}</span>` : ''}</span>
  </label>`;
  // Every squad the club has, not only the ones of the sport on screen: a
  // squad left out here is left out of the file whichever sport it belongs to.
  const squads = Store.all('teams');
  const picked = Privacy.sharedTeams();
  const squadRow = t => `<label class="check-row menu-row">
    <input type="checkbox" data-team="${UI.esc(t.id)}" ${!picked || picked.has(t.id) ? 'checked' : ''}>
    <span>${UI.esc(t.name || t.id)}</span>
  </label>`;

  UI.modal({
    title: T('mem.title'),
    width: 640,
    body: `<p>${UI.esc(T('mem.intro'))}</p>
      <label class="check-row"><input type="checkbox" id="mm_read" ${p.readOnly ? 'checked' : ''}>
        <span>${UI.esc(T('mem.readOnly'))}<span class="share-n">${UI.esc(T('mem.readOnlyHint'))}</span></span></label>
      <label class="check-row"><input type="checkbox" id="mm_train" ${p.training ? 'checked' : ''} ${p.readOnly ? '' : 'disabled'}>
        <span>${UI.esc(T('mem.training').replace('{0}', open))}<span class="share-n">${UI.esc(T('mem.trainingHint'))}</span></span></label>
      <h4 class="pol-h">${UI.esc(T('mem.modules'))}</h4>
      <p class="hint">${UI.esc(T('mem.modulesHint'))}</p>
      <div class="menu-picker">${App.ROUTES.map(moduleRow).join('')}</div>
      <div class="row" style="flex:0;margin-top:10px;flex-wrap:wrap">
        <button type="button" class="btn sm" id="mm_all">${UI.esc(T('settings.shareAll'))}</button>
        <button type="button" class="btn sm" id="mm_min">${UI.esc(T('mem.modMin'))}</button>
      </div>
      <h4 class="pol-h">${UI.esc(T('mem.coachModules'))}</h4>
      <p class="hint">${UI.esc(T('mem.coachModulesHint'))}</p>
      <div class="menu-picker">${App.ROUTES.map(coachRow).join('')}</div>
      <div class="row" style="flex:0;margin-top:10px;flex-wrap:wrap">
        <button type="button" class="btn sm" id="mc_all">${UI.esc(T('settings.shareAll'))}</button>
        <button type="button" class="btn sm" id="mc_min">${UI.esc(T('mem.coachModMin'))}</button>
      </div>
      <h4 class="pol-h">${UI.esc(T('mem.teams'))}</h4>
      <p class="hint">${UI.esc(T('mem.teamsHint'))}</p>
      ${squads.length ? `<div class="menu-picker">${squads.map(squadRow).join('')}</div>
      <div class="row" style="flex:0;margin-top:10px;flex-wrap:wrap">
        <button type="button" class="btn sm" id="mm_tall">${UI.esc(T('mem.teamsAll'))}</button>
      </div>` : `<p class="hint">${UI.esc(T('mem.teamsNone'))}</p>`}
      <p class="hint">${UI.esc(T('mem.note'))}</p>`,
    footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button>
      <button class="btn primary" data-go>${T('common.save')}</button>`,
    onOpen: (m, close) => {
      const read = m.querySelector('#mm_read');
      const train = m.querySelector('#mm_train');
      const boxes = [...m.querySelectorAll('[data-mod]')];
      // The exception only means anything while the copy is read-only.
      read.onchange = () => { train.disabled = !read.checked; };
      const pick = keep => boxes.forEach(b => {
        if (b.disabled) return;
        b.checked = keep.indexOf(b.dataset.mod) >= 0;
      });
      m.querySelector('#mm_all').onclick = () => pick(App.ROUTES);
      // What a player actually opens the app for.
      m.querySelector('#mm_min').onclick = () => pick(['dashboard', 'training', 'matches', 'planner', 'statistics']);
      const cboxes = [...m.querySelectorAll('[data-cmod]')];
      const cpick = keep => cboxes.forEach(b => {
        if (b.disabled) return;
        b.checked = keep.indexOf(b.dataset.cmod) >= 0;
      });
      m.querySelector('#mc_all').onclick = () => cpick(App.ROUTES);
      // What a squad coach runs their own training week on.
      m.querySelector('#mc_min').onclick = () => cpick(['dashboard', 'teams', 'matches', 'planner', 'training', 'tactics']);
      const tboxes = [...m.querySelectorAll('[data-team]')];
      const tall = m.querySelector('#mm_tall');
      if (tall) tall.onclick = () => tboxes.forEach(b => { b.checked = true; });
      m.querySelector('[data-close2]').onclick = close;
      m.querySelector('[data-go]').onclick = async () => {
        if (sharingLocked()) { UI.toast(T('mem.blocked'), 'error'); return; }
        try {
          await Access.saveProfile({
            readOnly: read.checked,
            training: train.checked,
            hide: boxes.filter(b => !b.checked).map(b => b.dataset.mod),
            coachHide: cboxes.filter(b => !b.checked).map(b => b.dataset.cmod)
          });
          if (tboxes.length) {
            const on = tboxes.filter(b => b.checked).map(b => b.dataset.team);
            const pol = Privacy.policy();
            // All of them ticked means every squad, including one added later.
            pol.teams = on.length === tboxes.length ? null : on;
            await Privacy.save(pol);
          }
          // A module left on their menu is worth nothing without the data behind it.
          const opened = await shareForAreas(
            boxes.filter(b => b.checked).map(b => b.dataset.mod)
              .concat(cboxes.filter(b => b.checked).map(b => b.dataset.cmod)));
          const sent = await pushShareChange();
          close();
          UI.toast(T('mem.saved'), 'success');
          if (opened) UI.toast(T('pol.opened').replace('{0}', opened), 'success');
          if (!sent) UI.toast(T('mem.pushFailed'), 'error');
          App.applyMemberMode();
          if (onDone) onDone();
        } catch (e) {
          UI.toast(String((e && e.message) || e).slice(0, 200), 'error');
        }
      };
    }
  });
}

// ---- Role passwords ------------------------------------------------------
// The team code says WHICH database; one of these words says what the device
// that pasted it is allowed to be. Only the hashes travel in the shared file,
// so this screen is the one place the readable words exist.

// The areas one squad's coach gets, set where that squad's word is handed out.
// Saved with the shared file, so it reaches their device on the next sync.
function coachAreasDialog(teamId, name, onDone) {
  const hide = Access.coachHidden(teamId);
  const areaRow = r => `<label class="check-row menu-row">
    <input type="checkbox" data-cmod="${r}" ${hide.indexOf(r) < 0 || r === 'settings' ? 'checked' : ''} ${r === 'settings' ? 'disabled' : ''}>
    <span>${UI.esc(T('nav.' + r))}${r === 'settings' ? ` <span class="tag">${T('settings.menuAlways')}</span>` : ''}</span>
  </label>`;
  UI.modal({
    title: T('mem.coachAreasTitle').replace('{0}', name || ''),
    width: 560,
    body: `<p>${UI.esc(T('mem.coachAreasIntro'))}</p>
      <div class="menu-picker">${App.ROUTES.map(areaRow).join('')}</div>
      <div class="row" style="flex:0;margin-top:10px;flex-wrap:wrap">
        <button type="button" class="btn sm" id="ca_all">${UI.esc(T('settings.shareAll'))}</button>
        <button type="button" class="btn sm" id="ca_min">${UI.esc(T('mem.coachModMin'))}</button>
      </div>
      <p class="hint">${UI.esc(T('mem.note'))}</p>`,
    footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button>
      <button class="btn primary" data-go>${T('common.save')}</button>`,
    onOpen: (m, close) => {
      const boxes = [...m.querySelectorAll('[data-cmod]')];
      const pick = keep => boxes.forEach(b => {
        if (b.disabled) return;
        b.checked = keep.indexOf(b.dataset.cmod) >= 0;
      });
      m.querySelector('#ca_all').onclick = () => pick(App.ROUTES);
      m.querySelector('#ca_min').onclick = () => pick(['dashboard', 'teams', 'matches', 'planner', 'training', 'tactics']);
      m.querySelector('[data-close2]').onclick = close;
      m.querySelector('[data-go]').onclick = async () => {
        if (sharingLocked()) { UI.toast(T('mem.blocked'), 'error'); return; }
        try {
          await Access.saveCoachAreas(teamId, boxes.filter(b => !b.checked).map(b => b.dataset.cmod));
          const opened = await shareForAreas(boxes.filter(b => b.checked).map(b => b.dataset.cmod));
          const sent = await pushShareChange();
          close();
          UI.toast(T('mem.saved'), 'success');
          if (opened) UI.toast(T('pol.opened').replace('{0}', opened), 'success');
          if (!sent) UI.toast(T('mem.pushFailed'), 'error');
          App.applyMemberMode();
          if (onDone) onDone();
        } catch (e) {
          UI.toast(String((e && e.message) || e).slice(0, 200), 'error');
        }
      };
    }
  });
}

async function roleKeysDialog(onDone) {
  // A squad added since the words were made gets one of its own first.
  try { await Access.ensureTeamKeys(); } catch (e) { /* not this device's set */ }
  const words = Access.roleKeyWords();
  const keys = Access.roleKeys();
  const made = !!keys;
  const stale = Access.wordsStale();
  const code = TeamCloud.makeCode();
  const link = location.origin + location.pathname;
  // Two words per squad — one for its coaches, one for its players — then the
  // three club-wide staff words.
  const teamRows = [];
  if (keys) {
    Object.keys(keys.teams || {}).forEach(id => {
      const name = (keys.teams[id] || {}).name || id;
      if ((keys.teams[id] || {}).coachHash) {
        teamRows.push({
          key: 'coach:' + id, teamId: id, role: 'Coach',
          label: Access.label('Coach') + ' \u00b7 ' + name, sub: T('rk.forSquadCoach')
        });
      }
      teamRows.push({
        key: 'team:' + id, teamId: id, role: 'Player',
        label: Access.label('Player') + ' \u00b7 ' + name, sub: T('rk.forPlayer')
      });
    });
  }
  const rows = teamRows.concat(Access.STAFF_ROLES.map(r => ({
    key: r, role: r, label: Access.label(r), sub: T('rk.for' + r.replace(/\s/g, ''))
  })));
  const row = r => `<div class="pol-row" data-key="${UI.esc(r.key)}">
    <span class="pol-name">${UI.esc(r.label)}
      <span class="share-n">${UI.esc(r.sub)}</span></span>
    <span class="pol-opts">
      ${r.role === 'Coach' && r.teamId && Access.can('cloud.setup')
      ? `<button type="button" class="btn sm" data-areas="${UI.esc(r.teamId)}">${UI.esc(T('mem.coachAreas'))}</button>` : ''}
      ${words[r.key] && !stale
      ? `<code class="pol-sample rk-word">${UI.esc(words[r.key])}</code>
         <button type="button" class="btn sm" data-copy="${UI.esc(r.key)}">${UI.esc(T('cloud.copy'))}</button>
         <button type="button" class="btn sm" data-mail="${UI.esc(r.key)}">${UI.esc(T('cloud.mailCode'))}</button>`
      : `<span class="hint">${UI.esc(T(stale ? 'rk.stale' : made ? 'rk.elsewhere' : 'rk.none'))}</span>`}
    </span>
  </div>`;
  // Each squad's word goes to that squad's own people; a club-wide staff word
  // to those who already hold that role on the access list.
  const mailTo = r => (r.teamId
    ? (r.role === 'Coach'
      ? Store.all('coaches').filter(c => c.teamId === r.teamId).map(c => c.email)
      : Store.all('players').filter(p => p.teamId === r.teamId).map(p => p.email))
    : Access.members().filter(x => x.role === r.role).map(x => x.email)).filter(Boolean).join(',');

  UI.modal({
    title: T('rk.title'),
    width: 720,
    body: `<p>${UI.esc(T('rk.intro'))}</p>
      <div class="callout-warn">${UI.esc(T(stale ? 'rk.staleWarn' : 'rk.warn'))}</div>
      ${rows.map(row).join('')}
      <p class="hint">${UI.esc(T('rk.teamNote'))}</p>
      <p class="hint">${UI.esc(T('rk.note'))}</p>
      <p class="hint">${UI.esc(T('rk.codeNote'))}</p>
      <p class="hint">${UI.esc(T('rk.storeHint'))}</p>`,
    footer: `<button class="btn ghost" data-close2>${T('common.close')}</button>
      ${Access.can('cloud.setup') ? `<button class="btn ${made && !stale ? '' : 'primary'}" data-new>${UI.esc(T(made ? 'rk.again' : 'rk.make'))}</button>` : ''}`,
    onOpen: (m, close) => {
      m.querySelector('[data-close2]').onclick = close;
      // Which squad a coach gets is the word you hand out; this is which areas
      // of it they get once they are in.
      m.querySelectorAll('[data-areas]').forEach(b => b.onclick = () => {
        const r = rows.find(x => x.teamId === b.dataset.areas && x.role === 'Coach');
        coachAreasDialog(b.dataset.areas, r ? r.label : '');
      });
      m.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => {
        const w = words[b.dataset.copy] || '';
        try { await navigator.clipboard.writeText(w); } catch (e) { /* no clipboard permission */ }
        UI.toast(T('cloud.copied'), 'success');
      });
      // Straight into the coach's own mail app, addressed to the squad the word
      // belongs to, or to the people who hold that role on the access list.
      m.querySelectorAll('[data-mail]').forEach(b => b.onclick = () => {
        const r = rows.find(x => x.key === b.dataset.mail);
        if (!r) return;
        const body = T('rk.mailBody')
          .replace('{0}', r.label).replace('{1}', code)
          .replace('{2}', words[r.key] || '').replace('{3}', link);
        location.href = 'mailto:' + encodeURIComponent(mailTo(r))
          + '?subject=' + encodeURIComponent(T('rk.mailSubject'))
          + '&body=' + encodeURIComponent(body);
      });
      const btn = m.querySelector('[data-new]');
      if (btn) btn.onclick = () => {
        const go = async () => {
          btn.disabled = true;
          try { await Access.newRoleKeys(); }
          catch (e) { btn.disabled = false; return UI.toast(T('rk.noCrypto'), 'error'); }
          // The hashes have to reach the shared file before the words are handed
          // out, or a device that syncs before it joins checks against the
          // previous set. Signing in here is fine: this is a button press.
          let sent = true;
          if (TeamCloud.isLinked() && Access.can('cloud.write')) {
            try {
              if (!TeamCloud.signedIn()) await Drive.connect();
              await TeamCloud.push('merge');
            } catch (e) { sent = false; }
          }
          close();
          UI.toast(T('rk.made'), 'success');
          if (!sent) UI.toast(T('rk.pushFailed'), 'error');
          roleKeysDialog(onDone);
          if (onDone) onDone();
        };
        if (made) UI.confirm(T('rk.againAsk'), go); else go();
      };
    }
  });
}

// Owner path: name the team, build the file, hand back the code.
function cloudCreateDialog(onDone) {
  const team = Store.activeTeam();
  UI.modal({
    title: T('cloud.createTitle'),
    width: 620,
    body: `<p>${UI.esc(T('cloud.createIntro'))}</p>
      <label class="field"><span>${UI.esc(T('cloud.teamName'))}</span>
        <input id="cl_name" maxlength="60" value="${UI.esc((team && team.name) || TeamCloud.cfg().teamName || '')}"></label>
      <label class="check-row"><input type="checkbox" id="cl_link" checked>
        <span>${UI.esc(T('cloud.linkShare'))}<span class="share-n">${UI.esc(T('cloud.linkShareHint'))}</span></span></label>
      <label class="field"><span>${UI.esc(T('cloud.apiKey'))}</span>
        <input id="cl_key" spellcheck="false" autocomplete="off" placeholder="AIza…" value="${UI.esc(TeamCloud.cfg().apiKey || '')}">
        <span class="hint">${UI.esc(T('cloud.apiKeyWhy'))}</span></label>
      <p class="hint warn" id="cl_keywarn"></p>
      <p class="hint" id="cl_state"></p>`,
    footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button>
      <button class="btn primary" data-go>${UI.esc(T('cloud.createBtn'))}</button>`,
    onOpen: (m, close) => {
      const state = m.querySelector('#cl_state');
      const key = m.querySelector('#cl_key');
      const warn = m.querySelector('#cl_keywarn');
      // Said before the file exists, not after the code has been handed out:
      // without a key every player needs a Google account of their own.
      const keyState = () => {
        const v = key.value.trim();
        warn.textContent = !v ? T('cloud.apiKeyMissing')
          : API_KEY_RE.test(v) ? '' : T('cloud.apiKeyBad');
      };
      key.oninput = keyState;
      keyState();
      m.querySelector('[data-close2]').onclick = close;
      const go = m.querySelector('[data-go]');
      go.onclick = async () => {
        go.disabled = true;
        state.textContent = T('cloud.working');
        try {
          if (!Drive.isConnected()) await Drive.connect();
          // Made before the file is written, so the hashes are in it from the
          // first byte. A browser without WebCrypto simply gets no passwords.
          try { if (!Access.roleKeys()) await Access.newRoleKeys(); } catch (e) { /* no crypto here */ }
          await TeamCloud.createShared(m.querySelector('#cl_name').value.trim(), {
            linkShare: m.querySelector('#cl_link').checked,
            apiKey: key.value.trim()
          });
          close();
          UI.toast(T('cloud.created'), 'success');
          if (onDone) onDone();
          cloudCodeDialog();
        } catch (e) {
          state.textContent = String((e && e.message) || e).slice(0, 220);
        } finally { go.disabled = false; }
      };
    }
  });
}

// The screen the coach reads their code off, and the one a member pastes into.
async function cloudCodeDialog() {
  // A code is never handed out without the passwords it is checked against, so
  // a database made before they existed gets a set the first time it is shown.
  if (!Access.roleKeys() && Access.can('cloud.setup')) {
    try { await Access.newRoleKeys(); } catch (e) { /* no WebCrypto on this origin */ }
  }
  try { await Access.ensureTeamKeys(); } catch (e) { /* not this device's set */ }
  const code = TeamCloud.makeCode();
  const c = TeamCloud.cfg();
  const s = Privacy.summary();
  UI.modal({
    title: T('cloud.codeTitle'),
    width: 620,
    body: `<p>${UI.esc(T('cloud.codeIntro'))}</p>
      <label class="field"><span>${UI.esc(T('cloud.code'))}</span>
        <textarea id="cd_code" rows="3" readonly spellcheck="false">${UI.esc(code)}</textarea></label>
      <p><span class="tag">${UI.esc(T('pol.summary')
        .replace('{0}', s.blocks).replace('{1}', s.totalBlocks)
        .replace('{2}', s.records).replace('{3}', s.hidden))}</span>
        <button type="button" class="btn sm" id="cd_pol">${UI.esc(T('pol.btn'))}</button></p>
      <p><span class="tag ${Access.profile().readOnly ? 'green' : ''}" id="cd_memstate">${UI.esc(memberLabel())}</span>
        <button type="button" class="btn sm" id="cd_mem">${UI.esc(T('mem.btn'))}</button></p>
      <p><span class="tag ${Access.roleKeys() ? 'green' : ''}">${UI.esc(T(Access.roleKeys() ? 'rk.on' : 'rk.off'))}</span>
        ${Access.can('cloud.setup') ? `<button type="button" class="btn sm" id="cd_keys">${UI.esc(T('rk.btn'))}</button>` : ''}</p>
      ${c.apiKey ? '' : `<p class="hint mail-note">${UI.esc(T('cloud.codeNoKey'))}</p>`}
      <p class="hint">${UI.esc(T('cloud.codeHint'))}</p>`,
    footer: `<button class="btn" data-mail>${UI.esc(T('cloud.mailCode'))}</button>
      <button class="btn primary" data-copy>${UI.esc(T('cloud.copy'))}</button>
      <button class="btn ghost" data-close2>${T('common.close')}</button>`,
    onOpen: (m, close) => {
      const ta = m.querySelector('#cd_code');
      m.querySelector('[data-close2]').onclick = close;
      m.querySelector('#cd_pol').onclick = () => { close(); sharePolicyDialog(); };
      m.querySelector('#cd_mem').onclick = () => { close(); memberModeDialog(() => cloudCodeDialog()); };
      const keysBtn = m.querySelector('#cd_keys');
      if (keysBtn) keysBtn.onclick = () => { close(); roleKeysDialog(); };
      m.querySelector('[data-copy]').onclick = async () => {
        ta.select();
        try { await navigator.clipboard.writeText(code); } catch (e) { document.execCommand('copy'); }
        UI.toast(T('cloud.copied'), 'success');
      };
      m.querySelector('[data-mail]').onclick = () => {
        const body = T('cloud.mailBody').replace('{0}', c.teamName || '').replace('{1}', code).replace('{2}', location.origin + location.pathname);
        location.href = 'mailto:?subject=' + encodeURIComponent(T('cloud.mailSubject')) + '&body=' + encodeURIComponent(body);
      };
    }
  });
}

function cloudJoinDialog(onDone) {
  UI.modal({
    title: T('cloud.joinTitle'),
    width: 620,
    body: `<p>${UI.esc(T('cloud.joinIntro'))}</p>
      <label class="field"><span>${UI.esc(T('cloud.code'))}</span>
        <textarea id="jn_code" rows="3" spellcheck="false" placeholder="STX1-…"></textarea>
        <span class="hint">${UI.esc(T('cloud.joinHint'))}</span></label>
      <label class="field"><span>${UI.esc(T('rk.field'))}</span>
        <input id="jn_pw" spellcheck="false" autocomplete="off" placeholder="ABCD-EFGH-JK">
        <span class="hint">${UI.esc(T('rk.fieldHint'))}</span></label>
      <p class="hint" id="jn_state"></p>`,
    footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button>
      <button class="btn primary" data-go>${UI.esc(T('cloud.joinBtn'))}</button>`,
    onOpen: (m, close) => {
      const inp = m.querySelector('#jn_code');
      const state = m.querySelector('#jn_state');
      inp.focus();
      m.querySelector('[data-close2]').onclick = close;
      const go = m.querySelector('[data-go]');
      go.onclick = async () => {
        if (!TeamCloud.parseTarget(inp.value)) { state.textContent = T('cloud.badCode'); return; }
        go.disabled = true;
        state.textContent = T('cloud.working');
        try {
          const pw = m.querySelector('#jn_pw').value.trim();
          const n = await TeamCloud.join(inp.value);
          // The pull brought the club's password hashes with it, so the word can
          // be checked here. No word, or the wrong one, and this copy reads.
          const got = await Access.claimRole(pw);
          close();
          UI.toast(T('cloud.joined').replace('{0}', n), 'success');
          if (got) UI.toast(T('rk.joinedAs').replace('{0}', Access.label(got)), 'success');
          else if (Access.roleKeys()) UI.toast(T(pw ? 'rk.wrong' : 'rk.noneGiven'), 'error');
          else if (pw) UI.toast(T('rk.noKeys'), 'error');
          const rb = document.getElementById('roleBadge');
          if (rb) rb.textContent = T('role.' + Access.role());
          App.applyMemberMode();
          const squad = await attachJoinedSquad();
          if (squad) UI.toast(T('cloud.squadAttached').replace('{0}', squad.name || ''), 'success');
          if (onDone) onDone();
          offerDriveConnect();
        } catch (e) {
          state.textContent = T('cloud.joinFailed') + ' ' + String((e && e.message) || e).slice(0, 180);
          // A club that shares with named people instead of a link hands out a
          // code that cannot open anything on its own. The sign-in is offered
          // here, on the attempt that just failed, and the code tried again.
          if (!TeamCloud.canSyncQuietly() && window.Drive && !Drive.isConnected() && await Drive.isConfigured()) {
            UI.confirm(T('cloud.connectNeeded'), async () => {
              try {
                await Drive.connect();
                UI.toast(T('cloud.connected'), 'success');
                go.click();
              } catch (err) {
                UI.toast(T('cloud.connectFailed') + ' — ' + String((err && err.message) || err).slice(0, 160), 'error');
              }
            });
          }
        } finally { go.disabled = false; }
      };
    }
  });
}

// Lets a signed-in owner pick a team folder this Google account already made
// on Drive back up — the fix for "browser got reset, still have the account".
function cloudReconnectDialog(onDone) {
  const state0 = { busy: true, folders: [] };
  const row = f => `<label class="check-row"><input type="radio" name="rc_pick" value="${UI.esc(f.id)}">
    <span>${UI.esc(f.name)}</span></label>`;
  const modal = UI.modal({
    title: T('cloud.reconnectTitle'),
    width: 620,
    body: `<p>${UI.esc(T('cloud.reconnectIntro'))}</p>
      <div id="rc_list"><p class="hint">${UI.esc(T('cloud.working'))}</p></div>
      <p class="hint" id="rc_state"></p>`,
    footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button>
      <button class="btn primary" data-go disabled>${UI.esc(T('cloud.reconnectBtn'))}</button>`,
    onOpen: async (m, close) => {
      const list = m.querySelector('#rc_list');
      const state = m.querySelector('#rc_state');
      const go = m.querySelector('[data-go]');
      m.querySelector('[data-close2]').onclick = close;
      try {
        state0.folders = await TeamCloud.listExisting();
      } catch (e) {
        list.innerHTML = `<p class="hint warn">${UI.esc(String((e && e.message) || e).slice(0, 200))}</p>`;
        return;
      } finally { state0.busy = false; }
      if (!state0.folders.length) {
        list.innerHTML = `<p class="hint">${UI.esc(T('cloud.reconnectNone'))}</p>`;
        return;
      }
      list.innerHTML = state0.folders.map(row).join('');
      list.querySelectorAll('input[name="rc_pick"]').forEach(r => r.onchange = () => { go.disabled = false; });
      go.onclick = async () => {
        const picked = m.querySelector('input[name="rc_pick"]:checked');
        if (!picked) return;
        const folder = state0.folders.find(f => f.id === picked.value);
        go.disabled = true;
        state.textContent = T('cloud.working');
        try {
          const n = await TeamCloud.reconnectShared(folder);
          close();
          UI.toast(T('cloud.reconnected').replace('{0}', n), 'success');
          if (onDone) onDone();
        } catch (e) {
          state.textContent = e && e.message === 'no-database'
            ? T('cloud.reconnectBad')
            : String((e && e.message) || e).slice(0, 200);
        } finally { go.disabled = false; }
      };
    }
  });
  return modal;
}

// A code that carries the club's read key opens the file with no Google account
// at all. Without that key the file can only be opened by signing in, so a
// player who is never asked simply never gets the coach's work. Both cases are
// offered here, while the click that opened the popup is still theirs.
async function offerDriveConnect() {
  if (!window.Drive || Drive.isConnected()) return;
  if (!(await Drive.isConfigured())) return;
  const needed = !TeamCloud.canSyncQuietly();
  UI.confirm(T(needed ? 'cloud.connectNeeded' : 'cloud.connectAsk'), async () => {
    try {
      await Drive.connect();
      UI.toast(T('cloud.connected'), 'success');
      // Signing in is what made the file readable, so fetch it now rather than
      // leaving the player on an empty screen until the timer comes round.
      TeamCloud.start();
      if (needed) await TeamCloud.pull('merge');
    } catch (e) {
      UI.toast(T('cloud.connectFailed') + ' — ' + String((e && e.message) || e).slice(0, 160), 'error');
    }
  });
}

// Which squad this copy works with is the club's call, not the joining device's:
// a squad word narrows Store.teams() to that one squad, so the copy simply
// opens on what is left instead of being asked.
async function attachJoinedSquad() {
  const teams = Store.teams();
  const pick = teams.length === 1 ? teams[0] : null;
  if (pick) Store.setActiveTeam(pick.id);
  // Whatever this device had trimmed off its own sidebar is not a decision about
  // the club it just joined — the club's own lists are what count now.
  App.setMenuHidden([]);
  // Now that the squad is settled, anything that came down without one joins it
  // rather than staying on the device and on no screen.
  await Store.adoptUnscoped();
  App.populateTeamPicker();
  return pick;
}

// Sends the Drive invitations. Everyone on the access list is offered; the
// role they hold there decides whether they may write to the file.
function cloudInviteDialog(onDone) {
  const list = Access.members();
  const row = m => `<label class="check-row share-row">
    <input type="checkbox" data-inv="${UI.esc(m.id)}" checked>
    <span>${UI.esc(m.name || m.email)}
      <span class="tag">${UI.esc(Access.label(m.role))}</span>
      <span class="tag ${Access.driveRole(m.role) === 'writer' ? 'green' : ''}">${UI.esc(T('cloud.drive' + (Access.driveRole(m.role) === 'writer' ? 'Editor' : 'Viewer')))}</span>
      <span class="share-n">${UI.esc(m.email)}${m.invitedAt ? ' · ' + UI.esc(T('cloud.invitedAt')) + ' ' + UI.esc(fmtWhen(m.invitedAt)) : ''}</span>
    </span></label>`;
  UI.modal({
    title: T('cloud.inviteTitle'),
    width: 620,
    body: `<p>${UI.esc(T('cloud.inviteIntro'))}</p>
      ${list.length ? list.map(row).join('') : `<p class="hint">${UI.esc(T('access.none'))}</p>`}
      <p class="hint" id="iv_state"></p>`,
    footer: `<button class="btn ghost" data-close2>${T('common.close')}</button>
      <button class="btn primary" data-go ${list.length ? '' : 'disabled'}>${UI.esc(T('cloud.inviteBtn'))}</button>`,
    onOpen: (m, close) => {
      const state = m.querySelector('#iv_state');
      m.querySelector('[data-close2]').onclick = close;
      const go = m.querySelector('[data-go]');
      go.onclick = async () => {
        const picked = list.filter(x => { const b = m.querySelector(`[data-inv="${CSS.escape(x.id)}"]`); return b && b.checked; });
        if (!picked.length) return;
        go.disabled = true;
        state.textContent = T('cloud.working');
        try {
          if (!Drive.isConnected()) await Drive.connect();
          const res = await TeamCloud.inviteMembers(picked);
          const ok = res.filter(r => r.ok).length;
          close();
          UI.toast(T('cloud.invited').replace('{0}', ok).replace('{1}', res.length), ok ? 'success' : 'error');
          if (onDone) onDone();
        } catch (e) {
          state.textContent = String((e && e.message) || e).slice(0, 220);
        } finally { go.disabled = false; }
      };
    }
  });
}

// ---- People & access ----------------------------------------------------
// Everyone on the access list still has to be a Google test user before they
// can sign in at all, and that list lives in the Cloud Console rather than in
// the app. This hands over the addresses and the page they go on.
function googleUsersDialog() {
  const users = wizTestUsers();
  const joined = users.join(', ');
  UI.modal({
    title: T('access.googleTitle'),
    width: 620,
    body: `<p>${UI.esc(T('access.googleIntro'))}</p>
      <ol class="wiz-list">
        <li>${UI.esc(T('access.googleS1'))}</li>
        <li>${UI.esc(T('access.googleS2'))}</li>
        <li>${UI.esc(T('access.googleS3'))}</li>
      </ol>
      ${users.length
        ? `<div class="wiz-copy wiz-users">
             <span class="wiz-copy-label">${UI.esc(T('gw.s3Users').replace('{0}', users.length))}</span>
             <code class="wiz-copy-val">${UI.esc(joined)}</code>
             <button type="button" class="btn sm" id="gu_copy">${UI.esc(T('gw.s3CopyUsers'))}</button>
           </div>`
        : `<p class="hint">${UI.esc(T('gw.s3NoUsers'))}</p>`}
      <p class="hint">${UI.esc(T('access.googleTail'))}</p>`,
    footer: `<a class="btn primary" href="${GOOGLE_PAGES.audience}" target="_blank" rel="noopener">${UI.esc(T('access.googleOpen'))} \u2197</a>
      <button class="btn ghost" data-close2>${T('common.close')}</button>`,
    onOpen: (m, close) => {
      m.querySelector('[data-close2]').onclick = close;
      const copy = m.querySelector('#gu_copy');
      if (copy) copy.onclick = async () => {
        const ok = await copyText(joined);
        UI.toast(ok ? T('cloud.copied') : T('gw.copyFailed'), ok ? 'success' : 'error');
      };
    }
  });
}

function accessEditDialog(existing, onDone) {
  const m0 = existing || { name: '', email: '', role: 'Player', note: '' };
  const sugg = Access.suggestions().filter(s => !existing);
  UI.modal({
    title: existing ? T('access.editTitle') : T('access.addTitle'),
    width: 560,
    body: `<label class="field"><span>${UI.esc(T('access.name'))}</span>
        <input id="ac_name" maxlength="60" value="${UI.esc(m0.name)}"></label>
      <label class="field"><span>${UI.esc(T('access.email'))}</span>
        <input id="ac_mail" type="email" spellcheck="false" autocomplete="off" value="${UI.esc(m0.email)}"
          ${existing ? 'readonly' : `list="ac_sugg"`}>
        <span class="hint">${UI.esc(T('access.emailHint'))}</span></label>
      ${sugg.length ? `<datalist id="ac_sugg">${sugg.map(s => `<option value="${UI.esc(s.email)}">${UI.esc(s.name)}</option>`).join('')}</datalist>` : ''}
      <label class="field"><span>${UI.esc(T('access.role'))}</span>
        <select id="ac_role">${Access.GRANTABLE.map(r => `<option value="${UI.esc(r)}" ${r === m0.role ? 'selected' : ''}>${UI.esc(Access.label(r))}</option>`).join('')}</select>
        <span class="hint">${UI.esc(T('access.roleHint'))}</span></label>
      <label class="field"><span>${UI.esc(T('access.note'))}</span>
        <input id="ac_note" maxlength="80" value="${UI.esc(m0.note || '')}"></label>
      <p class="hint" id="ac_state"></p>`,
    footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button>
      <button class="btn primary" data-go>${T('common.save')}</button>`,
    onOpen: (m, close) => {
      const mail = m.querySelector('#ac_mail');
      const name = m.querySelector('#ac_name');
      const state = m.querySelector('#ac_state');
      (existing ? name : mail).focus();
      // Picking a known address fills the rest in, so nothing has to be retyped.
      mail.oninput = () => {
        const hit = sugg.find(s => s.email === Access.normEmail(mail.value));
        if (hit && !name.value.trim()) { name.value = hit.name; m.querySelector('#ac_role').value = hit.role; }
      };
      m.querySelector('[data-close2]').onclick = close;
      m.querySelector('[data-go]').onclick = async () => {
        try {
          await Access.grant({
            id: m0.id, addedAt: m0.addedAt, invitedAt: m0.invitedAt,
            name: name.value, email: mail.value,
            role: m.querySelector('#ac_role').value, note: m.querySelector('#ac_note').value
          });
          close();
          UI.toast(T('access.saved'), 'success');
          if (onDone) onDone();
        } catch (e) { state.textContent = T('access.badEmail'); }
      };
    }
  });
}

Views.settings = async function (mount) {
  const role = await Store.getSetting('role', 'Coach');
  const staff = Access.isStaff(role);
  // A look-only team copy cannot promote itself out of read mode; the way back
  // is the coach, or leaving the shared database altogether.
  const readMode = Access.readMode();

  mount.innerHTML = `
    <div class="page-head"><div><h1>${T('settings.title')}</h1><p>${T('settings.subtitle')}</p></div></div>
    ${Store.locked() ? UI.acc('setLock', '🔒 ' + T('lock.title'), `
      <p style="color:var(--muted);font-size:13px">${T('lock.cardHint')}</p>
      <button class="btn primary" id="unlockBtn">🔓 ${T('lock.unlock')}</button>`) : ''}
    ${readMode ? '' : menuCard()}
    ${UI.acc('setRole', T('settings.roleAccess'), `
      <label class="field"><span>${T('settings.activeRole')}</span><select id="s_role" ${readMode ? 'disabled' : ''}>${['Super Admin', 'Club Admin', 'Coach', 'Analyst', 'Player'].map(r => `<option value="${r}" ${r === role ? 'selected' : ''}>${T('role.' + r)}</option>`).join('')}</select></label>
      <p style="color:var(--muted);font-size:12px">${readMode ? T('mem.roleLocked') : T('settings.roleHint')}</p>
      ${Access.roleKeys() && Access.following() ? `<label class="field"><span>${T('rk.field')}</span>
        <span class="row" style="flex:0;gap:6px;align-items:center">
          <input id="s_key" spellcheck="false" autocomplete="off" placeholder="ABCD-EFGH-JK">
          <button type="button" class="btn" id="s_keyGo" data-member-ok>${T('rk.unlock')}</button>
        </span>
        <span class="hint">${T('rk.unlockHint')}</span></label>` : ''}`)}
    <div id="cloudCardHost">${cloudCard()}</div>
    <div id="accessCardHost">${staff ? accessCard() : ''}</div>
    ${UI.acc('setData', T('settings.dataCard'), `
      <p style="color:var(--muted);font-size:13px">${T('settings.dataHint')}</p>

      <h4 class="set-sub">${T('settings.autoCard')}</h4>
      <p class="hint">${T('settings.autoHint')}</p>
      <div class="row" style="flex:0;margin-top:8px;flex-wrap:wrap;align-items:flex-end">
        <label class="field" style="max-width:220px"><span>${T('settings.autoEvery')}</span>
          <select id="autoMin">${AUTOBK.MINUTES.map(m => `<option value="${m}" ${m === AUTOBK.minutes() ? 'selected' : ''}>${everyLabel(m)}</option>`).join('')}</select></label>
        ${AUTOBK.supported() ? `<button class="btn" id="autoPick">${T('settings.autoPick')}</button>
        <button class="btn" id="autoForget">${T('settings.autoForget')}</button>` : ''}
        <button class="btn primary" id="autoNow">${T('settings.autoNow')}</button>
      </div>
      <p><span class="tag" id="autoState"></span></p>
      <p class="hint">${AUTOBK.supported() ? T('settings.autoFileHint') : T('settings.autoDlHint')}</p>

      <h4 class="set-sub">${T('settings.byHand')}</h4>
      <p class="hint">${T('settings.byHandHint')}</p>
      <div class="row" style="flex:0;margin-top:8px;flex-wrap:wrap">
        <button class="btn" id="exportAll">${T('settings.exportBackup')}</button>
        <label class="btn" style="cursor:pointer">${T('settings.importBackup')}<input id="importAll" type="file" accept="application/json" hidden></label>
        <button class="btn" id="csvSquad">${T('settings.csvSquad')}</button>
        <button class="btn" id="emailAll">${T('settings.sendCoach')}</button>
      </div>

      <h4 class="set-sub">${T('settings.dangerZone')}</h4>
      <p class="hint">${T('settings.dangerHint')}</p>
      <div class="row" style="flex:0;margin-top:8px">
        <button class="btn danger" id="wipe" data-member-ok>${T('settings.resetData')}</button>
      </div>`)}
    ${readMode ? '' : UI.acc('setMail', T('settings.mailCard'), `
      <p style="color:var(--muted);font-size:13px">${T('settings.mailHint')}</p>
      <p><span class="tag" id="mailSrvState">${UI.esc(MAIL.serverLabel())}</span></p>
      <div class="row" style="flex:0;margin-top:8px;flex-wrap:wrap">
        <button class="btn primary" id="mailSetup">${T('mail.setup')}</button>
        <button class="btn" id="mailServers">${T('mailsrv.title')}</button>
      </div>`)}
    ${UI.acc('setKeys', T('settings.shortcuts'), `
      <p style="font-size:13px;line-height:1.9">
        <span class="tag">1–9</span> ${T('settings.switchModules')} · <span class="tag">/</span> ${T('settings.focusSearch')} · <span class="tag">Esc</span> ${T('settings.closeDialog')}
      </p>`)}
    ${offlineCard()}
    ${layoutCard()}
    ${messengerCard()}`;

  // The sidebar is a long list and most coaches only live in three or four of
  // the modules — this is where they choose which ones stay on it.
  function menuCard() {
    const hidden = App.getMenuHidden();
    // A module the coach kept off this copy is not offered here either; ticking
    // it would do nothing.
    const off = Access.hiddenModules();
    const rows = App.ROUTES.filter(r => off.indexOf(r) < 0).map(r => {
      const fixed = r === 'settings';
      return `<label class="check-row menu-row">
        <input type="checkbox" data-menu="${r}" ${hidden.indexOf(r) < 0 || fixed ? 'checked' : ''} ${fixed ? 'disabled' : ''}>
        <span>${UI.esc(T('nav.' + r))}${fixed ? ` <span class="tag">${T('settings.menuAlways')}</span>` : ''}</span>
      </label>`;
    }).join('');
    return UI.acc('setMenu', T('settings.menuCard'), `
      <p style="color:var(--muted);font-size:13px">${T('settings.menuHint')}</p>
      <div class="menu-picker">${rows}</div>
      <div class="row" style="flex:0;margin-top:10px;flex-wrap:wrap">
        <button class="btn sm" id="menuAll">${T('settings.shareAll')}</button>
        <button class="btn sm" id="menuMin">${T('settings.menuMin')}</button>
      </div>
      <p class="hint">${T('settings.menuNote')}</p>`);
  }

  function messengerCard() {
    return UI.acc('setMsg', T('sync.messenger'), `
      <p style="color:var(--muted);font-size:13px">${T('sync.messengerDesc')}</p>
      <div class="row" style="flex:0;margin-top:8px"><button class="btn primary" id="openMessenger">${T('sync.openMessenger')}</button></div>`);
  }

  // ---- Shared team database ----
  // Everything the panel shows is derived from three facts: is a file linked,
  // is this device signed in to Google, and may this role write.
  function cloudCard() {
    const c = TeamCloud.cfg();
    const linked = !!c.fileId;
    const online = TeamCloud.signedIn();
    const mayWrite = Access.can('cloud.write', role);
    const maySetup = Access.can('cloud.setup', role);
    const state = !linked ? T('cloud.stateOff')
      : (c.owner ? T('cloud.stateOwner') : T('cloud.stateMember')) + (c.teamName ? ' · ' + c.teamName : '');

    const setup = `
      <div class="row" style="flex:0;margin-top:10px;flex-wrap:wrap">
        ${maySetup ? `<button class="btn primary" id="clCreate">${T('cloud.createBtn')}</button>` : ''}
        <button class="btn" id="clJoin">${T('cloud.joinBtn')}</button>
        ${maySetup ? `<button class="btn" id="clReconnect">${T('cloud.reconnectBtn')}</button>` : ''}
        ${maySetup ? `<button class="btn" id="clPolicy2">${T('pol.btn')}</button>` : ''}
        ${maySetup ? `<button class="btn" id="clMember2">${T('mem.btn')}</button>` : ''}
        <button class="btn" id="clGuide">${T('cloud.showMeHow')}</button>
      </div>`;

    const live = `
      <div class="cloud-facts">
        <span class="tag">${UI.esc(T('cloud.lastPull'))}: ${UI.esc(fmtWhen(c.lastPullAt))}</span>
        <span class="tag">${UI.esc(T('cloud.lastPush'))}: ${UI.esc(fmtWhen(c.lastPushAt))}</span>
        ${c.lastSkipped ? `<span class="tag warn">${UI.esc(T('cloud.skipped').replace('{0}', c.lastSkipped))}</span>` : ''}
        ${c.lastErr ? `<span class="tag warn">${UI.esc(cloudErrText(c.lastErr))}</span>` : ''}
      </div>
      <div class="row" style="flex:0;margin-top:10px;flex-wrap:wrap">
        <button class="btn primary" id="clSync">${T('cloud.syncNow')}</button>
        <button class="btn" id="clPull">${T('cloud.pullAll')}</button>
        ${mayWrite ? `<button class="btn" id="clPush">${T('cloud.pushAll')}</button>` : ''}
        <button class="btn" id="clCode">${T('cloud.showCode')}</button>
        ${maySetup ? `<button class="btn" id="clPolicy">${T('pol.btn')}</button>` : ''}
        ${maySetup ? `<button class="btn" id="clMember">${T('mem.btn')}</button>` : ''}
        ${maySetup ? `<button class="btn" id="clKeys">${T('rk.btn')}</button>` : ''}
        ${mayWrite ? `<button class="btn" id="clInvite">${T('cloud.inviteBtn')}</button>` : ''}
        <button class="btn danger" id="clForget" data-member-ok>${T('cloud.disconnect')}</button>
      </div>
      <div class="row" style="flex:0;margin-top:10px;flex-wrap:wrap;align-items:flex-end">
        <label class="field" style="max-width:220px"><span>${T('cloud.autoEvery')}</span>
          <select id="clAuto">${TeamCloud.AUTO_MINUTES.map(m => `<option value="${m}" ${m === c.autoMin ? 'selected' : ''}>${everyLabel(m)}</option>`).join('')}</select></label>
      </div>
      ${c.owner ? '' : `<p class="hint">${UI.esc(T('cloud.memberFresh'))}</p>
      <p class="hint">${UI.esc(TeamCloud.mayContribute()
        ? (online ? T('cloud.contribOn') : T('cloud.contribNeedsGoogle'))
        : T('cloud.contribOff'))}</p>`}
      ${mayWrite ? '' : `<p class="hint mail-note">${UI.esc(T('cloud.readOnlyRole'))}</p>`}`;

    return UI.acc('setCloud', T('cloud.title'), `
      <p style="color:var(--muted);font-size:13px">${T('cloud.desc')}</p>
      <p><span class="tag ${linked ? 'green' : ''}">${UI.esc(state)}</span>
         <span class="tag ${online ? 'green' : ''}">${UI.esc(online ? T('cloud.googleOn') : T('cloud.googleOff'))}</span>
         ${maySetup ? `<span class="tag ${Access.profile().readOnly ? 'green' : ''}">${UI.esc(memberLabel())}</span>` : ''}</p>
      ${linked ? live : setup}
      <div class="row" style="flex:0;margin-top:10px;flex-wrap:wrap">
        <button class="btn sm ${online ? '' : 'primary'}" id="clGoogle">${online ? T('cloud.googleBtn') : T('gw.startBtn')}</button>
        ${linked ? `<button class="btn sm" id="clGuide2">${T('cloud.showMeHow')}</button>` : ''}
      </div>
      <p class="hint">${T('cloud.hint')}</p>`);
  }

  // ---- People & access (admin / coach only) ----
  function accessCard() {
    const list = Access.members();
    const row = m => `<div class="acc-person">
      <span class="acc-person-main">
        <b>${UI.esc(m.name || m.email)}</b>
        <span class="tag ${Access.isStaff(m.role) ? 'green' : ''}">${UI.esc(Access.label(m.role))}</span>
        <span class="share-n">${UI.esc(m.email)}${m.note ? ' · ' + UI.esc(m.note) : ''}</span>
      </span>
      <span class="bm-acts">
        <button class="btn sm" data-acc-edit="${UI.esc(m.id)}">${T('common.edit')}</button>
        <button class="btn sm danger" data-acc-rm="${UI.esc(m.id)}">${T('common.remove')}</button>
      </span>
    </div>`;
    return UI.acc('setAccess', T('access.title'), `
      <p style="color:var(--muted);font-size:13px">${T('access.desc')}</p>
      <div class="acc-people">${list.length ? list.map(row).join('') : `<p class="hint">${T('access.none')}</p>`}</div>
      <div class="row" style="flex:0;margin-top:10px;flex-wrap:wrap">
        <button class="btn primary" id="accAdd">${T('access.addTitle')}</button>
        <button class="btn" id="accImport">${T('access.fromSquad')}</button>
        <button class="btn" id="accGoogle">${T('access.googleBtn')}</button>
        ${TeamCloud.isLinked() ? `<button class="btn" id="accInvite">${T('cloud.inviteBtn')}</button>` : ''}
      </div>
      <p class="hint">${T('access.hint')}</p>`);
  }

  // ---- Screen layout ----
  // mobile.js decides on its own, but a coach on a big phone may want the
  // desktop shell anyway — and a tester on a laptop needs to see the phone one.
  function layoutCard() {
    if (!window.Mobile) return '';
    const cur = Mobile.mode();
    const opt = (v, k) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${T(k)}</option>`;
    return UI.acc('setLayout', T('mob.layoutCard'), `
      <p style="color:var(--muted);font-size:13px">${T('mob.layoutHint')}</p>
      <label class="field" style="max-width:260px"><span>${T('mob.layout')}</span>
        <select id="s_layout">${opt('auto', 'mob.layoutAuto')}${opt('mobile', 'mob.layoutMobile')}${opt('desktop', 'mob.layoutDesktop')}</select></label>`);
  }

  // ---- Offline ----
  function offlineCard() {
    return UI.acc('setOffline', T('offline.title'), `
      <p style="color:var(--muted);font-size:13px">${T('offline.desc')}</p>
      <p><span class="tag" id="offState">${UI.esc(T('offline.checking'))}</span></p>
      <div class="row" style="flex:0;margin-top:8px;flex-wrap:wrap">
        <button class="btn primary" id="offInstall">${T('offline.install')}</button>
        <button class="btn" id="offCache">${T('offline.download')}</button>
        <button class="btn" id="offUpdate">${T('offline.update')}</button>
        <button class="btn" id="offGuide">${T('cloud.showMeHow')}</button>
      </div>
      <p class="hint">${T('offline.hint')}</p>`);
  }

  UI.bindAcc(mount);

  // The two cloud panels redraw themselves in place, so a sync does not fold
  // every other card shut by re-rendering the whole page.
  function refreshCloud() {
    const host = mount.querySelector('#cloudCardHost');
    if (!host) return;
    host.innerHTML = cloudCard();
    UI.bindAcc(host);
    bindCloud();
  }
  function refreshAccess() {
    const host = mount.querySelector('#accessCardHost');
    if (!host || !staff) return;
    host.innerHTML = accessCard();
    UI.bindAcc(host);
    bindAccess();
  }
  const on = (sel, fn) => { const el = mount.querySelector(sel); if (el) el.onclick = fn; };
  // Long enough for the toast to be read, then the app comes back on the new data.
  const reloadSoon = () => setTimeout(() => location.reload(), 900);
  const busyRun = async (sel, fn, okKey, reload) => {
    const el = mount.querySelector(sel);
    if (el) el.disabled = true;
    try {
      const r = await fn();
      UI.toast(typeof okKey === 'function' ? okKey(r) : T(okKey), 'success');
      if (reload) { reloadSoon(); return; }
    }
    catch (e) { UI.toast(String((e && e.message) || e).slice(0, 200), 'error'); }
    finally { if (el) el.disabled = false; refreshCloud(); }
  };

  function bindCloud() {
    on('#clGuide', cloudGuide);
    on('#clGuide2', cloudGuide);
    on('#clGoogle', () => googleWizard(refreshCloud));
    on('#clCreate', async () => {
      // Nothing can be created before Google is connected, so an unconfigured
      // coach is taken through the setup first instead of into an error.
      if (!await Drive.isConfigured()) return googleWizard(refreshCloud);
      cloudCreateDialog(() => { refreshCloud(); refreshAccess(); });
    });
    on('#clJoin', () => cloudJoinDialog(() => { refreshCloud(); refreshAccess(); App.render(); }));
    on('#clReconnect', async () => {
      // Signed-in owner only: a code-less way back into a folder this same
      // Google account already made, for when a browser reset wiped the id
      // this app had remembered for it.
      if (!await Drive.isConfigured()) return googleWizard(refreshCloud);
      if (!Drive.isConnected()) {
        try { await Drive.connect(); } catch (e) { return UI.toast(T('cloud.connectFailed'), 'error'); }
      }
      cloudReconnectDialog(() => { refreshCloud(); refreshAccess(); App.render(); });
    });
    on('#clCode', cloudCodeDialog);
    on('#clPolicy', () => sharePolicyDialog(refreshCloud));
    on('#clPolicy2', () => sharePolicyDialog(refreshCloud));
    on('#clMember', () => memberModeDialog(refreshCloud));
    on('#clMember2', () => memberModeDialog(refreshCloud));
    on('#clKeys', () => roleKeysDialog(refreshCloud));
    on('#clInvite', () => cloudInviteDialog(refreshAccess));
    // A sync rewrites every store underneath the open views, so the app is
    // reloaded rather than left showing what was on screen before it.
    on('#clSync', () => busyRun('#clSync', () => TeamCloud.sync(), () => T('cloud.synced'), true));
    on('#clPull', () => UI.confirm(T('cloud.pullAsk'), () =>
      busyRun('#clPull', () => TeamCloud.pull('replace'), () => T('cloud.pulled'), true)));
    on('#clPush', () => UI.confirm(T('cloud.pushAsk'), () =>
      busyRun('#clPush', () => TeamCloud.push('replace'), () => T('cloud.pushed'))));
    on('#clForget', () => UI.confirm(T('cloud.disconnectAsk'), async () => {
      await TeamCloud.forget();
      UI.toast(T('cloud.disconnected'), 'success');
      reloadSoon();
    }));
    const auto = mount.querySelector('#clAuto');
    if (auto) auto.onchange = async () => {
      await TeamCloud.setAuto(auto.value);
      UI.toast(+auto.value ? T('cloud.autoOn').replace('{0}', everyLabel(+auto.value)) : T('cloud.autoOff'), 'success');
    };
  }

  function bindAccess() {
    on('#accAdd', () => accessEditDialog(null, refreshAccess));
    on('#accInvite', () => cloudInviteDialog(refreshAccess));
    on('#accGoogle', googleUsersDialog);
    on('#accImport', () => {
      const known = new Set(Access.members().map(m => m.email));
      const add = Access.suggestions().filter(s => !known.has(s.email));
      if (!add.length) return UI.toast(T('access.nothingToImport'));
      UI.confirm(T('access.fromSquadAsk').replace('{0}', add.length), async () => {
        for (const s of add) await Access.grant(s);
        UI.toast(T('access.imported').replace('{0}', add.length), 'success');
        refreshAccess();
      });
    });
    mount.querySelectorAll('[data-acc-edit]').forEach(b => b.onclick = () => {
      const m = Access.members().find(x => x.id === b.dataset.accEdit);
      if (m) accessEditDialog(m, refreshAccess);
    });
    mount.querySelectorAll('[data-acc-rm]').forEach(b => b.onclick = () => {
      const m = Access.members().find(x => x.id === b.dataset.accRm);
      if (!m) return;
      UI.confirm(T('access.removeAsk').replace('{0}', m.name || m.email), async () => {
        await Access.revoke(m.id); UI.toast(T('access.removed'), 'success'); refreshAccess();
      });
    });
  }

  bindCloud();
  bindAccess();
  bindOffline();

  // ---- Offline ----
  // The service worker already caches the shell; this is the place a coach can
  // see whether it actually happened and force it before leaving for a hall
  // with no signal.
  function bindOffline() {
    const tag = mount.querySelector('#offState');
    const install = mount.querySelector('#offInstall');
    if (!tag) return;
    const swOk = 'serviceWorker' in navigator;
    const standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
    // navigator.serviceWorker.ready never settles when nothing is registered,
    // which would leave the button spinning for ever.
    const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
    async function state() {
      if (!swOk) { tag.textContent = T('offline.unsupported'); return; }
      const reg = await navigator.serviceWorker.getRegistration();
      let files = 0;
      try {
        const keys = await caches.keys();
        for (const k of keys.filter(x => x.indexOf('sporttactic-') === 0)) {
          files += (await (await caches.open(k)).keys()).length;
        }
      } catch (e) { /* storage blocked (private mode) */ }
      tag.textContent = (reg ? T('offline.ready') : T('offline.notReady'))
        + ' · ' + T('offline.files').replace('{0}', files)
        + (standalone ? ' · ' + T('offline.installed') : '');
    }
    state();
    if (install) {
      // Chrome fires beforeinstallprompt whenever it likes, and Safari never
      // fires it at all — so this opens the guide, which offers the real button
      // where one exists and the exact taps where it does not.
      install.disabled = standalone;
      install.onclick = () => { STXInstall.guide(); state(); };
    }
    const cacheBtn = mount.querySelector('#offCache');
    if (cacheBtn) cacheBtn.disabled = !swOk;
    on('#offCache', async () => {
      cacheBtn.disabled = true;
      try {
        const reg = await withTimeout(navigator.serviceWorker.ready, 8000);
        if (!reg.active) throw new Error('no active worker');
        // The worker answers when every shell file is in the cache.
        await new Promise((res, rej) => {
          const ch = new MessageChannel();
          ch.port1.onmessage = e => (e.data && e.data.ok) ? res(e.data) : rej(new Error((e.data && e.data.error) || 'failed'));
          setTimeout(() => rej(new Error('timeout')), 60000);
          reg.active.postMessage({ type: 'PRECACHE_ALL' }, [ch.port2]);
        });
        UI.toast(T('offline.downloaded'), 'success');
      } catch (e) { UI.toast(T('offline.downloadFailed'), 'error'); }
      finally { cacheBtn.disabled = false; state(); }
    });
    const updBtn = mount.querySelector('#offUpdate');
    if (updBtn) updBtn.disabled = !swOk;
    on('#offUpdate', async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (!reg) throw new Error('not registered');
        await reg.update();
        // update() only fetches the new worker — the screen keeps running the
        // code it booted with. Without the restart a coach presses Update, is
        // told it worked, and still sees the old app.
        if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        UI.toast(T('offline.updated'), 'success');
        setTimeout(() => location.reload(), 500);
      } catch (e) { UI.toast(T('offline.downloadFailed'), 'error'); }
      state();
    });
    on('#offGuide', () => guideDialog(T('offline.guideTitle'), UI.esc(T('offline.desc')), [
      UI.esc(T('offline.g1')), UI.esc(T('offline.g2')), UI.esc(T('offline.g3')), UI.esc(T('offline.g4'))
    ], `<p class="hint">${UI.esc(T('offline.hint'))}</p>`));
  }

  // ---- Module menu ----
  const menuBoxes = [...mount.querySelectorAll('[data-menu]')];
  const saveMenu = () => App.setMenuHidden(menuBoxes.filter(b => !b.checked).map(b => b.dataset.menu));
  menuBoxes.forEach(b => b.onchange = saveMenu);
  on('#menuAll', () => { menuBoxes.forEach(b => { b.checked = true; }); saveMenu(); });
  on('#menuMin', () => {
    const keep = ['dashboard', 'training', 'settings'];
    menuBoxes.forEach(b => { b.checked = keep.indexOf(b.dataset.menu) >= 0 || b.disabled; });
    saveMenu();
  });

  const roleSel = mount.querySelector('#s_role');
  roleSel.onchange = async e => {
    await Store.setSetting('role', e.target.value);
    document.getElementById('roleBadge').textContent = T('role.' + e.target.value);
    App.applyMemberMode();
    App.render();
  };
  on('#s_keyGo', async () => {
    const inp = mount.querySelector('#s_key');
    const got = await Access.claimRole(inp.value.trim());
    if (!got) return UI.toast(T(Access.roleKeys() ? 'rk.wrong' : 'rk.noKeys'), 'error');
    UI.toast(T('rk.joinedAs').replace('{0}', Access.label(got)), 'success');
    document.getElementById('roleBadge').textContent = T('role.' + got);
    const squad = await attachJoinedSquad();
    if (squad) UI.toast(T('cloud.squadAttached').replace('{0}', squad.name || ''), 'success');
    App.applyMemberMode();
    App.render();
    offerDriveConnect();
  });
  const openMsg = mount.querySelector('#openMessenger');
  if (openMsg) openMsg.onclick = () => App.go('messenger');

  const layoutSel = mount.querySelector('#s_layout');
  if (layoutSel) layoutSel.onchange = e => Mobile.setMode(e.target.value);

  // ---- Mail ----
  const mailSrvState = mount.querySelector('#mailSrvState');
  const refreshMailSrv = () => { if (mailSrvState) mailSrvState.textContent = MAIL.serverLabel(); };
  on('#mailSetup', () => MAIL.setupDialog(refreshMailSrv));
  on('#mailServers', () => MAIL.serverDialog(refreshMailSrv));

  mount.querySelector('#csvSquad').onclick = () => {
    downloadCsv(squadCsv(), 'sporttactic-squad-' + new Date().toISOString().slice(0, 10) + '.csv');
    UI.toast(T('settings.csvSaved'), 'success');
  };

  mount.querySelector('#exportAll').onclick = () => exportDialog();
  const unlockBtn = mount.querySelector('#unlockBtn');
  if (unlockBtn) unlockBtn.onclick = () => unlockDialog();

  // ---- Automatic backup ----
  async function autoState() {
    const tag = mount.querySelector('#autoState');
    if (!tag) return;
    const min = AUTOBK.minutes();
    const file = await AUTOBK.hasFile() ? (AUTOBK.fileLabel() || T('settings.autoFileSet')) : T('settings.autoNoFile');
    const last = AUTOBK.last();
    tag.textContent = everyLabel(min)
      + (AUTOBK.supported() ? ' · ' + file : '')
      + ' · ' + (last ? T('settings.autoLast').replace('{0}', UI.fmtDate(last) + ' ' + new Date(last).toTimeString().slice(0, 5)) : T('settings.autoNever'));
  }
  autoState();
  mount.querySelector('#autoMin').onchange = e => {
    AUTOBK.setMinutes(e.target.value);
    UI.toast(+e.target.value ? T('settings.autoOn').replace('{0}', everyLabel(+e.target.value)) : T('settings.autoOffMsg'), 'success');
    autoState();
  };
  const pick = mount.querySelector('#autoPick');
  if (pick) pick.onclick = async () => {
    const h = await AUTOBK.chooseFile();
    if (h) { UI.toast(T('settings.autoFileSet'), 'success'); await AUTOBK.now(); }
    autoState();
  };
  const forget = mount.querySelector('#autoForget');
  if (forget) forget.onclick = async () => { await AUTOBK.forgetFile(); UI.toast(T('settings.autoNoFile')); autoState(); };
  mount.querySelector('#autoNow').onclick = async () => {
    const ok = await AUTOBK.now();
    UI.toast(ok ? T('settings.exported') : T('settings.exportFailed'), ok ? 'success' : 'error');
    autoState();
  };
  mount.querySelector('#importAll').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    e.target.value = '';
    // Restoring writes straight to the database, so the two read-only modes are
    // checked here rather than in the store.
    if (Store.locked()) return UI.toast(T('lock.blocked'), 'error');
    if (readMode) return UI.toast(T('mem.blocked'), 'error');
    // A backup arrives by mail or over a chat, so its size is somebody else's
    // decision. Reading it as text first would be the point of no return.
    if (f.size > MAX_BACKUP_BYTES) return UI.toast(T('settings.backupTooBig'), 'error');
    const r = new FileReader();
    r.onload = async () => {
      try {
        const dump = JSON.parse(r.result);
        await restoreBackup(dump);
        await Store.loadAll();
        UI.toast(dump && dump.guard ? T('lock.imported') : T('settings.imported'), 'success');
        // Restored preferences (menu, theme, folds) are read once at start-up,
        // so a reload is the only way to actually apply them.
        if (dump && (dump.prefs || dump.guard)) setTimeout(() => location.reload(), 900);
        else App.render();
      } catch { UI.toast(T('settings.invalidBackup'), 'error'); }
    };
    r.readAsText(f);
  };
  mount.querySelector('#emailAll').onclick = () => shareDialog();
  mount.querySelector('#wipe').onclick = () => {
    // Emptying your own device is never the club's business, so a read-only copy
    // keeps this one: it is also the way out of a copy somebody handed you.
    UI.confirm(T('settings.resetConfirm'), async () => {
      for (const s of DB.STORES) await DB.clear(s);
      // Wiping everything also hands a read-only device back to its owner.
      Store.setLock(null);
      await Store.loadAll();
      UI.toast(T('settings.resetDone'), 'success');
      reloadSoon();
    });
  };
};

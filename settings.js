/* Settings view */
window.Views = window.Views || {};

// ---- Full-fidelity JSON backup ----------------------------------------
// Every object store is read straight from IndexedDB (not the in-memory cache)
// and Blobs are base64-encoded by Store.pack, because JSON.stringify silently
// turns a Blob into `{}` — that is how recorded animation clips used to vanish.
const BACKUP_FORMAT = 2;
// Everything the app keeps outside IndexedDB lives in localStorage under `stx_`:
// the athlete name, the scouting focus areas, the progression filters, which
// panels are folded open, the mail setup. A backup that skipped them restored a
// half-configured app, so they travel with it — except the OpenAI key, which is
// a credential and must never end up in a file that gets mailed around.
const PREF_PREFIX = 'stx_';
// stx_lock is decided by the guard inside the file being imported, never by a
// preference copied out of someone else's device.
const PREF_SECRETS = ['stx_ai_key', 'stx_lock'];
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
  { id: 'personal', stores: ['personal'], key: 'settings.shareGPersonal', def: 'Personal training and max tests', sensitive: true },
  { id: 'opponents', stores: ['opponents'], key: 'settings.shareGOpponents', def: 'Opponent analysis' },
  { id: 'reports', stores: ['reports'], key: 'settings.shareGReports', def: 'Saved reports' }
];
// A backup is the whole app, so it offers the three blocks a mailed share does not.
const EXPORT_GROUPS = SHARE_GROUPS.concat([
  { id: 'tactics', stores: ['tactics'], key: 'tactics.savedAnims', def: 'Saved animations' },
  { id: 'planner', stores: ['planner'], key: 'nav.planner', def: 'Event planner' },
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

Views.settings = async function (mount) {
  const role = await Store.getSetting('role', 'Coach');

  mount.innerHTML = `
    <div class="page-head"><div><h1>${T('settings.title')}</h1><p>${T('settings.subtitle')}</p></div></div>
    ${Store.locked() ? UI.acc('setLock', '🔒 ' + T('lock.title'), `
      <p style="color:var(--muted);font-size:13px">${T('lock.cardHint')}</p>
      <button class="btn primary" id="unlockBtn">🔓 ${T('lock.unlock')}</button>`) : ''}
    ${menuCard()}
    ${UI.acc('setRole', T('settings.roleAccess'), `
      <label class="field"><span>${T('settings.activeRole')}</span><select id="s_role">${['Super Admin', 'Club Admin', 'Coach', 'Analyst', 'Player'].map(r => `<option value="${r}" ${r === role ? 'selected' : ''}>${T('role.' + r)}</option>`).join('')}</select></label>
      <p style="color:var(--muted);font-size:12px">${T('settings.roleHint')}</p>`)}
    ${UI.acc('setData', T('settings.dataSync'), `
      <p style="color:var(--muted);font-size:13px">${T('settings.dataHint')}</p>
      <div class="row" style="flex:0;margin-top:10px;flex-wrap:wrap">
        <button class="btn" id="exportAll">${T('settings.exportBackup')}</button>
        <label class="btn" style="cursor:pointer">${T('settings.importBackup')}<input id="importAll" type="file" accept="application/json" hidden></label>
        <button class="btn" id="csvSquad">${T('settings.csvSquad')}</button>
        <button class="btn" id="emailAll">${T('settings.sendCoach')}</button>
        <button class="btn danger" id="wipe">${T('settings.resetData')}</button>
      </div>`)}
    ${UI.acc('setAuto', T('settings.autoCard'), `
      <p style="color:var(--muted);font-size:13px">${T('settings.autoHint')}</p>
      <div class="row" style="flex:0;margin-top:8px;flex-wrap:wrap;align-items:flex-end">
        <label class="field" style="max-width:220px"><span>${T('settings.autoEvery')}</span>
          <select id="autoMin">${AUTOBK.MINUTES.map(m => `<option value="${m}" ${m === AUTOBK.minutes() ? 'selected' : ''}>${everyLabel(m)}</option>`).join('')}</select></label>
        ${AUTOBK.supported() ? `<button class="btn" id="autoPick">${T('settings.autoPick')}</button>
        <button class="btn" id="autoForget">${T('settings.autoForget')}</button>` : ''}
        <button class="btn primary" id="autoNow">${T('settings.autoNow')}</button>
      </div>
      <p><span class="tag" id="autoState"></span></p>
      <p class="hint">${AUTOBK.supported() ? T('settings.autoFileHint') : T('settings.autoDlHint')}</p>`)}
    ${UI.acc('setMail', T('settings.mailCard'), `
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
    ${messengerCard()}`;

  // The sidebar is a long list and most coaches only live in three or four of
  // the modules — this is where they choose which ones stay on it.
  function menuCard() {
    const hidden = App.getMenuHidden();
    const rows = App.ROUTES.map(r => {
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

  UI.bindAcc(mount);

  // ---- Module menu ----
  const menuBoxes = [...mount.querySelectorAll('[data-menu]')];
  const saveMenu = () => App.setMenuHidden(menuBoxes.filter(b => !b.checked).map(b => b.dataset.menu));
  menuBoxes.forEach(b => b.onchange = saveMenu);
  mount.querySelector('#menuAll').onclick = () => { menuBoxes.forEach(b => { b.checked = true; }); saveMenu(); };
  mount.querySelector('#menuMin').onclick = () => {
    const keep = ['dashboard', 'training', 'settings'];
    menuBoxes.forEach(b => { b.checked = keep.indexOf(b.dataset.menu) >= 0 || b.disabled; });
    saveMenu();
  };

  mount.querySelector('#s_role').onchange = e => { Store.setSetting('role', e.target.value); document.getElementById('roleBadge').textContent = T('role.' + e.target.value); App.render(); };
  const openMsg = mount.querySelector('#openMessenger');
  if (openMsg) openMsg.onclick = () => App.go('messenger');

  // ---- Mail ----
  const mailSrvState = mount.querySelector('#mailSrvState');
  const refreshMailSrv = () => { mailSrvState.textContent = MAIL.serverLabel(); };
  mount.querySelector('#mailSetup').onclick = () => MAIL.setupDialog(refreshMailSrv);
  mount.querySelector('#mailServers').onclick = () => MAIL.serverDialog(refreshMailSrv);

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
  mount.querySelector('#wipe').onclick = () => UI.confirm(T('settings.resetConfirm'), async () => {
    for (const s of DB.STORES) await DB.clear(s);
    // Wiping everything also hands a read-only device back to its owner.
    Store.setLock(null);
    await Store.loadAll(); await Store.seedIfEmpty(); UI.toast(T('settings.resetDone'), 'success'); App.render();
  });
};

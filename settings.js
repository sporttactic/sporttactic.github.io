/* Settings view */
window.Views = window.Views || {};

// ---- Full-fidelity JSON backup ----------------------------------------
// Every object store is read straight from IndexedDB (not the in-memory cache)
// and Blobs are base64-encoded by Store.pack, because JSON.stringify silently
// turns a Blob into `{}` — that is how recorded animation clips used to vanish.
const BACKUP_FORMAT = 2;
async function buildBackup(stores) {
  const list = stores && stores.length ? stores : DB.STORES;
  const data = {};
  const counts = {};
  for (const s of list) {
    const rows = await DB.getAll(s);
    data[s] = await Store.pack(rows);
    counts[s] = rows.length;
  }
  return {
    app: 'SportTactic', format: BACKUP_FORMAT,
    exportedAt: new Date().toISOString(),
    stores: list.slice(), counts, data
  };
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
}
function downloadJson(json, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 20000);
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
        <input id="shareTo" type="email" autocomplete="off" spellcheck="false" placeholder="traener@klub.dk">
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

Views.settings = async function (mount) {
  const theme = document.documentElement.getAttribute('data-theme');
  const role = await Store.getSetting('role', 'Coach');

  mount.innerHTML = `
    <div class="page-head"><div><h1>${T('settings.title')}</h1><p>${T('settings.subtitle')}</p></div></div>
    ${UI.acc('setLook', T('settings.appearance'), `
      <label class="field"><span>${T('settings.theme')}</span><select id="s_theme"><option value="dark" ${theme === 'dark' ? 'selected' : ''}>${T('settings.dark')}</option><option value="light" ${theme === 'light' ? 'selected' : ''}>${T('settings.light')}</option></select></label>`)}
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

  function messengerCard() {
    return UI.acc('setMsg', T('sync.messenger'), `
      <p style="color:var(--muted);font-size:13px">${T('sync.messengerDesc')}</p>
      <div class="row" style="flex:0;margin-top:8px"><button class="btn primary" id="openMessenger">${T('sync.openMessenger')}</button></div>`);
  }

  UI.bindAcc(mount);

  mount.querySelector('#s_theme').onchange = e => { App.setTheme(e.target.value); };
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

  mount.querySelector('#exportAll').onclick = async () => {
    try {
      const json = JSON.stringify(await buildBackup(), null, 2);
      downloadJson(json, 'sporttactic-backup-' + new Date().toISOString().slice(0, 10) + '.json');
      UI.toast(T('settings.exported'), 'success');
    } catch (e) { UI.toast(T('settings.exportFailed'), 'error'); }
  };
  mount.querySelector('#importAll').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = async () => {
      try {
        await restoreBackup(JSON.parse(r.result));
        await Store.loadAll(); UI.toast(T('settings.imported'), 'success'); App.render();
      } catch { UI.toast(T('settings.invalidBackup'), 'error'); }
    };
    r.readAsText(f);
  };
  mount.querySelector('#emailAll').onclick = () => shareDialog();
  mount.querySelector('#wipe').onclick = () => UI.confirm(T('settings.resetConfirm'), async () => {
    for (const s of DB.STORES) await DB.clear(s);
    await Store.loadAll(); await Store.seedIfEmpty(); UI.toast(T('settings.resetDone'), 'success'); App.render();
  });
};

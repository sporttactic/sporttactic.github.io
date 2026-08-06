/* Settings view */
window.Views = window.Views || {};

// ---- Full-fidelity JSON backup ----------------------------------------
// Every object store is read straight from IndexedDB (not the in-memory cache)
// and Blobs are base64-encoded by Store.pack, because JSON.stringify silently
// turns a Blob into `{}` — that is how recorded animation clips used to vanish.
const BACKUP_FORMAT = 2;
async function buildBackup() {
  const data = {};
  const counts = {};
  for (const s of DB.STORES) {
    const rows = await DB.getAll(s);
    data[s] = await Store.pack(rows);
    counts[s] = rows.length;
  }
  return {
    app: 'SportTactic', format: BACKUP_FORMAT,
    exportedAt: new Date().toISOString(),
    stores: DB.STORES.slice(), counts, data
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
function sheetsGuide() {
  guideDialog(T('sheets.title'), T('sheets.intro'), [
    T('sheets.s1'), T('sheets.s2'), T('sheets.s3'), T('sheets.s4'), T('sheets.s5'), T('sheets.s6')
  ], `<p class="hint">${T('sheets.tail')}</p>
      <p><a class="btn sm" href="https://sheets.new" target="_blank" rel="noopener noreferrer">${T('sheets.open')}</a></p>`);
}
function driveGuide() {
  guideDialog(T('gdrive.title'), T('gdrive.intro'), [
    T('gdrive.s1'), T('gdrive.s2'), T('gdrive.s3'), T('gdrive.s4'), T('gdrive.s5')
  ], `<h4>${T('gdrive.autoTitle')}</h4>
      <ol class="ai-guide">${[T('gdrive.a1'), T('gdrive.a2'), T('gdrive.a3'), T('gdrive.a4')].map(s => `<li>${s}</li>`).join('')}</ol>
      <p class="hint">${T('gdrive.tail')}</p>
      <p><a class="btn sm" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer">${T('gdrive.console')}</a></p>`);
}

// The Client ID is the one step coaches get stuck on, so it gets its own guide
// and shows the exact origin Google has to be told about.
function clientIdGuide() {
  const origin = location.origin;
  UI.modal({
    title: T('oauth.title'),
    width: 720,
    body: `<p>${T('oauth.intro')}</p>
      <p class="hint">${T('oauth.free')}</p>
      <h4>${T('oauth.stepsTitle')}</h4>
      <ol class="ai-guide">
        ${['oauth.s1', 'oauth.s2', 'oauth.s3', 'oauth.s4', 'oauth.s5', 'oauth.s6', 'oauth.s7', 'oauth.s8'].map(k => `<li>${T(k)}</li>`).join('')}
      </ol>
      <h4>${T('oauth.originTitle')}</h4>
      <p>${T('oauth.originHint')}</p>
      <div class="row" style="flex:0;align-items:center">
        <input id="oauthOrigin" readonly value="${UI.esc(origin)}" style="flex:1 1 260px">
        <button class="btn" data-copy>${T('oauth.copy')}</button>
      </div>
      <h4>${T('oauth.troubleTitle')}</h4>
      <ul class="ai-guide">
        ${['oauth.t1', 'oauth.t2', 'oauth.t3', 'oauth.t4'].map(k => `<li>${T(k)}</li>`).join('')}
      </ul>
      <p class="hint">${T('oauth.privacy')}</p>
      <p><a class="btn sm" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer">${T('gdrive.console')}</a></p>`,
    footer: `<button class="btn primary" data-close2>${T('common.close')}</button>`,
    onOpen: (m, close) => {
      m.querySelector('[data-close2]').onclick = close;
      m.querySelector('[data-copy]').onclick = async () => {
        const f = m.querySelector('#oauthOrigin');
        f.select();
        try { await navigator.clipboard.writeText(origin); } catch { document.execCommand('copy'); }
        UI.toast(T('oauth.copied'), 'success');
      };
    }
  });
}

Views.settings = async function (mount) {
  const theme = document.documentElement.getAttribute('data-theme');
  const role = await Store.getSetting('role', 'Coach');
  const sport = (window.App && App.getSport && App.getSport()) || 'handball';
  const isTeamSport = !!(window.SPORTS && SPORTS.isTeam && SPORTS.isTeam(sport));
  const driveId = await Store.getSetting('driveClientId', '');
  const lastBackup = await Store.getSetting('driveBackupAt', 0);

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
        <button class="btn" id="emailAll">${T('settings.sendCoach')}</button>
        <button class="btn danger" id="wipe">${T('settings.resetData')}</button>
      </div>`)}
    ${UI.acc('setSms', T('settings.smsCard'), `
      <p style="color:var(--muted);font-size:13px">${T('settings.smsHint')}</p>
      <p><span class="tag">${T('sms.viaPhone')}</span></p>
      <div class="row" style="flex:0;margin-top:8px;flex-wrap:wrap">
        <button class="btn" id="smsHow">❔ ${T('sms.how')}</button>
      </div>`)}
    ${UI.acc('setMail', T('settings.mailCard'), `
      <p style="color:var(--muted);font-size:13px">${T('settings.mailHint')}</p>
      <p><span class="tag" id="mailState">${UI.esc(MAIL.providerLabel())}</span></p>
      <div class="row" style="flex:0;margin-top:8px;flex-wrap:wrap">
        <button class="btn primary" id="mailSetup">${T('mail.setup')}</button>
        <button class="btn" id="mailServers">❔ ${T('mail.serverBtn')}</button>
      </div>`)}
    ${UI.acc('setDrive', T('settings.driveCard'), `
      <p style="color:var(--muted);font-size:13px">${T('settings.driveHint')}</p>
      <label class="field"><span>${T('settings.driveClientId')}</span>
        <input id="s_driveId" autocomplete="off" spellcheck="false" value="${UI.esc(driveId)}" placeholder="1234567890-abc.apps.googleusercontent.com">
        <span class="hint">${T('settings.driveClientHint')}</span></label>
      <div class="row" style="flex:0;margin:-4px 0 8px;flex-wrap:wrap">
        <button class="btn" id="howClientId">❔ ${T('oauth.title')}</button>
      </div>
      <p class="hint" id="driveState">${lastBackup ? T('settings.driveLast') + ': ' + new Date(lastBackup).toLocaleString() : T('settings.driveNever')}</p>
      <div class="row" style="flex:0;margin-top:8px;flex-wrap:wrap">
        <button class="btn primary" id="driveBackup">${T('settings.driveBackup')}</button>
        <button class="btn" id="driveRestore">${T('settings.driveRestore')}</button>
        <button class="btn" id="driveDisconnect">${T('settings.driveDisconnect')}</button>
      </div>
      <div class="row" style="flex:0;margin-top:8px;flex-wrap:wrap">
        <button class="btn" id="howDrive">❔ ${T('gdrive.title')}</button>
        <button class="btn" id="howSheets">❔ ${T('sheets.title')}</button>
        <button class="btn" id="csvSquad">${T('settings.csvSquad')}</button>
      </div>`)}
    ${UI.acc('setKeys', T('settings.shortcuts'), `
      <p style="font-size:13px;line-height:1.9">
        <span class="tag">1–9</span> ${T('settings.switchModules')} · <span class="tag">/</span> ${T('settings.focusSearch')} · <span class="tag">Esc</span> ${T('settings.closeDialog')}
      </p>`)}
    ${isTeamSport ? messengerCard() : ''}`;

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

  // ---- SMS ----
  mount.querySelector('#smsHow').onclick = () => SMS.help();

  // ---- Mail ----
  const mailState = mount.querySelector('#mailState');
  const refreshMail = () => { mailState.textContent = MAIL.providerLabel(); };
  mount.querySelector('#mailSetup').onclick = () => MAIL.setupDialog(refreshMail);
  mount.querySelector('#mailServers').onclick = () => MAIL.serverGuide();

  // ---- Google Drive & Sheets ----
  mount.querySelector('#howDrive').onclick = driveGuide;
  mount.querySelector('#howSheets').onclick = sheetsGuide;
  mount.querySelector('#howClientId').onclick = clientIdGuide;
  mount.querySelector('#csvSquad').onclick = () => {
    downloadCsv(squadCsv(), 'sporttactic-squad-' + new Date().toISOString().slice(0, 10) + '.csv');
    UI.toast(T('settings.csvSaved'), 'success');
  };
  const driveState = mount.querySelector('#driveState');
  const driveField = mount.querySelector('#s_driveId');
  driveField.onchange = async e => {
    const raw = e.target.value.trim();
    await Drive.setClientId(raw);
    const saved = await Drive.getClientId();
    e.target.value = saved;
    if (!raw) return UI.toast(T('common.save'), 'success');
    // Pasting the whole console line or the client SECRET is the usual cause of
    // Google's bare 400 page, so it is caught here instead of over there.
    if (!Drive.normClientId(saved)) return UI.toast(T('settings.driveBadId'), 'error');
    UI.toast(T('common.save'), 'success');
  };
  // Every Drive call needs the user to sign in first, so failures are expected
  // and must read as an instruction rather than a crash.
  const driveRun = async (fn, okKey) => {
    if (!(await Drive.isConfigured())) return UI.toast(T('settings.driveNeedId'), 'error');
    try {
      driveState.textContent = T('settings.driveWorking');
      await fn();
      driveState.textContent = T('settings.driveLast') + ': ' + new Date().toLocaleString();
      UI.toast(T(okKey), 'success');
    } catch (e) {
      const msg = String(e && e.message ? e.message : e).slice(0, 300);
      driveState.textContent = msg;
      UI.toast(msg, 'error');
    }
  };
  mount.querySelector('#driveBackup').onclick = () => driveRun(async () => {
    await Drive.uploadBackup(await buildBackup());
  }, 'settings.driveDone');
  mount.querySelector('#driveRestore').onclick = () => UI.confirm(T('settings.driveRestoreAsk'), () => driveRun(async () => {
    const dump = await Drive.downloadBackup();
    if (!dump) throw new Error(T('settings.driveNoBackup'));
    await restoreBackup(dump);
    await Store.loadAll(); App.render();
  }, 'settings.imported'));
  mount.querySelector('#driveDisconnect').onclick = () => { Drive.disconnect(); UI.toast(T('settings.driveDisconnected'), 'success'); };

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
  mount.querySelector('#emailAll').onclick = async () => {
    // Build JSON backup, offer download, and open the mail client with instructions.
    const json = JSON.stringify(await buildBackup(), null, 2);
    downloadJson(json, 'sporttactic-share.json');
    const players = Store.players().length, matches = Store.matches().length, tactics = Store.all('tactics').length;
    const subject = encodeURIComponent(T('settings.shareSubject'));
    const body = encodeURIComponent(
      T('settings.shareGreeting') + '\n\n' +
      T('settings.shareSummary') + '\n- ' + T('dash.players') + ': ' + players +
      '\n- ' + T('stat.matches') + ': ' + matches +
      '\n- ' + T('nav.tactics') + ': ' + tactics + '\n\n' +
      T('settings.shareAttach') + '\n' + T('settings.shareLoad') + '\n\n' + T('settings.shareRegards'));
    window.location.href = 'mailto:?subject=' + subject + '&body=' + body;
    UI.toast(T('settings.shareDownloaded'), 'success');
  };
  mount.querySelector('#wipe').onclick = () => UI.confirm(T('settings.resetConfirm'), async () => {
    for (const s of DB.STORES) await DB.clear(s);
    await Store.loadAll(); await Store.seedIfEmpty(); UI.toast(T('settings.resetDone'), 'success'); App.render();
  });
};

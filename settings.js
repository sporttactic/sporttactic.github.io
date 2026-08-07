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
        <button class="btn" id="mailRef">❓ ${T('mailsrv.reference')}</button>
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
  mount.querySelector('#mailRef').onclick = () => MAIL.serverGuide();

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
  mount.querySelector('#emailAll').onclick = async () => {
    // Writes the share file only; sending it on is the coach's own business.
    const json = JSON.stringify(await buildBackup(), null, 2);
    downloadJson(json, 'sporttactic-share.json');
    UI.toast(T('settings.shareDownloaded'), 'success');
  };
  mount.querySelector('#wipe').onclick = () => UI.confirm(T('settings.resetConfirm'), async () => {
    for (const s of DB.STORES) await DB.clear(s);
    await Store.loadAll(); await Store.seedIfEmpty(); UI.toast(T('settings.resetDone'), 'success'); App.render();
  });
};

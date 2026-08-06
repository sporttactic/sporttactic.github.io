/* Settings view */
window.Views = window.Views || {};

// ---- Full-fidelity JSON backup ----------------------------------------
// Every object store is read straight from IndexedDB (not the in-memory cache)
// and Blobs are base64-encoded, because JSON.stringify silently turns a Blob
// into `{}` — that is how recorded animation clips used to vanish from backups.
const BACKUP_FORMAT = 2;
const blobToB64 = blob => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1] || '');
  r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});
function b64ToBlob(b64, type) {
  const bin = atob(b64), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type: type || 'application/octet-stream' });
}
async function packValue(v) {
  if (v == null || typeof v !== 'object') return v;
  if (v instanceof Blob) return { __blob: 1, type: v.type, size: v.size, data: await blobToB64(v) };
  if (v instanceof ArrayBuffer) return { __blob: 1, type: '', size: v.byteLength, data: await blobToB64(new Blob([v])) };
  if (v instanceof Date) return { __date: 1, iso: v.toISOString() };
  if (Array.isArray(v)) { const out = []; for (const x of v) out.push(await packValue(x)); return out; }
  const out = {};
  for (const k of Object.keys(v)) out[k] = await packValue(v[k]);
  return out;
}
function unpackValue(v) {
  if (v == null || typeof v !== 'object') return v;
  if (v.__blob) return b64ToBlob(v.data || '', v.type);
  if (v.__date) return new Date(v.iso);
  if (Array.isArray(v)) return v.map(unpackValue);
  const out = {};
  for (const k of Object.keys(v)) out[k] = unpackValue(v[k]);
  return out;
}
async function buildBackup() {
  const data = {};
  const counts = {};
  for (const s of DB.STORES) {
    const rows = await DB.getAll(s);
    data[s] = await packValue(rows);
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
    await DB.bulkPut(s, unpackValue(data[s]));
  }
}
function downloadJson(json, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 20000);
}

Views.settings = async function (mount) {
  const theme = document.documentElement.getAttribute('data-theme');
  const role = await Store.getSetting('role', 'Coach');
  const sport = (window.App && App.getSport && App.getSport()) || 'handball';
  const isTeamSport = !!(window.SPORTS && SPORTS.isTeam && SPORTS.isTeam(sport));

  mount.innerHTML = `
    <div class="page-head"><div><h1>${T('settings.title')}</h1><p>${T('settings.subtitle')}</p></div></div>
    <div class="grid cols-2">
      <div class="card">
        <h3>${T('settings.appearance')}</h3>
        <label class="field"><span>${T('settings.theme')}</span><select id="s_theme"><option value="dark" ${theme === 'dark' ? 'selected' : ''}>${T('settings.dark')}</option><option value="light" ${theme === 'light' ? 'selected' : ''}>${T('settings.light')}</option></select></label>
      </div>
      <div class="card">
        <h3>${T('settings.roleAccess')}</h3>
        <label class="field"><span>${T('settings.activeRole')}</span><select id="s_role">${['Super Admin', 'Club Admin', 'Coach', 'Analyst', 'Player'].map(r => `<option value="${r}" ${r === role ? 'selected' : ''}>${T('role.' + r)}</option>`).join('')}</select></label>
        <p style="color:var(--muted);font-size:12px">${T('settings.roleHint')}</p>
      </div>
      <div class="card">
        <h3>${T('settings.dataSync')}</h3>
        <p style="color:var(--muted);font-size:13px">${T('settings.dataHint')}</p>
        <div class="row" style="flex:0;margin-top:10px;flex-wrap:wrap">
          <button class="btn" id="exportAll">${T('settings.exportBackup')}</button>
          <label class="btn" style="cursor:pointer">${T('settings.importBackup')}<input id="importAll" type="file" accept="application/json" hidden></label>
          <button class="btn" id="emailAll">${T('settings.sendCoach')}</button>
          <button class="btn danger" id="wipe">${T('settings.resetData')}</button>
        </div>
      </div>
      <div class="card">
        <h3>${T('settings.shortcuts')}</h3>
        <p style="font-size:13px;line-height:1.9">
          <span class="tag">1–9</span> ${T('settings.switchModules')} · <span class="tag">/</span> ${T('settings.focusSearch')} · <span class="tag">Esc</span> ${T('settings.closeDialog')}
        </p>
      </div>
    </div>
    ${isTeamSport ? messengerCard() : ''}`;

  function messengerCard() {
    return `
      <div class="card" style="margin-top:16px" id="messengerCard">
        <h3>${T('sync.messenger')}</h3>
        <p style="color:var(--muted);font-size:13px">${T('sync.messengerDesc')}</p>
        <div class="row" style="flex:0;margin-top:8px"><button class="btn primary" id="openMessenger">${T('sync.openMessenger')}</button></div>
      </div>`;
  }

  mount.querySelector('#s_theme').onchange = e => { App.setTheme(e.target.value); };
  mount.querySelector('#s_role').onchange = e => { Store.setSetting('role', e.target.value); document.getElementById('roleBadge').textContent = T('role.' + e.target.value); App.render(); };
  const openMsg = mount.querySelector('#openMessenger');
  if (openMsg) openMsg.onclick = () => App.go('messenger');

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
    const players = Store.all('players').length, matches = Store.all('matches').length, tactics = Store.all('tactics').length;
    const subject = encodeURIComponent('SportTactic data share');
    const body = encodeURIComponent(
      'Hi coach,\n\nI am sharing my SportTactic data with you.\n\n' +
      'Summary:\n- Players: ' + players + '\n- Matches: ' + matches + '\n- Tactics: ' + tactics + '\n\n' +
      'The data file (sporttactic-share.json) was just downloaded to my device — please attach it to this email before sending.\n' +
      'To load it: open SportTactic → Settings → Import Backup → select the JSON file.\n\nBest regards');
    window.location.href = 'mailto:?subject=' + subject + '&body=' + body;
    UI.toast('JSON downloaded — attach it to the email', 'success');
  };
  mount.querySelector('#wipe').onclick = () => UI.confirm(T('settings.resetConfirm'), async () => {
    for (const s of DB.STORES) await DB.clear(s);
    await Store.loadAll(); await Store.seedIfEmpty(); UI.toast('Data reset', 'success'); App.render();
  });
};

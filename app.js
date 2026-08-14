/* app.js — router, global search, autosave, theme, shortcuts, bootstrap */
const App = (() => {
  let currentRoute = 'dashboard';
  let cleanup = null;
  let currentSport = 'handball';
  const ROUTES = ['dashboard', 'teams', 'matches', 'planner', 'scouting', 'statistics', 'tactics', 'video', 'training', 'opponents', 'reports', 'settings'];
  // A strength discipline has no court to draw on, so only the board is dropped.
  const SOLO_SPORTS = ['crossfit', 'bodybuilding'];
  const SOLO_ROUTES = ROUTES.filter(r => r !== 'tactics');
  // The coach picks which modules to see; Settings can never be hidden, or the
  // list could not be reached again. Cached because applyNav/go are synchronous.
  const ALWAYS_ON = ['settings'];
  // Modules holding work a re-render would destroy: a running match clock, an
  // unsaved play, a video with telestration on it, an open chat.
  const LIVE_ROUTES = ['scouting', 'tactics', 'video', 'messenger'];
  let menuHidden = [];
  const menuOff = r => ALWAYS_ON.indexOf(r) < 0 && menuHidden.indexOf(r) >= 0;
  // A copy made with a team code shows what the coach left in its profile, on
  // top of whatever this device hid for itself.
  const memberOff = r => ALWAYS_ON.indexOf(r) < 0 &&
    !!(window.Access && Access.hiddenModules().indexOf(r) >= 0);
  const routesFor = id => (SOLO_SPORTS.indexOf(id) >= 0 ? SOLO_ROUTES : ROUTES)
    .filter(r => !menuOff(r) && !memberOff(r));
  function getMenuHidden() { return menuHidden.slice(); }
  function setMenuHidden(list) {
    menuHidden = (list || []).filter(r => ROUTES.indexOf(r) >= 0 && ALWAYS_ON.indexOf(r) < 0);
    Store.setSetting('menuHidden', menuHidden);
    applyNav();
    if (routesFor(currentSport).indexOf(currentRoute) < 0) go(currentRoute);
  }
  function applyNav() {
    const allow = routesFor(currentSport);
    document.querySelectorAll('.nav-item[data-route]').forEach(n => {
      n.classList.toggle('hidden', allow.indexOf(n.dataset.route) < 0);
    });
  }
  // Read mode is a whole-app state: the sidebar loses what the coach hid and
  // the stylesheet takes the write controls out of everything still on it.
  // It has to be re-read after ANY change — the role, the profile and the file
  // being followed all move it, and they move on their own screens.
  let memberState = null;
  function syncMemberMode() {
    const read = !!(window.Access && Access.readMode());
    const sig = (read ? 'read' : '') + '|' + (window.Access ? Access.hiddenModules().join(',') : '');
    if (sig === memberState) return false;
    memberState = sig;
    document.body.dataset.member = read ? 'read' : '';
    applyNav();
    return true;
  }
  function applyMemberMode() {
    syncMemberMode();
    if (routesFor(currentSport).indexOf(currentRoute) < 0) go(routesFor(currentSport)[0]);
  }

  // ---- Donations -------------------------------------------------------
  const PAYPAL_SDK = 'https://www.paypalobjects.com/donate/sdk/donate-sdk.js';
  const PAYPAL_BUTTON_ID = 'W4TPMMAK23SQ6';
  let paypalSdk = null;

  // Loaded on first use only — the app itself stays fully offline-capable.
  function loadPayPalSdk() {
    if (paypalSdk) return paypalSdk;
    paypalSdk = new Promise((resolve, reject) => {
      if (window.PayPal && PayPal.Donation) return resolve();
      const s = document.createElement('script');
      s.src = PAYPAL_SDK;
      s.charset = 'UTF-8';
      s.onload = () => (window.PayPal && PayPal.Donation) ? resolve() : reject(new Error('sdk'));
      s.onerror = () => reject(new Error('offline'));
      document.head.appendChild(s);
    });
    paypalSdk.catch(() => { paypalSdk = null; });
    return paypalSdk;
  }

  function openDonate() {
    UI.modal({
      title: '❤ ' + T('donate.title'),
      body: `<p>${T('donate.intro')}</p>
        <div id="donate-button-container"><div id="donate-button"></div></div>
        <p class="hint" id="donateStatus" style="margin-top:10px">${T('donate.thanks')}</p>`,
      footer: `<button class="btn" data-close2>${T('common.close')}</button>`,
      onOpen: (m, close) => {
        m.querySelector('[data-close2]').onclick = close;
        loadPayPalSdk().then(() => {
          if (!m.querySelector('#donate-button')) return;
          PayPal.Donation.Button({
            env: 'production',
            hosted_button_id: PAYPAL_BUTTON_ID,
            image: {
              src: 'https://www.paypalobjects.com/en_US/DK/i/btn/btn_donateCC_LG.gif',
              alt: 'Donate with PayPal button',
              title: 'PayPal - The safer, easier way to pay online!'
            }
          }).render('#donate-button');
        }).catch(() => {
          const st = m.querySelector('#donateStatus');
          if (st) st.textContent = T('donate.offline');
        });
      }
    });
  }

  function go(route, params) {
    if (!Views[route]) route = 'dashboard';
    // Never land on a module this sport does not have; 'messenger' is not in
    // ROUTES and is reachable from any sport, so it is left alone.
    syncMemberMode();
    const allow = routesFor(currentSport);
    if (ROUTES.indexOf(route) >= 0 && allow.indexOf(route) < 0) route = allow[0];
    if (cleanup) { try { cleanup(); } catch (e) {} cleanup = null; }
    currentRoute = route;
    // The stylesheet needs to know which module is on screen: the one a
    // read-only copy may still work in keeps its own buttons.
    document.body.dataset.route = route;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.route === route));
    const view = document.getElementById('view');
    view.innerHTML = '';
    const ret = Views[route](view, params);
    if (typeof ret === 'function') cleanup = ret;
    document.getElementById('sidebar').classList.remove('open');
  }

  function render() { go(currentRoute); }

  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    const svg = t === 'dark'
      ? '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>'
      : '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>';
    const tt = document.getElementById('themeToggle'); if (tt) tt.innerHTML = svg;
    Store.setSetting('theme', t);
  }

  function setLang(l) {
    I18N.setLang(l);
    Store.setSetting('lang', l);
    document.querySelectorAll('#langSwitch button').forEach(b => b.classList.toggle('active', b.dataset.lang === l));
    populateSportPicker();
    populateTeamPicker();
    Store.getSetting('role', 'Coach').then(role => {
      const rb = document.getElementById('roleBadge'); if (rb) rb.textContent = T('role.' + role) || role;
    });
    render();
  }

  function getSport() { return currentSport; }
  function setSport(id, silent) {
    currentSport = id;
    Store.setSetting('sport', id);
    updateSportPickerSelection();
    applyNav();
    populateTeamPicker();
    if (!silent) { render(); UI.toast(T('sport.changed') + ': ' + SPORTS.name(id, I18N.getLang()), 'success'); }
  }

  // ---- Active team ----
  // Every squad-bound view reads Store.players()/matches(), which are scoped to
  // this selection, so switching team switches the whole app over.
  function populateTeamPicker() {
    const host = document.getElementById('teamPicker');
    if (!host) return;
    const list = Store.teams();
    const active = Store.activeTeamId();
    host.classList.toggle('hidden', list.length < 1);
    host.innerHTML = `<label for="teamSelect">${T('teams.activeTeam')}</label>
      <select id="teamSelect">${list.map(t => `<option value="${UI.esc(t.id)}" ${t.id === active ? 'selected' : ''}>${UI.esc(t.name)}</option>`).join('') || `<option value="">${UI.esc(T('teams.noTeam'))}</option>`}</select>`;
    const sel = host.querySelector('#teamSelect');
    sel.onchange = () => {
      Store.setActiveTeam(sel.value);
      render();
      const t = Store.activeTeam();
      if (t) UI.toast(T('teams.teamChanged') + ': ' + t.name, 'success');
    };
  }
  // Chevron for the custom sport dropdown trigger.
  const SPORT_CHEV = '<svg class="sport-select-chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  // Builds a custom listbox (native <option> cannot show SVG) so every sport is
  // shown with its inline symbol next to the translated name.
  function populateSportPicker() {
    const host = document.getElementById('sportSelect');
    if (!host) return;
    const lang = I18N.getLang();
    const opt = s => `<li class="sport-select-opt${s.id === currentSport ? ' active' : ''}" role="option" data-sport="${s.id}" aria-selected="${s.id === currentSport}"><span class="sport-select-ico">${s.icon}</span><span class="sport-select-name">${SPORTS.name(s.id, lang)}</span></li>`;
    host.innerHTML =
      `<button type="button" class="sport-select-btn" id="sportSelectBtn" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="sportSelectLabel">` +
        `<span class="sport-select-ico">${SPORTS.get(currentSport).icon}</span>` +
        `<span class="sport-select-name">${SPORTS.name(currentSport, lang)}</span>` +
        SPORT_CHEV +
      `</button>` +
      `<ul class="sport-select-menu hidden" id="sportSelectMenu" role="listbox">${SPORTS.LIST.map(opt).join('')}</ul>`;
  }
  // Reflects the active sport on the trigger button + highlights the option.
  function updateSportPickerSelection() {
    const host = document.getElementById('sportSelect');
    if (!host) return;
    const lang = I18N.getLang();
    const ico = host.querySelector('.sport-select-btn .sport-select-ico');
    const nm = host.querySelector('.sport-select-btn .sport-select-name');
    if (ico) ico.innerHTML = SPORTS.get(currentSport).icon;
    if (nm) nm.textContent = SPORTS.name(currentSport, lang);
    host.querySelectorAll('.sport-select-opt').forEach(li => {
      const on = li.dataset.sport === currentSport;
      li.classList.toggle('active', on);
      li.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }
  function toggleSportMenu(open) {
    const menu = document.getElementById('sportSelectMenu');
    const btn = document.getElementById('sportSelectBtn');
    if (!menu || !btn) return;
    const willOpen = open == null ? menu.classList.contains('hidden') : open;
    menu.classList.toggle('hidden', !willOpen);
    btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  }

  // ---- Sound on/off (mutes all app sound effects) ----
  const SND_ON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14"/></svg>';
  const SND_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>';
  function setSound(on) {
    window.SoundOn = on;
    Store.setSetting('sound', on);
    const b = document.getElementById('soundToggle');
    if (b) { b.innerHTML = on ? SND_ON : SND_OFF; b.title = on ? T('sound.on') : T('sound.off'); b.classList.toggle('muted', !on); }
  }

  // ---- Global search ----
  function search(q) {
    q = q.trim().toLowerCase();
    const box = document.getElementById('searchResults');
    if (!q) { box.classList.add('hidden'); return; }
    const results = [];
    const add = (cat, label, route, params) => results.push({ cat, label, route, params });
    Store.players().forEach(p => { if ((p.firstName + ' ' + p.lastName).toLowerCase().includes(q)) add(T('search.player'), `#${p.number} ${p.firstName} ${p.lastName}`, 'teams'); });
    Store.matches().forEach(m => { if (m.opponent.toLowerCase().includes(q)) add(T('search.match'), `${m.opponent} · ${UI.fmtDate(m.date)}`, 'matches'); });
    Store.all('exercises').forEach(e => { if (e.title.toLowerCase().includes(q) || (e.tags || []).join(' ').toLowerCase().includes(q)) add(T('search.exercise'), e.title, 'training'); });
    Store.scoped('training').forEach(t => { if (t.title.toLowerCase().includes(q)) add(T('search.training'), t.title, 'training'); });
    Store.scoped('opponents').forEach(o => { if (o.name.toLowerCase().includes(q)) add(T('search.opponent'), o.name, 'opponents'); });
    Store.all('tactics').forEach(t => { if ((t.name || '').toLowerCase().includes(q)) add(T('search.tactic'), t.name, 'tactics'); });

    box.innerHTML = results.length ? results.slice(0, 12).map((r, i) =>
      `<div class="sr-item" data-i="${i}"><div class="sr-cat">${UI.esc(r.cat)}</div>${UI.esc(r.label)}</div>`).join('')
      : `<div class="sr-item">${UI.esc(T('search.none'))}</div>`;
    box.classList.remove('hidden');
    box.querySelectorAll('[data-i]').forEach(el => el.onclick = () => {
      const r = results[+el.dataset.i]; box.classList.add('hidden');
      document.getElementById('globalSearch').value = ''; go(r.route, r.params);
    });
  }

  function bindChrome() {
    document.getElementById('mainNav').addEventListener('click', e => {
      const item = e.target.closest('.nav-item'); if (item) go(item.dataset.route);
    });
    document.getElementById('menuToggle').onclick = () => document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('themeToggle').onclick = () => {
      const t = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'; setTheme(t);
    };
    const ntt = document.getElementById('navThemeToggle');
    if (ntt) ntt.onclick = () => {
      const t = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'; setTheme(t);
    };
    const ls = document.getElementById('langSwitch');
    if (ls) ls.addEventListener('click', e => { const b = e.target.closest('button'); if (b) setLang(b.dataset.lang); });
    const db = document.getElementById('donateBtn');
    if (db) db.onclick = openDonate;
    const sp = document.getElementById('sportSelect');
    if (sp) sp.addEventListener('click', e => {
      const optn = e.target.closest('.sport-select-opt');
      if (optn) { toggleSportMenu(false); setSport(optn.dataset.sport); return; }
      if (e.target.closest('.sport-select-btn')) toggleSportMenu();
    });
    const st = document.getElementById('soundToggle');
    if (st) st.onclick = () => setSound(window.SoundOn === false);
    const gs = document.getElementById('globalSearch');
    gs.addEventListener('input', () => search(gs.value));
    document.addEventListener('click', e => { if (!e.target.closest('.search-box')) document.getElementById('searchResults').classList.add('hidden'); });
    document.addEventListener('click', e => { if (!e.target.closest('#sportSelect')) toggleSportMenu(false); });

    document.addEventListener('keydown', e => {
      if (e.target.matches('input,textarea,select')) { if (e.key === 'Escape') e.target.blur(); return; }
      if (e.key === '/') { e.preventDefault(); gs.focus(); }
      else if (e.key === 'Escape') { toggleSportMenu(false); const h = document.getElementById('modalHost'); if (!h.classList.contains('hidden') && !h.hasAttribute('data-locked')) { h.classList.add('hidden'); h.innerHTML = ''; } }
      else if (/^[1-9]$/.test(e.key)) { const r = routesFor(currentSport)[+e.key - 1]; if (r) go(r); }
    });
  }

  // ---- Autosave indicator (data persists immediately; this reflects status) ----
  function startAutosave() {
    const ind = document.getElementById('autosaveIndicator');
    Store.onChange(() => { ind.textContent = T('autosave.saving'); setTimeout(() => ind.textContent = T('autosave.saved'), 400); });
    setInterval(() => { ind.textContent = T('autosave.auto'); setTimeout(() => ind.textContent = T('autosave.saved'), 1500); }, 30000);
  }

  // A backup exported with a pass key opens read-only; the badge is the way
  // back. A copy made with a look-only team code wears the same badge, but the
  // way back is the coach, not a pass key.
  function refreshLockBadge() {
    const b = document.getElementById('lockBadge');
    if (!b) return;
    const locked = Store.locked();
    const member = !locked && window.Access && Access.readMode();
    b.classList.toggle('hidden', !locked && !member);
    if (!locked && !member) return;
    b.querySelector('span').textContent = T(member ? 'mem.badge' : 'lock.badge');
    b.title = T(member ? 'mem.blocked' : 'lock.cardHint');
    b.onclick = member
      ? () => UI.toast(T('mem.blocked'), 'error')
      : () => { if (window.Backup && Backup.unlock) Backup.unlock(); };
  }

  // The one button a player needs: everybody who follows a shared file gets it
  // in the topbar, next to the language switch.
  function refreshSyncBtn() {
    const b = document.getElementById('topSync');
    if (!b) return;
    const on = !!(window.TeamCloud && TeamCloud.cfg().fileId);
    b.classList.toggle('hidden', !on);
    if (!on) return;
    b.title = T('cloud.syncNow');
    b.setAttribute('aria-label', T('cloud.syncNow'));
  }
  async function runTopSync() {
    const b = document.getElementById('topSync');
    if (!b || b.classList.contains('busy')) return;
    // No read key and no live Google session means the file cannot be opened at
    // all. A sign-in needs this very click, so it is offered before the attempt
    // rather than after it fails.
    if (!TeamCloud.canSyncQuietly() && window.Drive && !Drive.isConnected()
      && typeof offerDriveConnect === 'function') { offerDriveConnect(); return; }
    b.classList.add('busy');
    try {
      // Anything that came down is announced by the onChange handler above, so
      // this only speaks up when there was nothing to say.
      const got = await TeamCloud.sync();
      if (!got) UI.toast(T('cloud.upToDate'), 'success');
    } catch (e) {
      const key = e && e.oversize ? (TeamCloud.cfg().owner ? 'cloud.oversizeOwner' : 'cloud.oversize')
        : (e && e.message === 'signin') ? 'cloud.signinNeeded' : '';
      UI.toast(key ? T(key) : T('cloud.syncFail') + ' — ' + ((e && e.message) || e), 'error');
    } finally { b.classList.remove('busy'); }
  }

  async function boot() {
    await Store.loadAll();
    await Store.purgeDemoPlayers();
    await Store.purgeSeedDrills();
    await Store.purgeSeedMatches();
    await Store.purgeSeedClub();
    const theme = await Store.getSetting('theme', 'dark');
    setTheme(theme);
    const lang = await Store.getSetting('lang', 'en');
    setLang(lang);
    const role = await Store.getSetting('role', 'Coach');
    document.getElementById('roleBadge').textContent = T('role.' + role) || role;
    setSound(await Store.getSetting('sound', true));
    currentSport = await Store.getSetting('sport', 'handball');
    const hidden = await Store.getSetting('menuHidden', []);
    menuHidden = Array.isArray(hidden) ? hidden.filter(r => ROUTES.indexOf(r) >= 0) : [];
    // Players registered before squads became sport-bound keep the sport in use.
    await Store.stampSquadSport(currentSport);
    // Rows made before teams were separated are handed to the first team.
    await Store.stampTeamScope();
    populateSportPicker();
    populateTeamPicker();
    applyNav();
    bindChrome();
    refreshLockBadge();
    Store.onChange(refreshLockBadge);
    Store.onChange(syncMemberMode);
    refreshSyncBtn();
    const sb = document.getElementById('topSync');
    if (sb) sb.onclick = runTopSync;
    // The profile arrives with the shared file, so a sync can turn read mode on
    // (or off) while the app is open.
    if (window.TeamCloud) TeamCloud.onChange(info => {
      refreshLockBadge();
      applyMemberMode();
      refreshSyncBtn();
      if (info && info.revoked) { UI.toast(T('cloud.revoked'), 'error'); render(); return; }
      // Rows landed from a background pull, so the view on screen was built
      // from the old ones. Redraw it — but not over a dialog, and not over the
      // modules that hold live work a redraw would throw away: a running match
      // clock, an unsaved play, a video with drawings on it.
      if (!info || !info.pulled) return;
      UI.toast(T('cloud.freshened').replace('{0}', info.pulled), 'success');
      const host = document.getElementById('modalHost');
      if (host && !host.classList.contains('hidden')) return;
      if (LIVE_ROUTES.indexOf(currentRoute) >= 0) return;
      render();
    });
    startAutosave();
    if (window.AUTOBK) AUTOBK.start();   // unattended backups, if the coach turned them on
    if (window.TeamCloud) TeamCloud.start();   // shared team database, if one is linked
    go('dashboard');
    applyMemberMode();
  }

  return { go, render, setTheme, setLang, getSport, setSport, populateTeamPicker, boot, ROUTES, getMenuHidden, setMenuHidden, applyMemberMode };
})();

// Expose globally so view modules (tactics, matches, …) can read/switch the
// active sport. `const App` alone does not attach to window.
window.App = App;

window.addEventListener('DOMContentLoaded', App.boot);

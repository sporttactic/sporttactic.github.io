/* mobile.js — phone layout: device detection, bottom tab bar, drawer chrome and
   the team-code shortcut.

   The desktop shell (a 250px sidebar that is always open plus a wide topbar) is
   unusable on a 5" screen, so a phone gets its own chrome instead: a bottom tab
   bar for the modules people actually open on the move, the sidebar as a drawer
   for the rest, and a "Join with a team code" button that is reachable BEFORE
   any data exists — which is the whole point for a player who was just sent a
   code by their coach.

   Everything here is additive. No desktop markup is edited: the chrome is built
   when phone mode turns on and removed again when it turns off, so a tablet or a
   laptop never carries it. The code targets 2020-era Safari/Chrome (iPhone 8/SE
   on iOS 13, Galaxy S10/S20 on Chrome 80): no optional chaining, no nullish
   coalescing, no replaceAll, no logical assignment.

   Layout can be forced either way with ?mobile=1 / ?desktop=1 or from
   Settings → Screen layout; the choice is remembered in localStorage. */
const Mobile = (() => {
  const LAYOUT_KEY = 'stx_layout';        // '' (auto) | 'mobile' | 'desktop'
  const WELCOME_KEY = 'stx_mob_welcomed';
  // Order the tabs are picked in — the first four the sport and the coach's menu
  // still allow become the bar, the rest stay in the drawer behind "More".
  const TAB_ORDER = ['dashboard', 'teams', 'matches', 'scouting', 'statistics',
    'training', 'tactics', 'video', 'planner', 'opponents', 'reports', 'settings'];
  const MAX_TABS = 4;
  const PHONE_MAX_W = 620;

  const ICO_MORE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
  const ICO_SEARCH = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>';

  let on = false;
  let booted = false;
  let watching = false;
  let tabSig = '';
  let langSig = '';
  let resizeTimer = null;

  const $ = id => document.getElementById(id);
  const esc = s => (window.UI && UI.esc) ? UI.esc(s) : String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // Translate with a fallback, because this file can run before i18n has a key.
  const tr = (key, fallback) => (window.T && T(key) !== key) ? T(key) : fallback;
  const ls = {
    get(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } },
    set(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { /* private mode */ } }
  };

  // ---- Which device is this? --------------------------------------------
  // Two independent signals, either is enough: the user agent says phone, or the
  // window is phone-narrow. The width test alone would catch an iPad in split
  // view; the UA test alone would miss a desktop browser dragged narrow.
  function uaPhone() {
    const ua = navigator.userAgent || '';
    if (/iPhone|iPod/i.test(ua)) return true;
    if (/Android/i.test(ua) && /Mobile/i.test(ua)) return true;
    return /Windows Phone|IEMobile|BlackBerry|BB10|Opera Mini/i.test(ua);
  }
  function narrow() {
    const w = window.innerWidth || document.documentElement.clientWidth || 0;
    return w > 0 && w <= PHONE_MAX_W;
  }
  const detect = () => uaPhone() || narrow();

  function mode() {
    const m = ls.get(LAYOUT_KEY);
    return (m === 'mobile' || m === 'desktop') ? m : 'auto';
  }
  function setMode(m) {
    ls.set(LAYOUT_KEY, (m === 'mobile' || m === 'desktop') ? m : '');
    apply();
  }
  function active() {
    const m = mode();
    if (m === 'mobile') return true;
    if (m === 'desktop') return false;
    return detect();
  }
  function readQuery() {
    const q = String(location.search || '');
    if (/[?&]mobile=1/.test(q)) ls.set(LAYOUT_KEY, 'mobile');
    else if (/[?&]desktop=1/.test(q)) ls.set(LAYOUT_KEY, 'desktop');
  }

  // ---- Team code carried in the link -------------------------------------
  // A coach shares one address — …/index.html?code=STX1-… — the phone opens it
  // and the join sheet is already filled in. Nothing to type on a small keyboard.
  function linkCode() {
    const src = String(location.search || '') + String(location.hash || '');
    const m = /[?&#](?:code|team|join)=([^&#\s]+)/.exec(src);
    if (!m) return '';
    try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
  }
  // The code carries the Drive file id and its read key, so it is taken out of
  // the address bar (and the back-history) the moment it has been handed over.
  function stripLink() {
    if (!window.history || !history.replaceState) return;
    try { history.replaceState(null, '', location.pathname); } catch (e) { /* file:// */ }
  }

  // ---- Chrome ------------------------------------------------------------
  function iconFor(route) {
    const n = document.querySelector('#mainNav .nav-item[data-route="' + route + '"] .ico');
    return n ? n.innerHTML : '';
  }
  const labelFor = route => tr('nav.' + route, route);

  // The sidebar is the single source of truth for what this sport, this coach's
  // module menu and a read-only team code leave visible.
  function visibleRoutes() {
    const out = [];
    const items = document.querySelectorAll('#mainNav .nav-item[data-route]');
    for (let i = 0; i < items.length; i++) {
      if (!items[i].classList.contains('hidden')) out.push(items[i].getAttribute('data-route'));
    }
    return out;
  }
  function tabRoutes() {
    const vis = visibleRoutes();
    const picked = [];
    for (let i = 0; i < TAB_ORDER.length && picked.length < MAX_TABS; i++) {
      if (vis.indexOf(TAB_ORDER[i]) >= 0) picked.push(TAB_ORDER[i]);
    }
    return picked;
  }

  function buildTabs() {
    const host = $('mobTabs');
    if (!host) return;
    const routes = tabRoutes();
    const sig = routes.join(',') + '|' + (window.I18N ? I18N.getLang() : '');
    if (sig === tabSig) return;
    tabSig = sig;
    let html = '';
    for (let i = 0; i < routes.length; i++) {
      html += '<button type="button" class="mob-tab" data-route="' + routes[i] + '">'
        + '<span class="mob-tab-ico">' + iconFor(routes[i]) + '</span>'
        + '<span class="mob-tab-lbl">' + esc(labelFor(routes[i])) + '</span></button>';
    }
    html += '<button type="button" class="mob-tab" data-more="1">'
      + '<span class="mob-tab-ico">' + ICO_MORE + '</span>'
      + '<span class="mob-tab-lbl">' + esc(tr('mob.more', 'More')) + '</span></button>';
    host.innerHTML = html;
    markActive();
  }

  function markActive() {
    const route = document.body.getAttribute('data-route') || '';
    const tabs = document.querySelectorAll('#mobTabs .mob-tab');
    let hit = false;
    for (let i = 0; i < tabs.length; i++) {
      const r = tabs[i].getAttribute('data-route');
      const isOn = !!r && r === route;
      tabs[i].classList.toggle('active', isOn);
      if (isOn) hit = true;
    }
    // Anything reached from the drawer lights "More" instead, so the bar never
    // looks like nothing is open.
    const more = document.querySelector('#mobTabs [data-more]');
    if (more) more.classList.toggle('active', !hit && !!route);
    const title = $('mobTitle');
    if (title) title.textContent = route ? labelFor(route) : 'SportTactic';
  }

  const openDrawer = () => { const s = $('sidebar'); if (s) s.classList.add('open'); };
  const closeDrawer = () => { const s = $('sidebar'); if (s) s.classList.remove('open'); };
  function syncDrawer() {
    const s = $('sidebar'), b = $('mobBackdrop');
    if (s && b) b.classList.toggle('show', s.classList.contains('open'));
  }

  // The search field would eat a whole row of a phone topbar, so it folds out of
  // a button instead of sitting there permanently.
  function toggleSearch() {
    const openNow = document.body.classList.toggle('mob-search');
    const inp = $('globalSearch');
    if (!inp) return;
    if (openNow) inp.focus();
    else {
      inp.value = '';
      const r = $('searchResults');
      if (r) r.classList.add('hidden');
    }
  }

  function build() {
    const app = $('app');
    if (!app || $('mobTabs')) return;

    const back = document.createElement('div');
    back.id = 'mobBackdrop';
    back.className = 'mob-backdrop';
    back.addEventListener('click', closeDrawer);
    app.appendChild(back);

    const tabs = document.createElement('nav');
    tabs.id = 'mobTabs';
    tabs.className = 'mob-tabs';
    tabs.setAttribute('aria-label', tr('mob.tabs', 'Modules'));
    tabs.addEventListener('click', e => {
      const b = e.target.closest ? e.target.closest('.mob-tab') : null;
      if (!b) return;
      if (b.getAttribute('data-more')) return openDrawer();
      const r = b.getAttribute('data-route');
      if (r && window.App) App.go(r);
    });
    app.appendChild(tabs);

    const bar = document.querySelector('.topbar');
    const menu = $('menuToggle');
    if (bar && menu) {
      const title = document.createElement('div');
      title.id = 'mobTitle';
      title.className = 'mob-title';
      bar.insertBefore(title, menu.nextSibling);
      const sb = document.createElement('button');
      sb.type = 'button';
      sb.id = 'mobSearchBtn';
      sb.className = 'icon-btn mob-search-btn';
      sb.setAttribute('aria-label', tr('mob.search', 'Search'));
      sb.innerHTML = ICO_SEARCH;
      sb.addEventListener('click', toggleSearch);
      const acts = bar.querySelector('.topbar-actions');
      if (acts) acts.insertBefore(sb, acts.firstChild); else bar.appendChild(sb);
    }

    buildDrawerActions();
    moveLangSwitch(true);
    buildTabs();
    syncDrawer();
    watch();
  }

  // The topbar has no room for the flags on a phone, and hiding them would leave
  // the app stuck in one language — so they move to the drawer instead. The click
  // handler lives on the element itself, so it survives the move.
  function moveLangSwitch(toDrawer) {
    const sw = $('langSwitch');
    if (!sw) return;
    const target = toDrawer
      ? document.querySelector('#sidebar .nav-controls')
      : document.querySelector('.topbar .topbar-actions');
    if (target && sw.parentNode !== target) target.insertBefore(sw, target.firstChild);
  }

  function teardown() {
    moveLangSwitch(false);
    const ids = ['mobTabs', 'mobBackdrop', 'mobTitle', 'mobSearchBtn', 'mobActions'];
    for (let i = 0; i < ids.length; i++) {
      const n = $(ids[i]);
      if (n && n.parentNode) n.parentNode.removeChild(n);
    }
    document.body.classList.remove('mob-search');
    closeDrawer();
    tabSig = '';
  }

  // ---- Team code, front and centre ---------------------------------------
  function buildDrawerActions() {
    const nav = $('mainNav');
    const side = $('sidebar');
    if (!nav || !side || $('mobActions')) return;
    const box = document.createElement('div');
    box.id = 'mobActions';
    box.className = 'mob-actions';
    side.insertBefore(box, nav);
    box.addEventListener('click', e => {
      const b = e.target.closest ? e.target.closest('button') : null;
      if (!b) return;
      closeDrawer();
      if (b.id === 'mobJoin') join();
      else if (b.id === 'mobSync') syncNow();
      else if (b.id === 'mobInstall') STXInstall.guide();
    });
    refreshActions();
  }
  function refreshActions() {
    const box = $('mobActions');
    if (!box) return;
    const linked = !!(window.TeamCloud && TeamCloud.isLinked());
    // A phone is where the home-screen icon matters most, so the offer sits in
    // the drawer until it has been taken up.
    const canAdd = !!(window.STXInstall && STXInstall.canInstall());
    box.innerHTML =
      '<button type="button" class="btn primary block" id="mobJoin">' + esc(tr('cloud.joinBtn', 'Join with a team code')) + '</button>'
      + (linked ? '<button type="button" class="btn block" id="mobSync">' + esc(tr('cloud.syncNow', 'Sync now')) + '</button>' : '')
      + (canAdd ? '<button type="button" class="btn block" id="mobInstall">⬇ ' + esc(tr('ins.title', 'Add to Home Screen')) + '</button>' : '');
  }

  // Reuses the one join dialog in settings.js so there is a single code path for
  // parsing, pulling and attaching the squad — the sheet is only styled
  // differently on a phone.
  function join(prefill) {
    if (typeof window.cloudJoinDialog !== 'function') {
      if (window.App) App.go('settings');
      return;
    }
    cloudJoinDialog(() => { refreshActions(); if (window.App) App.render(); });
    if (!prefill) return;
    const ta = $('jn_code');
    if (ta) { ta.value = prefill; ta.focus(); }
  }

  function syncNow() {
    if (!window.TeamCloud || !TeamCloud.isLinked()) return;
    UI.toast(tr('cloud.working', 'Working\u2026'), 'success');
    TeamCloud.sync().then(() => {
      UI.toast(tr('cloud.synced', 'Synced'), 'success');
      // A sync rewrites every store under the open view, same as Settings does.
      setTimeout(() => location.reload(), 900);
    }, e => UI.toast(String((e && e.message) || e).slice(0, 200), 'error'));
  }

  // First run on a phone with nothing in it: the one question worth asking is
  // whether they were given a code.
  function welcome() {
    if (!window.UI || !UI.modal) return;
    UI.modal({
      title: tr('mob.welcomeTitle', 'Get your team onto this phone'),
      body: '<p>' + esc(tr('mob.welcomeIntro', 'If your coach sent you a team code, paste it here and everything they share lands on this phone — squad, matches, training and tactics. It keeps working without a signal.')) + '</p>'
        + '<p class="hint">' + esc(tr('mob.welcomeHint', 'No code? Skip this and set the team up yourself. You can join later from the menu.')) + '</p>',
      footer: '<button class="btn ghost" data-later>' + esc(tr('mob.later', 'Not now')) + '</button>'
        + '<button class="btn primary" data-code>' + esc(tr('cloud.joinBtn', 'Join with a team code')) + '</button>',
      onOpen: (m, close) => {
        const done = () => { ls.set(WELCOME_KEY, '1'); close(); };
        m.querySelector('[data-later]').onclick = done;
        m.querySelector('[data-code]').onclick = () => { done(); join(); };
      }
    });
  }

  // ---- Wiring ------------------------------------------------------------
  // Route, language and module visibility all move on their own — one pass that
  // re-reads the lot is cheaper to reason about than three separate hooks.
  function sync() {
    const lang = window.I18N ? I18N.getLang() : '';
    if (lang !== langSig) { langSig = lang; refreshActions(); }
    buildTabs();
    markActive();
  }

  function watch() {
    if (watching || !window.MutationObserver) return;
    watching = true;
    new MutationObserver(sync)
      .observe(document.body, { attributes: true, attributeFilter: ['data-route', 'data-member'] });
    const nav = $('mainNav');
    // applyNav() hides modules per sport / per team code — the bar follows it.
    if (nav) new MutationObserver(buildTabs)
      .observe(nav, { attributes: true, subtree: true, attributeFilter: ['class'] });
    const side = $('sidebar');
    if (side) new MutationObserver(syncDrawer)
      .observe(side, { attributes: true, attributeFilter: ['class'] });
  }

  function apply() {
    const want = active();
    document.body.setAttribute('data-mobile', want ? '1' : '');
    if (want) build(); else teardown();
    on = want;
    if (want) sync();
  }

  // Runs once the store is loaded and the first route is on screen.
  function afterBoot() {
    if (booted) return;
    booted = true;
    refreshActions();
    if (window.TeamCloud && TeamCloud.onChange) TeamCloud.onChange(refreshActions);
    const code = linkCode();
    if (code) {
      stripLink();
      join(code);
      if (window.UI && UI.toast) UI.toast(tr('mob.codeInLink', 'Team code read from the link \u2014 press Join'), 'success');
      return;
    }
    if (!on || ls.get(WELCOME_KEY)) return;
    // Store is a top-level const, so it is a global binding but NOT a property
    // of window — testing window.Store would report "empty device" every time.
    const noData = typeof Store === 'undefined' || !Store.all('teams').length;
    const unlinked = !window.TeamCloud || !TeamCloud.isLinked();
    if (noData && unlinked) welcome();
  }

  function init() {
    readQuery();
    apply();
    // App.boot() is async and ends by routing to the dashboard, which is the
    // first moment the store is readable and a code from the link can be used.
    if (document.body.getAttribute('data-route')) return afterBoot();
    if (!window.MutationObserver) return setTimeout(afterBoot, 3000);
    const mo = new MutationObserver(() => {
      if (!document.body.getAttribute('data-route')) return;
      mo.disconnect();
      afterBoot();
    });
    mo.observe(document.body, { attributes: true, attributeFilter: ['data-route'] });
  }

  function schedule() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(apply, 200);
  }
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', init);
  else init();

  return { active: () => on, mode, setMode, apply, join, detect };
})();
window.Mobile = Mobile;

/* ui.js — shared UI helpers */
const UI = (() => {
  const ICONS = {
    close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    up: '<polyline points="6 15 12 9 18 15"/>',
    down: '<polyline points="6 9 12 15 18 9"/>',
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 6 10 7L22 6"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    play: '<polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
    rec: '<circle cx="12" cy="12" r="7" fill="currentColor" stroke="none"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    film: '<rect x="2" y="2" width="20" height="20" rx="2"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/>',
    bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
    printer: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
    dumbbell: '<path d="M6 7v10M18 7v10M3 9v6M21 9v6M6 12h12"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'
  };
  function icon(name, size = 16) {
    const p = ICONS[name] || '';
    return `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function toast(msg, type = '') {
    let host = document.getElementById('toastHost');
    // Keep toasts visible when a view is in the Fullscreen API. The host is
    // moved into that element, so a view torn down while still fullscreen takes
    // it with it — then it is simply put back.
    if (!host) {
      host = el('<div id="toastHost" class="toast-host"></div>');
      document.body.appendChild(host);
    }
    const fsEl = document.fullscreenElement;
    if (fsEl && !fsEl.contains(host)) fsEl.appendChild(host);
    else if (!fsEl && host.parentNode !== document.body) document.body.appendChild(host);
    const t = el(`<div class="toast ${type}">${esc(msg)}</div>`);
    host.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 250); }, 2600);
  }

  // Translate helper that tolerates i18n not being loaded yet.
  function tr(key, fallback) { return (typeof T === 'function' && T(key)) || fallback; }

  function modal({ title, body, footer, onOpen, width, fullscreen }) {
    const host = document.getElementById('modalHost');
    host.innerHTML = '';
    // Every dialog is locked: no X, no backdrop click, no Escape. The only way
    // out is one of its own footer buttons (Cancel / Close), so nothing is ever
    // dismissed by accident.
    // When a view is in the Fullscreen API, only descendants of the fullscreen
    // element are visible — so move the modal host inside it while open.
    // Detect across vendor prefixes so it also works in WebKit/Firefox.
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement || null;
    const homeParent = host.parentNode;
    if (fsEl && !fsEl.contains(host)) fsEl.appendChild(host);
    const fsBtn = fullscreen
      ? `<button class="icon-btn fs-btn" data-fs type="button" title="${esc(tr('common.fullscreen', 'Full Screen'))}" aria-label="${esc(tr('common.fullscreen', 'Full Screen'))}">\u26f6</button>`
      : '';
    const m = el(`
      <div class="modal" style="${width ? 'max-width:' + width + 'px' : ''}">
        <div class="modal-head"><h2>${esc(title)}</h2><div class="modal-head-actions">${fsBtn}</div></div>
        <div class="modal-body"></div>
        ${footer ? '<div class="modal-foot"></div>' : ''}
      </div>`);
    m.querySelector('.modal-body').innerHTML = body || '';
    if (footer) m.querySelector('.modal-foot').innerHTML = footer;
    host.appendChild(m);
    host.classList.remove('hidden');
    host.setAttribute('data-locked', '1');
    const detachFs = fullscreen ? setupModalFullscreen(m) : null;
    const close = () => {
      if (detachFs) detachFs();
      host.classList.add('hidden'); host.innerHTML = ''; host.removeAttribute('data-locked');
      if (host.parentNode !== homeParent) homeParent.appendChild(host); // restore original position
    };
    host.onclick = null;
    if (onOpen) onOpen(m, close);
    return { root: m, close };
  }

  // Wires up the modal's full-screen toggle button. Uses the native Fullscreen
  // API on desktop / Android / newer iPadOS; on older iPads & iOS Safari (which
  // expose no element-level Fullscreen API) it falls back to a CSS class that
  // fills the viewport, so the bot games are still playable full-screen there.
  function setupModalFullscreen(m) {
    const btn = m.querySelector('[data-fs]');
    if (!btn) return null;
    const req = m.requestFullscreen || m.webkitRequestFullscreen || m.webkitRequestFullScreen || m.msRequestFullscreen || null;
    const exit = document.exitFullscreen || document.webkitExitFullscreen || document.webkitCancelFullScreen || document.msExitFullscreen || null;
    const nativeSupported = !!(req && exit);
    let cssFs = false; // CSS-fallback full screen active (old iPad / iOS)

    function nativeEl() { return document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement || null; }
    function isOn() { return nativeEl() === m || cssFs; }
    function sync() {
      const on = isOn();
      m.classList.toggle('modal-fs', on);
      btn.classList.toggle('on', on);
      const label = tr(on ? 'common.exitFullscreen' : 'common.fullscreen', on ? 'Exit Full Screen' : 'Full Screen');
      btn.title = label; btn.setAttribute('aria-label', label);
    }
    function enterCss() { cssFs = true; sync(); }
    function toggle() {
      if (nativeEl() === m) { exit.call(document); return; }   // leave native full screen
      if (cssFs) { cssFs = false; sync(); return; }            // leave CSS fallback
      if (nativeSupported) {
        let p;
        try { p = req.call(m); } catch (e) { enterCss(); return; }
        if (p && typeof p.catch === 'function') p.catch(enterCss); // rejected (e.g. iOS) → fallback
      } else {
        enterCss();
      }
    }
    btn.onclick = toggle;
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    document.addEventListener('MSFullscreenChange', sync);
    sync();
    return function detach() {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
      document.removeEventListener('MSFullscreenChange', sync);
      if (nativeEl() === m && exit) { try { exit.call(document); } catch (e) { } }
      cssFs = false;
      m.classList.remove('modal-fs');
    };
  }

  function confirm(msg, onYes) {
    modal({
      title: tr('common.confirmTitle', 'Please confirm'),
      body: `<p>${esc(msg)}</p>`,
      // Answering a question is not the same as starting a change: read mode
      // takes away the buttons that OPEN a dialog, never the one that closes it.
      footer: `<button class="btn ghost" data-no>${esc(tr('common.cancel', 'Cancel'))}</button>`
        + `<button class="btn danger" data-yes data-member-ok>${esc(tr('common.confirm', 'Confirm'))}</button>`,
      onOpen: (m, close) => {
        m.querySelector('[data-no]').onclick = close;
        m.querySelector('[data-yes]').onclick = () => { close(); onYes(); };
      }
    });
  }

  function fmtDate(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function fmtClock(sec) {
    const m = Math.floor(sec / 60), s = sec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function statCard(val, lbl, trend) {
    return `<div class="card stat-card"><div class="val">${esc(val)}</div><div class="lbl">${esc(lbl)}</div>${trend ? `<div class="trend ${trend.dir}">${icon(trend.dir === 'up' ? 'up' : 'down', 14)} ${esc(trend.text)}</div>` : ''}</div>`;
  }

  function initials(a, b) { return (((a || '?')[0] || '?') + ((b || '')[0] || '')).toUpperCase(); }

  // ---- Multi-language record text ----------------------------------------
  // A drill can carry its own wording per language in `tr` — tr.da.title and so
  // on. Falls back to the field as it was typed, so an untranslated record and
  // everything made before this still read correctly.
  function langText(rec, field) {
    const lang = (window.I18N && I18N.getLang && I18N.getLang()) || 'en';
    const t = rec && rec.tr && rec.tr[lang];
    const v = t && t[field];
    return (typeof v === 'string' && v.trim()) ? v : ((rec && rec[field]) || '');
  }
  // The languages a record has text for, in DICT order.
  function langsOf(rec) {
    return Object.keys((rec && rec.tr) || {}).filter(l => {
      const t = rec.tr[l];
      return t && typeof t.title === 'string' && t.title.trim();
    });
  }

  // ---- Videos -------------------------------------------------------------
  // Only http(s) links may reach an href — blocks javascript:/data: payloads.
  function safeUrl(u) {
    const s = String(u || '').trim();
    if (!s) return '';
    try { const p = new URL(s); return (p.protocol === 'http:' || p.protocol === 'https:') ? p.href : ''; }
    catch { return ''; }
  }
  function ytId(u) {
    const s = safeUrl(u);
    if (!s) return '';
    let id = '';
    try {
      const p = new URL(s), host = p.hostname.replace(/^www\.|^m\./, '').toLowerCase();
      if (host === 'youtu.be') id = p.pathname.slice(1);
      else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
        const seg = p.pathname.split('/').filter(Boolean);
        id = p.searchParams.get('v') || (['shorts', 'embed', 'live', 'v'].indexOf(seg[0]) >= 0 ? seg[1] : '');
      }
    } catch { return ''; }
    return /^[\w-]{5,20}$/.test(id || '') ? id : '';
  }
  // Google Drive: /file/d/<id>/view, /open?id=<id> and /uc?id=<id> all play at /preview.
  function driveId(u) {
    const s = safeUrl(u);
    if (!s) return '';
    let id = '';
    try {
      const p = new URL(s);
      if (p.hostname.replace(/^www\./, '').toLowerCase() !== 'drive.google.com') return '';
      const seg = p.pathname.split('/').filter(Boolean);
      const i = seg.indexOf('d');
      id = (i >= 0 ? seg[i + 1] : '') || p.searchParams.get('id') || '';
    } catch { return ''; }
    return /^[\w-]{10,80}$/.test(id || '') ? id : '';
  }
  // The embed address for a link we recognise, or '' — nothing else may ever
  // reach an iframe src.
  function videoSrc(u) {
    const y = ytId(u);
    if (y) return 'https://www.youtube.com/embed/' + y + '?rel=0';
    const d = driveId(u);
    if (d) return 'https://drive.google.com/file/d/' + d + '/preview';
    return '';
  }
  // Every link on a drill, the two old single fields included.
  function videosOf(rec) {
    const all = (Array.isArray(rec && rec.videos) ? rec.videos : []).concat([rec && rec.videoYt, rec && rec.videoUrl]);
    const out = [];
    all.map(safeUrl).forEach(u => { if (u && out.indexOf(u) < 0) out.push(u); });
    return out.slice(0, 8);
  }
  function videoEmbed(rec, max) {
    const title = langText(rec, 'title') || 'video';
    return videosOf(rec).filter(videoSrc).slice(0, max || 4).map(u => playerHtml(u, title)).join('');
  }
  // A poster with a play button, not a live iframe. YouTube answers an embed
  // request with "Error 153 — video player configuration error" whenever it
  // cannot see the embedding page (opened straight from a file, referrer
  // stripped, embedding turned off for that clip), and the coach was left
  // looking at that instead of the drill. The frame is only inserted on the
  // click, and where it cannot work the same click opens YouTube itself.
  const CAN_EMBED = location.protocol === 'http:' || location.protocol === 'https:';
  function playerHtml(u, title) {
    const y = ytId(u);
    const open = `<a class="v-open" href="${esc(u)}" target="_blank" rel="noopener noreferrer" title="${esc(tr('exercises.openVideo', 'Open in a new tab'))}">↗</a>`;
    const play = `<button type="button" class="v-play" aria-label="${esc(tr('exercises.playVideo', 'Play'))}">▶</button>`;
    if (y) {
      return `<div class="ex-embed lite" data-play="${esc(u)}">
        <img src="https://i.ytimg.com/vi/${esc(y)}/hqdefault.jpg" alt="${esc(title)}" loading="lazy">${play}${open}</div>`;
    }
    return `<div class="ex-embed lite drive" data-play="${esc(u)}"><span class="v-lbl">${esc(tr('exercises.drive', 'Google Drive'))}</span>${play}${open}</div>`;
  }
  // One listener for every player the app renders, wherever it was inserted.
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('.ex-embed .v-open');
    if (a) return;                                   // the corner link opens on its own
    const box = e.target.closest && e.target.closest('.ex-embed[data-play]');
    if (!box) return;
    const u = box.dataset.play, src = videoSrc(u);
    if (!CAN_EMBED || !src) { window.open(u, '_blank', 'noopener'); return; }
    const img = box.querySelector('img');
    const title = img ? img.alt : 'video';
    box.classList.remove('lite', 'drive');
    box.removeAttribute('data-play');
    box.innerHTML = `<iframe src="${esc(src + (src.indexOf('?') >= 0 ? '&' : '?') + 'autoplay=1')}" title="${esc(title)}"
      allowfullscreen referrerpolicy="strict-origin-when-cross-origin"
      allow="autoplay; accelerometer; encrypted-media; picture-in-picture; web-share"></iframe>`;
  });
  // An editable list of video links — used by the drill form and wherever the
  // app shows links it generated, so a wrong one can always be fixed or removed.
  const MAX_VIDEOS = 8;
  function videoRow(u) {
    return `<div class="vid-row"><input type="url" inputmode="url" placeholder="${esc(tr('exercises.videoPh', ''))}" value="${esc(u || '')}">`
      + `<button type="button" class="btn sm danger" data-rmvid title="${esc(tr('common.delete', 'Delete'))}">✕</button></div>`;
  }
  function videoEditor(list) {
    const rows = (list && list.length ? list : ['']).map(videoRow).join('');
    return `<div class="vid-list" data-vids><div class="vid-rows">${rows}</div>`
      + `<button type="button" class="btn sm" data-addvid>+ ${esc(tr('exercises.addVideo', 'Add video'))}</button></div>`;
  }
  function readVideos(box) {
    return box ? [...box.querySelectorAll('input')].map(i => i.value.trim()).filter(Boolean) : [];
  }
  // onChange(box) fires whenever a link is typed, added or removed.
  function bindVideos(host, onChange) {
    host.querySelectorAll('[data-vids]').forEach(box => {
      const rows = box.querySelector('.vid-rows');
      const fire = () => { if (onChange) onChange(box); };
      const wire = row => {
        const inp = row.querySelector('input');
        inp.addEventListener('change', fire);
        inp.addEventListener('blur', fire);
        row.querySelector('[data-rmvid]').onclick = () => {
          if (rows.children.length > 1) row.remove(); else inp.value = '';
          fire();
        };
      };
      [...rows.children].forEach(wire);
      box.querySelector('[data-addvid]').onclick = () => {
        if (rows.children.length >= MAX_VIDEOS) return toast(tr('exercises.videosMax', ''), 'error');
        rows.insertAdjacentHTML('beforeend', videoRow(''));
        wire(rows.lastElementChild);
        rows.lastElementChild.querySelector('input').focus();
      };
    });
  }

  // ---- Share bar ---------------------------------------------------------
  // Export / import for a single module (drills, training plan, tactical board)
  // so a coach can hand one file to a teammate instead of a whole backup.
  // opts.label renames the buttons; opts.scoped keeps the file to the active team.
  function shareBar(kind, opts) {
    opts = opts || {};
    const exp = opts.exportLabel || tr('share.export', 'Export');
    const imp = opts.importLabel || tr('share.import', 'Import');
    return `<button class="btn sm" data-pack-exp="${esc(kind)}">${icon('download', 14)} ${esc(exp)}</button>`
      + `<label class="btn sm" style="cursor:pointer">${icon('upload', 14)} ${esc(imp)}`
      + `<input type="file" accept="application/json" data-pack-imp="${esc(kind)}" hidden></label>`;
  }
  function bindShare(host, kind, onDone, opts) {
    opts = opts || {};
    // A team-scoped pack carries one squad only, and lands in the squad you are
    // looking at on the way back in.
    const scope = () => (opts.scoped && Store.activeTeamId && Store.activeTeamId()) || '';
    const exp = host.querySelector(`[data-pack-exp="${kind}"]`);
    if (exp) exp.onclick = async () => {
      try {
        const json = JSON.stringify(await Store.exportPack(kind, { teamId: scope() }), null, 2);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        a.download = `sporttactic-${kind}-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 20000);
        toast(tr('share.exported', 'Exported'), 'success');
      } catch { toast(tr('share.exportFailed', 'Export failed'), 'error'); }
    };
    const imp = host.querySelector(`[data-pack-imp="${kind}"]`);
    if (imp) imp.onchange = e => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      // A read-only copy says so plainly instead of blaming the file.
      if (Store.locked && Store.locked()) return toast(tr('lock.blocked', 'Read-only copy'), 'error');
      if (window.Access && Access.blocks(kind, null)) return toast(tr('mem.blocked', 'Read-only copy'), 'error');
      const r = new FileReader();
      r.onload = async () => {
        try {
          const n = await Store.importPack(kind, JSON.parse(r.result), { teamId: scope() });
          toast(tr('share.imported', 'Imported') + ' (' + n + ')', 'success');
          if (onDone) onDone();
        } catch (err) {
          // "nothing to import" means the file parsed fine but held no rows for
          // this pack — a different message than an unreadable or foreign file.
          const empty = err && /nothing to import/i.test(err.message || '');
          toast(tr(empty ? 'share.empty' : 'share.badFile',
            empty ? 'That file has nothing to import' : 'That file is not a SportTactic share file'), 'error');
        }
      };
      r.readAsText(f);
    };
  }

  // ---- Accordion ---------------------------------------------------------
  // Every big area of the app is a collapsible card, so a coach can fold away
  // what is not in use. The open/closed state is remembered per key.
  // Until the coach has folded anything at all, EVERY card starts closed, so a
  // first run shows the whole app as a short list instead of a wall of panels.
  const ACC_TOUCHED = 'stx_acc_seen';
  function accTouched() {
    try { return localStorage.getItem(ACC_TOUCHED) === '1'; } catch { return true; }
  }
  function accOpen(key, def) {
    try {
      const v = localStorage.getItem('stx_acc_' + key);
      if (v !== null) return v === '1';
      // A page whose whole content is one card asks for open and gets it, first
      // run or not — collapsed, it reads as an empty screen.
      if (def === true) return true;
      return accTouched() ? def !== false : false;
    } catch { return def !== false; }
  }
  // acc(key, title, innerHtml, { sub, actions, open })
  function acc(key, title, inner, o) {
    o = o || {};
    return `<details class="acc" data-acc="${esc(key)}" ${accOpen(key, o.open) ? 'open' : ''}>
      <summary class="acc-head">
        <span class="acc-chev" aria-hidden="true"></span>
        <span class="acc-titles"><span class="acc-title">${esc(title)}</span>${o.sub ? `<span class="acc-sub">${esc(o.sub)}</span>` : ''}</span>
        ${o.actions ? `<span class="acc-acts">${o.actions}</span>` : ''}
      </summary>
      <div class="acc-body">${inner}</div>
    </details>`;
  }
  function bindAcc(host) {
    host.querySelectorAll('details[data-acc]').forEach(d => {
      d.addEventListener('toggle', () => {
        try {
          localStorage.setItem('stx_acc_' + d.dataset.acc, d.open ? '1' : '0');
          localStorage.setItem(ACC_TOUCHED, '1');   // from now on a new card may open by default
        } catch { /* private mode */ }
      });
      const acts = d.querySelector('.acc-acts');
      // Buttons live in the header — using one must not fold the card, so the
      // click never reaches the <summary> that owns the toggle.
      if (acts) acts.addEventListener('click', e => e.stopPropagation());
    });
  }

  // ---- Printable report --------------------------------------------------
  // Opens a self-contained page and calls print(), which is also how a browser
  // saves a PDF. No PDF library and no network, so it works offline.
  const PRINT_CSS = `
    body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #111; margin: 0; padding: 28px; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .08em; color: #555; margin: 22px 0 6px; padding-bottom: 4px; border-bottom: 1px solid #bbb; }
    h3 { font-size: 14px; margin: 14px 0 4px; }
    p.sub { color: #555; margin: 0 0 16px; font-size: 13px; }
    p.foot { color: #777; font-size: 11px; margin-top: 28px; border-top: 1px solid #ccc; padding-top: 6px; }
    p, li { font-size: 13px; line-height: 1.5; margin: 0 0 8px; }
    table { border-collapse: collapse; width: 100%; margin: 6px 0 10px; font-size: 12px; }
    th, td { border: 1px solid #bbb; padding: 5px 8px; text-align: left; vertical-align: top; }
    th { background: #eee; }
    .none { color: #777; font-style: italic; }
    .kpi { display: flex; flex-wrap: wrap; gap: 10px; margin: 8px 0 14px; }
    .kpi div { border: 1px solid #bbb; border-radius: 6px; padding: 6px 12px; min-width: 92px; }
    .kpi b { display: block; font-size: 18px; }
    .kpi span { font-size: 11px; color: #555; }
    @media print { body { padding: 0; } h2 { page-break-after: avoid; } section { page-break-inside: avoid; } }`;
  function printDoc(title, sub, html, onBlocked) {
    const w = window.open('', '_blank');
    if (!w) { if (onBlocked) onBlocked(); return false; }
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>' + PRINT_CSS + '</style></head><body>'
      + '<h1>' + esc(title) + '</h1>' + (sub ? '<p class="sub">' + esc(sub) + '</p>' : '') + html
      + '<p class="foot">SportTactic \u00b7 ' + esc(fmtDate(Date.now())) + '</p></body></html>');
    w.document.close();
    w.focus();
    setTimeout(function () { try { w.print(); } catch (e) { /* the user can print it themselves */ } }, 300);
    return true;
  }

  return { esc, el, toast, modal, confirm, fmtDate, fmtClock, statCard, initials, icon, langText, langsOf, safeUrl, videoSrc, videosOf, videoEmbed, videoEditor, bindVideos, readVideos, shareBar, bindShare, acc, bindAcc, printDoc };
})();
if (typeof window !== 'undefined') window.UI = UI;

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
    const host = document.getElementById('toastHost');
    // Keep toasts visible when a view is in the Fullscreen API.
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
      title: 'Please confirm',
      body: `<p>${esc(msg)}</p>`,
      footer: `<button class="btn ghost" data-no>Cancel</button><button class="btn danger" data-yes>Confirm</button>`,
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

  // ---- Share bar ---------------------------------------------------------
  // Export / import for a single module (drills, training plan, tactical board)
  // so a coach can hand one file to a teammate instead of a whole backup.
  function shareBar(kind) {
    return `<button class="btn sm" data-pack-exp="${esc(kind)}">${icon('download', 14)} ${esc(tr('share.export', 'Export'))}</button>`
      + `<label class="btn sm" style="cursor:pointer">${icon('upload', 14)} ${esc(tr('share.import', 'Import'))}`
      + `<input type="file" accept="application/json" data-pack-imp="${esc(kind)}" hidden></label>`;
  }
  function bindShare(host, kind, onDone) {
    const exp = host.querySelector(`[data-pack-exp="${kind}"]`);
    if (exp) exp.onclick = async () => {
      try {
        const json = JSON.stringify(await Store.exportPack(kind), null, 2);
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
      const r = new FileReader();
      r.onload = async () => {
        try {
          const n = await Store.importPack(kind, JSON.parse(r.result));
          toast(tr('share.imported', 'Imported') + ' (' + n + ')', 'success');
          if (onDone) onDone();
        } catch { toast(tr('share.badFile', 'That file is not a SportTactic share file'), 'error'); }
      };
      r.readAsText(f);
    };
  }

  // ---- Accordion ---------------------------------------------------------
  // Every big area of the app is a collapsible card, so a coach can fold away
  // what is not in use. The open/closed state is remembered per key.
  function accOpen(key, def) {
    try {
      const v = localStorage.getItem('stx_acc_' + key);
      return v === null ? def !== false : v === '1';
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
        try { localStorage.setItem('stx_acc_' + d.dataset.acc, d.open ? '1' : '0'); } catch { /* private mode */ }
      });
      const acts = d.querySelector('.acc-acts');
      // Buttons live in the header — using one must not fold the card, so the
      // click never reaches the <summary> that owns the toggle.
      if (acts) acts.addEventListener('click', e => e.stopPropagation());
    });
  }

  return { esc, el, toast, modal, confirm, fmtDate, fmtClock, statCard, initials, icon, shareBar, bindShare, acc, bindAcc };
})();
if (typeof window !== 'undefined') window.UI = UI;

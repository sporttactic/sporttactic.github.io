/* install.js — "Add to Home Screen" for iPhone, Android and the desktop.

   Two very different worlds hide behind one button:

   · Chromium (Android Chrome/Edge/Samsung, desktop Chrome/Edge) fires
     `beforeinstallprompt`. The event has to be caught the moment it arrives and
     kept, because it can only be used later, from a real user gesture. That is
     a one-tap install and the page drives it.

   · Safari on iPhone/iPad has no such event and never has had one. Apple only
     offers Share ▸ Add to Home Screen, and a page cannot open the share sheet.
     So there is nothing to automate — the honest answer is to detect the
     browser and show the exact taps, with the same icons the user is looking at.

   Everything else (Firefox, the in-app browsers) sits somewhere between, so the
   guide branches per platform rather than pretending one flow fits all.

   Loaded early and before the app modules: `beforeinstallprompt` can fire as
   soon as the page is interactive, and a missed event cannot be recovered. */
const STXInstall = (() => {
  let deferred = null;
  const waiting = [];

  const $ = id => document.getElementById(id);
  const tr = (k, f) => (window.T && T(k) !== k) ? T(k) : f;
  const esc = s => (window.UI && UI.esc) ? UI.esc(s) : String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // ---- Icons -------------------------------------------------------------
  // Drawn to match what the user is actually looking at on the device, because
  // "tap the share button" is useless without showing which one.
  const ICO_SHARE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3"/><path d="m8 7 4-4 4 4"/><path d="M6 12H4v9h16v-9h-2"/></svg>';
  const ICO_PLUS = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/></svg>';
  const ICO_DOTS = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="12" cy="19" r="1.9"/></svg>';
  const ICO_DOWN = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>';
  const chip = svg => '<span class="ins-ico">' + svg + '</span>';

  // ---- Which device, which browser ---------------------------------------
  const ua = () => navigator.userAgent || '';
  // iPadOS 13+ reports a Mac user agent; a "Mac" with a touch screen is an iPad.
  const isIOS = () => /iPad|iPhone|iPod/.test(ua()) ||
    (/Macintosh/.test(ua()) && (navigator.maxTouchPoints || 0) > 1);
  const isAndroid = () => /Android/.test(ua());
  // Every iOS browser is Safari underneath, so feature tests cannot tell them
  // apart — the user-agent suffix is the only clue Apple leaves.
  function iosBrowser() {
    const u = ua();
    if (/CriOS/.test(u)) return 'chrome';
    if (/FxiOS/.test(u)) return 'firefox';
    if (/EdgiOS/.test(u)) return 'edge';
    if (/OPiOS|OPT\//.test(u)) return 'opera';
    return 'safari';
  }
  const chromium = () => /Chrome|Chromium|CriOS|Edg|SamsungBrowser/.test(ua()) && !/OPR|Opera/.test(ua());

  function platform() {
    if (isIOS()) return iosBrowser() === 'safari' ? 'ios-safari' : 'ios-other';
    if (isAndroid()) return chromium() ? 'android' : 'android-other';
    return chromium() ? 'desktop' : 'desktop-other';
  }

  // Running from the home screen already. navigator.standalone is the iOS-only
  // flag; display-mode covers everything else.
  function installed() {
    if (navigator.standalone) return true;
    if (!window.matchMedia) return false;
    return ['standalone', 'minimal-ui', 'fullscreen', 'window-controls-overlay']
      .some(m => { try { return matchMedia('(display-mode: ' + m + ')').matches; } catch (e) { return false; } });
  }

  const available = () => !!deferred;
  // Nothing to offer in an iOS browser that is not Safari, or a desktop that
  // never fired the event — those get instructions, not a button.
  const canInstall = () => !installed() && (available() || platform() !== 'ios-other');

  function prompt() {
    if (!deferred) return Promise.resolve(false);
    const e = deferred;
    deferred = null;
    refresh();
    e.prompt();
    return e.userChoice.then(c => !!(c && c.outcome === 'accepted'), () => false);
  }

  // ---- The guide ---------------------------------------------------------
  function stepList(items) {
    return '<ol class="ins-steps">' + items.map(s => '<li>' + s + '</li>').join('') + '</ol>';
  }

  function bodyFor(p) {
    if (installed()) return '<p class="ins-ok">' + esc(tr('ins.installed', 'Already installed — you are running it from the home screen.')) + '</p>';
    const head = '<p>' + esc(tr('ins.intro', 'SportTactic then opens from its own icon, full screen, with no address bar \u2014 and keeps working with no signal at all.')) + '</p>';

    if (p === 'ios-safari') {
      return head + stepList([
        tr('ins.iosShare', 'Tap the Share button {0} \u2014 at the bottom of the screen on an iPhone, top right on an iPad.').replace('{0}', chip(ICO_SHARE)),
        tr('ins.iosAdd', 'Scroll down the list and tap {0} Add to Home Screen.').replace('{0}', chip(ICO_PLUS)),
        tr('ins.iosConfirm', 'Tap Add in the top right corner. The icon is now on your home screen.')
      ]) + '<p class="hint">' + esc(tr('ins.iosNote', 'Apple gives no install button to the page itself \u2014 these three taps are the whole thing.')) + '</p>';
    }
    if (p === 'ios-other') {
      return head + '<p>' + esc(tr('ins.iosOther', 'Only Safari can put a web app on the iPhone home screen reliably. Copy the link below, open Safari and paste it in \u2014 then Share \u25b8 Add to Home Screen.')) + '</p>'
        + '<p class="hint">' + esc(tr('ins.iosOtherTry', 'Newer versions of this browser may also offer Add to Home Screen in their own share menu.')) + '</p>';
    }
    if (p === 'android' || p === 'android-other') {
      return head + stepList([
        tr('ins.andMenu', 'Tap the browser menu {0} in the top right corner.').replace('{0}', chip(ICO_DOTS)),
        tr('ins.andAdd', 'Tap {0} Install app \u2014 in some versions it is called Add to Home screen.').replace('{0}', chip(ICO_DOWN)),
        tr('ins.andConfirm', 'Confirm with Install. The icon is now on your home screen.')
      ]);
    }
    return head + stepList([
      tr('ins.deskBar', 'Look for the install icon {0} at the right-hand end of the address bar.').replace('{0}', chip(ICO_DOWN)),
      tr('ins.deskMenu', 'No icon? Open the browser menu {0} and look for Install, or Add to Dock in Safari.').replace('{0}', chip(ICO_DOTS)),
      tr('ins.deskConfirm', 'Confirm, and the app gets its own window and its own icon.')
    ]);
  }

  function guide() {
    if (!window.UI || !UI.modal) return;
    const p = platform();
    const goBtn = () => available()
      ? '<button class="btn primary" data-ins-go>' + esc(tr('ins.btn', 'Install now')) + '</button>'
      : '';
    const m = UI.modal({
      title: tr('ins.title', 'Add to Home Screen'),
      width: 520,
      body: '<div id="insBody">' + bodyFor(p) + '</div>',
      footer: '<button class="btn ghost" data-close2>' + esc(tr('common.close', 'Close')) + '</button>'
        + (p === 'ios-other' ? '<button class="btn" data-ins-copy>' + esc(tr('ins.copyLink', 'Copy link')) + '</button>' : '')
        + '<span id="insGo">' + goBtn() + '</span>',
      onOpen: (root, close) => {
        root.querySelector('[data-close2]').onclick = () => { detach(); close(); };
        const copy = root.querySelector('[data-ins-copy]');
        if (copy) copy.onclick = () => copyLink();
        const wire = () => {
          const b = root.querySelector('[data-ins-go]');
          if (b) b.onclick = () => prompt().then(ok => {
            UI.toast(tr(ok ? 'ins.done' : 'ins.dismissed', ok ? 'Installed \u2014 look for the icon on your home screen' : 'Not installed. You can do it any time from Settings.'), ok ? 'success' : '');
            if (ok) { detach(); close(); }
          });
        };
        // Chromium decides when to fire the event; if it lands while this is
        // open, the button appears instead of leaving only the manual steps.
        const slot = root.querySelector('#insGo');
        const onReady = () => { if (slot) { slot.innerHTML = goBtn(); wire(); } };
        const detach = () => { const i = waiting.indexOf(onReady); if (i >= 0) waiting.splice(i, 1); };
        waiting.push(onReady);
        wire();
      }
    });
    return m;
  }

  function copyLink() {
    const url = location.origin + location.pathname;
    const ok = () => UI.toast(tr('ins.copied', 'Link copied \u2014 paste it into Safari'), 'success');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(ok, () => legacyCopy(url, ok));
    } else legacyCopy(url, ok);
  }
  function legacyCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { UI.toast(text, ''); }
    document.body.removeChild(ta);
  }

  // ---- Wiring ------------------------------------------------------------
  // The sidebar button is offered wherever the app can actually be installed,
  // not only where Chromium fired its event — an iPhone would otherwise never
  // be told this is possible at all.
  function refresh() {
    const btn = $('installApp');
    if (btn) btn.classList.toggle('hidden', !canInstall());
  }

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferred = e;
    refresh();
    waiting.slice().forEach(fn => { try { fn(); } catch (err) { /* dialog gone */ } });
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    refresh();
    if (window.UI && UI.toast) UI.toast(tr('footer.installed', 'App installed \u2014 it now works offline'), 'success');
  });

  function start() {
    refresh();
    const btn = $('installApp');
    if (btn) btn.addEventListener('click', guide);
  }
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', start);
  else start();

  return { available, canInstall, installed, platform, prompt, guide, refresh };
})();
window.STXInstall = STXInstall;

/* Video Analysis view */
window.Views = window.Views || {};
Views.video = function (mount) {
  // Bookmarks are auto-saved to IndexedDB (store 'videos', id 'bookmarks').
  let bookmarks = [];
  const BM_ID = 'bookmarks';
  let clipLenSec = 6; // WebM sequence length around each bookmark
  let selectedBm = null; // set by "Go" — scopes the export buttons to one clip

  function loadBookmarks() {
    const rec = Store.find('videos', BM_ID);
    bookmarks = (rec && Array.isArray(rec.bookmarks)) ? rec.bookmarks.slice() : [];
  }
  async function saveBookmarks() {
    await Store.save('videos', { id: BM_ID, bookmarks });
  }

  // Convert a shareable streaming URL into an embeddable iframe URL.
  const FILE_RE = /\.(mp4|m4v|webm|ogv|ogg|mov)(\?|#|$)/i;
  function toEmbed(url) {
    url = (url || '').trim();
    if (!url) return null;
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./, '').toLowerCase();
      // YouTube (watch, youtu.be, shorts, live)
      if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
        let id = u.searchParams.get('v');
        if (!id && u.pathname.startsWith('/shorts/')) id = u.pathname.split('/')[2];
        if (!id && u.pathname.startsWith('/live/')) id = u.pathname.split('/')[2];
        if (!id && u.pathname.startsWith('/embed/')) id = u.pathname.split('/')[2];
        if (id) return 'https://www.youtube.com/embed/' + id;
      }
      if (host === 'youtu.be') { const id = u.pathname.slice(1); if (id) return 'https://www.youtube.com/embed/' + id; }
      // Twitch (video or channel live)
      if (host === 'twitch.tv') {
        const parent = location.hostname || 'localhost';
        const parts = u.pathname.split('/').filter(Boolean);
        if (parts[0] === 'videos' && parts[1]) return 'https://player.twitch.tv/?video=' + parts[1] + '&parent=' + parent;
        if (parts[0]) return 'https://player.twitch.tv/?channel=' + parts[0] + '&parent=' + parent;
      }
      if (host === 'clips.twitch.tv') { const parent = location.hostname || 'localhost'; const clip = u.pathname.split('/').filter(Boolean)[0]; if (clip) return 'https://clips.twitch.tv/embed?clip=' + clip + '&parent=' + parent; }
      // Vimeo
      if (host === 'vimeo.com') { const id = u.pathname.split('/').filter(Boolean)[0]; if (id) return 'https://player.vimeo.com/video/' + id; }
      // Dailymotion
      if (host === 'dailymotion.com') { const id = u.pathname.split('/video/')[1]; if (id) return 'https://www.dailymotion.com/embed/video/' + id.split('_')[0]; }
      if (host === 'dai.ly') { const id = u.pathname.slice(1); if (id) return 'https://www.dailymotion.com/embed/video/' + id; }
      // Facebook video
      if (host === 'facebook.com' || host === 'fb.watch') return 'https://www.facebook.com/plugins/video.php?href=' + encodeURIComponent(url) + '&show_text=false';
      // A direct file or an already-embeddable address. Anything the provider
      // branches above did not build has to clear the bar on its own: only
      // https reaches the player, so a javascript:, data: or file: link cannot
      // be framed in this origin.
      return u.protocol === 'https:' ? u.href : null;
    } catch (e) { return null; }
  }

  // ---- Telestration ------------------------------------------------------
  // Shapes belong to a bookmark and are stored in fractions of the frame, so the
  // same drawing lands in the right place on the preview and in the export,
  // whatever the video resolution is.
  const DRAW_TOOLS = ['select', 'move', 'remove', 'arrow', 'line', 'free', 'circle', 'rect', 'text'];
  // The three that work on what is already drawn rather than adding to it.
  const EDIT_TOOLS = ['select', 'move', 'remove'];
  const DRAW_COLORS = ['#ffd400', '#ff3b30', '#34c759', '#0a84ff', '#ffffff', '#101010'];
  let dTool = 'arrow';
  let dColor = DRAW_COLORS[0];
  let selShape = -1;                 // index into the bookmark's shapes, -1 for none
  // Drawing used to depend on a bookmark already being picked, which meant the
  // overlay never accepted a click on a fresh video and the tools looked broken.
  // It is an explicit mode now, and it makes the bookmark it needs.
  let drawMode = false;

  // The picture used to fill the whole column, which pushed the bookmarks and
  // the tools off the screen. Three sizes, remembered between visits.
  const VIDEO_SIZES = ['s', 'm', 'l'];
  const SIZE_KEY = 'stx_video_size';
  let vSize = 'm';
  try { const s = localStorage.getItem(SIZE_KEY); if (VIDEO_SIZES.indexOf(s) >= 0) vSize = s; } catch (e) { /* private mode */ }

  function drawShapes(cx, w, h, bm) {
    const list = (bm && bm.shapes) || [];
    if (!list.length) return;
    const unit = Math.max(2, Math.round(Math.min(w, h) * 0.006));
    cx.save();
    cx.lineCap = 'round';
    cx.lineJoin = 'round';
    for (const s of list) {
      const p = s.p || [];
      if (!p.length) continue;
      cx.strokeStyle = s.c || '#ffd400';
      cx.fillStyle = s.c || '#ffd400';
      cx.lineWidth = unit;
      const X = i => p[i][0] * w, Y = i => p[i][1] * h;
      if (s.k === 'text') {
        // Haloed so it stays readable over a light or a dark patch of pitch.
        const px = Math.max(12, Math.round(h * 0.055));
        cx.save();
        cx.font = 'bold ' + px + 'px Arial, Helvetica, sans-serif';
        cx.textAlign = 'center';
        cx.textBaseline = 'middle';
        cx.lineJoin = 'round';
        cx.lineWidth = Math.max(2, Math.round(px * 0.2));
        cx.strokeStyle = 'rgba(0,0,0,.7)';
        cx.strokeText(s.txt || '', X(0), Y(0));
        cx.fillText(s.txt || '', X(0), Y(0));
        cx.restore();
      } else if (s.k === 'free') {
        cx.beginPath();
        cx.moveTo(X(0), Y(0));
        for (let i = 1; i < p.length; i++) cx.lineTo(X(i), Y(i));
        cx.stroke();
      } else if (p.length >= 2) {
        const x1 = X(0), y1 = Y(0), x2 = X(1), y2 = Y(1);
        if (s.k === 'rect') {
          cx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
        } else if (s.k === 'circle') {
          cx.beginPath();
          cx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
          cx.stroke();
        } else {
          cx.beginPath(); cx.moveTo(x1, y1); cx.lineTo(x2, y2); cx.stroke();
          if (s.k === 'arrow') {
            const a = Math.atan2(y2 - y1, x2 - x1), head = unit * 4.5;
            cx.beginPath();
            cx.moveTo(x2, y2);
            cx.lineTo(x2 - head * Math.cos(a - 0.42), y2 - head * Math.sin(a - 0.42));
            cx.lineTo(x2 - head * Math.cos(a + 0.42), y2 - head * Math.sin(a + 0.42));
            cx.closePath(); cx.fill();
          }
        }
      }
    }
    cx.restore();
  }

  const streamCard = `      <p style="color:var(--muted);font-size:13px;margin-bottom:8px">${T('video.streamHint')}</p>
      <div class="row" style="flex:0">
        <input id="streamUrl" type="url" placeholder="https://youtube.com/watch?v=… , twitch.tv/… , vimeo.com/…" style="min-width:260px">
        <button class="btn primary" id="loadStream">${T('video.watch')}</button>
        <button class="btn" id="saveStream">★ ${T('video.saveStream')}</button>
      </div>
      <div class="saved-streams" id="savedStreams"></div>
      <div class="stream-services">
        <span class="tag">YouTube</span><span class="tag">Twitch</span><span class="tag">Vimeo</span>
        <span class="tag">Dailymotion</span><span class="tag">Facebook</span>
      </div>`;

  const playerPanel = `
    <div class="video-panel" id="videoPanel">
      <div class="video-head" id="videoHead">
        <h3 style="margin:0">${T('video.title')}</h3>
        <span class="tool-group">
          <label class="field vsize"><span>${T('video.size')}</span>
            <select id="vSize">${VIDEO_SIZES.map(s => `<option value="${s}" ${s === vSize ? 'selected' : ''}>${T('video.size' + s)}</option>`).join('')}</select></label>
          <label class="btn sm" data-member-ok style="cursor:pointer">\u2b71 ${T('video.import')}<input type="file" accept="video/*" data-vfile hidden></label>
          <button class="btn sm" id="videoMove" title="${T('video.move')}">✥ ${T('video.move')}</button>
          <button class="btn sm" id="videoFs" title="${T('video.fullscreen')}">⛶ ${T('video.fullscreen')}</button>
        </span>
      </div>
      <div class="v-stage" id="vStage">
        <div class="v-tools" id="vTools">
          <div class="draw-bar" id="drawBar">
            <span class="tool-group">
              <button class="btn sm" id="drawMode">✎ ${T('video.drawMode')}</button>
            </span>
            <span class="tool-group dtools">
              ${DRAW_TOOLS.map(t => `<button class="btn sm" data-dtool="${t}">${T('video.d' + t)}</button>`).join('')}
            </span>
            <span class="draw-colors">${DRAW_COLORS.map(c => `<button class="swatch" data-dcolor="${c}" style="--sw:${c}" title="${c}"></button>`).join('')}</span>
            <span class="tool-group">
              <button class="btn sm primary" id="drawSave">★ ${T('video.drawSave')}</button>
              <button class="btn sm" id="drawUndo">\u21b6 ${T('tactics.undo')}</button>
              <button class="btn sm danger" id="drawClear">${T('video.drawClear')}</button>
            </span>
          </div>
          <p class="hint" id="drawHint"></p>
          <div class="row" style="margin-top:10px;flex:0;flex-wrap:wrap" id="localControls">
            <button class="btn sm" data-seek="-5">« 5s</button>
            <button class="btn sm local-only" data-rate="0.5">0.5×</button>
            <button class="btn sm local-only" data-rate="1">1×</button>
            <button class="btn sm local-only" data-rate="2">2×</button>
            <button class="btn sm" data-seek="5">5s »</button>
            <span class="tool-group stream-only" id="clockGroup" title="${T('video.clockHint')}">
              <button class="btn sm" id="clockRun">▶ ${T('video.clock')}</button>
              <input id="clockTime" class="clock-input" value="0:00" placeholder="mm:ss">
              <button class="btn sm" id="clockReset" title="${T('video.clockReset')}">↺</button>
            </span>
            <span class="tool-group mark-group">
              <button class="btn sm" id="markIn">⌘ ${T('video.markIn')}</button>
              <button class="btn sm" id="markOut">⌙ ${T('video.markOut')}</button>
              <span class="tag" id="markState"></span>
            </span>
            <button class="btn sm primary" id="bm">★ ${T('video.bookmark')}</button>
          </div>
        </div>
        <div id="mediaWrap" class="size-${vSize}">
          <video id="player" class="v-media" controls></video>
        </div>
      </div>
      <div class="bm-section">
        <div class="bm-head">
          <h3 style="margin:0">${T('video.bookmarks')}</h3>
          <span class="tool-group">
            <button class="btn sm primary" id="exportWebm">${T('video.exportWebm')}</button>
            <button class="btn sm primary" id="exportMp4">${T('video.exportMp4')}</button>
            ${UI.shareBar('video', { exportLabel: T('video.exportBtn'), importLabel: T('video.importBtn') })}
          </span>
        </div>
        <p class="hint" style="margin:6px 0 4px">${T('video.bmEmpty')}</p>
        <p class="hint" id="bmScope" style="margin:0 0 8px"></p>
        <div id="bmList" class="bm-list"></div>
      </div>
    </div>`;

  mount.innerHTML = `
    <div class="page-head"><div><h1>${T('video.title')}</h1><p>${T('video.subtitle')}</p></div>
      <label class="btn primary" data-member-ok style="cursor:pointer">${T('video.import')}<input type="file" accept="video/*" data-vfile hidden></label>
    </div>
    ${UI.acc('videoStream', T('video.stream'), streamCard)}
    ${UI.acc('videoPlayer', T('video.player'), playerPanel)}`;

  UI.bindAcc(mount);
  // An imported bookmark file replaces the list, so it is re-read before drawing.
  UI.bindShare(mount, 'video', () => { loadBookmarks(); renderBm(); });

  const wrap = mount.querySelector('#mediaWrap');
  const localControls = mount.querySelector('#localControls');
  let v = mount.querySelector('#player');

  // Seek/speed need a real <video>; a stream is driven by the clock instead.
  function showPlaybackBtns(on) {
    localControls.querySelectorAll('.local-only').forEach(b => { b.style.display = on ? '' : 'none'; });
    localControls.querySelectorAll('.stream-only').forEach(b => { b.style.display = on ? 'none' : ''; });
  }
  function hasLocalVideo() { return !!(v && v.src && v.isConnected); }
  function hasEmbed() { return !!wrap.querySelector('.embed-frame'); }
  function hasMedia() { return hasLocalVideo() || hasEmbed(); }

  function showLocalVideo() {
    wrap.innerHTML = `<video id="player" class="v-media" controls></video>`;
    v = mount.querySelector('#player');
    showPlaybackBtns(true);
    runClock(false);
    bindLocalControls();
    mountOverlay();
  }
  function showEmbed(src) {
    embedBase = src;
    provider = providerOf(src);
    ytLive = false;
    wrap.innerHTML = `<div class="embed-frame"><iframe src="${UI.esc(provider === 'youtube' ? rangeSrc(0, 0, false) : src)}" referrerpolicy="strict-origin-when-cross-origin" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen frameborder="0"></iframe></div>`;
    v = null;
    overlay = null; octx = null;
    if (sizeWatch) { sizeWatch.disconnect(); sizeWatch = null; }
    showPlaybackBtns(false);
    ytHandshake();
    mountOverlay();
    setDrawMode(drawMode);
    runClock(false);
    setStreamTime(0);
  }

  // ---- Driving a streamed player -----------------------------------------
  // A cross-origin player takes no orders from the page, but every platform
  // worth embedding reads a start (and YouTube an end) out of the embed URL, so
  // a passage is played by pointing the frame at it. YouTube also answers the
  // postMessage API, which seeks without the reload.
  let embedBase = '', provider = '', ytLive = false;
  function providerOf(src) {
    const s = String(src || '');
    if (/youtube(-nocookie)?\.com\/embed\//i.test(s)) return 'youtube';
    if (/player\.vimeo\.com\//i.test(s)) return 'vimeo';
    if (/dailymotion\.com\/embed\//i.test(s)) return 'dailymotion';
    if (/player\.twitch\.tv\//i.test(s)) return 'twitch';
    return '';
  }
  const canAim = () => !!provider && hasEmbed();
  const hms = sec => {
    const s = Math.max(0, Math.round(sec));
    return Math.floor(s / 3600) + 'h' + Math.floor((s % 3600) / 60) + 'm' + (s % 60) + 's';
  };
  function rangeSrc(from, to, play) {
    const s = Math.max(0, Math.round(from || 0));
    const e = to && to > s ? Math.round(to) : 0;
    let u;
    try { u = new URL(embedBase, location.href); } catch (err) { return embedBase; }
    const auto = play ? '1' : '0';
    if (provider === 'youtube') {
      u.searchParams.set('enablejsapi', '1');
      u.searchParams.set('rel', '0');
      if (s) u.searchParams.set('start', s); else u.searchParams.delete('start');
      if (e) u.searchParams.set('end', e); else u.searchParams.delete('end');
      u.searchParams.set('autoplay', auto);
      return u.toString();
    }
    if (provider === 'dailymotion') {
      if (s) u.searchParams.set('start', s); else u.searchParams.delete('start');
      u.searchParams.set('autoplay', auto);
      return u.toString();
    }
    if (provider === 'twitch') {
      u.searchParams.set('t', hms(s));
      u.searchParams.set('autoplay', play ? 'true' : 'false');
      return u.toString();
    }
    if (provider === 'vimeo') {
      u.searchParams.set('autoplay', auto);
      return u.toString() + (s ? '#t=' + s + 's' : '');
    }
    return u.toString();
  }
  function ytCmd(func, args) {
    if (provider !== 'youtube') return false;
    const f = wrap.querySelector('.embed-frame iframe');
    if (!f || !f.contentWindow) return false;
    try {
      f.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args: args || [], id: 1, channel: 'widget' }), 'https://www.youtube.com');
      return true;
    } catch (e) { return false; }
  }
  // The player only answers commands once it has been told to listen, and only
  // an answer proves it will: until one arrives, a seek goes through the URL so
  // the picture can never drift away from the clock.
  function ytHandshake() {
    if (provider !== 'youtube') return;
    const f = wrap.querySelector('.embed-frame iframe');
    if (!f) return;
    const hello = () => { try { f.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), 'https://www.youtube.com'); } catch (e) { /* not up yet */ } };
    f.addEventListener('load', hello);
    // The player answers only once it is up, and it is up at its own pace.
    [600, 1600, 3200].forEach(ms => setTimeout(hello, ms));
  }
  // The player reports where it is once it has been told to listen, so dragging
  // its own scrub bar moves our clock with it and Set start / Set end read the
  // real position instead of a guess.
  const onFrameMsg = e => {
    if (provider !== 'youtube' || !/^https:\/\/(www\.)?youtube(-nocookie)?\.com$/.test(e.origin)) return;
    ytLive = true;
    let d = e.data;
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch (err) { return; } }
    const info = d && typeof d === 'object' && d.info;
    if (!info || typeof info !== 'object') return;
    if (typeof info.currentTime === 'number' && isFinite(info.currentTime)) adoptStreamTime(info.currentTime);
    if (typeof info.playerState === 'number') followPlayer(info.playerState);
  };
  window.addEventListener('message', onFrameMsg);
  // Point the stream at `from`, and have it stop at `to` where the platform can
  // be told. The clock follows, so Set start / Set end stay in step with it.
  function aimStream(from, to, play) {
    const s = Math.max(0, from || 0);
    const e = to && to > s ? to : null;
    if (canAim()) {
      // A live player takes a seek without losing its buffer; an end always has
      // to be baked into the URL, and so does a seek nobody has answered for.
      if (provider === 'youtube' && !e && ytLive && ytCmd('seekTo', [s, true])) {
        if (play) ytCmd('playVideo'); else ytCmd('pauseVideo');
      } else {
        const f = wrap.querySelector('.embed-frame iframe');
        if (f) { f.src = rangeSrc(s, e, play); ytHandshake(); }
      }
    }
    setStreamTime(s);
    playUntil = e;
    runClock(!!play);
    return canAim();
  }

  // ---- Saved streams ------------------------------------------------------
  // The link to a match feed is long and comes from somewhere else entirely, so
  // the ones a coach comes back to are kept in a list under the field.
  const STREAM_KEY = 'stx_streams';
  const MAX_STREAMS = 40;
  function savedStreams() {
    try {
      const v = JSON.parse(localStorage.getItem(STREAM_KEY) || '[]');
      return Array.isArray(v) ? v.filter(s => s && s.url) : [];
    } catch (e) { return []; }
  }
  function writeStreams(list) {
    try { localStorage.setItem(STREAM_KEY, JSON.stringify(list.slice(0, MAX_STREAMS))); } catch (e) { /* private mode */ }
  }
  // A readable name for a link nobody wants to read: the video id or the host.
  function streamLabel(url) {
    try {
      const u = new URL(url);
      const id = u.searchParams.get('v') || u.pathname.split('/').filter(Boolean).pop() || '';
      return (u.hostname.replace(/^www\./, '') + (id ? ' · ' + id : '')).slice(0, 60);
    } catch (e) { return String(url).slice(0, 60); }
  }
  function openStream(url) {
    const src = toEmbed(url);
    if (!src) { UI.toast(T('video.badUrl'), 'error'); return false; }
    if (FILE_RE.test(src)) { showLocalVideo(); v.src = src; setDrawMode(drawMode); }
    else showEmbed(src);
    const box = mount.querySelector('#streamUrl');
    if (box) box.value = url;
    UI.toast(T('video.streaming'), 'success');
    return true;
  }
  function renderStreams() {
    const host = mount.querySelector('#savedStreams');
    if (!host) return;
    const list = savedStreams();
    host.innerHTML = list.length ? list.map((s, i) => `
      <span class="saved-stream">
        <button type="button" class="btn sm" data-open="${i}" title="${UI.esc(s.url)}">\u25b6 ${UI.esc(s.name || streamLabel(s.url))}</button>
        <button type="button" class="btn sm danger" data-drop="${i}" title="${UI.esc(T('common.remove'))}">\u2715</button>
      </span>`).join('') : `<p class="hint" style="margin:0">${UI.esc(T('video.streamsNone'))}</p>`;
    host.querySelectorAll('[data-open]').forEach(b => b.onclick = () => {
      const s = savedStreams()[+b.dataset.open];
      if (s) openStream(s.url);
    });
    host.querySelectorAll('[data-drop]').forEach(b => b.onclick = () => {
      const list2 = savedStreams();
      list2.splice(+b.dataset.drop, 1);
      writeStreams(list2);
      renderStreams();
    });
  }
  function saveStream() {
    const raw = (mount.querySelector('#streamUrl').value || '').trim();
    if (!raw || !toEmbed(raw)) { UI.toast(T('video.badUrl'), 'error'); return; }
    const list = savedStreams();
    if (list.some(s => s.url === raw)) { UI.toast(T('video.streamSaved')); return; }
    UI.modal({
      title: T('video.saveStream'),
      body: `<label class="field"><span>${T('video.streamName')}</span>
        <input id="st_name" maxlength="60" value="${UI.esc(streamLabel(raw))}"></label>
        <p class="hint">${UI.esc(raw)}</p>`,
      footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button>
        <button class="btn primary" data-save>${T('common.save')}</button>`,
      onOpen: (m, close) => {
        const inp = m.querySelector('#st_name');
        inp.focus(); inp.select();
        const save = () => {
          list.unshift({ url: raw, name: inp.value.trim().slice(0, 60) || streamLabel(raw), at: Date.now() });
          writeStreams(list);
          close();
          renderStreams();
          UI.toast(T('video.streamSaved'), 'success');
        };
        inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); save(); } };
        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-save]').onclick = save;
      }
    });
  }
  mount.querySelector('#saveStream').onclick = saveStream;
  renderStreams();

  mount.querySelector('#loadStream').onclick = () => {
    openStream(mount.querySelector('#streamUrl').value);
  };
  mount.querySelector('#streamUrl').addEventListener('keydown', e => { if (e.key === 'Enter') mount.querySelector('#loadStream').click(); });

  // Both copies of the control open the same file: the one in the page head and
  // the one in the panel, which is the only one still on screen in fullscreen.
  mount.querySelectorAll('[data-vfile]').forEach(inp => inp.onchange = e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    showLocalVideo();
    v.src = URL.createObjectURL(f);
    // Only now is there something to draw on, so the tools are re-armed here
    // rather than inside showLocalVideo, which runs one line too early.
    setDrawMode(drawMode);
    UI.toast(T('video.streaming'));
  });

  function bindLocalControls() {
    mount.querySelectorAll('[data-seek]').forEach(b => b.onclick = () => {
      if (hasLocalVideo()) v.currentTime += +b.dataset.seek;
      else aimStream(streamT + (+b.dataset.seek), null, streamRun);
    });
    mount.querySelectorAll('[data-rate]').forEach(b => b.onclick = () => { if (v) v.playbackRate = +b.dataset.rate; });
    mount.querySelector('#bm').onclick = () => createBookmark();
    const clockRun = mount.querySelector('#clockRun');
    if (clockRun) clockRun.onclick = () => {
      const on = !streamRun;
      ytCmd(on ? 'playVideo' : 'pauseVideo');
      runClock(on);
    };
    const clockReset = mount.querySelector('#clockReset');
    if (clockReset) clockReset.onclick = () => { playUntil = null; runClock(false); setStreamTime(0); };
    const clockTime = mount.querySelector('#clockTime');
    if (clockTime) {
      clockTime.onchange = () => aimStream(parseClock(clockTime.value), null, streamRun);
      clockTime.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); clockTime.blur(); } };
    }
    mount.querySelector('#markIn').onclick = () => {
      if (!hasMedia()) return UI.toast(T('video.needMedia'), 'error');
      inPoint = playhead();
      if (outPoint != null && outPoint <= inPoint) outPoint = null;
      renderMarks();
      UI.toast(T('video.markedIn') + ' ' + UI.fmtClock(Math.floor(inPoint)));
    };
    mount.querySelector('#markOut').onclick = () => {
      if (!hasMedia()) return UI.toast(T('video.needMedia'), 'error');
      outPoint = playhead();
      if (inPoint == null || inPoint >= outPoint) inPoint = Math.max(0, outPoint - clipLenSec);
      renderMarks();
      // Both ends are known now, so the dialog opens with the passage already
      // filled in and only the name is left to type.
      createBookmark();
    };
    renderMarks();
    paintClock();
  }

  // ---- The drawing overlay -----------------------------------------------
  // It sits exactly over the picture. Drawing is a mode you switch on; the
  // shapes belong to a bookmark, and if none is picked the first stroke makes
  // one at the playhead so the tools work on a video you just opened.
  let overlay = null, octx = null, drawing = null, sizeWatch = null, moving = null;

  // A drawing is a pointer, not a permanent mark: once the picture is running it
  // has said what it had to say, so it clears itself after a few seconds instead
  // of covering the play. Pausing, seeking or drawing again brings it back.
  const DRAW_HOLD = 3;
  let drawTimer = null, drawFaded = false;
  const isPlaying = () => hasLocalVideo() ? !v.paused : streamRun;
  function holdDrawing(playing) {
    if (drawTimer) { clearTimeout(drawTimer); drawTimer = null; }
    drawFaded = false;
    if (playing) drawTimer = setTimeout(() => { drawFaded = true; renderOverlay(); }, DRAW_HOLD * 1000);
    renderOverlay();
  }

  function mountOverlay() {
    overlay = document.createElement('canvas');
    overlay.className = 'draw-layer';
    overlay.id = 'vdraw';
    wrap.classList.add('has-draw');
    wrap.appendChild(overlay);
    octx = overlay.getContext('2d');
    overlay.addEventListener('pointerdown', onDrawDown);
    overlay.addEventListener('pointermove', onDrawMove);
    overlay.addEventListener('pointerup', onDrawUp);
    overlay.addEventListener('pointercancel', onDrawUp);
    if (v) {
      v.addEventListener('loadedmetadata', sizeOverlay);
      v.addEventListener('seeked', () => holdDrawing(!v.paused));
      v.addEventListener('play', () => holdDrawing(true));
      v.addEventListener('pause', () => holdDrawing(false));
      v.addEventListener('timeupdate', onRangeTick);
    }
    // The element resizes with the size picker, the accordion and fullscreen;
    // without this the overlay stays where the picture used to be.
    const media = v || wrap.querySelector('.embed-frame');
    if (media && window.ResizeObserver) {
      if (sizeWatch) sizeWatch.disconnect();
      sizeWatch = new ResizeObserver(() => sizeOverlay());
      sizeWatch.observe(media);
    }
    sizeOverlay();
  }

  // The picture is letterboxed inside the element, and the element is centred
  // inside the wrapper, so the overlay is pinned with both offsets rather than
  // to the top-left of the box around it.
  function videoBox() {
    const wr = wrap.getBoundingClientRect();
    // A stream has no element we can measure the picture inside, so the whole
    // frame is the drawing surface.
    if (!v) {
      const f = wrap.querySelector('.embed-frame');
      if (!f) return null;
      const fr = f.getBoundingClientRect();
      return { left: fr.left - wr.left, top: fr.top - wr.top, w: fr.width, h: fr.height };
    }
    const r = v.getBoundingClientRect();
    const vw = v.videoWidth || 16, vh = v.videoHeight || 9;
    const scale = Math.min(r.width / vw, r.height / vh) || 0;
    const w = vw * scale, h = vh * scale;
    return { left: (r.left - wr.left) + (r.width - w) / 2, top: (r.top - wr.top) + (r.height - h) / 2, w, h };
  }
  function sizeOverlay() {
    if (!overlay) return;
    const b = videoBox();
    if (!b || !b.w || !b.h) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    overlay.width = Math.round(b.w * dpr);
    overlay.height = Math.round(b.h * dpr);
    overlay.style.left = b.left + 'px';
    overlay.style.top = b.top + 'px';
    overlay.style.width = b.w + 'px';
    overlay.style.height = b.h + 'px';
    renderOverlay();
  }
  function renderOverlay() {
    const bm = drawTarget();
    // The hint is updated even when there is no canvas, so switching to a stream
    // replaces “drawing is on” with the reason it no longer is.
    const hint = mount.querySelector('#drawHint');
    if (hint) {
      const base = !hasMedia() ? T('video.drawNeedMedia')
        : !drawMode ? T('video.drawOff')
          : bm ? T('video.drawOn') + ' ' + fmtRange(bm) + ' ' + (bm.tag || '')
            : T('video.drawNew');
      hint.textContent = base + (drawMode && hasEmbed() ? ' ' + T('video.drawStream') : '');
    }
    const save = mount.querySelector('#drawSave');
    if (save) save.disabled = !((bm && bm.shapes) || []).length;
    if (!overlay || !octx) return;
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, overlay.width, overlay.height);
    if (bm && !drawFaded) drawShapes(octx, overlay.width, overlay.height, bm);
    if (drawing) drawShapes(octx, overlay.width, overlay.height, { shapes: [drawing] });
    // A shape the coach marked with Select is ringed, so Move and Remove act on
    // something they can see they picked.
    if (bm && !drawFaded && selShape >= 0 && bm.shapes && bm.shapes[selShape]) drawSelection(octx, overlay.width, overlay.height, bm.shapes[selShape]);
    // Armed is what makes the canvas accept a pointer at all, so it follows the
    // mode and not whether a bookmark happens to be selected.
    overlay.classList.toggle('armed', drawMode && hasMedia());
  }
  const drawTarget = () => (selectedBm && bookmarks.indexOf(selectedBm) >= 0) ? selectedBm : null;

  function setDrawMode(on) {
    drawMode = !!on && hasMedia();
    const btn = mount.querySelector('#drawMode');
    if (btn) {
      btn.classList.toggle('primary', drawMode);
      btn.disabled = !hasMedia();
    }
    const bar = mount.querySelector('#drawBar');
    if (bar) bar.classList.toggle('drawing', drawMode);
    renderOverlay();
  }
  // Drawing has to land on a bookmark, because that is what the export burns
  // in. Rather than refusing the stroke, the one that finishes it creates the
  // bookmark it needs. selectedBm is set before the save is awaited, so two
  // quick strokes share one bookmark instead of making two.
  async function ensureDrawTarget() {
    let bm = drawTarget();
    if (bm) return bm;
    const t = playhead();
    bm = { t, t2: Math.min(t + clipLenSec, (v && v.duration) || t + clipLenSec), tag: T('video.tagDefault'), comment: '', shapes: [] };
    bookmarks.push(bm);
    bookmarks.sort((a, b) => a.t - b.t);
    selectedBm = bm;
    await saveBookmarks();
    renderBm();
    return bm;
  }

  // ---- Picking a shape that is already there ------------------------------
  // Everything is stored in fractions of the frame, so the hit test works in the
  // same units and the tolerance is a fraction too.
  const HIT = 0.02;
  function distToSeg(p, a, b) {
    const vx = b[0] - a[0], vy = b[1] - a[1];
    const len = vx * vx + vy * vy;
    const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len)) : 0;
    return Math.hypot(p[0] - (a[0] + vx * t), p[1] - (a[1] + vy * t));
  }
  function hits(shape, p) {
    const q = shape.p || [];
    if (!q.length) return false;
    if (shape.k === 'text') return Math.hypot(p[0] - q[0][0], p[1] - q[0][1]) < 0.06;
    if (shape.k === 'free') {
      for (let i = 1; i < q.length; i++) if (distToSeg(p, q[i - 1], q[i]) < HIT) return true;
      return false;
    }
    if (q.length < 2) return false;
    const [a, b] = q;
    if (shape.k === 'rect' || shape.k === 'circle') {
      // The outline, not the fill — an empty box must not swallow every click in it.
      const c = [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]];
      for (let i = 0; i < 4; i++) if (distToSeg(p, c[i], c[(i + 1) % 4]) < HIT * 1.6) return true;
      return false;
    }
    return distToSeg(p, a, b) < HIT;
  }
  // Topmost first: the last drawn is the one on top of the picture.
  function shapeAt(bm, p) {
    const list = (bm && bm.shapes) || [];
    for (let i = list.length - 1; i >= 0; i--) if (hits(list[i], p)) return i;
    return -1;
  }
  function drawSelection(cx, w, h, shape) {
    const q = (shape && shape.p) || [];
    if (!q.length) return;
    const xs = q.map(p => p[0] * w), ys = q.map(p => p[1] * h);
    const pad = Math.max(10, Math.round(Math.min(w, h) * 0.02));
    const x1 = Math.min(...xs) - pad, y1 = Math.min(...ys) - pad;
    const x2 = Math.max(...xs) + pad, y2 = Math.max(...ys) + pad;
    cx.save();
    cx.setLineDash([6, 5]);
    cx.strokeStyle = '#ffd400';
    cx.lineWidth = Math.max(2, Math.round(Math.min(w, h) * 0.004));
    cx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    cx.restore();
  }

  function pt(e) {
    const r = overlay.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  }
  // Stays synchronous: awaiting here would let a fast pointerup arrive before
  // `drawing` exists, and the stroke would be dropped. The bookmark is created
  // by whatever finishes the shape instead.
  function onDrawDown(e) {
    if (!hasMedia()) { UI.toast(T('video.drawNeedMedia'), 'error'); return; }
    e.preventDefault();
    // Pausing first: a shape drawn over a moving picture never lands where the
    // coach meant it to.
    if (v && !v.paused) v.pause();
    if (EDIT_TOOLS.indexOf(dTool) >= 0) { editDown(e); return; }
    if (dTool === 'text') { askDrawText(pt(e)); return; }
    try { overlay.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
    drawing = { k: dTool, c: dColor, p: [pt(e), pt(e)] };
    renderOverlay();
  }
  // Select marks one, Move drags it, Remove takes it away.
  function editDown(e) {
    const bm = drawTarget();
    const at = pt(e);
    const i = shapeAt(bm, at);
    if (i < 0) { selShape = -1; renderOverlay(); if (dTool !== 'select') UI.toast(T('video.dNoHit')); return; }
    selShape = i;
    if (dTool === 'remove') {
      bm.shapes.splice(i, 1);
      selShape = -1;
      saveBookmarks().then(renderBm);
      renderOverlay();
      return;
    }
    if (dTool === 'move') {
      try { overlay.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
      moving = { i, from: at, orig: bm.shapes[i].p.map(p => p.slice()) };
    }
    renderOverlay();
  }

  function askDrawText(at) {
    UI.modal({
      title: T('video.textAsk'),
      body: `<label class="field"><span>${T('video.dtext')}</span>
        <input id="vd_txt" maxlength="60" placeholder="${UI.esc(T('video.textPh'))}"></label>`,
      footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button>
        <button class="btn primary" data-save>${T('common.save')}</button>`,
      onOpen: (m, close) => {
        const inp = m.querySelector('#vd_txt');
        inp.focus();
        const save = async () => {
          const txt = inp.value.trim();
          if (!txt) return close();
          const bm = await ensureDrawTarget();
          if (bm) {
            bm.shapes = (bm.shapes || []).concat([{ k: 'text', c: dColor, txt, p: [at] }]);
            await saveBookmarks();
            renderBm();
          }
          close();
          renderOverlay();
        };
        inp.onkeydown = ev => { if (ev.key === 'Enter') save(); };
        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-save]').onclick = save;
      }
    });
  }
  function onDrawMove(e) {
    if (moving) {
      e.preventDefault();
      const bm = drawTarget();
      const s = bm && bm.shapes[moving.i];
      if (!s) return;
      const at = pt(e);
      const dx = at[0] - moving.from[0], dy = at[1] - moving.from[1];
      s.p = moving.orig.map(p => [Math.min(1, Math.max(0, p[0] + dx)), Math.min(1, Math.max(0, p[1] + dy))]);
      renderOverlay();
      return;
    }
    if (!drawing) return;
    e.preventDefault();
    if (drawing.k === 'free') drawing.p.push(pt(e));
    else drawing.p[1] = pt(e);
    renderOverlay();
  }
  async function onDrawUp() {
    if (moving) {
      moving = null;
      await saveBookmarks();
      renderBm();
      holdDrawing(isPlaying());
      return;
    }
    if (!drawing) return;
    const shape = drawing;
    drawing = null;
    const moved = shape.p.length > 2 ||
      Math.hypot(shape.p[1][0] - shape.p[0][0], shape.p[1][1] - shape.p[0][1]) > 0.01;
    if (moved) {
      const bm = await ensureDrawTarget();
      bm.shapes = (bm.shapes || []).concat([shape]);
      await saveBookmarks();
      renderBm();
    }
    holdDrawing(isPlaying());
  }

  // A stroke drawn with no bookmark picked makes one of its own, which is not
  // always the one the coach meant. This moves the drawing onto the bookmark
  // they choose and clears away the stand-in it left behind.
  function saveDrawing() {
    const from = drawTarget();
    const shapes = (from && from.shapes) || [];
    if (!shapes.length) return UI.toast(T('video.drawNothing'), 'error');
    if (bookmarks.length < 2) return commitDrawing(from, from);
    UI.modal({
      title: T('video.drawSave'),
      width: 460,
      body: `<p class="hint">${T('video.drawSaveHint')}</p>
        <label class="field"><span>${T('video.bookmarks')}</span>
          <select id="dsb">${bookmarks.map((b, i) =>
    `<option value="${i}"${b === from ? ' selected' : ''}>${UI.esc(fmtRange(b))} \u00b7 ${UI.esc(b.tag || '')}${(b.shapes || []).length ? ' \u270e' + b.shapes.length : ''}</option>`).join('')}</select></label>`,
      footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button><button class="btn primary" data-save>${T('common.save')}</button>`,
      onOpen: (m, close) => {
        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-save]').onclick = async () => {
          const to = bookmarks[+m.querySelector('#dsb').value] || from;
          close();
          await commitDrawing(from, to);
        };
      }
    });
  }
  async function commitDrawing(from, to) {
    if (to !== from) {
      to.shapes = (to.shapes || []).concat(from.shapes);
      from.shapes = [];
      // The stand-in the stroke made is only worth keeping if it says something.
      if (!from.comment && from.tag === T('video.tagDefault')) {
        const i = bookmarks.indexOf(from);
        if (i >= 0) bookmarks.splice(i, 1);
      }
      selectedBm = to;
      selShape = -1;
    }
    await saveBookmarks();
    renderBm();
    holdDrawing(isPlaying());
    UI.toast(T('video.drawSaved') + ' ' + fmtRange(to) + ' ' + (to.tag || ''), 'success');
  }

  function bindDrawBar() {
    const bar = mount.querySelector('#drawBar');
    const sync = () => {
      bar.querySelectorAll('[data-dtool]').forEach(b => b.classList.toggle('primary', b.dataset.dtool === dTool));
      bar.querySelectorAll('[data-dcolor]').forEach(b => b.classList.toggle('on', b.dataset.dcolor === dColor));
    };
    // Picking a tool is also how most people expect to start drawing.
    bar.querySelectorAll('[data-dtool]').forEach(b => b.onclick = () => { dTool = b.dataset.dtool; selShape = -1; sync(); setDrawMode(true); });
    bar.querySelectorAll('[data-dcolor]').forEach(b => b.onclick = () => { dColor = b.dataset.dcolor; sync(); });
    mount.querySelector('#drawMode').onclick = () => setDrawMode(!drawMode);
    mount.querySelector('#drawSave').onclick = () => saveDrawing();
    mount.querySelector('#drawUndo').onclick = async () => {
      const bm = drawTarget();
      if (!bm || !(bm.shapes || []).length) return;
      bm.shapes.pop();
      selShape = -1;
      await saveBookmarks(); renderOverlay(); renderBm();
    };
    mount.querySelector('#drawClear').onclick = () => {
      const bm = drawTarget();
      if (!bm || !(bm.shapes || []).length) return;
      UI.confirm(T('video.drawClearAsk'), async () => {
        bm.shapes = [];
        selShape = -1;
        await saveBookmarks(); renderOverlay(); renderBm();
      });
    };
    sync();
  }
  bindDrawBar();

  // "12:34", "1:02:03" or plain seconds -> seconds.
  function parseClock(s) {
    const parts = String(s || '').trim().split(':').map(x => parseFloat(x) || 0);
    if (parts.length >= 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] || 0;
  }

  // ---- Start / end points -------------------------------------------------
  // A bookmark marks a passage, not an instant: t is where the clip starts and
  // t2 where it ends. Older bookmarks have no t2 and still work — they fall
  // back to the fixed window around t that the app always used.
  let inPoint = null, outPoint = null;
  let playUntil = null;

  const bmStart = b => Math.max(0, +b.t || 0);
  function bmEnd(b) {
    const s = bmStart(b);
    const e = +b.t2;
    return (e > s) ? e : s + clipLenSec;
  }
  const bmLen = b => Math.max(0.5, bmEnd(b) - bmStart(b));
  function fmtRange(b) {
    const s = UI.fmtClock(Math.floor(bmStart(b)));
    return (+b.t2 > bmStart(b)) ? s + ' – ' + UI.fmtClock(Math.round(bmEnd(b))) : s;
  }
  function renderMarks() {
    const tag = mount.querySelector('#markState');
    if (!tag) return;
    const has = inPoint != null || outPoint != null;
    tag.classList.toggle('green', has);
    tag.textContent = has
      ? T('video.markRange')
        .replace('{0}', inPoint == null ? '—' : UI.fmtClock(Math.floor(inPoint)))
        .replace('{1}', outPoint == null ? '—' : UI.fmtClock(Math.round(outPoint)))
      : T('video.markNone');
  }
  // Playing a bookmark stops at its end instead of running on into the next
  // phase of the match.
  function onRangeTick() {
    if (playUntil == null || !v) return;
    if (v.currentTime >= playUntil - 0.05) { playUntil = null; try { v.pause(); } catch (e) { /* already gone */ } }
  }

  // ---- Stream clock -------------------------------------------------------
  // A cross-origin player will not say where it is, so a stream gets a clock the
  // coach starts with the picture. Every tool reads the playhead below, which is
  // the video's own time for a file and this clock for a stream.
  let streamT = 0, streamRun = false, streamTick = null, streamFrom = 0;
  const playhead = () => hasLocalVideo() ? (v.currentTime || 0) : streamT;
  function paintClock() {
    const inp = mount.querySelector('#clockTime');
    if (inp && document.activeElement !== inp) inp.value = UI.fmtClock(Math.floor(streamT));
    const btn = mount.querySelector('#clockRun');
    if (btn) {
      btn.textContent = (streamRun ? '\u23f8 ' : '\u25b6 ') + T('video.clock');
      btn.classList.toggle('primary', streamRun);
    }
  }
  function setStreamTime(t) {
    streamT = Math.max(0, t || 0);
    if (streamRun) streamFrom = Date.now() - streamT * 1000;
    paintClock();
  }
  function runClock(on) {
    streamRun = !!on;
    if (streamTick) { clearInterval(streamTick); streamTick = null; }
    holdDrawing(streamRun);
    if (streamRun) {
      streamFrom = Date.now() - streamT * 1000;
      streamTick = setInterval(() => {
        streamT = (Date.now() - streamFrom) / 1000;
        if (playUntil != null && streamT >= playUntil) {
          playUntil = null;
          ytCmd('pauseVideo');            // YouTube also stops itself on the end= it was given
          runClock(false);
          return;
        }
        paintClock();
      }, 250);
    }
    paintClock();
  }
  // The player's own position wins over the clock's guess at it, so a drag of
  // its scrub bar lands here and the clock jumps with the picture.
  function adoptStreamTime(t) {
    const s = Math.max(0, +t || 0);
    const moved = Math.floor(s) !== Math.floor(streamT);
    streamT = s;
    streamFrom = Date.now() - s * 1000;
    if (moved) paintClock();
  }
  // 1 = playing, 2 = paused, 0 = ended. The picture decides whether the clock runs.
  function followPlayer(state) {
    const on = state === 1;
    if (on !== streamRun) runClock(on);
  }

  // Create a bookmark over a passage of play. Auto-saved immediately on confirm.
  // Both timestamps are editable so streams (whose time we cannot read from the
  // cross-origin iframe) can be tagged too.
  function createBookmark(seed) {
    const now = playhead();
    const start = seed && seed.t != null ? seed.t : (inPoint != null ? inPoint : now);
    const end = seed && seed.t2 != null ? seed.t2 : (outPoint != null ? outPoint : 0);
    const editing = seed && seed.bm;
    if (v && !v.paused) v.pause();
    UI.modal({
      title: editing ? T('video.editBookmark') : T('video.addBookmark'),
      body: `
        <div class="row" style="flex:0;gap:10px">
          <label class="field"><span>${T('video.start')}</span><input id="bm_time" value="${UI.fmtClock(Math.floor(start))}" placeholder="mm:ss"></label>
          <label class="field"><span>${T('video.end')}</span><input id="bm_end" value="${end > start ? UI.fmtClock(Math.round(end)) : ''}" placeholder="mm:ss"></label>
        </div>
        <p class="hint">${UI.esc(T('video.endHint').replace('{0}', clipLenSec))}</p>
        <label class="field"><span>${T('video.tag')}</span><input id="bm_tag" value="${UI.esc(editing ? (seed.bm.tag || '') : T('video.tagDefault'))}" placeholder="${T('video.tag')}"></label>
        <label class="field"><span>${T('video.comment')}</span><textarea id="bm_comment" rows="3" placeholder="${T('video.commentPh')}">${UI.esc(editing ? (seed.bm.comment || '') : '')}</textarea></label>`,
      footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button><button class="btn primary" data-save>${T('common.save')}</button>`,
      onOpen: (m, close) => {
        const tagEl = m.querySelector('#bm_tag');
        if (tagEl) { tagEl.focus(); tagEl.select(); }
        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-save]').onclick = async () => {
          const at = Math.max(0, parseClock(m.querySelector('#bm_time').value));
          const endRaw = m.querySelector('#bm_end').value.trim();
          const to = endRaw ? Math.max(0, parseClock(endRaw)) : 0;
          if (endRaw && to <= at) return UI.toast(T('video.endBeforeStart'), 'error');
          const tag = (m.querySelector('#bm_tag').value || '').trim() || 'Bookmark';
          const comment = (m.querySelector('#bm_comment').value || '').trim();
          if (editing) {
            Object.assign(seed.bm, { t: at, t2: to, tag, comment });
          } else {
            const bm = { t: at, t2: to, tag, comment };
            bookmarks.push(bm);
            selectedBm = bm;
          }
          bookmarks.sort((a, b) => a.t - b.t);
          inPoint = outPoint = null;
          renderMarks();
          await saveBookmarks();               // auto-save immediately
          close();
          UI.toast(T('video.bmSaved'), 'success');
          renderBm();
        };
      }
    });
  }

  // Toggle fullscreen on the whole video panel (bookmarks & tips move with it).
  function toggleVideoFullscreen() {
    const el = mount.querySelector('#videoPanel');
    if (!el) return;
    if (!document.fullscreenElement) {
      (el.requestFullscreen || el.webkitRequestFullscreen || function () {}).call(el);
    } else {
      (document.exitFullscreen || document.webkitExitFullscreen || function () {}).call(document);
    }
  }
  function onVideoFsChange() {
    const el = mount.querySelector('#videoPanel');
    const btn = mount.querySelector('#videoFs');
    const fs = document.fullscreenElement === el;
    if (el) el.classList.toggle('fs', fs);
    if (btn) btn.innerHTML = '⛶ ' + (fs ? T('video.exitFullscreen') : T('video.fullscreen'));
    setTimeout(sizeOverlay, 80);          // the picture is a different size now
  }
  document.addEventListener('fullscreenchange', onVideoFsChange);
  const vfsBtn = mount.querySelector('#videoFs');
  if (vfsBtn) vfsBtn.onclick = toggleVideoFullscreen;

  // ---- Move mode ---------------------------------------------------------
  // Analysing a clip means reading the bookmark list and the picture at the
  // same time, and on a phone the player covers whichever one you are not
  // looking at. Move mode lifts the panel out of the flow so it can be dragged
  // anywhere on screen — by its header, with a pointer or a thumb — and it
  // stays where it was put between visits.
  const POS_KEY = 'stx_video_pos';
  const panel = mount.querySelector('#videoPanel');
  const head = mount.querySelector('#videoHead');
  const moveBtn = mount.querySelector('#videoMove');
  let drag = null;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function place(x, y) {
    const w = panel.offsetWidth, h = panel.offsetHeight;
    // Keep a grabbable strip on screen however small the window gets.
    panel.style.left = clamp(x, 24 - w, window.innerWidth - 48) + 'px';
    panel.style.top = clamp(y, 0, Math.max(0, window.innerHeight - 44)) + 'px';
  }
  function savePos() {
    try { localStorage.setItem(POS_KEY, JSON.stringify({ x: parseInt(panel.style.left, 10) || 0, y: parseInt(panel.style.top, 10) || 0 })); }
    catch (e) { /* private mode */ }
  }
  function setFloat(on) {
    panel.classList.toggle('float', on);
    if (moveBtn) {
      moveBtn.classList.toggle('primary', on);
      moveBtn.innerHTML = '✥ ' + T(on ? 'video.moveDock' : 'video.move');
    }
    if (!on) { panel.style.left = panel.style.top = ''; return; }
    let p = null;
    try { p = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); } catch (e) { /* ignore */ }
    const r = panel.getBoundingClientRect();
    place(p ? p.x : Math.round(r.left), p ? p.y : Math.round(r.top));
    setTimeout(sizeOverlay, 60);
  }
  if (moveBtn) moveBtn.onclick = () => setFloat(!panel.classList.contains('float'));
  if (head) head.addEventListener('pointerdown', e => {
    if (!panel.classList.contains('float')) return;
    if (e.target.closest('button, select, input, label')) return;   // the controls keep working
    const r = panel.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    head.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  if (head) head.addEventListener('pointermove', e => {
    if (!drag) return;
    place(e.clientX - drag.dx, e.clientY - drag.dy);
  });
  const endDrag = () => { if (drag) { drag = null; savePos(); } };
  if (head) { head.addEventListener('pointerup', endDrag); head.addEventListener('pointercancel', endDrag); }
  // A rotated phone can leave the panel off screen entirely.
  const keepOnScreen = () => { if (panel.classList.contains('float')) place(parseInt(panel.style.left, 10) || 0, parseInt(panel.style.top, 10) || 0); };
  window.addEventListener('resize', keepOnScreen);
  const sizeSel = mount.querySelector('#vSize');
  if (sizeSel) sizeSel.onchange = () => {
    vSize = sizeSel.value;
    try { localStorage.setItem(SIZE_KEY, vSize); } catch (e) { /* private mode */ }
    VIDEO_SIZES.forEach(s => wrap.classList.toggle('size-' + s, s === vSize));
    setTimeout(sizeOverlay, 60);
  };
  bindLocalControls();
  mountOverlay();
  showPlaybackBtns(true);
  setDrawMode(false);

  loadBookmarks();

  // ---- Export bookmarks as WebM + MP4 sequences ----
  // MediaRecorder can only write containers the browser encodes natively, so MP4
  // is emitted where available (Safari, newer Chrome) and skipped elsewhere.
  function pickFormats() {
    const cand = [
      ['video/webm;codecs=vp9,opus', 'webm'], ['video/webm;codecs=vp8,opus', 'webm'], ['video/webm', 'webm'],
      ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'mp4'], ['video/mp4;codecs=avc1', 'mp4'], ['video/mp4', 'mp4']
    ];
    const sup = m => !!(window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m));
    const out = [];
    ['webm', 'mp4'].forEach(ext => {
      const hit = cand.find(c => c[1] === ext && sup(c[0]));
      if (hit) out.push({ mime: hit[0], ext });
    });
    if (!out.length) out.push({ mime: '', ext: 'webm' });
    return out;
  }
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  // Burn the bookmark's timestamp, tag and comment into the opening seconds of
  // every exported clip, then fade it out so it never covers the action.
  const CAP_SHOW = 2.6, CAP_FADE = 0.6;
  function drawCaption(cx, w, h, bm, elapsed) {
    if (!bm) return;
    const el = elapsed || 0;
    if (el >= CAP_SHOW) return;
    const alpha = el > CAP_SHOW - CAP_FADE ? Math.max(0, (CAP_SHOW - el) / CAP_FADE) : 1;
    const pad = Math.max(8, Math.round(h * 0.025));
    const head = Math.max(14, Math.round(h * 0.05));
    const body = Math.max(12, Math.round(h * 0.038));
    const lead = Math.round(body * 1.32);
    const lines = [];
    if (bm.comment) {
      cx.font = body + 'px Arial, Helvetica, sans-serif';
      const max = w - pad * 4;
      let line = '';
      String(bm.comment).split(/\s+/).forEach(word => {
        const t = line ? line + ' ' + word : word;
        if (line && cx.measureText(t).width > max) { lines.push(line); line = word; } else line = t;
      });
      if (line) lines.push(line);
      lines.length = Math.min(lines.length, 3);
    }
    const boxH = pad * 2 + head + (lines.length ? lines.length * lead + Math.round(pad * 0.6) : 0);
    const y0 = h - boxH - pad;
    cx.save();
    cx.globalAlpha = alpha;
    cx.fillStyle = 'rgba(0,0,0,.62)';
    cx.fillRect(pad, y0, w - pad * 2, boxH);
    cx.fillStyle = '#ffffff';
    cx.fillRect(pad, y0, Math.max(3, Math.round(w * 0.004)), boxH);
    cx.textBaseline = 'top';
    cx.font = 'bold ' + head + 'px Arial, Helvetica, sans-serif';
    cx.fillText(fmtRange(bm) + '   ' + (bm.tag || ''), pad * 2, y0 + pad);
    cx.font = body + 'px Arial, Helvetica, sans-serif';
    lines.forEach((ln, i) => cx.fillText(ln, pad * 2, y0 + pad + head + Math.round(pad * 0.6) + i * lead));
    cx.restore();
  }
  // Record a segment [start,end] of the local video once, into every requested
  // container at the same time — several recorders can share one capture stream,
  // so a single playback pass yields both the WebM and the MP4.
  function recordSegment(start, end, formats, bm) {
    return new Promise((resolve, reject) => {
      const cap = v.captureStream || v.mozCaptureStream;
      if (!cap) { reject(new Error('captureStream unsupported')); return; }
      let src;
      try { src = cap.call(v); } catch (e) { reject(e); return; }
      if (!src || !src.getTracks || !src.getTracks().length) { reject(new Error('empty stream')); return; }
      // Draw video + caption into a canvas and record that instead of the raw
      // element stream; the original audio track is carried over unchanged.
      const cv = document.createElement('canvas');
      cv.width = v.videoWidth || 1280;
      cv.height = v.videoHeight || 720;
      const cx = cv.getContext('2d');
      // A timer drives the compositor, not requestAnimationFrame: rAF stops when
      // the tab loses visibility and the export would silently go black.
      const paint = () => {
        try {
          cx.drawImage(v, 0, 0, cv.width, cv.height);
          // The drawing stays for the whole clip; only the caption fades out.
          drawShapes(cx, cv.width, cv.height, bm);
          drawCaption(cx, cv.width, cv.height, bm, v.currentTime - start);
        } catch (e) {}
      };
      paint();
      const timer = setInterval(paint, 33);
      let vfc = 0, painting = true;
      if (v.requestVideoFrameCallback) {
        const step = () => { paint(); if (painting) vfc = v.requestVideoFrameCallback(step); };
        vfc = v.requestVideoFrameCallback(step);
      }
      const stopPaint = () => {
        painting = false; clearInterval(timer);
        if (vfc && v.cancelVideoFrameCallback) { try { v.cancelVideoFrameCallback(vfc); } catch (e) {} }
      };
      let stream;
      try { stream = cv.captureStream(30); } catch (e) { stopPaint(); reject(e); return; }
      src.getAudioTracks().forEach(t => { try { stream.addTrack(t); } catch (e) {} });
      const recs = [];
      formats.forEach(f => {
        let r = null;
        try { r = f.mime ? new MediaRecorder(stream, { mimeType: f.mime }) : new MediaRecorder(stream); }
        catch (e) { r = null; }
        if (r) recs.push({ rec: r, ext: f.ext, chunks: [], done: false });
      });
      if (!recs.length) {
        try { recs.push({ rec: new MediaRecorder(stream), ext: 'webm', chunks: [], done: false }); }
        catch (e) { reject(e); return; }
      }
      let settled = false, safety = null;
      const cleanup = () => { if (safety) clearTimeout(safety); stopPaint(); v.removeEventListener('timeupdate', onTime); v.removeEventListener('seeked', onSeeked); };
      const finishOk = () => {
        if (settled || recs.some(r => !r.done)) return;
        settled = true; cleanup();
        resolve(recs.map(r => ({ ext: r.ext, blob: new Blob(r.chunks, { type: r.rec.mimeType || ('video/' + r.ext) }) })).filter(o => o.blob.size));
      };
      const finishErr = (err) => { if (settled) return; settled = true; cleanup(); reject(err); };
      recs.forEach(r => {
        r.rec.ondataavailable = e => { if (e.data && e.data.size) r.chunks.push(e.data); };
        r.rec.onstop = () => { r.done = true; finishOk(); };
        // One dead container must not sink the others; drop it and keep going.
        r.rec.onerror = () => { r.done = true; r.chunks.length = 0; finishOk(); };
      });
      // Must run once only: a second call would mark still-flushing recorders
      // "done" before their dataavailable arrives and resolve with empty blobs.
      let stopping = false;
      const stop = () => {
        if (stopping) return;
        stopping = true;
        v.removeEventListener('timeupdate', onTime);
        try { v.pause(); } catch (e) {}
        let flushing = false;
        recs.forEach(r => {
          if (r.done) return;
          if (r.rec.state !== 'inactive') { try { r.rec.stop(); flushing = true; } catch (e) { r.done = true; } }
          else r.done = true;
        });
        if (!flushing) finishOk();
      };
      const onTime = () => { if (v.currentTime >= end - 0.05) stop(); };
      const begin = () => {
        let started = 0;
        recs.forEach(r => { try { r.rec.start(); started++; } catch (e) { r.done = true; } });
        if (!started) { finishErr(new Error('recorder start failed')); return; }
        v.addEventListener('timeupdate', onTime);
        const p = v.play();
        if (p && p.catch) p.catch(() => {});
        // Safety net: real playback duration + buffer, in case timeupdate stalls.
        safety = setTimeout(stop, ((end - start) / (v.playbackRate || 1)) * 1000 + 2500);
      };
      const onSeeked = () => { v.removeEventListener('seeked', onSeeked); begin(); };
      const target = Math.max(0, Math.min(start, (v.duration || start + 1) - 0.05));
      v.addEventListener('seeked', onSeeked);
      try { v.pause(); } catch (e) {}
      // If we're already at the target, no 'seeked' fires — start immediately.
      if (Math.abs(v.currentTime - target) < 0.08) { v.removeEventListener('seeked', onSeeked); begin(); }
      else { try { v.currentTime = target; } catch (e) { v.removeEventListener('seeked', onSeeked); begin(); } }
    });
  }
  // ---- Clips from a stream ------------------------------------------------
  // A cross-origin player hands out no pixels, so the only clip a browser can
  // cut from YouTube & co. is the one it can see: the coach shares this tab, the
  // passage is played, and what shows is recorded through the same canvas the
  // local export uses — the drawing and the caption are burnt in identically.
  const wait = ms => new Promise(r => setTimeout(r, ms));
  let shareStream = null;
  const canShare = () => !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
  async function ensureShare() {
    if (shareStream && shareStream.getVideoTracks().some(t => t.readyState === 'live')) return shareStream;
    shareStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
    shareStream.getVideoTracks().forEach(t => t.addEventListener('ended', () => { shareStream = null; }));
    return shareStream;
  }
  function stopShare() {
    if (!shareStream) return;
    shareStream.getTracks().forEach(t => { try { t.stop(); } catch (e) { /* already gone */ } });
    shareStream = null;
  }
  // Where the player sits inside the shared surface. Exact when the tab was
  // shared; a whole-screen share falls back to the full frame.
  const CTRL_BAR = 52;      // the player's own control bar, kept out of the clip
  function shareCrop(srcW, srcH) {
    const box = wrap.querySelector('.embed-frame') || v;
    const vw = window.innerWidth, vh = window.innerHeight;
    if (!box || !vw || !vh) return null;
    const r = box.getBoundingClientRect();
    if (r.width < 8 || r.height < 8 || r.top < 0 || r.left < 0) return null;
    // The scrub bar and buttons belong to the player, not to the passage, so the
    // strip they sit in is cut off the bottom of every clip.
    const bar = Math.min(CTRL_BAR, r.height * 0.18);
    const sx = Math.max(0, Math.round(r.left / vw * srcW));
    const sy = Math.max(0, Math.round(r.top / vh * srcH));
    const sw = Math.min(srcW - sx, Math.round(r.width / vw * srcW));
    const sh = Math.min(srcH - sy, Math.round((r.height - bar) / vh * srcH));
    // How much of the picture the clip keeps, so the drawing lands where the
    // coach put it even though the bottom strip is gone.
    const keepY = r.height ? (r.height - bar) / r.height : 1;
    return (sw > 16 && sh > 16) ? { sx, sy, sw, sh, keepY } : null;
  }
  async function recordShare(secs, formats, bm) {
    const stream = await ensureShare();
    // Our own overlay is on screen too, so the capture would pick the drawing up
    // a second time and the armed border with it. It goes dark for the take; the
    // compositor below is what burns the shapes in.
    const hidden = overlay ? overlay.style.visibility : '';
    if (overlay) overlay.style.visibility = 'hidden';
    const src = document.createElement('video');
    src.srcObject = stream; src.muted = true; src.playsInline = true;
    try { await src.play(); } catch (e) { /* metadata first on some engines */ }
    if (!src.videoWidth) await new Promise(r => { src.onloadedmetadata = r; setTimeout(r, 3000); });
    const crop = shareCrop(src.videoWidth, src.videoHeight)
      || { sx: 0, sy: 0, sw: src.videoWidth || 1280, sh: src.videoHeight || 720, keepY: 1 };
    const cv = document.createElement('canvas');
    cv.width = crop.sw; cv.height = crop.sh;
    const cx = cv.getContext('2d');
    const shapeH = Math.max(1, Math.round(cv.height / (crop.keepY || 1)));
    const t0 = Date.now();
    const paint = () => {
      try {
        cx.drawImage(src, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, cv.width, cv.height);
        drawShapes(cx, cv.width, shapeH, bm);
        drawCaption(cx, cv.width, cv.height, bm, (Date.now() - t0) / 1000);
      } catch (e) { /* a frame that is not ready is simply skipped */ }
    };
    paint();
    const timer = setInterval(paint, 33);
    let out;
    try {
      out = await new Promise((resolve, reject) => {
        let cvStream;
        try { cvStream = cv.captureStream(30); } catch (e) { reject(e); return; }
        stream.getAudioTracks().forEach(t => { try { cvStream.addTrack(t); } catch (e) { /* no audio shared */ } });
        const recs = [];
        formats.forEach(f => {
          try { recs.push({ rec: f.mime ? new MediaRecorder(cvStream, { mimeType: f.mime }) : new MediaRecorder(cvStream), ext: f.ext, chunks: [], done: false }); }
          catch (e) { /* container this engine cannot write */ }
        });
        if (!recs.length) { reject(new Error('no recorder')); return; }
        let settled = false;
        const finish = () => {
          if (settled || recs.some(r => !r.done)) return;
          settled = true;
          resolve(recs.map(r => ({ ext: r.ext, blob: new Blob(r.chunks, { type: r.rec.mimeType || ('video/' + r.ext) }) })).filter(o => o.blob.size));
        };
        recs.forEach(r => {
          r.rec.ondataavailable = e => { if (e.data && e.data.size) r.chunks.push(e.data); };
          r.rec.onstop = () => { r.done = true; finish(); };
          r.rec.onerror = () => { r.done = true; r.chunks.length = 0; finish(); };
          try { r.rec.start(); } catch (e) { r.done = true; }
        });
        setTimeout(() => recs.forEach(r => {
          if (r.done) return;
          if (r.rec.state !== 'inactive') { try { r.rec.stop(); } catch (e) { r.done = true; finish(); } }
          else { r.done = true; finish(); }
        }), Math.round(secs * 1000));
      });
    } finally {
      clearInterval(timer);
      src.srcObject = null;
      if (overlay) overlay.style.visibility = hidden;
    }
    return out;
  }
  // Play each passage in the streamed player and record it off the screen.
  async function exportStreamClips(ext, list, formats) {
    if (!canShare()) { UI.toast(T('video.needShare'), 'error'); return 0; }
    UI.toast(T('video.shareAsk'));
    let ok = 0;
    for (const b of list) {
      const from = bmStart(b);
      const secs = Math.max(1, Math.min(120, bmEnd(b) - from));
      // No end is given to the player: the recorder decides how long the clip is.
      aimStream(from, null, true);
      // Long enough for the seek to land and for the player to hide its own
      // controls, which it does once the pointer is off it.
      await wait(3200);
      let outs = null;
      try { outs = await recordShare(secs, formats, b); }
      catch (e) { UI.toast(T('video.shareStopped'), 'error'); break; }
      const safe = String(b.tag).replace(/[^\w\-]+/g, '_').slice(0, 40) || 'clip';
      const base = `clip-${String(bookmarks.indexOf(b) + 1).padStart(2, '0')}-${safe}-${Math.floor(b.t)}s`;
      (outs || []).forEach(o => { download(o.blob, `${base}.${o.ext}`); ok++; });
    }
    stopShare();
    runClock(false);
    return ok;
  }

  async function exportClipSequences(ext, only) {
    const list = (only && bookmarks.indexOf(only) >= 0) ? [only] : bookmarks;
    if (!list.length) { UI.toast(T('video.noBm'), 'error'); return; }
    const formats = pickFormats().filter(f => f.ext === ext);
    if (!formats.length) { UI.toast(T('video.noMp4'), 'error'); return; }
    if (!window.MediaRecorder) { UI.toast(T('video.needLocal'), 'error'); return; }
    // A range left armed by Play would pause the recorder mid-clip.
    playUntil = null;
    const localReady = hasLocalVideo() && v.duration && !isNaN(v.duration) && (v.captureStream || v.mozCaptureStream);
    if (!localReady) {
      if (!hasEmbed()) { UI.toast(T('video.needMedia'), 'error'); return; }
      const n = await exportStreamClips(ext, list, formats);
      UI.toast(n ? T('video.exported') + ' (' + n + ' \u00d7 ' + ext.toUpperCase() + ')' : T('video.noClip'), n ? 'success' : 'error');
      return;
    }
    UI.toast(T('video.exporting') + ' ' + ext.toUpperCase());
    const wasRate = v.playbackRate, wasMuted = v.muted;
    v.playbackRate = 1; v.muted = true;   // mute so playback is silent and never autoplay-blocked
    let ok = 0;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      // A bookmark with an end point exports exactly that passage; one without
      // keeps the old fixed window centred on its timestamp.
      const hasRange = +b.t2 > bmStart(b);
      const start = hasRange ? Math.max(0, bmStart(b)) : Math.max(0, b.t - clipLenSec / 2);
      const end = Math.min(v.duration, Math.max(hasRange ? bmEnd(b) : b.t + clipLenSec / 2, start + 1));
      try {
        const outs = await recordSegment(start, end, formats, b);
        const safe = String(b.tag).replace(/[^\w\-]+/g, '_').slice(0, 40) || 'clip';
        const base = `clip-${String(bookmarks.indexOf(b) + 1).padStart(2, '0')}-${safe}-${Math.floor(b.t)}s`;
        (outs || []).forEach(o => { download(o.blob, `${base}.${o.ext}`); ok++; });
      } catch (e) { /* skip failed segment */ }
    }
    v.playbackRate = wasRate; v.muted = wasMuted; v.pause();
    UI.toast(ok ? T('video.exported') + ' (' + ok + ' × ' + ext.toUpperCase() + ')' : T('video.needLocal'), ok ? 'success' : 'error');
  }
  const mp4Ok = pickFormats().some(f => f.ext === 'mp4');
  mount.querySelector('#exportWebm').onclick = () => exportClipSequences('webm', selectedBm);
  const mp4Btn = mount.querySelector('#exportMp4');
  mp4Btn.onclick = () => exportClipSequences('mp4', selectedBm);
  if (!mp4Ok) { mp4Btn.disabled = true; mp4Btn.title = T('video.noMp4'); }

  // Shows whether the header export buttons cover every bookmark or just the
  // one picked with "Go".
  function renderScope() {
    const s = mount.querySelector('#bmScope');
    if (!s) return;
    if (selectedBm && bookmarks.indexOf(selectedBm) >= 0) {
      s.innerHTML = `${T('video.expOne')} <b>${UI.esc(fmtRange(selectedBm))} ${UI.esc(selectedBm.tag)}</b> `
        + `<button class="btn sm" id="bmScopeAll">${T('video.expAllBtn')}</button>`;
      const all = s.querySelector('#bmScopeAll');
      if (all) all.onclick = () => { selectedBm = null; renderBm(); };
    } else {
      s.textContent = T('video.expAll');
    }
  }

  async function renderBm() {
    const l = mount.querySelector('#bmList');
    l.innerHTML = bookmarks.length ? bookmarks.map((b, i) =>
      `<div class="bm-item${b === selectedBm ? ' sel' : ''}">
        <div class="bm-main">
          <span><span class="tag blue">${UI.esc(fmtRange(b))}</span> <span class="tag">${Math.round(bmLen(b))}s</span> ${UI.esc(b.tag)}${(b.shapes || []).length ? ` <span class="tag green">✎ ${(b.shapes || []).length}</span>` : ''}</span>
          <span class="bm-acts">
            <button class="btn sm" data-go="${i}">${T('common.go')}</button>
            <button class="btn sm" data-play="${i}">▶ ${T('video.playRange')}</button>
            <button class="btn sm" data-edit="${i}">${T('common.edit')}</button>
            <button class="btn sm primary" data-webm="${i}">${T('video.exportWebm')}</button>
            <button class="btn sm primary" data-mp4="${i}"${mp4Ok ? '' : ` disabled title="${UI.esc(T('video.noMp4'))}"`}>${T('video.exportMp4')}</button>
            <button class="btn sm danger" data-rm="${i}">${T('common.remove')}</button>
          </span>
        </div>
        ${b.comment ? `<p class="bm-comment">${UI.esc(b.comment)}</p>` : ''}
      </div>`).join('') : `<p style="color:var(--muted)">${T('video.noBm')}</p>`;
    l.querySelectorAll('[data-go]').forEach(b => b.onclick = () => {
      const bm = bookmarks[+b.dataset.go];
      selectedBm = bm;
      selShape = -1;
      playUntil = null;
      if (hasLocalVideo()) { v.currentTime = bmStart(bm); v.pause(); }
      else aimStream(bmStart(bm), null, false);
      renderBm();
      renderOverlay();
    });
    l.querySelectorAll('[data-play]').forEach(b => b.onclick = () => {
      const bm = bookmarks[+b.dataset.play];
      selectedBm = bm;
      selShape = -1;
      const from = bmStart(bm), to = bmEnd(bm);
      // Armed only once the seek has landed: a timeupdate from the old position
      // would otherwise stop the clip before it started.
      playUntil = null;
      if (!hasLocalVideo()) {
        // The platform is told where to start and, where it can be, where to stop.
        aimStream(from, to, true);
        renderBm();
        return;
      }
      const go = () => {
        playUntil = to;
        const p = v.play();
        if (p && p.catch) p.catch(() => {});
      };
      if (Math.abs(v.currentTime - from) < 0.15) go();
      else { v.addEventListener('seeked', go, { once: true }); v.currentTime = from; }
      renderBm();
    });
    l.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
      const bm = bookmarks[+b.dataset.edit];
      createBookmark({ bm, t: bmStart(bm), t2: +bm.t2 || 0 });
    });
    l.querySelectorAll('[data-webm]').forEach(b => b.onclick = () => {
      selectedBm = bookmarks[+b.dataset.webm]; renderBm();
      exportClipSequences('webm', selectedBm);
    });
    l.querySelectorAll('[data-mp4]').forEach(b => b.onclick = () => {
      selectedBm = bookmarks[+b.dataset.mp4]; renderBm();
      exportClipSequences('mp4', selectedBm);
    });
    l.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => {
      const gone = bookmarks.splice(+b.dataset.rm, 1)[0];
      if (gone === selectedBm) selectedBm = null;
      await saveBookmarks(); renderBm();
    });
    renderScope();
    renderOverlay();
  }
  renderBm();

  const onVResize = () => sizeOverlay();
  window.addEventListener('resize', onVResize);

  return () => {
    document.removeEventListener('fullscreenchange', onVideoFsChange);
    window.removeEventListener('resize', onVResize);
    window.removeEventListener('resize', keepOnScreen);
    window.removeEventListener('message', onFrameMsg);
    if (streamTick) { clearInterval(streamTick); streamTick = null; }
    stopShare();
    if (sizeWatch) { sizeWatch.disconnect(); sizeWatch = null; }
  };
};

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
      // Direct file or already-embed URL — return as-is
      return url;
    } catch (e) { return null; }
  }

  // ---- Telestration ------------------------------------------------------
  // Shapes belong to a bookmark and are stored in fractions of the frame, so the
  // same drawing lands in the right place on the preview and in the export,
  // whatever the video resolution is.
  const DRAW_TOOLS = ['arrow', 'line', 'free', 'circle', 'rect', 'text'];
  const DRAW_COLORS = ['#ffd400', '#ff3b30', '#34c759', '#0a84ff', '#ffffff', '#101010'];
  let dTool = 'arrow';
  let dColor = DRAW_COLORS[0];
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
      </div>
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
          <button class="btn sm" id="videoMove" title="${T('video.move')}">✥ ${T('video.move')}</button>
          <button class="btn sm" id="videoFs" title="${T('video.fullscreen')}">⛶ ${T('video.fullscreen')}</button>
        </span>
      </div>
      <div class="v-stage" id="vStage">
        <div id="mediaWrap" class="size-${vSize}">
          <video id="player" class="v-media" controls></video>
        </div>
        <div class="draw-bar" id="drawBar">
          <span class="tool-group">
            <button class="btn sm" id="drawMode">✎ ${T('video.drawMode')}</button>
          </span>
          <span class="tool-group">
            ${DRAW_TOOLS.map(t => `<button class="btn sm" data-dtool="${t}">${T('video.d' + t)}</button>`).join('')}
          </span>
          <span class="draw-colors">${DRAW_COLORS.map(c => `<button class="swatch" data-dcolor="${c}" style="--sw:${c}" title="${c}"></button>`).join('')}</span>
          <span class="tool-group">
            <button class="btn sm" id="drawUndo">\u21b6 ${T('tactics.undo')}</button>
            <button class="btn sm danger" id="drawClear">${T('video.drawClear')}</button>
          </span>
        </div>
      </div>
      <p class="hint" id="drawHint"></p>
      <div class="row" style="margin-top:10px;flex:0;flex-wrap:wrap" id="localControls">
        <button class="btn sm local-only" data-seek="-5">« 5s</button>
        <button class="btn sm local-only" data-rate="0.5">0.5×</button>
        <button class="btn sm local-only" data-rate="1">1×</button>
        <button class="btn sm local-only" data-rate="2">2×</button>
        <button class="btn sm local-only" data-seek="5">5s »</button>
        <span class="tool-group mark-group">
          <button class="btn sm local-only" id="markIn">⌘ ${T('video.markIn')}</button>
          <button class="btn sm local-only" id="markOut">⌙ ${T('video.markOut')}</button>
          <span class="tag" id="markState"></span>
        </span>
        <button class="btn sm primary" id="bm">★ ${T('video.bookmark')}</button>
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
      <label class="btn primary" style="cursor:pointer">${T('video.import')}<input id="vfile" type="file" accept="video/*" hidden></label>
    </div>
    ${UI.acc('videoStream', T('video.stream'), streamCard)}
    ${UI.acc('videoPlayer', T('video.player'), playerPanel)}`;

  UI.bindAcc(mount);
  // An imported bookmark file replaces the list, so it is re-read before drawing.
  UI.bindShare(mount, 'video', () => { loadBookmarks(); renderBm(); });

  const wrap = mount.querySelector('#mediaWrap');
  const localControls = mount.querySelector('#localControls');
  let v = mount.querySelector('#player');

  // Seek/speed need a real <video>; bookmarking stays available for streams too.
  function showPlaybackBtns(on) {
    localControls.querySelectorAll('.local-only').forEach(b => { b.style.display = on ? '' : 'none'; });
  }
  function hasLocalVideo() { return !!(v && v.src && v.isConnected); }

  function showLocalVideo() {
    wrap.innerHTML = `<video id="player" class="v-media" controls></video>`;
    v = mount.querySelector('#player');
    showPlaybackBtns(true);
    bindLocalControls();
    mountOverlay();
  }
  function showEmbed(src) {
    wrap.innerHTML = `<div class="embed-frame"><iframe src="${UI.esc(src)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen frameborder="0"></iframe></div>`;
    v = null;
    overlay = null; octx = null;
    if (sizeWatch) { sizeWatch.disconnect(); sizeWatch = null; }
    showPlaybackBtns(false);
    setDrawMode(false);
  }

  mount.querySelector('#loadStream').onclick = () => {
    const src = toEmbed(mount.querySelector('#streamUrl').value);
    if (!src) { UI.toast(T('video.badUrl'), 'error'); return; }
    showEmbed(src);
    UI.toast(T('video.streaming'), 'success');
  };
  mount.querySelector('#streamUrl').addEventListener('keydown', e => { if (e.key === 'Enter') mount.querySelector('#loadStream').click(); });

  mount.querySelector('#vfile').onchange = e => {
    const f = e.target.files[0];
    if (!f) return;
    showLocalVideo();
    v.src = URL.createObjectURL(f);
    // Only now is there something to draw on, so the tools are re-armed here
    // rather than inside showLocalVideo, which runs one line too early.
    setDrawMode(drawMode);
    UI.toast(T('video.streaming'));
  };

  function bindLocalControls() {
    mount.querySelectorAll('[data-seek]').forEach(b => b.onclick = () => { if (v) v.currentTime += +b.dataset.seek; });
    mount.querySelectorAll('[data-rate]').forEach(b => b.onclick = () => { if (v) v.playbackRate = +b.dataset.rate; });
    mount.querySelector('#bm').onclick = () => createBookmark();
    mount.querySelector('#markIn').onclick = () => {
      if (!hasLocalVideo()) return UI.toast(T('video.needLocal'), 'error');
      inPoint = v.currentTime || 0;
      if (outPoint != null && outPoint <= inPoint) outPoint = null;
      renderMarks();
      UI.toast(T('video.markedIn') + ' ' + UI.fmtClock(Math.floor(inPoint)));
    };
    mount.querySelector('#markOut').onclick = () => {
      if (!hasLocalVideo()) return UI.toast(T('video.needLocal'), 'error');
      outPoint = v.currentTime || 0;
      if (inPoint == null || inPoint >= outPoint) inPoint = Math.max(0, outPoint - clipLenSec);
      renderMarks();
      // Both ends are known now, so the dialog opens with the passage already
      // filled in and only the name is left to type.
      createBookmark();
    };
    renderMarks();
  }

  // ---- The drawing overlay -----------------------------------------------
  // It sits exactly over the picture. Drawing is a mode you switch on; the
  // shapes belong to a bookmark, and if none is picked the first stroke makes
  // one at the playhead so the tools work on a video you just opened.
  let overlay = null, octx = null, drawing = null, sizeWatch = null;

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
      v.addEventListener('seeked', renderOverlay);
      v.addEventListener('timeupdate', onRangeTick);
      // The element resizes with the size picker, the accordion and fullscreen;
      // without this the overlay stays where the picture used to be.
      if (window.ResizeObserver) {
        if (sizeWatch) sizeWatch.disconnect();
        sizeWatch = new ResizeObserver(() => sizeOverlay());
        sizeWatch.observe(v);
      }
    }
    sizeOverlay();
  }

  // The picture is letterboxed inside the element, and the element is centred
  // inside the wrapper, so the overlay is pinned with both offsets rather than
  // to the top-left of the box around it.
  function videoBox() {
    if (!v) return null;
    const r = v.getBoundingClientRect();
    const wr = wrap.getBoundingClientRect();
    const vw = v.videoWidth || 16, vh = v.videoHeight || 9;
    const scale = Math.min(r.width / vw, r.height / vh) || 0;
    const w = vw * scale, h = vh * scale;
    return { left: (r.left - wr.left) + (r.width - w) / 2, top: (r.top - wr.top) + (r.height - h) / 2, w, h };
  }
  function sizeOverlay() {
    if (!overlay || !v) return;
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
      hint.textContent = !hasLocalVideo() ? T('video.drawNeedLocal')
        : !drawMode ? T('video.drawOff')
          : bm ? T('video.drawOn') + ' ' + fmtRange(bm) + ' ' + (bm.tag || '')
            : T('video.drawNew');
    }
    if (!overlay || !octx) return;
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, overlay.width, overlay.height);
    if (bm) drawShapes(octx, overlay.width, overlay.height, bm);
    if (drawing) drawShapes(octx, overlay.width, overlay.height, { shapes: [drawing] });
    // Armed is what makes the canvas accept a pointer at all, so it follows the
    // mode and not whether a bookmark happens to be selected.
    overlay.classList.toggle('armed', drawMode && hasLocalVideo());
  }
  const drawTarget = () => (selectedBm && bookmarks.indexOf(selectedBm) >= 0) ? selectedBm : null;

  function setDrawMode(on) {
    drawMode = !!on && hasLocalVideo();
    const btn = mount.querySelector('#drawMode');
    if (btn) {
      btn.classList.toggle('primary', drawMode);
      btn.disabled = !hasLocalVideo();
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
    const t = hasLocalVideo() ? (v.currentTime || 0) : 0;
    bm = { t, t2: Math.min(t + clipLenSec, (v && v.duration) || t + clipLenSec), tag: T('video.tagDefault'), comment: '', shapes: [] };
    bookmarks.push(bm);
    bookmarks.sort((a, b) => a.t - b.t);
    selectedBm = bm;
    await saveBookmarks();
    renderBm();
    return bm;
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
    if (!hasLocalVideo()) { UI.toast(T('video.drawNeedLocal'), 'error'); return; }
    e.preventDefault();
    // Pausing first: a shape drawn over a moving picture never lands where the
    // coach meant it to.
    if (v && !v.paused) v.pause();
    if (dTool === 'text') { askDrawText(pt(e)); return; }
    try { overlay.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
    drawing = { k: dTool, c: dColor, p: [pt(e), pt(e)] };
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
    if (!drawing) return;
    e.preventDefault();
    if (drawing.k === 'free') drawing.p.push(pt(e));
    else drawing.p[1] = pt(e);
    renderOverlay();
  }
  async function onDrawUp() {
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
    renderOverlay();
  }

  function bindDrawBar() {
    const bar = mount.querySelector('#drawBar');
    const sync = () => {
      bar.querySelectorAll('[data-dtool]').forEach(b => b.classList.toggle('primary', b.dataset.dtool === dTool));
      bar.querySelectorAll('[data-dcolor]').forEach(b => b.classList.toggle('on', b.dataset.dcolor === dColor));
    };
    // Picking a tool is also how most people expect to start drawing.
    bar.querySelectorAll('[data-dtool]').forEach(b => b.onclick = () => { dTool = b.dataset.dtool; sync(); setDrawMode(true); });
    bar.querySelectorAll('[data-dcolor]').forEach(b => b.onclick = () => { dColor = b.dataset.dcolor; sync(); });
    mount.querySelector('#drawMode').onclick = () => setDrawMode(!drawMode);
    mount.querySelector('#drawUndo').onclick = async () => {
      const bm = drawTarget();
      if (!bm || !(bm.shapes || []).length) return;
      bm.shapes.pop();
      await saveBookmarks(); renderOverlay(); renderBm();
    };
    mount.querySelector('#drawClear').onclick = () => {
      const bm = drawTarget();
      if (!bm || !(bm.shapes || []).length) return;
      UI.confirm(T('video.drawClearAsk'), async () => {
        bm.shapes = [];
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

  // Create a bookmark over a passage of play. Auto-saved immediately on confirm.
  // Both timestamps are editable so streams (whose time we cannot read from the
  // cross-origin iframe) can be tagged too.
  function createBookmark(seed) {
    const now = hasLocalVideo() ? (v.currentTime || 0) : 0;
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
  async function exportClipSequences(ext, only) {
    if (!v || !v.src || !v.duration || isNaN(v.duration)) { UI.toast(T('video.needLocal'), 'error'); return; }
    if (!window.MediaRecorder || !(v.captureStream || v.mozCaptureStream)) { UI.toast(T('video.needLocal'), 'error'); return; }
    // A range left armed by Play would pause the recorder mid-clip.
    playUntil = null;
    const list = (only && bookmarks.indexOf(only) >= 0) ? [only] : bookmarks;
    if (!list.length) { UI.toast(T('video.noBm'), 'error'); return; }
    const formats = pickFormats().filter(f => f.ext === ext);
    if (!formats.length) { UI.toast(T('video.noMp4'), 'error'); return; }
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
      if (!hasLocalVideo()) { UI.toast(T('video.needLocal'), 'error'); return; }
      const bm = bookmarks[+b.dataset.go];
      selectedBm = bm;
      playUntil = null;
      v.currentTime = bmStart(bm);
      v.pause();
      renderBm();
      renderOverlay();
    });
    l.querySelectorAll('[data-play]').forEach(b => b.onclick = () => {
      if (!hasLocalVideo()) { UI.toast(T('video.needLocal'), 'error'); return; }
      const bm = bookmarks[+b.dataset.play];
      selectedBm = bm;
      const from = bmStart(bm), to = bmEnd(bm);
      // Armed only once the seek has landed: a timeupdate from the old position
      // would otherwise stop the clip before it started.
      playUntil = null;
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
    if (sizeWatch) { sizeWatch.disconnect(); sizeWatch = null; }
  };
};

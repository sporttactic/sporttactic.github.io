/* Video Analysis view */
window.Views = window.Views || {};
Views.video = function (mount) {
  // Bookmarks are auto-saved to IndexedDB (store 'videos', id 'bookmarks').
  let bookmarks = [];
  const BM_ID = 'bookmarks';
  let clipLenSec = 6; // WebM sequence length around each bookmark

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

  mount.innerHTML = `
    <div class="page-head"><div><h1>${T('video.title')}</h1><p>${T('video.subtitle')}</p></div>
      <label class="btn primary" style="cursor:pointer">${T('video.import')}<input id="vfile" type="file" accept="video/*" hidden></label>
    </div>
    <div class="card" style="margin-bottom:16px">
      <h3>${T('video.stream')}</h3>
      <p style="color:var(--muted);font-size:13px;margin-bottom:8px">${T('video.streamHint')}</p>
      <div class="row" style="flex:0">
        <input id="streamUrl" type="url" placeholder="https://youtube.com/watch?v=… , twitch.tv/… , vimeo.com/…" style="min-width:260px">
        <button class="btn primary" id="loadStream">${T('video.watch')}</button>
      </div>
      <div class="stream-services">
        <span class="tag">YouTube</span><span class="tag">Twitch</span><span class="tag">Vimeo</span>
        <span class="tag">Dailymotion</span><span class="tag">Facebook</span>
      </div>
    </div>
    <div class="card video-panel" id="videoPanel">
      <div class="video-head">
        <h3 style="margin:0">${T('video.title')}</h3>
        <button class="btn sm" id="videoFs" title="${T('video.fullscreen')}">⛶ ${T('video.fullscreen')}</button>
      </div>
      <div id="mediaWrap">
        <video id="player" controls style="width:100%;border-radius:10px;background:#000"></video>
      </div>
      <div class="row" style="margin-top:10px;flex:0" id="localControls">
        <button class="btn sm local-only" data-seek="-5">« 5s</button>
        <button class="btn sm local-only" data-rate="0.5">0.5×</button>
        <button class="btn sm local-only" data-rate="1">1×</button>
        <button class="btn sm local-only" data-rate="2">2×</button>
        <button class="btn sm local-only" data-seek="5">5s »</button>
        <button class="btn sm primary" id="bm">★ ${T('video.bookmark')}</button>
      </div>
      <div class="bm-section">
        <div class="bm-head">
          <h3 style="margin:0">${T('video.bookmarks')}</h3>
          <span class="tool-group">
            <button class="btn sm primary" id="exportWebm">${T('video.exportWebm')}</button>
            <button class="btn sm primary" id="exportMp4">${T('video.exportMp4')}</button>
          </span>
        </div>
        <p class="hint" style="margin:6px 0 4px">${T('video.bmEmpty')}</p>
        <div id="bmList" class="bm-list"></div>
      </div>
    </div>`;

  const wrap = mount.querySelector('#mediaWrap');
  const localControls = mount.querySelector('#localControls');
  let v = mount.querySelector('#player');

  // Seek/speed need a real <video>; bookmarking stays available for streams too.
  function showPlaybackBtns(on) {
    localControls.querySelectorAll('.local-only').forEach(b => { b.style.display = on ? '' : 'none'; });
  }
  function hasLocalVideo() { return !!(v && v.src && v.isConnected); }

  function showLocalVideo() {
    wrap.innerHTML = `<video id="player" controls style="width:100%;border-radius:10px;background:#000"></video>`;
    v = mount.querySelector('#player');
    showPlaybackBtns(true);
    bindLocalControls();
  }
  function showEmbed(src) {
    wrap.innerHTML = `<div class="embed-frame"><iframe src="${UI.esc(src)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen frameborder="0"></iframe></div>`;
    v = null;
    showPlaybackBtns(false);
  }

  mount.querySelector('#loadStream').onclick = () => {
    const src = toEmbed(mount.querySelector('#streamUrl').value);
    if (!src) { UI.toast(T('video.badUrl'), 'error'); return; }
    showEmbed(src);
    UI.toast(T('video.streaming'), 'success');
  };
  mount.querySelector('#streamUrl').addEventListener('keydown', e => { if (e.key === 'Enter') mount.querySelector('#loadStream').click(); });

  mount.querySelector('#vfile').onchange = e => {
    const f = e.target.files[0]; if (f) { showLocalVideo(); v.src = URL.createObjectURL(f); UI.toast(T('video.streaming')); }
  };

  function bindLocalControls() {
    mount.querySelectorAll('[data-seek]').forEach(b => b.onclick = () => { if (v) v.currentTime += +b.dataset.seek; });
    mount.querySelectorAll('[data-rate]').forEach(b => b.onclick = () => { if (v) v.playbackRate = +b.dataset.rate; });
    mount.querySelector('#bm').onclick = createBookmark;
  }

  // "12:34", "1:02:03" or plain seconds -> seconds.
  function parseClock(s) {
    const parts = String(s || '').trim().split(':').map(x => parseFloat(x) || 0);
    if (parts.length >= 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] || 0;
  }

  // Create a bookmark with a tag + comment. Auto-saved immediately on confirm.
  // The timestamp is editable so streams (whose time we cannot read from the
  // cross-origin iframe) can be tagged too.
  function createBookmark() {
    const t = hasLocalVideo() ? (v.currentTime || 0) : 0;
    if (v && !v.paused) v.pause();
    UI.modal({
      title: T('video.addBookmark'),
      body: `
        <label class="field"><span>${T('video.time')}</span><input id="bm_time" value="${UI.fmtClock(Math.floor(t))}" placeholder="mm:ss"></label>
        <label class="field"><span>${T('video.tag')}</span><input id="bm_tag" value="Goal" placeholder="${T('video.tag')}"></label>
        <label class="field"><span>${T('video.comment')}</span><textarea id="bm_comment" rows="3" placeholder="${T('video.commentPh')}"></textarea></label>`,
      footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button><button class="btn primary" data-save>${T('common.save')}</button>`,
      onOpen: (m, close) => {
        const tagEl = m.querySelector('#bm_tag');
        if (tagEl) { tagEl.focus(); tagEl.select(); }
        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-save]').onclick = async () => {
          const at = Math.max(0, parseClock(m.querySelector('#bm_time').value));
          const tag = (m.querySelector('#bm_tag').value || '').trim() || 'Bookmark';
          const comment = (m.querySelector('#bm_comment').value || '').trim();
          bookmarks.push({ t: at, tag, comment });
          bookmarks.sort((a, b) => a.t - b.t);
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
  }
  document.addEventListener('fullscreenchange', onVideoFsChange);
  const vfsBtn = mount.querySelector('#videoFs');
  if (vfsBtn) vfsBtn.onclick = toggleVideoFullscreen;
  bindLocalControls();

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
    cx.fillText(UI.fmtClock(Math.floor(bm.t || 0)) + '   ' + (bm.tag || ''), pad * 2, y0 + pad);
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
        try { cx.drawImage(v, 0, 0, cv.width, cv.height); drawCaption(cx, cv.width, cv.height, bm, v.currentTime - start); } catch (e) {}
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
  async function exportClipSequences(ext) {
    if (!v || !v.src || !v.duration || isNaN(v.duration)) { UI.toast(T('video.needLocal'), 'error'); return; }
    if (!window.MediaRecorder || !(v.captureStream || v.mozCaptureStream)) { UI.toast(T('video.needLocal'), 'error'); return; }
    if (!bookmarks.length) { UI.toast(T('video.noBm'), 'error'); return; }
    const formats = pickFormats().filter(f => f.ext === ext);
    if (!formats.length) { UI.toast(T('video.noMp4'), 'error'); return; }
    UI.toast(T('video.exporting') + ' ' + ext.toUpperCase());
    const wasRate = v.playbackRate, wasMuted = v.muted;
    v.playbackRate = 1; v.muted = true;   // mute so playback is silent and never autoplay-blocked
    let ok = 0;
    for (let i = 0; i < bookmarks.length; i++) {
      const b = bookmarks[i];
      const start = Math.max(0, b.t - clipLenSec / 2);
      const end = Math.min(v.duration, Math.max(b.t + clipLenSec / 2, start + 1));
      try {
        const outs = await recordSegment(start, end, formats, b);
        const safe = String(b.tag).replace(/[^\w\-]+/g, '_').slice(0, 40) || 'clip';
        const base = `clip-${String(i + 1).padStart(2, '0')}-${safe}-${Math.floor(b.t)}s`;
        (outs || []).forEach(o => { download(o.blob, `${base}.${o.ext}`); ok++; });
      } catch (e) { /* skip failed segment */ }
    }
    v.playbackRate = wasRate; v.muted = wasMuted; v.pause();
    UI.toast(ok ? T('video.exported') + ' (' + ok + ' × ' + ext.toUpperCase() + ')' : T('video.needLocal'), ok ? 'success' : 'error');
  }
  mount.querySelector('#exportWebm').onclick = () => exportClipSequences('webm');
  const mp4Btn = mount.querySelector('#exportMp4');
  mp4Btn.onclick = () => exportClipSequences('mp4');
  if (!pickFormats().some(f => f.ext === 'mp4')) { mp4Btn.disabled = true; mp4Btn.title = T('video.noMp4'); }

  async function renderBm() {
    const l = mount.querySelector('#bmList');
    l.innerHTML = bookmarks.length ? bookmarks.map((b, i) =>
      `<div class="bm-item">
        <div class="bm-main">
          <span><span class="tag blue">${UI.fmtClock(Math.floor(b.t))}</span> ${UI.esc(b.tag)}</span>
          <span><button class="btn sm" data-go="${i}">${T('common.go')}</button> <button class="btn sm danger" data-rm="${i}">${T('common.remove')}</button></span>
        </div>
        ${b.comment ? `<p class="bm-comment">${UI.esc(b.comment)}</p>` : ''}
      </div>`).join('') : `<p style="color:var(--muted)">${T('video.noBm')}</p>`;
    l.querySelectorAll('[data-go]').forEach(b => b.onclick = () => {
      if (!hasLocalVideo()) { UI.toast(T('video.needLocal'), 'error'); return; }
      v.currentTime = bookmarks[+b.dataset.go].t; v.play();
    });
    l.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => { bookmarks.splice(+b.dataset.rm, 1); await saveBookmarks(); renderBm(); });
  }
  renderBm();

  return () => { document.removeEventListener('fullscreenchange', onVideoFsChange); };
};

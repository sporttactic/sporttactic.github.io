/* anim.js — standalone viewer for saved tactical-board animations.
   The tactical board keeps its renderer inside its own closure, so this module
   carries a compact copy that can replay a saved `tactics` record (kind:'system')
   from any view — the Training Planner uses it to show the animations attached
   to a session. */
window.ANIM = (function () {
  const PROP_COLOR = {
    cone: '#ff7a1e', disc: '#ffd400', pole: '#e11d48', hurdle: '#34c759', ladder: 'rgba(255,255,255,.9)',
    ring: '#0a84ff', minigoal: 'rgba(255,255,255,.95)', dummy: '#94a3b8', medicineball: '#7a2b1e', target: '#e11d48'
  };
  // Same timings as the tactical board, so a clip plays here exactly as it does
  // there — including the coach's own speed choice.
  const FRAME_MS = 1200;   // one pose to the next: tween, then hold
  const TWEEN_MS = 400;
  const FLOW_MS = 90;      // a sampled point of a recorded drag — runs straight into the next
  const SPEEDS = { slow: 0.5, medium: 1, fast: 2 };
  const VIEW_SPEEDS = ['slow', 'medium'];   // fast is a board-only pace
  function savedSpeed() {
    let s = '';
    try { s = localStorage.getItem('tacticsPlayerSpeed') || ''; } catch (e) { }
    return VIEW_SPEEDS.indexOf(s) >= 0 ? s : 'medium';
  }
  function saveSpeed(s) {
    try { localStorage.setItem('tacticsPlayerSpeed', s); } catch (e) { }
  }

  // Every saved animation of one sport, newest board order preserved.
  function systems(sportId) {
    const sid = sportId || (window.App && App.getSport && App.getSport()) || 'handball';
    return Store.all('tactics').filter(t => t.kind === 'system' && (t.sport || 'handball') === sid);
  }
  function byId(id) {
    const r = Store.find('tactics', id);
    return r && r.kind === 'system' && r.frames && r.frames.length ? r : null;
  }
  // A multi-select for the session forms; falls back to a hint when nothing is saved.
  function pickerHtml(id, selected, sportId) {
    const mine = systems(sportId);
    const sel = selected || [];
    if (!mine.length) return `<p class="hint">${T('training.noAnims')}</p>`;
    return `<select id="${id}" multiple size="${Math.min(5, Math.max(3, mine.length))}">` +
      mine.map(s => `<option value="${UI.esc(s.id)}"${sel.indexOf(s.id) >= 0 ? ' selected' : ''}>★ ${UI.esc(s.name)} · ${s.frames.length} ${T('tactics.frameList')}</option>`).join('') +
      `</select>`;
  }
  // One button per attached animation; bind() wires them to the player.
  function chipsHtml(ids) {
    const list = (ids || []).map(byId).filter(Boolean);
    if (!list.length) return `<p class="hint">${T('training.noAnimsPicked')}</p>`;
    return `<div class="anim-chips">` + list.map(s =>
      `<button type="button" class="btn sm" data-anim-show="${UI.esc(s.id)}">▶ ${UI.esc(s.name)}</button>`).join('') + `</div>`;
  }
  function bind(root) {
    if (!root) return;
    root.querySelectorAll('[data-anim-show]').forEach(b => b.onclick = () => open(b.dataset.animShow));
  }

  function renderer(canvas, rec) {
    const ctx = canvas.getContext('2d');
    const sportId = rec.sport || 'handball';
    const halfFn = SPORTS.halfCourt(sportId);
    const half = rec.courtMode === 'half' && SPORTS.isTeam(sportId) && !!halfFn;
    canvas.width = 700;
    canvas.height = half ? 700 : 560;
    const W = () => canvas.width, H = () => canvas.height;
    const textPx = () => Math.max(12, Math.round(W() * 0.026));

    function court() {
      if (half) { halfFn(ctx, W(), H()); return; }
      SPORTS.get(sportId).court(ctx, W(), H());
    }
    function arrowHead(sx, sy, ex, ey, c) {
      const a = Math.atan2(ey - sy, ex - sx);
      ctx.fillStyle = c; ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - 12 * Math.cos(a - 0.4), ey - 12 * Math.sin(a - 0.4));
      ctx.lineTo(ex - 12 * Math.cos(a + 0.4), ey - 12 * Math.sin(a + 0.4));
      ctx.closePath(); ctx.fill();
    }
    function shape(s) {
      ctx.strokeStyle = s.color; ctx.fillStyle = s.color; ctx.lineWidth = 3;
      const sx = s.x1 / 100 * W(), sy = s.y1 / 100 * H();
      const ex = s.x2 / 100 * W(), ey = s.y2 / 100 * H();
      ctx.beginPath();
      if (s.type === 'free') {
        (s.pts || []).forEach((p, i) => { const px = p.x / 100 * W(), py = p.y / 100 * H(); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
        ctx.stroke();
      } else if (s.type === 'line' || s.type === 'arrow' || s.type === 'pass' || s.type === 'run') {
        if (s.type === 'run' || s.type === 'pass') ctx.setLineDash([8, 6]);
        ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke(); ctx.setLineDash([]);
        if (s.type !== 'line') arrowHead(sx, sy, ex, ey, s.color);
      } else if (s.type === 'circle') {
        ctx.arc(sx, sy, Math.hypot(ex - sx, ey - sy), 0, 7); ctx.stroke();
      } else if (s.type === 'rect') {
        ctx.strokeRect(sx, sy, ex - sx, ey - sy);
      } else if (s.type === 'text') {
        const size = textPx();
        ctx.font = '700 ' + size + 'px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = Math.max(2, size / 5); ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineJoin = 'round';
        ctx.strokeText(s.text, sx, sy);
        ctx.fillStyle = s.color; ctx.fillText(s.text, sx, sy);
        ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'miter';
      }
    }
    function facing(rot, x, y, r) {
      const tip = r + 11, bx = x + Math.cos(rot) * r, by = y + Math.sin(rot) * r;
      const tx = x + Math.cos(rot) * tip, ty = y + Math.sin(rot) * tip;
      ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke(); ctx.lineCap = 'butt';
      ctx.fillStyle = 'rgba(255,255,255,.95)';
      ctx.beginPath(); ctx.moveTo(tx, ty);
      ctx.lineTo(tx - 8 * Math.cos(rot - 0.42), ty - 8 * Math.sin(rot - 0.42));
      ctx.lineTo(tx - 8 * Math.cos(rot + 0.42), ty - 8 * Math.sin(rot + 0.42));
      ctx.closePath(); ctx.fill();
    }
    function nameTag(name, x, topY) {
      ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      const w = ctx.measureText(name).width + 8;
      ctx.fillStyle = 'rgba(10,14,20,.72)'; ctx.fillRect(x - w / 2, topY, w, 14);
      ctx.fillStyle = '#fff'; ctx.fillText(name, x, topY + 2);
    }
    function player(o, x, y) {
      const r = o.kind === 'gk' ? 16 : 15;
      if (o.kind === 'gk' && o.active) {
        ctx.beginPath(); ctx.arc(x, y, 20, 0, 7); ctx.strokeStyle = '#34c759'; ctx.lineWidth = 3; ctx.stroke();
      }
      if (typeof o.rot === 'number') facing(o.rot, x, y, r);
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7);
      ctx.fillStyle = o.kind === 'gk' ? '#f59e0b' : (o.team === 'atk' ? '#0a84ff' : '#ff3b30'); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 13px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(o.label, x, y);
      if (o.name) nameTag(o.name, x, y + r + 3);
    }
    function ball(x, y) {
      ctx.beginPath(); ctx.arc(x, y, 9, 0, 7); ctx.fillStyle = '#ffeffb';
      ctx.fill(); ctx.strokeStyle = '#0b1220'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 6, y); ctx.lineTo(x + 6, y); ctx.moveTo(x, y - 6); ctx.lineTo(x, y + 6);
      ctx.strokeStyle = '#0b1220'; ctx.lineWidth = 1; ctx.stroke();
    }
    function prop(o, x, y) {
      ctx.lineJoin = 'round';
      const c = o.color || PROP_COLOR[o.prop] || '#ffd400';
      switch (o.prop) {
        case 'cone':
          ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x, y - 11); ctx.lineTo(x - 8, y + 8); ctx.lineTo(x + 8, y + 8); ctx.closePath(); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(x - 6, y - 1, 12, 3); break;
        case 'disc':
          ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(x, y, 11, 5, 0, 0, 7); ctx.fill(); break;
        case 'pole':
          ctx.strokeStyle = c; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, y + 10); ctx.lineTo(x, y - 12); ctx.stroke(); break;
        case 'hurdle':
          ctx.strokeStyle = c; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.moveTo(x - 10, y + 7); ctx.lineTo(x - 10, y - 6); ctx.lineTo(x + 10, y - 6); ctx.lineTo(x + 10, y + 7); ctx.stroke(); break;
        case 'ladder':
          ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.strokeRect(x - 8, y - 12, 16, 24);
          for (let i = 1; i < 4; i++) { const yy = y - 12 + i * 6; ctx.beginPath(); ctx.moveTo(x - 8, yy); ctx.lineTo(x + 8, yy); ctx.stroke(); }
          break;
        case 'ring':
          ctx.strokeStyle = c; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(x, y, 11, 6, 0, 0, 7); ctx.stroke(); break;
        case 'minigoal':
          ctx.strokeStyle = c; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.moveTo(x - 13, y + 7); ctx.lineTo(x - 13, y - 7); ctx.lineTo(x + 13, y - 7); ctx.lineTo(x + 13, y + 7); ctx.stroke(); break;
        case 'dummy':
          ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y - 7, 4, 0, 7); ctx.fill();
          ctx.beginPath(); ctx.moveTo(x, y - 3); ctx.lineTo(x - 6, y + 11); ctx.lineTo(x + 6, y + 11); ctx.closePath(); ctx.fill(); break;
        case 'medicineball':
          ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, 9, 0, 7); ctx.fill(); break;
        case 'target':
          ctx.strokeStyle = c; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(x, y, 10, 0, 7); ctx.stroke();
          ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.stroke(); break;
        default:
          ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fill();
      }
    }
    function piece(o, x, y) {
      const glyphs = { K: '\u265A', Q: '\u265B', R: '\u265C', B: '\u265D', N: '\u265E', P: '\u265F' };
      const g = glyphs[o.piece] || glyphs.P;
      const white = o.team === 'atk';
      const size = Math.max(22, Math.min(W(), H()) / 8 * 0.72);
      ctx.font = size + 'px "Segoe UI Symbol","Noto Sans Symbols2",serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      ctx.lineWidth = 4; ctx.strokeStyle = white ? '#15223a' : '#f4f4f0';
      ctx.strokeText(g, x, y);
      ctx.fillStyle = white ? '#f7f7f2' : '#151515';
      ctx.fillText(g, x, y);
    }
    function card(o, x, y) {
      const w = 22, h = 30;
      ctx.fillStyle = '#fbfbf6'; ctx.fillRect(x - w / 2, y - h / 2, w, h);
      ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 1; ctx.strokeRect(x - w / 2, y - h / 2, w, h);
      ctx.fillStyle = (o.suit === '\u2665' || o.suit === '\u2666') ? '#c81026' : '#141414';
      ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText((o.label || '') + (o.suit || ''), x, y);
    }
    function checker(o, x, y) {
      const r = 13;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7);
      ctx.fillStyle = o.team === 'atk' ? '#f4f1e8' : '#222';
      ctx.fill(); ctx.strokeStyle = o.team === 'atk' ? '#b9b09a' : '#000'; ctx.lineWidth = 2; ctx.stroke();
    }
    function cue(o, x, y) {
      const r = 12;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7);
      ctx.fillStyle = o.color || '#f4f4ef'; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1; ctx.stroke();
      if (o.label) {
        ctx.beginPath(); ctx.arc(x, y, r * 0.58, 0, 7); ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.fill();
        ctx.fillStyle = '#111'; ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(o.label, x, y);
      }
    }
    function dart(o, x, y) {
      ctx.strokeStyle = 'rgba(230,230,235,.9)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 15, y - 15); ctx.stroke();
      ctx.fillStyle = o.color || '#c81026';
      ctx.beginPath(); ctx.moveTo(x + 15, y - 15); ctx.lineTo(x + 24, y - 13); ctx.lineTo(x + 13, y - 24); ctx.closePath(); ctx.fill();
    }
    function object(o, x, y) {
      if (o.kind === 'ball') ball(x, y);
      else if (o.kind === 'cue') cue(o, x, y);
      else if (o.kind === 'dart') dart(o, x, y);
      else if (o.kind === 'prop') prop(o, x, y);
      else if (o.kind === 'piece') piece(o, x, y);
      else if (o.kind === 'card') card(o, x, y);
      else if (o.kind === 'checker') checker(o, x, y);
      else player(o, x, y);
    }
    // Interpolate between two angles along the shortest arc.
    function lerpAngle(a, b, t) {
      let d = (b - a) % (Math.PI * 2);
      if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
      return a + d * t;
    }
    // t === 0 draws frame `a` as-is; anything higher tweens towards `b`.
    return function paint(a, b, t) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W(), H());
      court();
      (a.shapes || []).forEach(shape);
      (a.objects || []).forEach(o => {
        const bo = (b && (b.objects || []).find(x => x.id === o.id)) || o;
        const ix = o.x + (bo.x - o.x) * t, iy = o.y + (bo.y - o.y) * t;
        let oo = o;
        if (typeof o.rot === 'number' && typeof bo.rot === 'number') oo = Object.assign({}, o, { rot: lerpAngle(o.rot, bo.rot, t) });
        object(oo, ix / 100 * W(), iy / 100 * H());
      });
    };
  }

  // Replay one saved animation in a locked dialog: play/stop plus frame stepping.
  function open(id) {
    const rec = byId(id);
    if (!rec) return UI.toast(T('tactics.noSavedAnims'), 'error');
    const frames = rec.frames;
    UI.modal({
      title: UI.esc(rec.name),
      width: 780,
      body: `<div class="anim-view">
          <canvas class="anim-canvas"></canvas>
          <div class="anim-bar">
            <button type="button" class="btn sm" data-prev>◀</button>
            <button type="button" class="btn sm primary" data-play>▶ ${T('tactics.play')}</button>
            <button type="button" class="btn sm" data-next>▶</button>
            <span class="hint" data-lbl></span>
            <div class="tool-group" title="${UI.esc(T('tactics.pspeedHint'))}">
              <button type="button" class="btn sm" data-spd="slow">${T('tactics.speedSlow')}</button>
              <button type="button" class="btn sm" data-spd="medium">${T('tactics.speedMedium')}</button>
            </div>
          </div>
        </div>`,
      footer: `<button class="btn ghost" data-close2>${T('common.close')}</button>`,
      onOpen: (m, close) => {
        const canvas = m.querySelector('.anim-canvas');
        const paint = renderer(canvas, rec);
        const playBtn = m.querySelector('[data-play]');
        const lbl = m.querySelector('[data-lbl]');
        let idx = 0, raf = null, hold = null, playing = false, speed = savedSpeed();

        const label = () => { lbl.textContent = T('tactics.frame') + ' ' + (idx + 1) + ' / ' + frames.length; };
        const still = () => { paint(frames[idx], null, 0); label(); };
        function stop() {
          playing = false;
          if (raf) { cancelAnimationFrame(raf); raf = null; }
          if (hold) { clearTimeout(hold); hold = null; }
          playBtn.textContent = '▶ ' + T('tactics.play');
        }
        // Each pair of frames carries its own timing: a pose is held so the coach
        // can talk over it, while a point sampled from a recorded drag runs
        // straight into the next one — that is what makes a curve stay a curve
        // instead of crawling through hundreds of held poses.
        function runPair() {
          const a = frames[idx], b = frames[idx + 1];
          const mult = SPEEDS[speed] || 1;
          const flow = !!b.flow;
          const tw = Math.max(40, (flow ? FLOW_MS : TWEEN_MS) / mult);
          const wait = flow ? 0 : (FRAME_MS - TWEEN_MS) / mult;
          const t0 = performance.now();
          const step = now => {
            raf = null;
            if (!playing) return;
            if (!canvas.isConnected) { stop(); return; }   // dialog replaced or torn down
            const t = Math.min(1, Math.max(0, (now - t0) / tw));
            paint(a, b, t);
            if (t < 1) { raf = requestAnimationFrame(step); return; }
            idx++;
            label();
            // One pass, ending on the last pose: no run back to the opening
            // frame and no second lap.
            if (idx >= frames.length - 1) { stop(); still(); return; }
            hold = setTimeout(runPair, wait);
          };
          raf = requestAnimationFrame(step);
        }
        function play() {
          if (playing) { stop(); idx = 0; still(); return; }
          if (frames.length < 2) return;
          playBtn.textContent = '■ ' + T('tactics.stop');
          playing = true;
          idx = 0;
          label();
          runPair();
        }
        playBtn.onclick = play;
        const spdBtns = m.querySelectorAll('[data-spd]');
        const markSpeed = () => spdBtns.forEach(b => b.classList.toggle('primary', b.dataset.spd === speed));
        // A new speed takes hold from the next pair of frames, so the step on
        // screen plays out instead of jumping.
        spdBtns.forEach(b => b.onclick = () => { speed = b.dataset.spd; saveSpeed(speed); markSpeed(); });
        markSpeed();
        m.querySelector('[data-prev]').onclick = () => { stop(); idx = (idx - 1 + frames.length) % frames.length; still(); };
        m.querySelector('[data-next]').onclick = () => { stop(); idx = (idx + 1) % frames.length; still(); };
        m.querySelector('[data-close2]').onclick = () => { stop(); close(); };
        still();
        if (frames.length > 1) play();
      }
    });
  }

  return { systems, byId, pickerHtml, chipsHtml, bind, open };
})();

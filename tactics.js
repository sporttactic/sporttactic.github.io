/* Tactical Board view — interactive canvas with objects, drawing, frames,
   animation, ball shooting + magnet, whistle sound, and video recording. */
window.Views = window.Views || {};
Views.tactics = function (mount) {
  document.body.classList.remove('board-fs');   // clear a stale CSS-fullscreen lock
  const BOARD_COLORS = ['#ffd400', '#ff3b30', '#34c759', '#0a84ff', '#ffffff', '#0b1220'];
  let tool = 'select';
  let color = '#ffd400';
  let current;
  let frameIdx = 0;
  let drag = null;      // dragging object
  let dragShape = null; // dragging a finished drawing/text
  let drawing = null;   // freehand/shape in progress
  let animTimer = null;
  let animStep = null;
  let animEnd = null;
  let selectedId = null;   // currently selected player (for shooting/magnet)
  let aim = null;          // {x,y,mode} live aiming marker while using shoot tool
  let ballFx = null;       // active ball flight position
  let history = [];        // undo stack (JSON snapshots of current)
  let future = [];         // redo stack
  let autoRec = null;      // auto-frame recording state
  let recTimer = null;
  let physTimer = null;    // cue-sports physics loop
  let dartTurn = 0;        // round-robin dart index
  let cueCharge = null;    // cue press-and-hold state {x,y,t}
  let chargeTimer = null;  // redraw loop while charging the cue
  let press = null;        // select-mode press candidate (tap vs hold vs drag)
  let holdTimer = null;    // long-press timer (auto-select)
  let saveTimer = null;    // debounced autosave timer
  let courtMode = 'full';  // 'full' | 'half' court view (team sports)
  let pendingProp = null;  // training prop type queued for placement (tool='prop')
  let propPaint = null;    // colour for training props, independent of the drawing colour
  let showFacing = true;   // draw the player orientation arrows (sidebar toggle)
  const HOLD_MS = 380;     // press duration counted as a long-press (auto-select)
  // A fingertip is far less precise than a mouse, so touch devices get a wider
  // slop before a press counts as a drag and bigger pick radii.
  const COARSE = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  const MOVE_TOL = COARSE ? 3.4 : 2.2;   // percent movement that turns a press into a drag
  const PICK_R = COARSE ? 6.5 : 4;       // percent radius for hitting an object
  const PICK_SHAPE_R = COARSE ? 5.5 : 3.5; // percent distance for hitting a drawn shape
  const BALL_SPEEDS = { slow: 0.5, medium: 1, fast: 2 };  // ball-flight speed multipliers
  const FACE_RADIUS = 16;  // percent: drag a player this close to an opponent to auto-face them
  let ballSpeed = 'medium';                               // slow | medium | fast
  try { ballSpeed = localStorage.getItem('tacticsBallSpeed') || 'medium'; } catch (e) { }

  // ---------- Sound (single instance: reset & replay, never overlap) ----------
  const Sfx = (() => {
    let actx = null, activeNodes = [];
    function ac() { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); return actx; }
    function stopAll() { activeNodes.forEach(n => { try { n.stop(); } catch (e) {} }); activeNodes = []; }
    function whistle() {
      if (window.SoundOn === false) return;
      const a = ac(); if (a.state === 'suspended') a.resume();
      stopAll();                                   // reset before replay
      const now = a.currentTime;
      const osc = a.createOscillator(), gain = a.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(1800, now);
      osc.frequency.setValueAtTime(2100, now + 0.12);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.25, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
      osc.connect(gain).connect(a.destination);
      osc.start(now); osc.stop(now + 0.36);
      activeNodes = [osc];
    }
    function whoosh() {
      if (window.SoundOn === false) return;
      const a = ac(); if (a.state === 'suspended') a.resume();
      const now = a.currentTime;
      const osc = a.createOscillator(), gain = a.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.exponentialRampToValueAtTime(120, now + 0.25);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
      osc.connect(gain).connect(a.destination);
      osc.start(now); osc.stop(now + 0.3);
    }
    function hit() {
      if (window.SoundOn === false) return;
      const a = ac(); if (a.state === 'suspended') a.resume();
      const now = a.currentTime;
      const osc = a.createOscillator(), gain = a.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.exponentialRampToValueAtTime(60, now + 0.14);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
      osc.connect(gain).connect(a.destination);
      osc.start(now); osc.stop(now + 0.17);
    }
    return { whistle, whoosh, hit, stopAll };
  })();

  let sportId = (window.App && App.getSport && App.getSport()) || 'handball';
  function sport() { return SPORTS.get(sportId); }

  function loadOrNew() {
    // Saved animations live in the same store but must never become the working board.
    const saved = Store.all('tactics').find(t => (t.sport || 'handball') === sportId && t.kind !== 'system');
    if (saved) { return JSON.parse(JSON.stringify(saved)); }
    return { id: null, name: 'New Play', sport: sportId, frames: [defaultFrame()] };
  }
  function defaultFrame() {
    return { objects: sport().formation(), shapes: [] };
  }
  current = loadOrNew();
  courtMode = current.courtMode || 'full';

  // Config for the launchable game bots (shown in the tool panel per sport).
  const BOTS = {
    chess: { sym: '\u265F', name: () => T('chess.playBot'), key: 'chessLevel', open: l => window.ChessBot && ChessBot.open(l) },
    bridge: { sym: '\u2663', name: () => T('bridge.playBot'), key: 'bridgeLevel', open: l => window.BridgeBot && BridgeBot.open(l) },
    poker: { sym: '\u2660', name: () => T('poker.playBot'), key: 'pokerLevel', open: l => window.PokerBot && PokerBot.open(l) },
    backgammon: { sym: '\u26C0', name: () => T('bg.playBot'), key: 'bgLevel', open: l => window.BackgammonBot && BackgammonBot.open(l) }
  };
  // Show + configure the game-bot launcher for chess/bridge/poker/backgammon.
  function setupBotMode() {
    const panel = mount.querySelector('#botTools');
    if (!panel) return;
    const cfg = BOTS[sportId];
    panel.classList.toggle('hidden', !cfg);
    if (!cfg) return;
    const btn = panel.querySelector('#playGameBot');
    const slider = panel.querySelector('#botLevelSlider');
    const lbl = panel.querySelector('#botLevelLbl');
    const saved = Math.max(1, Math.min(100, +(localStorage.getItem(cfg.key) || 20)));
    slider.value = saved; lbl.textContent = saved;
    btn.innerHTML = cfg.sym + ' ' + cfg.name();
    slider.oninput = () => { lbl.textContent = slider.value; try { localStorage.setItem(cfg.key, slider.value); } catch (e) { } };
    btn.onclick = () => { if (!cfg.open(+slider.value)) UI.toast(T('chess.unavailable'), 'error'); };
  }

  mount.innerHTML = `
    <div class="page-head">
      <div><h1>${T('tactics.title')}</h1><p>${T('tactics.subtitle')}</p></div>
      <div class="board-actions">
        <input id="playName" value="${UI.esc(current.name)}">
        <button class="btn sm" id="undoBtn" title="${T('tactics.undo')}">↶ ${T('tactics.undo')}</button>
        <button class="btn sm" id="redoBtn" title="${T('tactics.redo')}">↷ ${T('tactics.redo')}</button>
        <button class="btn sm danger" id="resetBoard" title="${T('tactics.resetHint')}">⟳ ${T('tactics.reset')}</button>
        <button class="btn sm primary" id="savePlay">${T('tactics.save')}</button>
        <button class="btn sm" id="shotBtn" title="${T('tactics.screenshot')}">📷 ${T('tactics.screenshot')}</button>
        <button class="btn sm" id="fullscreenBtn">⛶ ${T('tactics.fullscreen')}</button>
      </div>
    </div>
    <div class="board-wrap" id="boardWrap">
      <div class="tool-panel card">
        <h3>${T('tactics.sport')}</h3>
        <div class="tool-group sport-group" id="sports">
          ${SPORTS.LIST.map(s => `<div class="tool-btn sport-btn ${s.id === sportId ? 'active' : ''}" data-sport="${s.id}" title="${SPORTS.name(s.id, I18N.getLang())}">${s.icon}</div>`).join('')}
        </div>
        <div id="normalTools">
          <h3 style="margin-top:12px">${T('tactics.tools')}</h3>
          <div class="tool-group" id="tools"></div>
          <p class="hint" id="toolHint">${T('tactics.hint')}</p>
          <div id="propsWrap" class="hidden">
            <h3 style="margin-top:12px">${T('tactics.props')}</h3>
            <div class="tool-group" id="props"></div>
            <div class="tool-group prop-colors" id="propColors">
              ${BOARD_COLORS.map(c => `<div class="tool-btn" data-propcolor="${c}" style="background:${c}"></div>`).join('')}
              <button class="btn sm ghost" data-propcolor="" title="${T('tactics.propColorReset')}">↺</button>
            </div>
            <p class="hint">${T('tactics.propHint')}</p>
          </div>
          <h3 style="margin-top:12px">${T('tactics.color')}</h3>
          <div class="tool-group">
            ${BOARD_COLORS.map(c => `<div class="tool-btn" data-color="${c}" style="background:${c};min-width:30px;height:30px"></div>`).join('')}
          </div>
          <div id="speedWrap" style="margin-top:8px">
            <h3 style="margin:0 0 6px">${T('tactics.speed')}</h3>
            <div class="tool-group" id="speedGroup">
              <button class="btn sm" data-speed="slow">${T('tactics.speedSlow')}</button>
              <button class="btn sm" data-speed="medium">${T('tactics.speedMedium')}</button>
              <button class="btn sm" data-speed="fast">${T('tactics.speedFast')}</button>
            </div>
          </div>
          <button class="btn sm danger" id="clearShapes" style="margin-top:8px">${T('tactics.eraseTools')}</button>
          <button class="btn sm hidden" id="keeperToggle" style="margin-top:8px" title="${T('tactics.keeperHint')}"></button>
          <div id="facingWrap" style="margin-top:12px">
            <h3 style="margin:0 0 6px">${T('tactics.facing')}</h3>
            <label class="check-row"><input type="checkbox" id="facingToggle" checked><span>${T('tactics.facingShow')}</span></label>
            <p class="hint">${T('tactics.facingHint')}</p>
          </div>
          <div id="rotWrap" class="hidden" style="margin-top:8px">
            <h3 style="margin:0 0 6px">${T('tactics.rotation')}</h3>
            <div class="tool-group">
              <button class="btn sm" id="rotLeft" title="${T('tactics.rotLeft')}">\u21BA</button>
              <button class="btn sm" id="rotRight" title="${T('tactics.rotRight')}">\u21BB</button>
              <button class="btn sm" id="rotClear" title="${T('tactics.rotClear')}">\u2715</button>
            </div>
          </div>
          <div id="courtModeWrap" class="hidden" style="margin-top:12px">
            <h3 style="margin:0 0 6px">${T('tactics.court')}</h3>
            <select id="courtModeSel">
              <option value="full">${T('tactics.fullCourt')}</option>
              <option value="half">${T('tactics.halfCourt')}</option>
            </select>
          </div>
        </div>
        <div id="botTools" class="chess-panel hidden">
          <h3 style="margin-top:12px">${T('chess.botTitle')}</h3>
          <p class="hint">${T('chess.botHint')}</p>
          <button class="btn primary" id="playGameBot" style="width:100%">♟</button>
          <label class="chess-level-row"><span>${T('chess.level')}</span> <b id="botLevelLbl">20</b></label>
          <input type="range" id="botLevelSlider" min="1" max="100" value="20">
        </div>
        <h3 style="margin-top:12px">${T('play.systems')} <span class="tag" id="playCount">0</span></h3>
        <div class="play-list" id="playList"></div>
      </div>
      <div class="board-stage">
        <div class="stage-row">
          <canvas id="tacticalCanvas" width="700" height="560"></canvas>
          <div class="frames-anim" id="framesAnim">
            <h3>${T('tactics.frames')}</h3>
            <div class="tool-group">
              <button class="btn sm" id="playAnim">▶ ${T('tactics.play')}</button>
              <button class="btn sm primary" id="recFramesBtn">● ${T('tactics.recFrames')}</button>
              <button class="btn sm" id="saveAnim">＋ ${T('tactics.saveAnim')}</button>
            </div>
            <h4 class="anim-head">${T('tactics.savedAnims')} <span class="tag" id="animCount">0</span></h4>
            <select class="anim-select" id="animList" size="6" aria-label="${T('tactics.savedAnims')}"></select>
            <div class="tool-group anim-acts">
              <button class="btn sm" id="animLoad" disabled>↺ ${T('tactics.animLoad')}</button>
              <button class="btn sm" id="animVideo" disabled title="${T('tactics.animPlayVideo')}">▶</button>
              <button class="btn sm danger" id="animDel" disabled title="${T('common.delete')}">✕</button>
            </div>
            <div><span id="recDot" class="rec-dot hidden">REC <span id="recTime">0:00</span> · <span id="frameCount">0</span> ${T('tactics.framesCaptured')}</span></div>
            <div id="recExport" class="rec-export hidden"></div>
          </div>
        </div>
        <div class="name-bar" id="nameTools">
          <button class="btn sm" id="addNameBtn">＋ ${T('tactics.addName')}</button>
          <input id="playerNameInput" class="hidden" type="text" maxlength="24" autocomplete="off" placeholder="${T('tactics.namePlaceholder')}">
          <button class="btn sm ghost hidden" id="cancelNameBtn">✕ ${T('tactics.cancelAddName')}</button>
          <span class="hint" id="nameHint">${T('tactics.selectToName')}</span>
        </div>
        <div class="timeline" id="timeline"></div>
      </div>
    </div>`;

  const canvas = mount.querySelector('#tacticalCanvas');
  const ctx = canvas.getContext('2d');

  function frame() { return current.frames[frameIdx]; }
  function ball() { return frame().objects.find(o => o.kind === 'ball'); }
  function selected() { return frame().objects.find(o => o.id === selectedId && (o.kind === 'player' || o.kind === 'gk')); }
  function goalkeeper() { return frame().objects.find(o => o.kind === 'gk'); }

  // ---- Undo / Redo history ----
  function snapshot() { return JSON.stringify({ frames: current.frames, frameIdx }); }
  function pushHistory() {
    history.push(snapshot());
    if (history.length > 60) history.shift();
    future = [];
    updateUndoButtons();
    scheduleAutosave();
  }
  // Debounced persistence: quietly saves the current play after any edit
  // (moving players, shooting the ball, drawing…) so nothing is ever lost.
  function scheduleAutosave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      saveTimer = null;
      try {
        const nameInput = mount.querySelector('#playName');
        current.name = (nameInput && nameInput.value.trim()) || current.name || 'Untitled Play';
        current.sport = sportId;
        current.courtMode = courtMode;
        const saved = await Store.save('tactics', current);
        if (saved && saved.id) current.id = saved.id;
      } catch (e) { /* ignore autosave failures */ }
    }, 700);
  }
  function restore(json) {
    const s = JSON.parse(json);
    current.frames = s.frames;
    frameIdx = Math.min(s.frameIdx, current.frames.length - 1);
    draw(); renderTimeline(); scheduleAutosave();
  }
  function undo() {
    if (!history.length) return;
    future.push(snapshot());
    restore(history.pop());
    updateUndoButtons();
  }
  function redo() {
    if (!future.length) return;
    history.push(snapshot());
    restore(future.pop());
    updateUndoButtons();
  }
  function updateUndoButtons() {
    const u = mount.querySelector('#undoBtn'), r = mount.querySelector('#redoBtn');
    if (u) u.disabled = !history.length;
    if (r) r.disabled = !future.length;
  }

  function isHalf() { return courtMode === 'half' && !!(window.SPORTS && SPORTS.isTeam && SPORTS.isTeam(sportId)); }
  // A half court is roughly square (goal at the top, halfway line at the bottom),
  // so the drawing buffer swaps shape instead of stretching the full-court one.
  function applyCanvasSize() {
    const h = isHalf() ? 700 : 560;
    if (canvas.height !== h) canvas.height = h;      // resets ctx state; draw() re-applies it
  }
  function toPct(e) {
    const r = canvas.getBoundingClientRect();
    let px = ((e.touches ? e.touches[0].clientX : e.clientX) - r.left) / r.width * 100;
    let py = ((e.touches ? e.touches[0].clientY : e.clientY) - r.top) / r.height * 100;
    px = Math.max(0, Math.min(100, px)); py = Math.max(0, Math.min(100, py));
    return { x: px, y: py };
  }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  function drawCourt() {
    if (isHalf() && SPORTS.halfCourt) {
      const hc = SPORTS.halfCourt(sportId);
      if (hc) { hc(ctx, canvas.width, canvas.height); return; }
    }
    sport().court(ctx, canvas.width, canvas.height);
  }

  function drawPlayer(o, x, y) {
    const r = o.kind === 'gk' ? 16 : 15;
    if (o.id === selectedId) {
      ctx.beginPath(); ctx.arc(x, y, 22, 0, 7);
      ctx.fillStyle = 'rgba(255,212,0,.25)'; ctx.fill();
      ctx.strokeStyle = '#ffd400'; ctx.lineWidth = 2.5; ctx.stroke();
    }
    // Active goalkeeper: green ring signals that shots aimed here are saved.
    if (o.kind === 'gk' && o.active) {
      ctx.beginPath(); ctx.arc(x, y, 20, 0, 7);
      ctx.strokeStyle = '#34c759'; ctx.lineWidth = 3; ctx.stroke();
    }
    // Facing / rotation pointer (drawn first so the disc caps its base).
    if (showFacing && typeof o.rot === 'number') drawFacing(o.rot, x, y, r);
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7);
    ctx.fillStyle = o.kind === 'gk' ? '#f59e0b' : (o.team === 'atk' ? '#0a84ff' : '#ff3b30'); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 13px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(o.label, x, y);
    if (o.name) drawNameTag(o.name, x, y + r + 3);
  }
  // A centred name plate under the disc — identical for both teams so the name
  // stays legible on any court colour.
  function drawNameTag(name, x, topY) {
    ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const w = ctx.measureText(name).width + 8;
    ctx.fillStyle = 'rgba(10,14,20,.72)'; ctx.fillRect(x - w / 2, topY, w, 14);
    ctx.fillStyle = '#fff'; ctx.fillText(name, x, topY + 2);
    return topY + 16;
  }
  // Interpolate between two angles along the shortest arc (for smooth turning).
  function lerpAngle(a, b, t) {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }
  // A white pointer showing which way a player faces (rot in canvas radians).
  function drawFacing(rot, x, y, r) {
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
  // Training prop / equipment glyphs (sport-category based, drawn on the board).
  // Each prop keeps the colour that was picked when it was dropped, so the
  // palette recolours props independently of the drawing shapes.
  const PROP_COLOR = {
    cone: '#ff7a1e', disc: '#ffd400', pole: '#e11d48', hurdle: '#34c759', ladder: 'rgba(255,255,255,.9)',
    ring: '#0a84ff', minigoal: 'rgba(255,255,255,.95)', dummy: '#94a3b8', medicineball: '#7a2b1e', target: '#e11d48'
  };
  const propColor = o => (o && o.color) || PROP_COLOR[o && o.prop] || '#ffd400';
  function drawProp(o, x, y) {
    if (o.id === selectedId) { ctx.beginPath(); ctx.arc(x, y, 16, 0, 7); ctx.strokeStyle = '#ffd400'; ctx.lineWidth = 2.5; ctx.stroke(); }
    ctx.lineJoin = 'round';
    const c = propColor(o);
    switch (o.prop) {
      case 'cone':
        ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x, y - 11); ctx.lineTo(x - 8, y + 8); ctx.lineTo(x + 8, y + 8); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(x - 6, y - 1, 12, 3);
        ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1; ctx.stroke(); break;
      case 'disc':
        ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(x, y, 11, 5, 0, 0, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 1; ctx.stroke(); break;
      case 'pole':
        ctx.strokeStyle = c; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, y + 10); ctx.lineTo(x, y - 12); ctx.stroke();
        ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(x, y + 10, 6, 2.5, 0, 0, 7); ctx.fill(); break;
      case 'hurdle':
        ctx.strokeStyle = c; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(x - 10, y + 7); ctx.lineTo(x - 10, y - 6); ctx.lineTo(x + 10, y - 6); ctx.lineTo(x + 10, y + 7); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x - 10, y - 6); ctx.lineTo(x + 10, y - 6); ctx.stroke(); break;
      case 'ladder':
        ctx.strokeStyle = c; ctx.lineWidth = 2;
        ctx.strokeRect(x - 8, y - 12, 16, 24);
        for (let i = 1; i < 4; i++) { const yy = y - 12 + i * 6; ctx.beginPath(); ctx.moveTo(x - 8, yy); ctx.lineTo(x + 8, yy); ctx.stroke(); }
        break;
      case 'ring':
        ctx.strokeStyle = c; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(x, y, 11, 6, 0, 0, 7); ctx.stroke(); break;
      case 'minigoal':
        ctx.strokeStyle = c; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(x - 13, y + 7); ctx.lineTo(x - 13, y - 7); ctx.lineTo(x + 13, y - 7); ctx.lineTo(x + 13, y + 7); ctx.stroke();
        ctx.save(); ctx.globalAlpha = 0.42; ctx.lineWidth = 1;
        for (let i = -13; i <= 13; i += 5) { ctx.beginPath(); ctx.moveTo(x + i, y - 7); ctx.lineTo(x + i, y + 7); ctx.stroke(); }
        ctx.restore();
        break;
      case 'dummy':
        ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y - 7, 4, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x, y - 3); ctx.lineTo(x - 6, y + 11); ctx.lineTo(x + 6, y + 11); ctx.closePath(); ctx.fill(); break;
      case 'medicineball':
        ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, 9, 0, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(x, y, 9, 0, 7); ctx.moveTo(x - 9, y); ctx.lineTo(x + 9, y); ctx.stroke(); break;
      case 'target':
        ctx.strokeStyle = c; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, 10, 0, 7); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.stroke();
        ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, 1.6, 0, 7); ctx.fill(); break;
      default:
        ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fill();
    }
  }
  function drawBall(x, y) {
    ctx.beginPath(); ctx.arc(x, y, 9, 0, 7); ctx.fillStyle = '#ffeffb';
    ctx.fill(); ctx.strokeStyle = '#0b1220'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 6, y); ctx.lineTo(x + 6, y); ctx.moveTo(x, y - 6); ctx.lineTo(x, y + 6);
    ctx.strokeStyle = '#0b1220'; ctx.lineWidth = 1; ctx.stroke();
  }
  // Glossy coloured ball for snooker / pool (numbered for pool).
  function drawCue(o, x, y) {
    const r = 12;
    if (o.id === selectedId) { ctx.beginPath(); ctx.arc(x, y, r + 5, 0, 7); ctx.strokeStyle = '#ffd400'; ctx.lineWidth = 2.5; ctx.stroke(); }
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7);
    ctx.fillStyle = o.color || '#f4f4ef'; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.arc(x - r * 0.32, y - r * 0.32, r * 0.34, 0, 7);
    ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.fill();
    if (o.label) {
      ctx.beginPath(); ctx.arc(x, y, r * 0.58, 0, 7); ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.fill();
      ctx.fillStyle = '#111'; ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(o.label, x, y);
    }
  }
  // A thrown dart resting in the board.
  function drawDart(o, x, y) {
    if (o.id === selectedId) { ctx.beginPath(); ctx.arc(x, y, 10, 0, 7); ctx.strokeStyle = '#ffd400'; ctx.lineWidth = 2.5; ctx.stroke(); }
    ctx.strokeStyle = 'rgba(230,230,235,.9)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 15, y - 15); ctx.stroke();
    ctx.fillStyle = o.color || '#c81026';
    ctx.beginPath(); ctx.moveTo(x + 15, y - 15); ctx.lineTo(x + 24, y - 13); ctx.lineTo(x + 13, y - 24); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fillStyle = '#e5e7eb'; ctx.fill();
    ctx.strokeStyle = '#111'; ctx.lineWidth = 1; ctx.stroke();
  }

  // Chess piece: silhouette glyph coloured by side with a contrasting outline.
  function drawPiece(o, x, y) {
    const glyphs = { K: '\u265A', Q: '\u265B', R: '\u265C', B: '\u265D', N: '\u265E', P: '\u265F' };
    const g = glyphs[o.piece] || glyphs.P;
    const white = o.team === 'atk';
    if (o.id === selectedId) {
      ctx.beginPath(); ctx.arc(x, y, 20, 0, 7);
      ctx.fillStyle = 'rgba(255,212,0,.28)'; ctx.fill();
      ctx.strokeStyle = '#ffd400'; ctx.lineWidth = 2.5; ctx.stroke();
    }
    const size = Math.max(22, Math.min(canvas.width, canvas.height) / 8 * 0.72);
    ctx.font = size + 'px "Segoe UI Symbol","Noto Sans Symbols2",serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    ctx.lineWidth = 4; ctx.strokeStyle = white ? '#15223a' : '#f4f4f0';
    ctx.strokeText(g, x, y);
    ctx.fillStyle = white ? '#f7f7f2' : '#151515';
    ctx.fillText(g, x, y);
  }
  // Bridge playing card: white rounded rectangle with rank + suit.
  function drawCard(o, x, y) {
    const w = 22, h = 30;
    if (o.id === selectedId) {
      ctx.strokeStyle = '#ffd400'; ctx.lineWidth = 2.5;
      ctx.strokeRect(x - w / 2 - 4, y - h / 2 - 4, w + 8, h + 8);
    }
    ctx.fillStyle = '#fbfbf6'; ctx.fillRect(x - w / 2, y - h / 2, w, h);
    ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 1; ctx.strokeRect(x - w / 2, y - h / 2, w, h);
    const red = o.suit === '\u2665' || o.suit === '\u2666';
    ctx.fillStyle = red ? '#c81026' : '#141414';
    ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText((o.label || '') + (o.suit || ''), x, y);
  }
  // Backgammon checker: a glossy disc coloured by side.
  function drawChecker(o, x, y) {
    const r = 13;
    if (o.id === selectedId) { ctx.beginPath(); ctx.arc(x, y, r + 4, 0, 7); ctx.strokeStyle = '#ffd400'; ctx.lineWidth = 2.5; ctx.stroke(); }
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7);
    ctx.fillStyle = o.team === 'atk' ? '#f4f1e8' : '#222';
    ctx.fill(); ctx.strokeStyle = o.team === 'atk' ? '#b9b09a' : '#000'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, r * 0.6, 0, 7); ctx.strokeStyle = o.team === 'atk' ? '#d8d2c2' : '#3a3a3a'; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.28, 0, 7); ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fill();
  }
  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawCourt();
    const f = frame();
    f.shapes.forEach(drawShape);
    if (drawing) drawShape(drawing);

    if (aim && (aim.from || selected())) {
      const s = aim.from || selected();
      ctx.setLineDash([6, 6]); ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.x / 100 * canvas.width, s.y / 100 * canvas.height);
      ctx.lineTo(aim.x / 100 * canvas.width, aim.y / 100 * canvas.height);
      ctx.stroke(); ctx.setLineDash([]);
      const tx = aim.x / 100 * canvas.width, ty = aim.y / 100 * canvas.height;
      ctx.strokeStyle = aim.mode === 'save' ? '#ff3b30' : aim.mode === 'pass' ? '#34c759' : '#ffd400';
      ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(tx, ty, 12, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(tx - 16, ty); ctx.lineTo(tx + 16, ty); ctx.moveTo(tx, ty - 16); ctx.lineTo(tx, ty + 16); ctx.stroke();
    }

    f.objects.forEach(o => {
      const x = o.x / 100 * canvas.width, y = o.y / 100 * canvas.height;
      if (o.kind === 'ball') { if (!ballFx) drawBall(x, y); }
      else if (o.kind === 'cue') drawCue(o, x, y);
      else if (o.kind === 'dart') drawDart(o, x, y);
      else if (o.kind === 'prop') drawProp(o, x, y);
      else if (o.kind === 'piece') drawPiece(o, x, y);
      else if (o.kind === 'card') drawCard(o, x, y);
      else if (o.kind === 'checker') drawChecker(o, x, y);
      else drawPlayer(o, x, y);
    });
    if (ballFx) drawBall(ballFx.x / 100 * canvas.width, ballFx.y / 100 * canvas.height);
    // Cue power ring while charging a shot (green → yellow → red as it fills).
    if (cueCharge) {
      const cue = cueBall();
      if (cue) {
        const charge = Math.min((Date.now() - cueCharge.t) / 1000, 1);
        const cx = cue.x / 100 * canvas.width, cy = cue.y / 100 * canvas.height;
        ctx.beginPath();
        ctx.arc(cx, cy, 17, -Math.PI / 2, -Math.PI / 2 + charge * Math.PI * 2);
        ctx.strokeStyle = charge > 0.8 ? '#ff3b30' : charge > 0.45 ? '#ffd400' : '#34c759';
        ctx.lineWidth = 4; ctx.stroke();
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    updateKeeperToggle();
    updateRotControls();
    updateNameTools();
  }

  // Show/refresh the "Keeper active" toggle only when a goalkeeper is on the board.
  function updateKeeperToggle() {
    const btn = mount.querySelector('#keeperToggle');
    if (!btn) return;
    const gk = goalkeeper();
    if (!gk) { btn.classList.add('hidden'); return; }
    btn.classList.remove('hidden');
    const on = !!gk.active;
    btn.classList.toggle('primary', on);
    const label = (on ? '\uD83E\uDDE4 ' : '\u26E8 ') + T('tactics.keeper') + ': ' + (on ? T('common.on') : T('common.off'));
    if (btn.textContent !== label) btn.textContent = label;
  }
  function drawShape(s) {
    ctx.strokeStyle = s.color; ctx.fillStyle = s.color; ctx.lineWidth = 3;
    const sx = s.x1 / 100 * canvas.width, sy = s.y1 / 100 * canvas.height;
    const ex = s.x2 / 100 * canvas.width, ey = s.y2 / 100 * canvas.height;
    ctx.beginPath();
    if (s.type === 'free') {
      s.pts.forEach((p, i) => { const px = p.x / 100 * canvas.width, py = p.y / 100 * canvas.height; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
      ctx.stroke();
    } else if (s.type === 'line' || s.type === 'arrow' || s.type === 'pass' || s.type === 'run') {
      if (s.type === 'run' || s.type === 'pass') ctx.setLineDash([8, 6]);
      ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke(); ctx.setLineDash([]);
      if (s.type !== 'line') arrowHead(sx, sy, ex, ey, s.color);
    } else if (s.type === 'circle') {
      const r = Math.hypot(ex - sx, ey - sy); ctx.arc(sx, sy, r, 0, 7); ctx.stroke();
    } else if (s.type === 'rect') {
      ctx.strokeRect(sx, sy, ex - sx, ey - sy);
    } else if (s.type === 'text') {
      const size = textPx();
      ctx.font = '700 ' + size + 'px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      // Dark halo keeps light labels legible on the pale court markings.
      ctx.lineWidth = Math.max(2, size / 5); ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineJoin = 'round';
      ctx.strokeText(s.text, sx, sy);
      ctx.fillStyle = s.color; ctx.fillText(s.text, sx, sy);
      ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'miter';
    }
  }
  const textPx = () => Math.max(12, Math.round(canvas.width * 0.026));
  function arrowHead(sx, sy, ex, ey, c) {
    const a = Math.atan2(ey - sy, ex - sx);
    ctx.fillStyle = c; ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - 12 * Math.cos(a - 0.4), ey - 12 * Math.sin(a - 0.4));
    ctx.lineTo(ex - 12 * Math.cos(a + 0.4), ey - 12 * Math.sin(a + 0.4));
    ctx.closePath(); ctx.fill();
  }

  function hitObject(p, kinds) {
    return frame().objects.slice().reverse().find(o =>
      (!kinds || kinds.includes(o.kind)) && dist(o, p) < PICK_R);
  }

  // Distance from point p to the segment a→b (all in percent space).
  function distToSeg(p, a, b) {
    const vx = b.x - a.x, vy = b.y - a.y;
    const len2 = vx * vx + vy * vy;
    let t = len2 ? ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
  }
  // Topmost drawing (line/arrow/pass/run/free/circle/rect) near point p.
  function hitShape(p) {
    const tol = PICK_SHAPE_R, shapes = frame().shapes;
    for (let i = shapes.length - 1; i >= 0; i--) {
      const s = shapes[i];
      if (s.type === 'free') {
        if (s.pts.length === 1 && dist(p, s.pts[0]) < tol) return s;
        for (let k = 1; k < s.pts.length; k++) if (distToSeg(p, s.pts[k - 1], s.pts[k]) < tol) return s;
      } else if (s.type === 'line' || s.type === 'arrow' || s.type === 'pass' || s.type === 'run') {
        if (distToSeg(p, { x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }) < tol) return s;
      } else if (s.type === 'circle') {
        const r = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
        const dc = Math.hypot(p.x - s.x1, p.y - s.y1);
        if (Math.abs(dc - r) < tol || dc < tol) return s;
      } else if (s.type === 'rect') {
        const x1 = Math.min(s.x1, s.x2), x2 = Math.max(s.x1, s.x2), y1 = Math.min(s.y1, s.y2), y2 = Math.max(s.y1, s.y2);
        const inX = p.x > x1 - tol && p.x < x2 + tol, inY = p.y > y1 - tol && p.y < y2 + tol;
        if ((Math.abs(p.x - x1) < tol || Math.abs(p.x - x2) < tol) && inY) return s;
        if ((Math.abs(p.y - y1) < tol || Math.abs(p.y - y2) < tol) && inX) return s;
      } else if (s.type === 'text') {
        const halfW = String(s.text || '').length * 0.75 + tol;
        if (Math.abs(p.x - s.x1) < halfW && Math.abs(p.y - s.y1) < 2.5 + tol) return s;
      }
    }
    return null;
  }
  // Shift a finished drawing by a percent-space delta, clamped so the grab
  // anchor (whole path, or the centre of a circle) stays on the court.
  function moveShape(s, dx, dy) {
    if (!s || (!dx && !dy)) return;
    const anchors = s.type === 'free' ? s.pts
      : s.type === 'text' || s.type === 'circle' ? [{ x: s.x1, y: s.y1 }]
        : [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }];
    const xs = anchors.map(a => a.x), ys = anchors.map(a => a.y);
    dx = Math.max(-Math.min(...xs), Math.min(dx, 100 - Math.max(...xs)));
    dy = Math.max(-Math.min(...ys), Math.min(dy, 100 - Math.max(...ys)));
    if (!dx && !dy) return;
    if (s.type === 'free') { s.pts.forEach(p => { p.x += dx; p.y += dy; }); return; }
    s.x1 += dx; s.y1 += dy;
    if (s.x2 != null) { s.x2 += dx; s.y2 += dy; }
  }

  // Ball magnet: snap ball to selected player when close
  function applyMagnet() {
    const s = selected(), b = ball();
    if (s && b && dist(s, b) < 8) { b.x = s.x; b.y = s.y - 3; }
  }

  // Point object `o` at target `t` in pixel-space so the facing arrow is accurate
  // on the non-square (700×560) canvas.
  function faceToward(o, t) {
    o.rot = Math.atan2((t.y - o.y) * canvas.height, (t.x - o.x) * canvas.width);
  }
  // The goal the blue (attacking) team shoots at: the mouth nearest the keeper,
  // falling back to the first (top) goal when there is no keeper.
  function attackGoal() {
    const gs = goals(); if (!gs.length) return null;
    const gk = goalkeeper();
    if (!gk) return gs[0];
    let g = gs[0], best = Infinity;
    gs.forEach(t => { const d = dist(gk, t); if (d < best) { best = d; g = t; } });
    return g;
  }
  // Auto-facing while a player is dragged:
  //  • a blue attacker always turns to face the goal it attacks;
  //  • red defenders near that attacker turn to mark (face) it;
  //  • a dragged red defender turns to face the nearest blue attacker.
  function applyDragFacing(o) {
    if (!showFacing || !o || o.kind !== 'player') return;
    if (o.team === 'atk') {
      const g = attackGoal();
      if (g) faceToward(o, g);
      frame().objects.forEach(t => {
        if (t.kind === 'player' && t.team === 'def' && dist(o, t) < FACE_RADIUS) faceToward(t, o);
      });
    } else if (o.team === 'def') {
      let near = null, best = FACE_RADIUS;
      frame().objects.forEach(t => {
        if (t.kind === 'player' && t.team === 'atk') { const d = dist(o, t); if (d < best) { best = d; near = t; } }
      });
      if (near) faceToward(o, near);
    }
  }

  // Goal mouths in percent coordinates (team sports only). The goal sits on the
  // end line at the top; a full court also has one at the bottom.
  function goals() {
    if (!(window.SPORTS && SPORTS.isTeam && SPORTS.isTeam(sportId))) return [];
    const top = { x: 50, y: 2 };
    if (isHalf()) return [top];
    return [top, { x: 50, y: 98 }];
  }
  // Returns the goal centre if p points at a goal mouth, else null.
  function goalAim(p) {
    for (const g of goals()) {
      if (Math.abs(p.y - g.y) < 13 && Math.abs(p.x - g.x) < 14) return g;
    }
    return null;
  }

  function classifyAim(p) {
    const gk = goalkeeper();
    const mate = frame().objects.find(o => o.kind === 'player' && o.id !== selectedId && dist(o, p) < 7);
    if (mate) return { mode: 'pass', target: { x: mate.x, y: mate.y }, mate };
    // Ball only magnets to (is saved by) the keeper when the keeper is active.
    if (gk && gk.active && dist(gk, p) < 10) return { mode: 'save', target: { x: gk.x, y: gk.y } };
    // Pointing at the goal → a shot on goal.
    const g = goalAim(p);
    if (g) return { mode: 'goal', target: g };
    return { mode: 'shot', target: p, nearGoal: p.y < 22 || p.y > 78 };
  }

  function isCueSport() { return sportId === 'snooker' || sportId === 'pool'; }
  function cueBall() { return frame().objects.find(o => o.kind === 'cue' && o.id === 'cue') || frame().objects.find(o => o.kind === 'cue'); }

  function shoot(p) {
    if (isCueSport()) { shootCue(p); return; }
    if (sportId === 'darts') { throwDart(p); return; }
    shootTeam(p);
  }

  // Extend a shot from `from` through the aim point out to the court boundary,
  // so the ball flies in that direction instead of stopping at the crosshair.
  function extendShot(from, target) {
    const dx = target.x - from.x, dy = target.y - from.y;
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return { x: target.x, y: target.y };
    let t = Infinity;
    if (dx > 0) t = Math.min(t, (100 - from.x) / dx);
    else if (dx < 0) t = Math.min(t, (0 - from.x) / dx);
    if (dy > 0) t = Math.min(t, (100 - from.y) / dy);
    else if (dy < 0) t = Math.min(t, (0 - from.y) / dy);
    if (!isFinite(t) || t < 1) t = 1;   // never fall short of the aim point
    return { x: from.x + dx * t, y: from.y + dy * t };
  }

  // Fly the ball along a straight path from `from` to `to`, then run onArrive.
  function flyBall(from, to, onArrive) {
    pushHistory();
    Sfx.whoosh();
    let t = 0;
    const step = 0.08 * (BALL_SPEEDS[ballSpeed] || 1);   // slow / medium / fast
    const anim = setInterval(() => {
      t += step;
      ballFx = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
      draw();
      if (t >= 1) {
        clearInterval(anim); ballFx = null;
        const b = ball(); if (b) { b.x = to.x; b.y = to.y; }
        if (onArrive) onArrive();
        draw();
        if (autoRec) captureAutoFrame();
        scheduleAutosave();
      }
    }, 30);
  }

  function shootTeam(p) {
    const s = selected(); const b = ball();
    if (!s) { UI.toast(T('tactics.selectFirst'), 'error'); return; }
    if (!b) return;
    const info = classifyAim(p);
    const from = { x: b.x, y: b.y };
    const to = info.mode === 'shot' ? extendShot(from, info.target) : info.target;
    flyBall(from, to, () => {
      if (info.mode === 'pass') { selectedId = info.mate.id; UI.toast(T('tactics.passDone'), 'success'); }
      else if (info.mode === 'save') { UI.toast(T('tactics.savedKeeper'), 'error'); }
      else if (info.mode === 'goal') { Sfx.whistle(); UI.toast(T('tactics.shotGoal'), 'success'); }
      else { UI.toast(T('tactics.shotGoal'), 'success'); }
    });
  }

  // Throw the ball to a specific player (used by select-tool taps). The ball
  // flies from wherever it is to that player, who becomes the marked player.
  function passToPlayer(o) {
    const b = ball(); if (!b) return;
    flyBall({ x: b.x, y: b.y }, { x: o.x, y: o.y - 3 }, () => {
      selectedId = o.id;
      UI.toast(T('tactics.passDone'), 'success');
    });
  }

  // Begin charging a cue shot: the longer the press/touch, the harder the shot.
  function startCueCharge(p) {
    const cue = cueBall(); if (!cue) return;
    cueCharge = { x: p.x, y: p.y, t: Date.now() };
    aim = { x: p.x, y: p.y, mode: 'shot', from: { x: cue.x, y: cue.y } };
    if (chargeTimer) clearInterval(chargeTimer);
    chargeTimer = setInterval(draw, 40);   // animate the charge ring
    draw();
  }
  function releaseCueShot() {
    if (chargeTimer) { clearInterval(chargeTimer); chargeTimer = null; }
    const cc = cueCharge; cueCharge = null; aim = null;
    if (!cc) return;
    const charge = Math.min((Date.now() - cc.t) / 1000, 1);  // 0..1 over a 1-second hold
    shootCue({ x: cc.x, y: cc.y }, charge);
  }

  // Strike the cue ball toward the aim point. `charge` (0..1) sets the power:
  // a quick tap is soft, holding ~1s is a hard shot.
  function shootCue(p, charge) {
    const cue = cueBall();
    if (!cue) { UI.toast(T('tactics.selectFirst'), 'error'); return; }
    pushHistory();
    const W = canvas.width, H = canvas.height, R = 12, m = 34;
    const cpx = cue.x / 100 * W, cpy = cue.y / 100 * H;
    const dx = p.x / 100 * W - cpx, dy = p.y / 100 * H - cpy;
    const d = Math.hypot(dx, dy) || 1;
    const c = charge == null ? 0.55 : Math.max(0, Math.min(1, charge));
    const power = 2.5 + 27.5 * c;   // gentle tap (~2.5, low speed) → hard hold (~30)
    const balls = frame().objects.filter(o => o.kind === 'cue')
      .map(o => ({ o, x: o.x / 100 * W, y: o.y / 100 * H, vx: 0, vy: 0, potted: false }));
    const shooter = balls.find(bb => bb.o === cue);
    shooter.vx = dx / d * power; shooter.vy = dy / d * power;
    Sfx.whoosh();
    runPhysics(balls, {
      left: m + R, right: W - m - R, top: m + R, bottom: H - m - R, R, W, H,
      pockets: [[m, m], [W - m, m], [m, H - m], [W - m, H - m], [m, H / 2], [W - m, H / 2]], pocketR: 19
    });
  }

  function runPhysics(balls, env) {
    if (physTimer) { clearInterval(physTimer); physTimer = null; }
    let potted = 0;
    physTimer = setInterval(() => {
      balls.forEach(b => {
        if (b.potted) return;
        b.x += b.vx; b.y += b.vy;
        if (b.x < env.left) { b.x = env.left; b.vx = -b.vx * 0.9; }
        if (b.x > env.right) { b.x = env.right; b.vx = -b.vx * 0.9; }
        if (b.y < env.top) { b.y = env.top; b.vy = -b.vy * 0.9; }
        if (b.y > env.bottom) { b.y = env.bottom; b.vy = -b.vy * 0.9; }
        b.vx *= 0.985; b.vy *= 0.985;
        if (Math.hypot(b.vx, b.vy) < 0.16) { b.vx = 0; b.vy = 0; }
      });
      for (let i = 0; i < balls.length; i++) {
        for (let j = i + 1; j < balls.length; j++) {
          const a = balls[i], c = balls[j];
          if (a.potted || c.potted) continue;
          const dx = c.x - a.x, dy = c.y - a.y, dist = Math.hypot(dx, dy);
          if (dist > 0 && dist < 2 * env.R) {
            const nx = dx / dist, ny = dy / dist, overlap = (2 * env.R - dist) / 2;
            a.x -= nx * overlap; a.y -= ny * overlap; c.x += nx * overlap; c.y += ny * overlap;
            const rel = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
            if (rel < 0) { a.vx += rel * nx; a.vy += rel * ny; c.vx -= rel * nx; c.vy -= rel * ny; if (Sfx.hit) Sfx.hit(); }
          }
        }
      }
      balls.forEach(b => {
        if (b.potted) return;
        for (const [pxk, pyk] of env.pockets) {
          if (Math.hypot(b.x - pxk, b.y - pyk) < env.pocketR) {
            if (b.o.id === 'cue') { b.vx *= 0.4; b.vy *= 0.4; }   // respot rather than pot the cue
            else { b.potted = true; b.vx = 0; b.vy = 0; potted++; }
            break;
          }
        }
      });
      balls.forEach(b => { b.o.x = b.x / env.W * 100; b.o.y = b.y / env.H * 100; });
      const pottedObjs = balls.filter(b => b.potted).map(b => b.o);
      if (pottedObjs.length) frame().objects = frame().objects.filter(o => !pottedObjs.includes(o));
      draw();
      if (balls.every(b => b.potted || (b.vx === 0 && b.vy === 0))) {
        clearInterval(physTimer); physTimer = null;
        draw();
        if (potted) UI.toast(T('tactics.potted') + ' × ' + potted, 'success');
        if (autoRec) captureAutoFrame();
      }
    }, 20);
  }

  // Throw a dart to the aim point (round-robin across the three darts).
  function throwDart(p) {
    const darts = frame().objects.filter(o => o.kind === 'dart');
    if (!darts.length) return;
    pushHistory();
    const dart = darts[dartTurn % darts.length]; dartTurn++;
    const from = { x: 50, y: 97 }, to = { x: p.x, y: p.y };
    Sfx.whoosh();
    let t = 0;
    const anim = setInterval(() => {
      t += 0.1;
      dart.x = from.x + (to.x - from.x) * t;
      dart.y = from.y + (to.y - from.y) * t - Math.sin(Math.PI * t) * 6; // slight arc
      draw();
      if (t >= 1) {
        clearInterval(anim);
        dart.x = to.x; dart.y = to.y; draw();
        if (Sfx.hit) Sfx.hit();
        UI.toast(T('tactics.dartThrown'), 'success');
        if (autoRec) captureAutoFrame();
      }
    }, 24);
  }

  // Abort whatever gesture is in progress without committing it. Used when iOS
  // cancels the touch (palm, system edge swipe, incoming call) or when a second
  // finger lands — otherwise a half-finished drag or drawing would stay stuck.
  function cancelGesture() {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    if (chargeTimer) { clearInterval(chargeTimer); chargeTimer = null; }
    cueCharge = null; press = null; drag = null; dragShape = null; drawing = null; aim = null;
    draw();
  }

  function start(e) {
    if (e.touches && e.touches.length > 1) { cancelGesture(); return; }
    e.preventDefault();
    const p = toPct(e);
    if (tool === 'select') {
      const o = hitObject(p, ['player', 'gk', 'piece', 'card', 'checker', 'prop']);
      const grab = hitObject(p);                 // any object incl. the ball
      press = { start: p, last: p, o: o || null, grab: grab || null, shape: grab ? null : hitShape(p), moved: false, hist: false, t: Date.now(), long: false };
      if (holdTimer) clearTimeout(holdTimer);
      if (o) {
        // A still long-press selects the object (players, chess pieces, cards,
        // checkers). Naming is done with the Add name button below the colours.
        holdTimer = setTimeout(() => {
          if (!press || press.moved) return;
          press.long = true; selectedId = o.id; draw();
        }, HOLD_MS);
      }
      draw(); return;
    }
    if (tool === 'shoot') {
      if (isCueSport()) { startCueCharge(p); return; }   // press-and-hold to set power
      shoot(p); return;
    }
    if (tool === 'player') {
      pushHistory();
      frame().objects.push({ id: 't' + Date.now(), kind: 'player', team: 'atk', label: '+', x: p.x, y: p.y });
      draw(); if (autoRec) captureAutoFrame(); return;
    }
    if (tool === 'prop') {
      if (!pendingProp) { tool = 'select'; draw(); return; }
      pushHistory();
      frame().objects.push({ id: 'prop' + Date.now(), kind: 'prop', prop: pendingProp, color: propPaint, x: p.x, y: p.y });
      draw(); if (autoRec) captureAutoFrame(); scheduleAutosave(); return;
    }
    if (tool === 'erase') {
      const sh = hitShape(p);
      if (sh) { pushHistory(); frame().shapes = frame().shapes.filter(x => x !== sh); draw(); if (autoRec) captureAutoFrame(); return; }
      const o = hitObject(p); if (o && o.kind !== 'ball') { pushHistory(); frame().objects = frame().objects.filter(x => x !== o); draw(); if (autoRec) captureAutoFrame(); }
      return;
    }
    if (tool === 'free') { pushHistory(); drawing = { type: 'free', color, pts: [p] }; return; }
    if (tool === 'text') { askText(p); return; }
    pushHistory();
    drawing = { type: tool, color, x1: p.x, y1: p.y, x2: p.x, y2: p.y };
  }
  // Text tool: tap the board, type the label, it is stored as a shape on the frame.
  function askText(p) {
    UI.modal({
      title: T('tactics.textTitle'),
      body: `<label class="field"><span>${T('tactics.textLabel')}</span><input id="txt_val" maxlength="48" placeholder="${UI.esc(T('tactics.textPlaceholder'))}"></label>`,
      footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button><button class="btn primary" data-save>${T('common.save')}</button>`,
      onOpen: (m, close) => {
        const inp = m.querySelector('#txt_val');
        inp.focus();
        const commit = () => {
          const v = inp.value.trim();
          if (!v) { close(); return; }
          pushHistory();
          frame().shapes.push({ type: 'text', color, x1: p.x, y1: p.y, text: v });
          setTool('select');
          close(); draw(); if (autoRec) captureAutoFrame(); scheduleAutosave();
        };
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-save]').onclick = commit;
      }
    });
  }
  function move(e) {
    if (e.touches && e.touches.length > 1) { cancelGesture(); return; }
    const p = toPct(e);
    // Keep the page/container from scrolling during an active pointer gesture or
    // whenever the board is fullscreen, so an iPad touch-drag never triggers the
    // native scroll that would dismiss fullscreen.
    if (e.cancelable && (press || drag || drawing || fsActive())) e.preventDefault();
    if (tool === 'shoot') {
      if (isCueSport()) { const c = cueBall(); if (c) { aim = { x: p.x, y: p.y, mode: 'shot', from: { x: c.x, y: c.y } }; if (cueCharge) { cueCharge.x = p.x; cueCharge.y = p.y; } draw(); return; } }
      else if (sportId === 'darts') { aim = { x: p.x, y: p.y, mode: 'shot', from: { x: 50, y: 97 } }; draw(); return; }
      else if (selected()) { const info = classifyAim(p); aim = { x: p.x, y: p.y, mode: info.mode }; draw(); return; }
    }
    // Select-mode: once the press moves far enough it becomes a drag (move the object).
    if (tool === 'select' && press && !drag && !dragShape) {
      if (dist(p, press.start) > MOVE_TOL) {
        press.moved = true;
        if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
        if (press.grab) {
          if (press.o) selectedId = press.o.id;
          if (!press.hist) { pushHistory(); press.hist = true; }
          drag = press.grab;
        } else if (press.shape) {
          if (!press.hist) { pushHistory(); press.hist = true; }
          dragShape = press.shape;
        }
      }
    }
    if (!drag && !dragShape && !drawing) return;
    e.preventDefault();
    if (dragShape) {
      moveShape(dragShape, p.x - press.last.x, p.y - press.last.y);
      press.last = p; draw(); return;
    }
    if (drag) {
      drag.x = p.x; drag.y = p.y; applyMagnet(); applyDragFacing(drag); draw(); return;
    }
    if (drawing.type === 'free') drawing.pts.push(p); else { drawing.x2 = p.x; drawing.y2 = p.y; }
    draw();
  }
  function end() {
    if (cueCharge) { releaseCueShot(); return; }   // fire the charged cue shot
    if (drawing) {
      frame().shapes.push(drawing); drawing = null;
      setTool('select');                            // finished art is immediately draggable
      draw(); if (autoRec) captureAutoFrame(); scheduleAutosave();
    }
    if (drag) {
      applyMagnet(); drag = null; draw();
      if (autoRec) captureAutoFrame(); scheduleAutosave();
    } else if (dragShape) {
      dragShape = null; draw();
      if (autoRec) captureAutoFrame(); scheduleAutosave();
    } else if (tool === 'select' && press && !press.moved && !press.long) {
      handleSelectTap(press);                       // quick tap: select, or pass to a tapped mate
    }
    press = null;
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
  }

  // ---- Player naming (inline panel below the colours) ----
  // Select a player, then Add name reveals an input; the same button then saves
  // the typed name and Cancel add name aborts without changing it.
  let naming = false;
  let namingId = null;
  let nameSig = null;
  function updateNameTools() {
    const addBtn = mount.querySelector('#addNameBtn');
    if (!addBtn) return;
    const s = selected();
    if (!s || (naming && s.id !== namingId)) naming = false;
    const sig = (s ? s.id : '') + '|' + (naming ? 1 : 0);
    if (sig === nameSig) return;                     // nothing changed — skip DOM work
    nameSig = sig;
    const cancelBtn = mount.querySelector('#cancelNameBtn');
    const input = mount.querySelector('#playerNameInput');
    const hint = mount.querySelector('#nameHint');
    addBtn.disabled = !s;
    if (naming && s) {
      addBtn.textContent = '\u2713 ' + T('tactics.saveName');
      cancelBtn.classList.remove('hidden');
      input.classList.remove('hidden');
      if (hint) hint.classList.add('hidden');
    } else {
      addBtn.textContent = '\uFF0B ' + T('tactics.addName');
      cancelBtn.classList.add('hidden');
      input.classList.add('hidden');
      if (hint) hint.classList.toggle('hidden', !!s);
    }
  }
  function startNaming() {
    const s = selected();
    if (!s) { UI.toast(T('tactics.selectFirst'), 'error'); return; }
    naming = true; namingId = s.id; nameSig = null; updateNameTools();
    const input = mount.querySelector('#playerNameInput');
    if (input) { input.value = s.name || ''; try { input.focus(); input.select(); } catch (e) { } }
  }
  function commitName() {
    const s = selected();
    const input = mount.querySelector('#playerNameInput');
    if (s && input) {
      const name = input.value.trim();
      pushHistory();
      if (name) s.name = name; else delete s.name;
      if (autoRec) captureAutoFrame(); scheduleAutosave();
    }
    naming = false; nameSig = null; updateNameTools(); draw();
  }
  function cancelNaming() { naming = false; nameSig = null; updateNameTools(); }

  // A quick tap in select mode. With a player already marked and a ball on the
  // court: tapping the goal shoots on goal, and tapping a player who isn't
  // holding the ball throws the ball to them (a pass, or feeding the marked
  // player). Otherwise the tap just selects the object under it.
  function handleSelectTap(pr) {
    const o = pr.o;
    const b = ball();
    const s = selected();                           // the currently-marked player
    if (b && s) {
      // Tap the goal mouth (empty space or the keeper) → shoot: the keeper
      // saves it when active, otherwise it counts as a goal.
      if ((!o || o.kind === 'gk') && goalAim(pr.start)) {
        shoot(pr.start);
        return;
      }
      // Tap a player that isn't already holding the ball → throw the ball to
      // them (pass to a team-mate, or feed the marked player who has no ball).
      if (o && (o.kind === 'player' || o.kind === 'gk') && dist(o, b) > 4) {
        passToPlayer(o);
        return;
      }
    }
    if (!o) return;                                 // empty space (not a goal) — keep selection
    selectedId = o.id;                              // otherwise just select the tapped object
    draw();
  }

  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', end);
  canvas.addEventListener('touchcancel', cancelGesture);
  // iPadOS fires a long-press context menu over the canvas, which would abort
  // the hold-to-select gesture.
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  function renderTimeline() {
    const tl = mount.querySelector('#timeline');
    const n = current.frames.length;
    tl.innerHTML =
      `<div class="tl-head">
        <span class="tl-title">${T('tactics.frameList')} <b>${n}</b></span>
        <span class="tl-actions">
          <button class="btn sm" id="addFrameTl">＋ ${T('tactics.addFrame')}</button>
          <button class="btn sm danger" id="delFrame"${n > 1 ? '' : ' disabled'}>✕ ${T('tactics.deleteFrame')} ${frameIdx + 1}</button>
        </span>
      </div>
      <div class="tl-grid">` +
      current.frames.map((f, i) => `<span class="frame-chip ${i === frameIdx ? 'active' : ''}" data-frame="${i}">${T('tactics.frame')} ${i + 1}</span>`).join('') +
      `</div>`;
    tl.querySelectorAll('[data-frame]').forEach(c => c.onclick = () => { frameIdx = +c.dataset.frame; draw(); renderTimeline(); });
    const af = tl.querySelector('#addFrameTl');
    if (af) af.onclick = () => { pushHistory(); current.frames.splice(frameIdx + 1, 0, JSON.parse(JSON.stringify(frame()))); frameIdx++; draw(); renderTimeline(); };
    const df = tl.querySelector('#delFrame');
    if (df) df.onclick = () => {
      if (current.frames.length < 2) return;
      pushHistory(); current.frames.splice(frameIdx, 1);
      frameIdx = Math.min(frameIdx, current.frames.length - 1);   // stay where the user was looking
      draw(); renderTimeline();
    };
    // Keep the active frame visible when the grid overflows (e.g. many auto-frames).
    const activeChip = tl.querySelector('.frame-chip.active');
    if (activeChip && activeChip.scrollIntoView) activeChip.scrollIntoView({ block: 'nearest' });
  }

  // Animation — whistle resets & replays on every start
  function updatePlayBtn() {
    const b = mount.querySelector('#playAnim');
    if (b) b.textContent = animTimer ? '■ ' + T('tactics.stop') : '▶ ' + T('tactics.play');
  }
  function stopAnimation() {
    if (animStep) { clearInterval(animStep); animStep = null; }
    if (animTimer) { clearInterval(animTimer); animTimer = null; }
    updatePlayBtn();
    const cb = animEnd; animEnd = null; if (cb) cb();
  }
  function playAnimation(onEnd) {
    if (animTimer) { stopAnimation(); frameIdx = 0; draw(); return; }
    animEnd = typeof onEnd === 'function' ? onEnd : null;
    Sfx.whistle();
    let i = 0;
    animTimer = setInterval(() => {
      const a = current.frames[i], b = current.frames[(i + 1) % current.frames.length];
      let t = 0;
      const step = setInterval(() => {
        t += 0.1;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawCourt();
        a.shapes.forEach(drawShape);
        a.objects.forEach(o => {
          const bo = b.objects.find(x => x.id === o.id) || o;
          const ix = o.x + (bo.x - o.x) * t, iy = o.y + (bo.y - o.y) * t;
          const x = ix / 100 * canvas.width;
          const y = iy / 100 * canvas.height;
          let oo = o;
          if (typeof o.rot === 'number' && typeof bo.rot === 'number') oo = Object.assign({}, o, { x: ix, y: iy, rot: lerpAngle(o.rot, bo.rot, t) });
          if (o.kind === 'ball') drawBall(x, y); else if (o.kind === 'cue') drawCue(oo, x, y); else if (o.kind === 'dart') drawDart(oo, x, y); else if (o.kind === 'prop') drawProp(oo, x, y); else if (o.kind === 'piece') drawPiece(oo, x, y); else if (o.kind === 'card') drawCard(oo, x, y); else if (o.kind === 'checker') drawChecker(oo, x, y); else drawPlayer(oo, x, y);
        });
        if (t >= 1) {
          clearInterval(step); animStep = null;
          i = (i + 1) % current.frames.length;
          if (i === 0) { stopAnimation(); frameIdx = 0; draw(); }
        }
      }, 40);
      animStep = step;
    }, 1200);
    updatePlayBtn();
  }

  // ---- Auto-frame recording ----
  // Records the board while capturing a new frame each time the user moves
  // players. Movement automatically becomes animation frames.
  // Several MediaRecorders can share one canvas stream, so a single take yields
  // both containers; MP4 is only offered where the browser can encode it.
  function pickRecFormats() {
    const cand = [
      ['video/webm;codecs=vp9', 'webm'], ['video/webm;codecs=vp8', 'webm'], ['video/webm', 'webm'],
      ['video/mp4;codecs=avc1.42E01E', 'mp4'], ['video/mp4;codecs=avc1', 'mp4'], ['video/mp4', 'mp4']
    ];
    const sup = m => !!(window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m));
    const out = [];
    ['webm', 'mp4'].forEach(ext => { const hit = cand.find(c => c[1] === ext && sup(c[0])); if (hit) out.push({ mime: hit[0], ext }); });
    if (!out.length) out.push({ mime: '', ext: 'webm' });
    return out;
  }
  // The finished takes stay in memory behind explicit export buttons — no
  // download starts until the coach picks a format.
  function showRecExports(outs) {
    const box = mount.querySelector('#recExport');
    if (!box) return;
    if (!outs.length) { box.innerHTML = ''; box.classList.add('hidden'); return; }
    const size = b => b < 1048576 ? Math.max(1, Math.round(b / 1024)) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
    box.innerHTML = `<span class="hint">${T('tactics.recReady')}</span>` +
      outs.map((o, i) => `<button class="btn sm" data-dl="${i}">⬇ ${o.ext.toUpperCase()} · ${size(o.blob.size)}</button>`).join('') +
      `<button class="btn sm ghost" id="recExportClose" title="${T('tactics.recDiscard')}">✕</button>`;
    box.classList.remove('hidden');
    box.querySelectorAll('[data-dl]').forEach(b => b.onclick = () => {
      const o = outs[+b.dataset.dl];
      const name = ((current.name || 'tactic').replace(/[^\w.-]+/g, '_') || 'tactic') + '.' + o.ext;
      const url = URL.createObjectURL(o.blob);
      const a = document.createElement('a'); a.href = url; a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      UI.toast(T('tactics.recExported') + ' ' + name, 'success');
    });
    box.querySelector('#recExportClose').onclick = () => { box.innerHTML = ''; box.classList.add('hidden'); fitCanvas(); };
    fitCanvas();
  }
  function captureAutoFrame() {
    if (!autoRec) return;
    // snapshot current frame as a new frame so movement is preserved
    current.frames.splice(frameIdx + 1, 0, JSON.parse(JSON.stringify(frame())));
    frameIdx++;
    autoRec.count++;
    const fc = mount.querySelector('#frameCount'); if (fc) fc.textContent = autoRec.count;
    draw(); renderTimeline();
  }
  function startAutoRecord() {
    pushHistory();
    autoRec = { count: 0, start: Date.now(), recs: [] };
    const box = mount.querySelector('#recExport'); if (box) { box.innerHTML = ''; box.classList.add('hidden'); }
    if (window.MediaRecorder && canvas.captureStream) {
      try {
        const stream = canvas.captureStream(30);
        const outs = [];
        let pending = 0;
        const finish = () => { if (--pending > 0) return; showRecExports(outs.filter(o => o.blob && o.blob.size)); };
        pickRecFormats().forEach(f => {
          let r;
          try { r = f.mime ? new MediaRecorder(stream, { mimeType: f.mime }) : new MediaRecorder(stream); } catch (e) { return; }
          const out = { ext: f.ext, blob: null };
          const chunks = [];
          r.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
          r.onstop = () => { out.blob = new Blob(chunks, { type: r.mimeType || 'video/' + f.ext }); finish(); };
          // A dead container must not hold back the one that worked.
          r.onerror = () => { chunks.length = 0; finish(); };
          try { r.start(); } catch (e) { return; }
          outs.push(out); autoRec.recs.push(r); pending++;
        });
      } catch (e) { /* video capture optional */ }
    }
    const dot = mount.querySelector('#recDot'); if (dot) dot.classList.remove('hidden');
    const btn = mount.querySelector('#recFramesBtn');
    if (btn) { btn.textContent = '■ ' + T('tactics.stopRec'); btn.classList.add('danger'); btn.classList.remove('primary'); }
    const fc = mount.querySelector('#frameCount'); if (fc) fc.textContent = '0';
    recTimer = setInterval(() => {
      const s = Math.floor((Date.now() - autoRec.start) / 1000);
      const rt = mount.querySelector('#recTime'); if (rt) rt.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    }, 500);
    UI.toast(T('tactics.recording'));
  }
  function stopAutoRecord() {
    if (!autoRec) return;
    (autoRec.recs || []).forEach(r => { if (r.state !== 'inactive') { try { r.stop(); } catch (e) {} } });
    clearInterval(recTimer);
    const n = autoRec.count; autoRec = null;
    const dot = mount.querySelector('#recDot'); if (dot) dot.classList.add('hidden');
    const btn = mount.querySelector('#recFramesBtn');
    if (btn) { btn.textContent = '● ' + T('tactics.recFrames'); btn.classList.remove('danger'); btn.classList.add('primary'); }
    UI.toast(T('tactics.recDone') + ' — ' + n + ' ' + T('tactics.framesCaptured'), 'success');
    frameIdx = 0; draw(); renderTimeline();
  }
  function toggleAutoRecord() { if (autoRec) stopAutoRecord(); else startAutoRecord(); }

  // ---- Fullscreen ----
  // iPadOS Safari has no Fullscreen API for regular elements, so when the call
  // is unavailable we simply pin .board-wrap over the viewport with CSS.
  let fauxFs = false;
  function fsElement() { return document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || null; }
  function fsActive() { return !!fsElement() || fauxFs; }
  function toggleFullscreen() {
    const el = mount.querySelector('#boardWrap');
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen;
    if (!fsActive()) {
      if (req) { Promise.resolve(req.call(el)).catch(() => { fauxFs = true; onFsChange(); }); return; }
      fauxFs = true; onFsChange(); return;
    }
    if (fsElement()) (document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || function () {}).call(document);
    else { fauxFs = false; onFsChange(); }
  }
  function onFsChange() {
    const wrap = mount.querySelector('#boardWrap');
    const btn = mount.querySelector('#fullscreenBtn');
    if (fsElement()) fauxFs = false;
    const on = fsActive();
    if (wrap) wrap.classList.toggle('fs', on);
    document.body.classList.toggle('board-fs', on);
    if (btn) btn.textContent = on ? '⛶ ' + T('tactics.exitFullscreen') : '⛶ ' + T('tactics.fullscreen');
    fitCanvas();
  }
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);

  // Keep the canvas responsive to its container: the court always fits the
  // viewport, so the board never forces the page to scroll.
  function fitCanvas() {
    const stage = mount.querySelector('.board-stage');
    if (!stage) return;
    applyCanvasSize();
    const ratio = canvas.height / canvas.width;      // ~0.8 (700x560)
    // Frames & Animation sits beside the court on wide screens and wraps under
    // it on narrow ones — either way its box has to come out of the budget.
    const side = mount.querySelector('#framesAnim');
    // Matches the .stage-row breakpoint in styles.css — measuring instead would
    // feed the canvas size back into its own budget and never settle.
    const beside = !!side && window.matchMedia('(min-width: 901px)').matches;
    const availW = stage.clientWidth - (beside ? side.offsetWidth + 12 : 0);
    if (availW <= 0) { draw(); return; }
    const rect = canvas.getBoundingClientRect();
    // Measure the controls stacked under the board (name bar and frame strip).
    let below = 0;
    stage.querySelectorAll('.name-bar, .timeline').forEach(el => { below += el.offsetHeight; });
    if (side && !beside) below += side.offsetHeight + 12;
    // visualViewport tracks the iPad's collapsing Safari toolbars; innerHeight does not.
    const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    // Measure from the document top, otherwise the space would grow as the user
    // scrolls and the court would never settle on a size.
    const top = fsActive() ? rect.top : rect.top + (window.scrollY || 0);
    const availH = vh - top - below - 28;            // row gaps + bottom margin
    let w = availW;
    let h = w * ratio;
    if (availH > 140 && h > availH) { h = availH; w = h / ratio; }
    canvas.style.width = Math.round(w) + 'px';
    canvas.style.height = Math.round(h) + 'px';
    draw();
  }
  const roResize = () => fitCanvas();
  window.addEventListener('resize', roResize);
  // iPad rotation reports the new size a beat after the event fires.
  window.addEventListener('orientationchange', () => setTimeout(fitCanvas, 250));
  if (window.visualViewport) window.visualViewport.addEventListener('resize', roResize);

  // ---- Sport-specific tools ----
  const ALL_TOOLS = [
    ['select', 'Select', 'Select / move'], ['shoot', 'Shoot', 'Shoot the ball'], ['player', 'Add', 'Add player'],
    ['pass', 'Pass', 'Pass line'], ['run', 'Run', 'Run path'], ['arrow', 'Arrow', 'Arrow'], ['line', 'Line', 'Line'],
    ['free', 'Draw', 'Freehand'], ['circle', 'Circle', 'Circle'], ['rect', 'Rect', 'Rectangle'],
    ['text', 'Text', 'Text label'], ['erase', 'Erase', 'Erase object']
  ];
  function toolIdsFor(id) {
    if (id === 'snooker' || id === 'pool') return ['select', 'shoot', 'arrow', 'line', 'free', 'circle', 'rect', 'text', 'erase'];
    if (id === 'darts') return ['select', 'shoot', 'arrow', 'line', 'free', 'text', 'erase'];
    if (id === 'badminton') return ['select', 'shoot', 'player', 'arrow', 'line', 'free', 'circle', 'rect', 'text', 'erase'];
    if (id === 'chess' || id === 'bridge' || id === 'poker' || id === 'backgammon') return ['select', 'arrow', 'line', 'free', 'circle', 'rect', 'text', 'erase'];
    return ALL_TOOLS.map(t => t[0]); // team sports: all tools
  }
  function renderTools() {
    const cont = mount.querySelector('#tools');
    if (!cont) return;
    const allowed = toolIdsFor(sportId);
    if (tool !== 'prop' && !allowed.includes(tool)) { tool = 'select'; aim = null; }
    cont.innerHTML = ALL_TOOLS.filter(t => allowed.includes(t[0]))
      .map(([t, i, tip]) => `<div class="tool-btn ${t === tool ? 'active' : ''}" data-tool="${t}" title="${tip}">${i}</div>`).join('');
    cont.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => {
      tool = b.dataset.tool; pendingProp = null; aim = null; cueCharge = null;
      if (chargeTimer) { clearInterval(chargeTimer); chargeTimer = null; }
      cont.querySelectorAll('[data-tool]').forEach(x => x.classList.toggle('active', x === b));
      mount.querySelectorAll('#props [data-prop]').forEach(x => x.classList.remove('active'));
      draw();
    });
    const hint = mount.querySelector('#toolHint');
    if (hint) hint.textContent = isCueSport() ? T('tactics.hintCue') : (sportId === 'darts' ? T('tactics.hintDarts') : T('tactics.hint'));
  }
  // Switch tools from code and keep the palette highlight in step.
  function setTool(t) {
    tool = t; aim = null; pendingProp = null;
    mount.querySelectorAll('#tools [data-tool]').forEach(x => x.classList.toggle('active', x.dataset.tool === t));
    mount.querySelectorAll('#props [data-prop]').forEach(x => x.classList.remove('active'));
  }
  // Sport-category based training props (cones, ladders, mini-goals…). Selecting
  // one arms placement mode: the next tap on the board drops that prop.
  const PROP_GLYPH = { cone: '\u{1F53A}', disc: '\u{1F7E1}', pole: '\u{1F6A9}', hurdle: '\u{1F6A7}', ladder: '\u{1FA9C}', ring: '\u2B55', minigoal: '\u{1F945}', dummy: '\u{1F9CD}', medicineball: '\u{1F7E4}', target: '\u{1F3AF}' };
  function renderProps() {
    const wrap = mount.querySelector('#propsWrap');
    const cont = mount.querySelector('#props');
    if (!wrap || !cont) return;
    const list = (window.SPORTS && SPORTS.props) ? SPORTS.props(sportId) : [];
    wrap.classList.toggle('hidden', !list.length);
    if (!list.length) return;
    const lang = I18N.getLang();
    cont.innerHTML = list.map(p => {
      const label = (p.name && (p.name[lang] || p.name.en)) || p.type;
      const on = tool === 'prop' && pendingProp === p.type;
      const tint = propPaint || PROP_COLOR[p.type] || '#ffd400';
      return `<div class="tool-btn prop-btn ${on ? 'active' : ''}" data-prop="${p.type}" title="${UI.esc(label)}" style="color:${tint};border-color:${tint}">${PROP_GLYPH[p.type] || '\u25CF'}</div>`;
    }).join('');
    cont.querySelectorAll('[data-prop]').forEach(b => b.onclick = () => {
      tool = 'prop'; pendingProp = b.dataset.prop; aim = null;
      mount.querySelectorAll('#tools [data-tool]').forEach(x => x.classList.remove('active'));
      cont.querySelectorAll('[data-prop]').forEach(x => x.classList.toggle('active', x === b));
      draw();
    });
  }
  // Show the rotate controls only while a player/keeper is selected.
  function updateRotControls() {
    const wrap = mount.querySelector('#rotWrap');
    if (!wrap) return;
    wrap.classList.toggle('hidden', !selected());
  }
  function rotateSelected(delta) {
    const s = selected(); if (!s) return;
    pushHistory();
    s.rot = (typeof s.rot === 'number' ? s.rot : -Math.PI / 2) + delta;
    draw(); if (autoRec) captureAutoFrame(); scheduleAutosave();
  }
  mount.querySelectorAll('[data-sport]').forEach(b => b.onclick = () => {
    sportId = b.dataset.sport;
    if (window.App && App.setSport) App.setSport(sportId, true);
    stopAnimation();
    current = loadOrNew();
    courtMode = current.courtMode || 'full';
    history = []; future = []; updateUndoButtons();
    frameIdx = 0; selectedId = null; aim = null;
    mount.querySelectorAll('[data-sport]').forEach(x => x.classList.toggle('active', x === b));
    pendingProp = null; if (tool === 'prop') tool = 'select';
    setupBotMode();
    renderPlaybook();
    renderTools();
    renderProps();
    updateCourtModeUI();
    fitCanvas(); draw(); renderTimeline();
  });
  mount.querySelectorAll('[data-color]').forEach(b => b.onclick = () => {
    color = b.dataset.color;
    mount.querySelectorAll('[data-color]').forEach(x => x.style.outline = '');
    b.style.outline = '2px solid var(--primary)';
  });
  // Training props carry their own colour, so gear can be tinted without
  // changing the colour the drawing tools use.
  mount.querySelectorAll('[data-propcolor]').forEach(b => b.onclick = () => {
    propPaint = b.dataset.propcolor || null;
    mount.querySelectorAll('[data-propcolor]').forEach(x => x.style.outline = '');
    if (propPaint) b.style.outline = '2px solid var(--primary)';
    renderProps();
    const sp = frame().objects.find(o => o.id === selectedId && o.kind === 'prop');
    if (sp) { pushHistory(); sp.color = propPaint || null; draw(); if (autoRec) captureAutoFrame(); scheduleAutosave(); }
  });
  function updateSpeedButtons() {
    mount.querySelectorAll('[data-speed]').forEach(b => b.classList.toggle('primary', b.dataset.speed === ballSpeed));
  }
  mount.querySelectorAll('[data-speed]').forEach(b => b.onclick = () => {
    ballSpeed = b.dataset.speed;
    try { localStorage.setItem('tacticsBallSpeed', ballSpeed); } catch (e) { }
    updateSpeedButtons();
  });
  mount.querySelector('#playAnim').onclick = () => playAnimation();
  mount.querySelector('#clearShapes').onclick = () => { pushHistory(); frame().shapes = []; draw(); if (autoRec) captureAutoFrame(); };
  const addNameBtn = mount.querySelector('#addNameBtn');
  if (addNameBtn) addNameBtn.onclick = () => { if (naming) commitName(); else startNaming(); };
  const cancelNameBtn = mount.querySelector('#cancelNameBtn');
  if (cancelNameBtn) cancelNameBtn.onclick = cancelNaming;
  const playerNameInput = mount.querySelector('#playerNameInput');
  if (playerNameInput) playerNameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commitName(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelNaming(); }
  });
  const keeperBtn = mount.querySelector('#keeperToggle');
  if (keeperBtn) keeperBtn.onclick = () => {
    const gk = goalkeeper(); if (!gk) return;
    pushHistory();
    gk.active = !gk.active;
    updateKeeperToggle(); draw();
    UI.toast(gk.active ? T('tactics.keeperOn') : T('tactics.keeperOff'), gk.active ? 'success' : 'error');
  };
  const rotLeftBtn = mount.querySelector('#rotLeft');
  if (rotLeftBtn) rotLeftBtn.onclick = () => rotateSelected(-Math.PI / 12);
  const rotRightBtn = mount.querySelector('#rotRight');
  if (rotRightBtn) rotRightBtn.onclick = () => rotateSelected(Math.PI / 12);
  const facingChk = mount.querySelector('#facingToggle');
  if (facingChk) {
    Store.getSetting('boardFacing', true).then(v => { showFacing = v !== false; facingChk.checked = showFacing; draw(); });
    facingChk.onchange = () => {
      showFacing = facingChk.checked;
      Store.setSetting('boardFacing', showFacing);
      draw();
      UI.toast(showFacing ? T('tactics.facingOn') : T('tactics.facingOff'), showFacing ? 'success' : 'error');
    };
  }
  const rotClearBtn = mount.querySelector('#rotClear');
  if (rotClearBtn) rotClearBtn.onclick = () => {
    const s = selected(); if (!s || typeof s.rot !== 'number') return;
    pushHistory(); delete s.rot; draw(); if (autoRec) captureAutoFrame(); scheduleAutosave();
  };
  const shotBtn = mount.querySelector('#shotBtn');
  if (shotBtn) shotBtn.onclick = () => {
    try {
      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url; a.download = ((current.name || 'tactics-board').replace(/[^\w.-]+/g, '_')) + '.png'; a.click();
      UI.toast(T('tactics.shotSaved'), 'success');
    } catch (e) { UI.toast(T('tactics.shotFailed'), 'error'); }
  };
  function updateCourtModeUI() {
    const wrap = mount.querySelector('#courtModeWrap');
    if (!wrap) return;
    const isTeam = !!(window.SPORTS && SPORTS.isTeam && SPORTS.isTeam(sportId));
    wrap.classList.toggle('hidden', !isTeam);
    const sel = mount.querySelector('#courtModeSel'); if (sel) sel.value = courtMode;
  }
  const courtModeSel = mount.querySelector('#courtModeSel');
  if (courtModeSel) courtModeSel.onchange = () => {
    courtMode = courtModeSel.value;
    pushHistory();
    current.courtMode = courtMode;
    frame().objects = (courtMode === 'half' && window.SPORTS && SPORTS.halfFormation)
      ? SPORTS.halfFormation(sportId) : defaultFrame().objects;
    selectedId = null; aim = null;
    fitCanvas(); draw();
    UI.toast(courtMode === 'half' ? T('tactics.halfCourt') : T('tactics.fullCourt'), 'success');
  };
  mount.querySelector('#recFramesBtn').onclick = toggleAutoRecord;
  mount.querySelector('#undoBtn').onclick = undo;
  mount.querySelector('#redoBtn').onclick = redo;
  // Back to the sport's starting formation: one frame, no drawings, no names.
  mount.querySelector('#resetBoard').onclick = () => UI.confirm(T('tactics.resetAsk'), () => {
    pushHistory();
    if (autoRec) stopAutoRecord();
    current.frames = [{
      objects: (courtMode === 'half' && window.SPORTS && SPORTS.halfFormation)
        ? SPORTS.halfFormation(sportId) : defaultFrame().objects,
      shapes: []
    }];
    frameIdx = 0; selectedId = null; aim = null;
    fitCanvas(); draw(); renderTimeline(); scheduleAutosave();
    UI.toast(T('tactics.resetDone'), 'success');
  });
  mount.querySelector('#fullscreenBtn').onclick = toggleFullscreen;
  mount.querySelector('#savePlay').onclick = async () => {
    current.name = mount.querySelector('#playName').value.trim() || 'Untitled Play';
    current.sport = sportId;
    const saved = await Store.save('tactics', current); current.id = saved.id;
    UI.toast(T('tactics.saved'), 'success');
  };

  // ---- Keyboard shortcuts (undo / redo) ----
  function onKey(e) {
    if (e.target.matches('input,textarea,select')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  }
  document.addEventListener('keydown', onKey);

  // ---- Playbook: 30 tactical animation systems per sport + the coach's own ----
  // Saved animations are `tactics` records tagged `kind:'system'`.
  function userSystems() {
    return Store.all('tactics').filter(t => t.kind === 'system' && (t.sport || 'handball') === sportId);
  }
  function systemRowsHtml(mine) {
    return mine.map(s => `<div class="play-row">
        <button class="play-item" data-sys="${UI.esc(s.id)}" title="${UI.esc(s.name)}">★ ${UI.esc(s.name)}</button>
        ${systemClips(s).length ? `<button class="btn sm" data-vid="${UI.esc(s.id)}" title="${T('tactics.animPlayVideo')}">▶</button>` : ''}
        <button class="btn sm danger" data-delsys="${UI.esc(s.id)}" title="${T('common.delete')}">✕</button>
      </div>`).join('');
  }
  function bindSystemRows(root) {
    root.querySelectorAll('[data-sys]').forEach(b => b.onclick = () => loadSystem(b.dataset.sys));
    root.querySelectorAll('[data-vid]').forEach(b => b.onclick = () => playSystemVideo(b.dataset.vid));
    root.querySelectorAll('[data-delsys]').forEach(b => b.onclick = () => UI.confirm(T('tactics.animDelAsk'), async () => {
      await Store.remove('tactics', b.dataset.delsys);
      renderPlaybook(); UI.toast(T('common.delete'));
    }));
  }
  // Mirror of the saved systems, docked under the Save Animation button.
  function renderAnimList() {
    const box = mount.querySelector('#animList');
    if (!box) return;
    const mine = userSystems();
    const cnt = mount.querySelector('#animCount');
    if (cnt) cnt.textContent = mine.length;
    const keep = box.value;
    box.innerHTML = mine.length
      ? mine.map(s => `<option value="${UI.esc(s.id)}"${systemClips(s).length ? ' data-vid="1"' : ''}>${systemClips(s).length ? '▶ ' : '★ '}${UI.esc(s.name)}</option>`).join('')
      : `<option value="" disabled>${T('tactics.noSavedAnims')}</option>`;
    if (mine.some(s => s.id === keep)) box.value = keep;
    else box.selectedIndex = -1;
    syncAnimActions();
    fitCanvas();
  }
  function syncAnimActions() {
    const box = mount.querySelector('#animList');
    const opt = box && box.selectedOptions[0];
    const id = opt && opt.value;
    mount.querySelector('#animLoad').disabled = !id;
    mount.querySelector('#animDel').disabled = !id;
    mount.querySelector('#animVideo').disabled = !(opt && opt.dataset.vid);
  }
  function bindAnimActions() {
    const box = mount.querySelector('#animList');
    if (!box) return;
    const sel = () => (box.selectedOptions[0] || {}).value || '';
    // Picking an entry loads its frames into the strip below; Load/dbl-click plays it.
    box.onchange = () => { syncAnimActions(); if (sel()) loadSystem(sel(), false); };
    box.ondblclick = () => { if (sel()) loadSystem(sel()); };
    mount.querySelector('#animLoad').onclick = () => { if (sel()) loadSystem(sel()); };
    mount.querySelector('#animVideo').onclick = () => { if (sel()) playSystemVideo(sel()); };
    mount.querySelector('#animDel').onclick = () => {
      const id = sel();
      if (id) UI.confirm(T('tactics.animDelAsk'), async () => {
        await Store.remove('tactics', id);
        renderPlaybook(); UI.toast(T('common.delete'));
      });
    };
  }
  function renderPlaybook() {
    const list = mount.querySelector('#playList');
    const cnt = mount.querySelector('#playCount');
    if (!list) return;
    const all = (window.PLAYBOOK && PLAYBOOK.plays(sportId)) || [];
    const lang = I18N.getLang();
    const mine = userSystems();
    if (cnt) cnt.textContent = all.length + mine.length;
    const allHtml = all.map((p, i) => `<button class="play-item" data-play="${i}">${UI.esc((i + 1) + '. ' + (p[lang] || p.en))}</button>`).join('');
    list.innerHTML = (systemRowsHtml(mine) + allHtml) || `<p class="hint">${T('common.noData')}</p>`;
    list.querySelectorAll('[data-play]').forEach(b => b.onclick = () => loadPlay(+b.dataset.play));
    bindSystemRows(list);
    renderAnimList();
  }
  function loadPlay(index) {
    if (!window.PLAYBOOK) return;
    stopAnimation();
    pushHistory();
    current.frames = PLAYBOOK.buildPlay(frame().objects, index, sportId);
    frameIdx = 0; selectedId = null; aim = null;
    draw(); renderTimeline();
    UI.toast(T('play.loaded') + ': ' + PLAYBOOK.playName(sportId, index), 'success');
    playAnimation();
  }
  function loadSystem(id, play) {
    const s = Store.find('tactics', id);
    if (!s || !s.frames || !s.frames.length) return;
    stopAnimation();
    pushHistory();
    current.frames = JSON.parse(JSON.stringify(s.frames));
    frameIdx = 0; selectedId = null; aim = null;
    draw(); renderTimeline();
    UI.toast(T('play.loaded') + ': ' + s.name, 'success');
    if (play !== false) playAnimation();
  }
  // Store the current frame sequence under a title so it can be replayed later.
  // Recording the clip means playing the animation through once first, so the
  // dialog closes up front and the save finishes when the pass is done.
  function saveAnimation() {
    const canRec = !!(window.MediaRecorder && canvas.captureStream);
    UI.modal({
      title: T('tactics.saveAnim'),
      body: `<label class="field"><span>${T('tactics.animTitle')}</span><input id="anim_name" maxlength="60" value="${UI.esc(current.name || '')}" placeholder="${UI.esc(T('tactics.animTitlePh'))}"></label>
        ${canRec ? `<label class="check-row"><input type="checkbox" id="anim_vid" checked><span>${T('tactics.animVideo')}</span></label>` : ''}
        <p class="hint">${current.frames.length} ${T('tactics.frameList')} · ${T('tactics.animHint')}</p>`,
      footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button><button class="btn primary" data-save>${T('common.save')}</button>`,
      onOpen: (m, close) => {
        const inp = m.querySelector('#anim_name');
        inp.focus(); inp.select();
        const commit = async () => {
          const name = inp.value.trim();
          if (!name) return UI.toast(T('tactics.animNeedTitle'), 'error');
          const wantVideo = canRec && m.querySelector('#anim_vid').checked;
          const rec = { kind: 'system', name, sport: sportId, courtMode, frames: JSON.parse(JSON.stringify(current.frames)) };
          close();
          if (wantVideo) {
            UI.toast(T('tactics.animRecording'));
            const clips = await recordAnimation();
            if (clips.length) rec.clips = clips;
            else UI.toast(T('tactics.animVideoNone'), 'error');
          }
          await Store.save('tactics', rec);
          UI.toast(T('tactics.animSaved'), 'success'); renderPlaybook();
        };
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-save]').onclick = commit;
      }
    });
  }
  // Captures one full pass of the animation straight off the board canvas.
  // Several recorders share the one stream, so a single pass yields WebM and
  // MP4 wherever the browser can encode both.
  function recordAnimation() {
    return new Promise(resolve => {
      let stream;
      try { stream = canvas.captureStream(30); } catch (e) { return resolve([]); }
      const outs = [];
      const recs = [];
      let pending = 0, settled = false, guard = null;
      const done = () => { if (settled) return; settled = true; clearTimeout(guard); resolve(outs.filter(o => o.blob && o.blob.size)); };
      const finish = () => { if (--pending <= 0) done(); };
      const halt = () => {
        let live = false;
        recs.forEach(r => { if (r.state !== 'inactive') { live = true; try { r.stop(); } catch (e) {} } });
        if (!live) done();
      };
      pickRecFormats().forEach(f => {
        let r;
        try { r = f.mime ? new MediaRecorder(stream, { mimeType: f.mime }) : new MediaRecorder(stream); } catch (e) { return; }
        const out = { ext: f.ext, blob: null };
        const chunks = [];
        r.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
        r.onstop = () => { out.blob = new Blob(chunks, { type: r.mimeType || 'video/' + f.ext }); finish(); };
        // A dead container must not hold back the one that worked.
        r.onerror = () => { chunks.length = 0; finish(); };
        try { r.start(); } catch (e) { return; }
        outs.push(out); recs.push(r); pending++;
      });
      if (!pending) return resolve([]);
      // Never leave the save hanging if an encoder stalls.
      guard = setTimeout(halt, current.frames.length * 1400 + 5000);
      stopAnimation();
      frameIdx = 0;
      playAnimation(() => setTimeout(halt, 250));
    });
  }
  // Older records held a single `video` blob; newer ones carry every container.
  function systemClips(s) {
    if (!s) return [];
    if (Array.isArray(s.clips)) return s.clips.filter(c => c.blob && c.blob.size);
    return s.video && s.video.size ? [{ ext: s.videoExt || 'webm', blob: s.video }] : [];
  }
  function playSystemVideo(id) {
    const s = Store.find('tactics', id);
    const clips = systemClips(s);
    if (!clips.length) return;
    const base = (s.name || 'tactic').replace(/[^\w.-]+/g, '_') || 'tactic';
    const items = clips.map(c => ({ ext: c.ext, url: URL.createObjectURL(c.blob), file: base + '.' + c.ext }));
    // MP4 has the widest decoder support, so preview that when it exists.
    const show = items.find(i => i.ext === 'mp4') || items[0];
    UI.modal({
      title: UI.esc(s.name),
      width: 720,
      closeButtonOnly: true,
      body: `<video src="${show.url}" class="sys-video" controls autoplay loop muted playsinline></video>
        <p class="hint sys-video-err hidden">${T('tactics.animVideoPlayFail')}</p>`,
      footer: items.map((i, n) => `<button class="btn" data-dl="${n}">⬇ ${i.ext.toUpperCase()}</button>`).join(''),
      onOpen: m => {
        const v = m.querySelector('.sys-video');
        // Some engines can encode a container but not decode it back.
        v.onerror = () => { v.classList.add('hidden'); m.querySelector('.sys-video-err').classList.remove('hidden'); };
        m.querySelectorAll('[data-dl]').forEach(b => b.onclick = () => {
          const i = items[+b.dataset.dl];
          const a = document.createElement('a'); a.href = i.url; a.download = i.file; a.click();
          UI.toast(T('tactics.recExported') + ' ' + i.file, 'success');
        });
      }
    });
    setTimeout(() => items.forEach(i => URL.revokeObjectURL(i.url)), 600000);
  }
  const saveAnimBtn = mount.querySelector('#saveAnim');
  if (saveAnimBtn) saveAnimBtn.onclick = saveAnimation;
  bindAnimActions();

  setupBotMode();
  renderPlaybook();
  renderTools();
  renderProps();
  updateCourtModeUI();
  updateUndoButtons();
  updateSpeedButtons();
  fitCanvas();
  draw(); renderTimeline();
  return () => {
    if (animTimer) clearInterval(animTimer);
    if (animStep) clearInterval(animStep);
    if (physTimer) clearInterval(physTimer);
    if (chargeTimer) clearInterval(chargeTimer);
    if (holdTimer) clearTimeout(holdTimer);
    if (saveTimer) clearTimeout(saveTimer);
    Sfx.stopAll();
    if (autoRec) { if (autoRec.rec && autoRec.rec.state !== 'inactive') { try { autoRec.rec.stop(); } catch (e) {} } clearInterval(recTimer); }
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('fullscreenchange', onFsChange);
    window.removeEventListener('resize', roResize);
  };
};

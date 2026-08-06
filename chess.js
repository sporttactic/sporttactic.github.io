/* chess.js — self-contained chess engine + training bot with 100 Kasparov levels.
   Exposes window.ChessBot with:
     .engine   — pure rules/AI (newGame, legalMoves, makeMove, inCheck, bestMove…)
     .open(level) — opens an interactive "play the bot" modal (chess sport).
   No dependencies beyond the global T() translator and UI (both optional). */
window.ChessBot = (() => {
  'use strict';

  // ---------------------------------------------------------------- engine ----
  const START = [
    ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'],
    ['p', 'p', 'p', 'p', 'p', 'p', 'p', 'p'],
    ['', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', ''],
    ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'],
    ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R']
  ];
  const isW = p => !!p && p === p.toUpperCase();
  const colorOf = p => p ? (isW(p) ? 'w' : 'b') : null;
  const clone2 = b => b.map(r => r.slice());
  const inB = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;

  function newGame() {
    return { board: clone2(START), turn: 'w', castling: { wK: true, wQ: true, bK: true, bQ: true }, ep: null, halfmove: 0, fullmove: 1 };
  }

  // Is square (r,c) attacked by side `by`?
  function attacked(board, r, c, by) {
    for (const dc of [-1, 1]) { // pawns
      const pr = r + (by === 'w' ? 1 : -1), pc = c + dc;
      if (inB(pr, pc)) { const p = board[pr][pc]; if (p && colorOf(p) === by && p.toLowerCase() === 'p') return true; }
    }
    const kn = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
    for (const [dr, dc] of kn) { const pr = r + dr, pc = c + dc; if (inB(pr, pc)) { const p = board[pr][pc]; if (p && colorOf(p) === by && p.toLowerCase() === 'n') return true; } }
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue; const pr = r + dr, pc = c + dc;
      if (inB(pr, pc)) { const p = board[pr][pc]; if (p && colorOf(p) === by && p.toLowerCase() === 'k') return true; }
    }
    for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) { // bishop/queen
      let pr = r + dr, pc = c + dc;
      while (inB(pr, pc)) { const p = board[pr][pc]; if (p) { if (colorOf(p) === by && (p.toLowerCase() === 'b' || p.toLowerCase() === 'q')) return true; break; } pr += dr; pc += dc; }
    }
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) { // rook/queen
      let pr = r + dr, pc = c + dc;
      while (inB(pr, pc)) { const p = board[pr][pc]; if (p) { if (colorOf(p) === by && (p.toLowerCase() === 'r' || p.toLowerCase() === 'q')) return true; break; } pr += dr; pc += dc; }
    }
    return false;
  }

  function findKing(board, color) {
    const k = color === 'w' ? 'K' : 'k';
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (board[r][c] === k) return [r, c];
    return null;
  }
  function inCheck(state, color) {
    const k = findKing(state.board, color);
    return k ? attacked(state.board, k[0], k[1], color === 'w' ? 'b' : 'w') : false;
  }

  function pseudoMoves(state) {
    const { board, turn, ep, castling } = state, moves = [];
    const add = (fr, fc, tr, tc, flag, promo) => moves.push({ from: [fr, fc], to: [tr, tc], flag: flag || 'normal', promo: promo || null, piece: board[fr][fc], capture: board[tr][tc] || null });
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = board[r][c]; if (!p || colorOf(p) !== turn) continue;
      const t = p.toLowerCase();
      if (t === 'p') {
        const dir = turn === 'w' ? -1 : 1, startRow = turn === 'w' ? 6 : 1, promoRow = turn === 'w' ? 0 : 7;
        if (inB(r + dir, c) && !board[r + dir][c]) {
          if (r + dir === promoRow) { for (const pr of ['q', 'r', 'b', 'n']) add(r, c, r + dir, c, 'promo', pr); }
          else add(r, c, r + dir, c, 'normal');
          if (r === startRow && !board[r + 2 * dir][c]) add(r, c, r + 2 * dir, c, '2pawn');
        }
        for (const dc of [-1, 1]) {
          const tr = r + dir, tc = c + dc; if (!inB(tr, tc)) continue;
          const target = board[tr][tc];
          if (target && colorOf(target) !== turn) { if (tr === promoRow) { for (const pr of ['q', 'r', 'b', 'n']) add(r, c, tr, tc, 'promo', pr); } else add(r, c, tr, tc, 'normal'); }
          else if (ep && ep[0] === tr && ep[1] === tc) add(r, c, tr, tc, 'ep');
        }
      } else if (t === 'n') {
        for (const [dr, dc] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]) { const tr = r + dr, tc = c + dc; if (inB(tr, tc) && colorOf(board[tr][tc]) !== turn) add(r, c, tr, tc, 'normal'); }
      } else if (t === 'k') {
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { if (!dr && !dc) continue; const tr = r + dr, tc = c + dc; if (inB(tr, tc) && colorOf(board[tr][tc]) !== turn) add(r, c, tr, tc, 'normal'); }
        const rr = turn === 'w' ? 7 : 0, opp = turn === 'w' ? 'b' : 'w';
        if (r === rr && c === 4) {
          const kSide = turn === 'w' ? castling.wK : castling.bK, qSide = turn === 'w' ? castling.wQ : castling.bQ;
          if (kSide && !board[rr][5] && !board[rr][6] && board[rr][7] === (turn === 'w' ? 'R' : 'r') && !attacked(board, rr, 4, opp) && !attacked(board, rr, 5, opp) && !attacked(board, rr, 6, opp)) add(rr, 4, rr, 6, 'castleK');
          if (qSide && !board[rr][3] && !board[rr][2] && !board[rr][1] && board[rr][0] === (turn === 'w' ? 'R' : 'r') && !attacked(board, rr, 4, opp) && !attacked(board, rr, 3, opp) && !attacked(board, rr, 2, opp)) add(rr, 4, rr, 2, 'castleQ');
        }
      } else {
        let dirs;
        if (t === 'b') dirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
        else if (t === 'r') dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        else dirs = [[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]];
        for (const [dr, dc] of dirs) { let tr = r + dr, tc = c + dc; while (inB(tr, tc)) { const tp = board[tr][tc]; if (!tp) add(r, c, tr, tc, 'normal'); else { if (colorOf(tp) !== turn) add(r, c, tr, tc, 'normal'); break; } tr += dr; tc += dc; } }
      }
    }
    return moves;
  }

  function makeMove(state, m) {
    const s = { board: clone2(state.board), turn: state.turn === 'w' ? 'b' : 'w', castling: { ...state.castling }, ep: null, halfmove: state.halfmove + 1, fullmove: state.fullmove + (state.turn === 'b' ? 1 : 0) };
    const b = s.board, [fr, fc] = m.from, [tr, tc] = m.to, p = b[fr][fc], white = isW(p);
    b[tr][tc] = p; b[fr][fc] = '';
    if (m.capture || p.toLowerCase() === 'p') s.halfmove = 0;
    if (m.flag === 'ep') b[fr][tc] = '';
    if (m.flag === '2pawn') s.ep = [(fr + tr) / 2, fc];
    if (m.flag === 'promo') b[tr][tc] = white ? m.promo.toUpperCase() : m.promo;
    if (m.flag === 'castleK') { b[tr][5] = b[tr][7]; b[tr][7] = ''; }
    if (m.flag === 'castleQ') { b[tr][3] = b[tr][0]; b[tr][0] = ''; }
    if (p === 'K') { s.castling.wK = s.castling.wQ = false; }
    if (p === 'k') { s.castling.bK = s.castling.bQ = false; }
    if (fr === 7 && fc === 0) s.castling.wQ = false; if (fr === 7 && fc === 7) s.castling.wK = false;
    if (fr === 0 && fc === 0) s.castling.bQ = false; if (fr === 0 && fc === 7) s.castling.bK = false;
    if (tr === 7 && tc === 0) s.castling.wQ = false; if (tr === 7 && tc === 7) s.castling.wK = false;
    if (tr === 0 && tc === 0) s.castling.bQ = false; if (tr === 0 && tc === 7) s.castling.bK = false;
    return s;
  }

  function legalMoves(state) {
    const out = [];
    for (const m of pseudoMoves(state)) { if (!inCheck(makeMove(state, m), state.turn)) out.push(m); }
    return out;
  }
  function status(state) {
    const legal = legalMoves(state), chk = inCheck(state, state.turn);
    if (!legal.length) return chk ? 'checkmate' : 'stalemate';
    if (state.halfmove >= 100) return 'draw50';
    return chk ? 'check' : 'normal';
  }

  // ---------------------------------------------------------- evaluation ------
  const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
  const PST = {
    p: [[0, 0, 0, 0, 0, 0, 0, 0], [50, 50, 50, 50, 50, 50, 50, 50], [10, 10, 20, 30, 30, 20, 10, 10], [5, 5, 10, 25, 25, 10, 5, 5], [0, 0, 0, 20, 20, 0, 0, 0], [5, -5, -10, 0, 0, -10, -5, 5], [5, 10, 10, -20, -20, 10, 10, 5], [0, 0, 0, 0, 0, 0, 0, 0]],
    n: [[-50, -40, -30, -30, -30, -30, -40, -50], [-40, -20, 0, 0, 0, 0, -20, -40], [-30, 0, 10, 15, 15, 10, 0, -30], [-30, 5, 15, 20, 20, 15, 5, -30], [-30, 0, 15, 20, 20, 15, 0, -30], [-30, 5, 10, 15, 15, 10, 5, -30], [-40, -20, 0, 5, 5, 0, -20, -40], [-50, -40, -30, -30, -30, -30, -40, -50]],
    b: [[-20, -10, -10, -10, -10, -10, -10, -20], [-10, 0, 0, 0, 0, 0, 0, -10], [-10, 0, 5, 10, 10, 5, 0, -10], [-10, 5, 5, 10, 10, 5, 5, -10], [-10, 0, 10, 10, 10, 10, 0, -10], [-10, 10, 10, 10, 10, 10, 10, -10], [-10, 5, 0, 0, 0, 0, 5, -10], [-20, -10, -10, -10, -10, -10, -10, -20]],
    r: [[0, 0, 0, 0, 0, 0, 0, 0], [5, 10, 10, 10, 10, 10, 10, 5], [-5, 0, 0, 0, 0, 0, 0, -5], [-5, 0, 0, 0, 0, 0, 0, -5], [-5, 0, 0, 0, 0, 0, 0, -5], [-5, 0, 0, 0, 0, 0, 0, -5], [-5, 0, 0, 0, 0, 0, 0, -5], [0, 0, 0, 5, 5, 0, 0, 0]],
    q: [[-20, -10, -10, -5, -5, -10, -10, -20], [-10, 0, 0, 0, 0, 0, 0, -10], [-10, 0, 5, 5, 5, 5, 0, -10], [-5, 0, 5, 5, 5, 5, 0, -5], [0, 0, 5, 5, 5, 5, 0, -5], [-10, 5, 5, 5, 5, 5, 0, -10], [-10, 0, 5, 0, 0, 0, 0, -10], [-20, -10, -10, -5, -5, -10, -10, -20]],
    k: [[-30, -40, -40, -50, -50, -40, -40, -30], [-30, -40, -40, -50, -50, -40, -40, -30], [-30, -40, -40, -50, -50, -40, -40, -30], [-30, -40, -40, -50, -50, -40, -40, -30], [-20, -30, -30, -40, -40, -30, -30, -20], [-10, -20, -20, -20, -20, -20, -20, -10], [20, 20, 0, 0, 0, 0, 20, 20], [20, 30, 10, 0, 0, 10, 30, 20]]
  };
  function evaluate(board) {
    let score = 0;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = board[r][c]; if (!p) continue;
      const t = p.toLowerCase(), w = isW(p), pst = PST[t];
      score += (w ? 1 : -1) * (VAL[t] + (pst ? (w ? pst[r][c] : pst[7 - r][c]) : 0));
    }
    return score; // + favours White
  }

  // negamax + alpha-beta (side-to-move perspective)
  function search(state, depth, alpha, beta) {
    if (depth === 0) return evaluate(state.board) * (state.turn === 'w' ? 1 : -1);
    const moves = legalMoves(state);
    if (!moves.length) return inCheck(state, state.turn) ? -100000 - depth * 1000 : 0;
    moves.sort((a, b) => (VAL[(b.capture || 'x').toLowerCase()] || 0) - (VAL[(a.capture || 'x').toLowerCase()] || 0));
    let best = -Infinity;
    for (const m of moves) {
      const sc = -search(makeMove(state, m), depth - 1, -beta, -alpha);
      if (sc > best) best = sc;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  // Difficulty scaling across the 100 Kasparov training levels.
  function levelParams(level) {
    level = Math.max(1, Math.min(100, level | 0));
    const depth = level < 20 ? 1 : level < 60 ? 2 : 3;
    const blunder = Math.max(0, 0.55 - level * 0.006);  // ~0.54 → 0
    const tol = Math.max(0, 70 - level * 0.7);           // spread of "acceptable" moves
    return { depth, blunder, tol };
  }
  function bestMove(state, level) {
    const moves = legalMoves(state);
    if (!moves.length) return null;
    const { depth, blunder, tol } = levelParams(level);
    const scored = moves.map(m => ({ m, sc: -search(makeMove(state, m), depth - 1, -Infinity, Infinity) }));
    scored.sort((a, b) => b.sc - a.sc);
    if (Math.random() < blunder) {                       // deliberate weaker move
      const idx = Math.min(scored.length - 1, Math.floor(scored.length * (0.35 + Math.random() * 0.65)));
      return scored[idx].m;
    }
    const top = scored.filter(x => x.sc >= scored[0].sc - tol);
    return top[Math.floor(Math.random() * top.length)].m;
  }

  const engine = { newGame, legalMoves, makeMove, inCheck, status, evaluate, bestMove, levelParams, colorOf, isW };

  // --------------------------------------------------------------- levels -----
  function levelTier(n) {
    const tiers = [
      [10, 'Pawn Pusher', 'Bondeskubber'], [20, 'Novice', 'Nybegynder'], [35, 'Amateur', 'Amatør'],
      [50, 'Club Player', 'Klubspiller'], [65, 'Expert', 'Ekspert'], [78, 'Candidate Master', 'Kandidatmester'],
      [88, 'Master', 'Mester'], [95, 'Grandmaster', 'Stormester'], [99, 'Super-GM', 'Super-GM'], [100, 'World Champion', 'Verdensmester']
    ];
    const da = (window.I18N && I18N.getLang && I18N.getLang() === 'da');
    for (const [max, en, dk] of tiers) if (n <= max) return da ? dk : en;
    return da ? 'Verdensmester' : 'World Champion';
  }
  function levelName(n) { return 'Kasparov ' + (window.T ? T('chess.level') : 'Level') + ' ' + n + ' · ' + levelTier(n); }

  // ------------------------------------------------------------------- UI -----
  const GLY = { k: '\u265A', q: '\u265B', r: '\u265C', b: '\u265D', n: '\u265E', p: '\u265F' };
  const tr = (k, fb) => (window.T ? (T(k) === k ? fb : T(k)) : fb);
  const files = 'abcdefgh';
  const sqName = (r, c) => files[c] + (8 - r);

  function open(startLevel) {
    let state = newGame();
    let level = Math.max(1, Math.min(100, (startLevel | 0) || 20));
    let human = 'w', flipped = false, sel = null, targets = [], last = null, hist = [], busy = false, over = false, hint = null;
    let boardEl, statusEl, logEl, capEl, levelLbl, levelNameEl;

    const body = `
      <div class="cb-wrap">
        <div class="cb-main">
          <div class="cb-status" id="cbStatus"></div>
          <div class="cb-board" id="cbBoard"></div>
          <div class="cb-captured" id="cbCap"></div>
        </div>
        <div class="cb-side">
          <div class="cb-levelbox">
            <div class="cb-lvline">${tr('chess.level', 'Level')}: <b id="cbLvl">${level}</b></div>
            <input type="range" id="cbRange" min="1" max="100" value="${level}">
            <div class="cb-lvname" id="cbLvlName"></div>
          </div>
          <div class="cb-btns">
            <button class="btn sm primary" id="cbNew">${tr('chess.newGame', 'New Game')}</button>
            <button class="btn sm" id="cbUndo">${tr('chess.undo', 'Undo')}</button>
            <button class="btn sm" id="cbHint">${tr('chess.hint', 'Hint')}</button>
            <button class="btn sm" id="cbFlip">${tr('chess.flip', 'Flip')}</button>
            <button class="btn sm" id="cbSide">${tr('chess.playWhite', 'Play White')}</button>
          </div>
          <div class="cb-log" id="cbLog"></div>
        </div>
      </div>`;

    const modal = (window.UI && UI.modal) ? UI.modal({ title: tr('chess.title', 'Play the Kasparov Bot'), body, width: 640, fullscreen: true, onOpen: init }) : fallbackModal();

    function fallbackModal() {
      const host = document.getElementById('modalHost') || document.body;
      const wrap = document.createElement('div'); wrap.className = 'modal'; wrap.innerHTML = `<div class="modal-head"><h2>${tr('chess.title', 'Play the Kasparov Bot')}</h2><button class="icon-btn" data-x>✕</button></div><div class="modal-body">${body}</div>`;
      host.classList.remove('hidden'); host.appendChild(wrap);
      const close = () => { wrap.remove(); host.classList.add('hidden'); };
      wrap.querySelector('[data-x]').onclick = close;
      init(wrap, close); return { root: wrap, close };
    }

    function init(m) {
      boardEl = m.querySelector('#cbBoard'); statusEl = m.querySelector('#cbStatus');
      logEl = m.querySelector('#cbLog'); capEl = m.querySelector('#cbCap');
      levelLbl = m.querySelector('#cbLvl'); levelNameEl = m.querySelector('#cbLvlName');
      const range = m.querySelector('#cbRange');
      range.oninput = () => { level = +range.value; levelLbl.textContent = level; levelNameEl.textContent = levelTier(level); try { localStorage.setItem('chessLevel', level); } catch (e) { } };
      m.querySelector('#cbNew').onclick = newMatch;
      m.querySelector('#cbUndo').onclick = undo;
      m.querySelector('#cbHint').onclick = showHint;
      m.querySelector('#cbFlip').onclick = () => { flipped = !flipped; render(); };
      m.querySelector('#cbSide').onclick = (e) => { human = human === 'w' ? 'b' : 'w'; e.target.textContent = human === 'w' ? tr('chess.playWhite', 'Play White') : tr('chess.playBlack', 'Play Black'); newMatch(); };
      levelNameEl.textContent = levelTier(level);
      newMatch();
    }

    function newMatch() {
      state = newGame(); sel = null; targets = []; last = null; hist = []; over = false; hint = null;
      flipped = human === 'b';
      if (logEl) logEl.innerHTML = '';
      render();
      if (state.turn !== human) botMove();
    }
    function undo() {
      if (busy || !hist.length) return;
      let popped = 0;
      state = hist.pop(); popped++;
      if (state.turn !== human && hist.length) { state = hist.pop(); popped++; }
      if (logEl) for (let i = 0; i < popped; i++) { if (logEl.lastChild) logEl.removeChild(logEl.lastChild); }
      sel = null; targets = []; over = false; hint = null; last = null; render();
    }
    function showHint() {
      if (busy || over || state.turn !== human) return;
      const m = bestMove(state, 100); if (!m) return;
      hint = { from: m.from, to: m.to }; render();
      setTimeout(() => { hint = null; render(); }, 1400);
    }

    function cellClick(r, c) {
      if (busy || over || state.turn !== human) return;
      const piece = state.board[r][c];
      if (sel && targets.some(t => t[0] === r && t[1] === c)) {
        const legal = legalMoves(state).filter(mv => mv.from[0] === sel[0] && mv.from[1] === sel[1] && mv.to[0] === r && mv.to[1] === c);
        const mv = legal.find(x => x.promo === 'q') || legal[0];
        applyMove(mv);
        sel = null; targets = [];
        if (!over && state.turn !== human) botMove();
        return;
      }
      if (piece && colorOf(piece) === human && colorOf(piece) === state.turn) {
        sel = [r, c];
        targets = legalMoves(state).filter(mv => mv.from[0] === r && mv.from[1] === c).map(mv => mv.to);
      } else { sel = null; targets = []; }
      render();
    }

    function applyMove(mv) {
      hist.push(cloneState(state));
      last = { from: mv.from, to: mv.to };
      state = makeMove(state, mv);
      logMove(mv);
      render();
      checkEnd();
    }
    function botMove() {
      if (over) return;
      busy = true; setStatus(tr('chess.thinking', 'Bot is thinking…'), 'think');
      setTimeout(() => {
        const mv = bestMove(state, level);
        busy = false;
        if (!mv) { checkEnd(); return; }
        applyMove(mv);
      }, 220);
    }

    function checkEnd() {
      const st = status(state);
      if (st === 'checkmate') { over = true; setStatus(state.turn === human ? tr('chess.youLose', 'Checkmate — you lose') : tr('chess.youWin', 'Checkmate — you win!'), state.turn === human ? 'lose' : 'win'); }
      else if (st === 'stalemate') { over = true; setStatus(tr('chess.stalemate', 'Stalemate — draw'), 'draw'); }
      else if (st === 'draw50') { over = true; setStatus(tr('chess.draw', 'Draw (50-move rule)'), 'draw'); }
      else setStatus(null);
    }

    function cloneState(s) { return { board: clone2(s.board), turn: s.turn, castling: { ...s.castling }, ep: s.ep ? s.ep.slice() : null, halfmove: s.halfmove, fullmove: s.fullmove }; }

    function logMove(mv) {
      const p = mv.piece.toLowerCase();
      const pieceSym = p === 'p' ? '' : mv.piece.toUpperCase();
      let txt = mv.flag === 'castleK' ? 'O-O' : mv.flag === 'castleQ' ? 'O-O-O' : pieceSym + (mv.capture || mv.flag === 'ep' ? (p === 'p' ? files[mv.from[1]] : '') + 'x' : '') + sqName(mv.to[0], mv.to[1]) + (mv.promo ? '=' + mv.promo.toUpperCase() : '');
      const who = colorOf(mv.piece) === 'w' ? 'w' : 'b';
      const row = document.createElement('div'); row.className = 'cb-move ' + who; row.textContent = txt;
      if (logEl) { logEl.appendChild(row); logEl.scrollTop = logEl.scrollHeight; }
    }

    function setStatus(msg, cls) {
      if (!statusEl) return;
      if (msg == null) {
        const chk = inCheck(state, state.turn);
        msg = (state.turn === human ? tr('chess.yourMove', 'Your move') : tr('chess.botMove', "Bot's move")) + (chk ? ' · ' + tr('chess.check', 'Check!') : '');
        cls = chk ? 'check' : '';
      }
      statusEl.textContent = msg;
      statusEl.className = 'cb-status ' + (cls || '');
    }

    function render() {
      if (!boardEl) return;
      let html = '';
      const rows = flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
      const cols = flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
      for (const r of rows) for (const c of cols) {
        const p = state.board[r][c];
        const dark = (r + c) % 2 === 1;
        const isSel = sel && sel[0] === r && sel[1] === c;
        const isTgt = targets.some(t => t[0] === r && t[1] === c);
        const isLast = last && ((last.from[0] === r && last.from[1] === c) || (last.to[0] === r && last.to[1] === c));
        const isHint = hint && ((hint.from[0] === r && hint.from[1] === c) || (hint.to[0] === r && hint.to[1] === c));
        const cls = ['cb-sq', dark ? 'dark' : 'light'];
        if (isSel) cls.push('sel'); if (isLast) cls.push('last'); if (isHint) cls.push('hint');
        if (isTgt) cls.push(p ? 'capture' : 'move');
        const glyph = p ? `<span class="cb-pc ${isW(p) ? 'w' : 'b'}">${GLY[p.toLowerCase()]}</span>` : '';
        html += `<div class="${cls.join(' ')}" data-r="${r}" data-c="${c}">${glyph}</div>`;
      }
      boardEl.innerHTML = html;
      boardEl.querySelectorAll('.cb-sq').forEach(sq => sq.onclick = () => cellClick(+sq.dataset.r, +sq.dataset.c));
      renderCaptured();
      if (!over) setStatus(null);
    }
    function renderCaptured() {
      if (!capEl) return;
      const count = {}; for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) { const p = state.board[r][c]; if (p) count[p] = (count[p] || 0) + 1; }
      const START_COUNT = { P: 8, N: 2, B: 2, R: 2, Q: 1, K: 1, p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };
      let wLost = '', bLost = '', wScore = 0, bScore = 0;
      for (const pc of ['q', 'r', 'b', 'n', 'p']) {
        const wm = START_COUNT[pc.toUpperCase()] - (count[pc.toUpperCase()] || 0);
        const bm = START_COUNT[pc] - (count[pc] || 0);
        for (let i = 0; i < wm; i++) { bLost += `<span class="cb-pc w">${GLY[pc]}</span>`; bScore += VAL[pc]; }
        for (let i = 0; i < bm; i++) { wLost += `<span class="cb-pc b">${GLY[pc]}</span>`; wScore += VAL[pc]; }
      }
      const diff = Math.round((bScore - wScore) / 100);
      const edge = diff > 0 ? ` <b>+${diff}</b>` : '';
      const edge2 = diff < 0 ? ` <b>+${-diff}</b>` : '';
      capEl.innerHTML = `<div class="cb-caprow">${wLost}${edge}</div><div class="cb-caprow">${bLost}${edge2}</div>`;
    }

    return modal;
  }

  return { engine, open, levelName, levelTier, newGame, legalMoves, makeMove, bestMove, status, inCheck };
})();

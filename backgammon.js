/* backgammon.js — backgammon engine + training bot with 100 levels.
   window.BackgammonBot.open(level) launches an interactive game vs the bot.
   Human = White (moves 24→1, home 1-6). Bot = Black (moves 1→24, home 19-24). */
window.BackgammonBot = (() => {
  'use strict';

  function newGame() {
    const points = new Array(25).fill(0); // 1..24 used; + = white, - = black
    points[24] = 2; points[13] = 5; points[8] = 3; points[6] = 5;   // white
    points[1] = -2; points[12] = -5; points[17] = -3; points[19] = -5; // black
    return { points, bar: { w: 0, b: 0 }, off: { w: 0, b: 0 }, turn: 'w' };
  }
  function clone(s) { return { points: s.points.slice(), bar: { ...s.bar }, off: { ...s.off }, turn: s.turn }; }
  const sign = c => c === 'w' ? 1 : -1;
  const opp = c => c === 'w' ? 'b' : 'w';

  function allHome(s, c) {
    if (s.bar[c] > 0) return false;
    if (c === 'w') { for (let p = 7; p <= 24; p++) if (s.points[p] > 0) return false; }
    else { for (let p = 1; p <= 18; p++) if (s.points[p] < 0) return false; }
    return true;
  }
  function canLand(s, c, to) { return sign(c) * s.points[to] >= -1; }
  function noneHigher(s, c, p) {
    if (c === 'w') { for (let q = p + 1; q <= 6; q++) if (s.points[q] > 0) return false; }
    else { for (let q = 19; q < p; q++) if (s.points[q] < 0) return false; }
    return true;
  }
  // Single-die moves for the side to move.
  function singleMoves(s, c, die) {
    const moves = [], sg = sign(c), dir = c === 'w' ? -1 : 1;
    if (s.bar[c] > 0) {
      const entry = c === 'w' ? 25 - die : die;
      if (canLand(s, c, entry)) moves.push({ from: 'bar', to: entry, die });
      return moves;
    }
    for (let p = 1; p <= 24; p++) {
      if (sg * s.points[p] <= 0) continue;
      const to = p + dir * die;
      if (to >= 1 && to <= 24) { if (canLand(s, c, to)) moves.push({ from: p, to, die }); }
      else if (allHome(s, c)) {
        const need = c === 'w' ? p : 25 - p;
        if (die === need || (die > need && noneHigher(s, c, p))) moves.push({ from: p, to: 'off', die });
      }
    }
    return moves;
  }
  function applySingle(s, c, mv) {
    const s2 = clone(s), sg = sign(c), o = opp(c);
    if (mv.from === 'bar') s2.bar[c]--; else s2.points[mv.from] -= sg;
    if (mv.to === 'off') s2.off[c]++;
    else {
      if (sg * s2.points[mv.to] < 0) { s2.bar[o] += Math.abs(s2.points[mv.to]); s2.points[mv.to] = 0; }
      s2.points[mv.to] += sg;
    }
    return s2;
  }
  function diceOf(d1, d2) { return d1 === d2 ? [d1, d1, d1, d1] : [d1, d2]; }

  // All end-states using the maximum number of dice (bot search + rules).
  function sequences(s, c, dice) {
    let best = [], bestLen = -1;
    function dfs(st, rem, path) {
      let any = false; const tried = new Set();
      for (let i = 0; i < rem.length; i++) {
        const d = rem[i]; if (tried.has(d)) continue; tried.add(d);
        for (const m of singleMoves(st, c, d)) {
          any = true;
          const r = rem.slice(); r.splice(i, 1);
          dfs(applySingle(st, c, m), r, path.concat([m]));
        }
      }
      if (!any) {
        if (path.length > bestLen) { bestLen = path.length; best = [{ state: st, moves: path }]; }
        else if (path.length === bestLen) best.push({ state: st, moves: path });
      }
    }
    dfs(s, dice.slice(), []);
    if (bestLen <= 0) return [{ state: s, moves: [] }];
    return best;
  }

  function whitePip(s) { let n = s.bar.w * 25; for (let p = 1; p <= 24; p++) if (s.points[p] > 0) n += s.points[p] * p; return n; }
  function blackPip(s) { let n = s.bar.b * 25; for (let p = 1; p <= 24; p++) if (s.points[p] < 0) n += -s.points[p] * (25 - p); return n; }

  function evaluate(s) {
    let score = (blackPip(s) - whitePip(s));
    score -= s.bar.w * 24; score += s.bar.b * 24;
    score += s.off.w * 18; score -= s.off.b * 18;
    for (let p = 1; p <= 6; p++) if (s.points[p] >= 2) score += 5;
    for (let p = 19; p <= 24; p++) if (s.points[p] <= -2) score -= 5;
    for (let p = 1; p <= 24; p++) {
      if (s.points[p] === 1) score -= (25 - p) * 0.4;      // white blot risk grows deep in enemy territory
      if (s.points[p] === -1) score += p * 0.4;
    }
    return score; // + favours white
  }

  function winner(s) {
    if (s.off.w === 15) return 'w';
    if (s.off.b === 15) return 'b';
    return null;
  }
  function winValue(s, w) { // 1 normal, 2 gammon, 3 backgammon
    const loser = opp(w);
    if (s.off[loser] > 0) return 1;
    if (loser === 'w') { if (s.bar.w > 0) return 3; for (let p = 19; p <= 24; p++) if (s.points[p] > 0) return 3; return 2; }
    else { if (s.bar.b > 0) return 3; for (let p = 1; p <= 6; p++) if (s.points[p] < 0) return 3; return 2; }
  }

  function levelParams(level) {
    level = Math.max(1, Math.min(100, level | 0));
    return { blunder: Math.max(0, 0.55 - level * 0.006), tol: Math.max(0, 40 - level * 0.4) };
  }
  // Bot picks a full dice sequence.
  function bestSequence(s, dice, level) {
    const c = s.turn, seqs = sequences(s, c, dice);
    if (seqs.length === 1) return seqs[0];
    const dir = c === 'w' ? 1 : -1;
    const scored = seqs.map(sq => ({ sq, sc: dir * evaluate(sq.state) }));
    scored.sort((a, b) => b.sc - a.sc);
    const { blunder, tol } = levelParams(level);
    if (Math.random() < blunder) return scored[Math.min(scored.length - 1, Math.floor(scored.length * (0.4 + Math.random() * 0.6)))].sq;
    const top = scored.filter(x => x.sc >= scored[0].sc - tol);
    return top[Math.floor(Math.random() * top.length)].sq;
  }
  // Simple cube take decision (loser's pip disadvantage).
  function shouldTake(s, doublee) {
    const wp = whitePip(s), bp = blackPip(s);
    const behind = doublee === 'w' ? wp - bp : bp - wp;
    return behind < Math.max(wp, bp) * 0.16; // take unless badly behind
  }
  function shouldDouble(s, doubler) {
    const wp = whitePip(s), bp = blackPip(s);
    const lead = doubler === 'w' ? bp - wp : wp - bp;
    return lead > Math.max(wp, bp) * 0.10 && lead < Math.max(wp, bp) * 0.16;
  }

  const engine = { newGame, clone, singleMoves, applySingle, sequences, bestSequence, evaluate, winner, winValue, whitePip, blackPip, diceOf, allHome, levelParams, shouldTake, shouldDouble };

  // ---------------------------------------------------------------- UI --------
  const tr = (k, fb) => (window.T ? (T(k) === k ? fb : T(k)) : fb);
  const tierName = n => {
    const t = [[15, 'Beginner', 'Begynder'], [35, 'Improver', 'Øvet'], [55, 'Intermediate', 'Mellem'], [75, 'Advanced', 'Avanceret'], [90, 'Expert', 'Ekspert'], [99, 'World Class', 'Verdensklasse'], [100, 'Champion', 'Mester']];
    const da = window.I18N && I18N.getLang && I18N.getLang() === 'da';
    for (const [m, en, dk] of t) if (n <= m) return da ? dk : en; return da ? 'Mester' : 'Champion';
  };

  function open(startLevel) {
    let s = newGame();
    let level = Math.max(1, Math.min(100, (startLevel | 0) || 20));
    let dice = [], remaining = [], sel = null, busy = false, over = false, msg = '';
    let cube = 1, cubeOwner = null, human = 'w', curTargets = null;
    let boardEl, diceEl, statusEl, rollBtn, dblBtn;

    const body = `
      <div class="bg-wrap">
        <div class="bg-status" id="bgStatus"></div>
        <div class="bg-board" id="bgBoard"></div>
        <div class="bg-bottom">
          <div class="bg-dice" id="bgDice"></div>
          <div class="bg-controls">
            <button class="btn sm primary" id="bgRoll">${tr('bg.roll', 'Roll Dice')}</button>
            <button class="btn sm" id="bgDouble">${tr('bg.double', 'Double')}</button>
            <button class="btn sm" id="bgNew">${tr('chess.newGame', 'New Game')}</button>
          </div>
          <div class="bg-level">
            <span>${tr('chess.level', 'Level')}: <b id="bgLvl">${level}</b> · <span id="bgTier"></span></span>
            <input type="range" id="bgRange" min="1" max="100" value="${level}">
          </div>
        </div>
      </div>`;

    const modal = (window.UI && UI.modal) ? UI.modal({ title: tr('bg.title', 'Play the Backgammon Bot'), body, width: 720, fullscreen: true, onOpen: init }) : null;

    function init(m) {
      boardEl = m.querySelector('#bgBoard'); diceEl = m.querySelector('#bgDice'); statusEl = m.querySelector('#bgStatus');
      rollBtn = m.querySelector('#bgRoll'); dblBtn = m.querySelector('#bgDouble');
      const range = m.querySelector('#bgRange'), lvl = m.querySelector('#bgLvl'), tier = m.querySelector('#bgTier');
      tier.textContent = tierName(level);
      range.oninput = () => { level = +range.value; lvl.textContent = level; tier.textContent = tierName(level); try { localStorage.setItem('bgLevel', level); } catch (e) { } };
      rollBtn.onclick = humanRoll;
      dblBtn.onclick = humanDouble;
      m.querySelector('#bgNew').onclick = newMatch;
      newMatch();
    }
    function newMatch() { s = newGame(); dice = []; remaining = []; sel = null; over = false; cube = 1; cubeOwner = null; msg = tr('bg.yourRoll', 'Your roll'); render(); }

    function setStatus() {
      if (statusEl) statusEl.textContent = msg + (cube > 1 ? '  ·  ' + tr('bg.cube', 'Cube') + ' ' + cube : '');
    }
    function humanRoll() {
      if (busy || over || s.turn !== human || remaining.length) return;
      const d1 = 1 + Math.floor(Math.random() * 6), d2 = 1 + Math.floor(Math.random() * 6);
      dice = diceOf(d1, d2); remaining = dice.slice();
      msg = tr('bg.youRolled', 'You rolled') + ' ' + d1 + '-' + d2;
      if (!hasAnyMove(human)) { msg += ' · ' + tr('bg.noMoves', 'no moves'); render(); setTimeout(endTurn, 900); return; }
      render();
    }
    function humanDouble() {
      if (busy || over || s.turn !== human || remaining.length || dice.length) return;
      if (cubeOwner === 'b') return;
      if (shouldTake(s, 'b')) { cube *= 2; cubeOwner = human; msg = tr('bg.botTakes', 'Bot takes the double'); }
      else { over = true; msg = tr('bg.botPass', 'Bot passes — you win!') ; }
      render();
    }
    function hasAnyMove(c) { return dice.some(d => singleMoves(s, c, d).length > 0) || remaining.some(d => singleMoves(s, c, d).length > 0); }

    function legalTargetsFrom(from) {
      const outs = {};
      for (const d of new Set(remaining)) for (const m of singleMoves(s, human, d)) if (m.from === from) outs[m.to] = d;
      return outs; // {to: die}
    }
    function clickPoint(from) {
      if (busy || over || s.turn !== human || !remaining.length) return;
      if (s.bar.w > 0 && from !== 'bar') { from = 'bar'; }
      if (sel === null) {
        const t = legalTargetsFrom(from);
        if (Object.keys(t).length) { sel = from; render(t); }
        return;
      }
      // sel set: is `from` a legal destination?
      const t = legalTargetsFrom(sel);
      if (t[from] != null) {
        const die = t[from];
        const mv = { from: sel, to: from, die };
        s = applySingle(s, human, mv);
        remaining.splice(remaining.indexOf(die), 1);
        sel = null;
        if (winner(s)) return finish();
        if (!remaining.length || !hasRemainingMove()) { render(); setTimeout(endTurn, 350); return; }
        render();
      } else { sel = null; const t2 = legalTargetsFrom(from); if (Object.keys(t2).length) { sel = from; render(t2); } else render(); }
    }
    function hasRemainingMove() { return remaining.some(d => singleMoves(s, human, d).length > 0); }

    function endTurn() {
      dice = []; remaining = []; sel = null;
      s.turn = opp(s.turn);
      if (s.turn === human) { msg = tr('bg.yourRoll', 'Your roll'); render(); }
      else botTurn();
    }
    function botTurn() {
      if (over) return;
      busy = true; msg = tr('bg.botThinking', 'Bot is rolling…'); render();
      setTimeout(() => {
        const d1 = 1 + Math.floor(Math.random() * 6), d2 = 1 + Math.floor(Math.random() * 6);
        dice = diceOf(d1, d2);
        msg = tr('bg.botRolled', 'Bot rolled') + ' ' + d1 + '-' + d2;
        const seq = bestSequence(s, dice, level);
        // apply the bot moves step by step
        let i = 0;
        const stepInts = seq.moves.length ? 480 : 0;
        render();
        const step = () => {
          if (i >= seq.moves.length) { busy = false; dice = []; if (winner(s)) return finish(); maybeBotDouble(); return; }
          s = applySingle(s, 'b', seq.moves[i]); i++; render();
          if (winner(s)) { busy = false; return finish(); }
          setTimeout(step, stepInts);
        };
        if (seq.moves.length) setTimeout(step, 500); else { busy = false; setTimeout(() => { s.turn = human; msg = tr('bg.yourRoll', 'Your roll'); render(); }, 700); }
      }, 350);
    }
    function maybeBotDouble() {
      if (cubeOwner !== 'w' && shouldDouble(s, 'b') && cube < 8) {
        if (shouldTake(s, human)) { cube *= 2; cubeOwner = 'b'; msg = tr('bg.botDoubles', 'Bot doubles — you take'); }
      }
      s.turn = human; msg = msg && s.turn === human ? tr('bg.yourRoll', 'Your roll') : msg;
      msg = tr('bg.yourRoll', 'Your roll'); render();
    }
    function finish() {
      over = true; busy = false;
      const w = winner(s); const val = winValue(s, w) * cube;
      const kind = winValue(s, w) === 3 ? tr('bg.backgammon', 'Backgammon') : winValue(s, w) === 2 ? tr('bg.gammon', 'Gammon') : '';
      msg = (w === human ? tr('bg.youWin', 'You win!') : tr('bg.youLose', 'Bot wins')) + (kind ? ' (' + kind + ')' : '') + ' · ' + val + ' ' + tr('bg.points', 'pts');
      dice = []; remaining = []; render();
    }

    // rendering
    function checkerStack(p) {
      const n = s.points[p]; if (!n) return '';
      const cls = n > 0 ? 'w' : 'b'; const cnt = Math.abs(n);
      let h = '';
      const show = Math.min(cnt, 5);
      for (let i = 0; i < show; i++) h += `<div class="bg-ck ${cls}"${i === show - 1 && cnt > 5 ? ' data-more="1"' : ''}>${i === show - 1 && cnt > 5 ? cnt : ''}</div>`;
      return h;
    }
    function pointHtml(p, top) {
      const sels = sel === p ? ' sel' : '';
      const tgt = curTargets && curTargets[p] != null ? ' tgt' : '';
      return `<div class="bg-pt ${top ? 'top' : 'bot'} ${(p % 2) ? 'odd' : 'even'}${sels}${tgt}" data-pt="${p}">${checkerStack(p)}</div>`;
    }
    function render(targets) {
      curTargets = targets || null;
      if (!boardEl) return;
      const topL = [13, 14, 15, 16, 17, 18], topR = [19, 20, 21, 22, 23, 24];
      const botL = [12, 11, 10, 9, 8, 7], botR = [6, 5, 4, 3, 2, 1];
      const barTop = s.bar.b, barBot = s.bar.w;
      const offTgt = curTargets && curTargets['off'] != null ? ' tgt' : '';
      boardEl.innerHTML = `
        <div class="bg-row top">
          <div class="bg-quad">${topL.map(p => pointHtml(p, true)).join('')}</div>
          <div class="bg-bar" data-pt="bar">${barTop ? `<div class="bg-ck b">${barTop > 1 ? barTop : ''}</div>` : ''}</div>
          <div class="bg-quad">${topR.map(p => pointHtml(p, true)).join('')}</div>
          <div class="bg-off${offTgt}" data-pt="off"><span>${tr('bg.off', 'Off')}</span><b>W ${s.off.w} · B ${s.off.b}</b></div>
        </div>
        <div class="bg-row bot">
          <div class="bg-quad">${botL.map(p => pointHtml(p, false)).join('')}</div>
          <div class="bg-bar" data-pt="bar">${barBot ? `<div class="bg-ck w">${barBot > 1 ? barBot : ''}</div>` : ''}</div>
          <div class="bg-quad">${botR.map(p => pointHtml(p, false)).join('')}</div>
          <div class="bg-offside"></div>
        </div>`;
      boardEl.querySelectorAll('[data-pt]').forEach(el => el.onclick = () => {
        const v = el.dataset.pt; clickPoint(v === 'bar' ? 'bar' : v === 'off' ? 'off' : +v);
      });
      renderDice();
      if (rollBtn) rollBtn.disabled = busy || over || s.turn !== human || remaining.length > 0;
      if (dblBtn) dblBtn.disabled = busy || over || s.turn !== human || remaining.length > 0 || dice.length > 0 || cubeOwner === 'b';
      setStatus();
    }
    function renderDice() {
      if (!diceEl) return;
      const list = dice.length ? dice : [];
      diceEl.innerHTML = list.map(d => {
        const used = remaining.indexOf(d) === -1 && s.turn === human;
        return `<span class="bg-die${used ? ' used' : ''}">${d}</span>`;
      }).join('') || `<span class="bg-die ghost">–</span><span class="bg-die ghost">–</span>`;
    }

    return modal;
  }

  return { engine, open, newGame, tierName };
})();

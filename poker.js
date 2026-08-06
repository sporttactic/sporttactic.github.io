/* poker.js — Texas Hold'em engine + training bot with 100 levels.
   window.PokerBot.open(level) launches a No-Limit Hold'em table (you + 2 bots).
   Hand evaluation + Monte-Carlo equity drive the bot decisions. */
window.PokerBot = (() => {
  'use strict';

  const SUITS = ['\u2660', '\u2665', '\u2666', '\u2663']; // spade heart diamond club
  const RANKS = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  function freshDeck(dead) {
    const used = new Set((dead || []).map(c => c.r + '_' + c.s));
    const d = [];
    for (let s = 0; s < 4; s++) for (let r = 2; r <= 14; r++) if (!used.has(r + '_' + s)) d.push({ r, s });
    return d;
  }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0;[a[i], a[j]] = [a[j], a[i]]; } return a; }

  // Best 5-of-7 evaluator → comparable array [category, ...tiebreaks].
  function straightHigh(rarr) {
    const u = [...new Set(rarr)].sort((a, b) => b - a);
    if (u.includes(14)) u.push(1);
    let run = 1;
    for (let i = 0; i < u.length - 1; i++) {
      if (u[i] - 1 === u[i + 1]) { run++; if (run >= 5) return u[i - 3]; }
      else run = 1;
    }
    return 0;
  }
  function evaluate7(cards) {
    const bySuit = { 0: [], 1: [], 2: [], 3: [] }, rc = {};
    for (const c of cards) { bySuit[c.s].push(c.r); rc[c.r] = (rc[c.r] || 0) + 1; }
    const allRanks = [...new Set(cards.map(c => c.r))].sort((a, b) => b - a);
    let sfHigh = 0;
    for (const s in bySuit) if (bySuit[s].length >= 5) { const h = straightHigh(bySuit[s]); if (h > sfHigh) sfHigh = h; }
    if (sfHigh) return [8, sfHigh];
    const groups = Object.entries(rc).map(([r, n]) => [+r, n]).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    if (groups[0][1] === 4) { const q = groups[0][0]; return [7, q, Math.max(...allRanks.filter(r => r !== q))]; }
    if (groups[0][1] === 3 && groups[1] && groups[1][1] >= 2) return [6, groups[0][0], groups[1][0]];
    for (const s in bySuit) if (bySuit[s].length >= 5) return [5, ...bySuit[s].slice().sort((a, b) => b - a).slice(0, 5)];
    const st = straightHigh(allRanks); if (st) return [4, st];
    if (groups[0][1] === 3) return [3, groups[0][0], ...allRanks.filter(r => r !== groups[0][0]).slice(0, 2)];
    if (groups[0][1] === 2 && groups[1] && groups[1][1] === 2) { const hp = groups[0][0], lp = groups[1][0]; return [2, hp, lp, Math.max(...allRanks.filter(r => r !== hp && r !== lp))]; }
    if (groups[0][1] === 2) return [1, groups[0][0], ...allRanks.filter(r => r !== groups[0][0]).slice(0, 3)];
    return [0, ...allRanks.slice(0, 5)];
  }
  function cmp(a, b) { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d; } return 0; }
  const HAND_NAMES = ['High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'];

  // Monte-Carlo equity of hole vs nOpp random hands given community.
  function equity(hole, community, nOpp, samples) {
    let score = 0;
    for (let i = 0; i < samples; i++) {
      const deck = shuffle(freshDeck(hole.concat(community)));
      let idx = 0; const comm = community.slice();
      while (comm.length < 5) comm.push(deck[idx++]);
      const mine = evaluate7(hole.concat(comm));
      let best = true, tie = false;
      for (let o = 0; o < nOpp; o++) {
        const oh = [deck[idx++], deck[idx++]];
        const c = cmp(evaluate7(oh.concat(comm)), mine);
        if (c > 0) { best = false; break; } else if (c === 0) tie = true;
      }
      if (best) score += tie ? 0.5 : 1;
    }
    return score / samples;
  }
  function levelParams(level) {
    level = Math.max(1, Math.min(100, level | 0));
    return {
      samples: Math.round(40 + level * 3.6),          // 44 → 400
      aggression: 0.3 + level * 0.004,                 // 0.3 → 0.7
      bluff: Math.max(0.02, 0.28 - level * 0.0022),    // loose early, disciplined late
      slack: Math.max(0, 0.12 - level * 0.0011)         // calls too wide at low levels
    };
  }
  // Decide an action. Returns {action:'fold'|'check'|'call'|'raise', amount}
  function decide(ctx) {
    const { hole, community, nOpp, toCall, pot, minRaise, stack, level } = ctx;
    const p = levelParams(level);
    const eq = equity(hole, community, Math.max(1, nOpp), p.samples);
    const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;
    if (toCall === 0) {
      if (eq > 0.62 - p.aggression * 0.1 || Math.random() < p.bluff * 0.5) { const amt = Math.min(stack, Math.max(minRaise, Math.round(pot * (0.5 + p.aggression * 0.4)))); return { action: 'raise', amount: amt }; }
      return { action: 'check' };
    }
    if (eq > 0.70 && stack > toCall) { const amt = Math.min(stack, Math.max(minRaise, Math.round((pot + toCall) * (0.6 + p.aggression * 0.5)))); return { action: 'raise', amount: amt }; }
    if (eq >= potOdds - p.slack) {
      if (eq > 0.58 && Math.random() < p.aggression && stack > toCall * 2) { const amt = Math.min(stack, Math.max(minRaise, Math.round((pot + toCall) * 0.7))); return { action: 'raise', amount: amt }; }
      return { action: 'call' };
    }
    if (Math.random() < p.bluff && toCall < pot * 0.5) return { action: 'call' };
    return { action: 'fold' };
  }

  const engine = { freshDeck, shuffle, evaluate7, cmp, equity, decide, levelParams, HAND_NAMES };

  // ---------------------------------------------------------------- UI --------
  const tr = (k, fb) => (window.T ? (T(k) === k ? fb : T(k)) : fb);
  const cardHtml = (c, hidden) => hidden ? `<span class="pk-card back"></span>` :
    `<span class="pk-card ${c.s === 1 || c.s === 2 ? 'red' : ''}">${RANKS[c.r]}<i>${SUITS[c.s]}</i></span>`;
  const tierName = n => {
    const t = [[15, 'Fish', 'Fisk'], [35, 'Rookie', 'Novice'], [55, 'Regular', 'Rutineret'], [75, 'Shark', 'Haj'], [90, 'Pro', 'Professionel'], [99, 'High Roller', 'High roller'], [100, 'Legend', 'Legende']];
    const da = window.I18N && I18N.getLang && I18N.getLang() === 'da';
    for (const [m, en, dk] of t) if (n <= m) return da ? dk : en; return da ? 'Legende' : 'Legend';
  };

  function open(startLevel) {
    let level = Math.max(1, Math.min(100, (startLevel | 0) || 20));
    const SB = 10, BB = 20, START = 1000, NUM = 3; // human + 2 bots
    let players, button = -1, deck, community, pot, currentBet, minRaise, street, turn, over, bank = 0, human = 0, msg = '';
    let boardEl;

    const body = `
      <div class="pk-wrap">
        <div class="pk-status" id="pkStatus"></div>
        <div class="pk-table" id="pkTable"></div>
        <div class="pk-actions" id="pkActions"></div>
        <div class="pk-level">
          <span>${tr('chess.level', 'Level')}: <b id="pkLvl">${level}</b> · <span id="pkTier"></span></span>
          <input type="range" id="pkRange" min="1" max="100" value="${level}">
          <button class="btn sm primary" id="pkNew">${tr('poker.newHand', 'New Hand')}</button>
        </div>
      </div>`;
    const modal = (window.UI && UI.modal) ? UI.modal({ title: tr('poker.title', 'Play the Poker Bot'), body, width: 640, fullscreen: true, onOpen: init }) : null;

    function init(m) {
      boardEl = m.querySelector('#pkTable');
      const range = m.querySelector('#pkRange'), lvl = m.querySelector('#pkLvl'), tier = m.querySelector('#pkTier');
      tier.textContent = tierName(level);
      range.oninput = () => { level = +range.value; lvl.textContent = level; tier.textContent = tierName(level); try { localStorage.setItem('pokerLevel', level); } catch (e) { } };
      m.querySelector('#pkNew').onclick = newHand;
      players = [];
      for (let i = 0; i < NUM; i++) players.push({ id: i, name: i === human ? tr('poker.you', 'You') : 'Bot ' + i, isHuman: i === human, stack: START, hole: [], folded: false, allIn: false, roundCommit: 0, handCommit: 0, acted: false });
      newHand();
    }

    function newHand() {
      if (players.some(p => p.stack < BB)) players.forEach(p => p.stack = START); // reset if busted
      button = (button + 1) % NUM;
      deck = shuffle(freshDeck([])); community = []; pot = 0; street = 0; over = false; msg = '';
      players.forEach(p => { p.hole = [deck.pop(), deck.pop()]; p.folded = false; p.allIn = false; p.roundCommit = 0; p.handCommit = 0; p.acted = false; p.showdown = false; });
      const sbIdx = (button + 1) % NUM, bbIdx = (button + 2) % NUM;
      postBlind(sbIdx, SB); postBlind(bbIdx, BB);
      currentBet = BB; minRaise = BB;
      turn = (bbIdx + 1) % NUM;
      render(); startAction();
    }
    function postBlind(i, amt) { const p = players[i]; const put = Math.min(amt, p.stack); p.stack -= put; p.roundCommit = put; p.handCommit = put; pot += put; if (p.stack === 0) p.allIn = true; }
    function activePlayers() { return players.filter(p => !p.folded); }
    function contenders() { return players.filter(p => !p.folded && !p.allIn); }
    function roundComplete() { return players.every(p => p.folded || p.allIn || (p.acted && p.roundCommit === currentBet)); }

    function nextActor(from) {
      for (let k = 1; k <= NUM; k++) { const i = (from + k) % NUM; const p = players[i]; if (!p.folded && !p.allIn && !(p.acted && p.roundCommit === currentBet)) return i; }
      return -1;
    }
    function canAct(p) { return !p.folded && !p.allIn && !(p.acted && p.roundCommit === currentBet); }
    function askOrAct() {
      render();
      if (players[turn].isHuman) renderActions();
      else { renderActions(); setTimeout(botAct, 650); }
    }
    function startAction() {
      if (over) return;
      if (activePlayers().length === 1) return endHand();
      if (roundComplete()) return nextStreet();
      if (!canAct(players[turn])) { const nx = nextActor(turn); if (nx === -1) return nextStreet(); turn = nx; }
      askOrAct();
    }
    function afterAction() {
      if (over) return;
      if (activePlayers().length === 1) return endHand();
      if (roundComplete()) return nextStreet();
      const nx = nextActor(turn);
      if (nx === -1) return nextStreet();
      turn = nx; askOrAct();
    }

    function doFold(p) { p.folded = true; p.acted = true; }
    function doCheckCall(p) { const need = currentBet - p.roundCommit; const put = Math.min(need, p.stack); p.stack -= put; p.roundCommit += put; p.handCommit += put; pot += put; if (p.stack === 0) p.allIn = true; p.acted = true; }
    function doRaise(p, raiseTo) {
      raiseTo = Math.max(raiseTo, currentBet + minRaise);
      const need = raiseTo - p.roundCommit; const put = Math.min(need, p.stack);
      p.stack -= put; p.roundCommit += put; p.handCommit += put; pot += put;
      if (p.stack === 0) p.allIn = true;
      minRaise = Math.max(minRaise, p.roundCommit - currentBet);
      currentBet = Math.max(currentBet, p.roundCommit);
      players.forEach(q => { if (q !== p && !q.folded && !q.allIn) q.acted = false; });
      p.acted = true;
    }

    function botAct() {
      if (over) return;
      const p = players[turn]; const toCall = currentBet - p.roundCommit;
      const d = decide({ hole: p.hole, community, nOpp: contenders().length - 1, toCall, pot, minRaise, stack: p.stack, level });
      if (d.action === 'fold') { doFold(p); msg = p.name + ' ' + tr('poker.folds', 'folds'); }
      else if (d.action === 'check') { doCheckCall(p); msg = p.name + ' ' + tr('poker.checks', 'checks'); }
      else if (d.action === 'call') { doCheckCall(p); msg = p.name + ' ' + tr('poker.calls', 'calls'); }
      else { doRaise(p, p.roundCommit + toCall + d.amount); msg = p.name + ' ' + tr('poker.raises', 'raises to') + ' ' + currentBet; }
      render(); afterAction();
    }

    function humanAct(action, amount) {
      const p = players[human]; if (turn !== human || over) return;
      if (action === 'fold') { doFold(p); msg = tr('poker.youFold', 'You fold'); }
      else if (action === 'call') { const tc = currentBet - p.roundCommit; doCheckCall(p); msg = tc > 0 ? tr('poker.youCall', 'You call') : tr('poker.youCheck', 'You check'); }
      else if (action === 'raise') { doRaise(p, amount); msg = tr('poker.youRaise', 'You raise to') + ' ' + currentBet; }
      render(); afterAction();
    }

    function nextStreet() {
      players.forEach(p => { p.roundCommit = 0; p.acted = false; });
      currentBet = 0; minRaise = BB;
      if (street === 0) { community.push(deck.pop(), deck.pop(), deck.pop()); street = 1; }
      else if (street === 1) { community.push(deck.pop()); street = 2; }
      else if (street === 2) { community.push(deck.pop()); street = 3; }
      else return showdown();
      if (contenders().length <= 1) { // everyone all-in → deal rest then showdown
        while (community.length < 5) community.push(deck.pop());
        render(); return setTimeout(showdown, 700);
      }
      turn = nextActor(button); // first active after button
      msg = [tr('poker.flop', 'Flop'), tr('poker.turn', 'Turn'), tr('poker.river', 'River')][street - 1];
      render();
      startAction();
    }

    function endHand() { // everyone folded but one
      const w = activePlayers()[0]; w.stack += pot; if (w.isHuman) bank += pot - w.handCommit; else if (!over) bank -= players[human].handCommit;
      over = true; msg = (w.isHuman ? tr('poker.youWin', 'You win the pot') : w.name + ' ' + tr('poker.winsPot', 'wins the pot')) + ' (' + pot + ')';
      render(); renderActions();
    }
    function showdown() {
      const live = activePlayers();
      live.forEach(p => { p.showdown = true; p.score = evaluate7(p.hole.concat(community)); });
      let best = live[0]; for (const p of live) if (cmp(p.score, best.score) > 0) best = p;
      const winners = live.filter(p => cmp(p.score, best.score) === 0);
      const share = Math.floor(pot / winners.length);
      winners.forEach(p => p.stack += share);
      const humanP = players[human];
      bank += (winners.includes(humanP) ? share : 0) - humanP.handCommit;
      over = true;
      msg = winners.map(w => w.name).join(', ') + ' ' + tr('poker.wins', 'wins') + ' ' + tr('poker.with', 'with') + ' ' + tr('handName.' + HAND_NAMES[best.score[0]], HAND_NAMES[best.score[0]]);
      render(); renderActions();
    }

    // rendering
    function seatHtml(p, i) {
      const isTurn = i === turn && !over;
      const dealer = i === button;
      const reveal = p.isHuman || p.showdown || over && !p.folded;
      const cards = p.hole.map(c => cardHtml(c, !reveal && !p.isHuman)).join('');
      return `<div class="pk-seat ${p.isHuman ? 'you' : ''} ${p.folded ? 'folded' : ''} ${isTurn ? 'turn' : ''}">
        <div class="pk-seat-head"><b>${p.name}</b>${dealer ? '<span class="pk-btn-d">D</span>' : ''}</div>
        <div class="pk-hole">${cards}</div>
        <div class="pk-stack">${p.stack}${p.roundCommit ? ' · <span class="pk-bet">' + p.roundCommit + '</span>' : ''}${p.allIn ? ' · ALL-IN' : ''}${p.folded ? ' · ' + tr('poker.folded', 'folded') : ''}</div>
      </div>`;
    }
    function render() {
      if (!boardEl) return;
      const bots = players.filter(p => !p.isHuman);
      boardEl.innerHTML = `
        <div class="pk-seats-top">${bots.map(p => seatHtml(p, p.id)).join('')}</div>
        <div class="pk-center">
          <div class="pk-community">${[0, 1, 2, 3, 4].map(i => community[i] ? cardHtml(community[i]) : '<span class="pk-card slot"></span>').join('')}</div>
          <div class="pk-pot">${tr('poker.pot', 'Pot')}: <b>${pot}</b> · ${tr('poker.bank', 'Your bank')}: <b class="${bank >= 0 ? 'pos' : 'neg'}">${bank >= 0 ? '+' : ''}${bank}</b></div>
        </div>
        <div class="pk-seats-bot">${seatHtml(players[human], human)}</div>`;
      const st = document.getElementById('pkStatus'); if (st) st.textContent = msg;
    }
    function renderActions() {
      const el = document.getElementById('pkActions'); if (!el) return;
      if (over) { el.innerHTML = `<button class="btn primary" id="pkNext">${tr('poker.nextHand', 'Next Hand')}</button>`; el.querySelector('#pkNext').onclick = newHand; return; }
      if (turn !== human) { el.innerHTML = `<span class="pk-wait">${tr('poker.waiting', 'Waiting for bots…')}</span>`; return; }
      const p = players[human], toCall = currentBet - p.roundCommit;
      const callLbl = toCall > 0 ? tr('poker.call', 'Call') + ' ' + Math.min(toCall, p.stack) : tr('poker.check', 'Check');
      const minTo = currentBet + minRaise, maxTo = p.roundCommit + p.stack;
      const canRaise = p.stack > toCall;
      el.innerHTML = `
        <button class="btn danger" id="pkFold">${tr('poker.fold', 'Fold')}</button>
        <button class="btn" id="pkCall">${callLbl}</button>
        ${canRaise ? `<span class="pk-raise"><input type="range" id="pkRaiseR" min="${minTo}" max="${maxTo}" value="${Math.min(maxTo, Math.max(minTo, Math.round(pot * 0.66) + p.roundCommit))}"><button class="btn primary" id="pkRaise"></button></span>` : ''}`;
      el.querySelector('#pkFold').onclick = () => humanAct('fold');
      el.querySelector('#pkCall').onclick = () => humanAct('call');
      const rr = el.querySelector('#pkRaiseR'), rb = el.querySelector('#pkRaise');
      if (rr && rb) {
        const upd = () => rb.textContent = (currentBet === 0 ? tr('poker.betTo', 'Bet') : tr('poker.raiseTo', 'Raise to')) + ' ' + rr.value;
        rr.oninput = upd; upd();
        rb.onclick = () => humanAct('raise', +rr.value);
      }
    }
    return modal;
  }

  return { engine, open, tierName };
})();

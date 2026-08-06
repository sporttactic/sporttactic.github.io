/* bridge.js — bridge bot: auto-auction to a contract + full trick play vs bots,
   with 100 training levels. window.BridgeBot.open(level).
   Seats 0=N 1=E 2=S 3=W (clockwise). You are South. Partnerships NS={0,2}, EW={1,3}. */
window.BridgeBot = (() => {
  'use strict';
  const SUITS = ['\u2660', '\u2665', '\u2666', '\u2663']; // S H D C
  const RANKS = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  const SEAT = ['N', 'E', 'S', 'W'];
  const partner = s => (s + 2) % 4;
  const isNS = s => s === 0 || s === 2;
  const hcp = hand => hand.reduce((n, c) => n + (c.r >= 11 ? c.r - 10 : 0), 0);

  function deal() {
    const d = [];
    for (let s = 0; s < 4; s++) for (let r = 2; r <= 14; r++) d.push({ r, s });
    for (let i = d.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0;[d[i], d[j]] = [d[j], d[i]]; }
    const hands = [[], [], [], []];
    for (let i = 0; i < 52; i++) hands[i % 4].push(d[i]);
    const bySuitSort = h => h.sort((a, b) => a.s - b.s || b.r - a.r);
    hands.forEach(bySuitSort);
    return hands;
  }
  function suitLen(hand, s) { return hand.filter(c => c.s === s).length; }

  // Deterministic auto-contract (simplified).
  function makeContract(hands) {
    const nsH = hcp(hands[0]) + hcp(hands[2]), ewH = hcp(hands[1]) + hcp(hands[3]);
    const side = nsH >= ewH ? [0, 2] : [1, 3];
    const combinedHCP = Math.max(nsH, ewH);
    let bestSuit = -1, bestLen = 0;
    for (let s = 0; s < 4; s++) { const len = suitLen(hands[side[0]], s) + suitLen(hands[side[1]], s); if (len > bestLen || (len === bestLen && s < bestSuit)) { bestLen = len; bestSuit = s; } }
    let trump = bestLen >= 8 ? bestSuit : 'NT';
    let level;
    if (trump === 'NT') level = combinedHCP >= 25 ? 3 : combinedHCP >= 23 ? 2 : 1;
    else if (trump <= 1) level = combinedHCP >= 25 ? 4 : combinedHCP >= 22 ? 3 : 2;
    else level = combinedHCP >= 28 ? 5 : combinedHCP >= 24 ? 3 : 2;
    // declarer: NS → South (you). EW → hand with more trump / HCP.
    let declarer;
    if (side[0] === 0) declarer = 2;
    else declarer = (trump === 'NT' ? (hcp(hands[1]) >= hcp(hands[3]) ? 1 : 3) : (suitLen(hands[1], trump) >= suitLen(hands[3], trump) ? 1 : 3));
    return { trump, level, declarer, need: 6 + level };
  }

  // Legal cards for a seat given the led suit.
  function legalCards(hand, ledSuit) {
    if (ledSuit == null) return hand.slice();
    const follow = hand.filter(c => c.s === ledSuit);
    return follow.length ? follow : hand.slice();
  }
  function trickWinner(trick, trump) { // trick: [{seat,card}] length 4, in play order
    let best = trick[0], led = trick[0].card.s;
    for (const t of trick) {
      const c = t.card, b = best.card;
      const cT = (trump !== 'NT' && c.s === trump), bT = (trump !== 'NT' && b.s === trump);
      if (cT && !bT) best = t;
      else if (cT && bT) { if (c.r > b.r) best = t; }
      else if (!cT && !bT) { if (c.s === led && (b.s !== led || c.r > b.r)) best = t; }
    }
    return best.seat;
  }

  function levelParams(level) { level = Math.max(1, Math.min(100, level | 0)); return { skill: level / 100, blunder: Math.max(0, 0.5 - level * 0.005) }; }
  // Bot chooses a card for `seat`.
  function botCard(ctx) {
    const { hand, trick, ledSuit, trump, seat, level } = ctx;
    const legal = legalCards(hand, ledSuit);
    if (legal.length === 1) return legal[0];
    const { blunder } = levelParams(level);
    if (Math.random() < blunder) return legal[(Math.random() * legal.length) | 0];
    const bySuit = s => hand.filter(c => c.s === s);
    if (!trick.length) { // leading — low card from longest non-trump suit
      let ls = -1, ll = -1;
      for (let s = 0; s < 4; s++) { if (trump !== 'NT' && s === trump) continue; const l = bySuit(s).length; if (l > ll) { ll = l; ls = s; } }
      const suitCards = ls >= 0 ? bySuit(ls).sort((a, b) => a.r - b.r) : [];
      return suitCards[0] || legal.slice().sort((a, b) => a.r - b.r)[0];
    }
    const curWinner = trickWinner(trick, trump);
    const partnerWinning = (partner(seat) === curWinner);
    const sortedLow = legal.slice().sort((a, b) => a.r - b.r);
    const beats = card => trickWinner(trick.concat([{ seat, card }]), trump) === seat;
    const winners = sortedLow.filter(beats);
    if (partnerWinning) return sortedLow[0];   // duck when partner already winning
    if (winners.length) return winners[0];      // win as cheaply as possible
    return sortedLow[0];                         // cannot win → play lowest
  }

  const engine = { deal, hcp, makeContract, legalCards, trickWinner, botCard, levelParams };

  // ---------------------------------------------------------------- UI --------
  const tr = (k, fb) => (window.T ? (T(k) === k ? fb : T(k)) : fb);
  const cardHtml = (c, cls) => `<span class="br-card ${c.s === 1 || c.s === 2 ? 'red' : ''} ${cls || ''}" data-cid="${c.s}_${c.r}">${RANKS[c.r]}<i>${SUITS[c.s]}</i></span>`;
  const tierName = n => { const t = [[20, 'Novice', 'Nybegynder'], [45, 'Club', 'Klub'], [70, 'Expert', 'Ekspert'], [90, 'Life Master', 'Livsmester'], [100, 'World Class', 'Verdensklasse']]; const da = window.I18N && I18N.getLang && I18N.getLang() === 'da'; for (const [m, en, dk] of t) if (n <= m) return da ? dk : en; return 'World Class'; };

  function open(startLevel) {
    let level = Math.max(1, Math.min(100, (startLevel | 0) || 20));
    let hands, contract, trick, leader, turn, tricksNS, tricksEW, playing, over, msg, dummyShown;
    let boardEl;
    const body = `
      <div class="br-wrap">
        <div class="br-status" id="brStatus"></div>
        <div class="br-table" id="brTable"></div>
        <div class="br-level">
          <span>${tr('chess.level', 'Level')}: <b id="brLvl">${level}</b> · <span id="brTier"></span></span>
          <input type="range" id="brRange" min="1" max="100" value="${level}">
          <button class="btn sm primary" id="brNew">${tr('bridge.newDeal', 'New Deal')}</button>
        </div>
      </div>`;
    const modal = (window.UI && UI.modal) ? UI.modal({ title: tr('bridge.title', 'Play the Bridge Bot'), body, width: 660, fullscreen: true, onOpen: init }) : null;

    function init(m) {
      boardEl = m.querySelector('#brTable');
      const range = m.querySelector('#brRange'), lvl = m.querySelector('#brLvl'), tier = m.querySelector('#brTier');
      tier.textContent = tierName(level);
      range.oninput = () => { level = +range.value; lvl.textContent = level; tier.textContent = tierName(level); try { localStorage.setItem('bridgeLevel', level); } catch (e) { } };
      m.querySelector('#brNew').onclick = newDeal;
      newDeal();
    }
    function strainName(t) { return t === 'NT' ? 'NT' : SUITS[t]; }
    function newDeal() {
      hands = deal(); contract = makeContract(hands);
      trick = []; leader = (contract.declarer + 1) % 4; turn = leader;
      tricksNS = 0; tricksEW = 0; over = false; dummyShown = false;
      msg = tr('bridge.contract', 'Contract') + ': ' + contract.level + strainName(contract.trump) + ' · ' + tr('bridge.by', 'by') + ' ' + SEAT[contract.declarer];
      render();
      step();
    }
    function dummySeat() { return partner(contract.declarer); }
    function isHumanTurn(seat) { return seat === 2 || (contract.declarer === 2 && seat === dummySeat()); }

    function step() {
      if (over) return;
      if (trick.length === 4) { return setTimeout(resolveTrick, 700); }
      if (isHumanTurn(turn)) { render(); }           // wait for click
      else { render(); setTimeout(botPlay, 620); }
    }
    function botPlay() {
      if (over) return;
      const seat = turn, hand = hands[seat];
      const ledSuit = trick.length ? trick[0].card.s : null;
      const card = botCard({ hand, trick, ledSuit, trump: contract.trump, seat, level });
      playCard(seat, card);
    }
    function playCard(seat, card) {
      const hand = hands[seat];
      const idx = hand.findIndex(c => c.s === card.s && c.r === card.r);
      if (idx < 0) return;
      hand.splice(idx, 1);
      trick.push({ seat, card });
      if (trick.length === 1 && !dummyShown) dummyShown = true; // reveal dummy after opening lead
      turn = (turn + 1) % 4;
      step();
    }
    function resolveTrick() {
      const w = trickWinner(trick, contract.trump);
      if (isNS(w)) tricksNS++; else tricksEW++;
      trick = []; leader = w; turn = w;
      if (hands.every(h => h.length === 0)) return finish();
      render(); step();
    }
    function finish() {
      over = true;
      const declNS = isNS(contract.declarer);
      const declTricks = declNS ? tricksNS : tricksEW;
      const made = declTricks >= contract.need;
      const yourSideMade = declNS ? made : !made;   // you are South (NS)
      msg = `${SEAT[contract.declarer]} ${made ? tr('bridge.made', 'made') : tr('bridge.wentDown', 'went down')} ${contract.level}${strainName(contract.trump)} (${declTricks} ${tr('bridge.tricks', 'tricks')}). ` +
        (yourSideMade ? tr('bridge.youWin', 'You win!') : tr('bridge.youLose', 'You lose'));
      render();
    }

    function faceUp(seat) { return seat === 2 || (dummyShown && seat === dummySeat()); }
    function handRow(seat) {
      const h = hands[seat], up = faceUp(seat);
      const cells = up ? h.map(c => cardHtml(c, (isHumanTurn(seat) && canPlay(seat, c)) ? 'play' : '')).join('') : h.map(() => '<span class="br-card back"></span>').join('');
      return `<div class="br-hand"><span class="br-seat">${SEAT[seat]}${seat === contract.declarer ? ' *' : ''}${seat === dummySeat() ? ' ◇' : ''}</span><div class="br-cards">${cells || '<i>—</i>'}</div></div>`;
    }
    function canPlay(seat, c) {
      if (over || turn !== seat || !isHumanTurn(seat)) return false;
      const ledSuit = trick.length ? trick[0].card.s : null;
      return legalCards(hands[seat], ledSuit).some(x => x.s === c.s && x.r === c.r);
    }
    function render() {
      if (!boardEl) return;
      const trickSlots = [0, 1, 2, 3].map(seat => { const t = trick.find(x => x.seat === seat); return `<div class="br-trickcard s${seat}">${t ? cardHtml(t.card) : '<span class="br-card slot"></span>'}<span class="br-tl">${SEAT[seat]}</span></div>`; }).join('');
      boardEl.innerHTML = `
        <div class="br-info">${tr('bridge.contract', 'Contract')}: <b>${contract.level}${strainName(contract.trump)}</b> ${tr('bridge.by', 'by')} ${SEAT[contract.declarer]} · NS ${tricksNS} · EW ${tricksEW} · ${tr('bridge.need', 'need')} ${contract.need}</div>
        <div class="br-north">${handRow(0)}</div>
        <div class="br-mid">
          <div class="br-west">${handRow(3)}</div>
          <div class="br-trick">${trickSlots}</div>
          <div class="br-east">${handRow(1)}</div>
        </div>
        <div class="br-south">${handRow(2)}</div>`;
      boardEl.querySelectorAll('.br-card.play').forEach(el => el.onclick = () => {
        const [s, r] = el.dataset.cid.split('_').map(Number);
        const seat = turn;
        if (canPlay(seat, { s, r })) playCard(seat, { s, r });
      });
      const st = document.getElementById('brStatus'); if (st) st.textContent = msg;
    }
    return modal;
  }

  return { engine, open, tierName };
})();

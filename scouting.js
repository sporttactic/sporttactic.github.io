/* Live Scouting view */
window.Views = window.Views || {};
Views.scouting = function (mount, params) {
  const team = Store.activeTeam();
  const matches = Store.matches();
  let matchId = (params && params.matchId) || (matches[0] && matches[0].id);
  // Not Active players are excluded — they cannot take part in the match.
  const players = Store.players(team && team.id).filter(p => p.status !== 'suspended');
  const sport = (window.App && App.getSport && App.getSport()) || 'handball';

  // A strength discipline has no match and no opponent, so live scouting there
  // means logging the sets as they happen instead of counting goals.
  if (sport === 'crossfit' || sport === 'bodybuilding') return strengthScout(mount, sport);

  // Per-sport event catalogue. Each category: {id, en, da, ev:[[en, da, result, cls], …]}.
  const SPORT_EVENTS = {
    handball: [
      { id: 'attack', en: 'Attack', da: 'Angreb', ev: [['Fast Break', 'Kontraløb', 'goal', 'goal'], ['Backcourt Shot', 'Bagskud', 'goal', 'goal'], ['Wing Shot', 'Fløjskud', 'goal', 'goal'], ['Pivot Shot', 'Stregskud', 'goal', 'goal'], ['7m Throw', 'Syvmeterkast', 'goal', 'goal'], ['Breakthrough', 'Gennembrud', 'goal', 'goal'], ['Shot Saved', 'Skud reddet', 'save', ''], ['Shot Missed', 'Skud forbi', 'miss', ''], ['Assist', 'Assist', 'assist', '']] },
      { id: 'defense', en: 'Defense', da: 'Forsvar', ev: [['Block', 'Blokering', 'block', ''], ['Steal', 'Erobring', 'steal', ''], ['Save', 'Redning', 'save', ''], ['Penalty Save', 'Straffekastredning', 'save', '']] },
      { id: 'foul', en: 'Fouls', da: 'Frikast', ev: [['Offensive foul', 'Offensivt frikast', 'foul', 'foul'], ['Defensive foul', 'Defensivt frikast', 'foul', 'foul'], ['Yellow card', 'Gult kort', 'card', 'foul'], ['2-minute suspension', '2-minutters udvisning', 'suspension', 'foul'], ['Red card', 'Rødt kort', 'card', 'turnover']] },
      { id: 'turnover', en: 'Turnovers', da: 'Boldtab', ev: [['Bad pass', 'Dårlig aflevering', 'turnover', 'turnover'], ['Technical fault', 'Teknisk fejl', 'turnover', 'turnover'], ['Stepping', 'Skridtfejl', 'turnover', 'turnover'], ['Double dribble', 'Dobbeltdrible', 'turnover', 'turnover']] }
    ],
    soccer: [
      { id: 'attack', en: 'Attack', da: 'Angreb', ev: [['Goal', 'Mål', 'goal', 'goal'], ['Shot on Target', 'Skud på mål', 'save', ''], ['Header', 'Hovedstød', 'goal', 'goal'], ['Free Kick Goal', 'Frisparksmål', 'goal', 'goal'], ['Penalty', 'Straffespark', 'goal', 'goal'], ['Assist', 'Oplæg', 'assist', '']] },
      { id: 'defense', en: 'Defense', da: 'Forsvar', ev: [['Tackle', 'Tackling', 'block', ''], ['Interception', 'Afluring', 'steal', ''], ['Clearance', 'Clearance', 'block', ''], ['Save', 'Redning', 'save', '']] },
      { id: 'foul', en: 'Fouls', da: 'Frispark', ev: [['Foul', 'Frispark', 'foul', 'foul'], ['Yellow Card', 'Gult kort', 'card', 'foul'], ['Red Card', 'Rødt kort', 'card', 'turnover'], ['Offside', 'Offside', 'foul', 'foul']] },
      { id: 'turnover', en: 'Turnovers', da: 'Boldtab', ev: [['Misplaced Pass', 'Fejlaflevering', 'turnover', 'turnover'], ['Dispossessed', 'Erobret', 'turnover', 'turnover']] }
    ],
    basketball: [
      { id: 'attack', en: 'Scoring', da: 'Scoring', ev: [['2-Point', '2-point', 'goal', 'goal'], ['3-Point', '3-point', 'goal', 'goal'], ['Lay-up', 'Lay-up', 'goal', 'goal'], ['Dunk', 'Dunk', 'goal', 'goal'], ['Free Throw', 'Straffekast', 'goal', 'goal'], ['Assist', 'Assist', 'assist', '']] },
      { id: 'defense', en: 'Defense', da: 'Forsvar', ev: [['Block', 'Blok', 'block', ''], ['Steal', 'Steal', 'steal', ''], ['Rebound', 'Rebound', 'block', '']] },
      { id: 'foul', en: 'Fouls', da: 'Fejl', ev: [['Personal Foul', 'Personlig fejl', 'foul', 'foul'], ['Technical Foul', 'Teknisk fejl', 'foul', 'foul'], ['Offensive Foul', 'Offensiv fejl', 'foul', 'foul']] },
      { id: 'turnover', en: 'Turnovers', da: 'Boldtab', ev: [['Travel', 'Skridtfejl', 'turnover', 'turnover'], ['Double Dribble', 'Dobbeltdrible', 'turnover', 'turnover'], ['Bad Pass', 'Dårlig aflevering', 'turnover', 'turnover']] }
    ],
    volleyball: [
      { id: 'attack', en: 'Attack', da: 'Angreb', ev: [['Spike', 'Smash', 'goal', 'goal'], ['Tip', 'Tip', 'goal', 'goal'], ['Ace', 'Serve-es', 'goal', 'goal'], ['Block Point', 'Blokpoint', 'goal', 'goal']] },
      { id: 'defense', en: 'Defense', da: 'Forsvar', ev: [['Dig', 'Dig', 'block', ''], ['Block', 'Blok', 'block', ''], ['Reception', 'Modtagning', 'save', '']] },
      { id: 'error', en: 'Errors', da: 'Fejl', ev: [['Net Touch', 'Netfejl', 'foul', 'foul'], ['Foot Fault', 'Fodfejl', 'foul', 'foul'], ['Attack Error', 'Angrebsfejl', 'turnover', 'turnover'], ['Serve Error', 'Servefejl', 'turnover', 'turnover']] }
    ],
    baseball: [
      { id: 'batting', en: 'Batting', da: 'Slag', ev: [['Single', 'Single', 'goal', 'goal'], ['Double', 'Double', 'goal', 'goal'], ['Triple', 'Triple', 'goal', 'goal'], ['Home Run', 'Home run', 'goal', 'goal'], ['Walk', 'Base på bolde', 'assist', ''], ['Strikeout', 'Strikeout', 'turnover', 'turnover']] },
      { id: 'fielding', en: 'Fielding', da: 'Mark', ev: [['Putout', 'Putout', 'block', ''], ['Assist', 'Assist', 'assist', ''], ['Double Play', 'Double play', 'block', ''], ['Error', 'Fejl', 'turnover', 'turnover']] },
      { id: 'pitching', en: 'Pitching', da: 'Kast', ev: [['Strike', 'Strike', 'save', ''], ['Ball', 'Ball', 'miss', ''], ['Hit Batter', 'Ramt slåer', 'foul', 'foul']] },
      { id: 'running', en: 'Running', da: 'Løb', ev: [['Stolen Base', 'Stjålet base', 'steal', ''], ['Caught Stealing', 'Fanget', 'turnover', 'turnover']] }
    ],
    rugby: [
      { id: 'attack', en: 'Attack', da: 'Angreb', ev: [['Try', 'Forsøg', 'goal', 'goal'], ['Conversion', 'Konvertering', 'goal', 'goal'], ['Penalty Kick', 'Straffespark', 'goal', 'goal'], ['Drop Goal', 'Drop goal', 'goal', 'goal'], ['Line Break', 'Gennembrud', 'assist', ''], ['Offload', 'Offload', 'assist', '']] },
      { id: 'defense', en: 'Defense', da: 'Forsvar', ev: [['Tackle', 'Tackling', 'block', ''], ['Turnover Won', 'Erobring', 'steal', ''], ['Ruck Steal', 'Ruck-steal', 'steal', '']] },
      { id: 'foul', en: 'Fouls', da: 'Straf', ev: [['Penalty', 'Straffespark', 'foul', 'foul'], ['Yellow Card', 'Gult kort', 'card', 'foul'], ['Red Card', 'Rødt kort', 'card', 'turnover'], ['Knock-on', 'Knock-on', 'turnover', 'turnover']] },
      { id: 'set', en: 'Set Piece', da: 'Fast spil', ev: [['Scrum Won', 'Scrum vundet', 'block', ''], ['Lineout Won', 'Lineout vundet', 'block', '']] }
    ],
    football: [
      { id: 'offense', en: 'Offense', da: 'Angreb', ev: [['Touchdown', 'Touchdown', 'goal', 'goal'], ['Field Goal', 'Field goal', 'goal', 'goal'], ['Pass Complete', 'Aflevering fuldført', 'assist', ''], ['Rush', 'Løb', 'save', ''], ['Reception', 'Modtagning', 'save', '']] },
      { id: 'defense', en: 'Defense', da: 'Forsvar', ev: [['Sack', 'Sack', 'block', ''], ['Interception', 'Interception', 'steal', ''], ['Tackle', 'Tackling', 'block', ''], ['Fumble Recovery', 'Fumble erobret', 'steal', '']] },
      { id: 'penalty', en: 'Penalty', da: 'Straf', ev: [['Holding', 'Holding', 'foul', 'foul'], ['False Start', 'False start', 'foul', 'foul'], ['Pass Interference', 'Pass interference', 'foul', 'foul']] },
      { id: 'special', en: 'Special', da: 'Special', ev: [['Punt', 'Punt', 'save', ''], ['Kick Return', 'Kick return', 'assist', '']] }
    ],
    badminton: [
      { id: 'rally', en: 'Rally', da: 'Duel', ev: [['Smash Winner', 'Smash-vinder', 'goal', 'goal'], ['Drop Winner', 'Drop-vinder', 'goal', 'goal'], ['Clear', 'Clear', 'save', ''], ['Net Kill', 'Net-kill', 'goal', 'goal']] },
      { id: 'error', en: 'Errors', da: 'Fejl', ev: [['Net Error', 'Netfejl', 'turnover', 'turnover'], ['Out', 'Ude', 'turnover', 'turnover'], ['Service Fault', 'Servefejl', 'foul', 'foul']] },
      { id: 'serve', en: 'Serve', da: 'Serve', ev: [['Ace', 'Es', 'goal', 'goal'], ['Fault', 'Fejl', 'turnover', 'turnover']] }
    ],
    tennis: [
      { id: 'rally', en: 'Rally', da: 'Duel', ev: [['Forehand Winner', 'Forhånd-vinder', 'goal', 'goal'], ['Backhand Winner', 'Baghånd-vinder', 'goal', 'goal'], ['Volley Winner', 'Volley-vinder', 'goal', 'goal'], ['Passing Shot', 'Passérslag', 'goal', 'goal'], ['Lob', 'Lob', 'save', '']] },
      { id: 'serve', en: 'Serve', da: 'Serv', ev: [['Ace', 'Es', 'goal', 'goal'], ['Service Winner', 'Serve-vinder', 'goal', 'goal'], ['First Serve In', 'Første serv inde', 'save', ''], ['Double Fault', 'Dobbeltfejl', 'turnover', 'turnover']] },
      { id: 'error', en: 'Errors', da: 'Fejl', ev: [['Unforced Error', 'Uprovokeret fejl', 'turnover', 'turnover'], ['Net', 'Net', 'turnover', 'turnover'], ['Out', 'Ude', 'turnover', 'turnover'], ['Break Point', 'Breakbold', 'assist', '']] }
    ],
    snooker: [
      { id: 'pot', en: 'Pot', da: 'Sænk', ev: [['Red', 'Rød', 'goal', 'goal'], ['Yellow', 'Gul', 'goal', 'goal'], ['Green', 'Grøn', 'goal', 'goal'], ['Brown', 'Brun', 'goal', 'goal'], ['Blue', 'Blå', 'goal', 'goal'], ['Pink', 'Pink', 'goal', 'goal'], ['Black', 'Sort', 'goal', 'goal']] },
      { id: 'safety', en: 'Safety', da: 'Sikkerhed', ev: [['Safety Shot', 'Safety-stød', 'save', ''], ['Snooker', 'Snooker', 'steal', '']] },
      { id: 'foul', en: 'Foul', da: 'Fejl', ev: [['Foul', 'Fejl', 'foul', 'foul'], ['Miss', 'Miss', 'turnover', 'turnover'], ['Free Ball', 'Fri bold', 'foul', 'foul']] }
    ],
    pool: [
      { id: 'pot', en: 'Pot', da: 'Sænk', ev: [['Solid', 'Helfarve', 'goal', 'goal'], ['Stripe', 'Stribe', 'goal', 'goal'], ['8-Ball', '8-bold', 'goal', 'goal'], ['Break Pot', 'Break-sænk', 'goal', 'goal']] },
      { id: 'safety', en: 'Safety', da: 'Sikkerhed', ev: [['Safety', 'Safety', 'save', '']] },
      { id: 'foul', en: 'Foul', da: 'Fejl', ev: [['Scratch', 'Scratch', 'foul', 'foul'], ['Wrong Ball', 'Forkert bold', 'turnover', 'turnover'], ['8-Ball Early', '8-bold for tidligt', 'turnover', 'turnover']] }
    ],
    darts: [
      { id: 'score', en: 'Score', da: 'Score', ev: [['180', '180', 'goal', 'goal'], ['Ton+', 'Ton+', 'goal', 'goal'], ['Bull', 'Bull', 'goal', 'goal'], ['Treble 20', 'Trippel 20', 'goal', 'goal'], ['Double', 'Dobbelt', 'goal', 'goal']] },
      { id: 'checkout', en: 'Checkout', da: 'Checkout', ev: [['Checkout', 'Checkout', 'goal', 'goal'], ['Missed Double', 'Misset dobbelt', 'miss', '']] },
      { id: 'leg', en: 'Leg', da: 'Leg', ev: [['Leg Won', 'Leg vundet', 'goal', 'goal'], ['9-Darter', '9-dart finish', 'goal', 'goal']] }
    ],
    icehockey: [
      { id: 'attack', en: 'Attack', da: 'Angreb', ev: [['Goal', 'Mål', 'goal', 'goal'], ['Slap Shot', 'Slagskud', 'save', ''], ['Wrist Shot', 'Håndledsskud', 'save', ''], ['One-Timer', 'One-timer', 'goal', 'goal'], ['Assist', 'Assist', 'assist', ''], ['Shot on Goal', 'Skud på mål', 'save', '']] },
      { id: 'defense', en: 'Defense', da: 'Forsvar', ev: [['Block', 'Blok', 'block', ''], ['Body Check', 'Tackling', 'block', ''], ['Poke Check', 'Stikkontrol', 'steal', ''], ['Save', 'Redning', 'save', '']] },
      { id: 'penalty', en: 'Penalty', da: 'Straf', ev: [['Minor Penalty', 'Lille straf', 'suspension', 'foul'], ['Major Penalty', 'Stor straf', 'card', 'turnover'], ['Tripping', 'Benspænd', 'foul', 'foul'], ['Hooking', 'Hooking', 'foul', 'foul']] },
      { id: 'faceoff', en: 'Faceoff', da: 'Faceoff', ev: [['Faceoff Won', 'Faceoff vundet', 'steal', ''], ['Faceoff Lost', 'Faceoff tabt', 'turnover', 'turnover']] }
    ],
    floorball: [
      { id: 'attack', en: 'Attack', da: 'Angreb', ev: [['Goal', 'Mål', 'goal', 'goal'], ['Wrist Shot', 'Håndledsskud', 'save', ''], ['Slap Shot', 'Slagskud', 'save', ''], ['Assist', 'Assist', 'assist', ''], ['Shot', 'Skud', 'save', '']] },
      { id: 'defense', en: 'Defense', da: 'Forsvar', ev: [['Block', 'Blok', 'block', ''], ['Tackle', 'Tackling', 'block', ''], ['Save', 'Redning', 'save', ''], ['Interception', 'Erobring', 'steal', '']] },
      { id: 'penalty', en: 'Penalty', da: 'Straf', ev: [['2-min Penalty', '2-min udvisning', 'suspension', 'foul'], ['Hooking', 'Hooking', 'foul', 'foul'], ['Slashing', 'Slashing', 'foul', 'foul']] }
    ]
  };

  // Goalkeeper actions get their own tab in the sports that actually field one.
  const GK_CAT = {
    id: 'keeper', en: 'Goalkeeper', da: 'Målmand',
    ev: [['Save', 'Redning', 'save', ''], ['Penalty Save', 'Straffekastredning', 'save', ''], ['One-on-One Save', 'Duelredning', 'save', ''], ['Rebound Control', 'Returkontrol', 'save', ''], ['Goal Conceded', 'Mål imod', 'conceded', 'turnover'], ['Assist', 'Assist', 'assist', '']]
  };
  const hasKeeper = ((window.SPORTS && SPORTS.positions(sport)) || []).indexOf('Goalkeeper') > -1;

  const cats = (SPORT_EVENTS[sport] || SPORT_EVENTS.handball).concat(hasKeeper ? [GK_CAT] : []);
  // en → da lookup across all sports so the event log translates historic events.
  const EV_LABELS = {};
  Object.values(SPORT_EVENTS).forEach(list => list.forEach(c => c.ev.forEach(e => { EV_LABELS[e[0]] = e[1]; })));
  GK_CAT.ev.forEach(e => { EV_LABELS[e[0]] = e[1]; });
  const catLabel = c => (I18N.getLang() === 'da' ? c.da : c.en);
  const evLabel = t => (I18N.getLang() === 'da' ? (EV_LABELS[t] || t) : t);
  const evName = e => (I18N.getLang() === 'da' ? e[1] : e[0]);
  const posBadgeHtml = (pos) => {
    const b = SPORTS.posBadge(sport, pos);
    const k = 'pos.' + (pos || ''), lbl = T(k) === k ? (pos || '') : T(k);
    return `<span class="pos-badge role-${b.role}" style="--pos:${b.color}" title="${UI.esc(lbl)}">${UI.esc(b.ab)}</span>`;
  };

  // ---- Focus areas --------------------------------------------------------
  // A coach rarely tracks everything at once. What is switched OFF is what gets
  // stored (per sport), so an event added in a later build is on by default.
  const FOCUS_KEY = 'stx_scout_focus_' + sport;
  const evKey = (c, e) => c.id + '|' + e[0];
  let focusOff = readFocus();
  function readFocus() {
    try {
      const o = JSON.parse(localStorage.getItem(FOCUS_KEY) || '{}');
      return { cats: o.cats || {}, evs: o.evs || {} };
    } catch { return { cats: {}, evs: {} }; }
  }
  function writeFocus() {
    try { localStorage.setItem(FOCUS_KEY, JSON.stringify(focusOff)); } catch { /* private mode */ }
  }
  const evsOf = c => c.ev.filter(e => !focusOff.evs[evKey(c, e)]);
  // A category with nothing left to log is hidden too, so no empty tab appears.
  function shownCats() {
    const list = cats.filter(c => !focusOff.cats[c.id] && evsOf(c).length);
    return list.length ? list : cats;
  }
  const curCat = () => shownCats().find(c => c.id === activeCat) || shownCats()[0];
  const curEvs = () => evsOf(curCat());

  // ---- Quick panel --------------------------------------------------------
  // Registering during a match is done one-handed at the side of the court, so
  // the default is: pick the player once at the top, then every category —
  // attack, defense, fouls, turnovers, goalkeeper — is a single tap away with
  // no tab switching in between. "By player" keeps the old grid for anyone who
  // works the other way round.
  const MODE_KEY = 'stx_scout_mode';
  let mode = 'quick';
  try { if (localStorage.getItem(MODE_KEY) === 'grid') mode = 'grid'; } catch { /* private mode */ }
  function setMode(m) {
    mode = m;
    try { localStorage.setItem(MODE_KEY, m); } catch { /* private mode */ }
    render();
  }
  let activePlayer = '';
  const isKeeper = id => { const p = players.find(x => x.id === id); return !!p && p.position === 'Goalkeeper'; };

  let clock = 0, timer = null, activeCat = shownCats()[0].id;

  function render() {
    const match = Store.find('matches', matchId);
    const events = Store.matchEvents(matchId).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const goals = events.filter(e => e.result === 'goal').length;
    const tabs = shownCats();
    activeCat = curCat().id; // a focus area that was switched off must not stay selected
    const evs = curEvs();
    // Only the players picked for THIS match, when a line-up was chosen for it.
    const lineup = match && Array.isArray(match.players) && match.players.length ? match.players : null;
    const playing = lineup ? players.filter(p => lineup.indexOf(p.id) >= 0) : players;
    // The Goalkeeper tab only registers on keepers.
    const rows = activeCat === 'keeper' ? playing.filter(p => p.position === 'Goalkeeper') : playing;
    if (!playing.some(p => p.id === activePlayer)) activePlayer = playing[0] ? playing[0].id : '';
    const quick = mode === 'quick';

    const playerChip = p => `<button type="button" class="qs-player${p.id === activePlayer ? ' active' : ''}" data-qp="${p.id}">
      ${posBadgeHtml(p.position)}<span class="qs-num">#${UI.esc(p.number || '?')}</span><span class="qs-name">${UI.esc(p.lastName || p.firstName || '')}</span></button>`;

    const quickBody = `
      <div class="qs-bar">
        <div class="qs-players">
          ${playing.map(playerChip).join('') || `<span class="qs-none">${T('scout.noPlayers')}</span>`}
        </div>
        <button type="button" class="btn sm" id="qsUndo" title="${UI.esc(T('scout.undo'))}" ${events.length ? '' : 'disabled'}>↶<span class="qs-undo-lbl"> ${T('scout.undo')}</span></button>
      </div>
      <div class="qs-panels">
        ${tabs.map(c => {
      const off = c.id === 'keeper' && !isKeeper(activePlayer);
      return `<section class="qs-panel${off ? ' off' : ''}" data-qcat="${UI.esc(c.id)}">
            <h3>${UI.esc(catLabel(c))}</h3>
            <div class="qs-acts">
              ${evsOf(c).map((e, i) => `<button type="button" class="event-btn ${e[3] || 'neutral'}" data-qcat="${UI.esc(c.id)}" data-qev="${i}" ${off ? 'disabled' : ''}>${UI.esc(evName(e))}</button>`).join('')}
            </div>
            <p class="hint qs-off-note${off ? '' : ' hidden'}">${T('scout.keeperOnly')}</p>
          </section>`;
    }).join('')}
      </div>`;

    const gridBody = `
      <div class="pill-row">
        ${tabs.map(c => `<span class="pill ${c.id === activeCat ? 'active' : ''}" data-cat="${c.id}">${UI.esc(catLabel(c))}</span>`).join('')}
      </div>
      <div class="player-events">
        ${rows.length ? rows.map(p => `
          <div class="player-row">
            <span class="player-tag">${posBadgeHtml(p.position)}<span class="pt-name"><span class="pt-num">#${UI.esc(p.number || '?')}</span>${UI.esc(p.lastName || p.firstName || '')}</span></span>
            <div class="pev">
              ${evs.map((e, i) => `<button class="event-btn ${e[3] || 'neutral'}" data-ev="${i}" data-player="${p.id}">${UI.esc(evName(e))}</button>`).join('')}
            </div>
          </div>`).join('') : `<p style="color:var(--muted)">${activeCat === 'keeper' ? T('scout.noKeepers') : T('scout.noPlayers')}</p>`}
      </div>`;

    mount.innerHTML = `
      <div class="page-head">
        <div><h1>${T('scout.title')}</h1><p>${T('scout.subtitle')} · ${UI.esc(SPORTS.name(sport, I18N.getLang()))}</p></div>
        <div class="head-acts">
          <select id="matchSel" style="max-width:280px">${matches.length ? matches.map(m => `<option value="${m.id}" ${m.id === matchId ? 'selected' : ''}>${UI.esc(m.home ? T('common.vs') : T('common.at'))} ${UI.esc(m.opponent)} · ${SPORTS.name(m.sport || 'handball', I18N.getLang())} · ${UI.fmtDate(m.date)}</option>`).join('') : `<option value="">${T('scout.noMatches')}</option>`}</select>
          <button class="btn" id="modeBtn">${quick ? '▦ ' + T('scout.gridMode') : '\u26a1 ' + T('scout.quickMode')}</button>
          <button class="btn" id="focusBtn">🎯 ${T('scout.focus')} (${tabs.length}/${cats.length})</button>
          ${lineup ? `<span class="tag green" title="${UI.esc(T('matches.squadHint'))}">👥 ${playing.length}/${players.length}</span>` : ''}
        </div>
      </div>
      <div class="scoreboard">
        <div style="text-align:center"><div style="color:var(--muted);font-size:12px">${UI.esc(team ? team.name : T('scout.home'))}</div><div class="score" id="ourScore">${goals}</div></div>
        <div style="text-align:center"><div class="clock" id="clock">${UI.fmtClock(clock)}</div><div style="margin-top:8px"><button class="btn sm primary" id="startBtn">${T('scout.start')}</button> <button class="btn sm" id="resetBtn">${T('scout.reset')}</button></div></div>
        <div style="text-align:center"><div style="color:var(--muted);font-size:12px">${UI.esc(match ? match.opponent : T('scout.opponent'))}</div><div class="score">${match ? (match.home ? match.awayScore : match.homeScore) : 0}</div></div>
      </div>
      <div class="scout-grid">
        <div>${quick ? quickBody : gridBody}</div>
        ${UI.acc('scoutLog', T('scout.eventLog'), `<div class="event-log">${logHtml(events)}</div>`, {
      sub: events.length + ' ' + T('scout.events'),
      actions: UI.shareBar('matches', { exportLabel: T('scout.exportBtn'), importLabel: T('scout.importBtn') })
        + `<button class="btn sm danger" id="clearLog" ${events.length ? '' : 'disabled'}>🗑 ${T('scout.clearLog')}</button>`
    })}
      </div>`;

    UI.bindAcc(mount);
    UI.bindShare(mount, 'matches', render, { scoped: true });
    mount.querySelector('#matchSel').onchange = e => { matchId = e.target.value; render(); };
    mount.querySelector('#modeBtn').onclick = () => setMode(quick ? 'grid' : 'quick');
    mount.querySelector('#focusBtn').onclick = focusDialog;
    mount.querySelector('#startBtn').onclick = toggleClock;
    mount.querySelector('#resetBtn').onclick = () => { clock = 0; stopClock(); mount.querySelector('#clock').textContent = UI.fmtClock(0); };
    if (quick) {
      mount.querySelectorAll('[data-qp]').forEach(b => b.onclick = () => selectPlayer(b.dataset.qp));
      mount.querySelectorAll('[data-qev]').forEach(b => b.onclick = () => {
        if (!activePlayer) return UI.toast(T('scout.pickPlayer'), 'error');
        const c = tabs.find(x => x.id === b.dataset.qcat);
        if (!c) return;
        b.classList.add('hit');
        setTimeout(() => b.classList.remove('hit'), 350);
        logEvent(evsOf(c)[+b.dataset.qev], activePlayer, c.id);
      });
      mount.querySelector('#qsUndo').onclick = undoLast;
    } else {
      mount.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { activeCat = b.dataset.cat; render(); });
      mount.querySelectorAll('[data-ev]').forEach(b => b.onclick = () => logEvent(evs[+b.dataset.ev], b.dataset.player, activeCat));
    }
    bindLog();
    mount.querySelector('#clearLog').onclick = () => clearLog(Store.matchEvents(matchId));
  }

  function logHtml(events) {
    return events.map(e => {
      const p = Store.find('players', e.playerId);
      return `<div class="log-item"><span><span class="log-time">${UI.fmtClock((e.minute || 0) * 60)}</span> ${UI.esc(evLabel(e.type))} ${e.result === 'goal' ? '&#9917;' : ''} — ${p ? '#' + UI.esc(p.number) + ' ' + UI.esc(p.lastName) : ''}</span><button class="btn sm danger" data-rmev="${e.id}">${T('scout.remove')}</button></div>`;
    }).join('') || `<p style="color:var(--muted)">${T('scout.noEvents')}</p>`;
  }
  function bindLog() {
    mount.querySelectorAll('[data-rmev]').forEach(b => b.onclick = () => removeEvent(Store.find('events', b.dataset.rmev)));
  }

  // Switching player must not rebuild the panels — during a match that would
  // throw away the scroll position between two taps.
  function selectPlayer(id) {
    activePlayer = id;
    mount.querySelectorAll('.qs-player').forEach(b => b.classList.toggle('active', b.dataset.qp === id));
    const off = !isKeeper(id);
    mount.querySelectorAll('.qs-panel[data-qcat="keeper"]').forEach(sec => {
      sec.classList.toggle('off', off);
      sec.querySelectorAll('.event-btn').forEach(b => { b.disabled = off; });
      const note = sec.querySelector('.qs-off-note');
      if (note) note.classList.toggle('hidden', !off);
    });
  }

  // Only the score and the log move when an event is registered, so a tap costs
  // one paint instead of a full re-render of every button on screen.
  function refreshLive() {
    const events = Store.matchEvents(matchId).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const score = mount.querySelector('#ourScore');
    if (score) score.textContent = events.filter(e => e.result === 'goal').length;
    const log = mount.querySelector('.event-log');
    if (log) { log.innerHTML = logHtml(events); bindLog(); }
    const sub = mount.querySelector('[data-acc="scoutLog"] .acc-sub');
    if (sub) sub.textContent = events.length + ' ' + T('scout.events');
    ['#clearLog', '#qsUndo'].forEach(sel => { const b = mount.querySelector(sel); if (b) b.disabled = !events.length; });
  }

  async function removeEvent(evt) {
    if (!evt) return;
    await Store.remove('events', evt.id);
    // A goal bumped the match record on the way in, so it has to come back off
    // again — otherwise a mis-tap leaves the result permanently one too high.
    if (evt.result === 'goal') {
      const m = Store.find('matches', matchId);
      if (m) {
        const f = m.home ? 'homeScore' : 'awayScore';
        await Store.save('matches', Object.assign({}, m, { [f]: Math.max(0, (+m[f] || 0) - 1) }));
      }
    }
    refreshLive();
  }

  async function undoLast() {
    const last = Store.matchEvents(matchId).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
    if (!last) return;
    await removeEvent(last);
    UI.toast(T('scout.undone'), 'success');
  }

  // Wipe every event of THIS match only — the other fixtures keep their log.
  function clearLog(events) {
    if (!events.length) return;
    UI.confirm(T('scout.clearLogAsk').replace('{0}', events.length), async () => {
      for (const e of events) await Store.remove('events', e.id);
      const m = Store.find('matches', matchId);
      const ours = m && (m.home ? 'homeScore' : 'awayScore'); // only scouting ever bumps our own side
      if (m && m[ours]) await Store.save('matches', Object.assign({}, m, { [ours]: 0 }));
      UI.toast(T('scout.cleared'));
      render();
    });
  }

  // Pick the focus areas — and the single actions inside them — that matter in
  // this match. Everything else disappears from the buttons, so the ones that
  // are left are bigger and easier to hit on a tablet at the side of the court.
  function focusDialog() {
    const lang = I18N.getLang();
    UI.modal({
      title: T('scout.focusTitle'),
      width: 720,
      body: `
        <p class="hint" style="margin-top:0">${T('scout.focusHint')}</p>
        <div class="focus-acts">
          <button type="button" class="btn sm" data-all>${T('scout.focusAll')}</button>
          <button type="button" class="btn sm" data-none>${T('scout.focusNone')}</button>
        </div>
        <div class="focus-list">
          ${cats.map(c => `
            <div class="focus-cat ${focusOff.cats[c.id] ? 'off' : ''}" data-cat="${UI.esc(c.id)}">
              <label class="check-row focus-head"><input type="checkbox" data-fcat="${UI.esc(c.id)}" ${focusOff.cats[c.id] ? '' : 'checked'}><span>${UI.esc(catLabel(c))}</span></label>
              <div class="focus-evs">
                ${c.ev.map(e => `<label class="check-row"><input type="checkbox" data-fev="${UI.esc(evKey(c, e))}" ${focusOff.evs[evKey(c, e)] ? '' : 'checked'}><span>${UI.esc(lang === 'da' ? e[1] : e[0])}</span></label>`).join('')}
              </div>
            </div>`).join('')}
        </div>`,
      footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button><button class="btn primary" data-save>${T('common.save')}</button>`,
      onOpen: (m, close) => {
        const catBoxes = [...m.querySelectorAll('[data-fcat]')];
        const evBoxes = [...m.querySelectorAll('[data-fev]')];
        const syncCat = box => box.closest('.focus-cat').classList.toggle('off', !box.checked);
        catBoxes.forEach(box => box.onchange = () => {
          // Ticking a whole area brings its actions back; clearing it hides them.
          box.closest('.focus-cat').querySelectorAll('[data-fev]').forEach(b => { b.checked = box.checked; });
          syncCat(box);
        });
        evBoxes.forEach(box => box.onchange = () => {
          const wrap = box.closest('.focus-cat');
          const head = wrap.querySelector('[data-fcat]');
          if (box.checked && !head.checked) head.checked = true;
          if (![...wrap.querySelectorAll('[data-fev]')].some(b => b.checked)) head.checked = false;
          syncCat(head);
        });
        const setAll = on => { catBoxes.concat(evBoxes).forEach(b => { b.checked = on; }); catBoxes.forEach(syncCat); };
        m.querySelector('[data-all]').onclick = () => setAll(true);
        m.querySelector('[data-none]').onclick = () => setAll(false);
        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-save]').onclick = () => {
          const next = { cats: {}, evs: {} };
          catBoxes.forEach(b => { if (!b.checked) next.cats[b.dataset.fcat] = 1; });
          evBoxes.forEach(b => { if (!b.checked) next.evs[b.dataset.fev] = 1; });
          const kept = cats.filter(c => !next.cats[c.id] && c.ev.some(e => !next.evs[evKey(c, e)]));
          if (!kept.length) return UI.toast(T('scout.focusNeed'), 'error');
          focusOff = next;
          writeFocus();
          if (!kept.some(c => c.id === activeCat)) activeCat = kept[0].id;
          close();
          UI.toast(T('scout.focusSaved'), 'success');
          render();
        };
      }
    });
  }

  async function logEvent(def, playerId, catId) {
    const evt = {
      matchId, playerId,
      category: catId || activeCat, type: def[0], result: def[2],
      minute: Math.floor(clock / 60), createdAt: Date.now()
    };
    await Store.save('events', evt);
    if (def[2] === 'goal') {
      const m = Store.find('matches', matchId);
      if (m) { if (m.home) m.homeScore++; else m.awayScore++; await Store.save('matches', m); }
    }
    UI.toast(evLabel(def[0]) + ' ' + T('scout.logged'), 'success');
    refreshLive();
  }

  function toggleClock() {
    if (timer) stopClock(); else {
      timer = setInterval(() => { clock++; const c = mount.querySelector('#clock'); if (c) c.textContent = UI.fmtClock(clock); }, 1000);
      const b = mount.querySelector('#startBtn'); if (b) { b.textContent = T('scout.pause'); b.classList.remove('primary'); }
    }
  }
  function stopClock() {
    clearInterval(timer); timer = null;
    const b = mount.querySelector('#startBtn'); if (b) { b.textContent = T('scout.start'); b.classList.add('primary'); }
  }

  render();
  return () => stopClock(); // cleanup on route change
};

/* ---------------------------------------------------------------------------
   Live scouting for CrossFit and bodybuilding: a set logger for the gym floor.
   Big buttons, no squad required, and the session survives a page reload because
   the working list is kept in localStorage until it is filed away.
--------------------------------------------------------------------------- */
function strengthScout(mount, sport) {
  const DRAFT = 'stx_scout_sets';
  const oneRm = (kg, reps) => (kg > 0 && reps > 1) ? Math.round(kg * (1 + reps / 30)) : Math.round(kg || 0);
  const esc = s => UI.esc(s);
  const dt = v => { const r = T('seed.' + v); return r === 'seed.' + v ? v : r; };
  const ex = e => UI.langText(e, 'title');   // a drill's title in the chosen language

  const readDraft = () => { try { return JSON.parse(localStorage.getItem(DRAFT) || '[]'); } catch { return []; } };
  const writeDraft = () => { try { localStorage.setItem(DRAFT, JSON.stringify(sets)); } catch { /* private mode */ } };
  const athlete = () => { try { return (localStorage.getItem('stx_athlete_name') || '').trim() || T('personal.me'); } catch { return T('personal.me'); } };

  let sets = readDraft();
  let clock = 0, timer = null, lastSet = 0;

  // Only the drills that belong to this sport, so the picker is not a wall of text.
  const cats = SPORTS.exerciseCategories(sport);
  const drills = Store.all('exercises').filter(e => cats.indexOf(e.category) >= 0)
    .sort((a, b) => ex(a).localeCompare(ex(b)));

  // One row per exercise: what has been done so far, newest session only.
  function totals() {
    const map = new Map();
    for (const s of sets) {
      const cur = map.get(s.ex) || { ex: s.ex, sets: 0, reps: 0, volume: 0, best: 0, bestReps: 0 };
      cur.sets++; cur.reps += s.reps; cur.volume += s.kg * s.reps;
      if (s.kg > cur.best) { cur.best = s.kg; cur.bestReps = s.reps; }
      map.set(s.ex, cur);
    }
    return [...map.values()];
  }

  function render() {
    const rows = totals();
    const totalVolume = rows.reduce((n, r) => n + r.volume, 0);
    mount.innerHTML = `
      <div class="page-head">
        <div><h1>${T('scout.title')}</h1><p>${T('scout.strengthSub')} · ${esc(SPORTS.name(sport, I18N.getLang()))}</p></div>
      </div>

      <div class="scoreboard">
        <div style="text-align:center"><div style="color:var(--muted);font-size:12px">${T('scout.setsDone')}</div><div class="score">${sets.length}</div></div>
        <div style="text-align:center"><div class="clock" id="clock">${UI.fmtClock(clock)}</div>
          <div style="margin-top:8px"><button class="btn sm primary" id="startBtn">${T('scout.start')}</button> <button class="btn sm" id="resetBtn">${T('scout.reset')}</button></div>
          <div style="color:var(--muted);font-size:12px;margin-top:6px" id="restLine">${T('scout.rest')}: ${UI.fmtClock(0)}</div></div>
        <div style="text-align:center"><div style="color:var(--muted);font-size:12px">${T('scout.volume')}</div><div class="score">${Math.round(totalVolume)}<span style="font-size:14px"> kg</span></div></div>
      </div>

      <div class="scout-grid">
        <div class="card">
          <div class="row">
            <label class="field"><span>${T('personal.athlete')}</span><input id="sc_who" maxlength="60" value="${esc(athlete())}"></label>
            <label class="field"><span>${T('scout.workout')}</span><input id="sc_wod" maxlength="80" placeholder="${esc(T('scout.workoutPh'))}"></label>
          </div>
          <label class="field"><span>${T('scout.exercise')}</span>
            <div class="combo">
              <input id="sc_ex" list="scEx" placeholder="${esc(T('scout.exercisePh'))}">
              <select id="sc_exPick"><option value="">${T('teams.pick')}</option>${drills.map(e => `<option value="${esc(ex(e))}">${esc(ex(e))}</option>`).join('')}</select>
            </div>
          </label>
          <datalist id="scEx">${drills.map(e => `<option value="${esc(ex(e))}"></option>`).join('')}</datalist>

          <div class="set-input">
            <label class="field"><span>${T('scout.weight')} (kg)</span>
              <div class="stepper"><button type="button" class="btn" data-step="kg:-2.5" aria-label="-2.5 kg">−</button>
                <input id="sc_kg" type="number" step="any" min="0" value="60" aria-label="${esc(T('scout.weight'))} (kg)">
                <button type="button" class="btn" data-step="kg:2.5" aria-label="+2.5 kg">+</button></div></label>
            <label class="field"><span>${T('scout.reps')}</span>
              <div class="stepper"><button type="button" class="btn" data-step="reps:-1" aria-label="-1 ${esc(T('scout.reps'))}">−</button>
                <input id="sc_reps" type="number" min="1" max="200" value="5" aria-label="${esc(T('scout.reps'))}">
                <button type="button" class="btn" data-step="reps:1" aria-label="+1 ${esc(T('scout.reps'))}">+</button></div></label>
          </div>
          <button class="btn primary block big-log" id="sc_log">＋ ${T('scout.logSet')}</button>
          <p class="hint">${T('scout.logHint')}</p>

          <div class="row" style="flex:0;margin-top:10px;flex-wrap:wrap">
            <button class="btn primary" id="sc_save">${T('scout.saveRecords')}</button>
            <button class="btn danger" id="sc_clear">${T('scout.clearSets')}</button>
          </div>
        </div>

        ${UI.acc('scoutSets', T('scout.sessionTotals'), `
          <div class="table-wrap"><table>
            <thead><tr><th>${T('scout.exercise')}</th><th>${T('scout.sets')}</th><th>${T('scout.reps')}</th><th>${T('scout.volume')}</th><th>${T('scout.best')}</th><th>${T('scout.est1rm')}</th></tr></thead>
            <tbody>${rows.map(r => `<tr>
              <td><strong>${esc(r.ex)}</strong></td><td>${r.sets}</td><td>${r.reps}</td>
              <td>${Math.round(r.volume)} kg</td><td>${r.best} kg × ${r.bestReps}</td>
              <td><span class="tag green">${oneRm(r.best, r.bestReps)} kg</span></td></tr>`).join('')
        || `<tr><td colspan="6" class="empty">${T('scout.noSets')}</td></tr>`}</tbody>
          </table></div>
          <div class="event-log" style="margin-top:12px">
            ${sets.slice().reverse().map((s, i) => `<div class="log-item">
              <span><span class="log-time">${UI.fmtClock(s.at || 0)}</span> ${esc(s.ex)} — <b>${s.kg} kg × ${s.reps}</b></span>
              <button class="btn sm danger" data-rmset="${sets.length - 1 - i}">${T('scout.remove')}</button></div>`).join('')
        || `<p style="color:var(--muted)">${T('scout.noSets')}</p>`}
          </div>`, { sub: sets.length + ' ' + T('scout.sets') })}
      </div>`;

    UI.bindAcc(mount);
    const q = id => mount.querySelector('#' + id);
    q('sc_exPick').onchange = e => { if (e.target.value) q('sc_ex').value = e.target.value; };
    mount.querySelectorAll('[data-step]').forEach(b => b.onclick = () => {
      const [what, by] = b.dataset.step.split(':');
      const el = q(what === 'kg' ? 'sc_kg' : 'sc_reps');
      const next = (+el.value || 0) + parseFloat(by);
      el.value = Math.max(what === 'kg' ? 0 : 1, Math.round(next * 100) / 100);
    });
    q('sc_log').onclick = logSet;
    q('sc_save').onclick = saveRecords;
    q('sc_clear').onclick = () => UI.confirm(T('scout.clearAsk'), () => { sets = []; writeDraft(); render(); });
    q('startBtn').onclick = toggleClock;
    q('resetBtn').onclick = () => { clock = 0; lastSet = 0; stopClock(); render(); };
    mount.querySelectorAll('[data-rmset]').forEach(b => b.onclick = () => {
      sets.splice(+b.dataset.rmset, 1); writeDraft(); render();
    });
    if (timer) { const b = q('startBtn'); b.textContent = T('scout.pause'); b.classList.remove('primary'); }
  }

  function logSet() {
    const ex = mount.querySelector('#sc_ex').value.trim().slice(0, 80);
    if (!ex) return UI.toast(T('scout.needEx'), 'error');
    const kg = Math.max(0, +mount.querySelector('#sc_kg').value || 0);
    const reps = Math.max(1, Math.min(200, +mount.querySelector('#sc_reps').value || 1));
    sets.push({ ex, kg, reps, at: clock });
    lastSet = clock;
    writeDraft();
    if (!timer) toggleClock();          // the first set starts the session clock
    UI.toast(ex + ' ' + kg + ' kg × ' + reps, 'success');
    render();
  }

  // Files the best set of every exercise into the same Personal records the
  // training planner reads, then clears the working list.
  async function saveRecords() {
    const rows = totals();
    if (!rows.length) return UI.toast(T('scout.noSets'), 'error');
    const who = mount.querySelector('#sc_who').value.trim().slice(0, 60) || T('personal.me');
    const wod = mount.querySelector('#sc_wod').value.trim().slice(0, 80);
    try { localStorage.setItem('stx_athlete_name', who); } catch { /* private mode */ }
    await Store.save('personal', {
      playerId: '', playerName: who, sport,
      sessionId: '', sessionTitle: wod,
      date: Date.now(),
      notes: T('scout.fromLive') + (wod ? ' — ' + wod : '') + ' · ' + sets.length + ' ' + T('scout.sets'),
      tests: rows.map(r => ({ name: r.ex, value: r.best, unit: 'kg', reps: r.bestReps }))
    });
    sets = []; writeDraft(); stopClock(); clock = 0;
    UI.toast(T('scout.saved'), 'success');
    render();
  }

  function toggleClock() {
    if (timer) { stopClock(); return; }
    timer = setInterval(() => {
      clock++;
      const c = mount.querySelector('#clock'); if (c) c.textContent = UI.fmtClock(clock);
      const r = mount.querySelector('#restLine'); if (r) r.textContent = T('scout.rest') + ': ' + UI.fmtClock(clock - lastSet);
    }, 1000);
    const b = mount.querySelector('#startBtn'); if (b) { b.textContent = T('scout.pause'); b.classList.remove('primary'); }
  }
  function stopClock() {
    clearInterval(timer); timer = null;
    const b = mount.querySelector('#startBtn'); if (b) { b.textContent = T('scout.start'); b.classList.add('primary'); }
  }

  render();
  return () => stopClock();
}

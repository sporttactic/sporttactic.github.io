/* Live Scouting view */
window.Views = window.Views || {};
Views.scouting = function (mount, params) {
  const team = Store.all('teams')[0];
  const matches = Store.all('matches');
  let matchId = (params && params.matchId) || (matches[0] && matches[0].id);
  // Not Active players are excluded — they cannot take part in the match.
  const players = Store.all('players').filter(p => p.teamId === (team && team.id) && p.status !== 'suspended');
  const sport = (window.App && App.getSport && App.getSport()) || 'handball';

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
  const keepers = players.filter(p => p.position === 'Goalkeeper');

  const cats = (SPORT_EVENTS[sport] || SPORT_EVENTS.handball).concat(hasKeeper ? [GK_CAT] : []);
  // en → da lookup across all sports so the event log translates historic events.
  const EV_LABELS = {};
  Object.values(SPORT_EVENTS).forEach(list => list.forEach(c => c.ev.forEach(e => { EV_LABELS[e[0]] = e[1]; })));
  GK_CAT.ev.forEach(e => { EV_LABELS[e[0]] = e[1]; });
  const catLabel = c => (I18N.getLang() === 'da' ? c.da : c.en);
  const evLabel = t => (I18N.getLang() === 'da' ? (EV_LABELS[t] || t) : t);
  const curCat = () => cats.find(c => c.id === activeCat) || cats[0];

  let clock = 0, timer = null, activeCat = cats[0].id;

  function render() {
    const match = Store.find('matches', matchId);
    const events = Store.matchEvents(matchId).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const goals = events.filter(e => e.result === 'goal').length;
    // The Goalkeeper tab only registers on keepers.
    const rows = activeCat === 'keeper' ? keepers : players;
    mount.innerHTML = `
      <div class="page-head">
        <div><h1>${T('scout.title')}</h1><p>${T('scout.subtitle')} · ${UI.esc(SPORTS.name(sport, I18N.getLang()))}</p></div>
        <select id="matchSel" style="max-width:280px">${matches.length ? matches.map(m => `<option value="${m.id}" ${m.id === matchId ? 'selected' : ''}>${UI.esc(m.home ? T('common.vs') : T('common.at'))} ${UI.esc(m.opponent)} · ${SPORTS.name(m.sport || 'handball', I18N.getLang())} · ${UI.fmtDate(m.date)}</option>`).join('') : `<option value="">${T('scout.noMatches')}</option>`}</select>
      </div>
      <div class="scoreboard">
        <div style="text-align:center"><div style="color:var(--muted);font-size:12px">${UI.esc(team ? team.name : T('scout.home'))}</div><div class="score" id="ourScore">${goals}</div></div>
        <div style="text-align:center"><div class="clock" id="clock">${UI.fmtClock(clock)}</div><div style="margin-top:8px"><button class="btn sm primary" id="startBtn">${T('scout.start')}</button> <button class="btn sm" id="resetBtn">${T('scout.reset')}</button></div></div>
        <div style="text-align:center"><div style="color:var(--muted);font-size:12px">${UI.esc(match ? match.opponent : T('scout.opponent'))}</div><div class="score">${match ? (match.home ? match.awayScore : match.homeScore) : 0}</div></div>
      </div>
      <div class="scout-grid">
        <div>
          <div class="pill-row">
            ${cats.map(c => `<span class="pill ${c.id === activeCat ? 'active' : ''}" data-cat="${c.id}">${UI.esc(catLabel(c))}</span>`).join('')}
          </div>
          <div class="player-events">
            ${rows.length ? rows.map(p => `
              <div class="player-row">
                <span class="player-tag">${p.position === 'Goalkeeper' ? '🧤 ' : ''}#${p.number} ${UI.esc(p.lastName)}</span>
                <div class="pev">
                  ${curCat().ev.map((e, i) => `<button class="event-btn ${e[3]}" data-ev="${i}" data-player="${p.id}">${UI.esc(I18N.getLang() === 'da' ? e[1] : e[0])}</button>`).join('')}
                </div>
              </div>`).join('') : `<p style="color:var(--muted)">${activeCat === 'keeper' ? T('scout.noKeepers') : T('scout.noPlayers')}</p>`}
          </div>
        </div>
        <div class="card">
          <h3>${T('scout.eventLog')} <span class="tag">${events.length}</span></h3>
          <div class="event-log">
            ${events.map(e => {
              const p = Store.find('players', e.playerId);
              return `<div class="log-item"><span><span class="log-time">${UI.fmtClock((e.minute || 0) * 60)}</span> ${UI.esc(evLabel(e.type))} ${e.result === 'goal' ? '&#9917;' : ''} — ${p ? '#' + p.number + ' ' + UI.esc(p.lastName) : ''}</span><button class="btn sm danger" data-rmev="${e.id}">${T('scout.remove')}</button></div>`;
            }).join('') || `<p style="color:var(--muted)">${T('scout.noEvents')}</p>`}
          </div>
        </div>
      </div>`;

    mount.querySelector('#matchSel').onchange = e => { matchId = e.target.value; render(); };
    mount.querySelector('#startBtn').onclick = toggleClock;
    mount.querySelector('#resetBtn').onclick = () => { clock = 0; stopClock(); mount.querySelector('#clock').textContent = UI.fmtClock(0); };
    mount.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { activeCat = b.dataset.cat; render(); });
    mount.querySelectorAll('[data-ev]').forEach(b => b.onclick = () => logEvent(curCat().ev[+b.dataset.ev], b.dataset.player));
    mount.querySelectorAll('[data-rmev]').forEach(b => b.onclick = async () => { await Store.remove('events', b.dataset.rmev); render(); });
  }

  async function logEvent(def, playerId) {
    const evt = {
      matchId, playerId,
      category: activeCat, type: def[0], result: def[2],
      minute: Math.floor(clock / 60), createdAt: Date.now()
    };
    await Store.save('events', evt);
    if (def[2] === 'goal') {
      const m = Store.find('matches', matchId);
      if (m) { if (m.home) m.homeScore++; else m.awayScore++; await Store.save('matches', m); }
    }
    UI.toast(evLabel(def[0]) + ' ' + T('scout.logged'), 'success');
    render();
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

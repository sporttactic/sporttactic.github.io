/* Statistics view */
window.Views = window.Views || {};
Views.statistics = function (mount) {
  const team = Store.activeTeam();
  // Position names are translated through pos.* when a translation exists.
  const tt = (p, v) => { const k = p + '.' + v; const r = T(k); return r === k ? (v || '') : r; };
  // Injured and Not Active players are left out of the leaderboard.
  const players = Store.players(team && team.id).filter(p => p.status !== 'injured' && p.status !== 'suspended');
  const matches = Store.matches().filter(m => m.status === 'finished');

  // aggregate team stats across finished matches
  const agg = { goals: 0, shots: 0, assists: 0, turnovers: 0, fastbreaks: 0, saves: 0, suspensions: 0 };
  matches.forEach(m => { const s = Store.teamStats(m.id); Object.keys(agg).forEach(k => agg[k] += s[k]); });
  const shotPct = agg.shots ? Math.round(agg.goals / agg.shots * 100) : 0;

  const rows = players.map(p => ({ p, s: Store.playerStats(p.id) }))
    .sort((a, b) => b.s.goals - a.s.goals);

  const cards = `
    <div class="grid cols-4">
      ${UI.statCard(agg.goals, T('stat.totalGoals'))}
      ${UI.statCard(shotPct + '%', T('stat.shootingPct'))}
      ${UI.statCard(agg.assists, T('stat.assists'))}
      ${UI.statCard(agg.turnovers, T('stat.turnovers'))}
      ${UI.statCard(agg.fastbreaks, T('stat.fastBreaks'))}
      ${UI.statCard(agg.saves, T('stat.gkSaves'))}
      ${UI.statCard(agg.suspensions, T('stat.suspensions'))}
      ${UI.statCard(matches.length, T('stat.matches'))}
    </div>`;

  const board = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>${T('stat.player')}</th><th>${T('stat.pos')}</th><th>${T('teams.weight')}</th><th>${T('stat.goals')}</th><th>${T('stat.attempts')}</th><th>${T('stat.shotPct')}</th><th>${T('stat.assists')}</th><th>${T('stat.to')}</th><th>${T('stat.saves')}</th><th>${T('stat.rating')}</th><th></th></tr></thead>
        <tbody>
          ${rows.map(({ p, s }) => `
            <tr>
              <td><div style="display:flex;align-items:center;gap:8px"><span class="avatar">${UI.initials(p.firstName, p.lastName)}</span>${UI.esc([p.firstName, p.lastName].filter(Boolean).join(' ').trim())}</div></td>
              <td>${UI.esc(tt('pos', p.position))}</td>
              <td>${p.weight ? p.weight + ' kg' : '—'}</td>
              <td><strong>${s.goals}</strong></td>
              <td>${s.attempts}</td>
              <td><div class="bar-track"><div class="bar-fill" style="width:${s.shotPct}%"></div></div>${s.shotPct}%</td>
              <td>${s.assists}</td>
              <td>${s.turnovers}</td>
              <td>${s.saves}</td>
              <td><span class="tag ${s.rating >= 7 ? 'green' : s.rating >= 5 ? 'amber' : 'red'}">${s.rating}</span></td>
              <td>
                <div class="row-acts">
                  <button class="btn sm" data-pdf="${p.id}" title="${UI.esc(T('stats.playerPdf'))}">⬇ ${T('reports.pdf')}</button>
                  <button class="btn sm" data-chat="${p.id}" title="${UI.esc(T('chat.title'))}">💬 ${T('chat.chat')}</button>
                  <button class="btn sm" data-aip="${p.id}" title="${UI.esc(T('stats.aiPlayer'))}">🤖 ${T('stats.aiTrain')}</button>
                </div>
              </td>
            </tr>`).join('') || `<tr><td colspan="11" class="empty">${T('common.noData')}</td></tr>`}
        </tbody>
      </table>
    </div>`;

  mount.innerHTML = `
    ${AI.section('analytics')}
    <div class="page-head"><div><h1>${T('stats.title')}</h1><p>${T('stats.subtitle')}</p></div></div>
    ${UI.acc('statSeason', T('stats.season'), cards)}
    ${UI.acc('statBoard', T('stats.leaderboard'), board, {
    actions: UI.shareBar('stats', { exportLabel: T('stats.exportBtn'), importLabel: T('stats.importBtn') })
      + `<button class="btn sm" id="chatBoard">💬 ${T('chat.title')}</button>`
  })}`;

  UI.bindAcc(mount);
  UI.bindShare(mount, 'stats', () => App.render(), { scoped: true });
  AI.bind(mount);

  // One player on one page: profile, season totals and every event they were
  // registered for, match by match. Printing it is how a PDF is saved.
  function playerPdf(p) {
    if (!p) return;
    const s = Store.playerStats(p.id);
    const name = ('#' + (p.number || '?') + ' ' + [p.firstName, p.lastName].filter(Boolean).join(' ')).trim();
    const kpi = [
      [s.goals, T('stat.goals')], [s.attempts, T('stat.attempts')], [s.shotPct + '%', T('stat.shotPct')],
      [s.assists, T('stat.assists')], [s.turnovers, T('stat.to')], [s.saves, T('stat.saves')], [s.rating, T('stat.rating')]
    ].map(k => `<div><b>${UI.esc(k[0])}</b><span>${UI.esc(k[1])}</span></div>`).join('');
    const profile = [
      [T('stat.pos'), tt('pos', p.position)],
      [T('teams.height'), p.height ? p.height + ' cm' : '—'],
      [T('teams.weight'), p.weight ? p.weight + ' kg' : '—'],
      [T('teams.status'), tt('status', p.status || 'active')]
    ].map(r => `<tr><th>${UI.esc(r[0])}</th><td>${UI.esc(r[1])}</td></tr>`).join('');
    // Every logged event for this player, grouped by the match it belongs to.
    const mine = Store.all('events').filter(e => e.playerId === p.id);
    const byMatch = new Map();
    mine.forEach(e => {
      if (!byMatch.has(e.matchId)) byMatch.set(e.matchId, []);
      byMatch.get(e.matchId).push(e);
    });
    const perMatch = [...byMatch.entries()].map(([mid, list]) => {
      const m = Store.find('matches', mid);
      const tally = {};
      list.forEach(e => { tally[e.type] = (tally[e.type] || 0) + 1; });
      const when = m ? UI.fmtDate(m.date) : '—';
      const who = m ? ((m.home ? T('common.vs') : T('common.at')) + ' ' + m.opponent) : '—';
      const what = Object.keys(tally).sort().map(k => k + ' × ' + tally[k]).join(', ');
      return `<tr><td>${UI.esc(when)}</td><td>${UI.esc(who)}</td><td>${UI.esc(what)}</td></tr>`;
    }).join('');
    const html = `<div class="kpi">${kpi}</div>`
      + `<h2>${T('stats.profile')}</h2><table>${profile}</table>`
      + `<h2>${T('stats.perMatch')}</h2>`
      + (perMatch ? `<table><thead><tr><th>${T('training.date')}</th><th>${T('matches.opponent')}</th><th>${T('scout.events')}</th></tr></thead><tbody>${perMatch}</tbody></table>`
        : `<p class="none">${T('common.noData')}</p>`);
    const sub = [team && team.name, SPORTS.name(App.getSport(), I18N.getLang()), matches.length + ' ' + T('stat.matches')].filter(Boolean).join(' · ');
    UI.printDoc(T('reports.playerReport') + ' — ' + name, sub, html, () => UI.toast(T('training.popupBlocked'), 'error'));
  }
  mount.querySelectorAll('[data-pdf]').forEach(b => b.onclick = () => playerPdf(Store.find('players', b.dataset.pdf)));

  // Talk the squad through the numbers they just produced.
  mount.querySelector('#chatBoard').onclick = () => App.go('messenger', { from: 'statistics' });
  mount.querySelectorAll('[data-chat]').forEach(b => b.onclick = () => {
    const p = Store.find('players', b.dataset.chat);
    if (!p) return;
    const s = Store.playerStats(p.id);
    App.go('messenger', {
      playerId: p.id, playerName: (p.firstName + ' ' + p.lastName).trim(), memberStore: 'players', from: 'statistics',
      draft: `${p.firstName}: ${s.goals} ${T('stat.goals')} / ${s.attempts} (${s.shotPct}%), ${s.assists} ${T('stat.assists')}, ${T('stat.mvpRating')} ${s.rating}.`
    });
  });

  // Per-player read-out: what these numbers say this player should train.
  mount.querySelectorAll('[data-aip]').forEach(b => b.onclick = () => {
    const p = Store.find('players', b.dataset.aip);
    const s = Store.playerStats(p.id);
    AI.report({
      title: T('stats.aiPlayer') + ' — #' + p.number + ' ' + [p.firstName, p.lastName].filter(Boolean).join(' ').trim(),
      task: `What should #${p.number} ${p.firstName} ${p.lastName} (${p.position}) train?\n`
        + `Their numbers: ${s.goals} goals from ${s.attempts} attempts (${s.shotPct}%), ${s.assists} assists, ${s.turnovers} turnovers, ${s.saves} saves, rating ${s.rating}.\n`
        + `Team over ${matches.length} finished matches: ${agg.goals} goals from ${agg.shots} shots (${shotPct}%), ${agg.assists} assists, ${agg.turnovers} turnovers, ${agg.fastbreaks} fast breaks, ${agg.saves} saves.\n`
        + 'Name the two biggest gaps in these numbers, what to train for each, and which drills from our library to use — add the video link for every drill you name.'
        + ' Finish with one measurable target for the next three matches.'
    });
  });
};

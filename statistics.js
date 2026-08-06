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
              <td><div style="display:flex;align-items:center;gap:8px"><span class="avatar">${UI.initials(p.firstName, p.lastName)}</span>${UI.esc(p.lastName)}</div></td>
              <td>${UI.esc(tt('pos', p.position))}</td>
              <td>${p.weight ? p.weight + ' kg' : '—'}</td>
              <td><strong>${s.goals}</strong></td>
              <td>${s.attempts}</td>
              <td><div class="bar-track"><div class="bar-fill" style="width:${s.shotPct}%"></div></div>${s.shotPct}%</td>
              <td>${s.assists}</td>
              <td>${s.turnovers}</td>
              <td>${s.saves}</td>
              <td><span class="tag ${s.rating >= 7 ? 'green' : s.rating >= 5 ? 'amber' : 'red'}">${s.rating}</span></td>
              <td style="white-space:nowrap">
                <button class="btn sm" data-sms="${p.id}" title="${UI.esc(T('sms.title'))}">📱</button>
                <button class="btn sm" data-aip="${p.id}" title="${UI.esc(T('stats.aiPlayer'))}">🤖 ${T('stats.aiTrain')}</button></td>
            </tr>`).join('') || `<tr><td colspan="11" class="empty">${T('common.noData')}</td></tr>`}
        </tbody>
      </table>
    </div>`;

  mount.innerHTML = `
    ${AI.section('analytics')}
    <div class="page-head"><div><h1>${T('stats.title')}</h1><p>${T('stats.subtitle')}</p></div></div>
    ${UI.acc('statSeason', T('stats.season'), cards)}
    ${UI.acc('statBoard', T('stats.leaderboard'), board, {
    actions: `<button class="btn sm" id="smsBoard">📱 ${T('sms.title')}</button>`
  })}`;

  UI.bindAcc(mount);
  AI.bind(mount);

  // Text the squad the numbers they just produced.
  mount.querySelector('#smsBoard').onclick = () => SMS.compose({
    players, title: T('sms.title') + ' — ' + T('stats.leaderboard')
  });
  mount.querySelectorAll('[data-sms]').forEach(b => b.onclick = () => {
    const p = Store.find('players', b.dataset.sms);
    if (!p) return;
    const s = Store.playerStats(p.id);
    SMS.compose({
      players: [p],
      title: T('sms.title') + ' — ' + (p.firstName + ' ' + p.lastName).trim(),
      text: `${p.firstName}: ${s.goals} ${T('sms.goals')} / ${s.attempts} (${s.shotPct}%), ${s.assists} ${T('sms.assists')}, ${T('sms.rating')} ${s.rating}.`
    });
  });

  // Per-player read-out: what these numbers say this player should train.
  mount.querySelectorAll('[data-aip]').forEach(b => b.onclick = () => {
    const p = Store.find('players', b.dataset.aip);
    const s = Store.playerStats(p.id);
    AI.report({
      title: T('stats.aiPlayer') + ' — #' + p.number + ' ' + p.lastName,
      task: `What should #${p.number} ${p.firstName} ${p.lastName} (${p.position}) train?\n`
        + `Their numbers: ${s.goals} goals from ${s.attempts} attempts (${s.shotPct}%), ${s.assists} assists, ${s.turnovers} turnovers, ${s.saves} saves, rating ${s.rating}.\n`
        + `Team over ${matches.length} finished matches: ${agg.goals} goals from ${agg.shots} shots (${shotPct}%), ${agg.assists} assists, ${agg.turnovers} turnovers, ${agg.fastbreaks} fast breaks, ${agg.saves} saves.\n`
        + 'Name the two biggest gaps in these numbers, what to train for each, and which drills from our library to use — add the video link for every drill you name.'
        + ' Finish with one measurable target for the next three matches.'
    });
  });
};

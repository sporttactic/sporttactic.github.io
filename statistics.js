/* Statistics view */
window.Views = window.Views || {};
Views.statistics = function (mount) {
  const team = Store.all('teams')[0];
  // Injured and Not Active players are left out of the leaderboard.
  const players = Store.all('players').filter(p => p.teamId === (team && team.id) && p.status !== 'injured' && p.status !== 'suspended');
  const matches = Store.all('matches').filter(m => m.status === 'finished');

  // aggregate team stats across finished matches
  const agg = { goals: 0, shots: 0, assists: 0, turnovers: 0, fastbreaks: 0, saves: 0, suspensions: 0 };
  matches.forEach(m => { const s = Store.teamStats(m.id); Object.keys(agg).forEach(k => agg[k] += s[k]); });
  const shotPct = agg.shots ? Math.round(agg.goals / agg.shots * 100) : 0;

  const rows = players.map(p => ({ p, s: Store.playerStats(p.id) }))
    .sort((a, b) => b.s.goals - a.s.goals);

  mount.innerHTML = `
    <div class="page-head"><div><h1>${T('stats.title')}</h1><p>${T('stats.subtitle')}</p></div></div>
    <div class="grid cols-4">
      ${UI.statCard(agg.goals, 'Total Goals')}
      ${UI.statCard(shotPct + '%', 'Shooting %')}
      ${UI.statCard(agg.assists, 'Assists')}
      ${UI.statCard(agg.turnovers, 'Turnovers')}
      ${UI.statCard(agg.fastbreaks, 'Fast Breaks')}
      ${UI.statCard(agg.saves, 'GK Saves')}
      ${UI.statCard(agg.suspensions, '2-min Suspensions')}
      ${UI.statCard(matches.length, 'Matches')}
    </div>
    <h3 style="margin:20px 0 10px">Player Leaderboard</h3>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Player</th><th>Pos</th><th>Goals</th><th>Attempts</th><th>Shot %</th><th>Assists</th><th>TO</th><th>Saves</th><th>Rating</th></tr></thead>
        <tbody>
          ${rows.map(({ p, s }) => `
            <tr>
              <td><div style="display:flex;align-items:center;gap:8px"><span class="avatar">${UI.initials(p.firstName, p.lastName)}</span>${UI.esc(p.lastName)}</div></td>
              <td>${UI.esc(p.position)}</td>
              <td><strong>${s.goals}</strong></td>
              <td>${s.attempts}</td>
              <td><div class="bar-track"><div class="bar-fill" style="width:${s.shotPct}%"></div></div>${s.shotPct}%</td>
              <td>${s.assists}</td>
              <td>${s.turnovers}</td>
              <td>${s.saves}</td>
              <td><span class="tag ${s.rating >= 7 ? 'green' : s.rating >= 5 ? 'amber' : 'red'}">${s.rating}</span></td>
            </tr>`).join('') || `<tr><td colspan="9" class="empty">${T('common.noData')}</td></tr>`}
        </tbody>
      </table>
    </div>`;
};

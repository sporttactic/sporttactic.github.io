/* Dashboard view */
window.Views = window.Views || {};
Views.dashboard = function (mount) {
  const teams = Store.all('teams');
  const players = Store.all('players');
  const matches = Store.all('matches').slice().sort((a, b) => a.date - b.date);
  const now = Date.now();
  const next = matches.find(m => m.date >= now && m.status !== 'finished');
  const last = matches.filter(m => m.status === 'finished').sort((a, b) => b.date - a.date)[0];
  const injuries = players.filter(p => p.status === 'injured');
  const finished = matches.filter(m => m.status === 'finished');
  const wins = finished.filter(m => (m.home ? m.homeScore > m.awayScore : m.awayScore > m.homeScore)).length;

  mount.innerHTML = `
    <div class="page-head">
      <div><h1>${T('dash.title')}</h1><p>${T('dash.overviewFor')} ${UI.esc(teams[0] ? teams[0].name : T('dash.yourTeam'))}</p></div>
      <button class="btn primary" data-route-link="scouting">${T('dash.startScouting')}</button>
    </div>
    <div class="grid cols-4">
      ${UI.statCard(teams.length, T('dash.teams'))}
      ${UI.statCard(players.length, T('dash.players'))}
      ${UI.statCard(finished.length, T('dash.matchesPlayed'))}
      ${UI.statCard(wins + T('result.W'), T('dash.wins'), { dir: 'up', text: finished.length ? Math.round(wins / finished.length * 100) + '% ' + T('dash.winRate') : '—' })}
    </div>

    <div class="grid cols-2" style="margin-top:16px">
      <div class="card">
        <h3>${T('dash.nextMatch')}</h3>
        ${next ? `<p style="font-size:16px;font-weight:600">${UI.esc(next.home ? T('common.vs') : T('common.at'))} ${UI.esc(next.opponent)}</p>
          <p style="color:var(--muted)">${UI.fmtDate(next.date)} · ${UI.esc(next.type)} · ${UI.esc(next.venue || '')}</p>` : `<p style="color:var(--muted)">${T('dash.noUpcoming')}</p>`}
      </div>
      <div class="card">
        <h3>${T('dash.lastResult')}</h3>
        ${last ? `<p style="font-size:22px;font-weight:800">${last.homeScore} : ${last.awayScore}</p>
          <p style="color:var(--muted)">${UI.esc(last.home ? T('common.vs') : T('common.at'))} ${UI.esc(last.opponent)} · ${UI.fmtDate(last.date)}</p>` : `<p style="color:var(--muted)">${T('dash.noPlayed')}</p>`}
      </div>
    </div>

    <div class="grid cols-2" style="margin-top:16px">
      <div class="card">
        <h3>${T('dash.injuries')}</h3>
        ${injuries.length ? injuries.map(p => `<div style="display:flex;justify-content:space-between;padding:6px 0"><span>${UI.esc(p.firstName)} ${UI.esc(p.lastName)}</span><span class="tag red">${T('status.injured')}</span></div>`).join('') : `<p style="color:var(--muted)">${T('dash.fullSquad')}</p>`}
      </div>
      <div class="card">
        <h3>${T('dash.teamForm')}</h3>
        <div class="pill-row" style="margin:0">
          ${finished.slice(-5).map(m => {
            const w = m.home ? m.homeScore > m.awayScore : m.awayScore > m.homeScore;
            const d = m.homeScore === m.awayScore;
            return `<span class="tag ${w ? 'green' : d ? 'amber' : 'red'}">${w ? T('result.W') : d ? T('result.D') : T('result.L')}</span>`;
          }).join('') || `<span style="color:var(--muted)">${T('common.noData')}</span>`}
        </div>
        <p style="color:var(--muted);margin-top:10px">${T('dash.formTrend')}</p>
      </div>
    </div>`;

  mount.querySelectorAll('[data-route-link]').forEach(b => b.onclick = () => App.go(b.dataset.routeLink));
};

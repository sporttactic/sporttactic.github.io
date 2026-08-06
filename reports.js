/* Reports view — generate & export */
window.Views = window.Views || {};
Views.reports = function (mount) {
  const team = Store.all('teams')[0];
  const matches = Store.all('matches').filter(m => m.status === 'finished');
  const players = Store.all('players').filter(p => p.teamId === (team && team.id));

  mount.innerHTML = `
    <div class="page-head"><div><h1>${T('reports.title')}</h1><p>Generate &amp; export match, player, team &amp; season reports</p></div></div>
    <div class="grid cols-3">
      <div class="card"><h3>${T('reports.matchReport')}</h3>
        <select id="mSel">${matches.map(m => `<option value="${m.id}">${UI.esc(m.opponent)} · ${UI.fmtDate(m.date)}</option>`).join('') || `<option>${T('common.noData')}</option>`}</select>
        <button class="btn primary sm" id="genMatch" style="margin-top:10px">${T('common.new')}</button></div>
      <div class="card"><h3>${T('reports.playerReport')}</h3>
        <select id="pSel">${players.map(p => `<option value="${p.id}">#${p.number} ${UI.esc(p.lastName)}</option>`).join('')}</select>
        <button class="btn primary sm" id="genPlayer" style="margin-top:10px">${T('common.new')}</button></div>
      <div class="card"><h3>${T('reports.seasonReport')}</h3>
        <button class="btn primary sm" id="genSeason" style="margin-top:34px">${T('common.new')}</button></div>
    </div>
    <div id="reportOut" style="margin-top:16px"></div>`;

  const out = mount.querySelector('#reportOut');

  function showReport(title, html, exportRows) {
    out.innerHTML = `<div class="card"><div style="display:flex;justify-content:space-between;align-items:center">
      <h3 style="margin:0">${UI.esc(title)}</h3>
      <div><button class="btn sm" id="expCsv">${T('reports.csv')}</button> <button class="btn sm" id="expPrint">${T('reports.print')}</button></div></div>
      <div id="repBody" style="margin-top:12px">${html}</div></div>`;
    out.querySelector('#expPrint').onclick = () => {
      const w = window.open('', '_blank');
      w.document.write(`<html><head><title>${UI.esc(title)}</title><style>body{font-family:system-ui;padding:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px 10px;text-align:left}</style></head><body><h1>${UI.esc(title)}</h1>${html}</body></html>`);
      w.document.close(); w.print();
    };
    out.querySelector('#expCsv').onclick = () => {
      const csv = exportRows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = title.replace(/\s+/g, '_') + '.csv'; a.click();
    };
  }

  mount.querySelector('#genMatch').onclick = () => {
    const m = Store.find('matches', mount.querySelector('#mSel').value); if (!m) return;
    const s = Store.teamStats(m.id);
    const rows = [['Metric', 'Value'], ['Score', m.homeScore + ':' + m.awayScore], ['Goals', s.goals], ['Shooting %', s.shotPct + '%'], ['Assists', s.assists], ['Turnovers', s.turnovers], ['Fast Breaks', s.fastbreaks], ['Saves', s.saves]];
    showReport('Match Report — ' + m.opponent, tableHtml(rows), rows);
  };
  mount.querySelector('#genPlayer').onclick = () => {
    const p = Store.find('players', mount.querySelector('#pSel').value); if (!p) return;
    const s = Store.playerStats(p.id);
    const rows = [['Metric', 'Value'], ['Name', p.firstName + ' ' + p.lastName], ['Position', p.position], ['Goals', s.goals], ['Attempts', s.attempts], ['Shooting %', s.shotPct + '%'], ['Assists', s.assists], ['Turnovers', s.turnovers], ['Saves', s.saves], ['MVP Rating', s.rating]];
    showReport('Player Report — ' + p.lastName, tableHtml(rows), rows);
  };
  mount.querySelector('#genSeason').onclick = () => {
    const agg = { goals: 0, assists: 0, turnovers: 0, saves: 0 };
    matches.forEach(m => { const s = Store.teamStats(m.id); agg.goals += s.goals; agg.assists += s.assists; agg.turnovers += s.turnovers; agg.saves += s.saves; });
    const wins = matches.filter(m => m.home ? m.homeScore > m.awayScore : m.awayScore > m.homeScore).length;
    const rows = [['Metric', 'Value'], ['Matches', matches.length], ['Wins', wins], ['Goals', agg.goals], ['Assists', agg.assists], ['Turnovers', agg.turnovers], ['Saves', agg.saves]];
    showReport('Season Report — ' + (team ? team.name : ''), tableHtml(rows), rows);
  };

  function tableHtml(rows) {
    return '<div class="table-wrap"><table><thead><tr>' + rows[0].map(h => `<th>${UI.esc(h)}</th>`).join('') + '</tr></thead><tbody>' +
      rows.slice(1).map(r => '<tr>' + r.map(c => `<td>${UI.esc(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>';
  }
};

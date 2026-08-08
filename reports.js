/* Reports view — generate & export */
window.Views = window.Views || {};
Views.reports = function (mount) {
  const team = Store.activeTeam();
  const sportId = (window.App && App.getSport && App.getSport()) || 'handball';
  const matches = Store.matches().filter(m => m.status === 'finished');
  const players = Store.players(team && team.id);
  const fullName = p => [p.firstName, p.lastName].filter(Boolean).join(' ').trim() || ('#' + (p.number || '?'));

  const builders = `
    <div class="grid cols-3">
      <div class="card"><h3>${T('reports.matchReport')}</h3>
        <select id="mSel">${matches.map(m => `<option value="${m.id}">${UI.esc(m.opponent)} · ${UI.fmtDate(m.date)}</option>`).join('') || `<option>${T('common.noData')}</option>`}</select>
        <div class="head-acts" style="margin-top:10px">
          <button class="btn primary sm" id="genMatch">${T('common.new')}</button>
          <button class="btn sm" id="aiMatch">🤖 ${T('reports.aiAnalysis')}</button></div></div>
      <div class="card"><h3>${T('reports.playerReport')}</h3>
        <select id="pSel">${players.map(p => `<option value="${p.id}">#${p.number} ${UI.esc(fullName(p))}</option>`).join('')}</select>
        <div class="head-acts" style="margin-top:10px">
          <button class="btn primary sm" id="genPlayer">${T('common.new')}</button>
          <button class="btn sm" id="aiPlayer">🤖 ${T('reports.aiAnalysis')}</button></div></div>
      <div class="card"><h3>${T('reports.seasonReport')}</h3>
        <div class="head-acts" style="margin-top:34px">
          <button class="btn primary sm" id="genSeason">${T('common.new')}</button>
          <button class="btn sm" id="aiSeason">🤖 ${T('reports.aiAnalysis')}</button></div></div>
    </div>`;

  mount.innerHTML = `
    <div class="page-head"><div><h1>${T('reports.title')}</h1><p>${T('reports.subtitle')}</p></div></div>
    ${UI.acc('reportBuild', T('reports.build'), builders)}
    <div id="reportOut" style="margin-top:16px"></div>`;

  UI.bindAcc(mount);

  const out = mount.querySelector('#reportOut');

  function showReport(title, html, exportRows, chat) {
    out.innerHTML = `<div class="card"><div class="rep-head">
      <h3 style="margin:0">${UI.esc(title)}</h3>
      <div class="head-acts">
        <button class="btn sm" id="expPdf">⬇ ${T('reports.pdf')}</button>
        <button class="btn sm" id="expMail">✉ ${T('reports.email')}</button>
        <button class="btn sm" id="expChat">💬 ${T('chat.title')}</button>
        <button class="btn sm" id="expCsv">${T('reports.csv')}</button>
        <button class="btn sm" id="expPrint">${T('reports.print')}</button>
      </div></div>
      <div id="repBody" style="margin-top:12px">${html}</div></div>`;
    out.querySelector('#expChat').onclick = () => App.go('messenger', {
      from: 'reports',
      draft: (chat && chat.text) || title
    });
    const sub = [team && team.name, SPORTS.name(sportId, I18N.getLang())].filter(Boolean).join(' · ');
    const toPdf = () => UI.printDoc(title, sub, html, () => UI.toast(T('training.popupBlocked'), 'error'));
    out.querySelector('#expPdf').onclick = toPdf;
    out.querySelector('#expPrint').onclick = toPdf;
    // The report as plain text, so it can go straight into a mail body.
    out.querySelector('#expMail').onclick = () => {
      const lines = (exportRows || []).map(r => r.map(c => String(c)).join(': '));
      MAIL.compose({
        players: Store.players(team && team.id),
        subject: title,
        text: [title, sub, ''].concat(lines).join('\n')
      });
    };
    out.querySelector('#expCsv').onclick = () => {
      // A leading =, +, - or @ would make Sheets/Excel treat the cell as a formula.
      const cell = v => { let s = String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
      const csv = exportRows.map(r => r.map(cell).join(',')).join('\r\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
      a.download = title.replace(/\s+/g, '_') + '.csv';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 20000);
    };
  }

  mount.querySelector('#genMatch').onclick = () => {
    const m = Store.find('matches', mount.querySelector('#mSel').value); if (!m) return;
    const s = Store.teamStats(m.id);
    const rows = [[T('stat.metric'), T('stat.value')], [T('stat.score'), m.homeScore + ':' + m.awayScore], [T('stat.goals'), s.goals], [T('stat.shootingPct'), s.shotPct + '%'], [T('stat.assists'), s.assists], [T('stat.turnovers'), s.turnovers], [T('stat.fastBreaks'), s.fastbreaks], [T('stat.saves'), s.saves]];
    showReport(T('reports.matchReport') + ' — ' + m.opponent, tableHtml(rows), rows, {
      text: `${m.opponent} ${m.homeScore}:${m.awayScore} — ${s.goals} ${T('stat.goals')} (${s.shotPct}%), ${s.assists} ${T('stat.assists')}, ${s.turnovers} ${T('stat.turnovers')}.`
    });
  };
  mount.querySelector('#genPlayer').onclick = () => {
    const p = Store.find('players', mount.querySelector('#pSel').value); if (!p) return;
    const s = Store.playerStats(p.id);
    const rows = [[T('stat.metric'), T('stat.value')], [T('stat.name'), fullName(p)], [T('stat.position'), p.position], [T('stat.goals'), s.goals], [T('stat.attempts'), s.attempts], [T('stat.shootingPct'), s.shotPct + '%'], [T('stat.assists'), s.assists], [T('stat.turnovers'), s.turnovers], [T('stat.saves'), s.saves], [T('stat.mvpRating'), s.rating]];
    showReport(T('reports.playerReport') + ' — #' + (p.number || '?') + ' ' + fullName(p), tableHtml(rows), rows, {
      players: [p],
      text: `${fullName(p)}: ${s.goals} ${T('stat.goals')} / ${s.attempts} (${s.shotPct}%), ${s.assists} ${T('stat.assists')}, ${T('stat.mvpRating')} ${s.rating}.`
    });
  };
  mount.querySelector('#genSeason').onclick = () => {
    const agg = { goals: 0, assists: 0, turnovers: 0, saves: 0 };
    matches.forEach(m => { const s = Store.teamStats(m.id); agg.goals += s.goals; agg.assists += s.assists; agg.turnovers += s.turnovers; agg.saves += s.saves; });
    const wins = matches.filter(m => m.home ? m.homeScore > m.awayScore : m.awayScore > m.homeScore).length;
    const rows = [[T('stat.metric'), T('stat.value')], [T('stat.matches'), matches.length], [T('stat.wins'), wins], [T('stat.goals'), agg.goals], [T('stat.assists'), agg.assists], [T('stat.turnovers'), agg.turnovers], [T('stat.saves'), agg.saves]];
    showReport(T('reports.seasonReport') + ' — ' + (team ? team.name : ''), tableHtml(rows), rows, {
      text: `${matches.length} ${T('stat.matches')}, ${wins} ${T('stat.wins')}, ${agg.goals} ${T('stat.goals')}, ${agg.assists} ${T('stat.assists')}.`
    });
  };

  function tableHtml(rows) {
    return '<div class="table-wrap"><table><thead><tr>' + rows[0].map(h => `<th>${UI.esc(h)}</th>`).join('') + '</tr></thead><tbody>' +
      rows.slice(1).map(r => '<tr>' + r.map(c => `<td>${UI.esc(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>';
  }

  // The numbers of the selected report are handed to ChatGPT for a read-out.
  mount.querySelector('#aiMatch').onclick = () => {
    const m = Store.find('matches', mount.querySelector('#mSel').value);
    if (!m) return UI.toast(T('common.noData'), 'error');
    const s = Store.teamStats(m.id);
    AI.report({
      title: T('reports.aiAnalysis') + ' — ' + m.opponent,
      task: `Analyse this match report.\nOpponent: ${m.opponent} (${m.home ? 'home' : 'away'}), ${UI.fmtDate(m.date)}.\n`
        + `Score ${m.homeScore}:${m.awayScore}. Goals ${s.goals} from ${s.shots} shots (${s.shotPct}%), ${s.assists} assists, ${s.turnovers} turnovers, ${s.fastbreaks} fast breaks, ${s.saves} saves, ${s.suspensions} suspensions.\n`
        + 'Give: what went well, the two clearest problems in these numbers, what it means for the next match, and which drills from our library to train — add the video link for every drill you name.'
    });
  };
  mount.querySelector('#aiPlayer').onclick = () => {
    const p = Store.find('players', mount.querySelector('#pSel').value);
    if (!p) return UI.toast(T('common.noData'), 'error');
    const s = Store.playerStats(p.id);
    AI.report({
      title: T('reports.aiAnalysis') + ' — #' + p.number + ' ' + fullName(p),
      task: `Analyse this player report for #${p.number} ${fullName(p)} (${p.position}).\n`
        + `${s.goals} goals from ${s.attempts} attempts (${s.shotPct}%), ${s.assists} assists, ${s.turnovers} turnovers, ${s.saves} saves, rating ${s.rating}.\n`
        + 'Give: their strengths in these numbers, the two biggest gaps, a personal training focus for the next four weeks with drills from our library and their video links, and one measurable target.'
    });
  };
  mount.querySelector('#aiSeason').onclick = () => {
    const agg = { goals: 0, shots: 0, assists: 0, turnovers: 0, fastbreaks: 0, saves: 0, suspensions: 0 };
    matches.forEach(m => { const s = Store.teamStats(m.id); Object.keys(agg).forEach(k => agg[k] += s[k]); });
    const wins = matches.filter(m => m.home ? m.homeScore > m.awayScore : m.awayScore > m.homeScore).length;
    AI.report({
      title: T('reports.aiAnalysis') + ' — ' + (team ? team.name : ''),
      task: `Analyse the season so far: ${matches.length} finished matches, ${wins} wins.\n`
        + `${agg.goals} goals from ${agg.shots} shots (${agg.shots ? Math.round(agg.goals / agg.shots * 100) : 0}%), ${agg.assists} assists, ${agg.turnovers} turnovers, ${agg.fastbreaks} fast breaks, ${agg.saves} saves, ${agg.suspensions} suspensions.\n`
        + 'Give: the trend, the three things that decide the rest of the season, the players carrying the load by shirt number, and a training focus for the next month with drills from our library and their video links.'
    });
  };
};

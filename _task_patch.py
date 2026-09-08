from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding='utf-8-sig')
    if old not in text:
        raise RuntimeError(f'insertion point not found in {path}: {old[:60]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')

# A team-code holder must be a player before any remote data is processed.
replace_once(
    'access.js',
    '  async function adoptRoleKeys(keys) {',
    """  // A team code is a player entry point. Set that role before the first pull so
  // an existing/default Coach role is never used while handling somebody
  // else's shared file. A verified squad-coach word may explicitly promote
  // the device afterward through claimRole().
  async function beginTeamCodeJoin() {
    claiming = true;
    try {
      await Store.setSetting(CLAIM_KEY, null);
      await Store.setSetting('role', 'Player');
    } finally { claiming = false; }
    return 'Player';
  }

  async function adoptRoleKeys(keys) {"""
)
replace_once(
    'access.js',
    '    unclaimed, wordsStale, adoptRoleKeys, teamLock, squadCoach',
    '    unclaimed, wordsStale, beginTeamCodeJoin, adoptRoleKeys, teamLock, squadCoach'
)
replace_once(
    'cloud.js',
    "    const n = await pull('merge');",
    """    // Joining by team code always starts as a player. This happens before
    // pulling so the default Coach role is never used for a code holder.
    // A verified coach word may explicitly promote the device afterward.
    if (window.Access && Access.beginTeamCodeJoin) await Access.beginTeamCodeJoin();
    const n = await pull('merge');"""
)

# Show the exact checked squads whose records will be included on sync.
replace_once(
    'settings.js',
    '''      ${squads.length ? `<div class="menu-picker">${squads.map(squadRow).join('')}</div>
      <div class="row" style="flex:0;margin-top:10px;flex-wrap:wrap">
        <button type="button" class="btn sm" id="mm_tall">''',
    '''      ${squads.length ? `<div class="menu-picker">${squads.map(squadRow).join('')}</div>
      <p class="hint" id="mm_team_sum"></p>
      <div class="row" style="flex:0;margin-top:10px;flex-wrap:wrap">
        <button type="button" class="btn sm" id="mm_tall">'''
)
replace_once(
    'settings.js',
    """      const tall = m.querySelector('#mm_tall');
      if (tall) tall.onclick = () => tboxes.forEach(b => { b.checked = true; });""",
    """      const tall = m.querySelector('#mm_tall');
      // Display the exact checked squads whose rows will enter the sync files.
      const teamSummary = () => {
        const host = m.querySelector('#mm_team_sum');
        if (!host) return;
        const names = tboxes.filter(b => b.checked).map(b => {
          const team = squads.find(t => String(t.id) === String(b.dataset.team));
          return team ? (team.name || team.id) : b.dataset.team;
        });
        host.textContent = names.length
          ? 'Included in sync: ' + names.join(', ')
          : 'Included in sync: no squads';
      };
      tboxes.forEach(b => b.addEventListener('change', teamSummary));
      if (tall) tall.onclick = () => {
        tboxes.forEach(b => { b.checked = true; });
        teamSummary();
      };
      teamSummary();"""
)

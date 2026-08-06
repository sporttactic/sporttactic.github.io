# SportTactic — Tactical Analysis & Coaching Platform (Pure HTML5)

A fully client-side, offline-first handball coaching platform built with **pure HTML5, CSS and vanilla JavaScript** — no build step, no frameworks, no server. All data is stored locally in the browser using **IndexedDB**.

## ?? Running

Just open `index.html` in any modern browser. For full functionality (IndexedDB, video import) it is best served over HTTP:

powershell
# from the project folder
python -m http.server 8080
# then open http://localhost:8080


Or double-click `index.html` directly.

##  Implemented Modules

| Module | Features |
|--------|----------|
| **Dashboard** | Next/last match, injuries, team form, season KPIs |
| **Teams & Players** | Squad management, positions, jersey numbers, status, staff, CRUD |
| **Matches** | Friendly/League/Cup/Tournament, home/away, venue, scores, CRUD |
| **Live Scouting** | Real-time clock, low-latency event logging (attack, defense, GK, fouls, turnovers), live scoreboard, event log |
| **Statistics** | Auto-calculated team & player stats, shooting %, MVP rating, leaderboard |
| **Tactical Board** | Interactive canvas court, players/ball objects, drawing tools (pass, run, arrow, freehand, shapes), multi-frame timeline, **ball shooting with magnet + pass/shot/save detection**, referee whistle (resets & replays), **video recording to WebM/MP4**, JSON export |
| **Video Analysis** | Import MP4/MOV, frame seek, slow-motion/speed, bookmarks & tagging |
| **Training Planner** | Sessions with focus, duration, drill selection |
| **Exercise Library** | Categorized drills with intensity, tags, descriptions, CRUD |
| **Opponent Analysis** | Formations, key players, tendencies, generated scouting reports |
| **Reports** | Match / player / season reports, export to **CSV** and **PDF/Print** |
| **Settings** | Dark/light theme, language, role-based access, backup export/import, data reset |

##  Non-functional Features
- **Offline mode** — everything runs locally via IndexedDB
- **Auto-save** — changes persist instantly; 30s auto-save indicator
- **PWA manifest** — installable on desktop & mobile
- **Dark mode** + responsive/touch layout for tablet & phone
- **Global search** across players, matches, drills, tactics, opponents
- **Keyboard shortcuts** — `1–9` modules, `/` search, `Esc` close
- **English + Danish** menu translation (Settings ? Language)
- **Share data** — Settings ? *Send to Coach* exports JSON and opens your email client
- **Help & Tutorials** — see `help.html` (bilingual, with SVG graphics)

## Project Structure

index.html            app shell
help.html             bilingual help & animated sport tutorials
manifest.webmanifest
styles.css            all styles
db.js                 IndexedDB wrapper
i18n.js               EN/DA dictionaries + translation helper
sports.js             sport definitions: courts, formations, icons
store.js              data cache, seed data, stats engine
ui.js                 modal/toast/format helpers
app.js                router, sport picker, search, theme, shortcuts, autosave
dashboard.js teams.js matches.js scouting.js statistics.js
tactics.js video.js training.js exercises.js opponents.js
reports.js settings.js   one file per module (loaded flat from root)


##  Extending to the full stack
This pure-HTML5 build is the front-end blueprint. To reach the full specification (cloud sync, auth, video processing) it maps onto:
ASP.NET Core / Node.js + PostgreSQL + SignalR + FFmpeg + Azure/AWS storage, using the same entity model defined in `store.js`.

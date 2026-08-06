# SportTactic — Full Feature Test Report

**Date:** 2026-08-05
**Build under test:** `index.html` (app.js?v=13, tactics.js?v=24, video.js?v=16, messenger.js?v=8, styles.css?v=28, i18n.js?v=22)
**Method:** Live browser automation (Chromium/Playwright) against `python -m http.server 8765`, plus source review.
**Scope:** All 13 routes, 18 sports, both languages, data layer, exports, PWA/offline, accessibility, security.

---

## 1. Executive summary

| Area | Result |
| --- | --- |
| Routes render (13/13) | **PASS** — zero console errors on every view |
| Sports surfaces (18/18) | **PASS** — each renders a distinct court/table/board |
| Tactical board | **PASS** — drag, frames, undo/redo, playbook, half-court, animation |
| Data layer (CRUD + persistence) | **PASS** |
| Live scouting → player stats | **PASS** |
| Team/season statistics | **FAIL** — see H-2 |
| Exports (JSON / CSV / print) | **PASS** functionally, **FAIL** on CSV safety (H-3) |
| Private Messenger (live P2P E2E) | **PASS** — verified end-to-end on a real relay |
| Offline / PWA | **FAIL** — see H-1 |
| Accessibility | **FAIL** — see H-4 |
| Security | **FAIL** — see C-1 |

**Total defects: 16** — 1 critical, 4 high, 6 medium, 5 low.
No JavaScript errors or unhandled rejections were observed at any point during the entire run.

---

## 2. What was verified as working

### 2.1 Routing & shell
All 13 views (`dashboard, teams, matches, scouting, statistics, tactics, video, training, exercises, opponents, reports, settings, messenger`) render with content and zero console errors. Globals (`App`, `SPORTS`, `Views`, `UI`, `PLAYBOOK`, `I18N`, `T`) all resolve. Navigation cleanup runs correctly — after 9 rapid route switches the net interval count was **-1** (no timer leaks) and heap stayed at **14 MB**.

### 2.2 Sports engine
All 18 sports render a distinct playing surface (verified by sampling canvas pixels — 18 different corner colours). Canvas buffer is 700×560 full-court and correctly swaps to 700×700 in half-court mode.

### 2.3 Tactical board
Player drag, `＋ Add Frame` (1→2 frames), playbook load (`6-0 Wall` → 4 frames), playbook search filter (30→2 results), half/full court toggle, undo/redo state transitions, and animation playback (auto-returns to `▶ Play`) all behave correctly. 30 tactical systems load per sport.

### 2.4 Data layer
Player create → table row → stat cards → survives re-render. Modals for matches (9 fields), training (5), opponents (4) all open and populate. Exercise category filter works (4→1). Global search, theme toggle (dark↔light), keyboard shortcuts (`3` → matches, `/` → search focus), and sound toggle all function.

### 2.5 Private Messenger — verified live
Two independent `Views.messenger` instances connected over the public MQTT relay using a shared key:

- Both reached **Connected**; peer names exchanged correctly (A shows "Bob", B shows "Alice").
- Messages delivered **both directions** over the WebRTC DataChannel, Unicode (`✅ æøå`) preserved.
- **XSS payload neutralised** — `<img src=x onerror=…>` and `<script>` rendered as literal text; 0 `img` nodes, 0 `script` nodes injected, `window.__pwned` never set.
- **At-rest encryption confirmed** — contacts store held only `keyEnc`, no `key`/`keyText`; message records were `{iv, ct}` with no plaintext leak.
- **Weak-key rejection works** — `short`, `aaaaaaaaaaaaaaaa`, and `abababababab` were all refused.
- Key generator produces valid Crockford base32 (`6182-MSDF-WH5Q-4APR`).

> Note: connection took ~35–40 s in this environment. Worth watching as a UX concern.

### 2.6 Help & docs
`help.html` (149 KB), `license.html`, `oldipads.html` all return 200. Help has **perfect EN/DA parity (157/157)** and all TOC anchors resolve to existing section IDs.

---

## 3. Defects

### CRITICAL

#### C-1 — Same-origin XSS via the Video Analysis stream URL
**File:** [video.js](video.js#L47) (`toEmbed` fallback) → [video.js](video.js#L112) (`showEmbed`)

`toEmbed()` ends with `// Direct file or already-embed URL — return as-is; return url;`. Any string that `new URL()` accepts is passed straight into `<iframe src="…">`. The scheme is never validated.

**Proven exploit.** Pasting this into the Live Stream box and clicking Watch:

```
javascript:window.parent.__xss=1
```

executed **in the SportTactic origin** — the test flag `window.__xss` was set to `1`, and the app cheerfully toasted "Stream loaded".

**Impact:** arbitrary JS in the app origin → read/exfiltrate the entire IndexedDB (all squad, match, scouting and tactics data) and the messenger's identity/contacts stores. Delivery is realistic: a "match video link" pasted from a team chat, email, or QR code.

Also accepted: `data:text/html,<h1>ATTACKER PAGE</h1>…` (renders attacker HTML inside the app — phishing/clickjacking surface), `file:///C:/Windows/win.ini`, and any arbitrary `http://` host. The iframe additionally has **no `sandbox`**, **no `referrerpolicy`**, and a permissive `allow="autoplay; encrypted-media; picture-in-picture; fullscreen"`.

**Fix:** make the fallback fail-closed. Only return URLs the provider branches actually constructed; for direct media require `u.protocol === 'https:'` plus a media extension. Add `sandbox` and `referrerpolicy="no-referrer"` to the iframe.

```js
// replace: return url;
if (u.protocol !== 'https:') return null;
if (!/\.(mp4|webm|ogg|m3u8|mpd)$/i.test(u.pathname)) return null;
return u.href;
```

---

### HIGH

#### H-1 — App is not offline-capable despite claiming to be
**Files:** [index.html](index.html), [manifest.webmanifest](manifest.webmanifest)

There is **no service worker** (`navigator.serviceWorker.getRegistrations()` → `0`). With the network disabled, a cold load fails outright: `net::ERR_INTERNET_DISCONNECTED`. Only *data* is offline (IndexedDB); the app shell is not.

Meanwhile the sidebar shows a green **"Offline Ready"** badge and Settings states *"Offline-first with auto-save every 30s."* For a coaching tool used in sports halls with poor signal, this is the highest-impact functional gap.

**Manifest problems compounding it:**
- Only one icon — an **SVG** declared as `192x192`. Chrome requires 192px **and** 512px raster icons (plus a `maskable` purpose) for installability, so "Add to Home Screen" will be refused.
- `theme_color`/`background_color` are `#0f172a` (slate blue) while the app is now **monochrome** (`--bg #0b0b0b`) — stale brand colour leaks into the splash and status bar. Same stale value in the `<meta name="theme-color">`.
- No `id` field.

#### H-2 — Statistics and reports contradict each other
**Files:** [statistics.js](statistics.js#L6), [reports.js](reports.js#L5)

Both filter to `m.status === 'finished'`, but **Live Scouting logs events against the selected match, which defaults to the next *scheduled* fixture**. `Store.playerStats()` meanwhile aggregates over *all* events regardless of status.

Reproduced: after logging 5 events (2 goals, 1 assist), the Statistics page showed:

| Panel | Goals | Shot % | Assists |
| --- | --- | --- | --- |
| KPI cards ("Total Goals") | **0** | **0%** | **0** |
| Player Leaderboard (same events) | **2** | **40%** | **1** |

Two numbers from one dataset, on one screen, disagreeing. Season Report has the same split (Goals 0 vs Player Report Goals 2). Compounding it, the seeded "finished" match (28:25) has **zero events**, so every team metric reads 0 out of the box.

**Fix:** use one consistent scope — either include in-progress matches in team aggregation, or flip the match to `finished` when scouting ends and surface a "live match" state.

#### H-3 — CSV formula injection in report export
**File:** [reports.js](reports.js#L34)

The CSV writer quotes and doubles `"` but never neutralises leading `=`, `+`, `-`, `@`, tab or CR. Confirmed with a player named `=HYPERLINK("http://evil.example","CLICK")`, the exported file contained:

```csv
"Metric","Value"
"Name","=1+1 =HYPERLINK(""http://evil.example"",""CLICK"")"
```

Excel / LibreOffice / Google Sheets evaluate that on open (CWE-1236). Since player names arrive from teammates via the sync/import features, this is attacker-reachable.

**Fix:** prefix any cell starting with `=+-@\t\r` with a single quote or strip it before quoting.

#### H-4 — Tactical board is entirely keyboard-inaccessible
**File:** [tactics.js](tactics.js)

All **47** interactive chips — 18 sport selectors, 11 drawing tools, 8 training props, and the frame chips — are `DIV`/`SPAN` elements with `tabIndex: -1` and **no `role`**. A Tab-order probe walked 12 stops and reached zero of them; screen readers announce them as `generic`.

This fails **WCAG 2.1.1 (Keyboard)** and **4.1.2 (Name, Role, Value)** — the app's flagship feature cannot be operated without a mouse or touch.

**Fix:** use `<button type="button">`, or add `role="button"` + `tabindex="0"` + Enter/Space handlers.

---

### MEDIUM

#### M-1 — Import Backup is destructive with no confirmation
**File:** [settings.js](settings.js#L114)

`#importAll` immediately runs `DB.clear(s)` then `bulkPut` for every store found in the file — no confirmation, no schema validation, no undo. One mis-picked file silently destroys a whole season. Inconsistent with **Reset Data**, which *does* call `UI.confirm` ([settings.js](settings.js#L146)).

**Fix:** confirm first, validate record shape, and offer merge-vs-replace.

#### M-2 — Statistics view is completely untranslated
**File:** [statistics.js](statistics.js#L20)

In Danish the page renders: *"0 Total Goals, 0% Shooting %, 0 Assists, 0 Turnovers, 0 Fast Breaks, 0 GK Saves, 0 2-min Suspensions, 1 Matches, Player Leaderboard, Player/Pos/Goals/Attempts/Shot %/Assists/TO/Saves/Rating"* — every string hardcoded, none through `T()`. The heading is translated, the entire body is not.

#### M-3 — Tactical board tools untranslated in Danish
**File:** [tactics.js](tactics.js)

Labels and tooltips stay English: `Select, Shoot, Add, Pass, Run, Arrow, Line, Freehand, Circle, Rectangle, Erase`, plus `Frames & Animation`, `Frame N`, and the default play name `New Play`. Jarring next to fully-translated neighbours — and self-contradictory: the Danish hint says *"brug **Slet** for at fjerne"* while the button reads **Erase**.

#### M-4 — Reports view partly untranslated
**File:** [reports.js](reports.js#L9)

Subtitle is hardcoded: `Generate & export match, player, team & season reports`. All generated report content (`Metric`, `Value`, `Score`, `Goals`, `Shooting %`, `MVP Rating`, and the `Match Report — …` titles) is English-only in both languages.

#### M-5 — Play name is never autosaved
**File:** [tactics.js](tactics.js#L238)

`#playName` has **no `oninput`, `onchange` or `onblur` handler** (all verified `false`). `scheduleAutosave()` reads the field, but only fires on *board* edits. Renaming a play and navigating away loses the name — while the header indicator reassuringly reads **"Saved"**. Only the explicit Save button persists it (verified: store kept `New Play` for 2 s after typing; `Save` → `QA Renamed Play`).

#### M-6 — Unsandboxed third-party CDN import, no CSP
**File:** [messenger.js](messenger.js#L687), [index.html](index.html)

The messenger dynamically imports `https://esm.sh/mqtt@5.10.1` at runtime. Pinning the version is good, but dynamic `import()` cannot carry SRI, and there is **no CSP meta tag** anywhere in the app. A compromise of esm.sh yields arbitrary code execution in the app origin with full IndexedDB access. Consider vendoring `mqtt` locally and adding a restrictive CSP.

---

### LOW

#### L-1 — `user-scalable=no` blocks pinch-zoom
[index.html](index.html) viewport is `width=device-width, initial-scale=1.0, user-scalable=no, viewport-fit=cover`. Fails **WCAG 1.4.4 (Resize Text)**. Prefer locking zoom only on the board via `touch-action`.

#### L-2 — Unlabeled form controls
`matchSel` (scouting), `playName`, `courtModeSel`, `botLevelSlider` (tactics), `mSel`, `pSel` (reports) have no `<label>`, `aria-label` or `aria-labelledby`.

#### L-3 — Mojibake in the coach email body
[settings.js](settings.js#L140): `'To load it: open SportTactic ? Settings ? Import Backup ? select the JSON file.'` — the `?` are corrupted `→` arrows, visible to every recipient.

#### L-4 — Heading hierarchy skips h2
11 of 12 views jump `h1 → h3` with no `h2`, breaking screen-reader document outline.

#### L-5 — "Clear chat" is local-only, which the UI doesn't say
Verified: clearing on instance A left instance B's 2 messages intact. Sitting directly beside a **"Disappearing messages"** control, users will reasonably assume it clears both sides. Label it "Clear my copy" or add a hint.

---

## 4. Non-issues (checked, working as designed)

- **140 DA-only `pos.*` / `cat.*` keys with no EN counterpart** — deliberate. `tt(p, v)` in [teams.js](teams.js#L10) falls back to the raw English value when the key is missing. No leakage found: a scan for raw `foo.bar` keys across all 12 views in Danish returned **zero** hits.
- **0 seeded players** — `Store.purgeDemoPlayers()` intentionally removes the demo squad.
- **`\uXXXX` escapes in help.html** — the 6 remaining occurrences are inside a `<script>` chess-glyph map ([help.html](help.html#L686)), which is valid JS, not HTML text.
- **No duplicate element IDs**, no `<img>` missing `alt`, no unnamed buttons anywhere.
- **`messenger` missing from `ROUTES`** — `App.go()` renders it regardless; nav highlight is simply absent by design.
- **"Hang up" hidden in chat-only mode** — correct.

---

## 5. Recommended fix order

1. **C-1** — allowlist schemes/hosts in `toEmbed()`, sandbox the iframe. *(security, small change)*
2. **H-3** — escape CSV formula prefixes. *(security, ~2 lines)*
3. **H-2** — unify the stats aggregation scope. *(correctness — users cannot trust the numbers today)*
4. **H-1** — add a service worker + proper PNG icons, or drop the "Offline Ready" claim until it's true.
5. **H-4** — convert board chips to real buttons.
6. **M-1** — confirm before destructive import.
7. **M-2 → M-5** — i18n backfill and the play-name autosave.

---

## 6. Test environment

- Chromium via Playwright, viewport ~1280×800, `http://localhost:8765`
- `python -m http.server 8765` from `c:\tmp\HandBall`
- Live network available (required for the messenger relay test)
- All test artefacts (players, events, tactics) removed afterwards; demo seed left intact.

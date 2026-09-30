# Chess Arena — Desktop App Spec (Windows .exe)

A modern, 2D, fully functional chess game shipped as a **downloadable Windows desktop app (`.exe` installer)** that other users can download, install and play offline. Modes: Player vs Player (local), Player vs AI. Includes a level/XP progression system (max level 50).

**How to use this spec with an AI coding assistant:** work one phase at a time. Each phase is self-contained, lists deliverables, and ends with an acceptance checklist. Start a new session per phase and paste only: (1) sections 1–3 (context), and (2) the single phase you are building. Don't start a phase until the previous one's checklist passes.

---

## 1. Overview

| Item | Decision |
|---|---|
| Product form | **Desktop app for Windows 10/11 (x64)**, distributed as an `.exe` installer + optional portable `.exe`. macOS/Linux builds are a later, low-effort extension (same codebase). |
| Shell | **Electron** (latest stable) |
| Packaging | **electron-builder** → NSIS installer (`ChessArena-Setup-x.y.z.exe`) and portable (`ChessArena-x.y.z-portable.exe`) |
| UI | React 18 + TypeScript (strict) + Vite (renderer), Tailwind CSS, Framer Motion |
| State | Zustand; persisted through the main process (see Persistence) |
| Chess rules | `chess.js` |
| AI engine | **Stockfish native binary (Windows x64)** bundled in app resources, run as a child process by the main process, UCI over stdin/stdout. Fallback: Stockfish WASM in a Web Worker, then built-in minimax. |
| Persistence | JSON files in the OS user-data folder (`app.getPath('userData')`) via `electron-store`, accessed by the renderer only through IPC. Works fully offline; no server. |
| Audio | Web Audio / Howler.js, bundled SFX |
| Auto-update | `electron-updater` using GitHub Releases (opt-out in Settings) |
| CI/CD | GitHub Actions on `windows-latest` builds and publishes the installer on version tags |
| Testing | Vitest (unit), Playwright for Electron (e2e), a manual clean-machine install test |

**Non-goals (v1):** online multiplayer, accounts/backend, 3D board, Elo matchmaking, mobile.

**Important licensing note:** Stockfish is GPLv3. Bundling it means the app must ship the Stockfish license text and offer the corresponding source (link to the Stockfish source in About + `LICENSES/`). Piece sets and sounds must also be redistributable — record all in `CREDITS.md`. Decide the app's own license before public release.

## 2. Design Language ("modern graphics")

- **Look:** clean, flat-with-depth. Soft shadows, rounded corners (12–16px), subtle glass panels, generous spacing.
- **Window:** custom frameless title bar (minimize / maximize / close, draggable) matching the theme; default 1280×800, minimum 1024×680; fullscreen with `F11`; resizable layout down to the minimum.
- **Themes:** Dark (default) and Light. Configurable accent color (indigo, emerald, amber, rose).
- **Board themes (unlockable, §5):** Classic Wood, Slate, Emerald, Midnight, Neon, Marble.
- **Piece sets:** 2D SVG, bundled locally (no CDN). Ship "Modern" and "Classic" (check licenses, e.g. Cburnett/Merida).
- **Typography:** Inter (UI) and Space Grotesk (headings), bundled locally as font files.
- **Motion:** pieces glide between squares (150–250ms); legal-move dots fade in; captures shrink out; check pulses the king square; level-up gets a confetti/burst overlay. Respect the Windows "reduce animations" setting and an in-app toggle.
- **Feedback:** last-move highlight, selected-square highlight, legal-move dots (rings for captures), check highlight, optional coordinates.
- **Accessibility:** full keyboard play (arrow keys + Enter), ARIA labels, color-blind-safe highlight option, 4.5:1 text contrast, respects Windows display scaling (100–200%).

## 3. Screens & Layouts

Routing uses a hash router: `#/` Home, `#/setup`, `#/game`, `#/profile`, `#/rewards`, `#/history`, `#/settings`, `#/tutorial`, `#/about`.

### 3.0 Splash / First-run
- Short splash while the engine starts. On first launch: create profile (name + avatar) and a quick "how XP works" card. Skippable.

### 3.1 Home (`#/`)
- Logo, player card (avatar, name, level badge, XP bar).
- Primary: **Play vs AI**, **Play vs Player (local)**, **Continue Game** (if a saved game exists).
- Secondary: Profile, Rewards, History, Settings, How to Play, About. **Quit** button.

### 3.2 Game Setup (`#/setup`)
- Mode toggle: vs AI / vs Player.
- **vs AI:** color (White / Black / Random), difficulty (Beginner → Grandmaster), time control, Hint/Undo toggle (with XP penalty warning).
- **vs Player:** pick two local profiles (or Guest), who plays White (or random), time control.
- Time controls: Untimed, 3+2, 5+3, 10+0, 15+10, Custom.
- XP preview ("Win = +X XP"). **Start Game**.

### 3.3 Game Screen (`#/game`)
```
+---------------------------------------------------------------+
| [custom title bar · window controls]                          |
+--------------+----------------------------+-------------------+
| Opponent     |                            | Move list (SAN)   |
| strip:       |                            |  1. e4 e5         |
| avatar,name, |         BOARD              |  2. Nf3 ...       |
| level,clock, |        8x8 + coords        |-------------------|
| captured     |                            | Controls:         |
| pieces       |                            | Undo* Resign Draw |
| ------------ |                            | Flip  Hint*       |
| Player strip |                            | Save & Exit       |
+--------------+----------------------------+-------------------+
```
(*Only in vs-AI when enabled; costs XP.)
- Board scales to the available height; side panels collapse into tabs at narrow window widths.
- Modals: Promotion picker, Resign confirm, Draw offer (PvP: other player accepts; vs AI: AI accepts if evaluation is near equal), Pause menu.
- Drag-and-drop and click-click move input. Move list clickable in review mode.
- Shortcuts: `F` flip, `Ctrl+Z` undo (if allowed), `Esc` pause menu, `F11` fullscreen.
- Closing the window mid-game auto-saves and shows a confirm ("Save & quit / Keep playing").

### 3.3.1 Game Over Modal
- Result banner (Victory / Defeat / Draw + reason).
- **XP breakdown** with animated bar; level-up celebration and newly unlocked rewards.
- Buttons: Rematch, New Game, Review Game, Home.

### 3.4 Profile (`#/profile`)
- Avatar, name, level, total XP, XP bar; stats (played, W/D/L, win rate, streaks, wins per difficulty, fastest checkmate); achievement grid. Multiple local profiles supported (add / switch / delete with confirm).

### 3.5 Rewards (`#/rewards`)
- Roadmap for levels 1–50 showing unlocks; locked items greyed with "Unlocks at Lv N"; equip cosmetics.

### 3.6 History (`#/history`)
- Finished games (date, opponent, result, XP, moves). Open **Review** (step through moves). Export PGN via a native Save dialog.

### 3.7 Settings (`#/settings`)
- Appearance: theme, accent, board theme, piece set, fullscreen.
- Gameplay: legal-move dots, coordinates, auto-queen, animations.
- Sound: on/off, volume.
- App: **Check for updates**, auto-update on/off, launch-at-startup (off by default), reset progress, export/import profile data (native file dialogs), "Open data folder".

### 3.8 Tutorial (`#/tutorial`)
- Piece movement, special moves, check/mate/stalemate, draws, how XP works.

### 3.9 About (`#/about`)
- App version, changelog link, credits, Stockfish + asset licenses and source links, website/support link.

## 4. Game Rules & Functional Requirements

**Rules (all must be correct):** legal moves, check, checkmate, stalemate, castling, en passant, promotion, threefold repetition, fifty-move, insufficient material, resignation, draw by agreement, timeout (draw if opponent can't mate).

**Clocks:** increments supported; start after White's first move; pause with pause menu; persisted across quit/relaunch.

**Modes:**
- **PvP (local hot-seat):** two humans on one PC; optional auto-flip.
- **PvAI:** human vs Stockfish; engine runs off the UI thread (child process); "thinking…" indicator; min ~400ms move delay.

**Save/resume:** auto-save after every move to userData; "Continue Game" restores position, clocks, settings. Corrupted save file → ignore and show a toast, never crash.

**Single instance:** only one app window at a time (`requestSingleInstanceLock`).

## 5. Level & XP System (max level 50)

### 5.1 Rules
- Each profile has `level` (1–50) and cumulative `xp`.
- XP is awarded only when a game ends with a legitimate result. Games abandoned before move 5 give 0 XP.
- At level 50, the bar shows "MAX"; stats continue tracking.

### 5.2 XP required per level
```
xpToNext(L) = round(100 + 25*(L-1) + 2.5*(L-1)^2)   for L in 1..49
```
Lv1→2 ≈ 100, Lv10→11 ≈ 550, Lv25→26 ≈ 2,200, Lv49→50 ≈ 6,000 (implement the formula, not the numbers). Total to reach 50 ≈ 100k. Single function `xpToNext(level)`; constants in `src/config/progression.ts`; unit-tested.

### 5.3 XP awards

**vs AI:**

| Difficulty | Win | Draw | Loss |
|---|---|---|---|
| Beginner | 40 | 15 | 5 |
| Easy | 70 | 25 | 8 |
| Medium | 110 | 40 | 12 |
| Hard | 170 | 65 | 18 |
| Expert | 250 | 95 | 25 |
| Grandmaster | 360 | 140 | 35 |

**Win bonuses (additive):** checkmate finish +10%; win under 40 moves +10%; win without losing queen +10%; win streak +5% per consecutive win (cap +25%); first win of the day +50 flat.

**Penalties:** each Hint/Undo used = −25% of that game's XP (floor 25% of base). Hint/Undo disabled on Expert and Grandmaster.

**vs Player (local):**
- Winner 60 XP, loser 15 XP, draw 30 each — only if the game reaches move 10 and the two profiles differ.
- Same profile on both sides → 0 XP.
- Same opponent pairing: after 5 games/day XP halved, after 10 zero.
- Level gap: winner 10+ levels above loser ×0.5; 10+ below ×1.5.

Show a full XP breakdown on game over.

### 5.4 Level rewards

| Level | Unlock |
|---|---|
| 1 | Classic Wood board, Modern & Classic pieces, 4 starter avatars |
| 3 | Slate board |
| 5 | Title "Pawn Pusher"; avatar pack 1 |
| 8 | Emerald board |
| 10 | Title "Knight Errant"; Hard badge frame |
| 15 | Midnight board |
| 20 | Title "Bishop's Gambit"; avatar pack 2; move trail effect |
| 25 | Neon board |
| 30 | Title "Rook Commander"; gold avatar frame |
| 35 | Marble board |
| 40 | Title "Queen's Guard"; capture particle effects |
| 45 | Title "Grandmaster Candidate"; animated frame |
| 50 | Title "Chess Legend"; legendary avatar + rainbow frame |

Other levels grant a level badge tier only. Table lives in `src/config/rewards.ts`.

## 6. AI Design

- **Primary:** bundled `stockfish.exe` (x64) in `resources/engine/`, spawned by the main process, communicating via UCI (`uci`, `isready`, `position`, `go depth|movetime`, `setoption Skill Level`). Renderer talks to it via IPC only (`engine:start`, `engine:bestmove`, `engine:stop`). Kill the child process on quit.
- **Fallback 1:** Stockfish WASM in a Web Worker if the native binary fails to start (e.g., antivirus block).
- **Fallback 2:** built-in minimax + alpha-beta (depth 3) so the game is never blocked.
- Difficulty presets (tune in testing):

| Difficulty | Skill Level | Limit | Notes |
|---|---|---|---|
| Beginner | 0 | depth 1–2 | ~25% random legal move |
| Easy | 3 | depth 3 | |
| Medium | 7 | depth 6 | |
| Hard | 12 | 400ms | |
| Expert | 17 | 1000ms | |
| Grandmaster | 20 | 2000ms | full strength |

- Limit engine threads/hash (e.g. Threads=1–2, Hash=64MB) so the app stays light on low-end PCs.
- Cancel search on undo / resign / new game / window close.

## 7. Security & Desktop Hardening

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` for the renderer; a small typed `preload` API exposes only what's needed (`storage`, `engine`, `dialog`, `updater`, `window`).
- No remote content: all assets bundled; strict Content-Security-Policy; block navigation and `window.open` to external URLs (open links in the system browser via `shell.openExternal` on an allow-list).
- Validate all IPC payloads in the main process; never let the renderer pass file paths or shell commands.
- Disable DevTools in production builds.

## 8. Data Model (TypeScript)

```ts
type Color = 'w' | 'b';
type Difficulty = 'beginner'|'easy'|'medium'|'hard'|'expert'|'grandmaster';

interface Profile {
  id: string; name: string; avatarId: string;
  level: number; xp: number;            // xp = cumulative total
  stats: { played:number; wins:number; draws:number; losses:number;
           streak:number; bestStreak:number; lastWinDate?:string;
           winsByDifficulty: Record<Difficulty, number> };
  unlocked: { boards:string[]; pieceSets:string[]; avatars:string[]; titles:string[] };
  equipped: { board:string; pieceSet:string; avatarId:string; title?:string };
  pvpToday: Record<string, { date:string; count:number }>;
}

interface GameRecord {
  id: string; date: string; mode: 'pvai'|'pvp';
  white: string; black: string;          // profile id or 'ai:<difficulty>'
  pgn: string; result: '1-0'|'0-1'|'1/2-1/2';
  reason: string; xpAwarded: Record<string, number>;
}

interface SavedGame { fen: string; pgn: string; clocks:{w:number;b:number};
  settings: GameSettings; turn: Color; startedAt: string; }

interface Settings { theme:'dark'|'light'; accent:string; sound:boolean; volume:number;
  animations:boolean; legalMoves:boolean; coordinates:boolean; autoQueen:boolean;
  autoUpdate:boolean; launchAtStartup:boolean; /* … */ }
```
Persisted files carry a `schemaVersion` with a migration function so future app updates never break existing users' saves.

## 9. Project Structure

```
chess-arena/
  electron/
    main.ts            (window, single-instance, menu, updater, IPC handlers)
    preload.ts         (typed, minimal API)
    engine.ts          (spawn/manage stockfish child process)
    storage.ts         (electron-store wrappers, migrations)
  resources/engine/    (stockfish-windows-x86-64.exe + license)
  build/               (icon.ico, installer assets)
  src/                 (renderer)
    app/  components/  screens/  game/  ai/  progression/  store/  config/  utils/
  tests/  e2e/
  electron-builder.yml
  .github/workflows/release.yml
  CREDITS.md  LICENSES/  README.md
```

---

## 10. Build Phases

> Each phase fits one focused session. Finish and verify before moving on. One commit per phase.

### Phase 1 — Electron scaffold & design system
**Goal:** a runnable desktop window with routing, theming, and empty screens.
- Electron + Vite + React + TS strict, Tailwind, Framer Motion, Zustand, hash router; ESLint/Prettier; Vitest.
- Main/preload/renderer split with the security settings from §7; typed IPC skeleton.
- Frameless custom title bar (min/max/close), min window size, single-instance lock.
- Theme tokens, dark/light, UI kit (Button, Card, Modal, Tabs, Toggle, ProgressBar, Toast).
- All routes render placeholders; Home screen visually complete.
- `electron-builder` config stub and app icon.

**Acceptance:** `npm run dev` opens the app window; all routes reachable; theme persists after relaunch via `electron-store`; lint + typecheck + tests pass; renderer has no Node access (verified).

### Phase 2 — Board, pieces & rules
**Goal:** a fully playable board with correct rules on one device, no clock.
- `Board`, `Square`, `Piece` (local SVG); coordinates; flip.
- Game store wrapping `chess.js`; click-click + drag-and-drop; legal-move dots; last-move + check highlight; promotion modal; move animation.
- Move list (SAN); captured pieces + material difference.
- End detection (mate, stalemate, repetition, 50-move, insufficient material) → basic game-over modal.

**Acceptance:** unit tests with FENs for castling, en passant, promotion, every draw type, fool's mate, stalemate; smooth at 60fps at 1080p.

### Phase 3 — Setup, clocks & PvP
**Goal:** full local PvP match flow.
- Setup screen; Game screen layout (§3.3); clocks with increments/timeout; pause menu; resign; draw offer; auto-flip.
- Auto-save/resume via storage IPC; "Continue Game"; close-window confirm.
- Full Game Over modal (no XP yet).

**Acceptance:** all end reasons work in PvP; quit and relaunch mid-game restores position and clocks; timeout + insufficient-material draw tested; corrupted save handled gracefully.

### Phase 4 — AI opponent (native engine)
**Goal:** Player vs AI with six difficulties.
- Bundle Stockfish exe; main-process `engine.ts` (spawn, UCI, timeouts, kill on quit); IPC to renderer; difficulty config; thinking indicator; move delay.
- WASM and minimax fallbacks with automatic failover.
- vs-AI setup options; AI clock; AI draw/resign logic; Hint and Undo (flags for XP penalty).
- Edge cases: AI moves first when human is Black; promotion; cancel on undo/leave; no orphan `stockfish.exe` after app exit (verify in Task Manager).

**Acceptance:** Beginner clearly beatable, Grandmaster clearly stronger; 20 simulated games with zero illegal AI moves; UI never freezes; engine process always cleaned up; failover works when the engine file is removed.

### Phase 5 — Profiles, XP & levels (max 50)
**Goal:** progression per §5.
- Multi-profile store (create/select/delete, avatar, name).
- `progression` module: `xpToNext`, `applyXp` (multi-level jumps, cap 50), award calculator (vs AI / vs Player, bonuses, penalties, anti-abuse) — unit tests for every rule.
- Game Over XP breakdown, animated bar, level-up celebration; level badge + XP bar on Home and player strips; Profile screen with stats; match records saved to history.

**Acceptance:** tests for level curve, cap at 50, multi-level-up, abandoned-game 0 XP, self-play 0 XP, daily PvP diminishing returns, streak cap, hint/undo penalty floor.

### Phase 6 — Rewards, unlocks & customization
**Goal:** make leveling meaningful.
- Reward config; unlock evaluation on level-up (catch-up for multi-level jumps).
- Rewards screen (roadmap 1–50, locked/unlocked, equip).
- Board themes and piece sets applied live; avatar frames/titles in strips; level-up modal lists unlocks.
- Basic achievements (first win, 5-win streak, beat Grandmaster, win ≤20 moves, 100 games) with toasts.

**Acceptance:** equips apply instantly and persist across relaunch; unlocks derived from level (no duplicates); all 50 levels render.

### Phase 7 — History, review, settings, tutorial & About
**Goal:** complete the supporting screens.
- History list + review mode; PGN export using a native Save dialog.
- Settings fully wired (§3.7), including data export/import (native dialogs), reset, open data folder.
- SFX (move, capture, check, castle, promote, win/lose, level-up).
- Tutorial and About screens (with license/source links).

**Acceptance:** every setting takes effect immediately and persists; exported data re-imports correctly; PGN opens in another chess tool.

### Phase 8 — Packaging, installer, updates & release
**Goal:** a downloadable `.exe` other people can install and play.
- `electron-builder.yml`: NSIS installer (one-click off, choose install dir, desktop + Start Menu shortcuts, uninstaller) and a portable exe; app icon `.ico`; `asarUnpack` for `stockfish.exe`; version from `package.json`.
- Auto-update with `electron-updater` (GitHub Releases), "Check for updates" UI, update-downloaded prompt.
- Code signing: support a signing certificate via CI secrets (`CSC_LINK`, `CSC_KEY_PASSWORD`); document that unsigned builds trigger Windows SmartScreen warnings and that signing (OV/EV cert or Azure Trusted Signing) is what removes them.
- GitHub Actions workflow on `windows-latest`: install, lint, test, build, publish artifacts and a GitHub Release on `v*` tags. (Building the Windows exe on a Mac requires Wine, so CI is the recommended path.)
- Production hardening pass (§7), DevTools disabled, performance check (startup < 3s on a mid-range PC, idle memory reasonable).
- Playwright-Electron e2e: (1) PvP game to checkmate → XP; (2) vs-AI resign; (3) level-up flow; (4) quit/relaunch resume.
- Docs: `README.md` (download/install/uninstall, system requirements, build-from-source), `CREDITS.md`, `LICENSES/`, `CHANGELOG.md`.
- **Clean-machine test:** install on a fresh Windows 10/11 VM with no dev tools; verify install, launch, offline play, AI works, update check, uninstall leaves no stray processes.

**Acceptance:** tagged CI run produces `ChessArena-Setup-x.y.z.exe` and portable exe attached to a release; installs and runs on a clean VM without extra dependencies; AI and saves work after install; uninstall works; e2e green.

---

## 11. Global Acceptance Criteria (definition of done)

- All chess rules verified by tests; no illegal move possible by human or AI.
- XP/level math unit-tested; level never exceeds 50; XP never negative.
- Game, profiles, settings and history survive quitting and relaunching, and survive app updates (schema migrations).
- Works fully offline after install.
- Installer and portable `.exe` run on a clean Windows 10/11 x64 machine.
- No console errors in normal play; no orphan engine processes after exit.

## 12. Future Ideas (out of scope for v1)
macOS `.dmg` and Linux AppImage builds, online multiplayer, accounts + cloud saves, Elo ratings, puzzles, opening explorer, engine analysis/eval bar, daily challenges, coin currency and shop, seasonal cosmetics, Microsoft Store release.

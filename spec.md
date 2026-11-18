# Chess Arena — Desktop App Spec (Windows + macOS, with online play)

A modern, 2D, fully functional chess game shipped as a **downloadable desktop app for Windows (`.exe` installer) and macOS (`.dmg`)** that other people can download, install and play. Modes: Player vs AI, Player vs Player (local), and **Online vs another person** (invite code or quick match). Includes a level/XP progression system (max level 50). Everything except online play works fully offline.

**How to use this spec with an AI coding assistant:** work one phase at a time. Each phase is self-contained, lists deliverables, and ends with an acceptance checklist. Start a new session per phase and paste only: (1) sections 1–3 (context), (2) §13 for online phases, and (3) the single phase you are building. Don't start a phase until the previous one's checklist passes.

**Status (2026-11-18):** Phases 1–8 built (v0.8.0 release builds run on GitHub Actions). Phase 9 server built and tested in `server/`; deployment waits on the choice of host (§13.6). Next: Phase 10. An earlier Android/Capacitor draft of this spec was shelved (`git stash list` → "Android/Capacitor spec draft").

---

## 1. Overview

| Item | Decision |
|---|---|
| Product form | **Desktop app for Windows 10/11 (x64)** — NSIS installer + portable `.exe` — and **macOS 12+ (Apple Silicon and Intel)** — `.dmg` (+ `.zip` for updates). Linux AppImage is a later, low-effort extension. |
| Shell | **Electron** (latest stable) |
| Packaging | **electron-builder** → `ChessArena-Setup-x.y.z.exe`, `ChessArena-x.y.z-portable.exe`, `ChessArena-x.y.z-arm64.dmg`, `ChessArena-x.y.z-x64.dmg` |
| Distribution | **GitHub Releases** on a public repository (download page + auto-update feed). |
| UI | React 18 + TypeScript (strict) + Vite (renderer), Tailwind CSS, Framer Motion |
| State | Zustand; persisted through the main process (see Persistence) |
| Chess rules | `chess.js` (shared by the app and the game server) |
| AI engine | **Stockfish native binary per platform** (Windows x64, macOS universal) bundled in app resources, run as a child process by the main process, UCI over stdin/stdout. Fallback: Stockfish WASM in a Web Worker, then built-in minimax. |
| Persistence | JSON files in the OS user-data folder (`app.getPath('userData')`) via `electron-store`, accessed by the renderer only through IPC. Offline modes need no server. |
| Online play | A small **TypeScript game server** (Node 20+, `ws`, `chess.js`) — server-authoritative moves and clocks, invite-code rooms and a quick-match queue. **No accounts**: players are anonymous guests with a display name. Hosted on a managed platform (e.g. Render web service). See §13. |
| Audio | Web Audio, bundled SFX |
| Auto-update | `electron-updater` from GitHub Releases. Windows: full auto-update. macOS: auto-update requires a signed app — unsigned builds show "Update available → Download" instead (§10, Phase 8). |
| CI/CD | GitHub Actions: matrix build on `windows-latest` and `macos-latest`, publishes a GitHub Release on `v*` tags; a separate workflow tests and deploys the server. |
| Testing | Vitest (unit), end-to-end smoke harness driving the real (packaged) Electron app, server integration tests with bot clients, manual clean-machine install test on both OSes |

**Non-goals (v1):** accounts/sign-in, cloud saves, Elo ratings, leaderboards, friends list, chat (free-text), spectating, 3D board, mobile, ads/purchases.

**Licensing note:** Stockfish is GPLv3. Bundling it means the app must ship the Stockfish license text and offer the corresponding source (link to the Stockfish source in About + `LICENSES/`). Publishing this app's source under a GPL-compatible license on the public GitHub repo is the simplest compliant route. Piece sets and sounds must also be redistributable — record all in `CREDITS.md`. The game server does not include Stockfish.

**Code signing (cost/benefit):** unsigned apps work but show warnings. Windows: SmartScreen "Windows protected your PC" → *More info → Run anyway*. macOS: Gatekeeper blocks the first open → *right-click → Open* (or *System Settings → Privacy & Security → Open Anyway*). Signing removes the warnings: Windows OV/EV certificate or Azure Trusted Signing; macOS Apple Developer ID ($99/yr) + notarization. The build supports both via CI secrets; v1 can ship unsigned with clear install instructions.

## 2. Design Language ("modern graphics")

- **Look:** clean, flat-with-depth. Soft shadows, rounded corners (12–16px), subtle glass panels, generous spacing.
- **Window:** custom frameless title bar matching the theme; Windows shows custom minimize / maximize / close; macOS shows the native traffic-light buttons (hidden-inset title bar) and no custom buttons. Default 1280×800, minimum 1024×680; fullscreen with `F11` (Windows) / `Ctrl+Cmd+F` (macOS).
- **Themes:** Dark (default) and Light. Configurable accent color (indigo, emerald, amber, rose).
- **Board themes (unlockable, §5):** Classic Wood, Slate, Emerald, Midnight, Neon, Marble.
- **Piece sets:** 2D SVG, bundled locally (no CDN). "Modern" and "Classic".
- **Typography:** Inter (UI) and Space Grotesk (headings), bundled locally as font files.
- **Motion:** pieces glide between squares (150–250ms); legal-move dots fade in; captures shrink out; check pulses the king square; level-up gets a confetti/burst overlay. Respect the OS "reduce motion" setting and an in-app toggle.
- **Feedback:** last-move highlight, selected-square highlight, legal-move dots (rings for captures), check highlight, optional coordinates.
- **Accessibility:** full keyboard play (arrow keys + Enter), ARIA labels, color-blind-safe highlight option, 4.5:1 text contrast, respects display scaling (100–200%).
- **Keyboard shortcuts** use `Ctrl` on Windows and `Cmd` on macOS.

## 3. Screens & Layouts

Routing uses a hash router: `#/` Home, `#/setup`, `#/game`, `#/online`, `#/profile`, `#/rewards`, `#/history`, `#/settings`, `#/tutorial`, `#/about`.

### 3.0 Splash / First-run
- Short splash while the engine starts. On first launch: create profile (name + avatar) and a quick "how XP works" card. Skippable.

### 3.1 Home (`#/`)
- Logo, player card (avatar, name, level badge, XP bar).
- Primary: **Play vs AI**, **Play vs Player (local)**, **Play Online**, **Continue Game** (if a saved local game exists, or **Rejoin online game** if a live online game is in progress).
- Secondary: Profile, Rewards, History, Settings, How to Play, About. **Quit** button (Windows; macOS uses Cmd+Q / app menu).
- "Update available" banner when a newer release exists.

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
- Shortcuts: `F` flip, `Ctrl/Cmd+Z` undo (if allowed), `Esc` pause menu.
- Closing the window mid-game auto-saves and shows a confirm ("Save & quit / Keep playing").
- **Online games:** opponent's display name + level, connection indicator (green / reconnecting / offline), opponent-disconnected countdown, Resign, Offer draw, Abort (only before both sides have moved), Flip. **No** Undo, Hint, Pause or Save & Exit. Closing the window asks "Leave game? You'll lose if you don't come back within 60 s."

### 3.3.1 Game Over Modal
- Result banner (Victory / Defeat / Draw + reason).
- **XP breakdown** with animated bar; level-up celebration and newly unlocked rewards.
- Buttons: Rematch (online: sends a rematch offer the opponent accepts/declines), New Game, Review Game, Home.

### 3.4 Profile (`#/profile`)
- Avatar, name, level, total XP, XP bar; stats (played, W/D/L, win rate, streaks, wins per difficulty, online W/D/L, fastest checkmate); achievement grid. Multiple local profiles supported (add / switch / delete with confirm).

### 3.5 Rewards (`#/rewards`)
- Roadmap for levels 1–50 showing unlocks; locked items greyed with "Unlocks at Lv N"; equip cosmetics.

### 3.6 History (`#/history`)
- Finished games (date, mode, opponent, result, XP, moves), including online games. Open **Review** (step through moves). Export PGN via a native Save dialog.

### 3.7 Settings (`#/settings`)
- Appearance: theme, accent, board theme, piece set, fullscreen.
- Gameplay: legal-move dots, coordinates, auto-queen, animations.
- Sound: on/off, volume.
- Online: display name shown to opponents (defaults to profile name), accept rematch offers on/off.
- App: **Check for updates**, auto-update on/off, launch-at-startup (off by default), reset progress, export/import profile data (native file dialogs), "Open data folder".

### 3.8 Tutorial (`#/tutorial`)
- Piece movement, special moves, check/mate/stalemate, draws, how XP works.

### 3.9 About (`#/about`)
- App version, changelog link, credits, Stockfish + asset licenses and source links, website/support link.

### 3.10 Play Online (`#/online`)
- Header shows server status (Online / Can't reach server — retry) and the display name opponents will see.
- **Quick Match:** pick a time control pool (3+2, 5+3, 10+0, 15+10) → **Find opponent** → searching state with elapsed time and **Cancel**. After 60 s with no match: "Keep searching" or "Play the AI instead".
- **Create private game:** time control (any preset or custom), color (White / Black / Random) → shows a **6-character invite code** (e.g. `K7QM2X`) with a Copy button and a "Waiting for opponent…" state; Cancel closes the room. Codes expire after 10 minutes unjoined.
- **Join with code:** text field (case-insensitive, ignores spaces/dashes) → joins and the game starts for both players.
- Errors are human-readable: "Code not found or expired", "Game already full", "Server unreachable", "Please update Chess Arena to play online" (version too old).

## 4. Game Rules & Functional Requirements

**Rules (all must be correct):** legal moves, check, checkmate, stalemate, castling, en passant, promotion, threefold repetition, fifty-move, insufficient material, resignation, draw by agreement, timeout (draw if opponent can't mate).

**Clocks:** increments supported; start after White's first move; pause with pause menu; persisted across quit/relaunch. (Online clocks: see below.)

**Modes:**
- **PvP (local hot-seat):** two humans on one PC; optional auto-flip.
- **PvAI:** human vs Stockfish; engine runs off the UI thread (child process); "thinking…" indicator; min ~400ms move delay.
- **Online:** human vs human over the internet. The **server is authoritative** for legality, turn order, clocks and results; the app only renders and sends move intents. No pause, undo or hint. Clocks keep running on the server if the app is closed or loses connection; a disconnected player has a **60 s reconnect grace** (opponent sees a countdown), after which they lose by abandonment (or the game is aborted if fewer than 2 plies were played). Draw offers limited to 1 per player per 10 plies. Abort allowed until both sides have moved.
- **Mode-offline rule:** PvAI and hot-seat never touch the network.

**Online clock rules:** the server timestamps every move with its own monotonic clock; app clocks are display-only and re-synced from every server state message; the mover is credited up to 500 ms of measured network lag per move; only the server decides a flag (timeout).

**Save/resume:** auto-save after every local move to userData; "Continue Game" restores position, clocks, settings. Online games are not saved locally as resumable games; instead the app stores `{gameId, reconnectToken}` so it can **rejoin** after a crash/relaunch while the server still holds the game. Corrupted save file → ignore and show a toast, never crash.

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

**vs Online player:**

| Result | XP |
|---|---|
| Win | 80 |
| Draw | 35 |
| Loss | 12 |

- Requires the game to reach move 10; aborted games and games resigned before move 5 → 0 XP. A win by opponent abandonment counts as a win only after move 10.
- Bonuses: checkmate +10%, win under 40 moves +10%, win streak +5% per win (cap +25%, shared with the vs-AI streak), first online win of the day +50 flat. No level-gap multiplier.
- Anti-farming: XP is computed by the app from the **server's final result** (never from local state). Same opponent (by the opponent's guest id reported by the server): after 3 games/day XP halved, after 6 zero.
- Because there are no accounts or leaderboards, client-computed XP is acceptable; XP is only cosmetic progression.

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

- **Primary:** bundled native Stockfish per platform in `resources/engine/` (`stockfish-windows-x86-64.exe`, `stockfish-macos` universal), spawned by the main process, communicating via UCI (`uci`, `isready`, `position`, `go depth|movetime`, `setoption Skill Level`). Renderer talks to it via IPC only. Kill the child process on quit.
- **Fallback 1:** Stockfish WASM in a Web Worker if the native binary fails to start (e.g., antivirus block, Gatekeeper quarantine).
- **Fallback 2:** built-in minimax + alpha-beta (depth 3) so the game is never blocked.
- Difficulty presets:

| Difficulty | Skill Level | Limit | Notes |
|---|---|---|---|
| Beginner | 0 | depth 1–2 | ~25% random legal move |
| Easy | 3 | depth 3 | |
| Medium | 7 | depth 6 | |
| Hard | 12 | 400ms | |
| Expert | 17 | 1000ms | |
| Grandmaster | 20 | 2000ms | full strength |

- Limit engine threads/hash (Threads=1–2, Hash=64MB) so the app stays light on low-end PCs.
- Cancel search on undo / resign / new game / window close.
- The engine is never used during online games (no hints, no analysis while live).

## 7. Security & Desktop Hardening

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` for the renderer; a small typed `preload` API exposes only what's needed (`storage`, `engine`, `dialog`, `updater`, `window`, `online`).
- No remote content: all assets bundled; strict Content-Security-Policy whose `connect-src` allows only the game server's `wss://` host; block navigation and `window.open` to external URLs (open links in the system browser via `shell.openExternal` on an allow-list).
- Validate all IPC payloads in the main process; never let the renderer pass file paths or shell commands.
- Disable DevTools in production builds.
- **Online:** TLS only (`wss://`). Every message in both directions is schema-validated and size-capped (≤ 4 KB); unknown message types are dropped. The app never trusts server-supplied strings as HTML (display names rendered as text). The server URL is fixed at build time (overridable only in dev builds).
- **Server:** see §13.5.

## 8. Data Model (TypeScript)

```ts
type Color = 'w' | 'b';
type Difficulty = 'beginner'|'easy'|'medium'|'hard'|'expert'|'grandmaster';

interface Profile {
  id: string; name: string; avatarId: string;
  level: number; xp: number;            // xp = cumulative total
  stats: { played:number; wins:number; draws:number; losses:number;
           streak:number; bestStreak:number; lastWinDate?:string;
           winsByDifficulty: Record<Difficulty, number>;
           online: { played:number; wins:number; draws:number; losses:number; lastWinDate?:string } };
  unlocked: { boards:string[]; pieceSets:string[]; avatars:string[]; titles:string[] };
  equipped: { board:string; pieceSet:string; avatarId:string; title?:string };
  pvpToday: Record<string, { date:string; count:number }>;
  onlineToday: Record<string, { date:string; count:number }>;   // keyed by opponent guest id
}

interface GameRecord {
  id: string; date: string; mode: 'pvai'|'pvp'|'online';
  white: string; black: string;          // profile id, 'ai:<difficulty>' or 'online:<displayName>'
  pgn: string; result: '1-0'|'0-1'|'1/2-1/2';
  reason: string; xpAwarded: Record<string, number>;
  onlineGameId?: string;
}

interface SavedGame { fen: string; pgn: string; clocks:{w:number;b:number};
  settings: GameSettings; turn: Color; startedAt: string; }

interface OnlineIdentity {               // per install, in userData
  guestId: string;                       // random uuid, sent to the server
  displayName: string;                   // 1–20 chars
}
interface OnlineRejoin { gameId: string; reconnectToken: string; savedAt: string; }

interface Settings { theme:'dark'|'light'; accent:string; sound:boolean; volume:number;
  animations:boolean; legalMoves:boolean; coordinates:boolean; autoQueen:boolean;
  autoUpdate:boolean; launchAtStartup:boolean; /* … */ }
```
Persisted files carry a `schemaVersion` with a migration function so future app updates never break existing users' saves.

**Online protocol (shared types in `src/shared/protocol.ts`, imported by app and server; JSON over WebSocket; `v` = protocol version):**
```ts
type TimeControl = { baseMs: number; incMs: number };
interface PlayerInfo { guestId: string; name: string; level: number; avatarId: string }

type ClientMsg =
  | { t:'hello'; v:number; appVersion:string; player:PlayerInfo }
  | { t:'room.create'; tc:TimeControl; color:'w'|'b'|'random' }
  | { t:'room.join'; code:string }
  | { t:'room.cancel' }
  | { t:'queue.join'; tc:TimeControl }
  | { t:'queue.leave' }
  | { t:'game.rejoin'; gameId:string; token:string }
  | { t:'game.move'; gameId:string; uci:string; seq:number }
  | { t:'game.resign'|'game.abort'|'game.drawOffer'|'game.drawAccept'|'game.drawDecline'
       |'game.rematch'|'game.rematchAccept'|'game.rematchDecline'; gameId:string }
  | { t:'ping'; ts:number };

type ServerMsg =
  | { t:'welcome'; serverTs:number; minAppVersion:string }
  | { t:'room.created'; code:string; expiresAt:number }
  | { t:'queue.waiting'; since:number }
  | { t:'game.start'; gameId:string; token:string; color:Color; tc:TimeControl;
      white:PlayerInfo; black:PlayerInfo; serverTs:number }
  | { t:'game.state'; gameId:string; fen:string; moves:string[]; seq:number;
      clocks:{w:number;b:number}; turn:Color; serverTs:number; drawOfferFrom?:Color }
  | { t:'game.opponentStatus'; gameId:string; connected:boolean; graceEndsAt?:number }
  | { t:'game.over'; gameId:string; result:'1-0'|'0-1'|'1/2-1/2'; reason:string; pgn:string; plies:number }
  | { t:'game.rematchOffer'; gameId:string }
  | { t:'error'; code:'BAD_MSG'|'NOT_FOUND'|'ROOM_FULL'|'ILLEGAL'|'NOT_YOUR_TURN'|'RATE_LIMIT'|'UPGRADE_REQUIRED'|'BUSY'; message:string }
  | { t:'pong'; ts:number; serverTs:number };
```

## 9. Project Structure

```
chess-arena/
  electron/
    main.ts            (window, single-instance, menu, updater, IPC handlers)
    preload.ts         (typed, minimal API)
    engine.ts          (spawn/manage stockfish child process)
    storage.ts         (electron-store wrappers, migrations)
    updater.ts         (electron-updater wiring)
  resources/engine/    (stockfish binaries per platform + license)
  build/               (icons: .ico, .icns/.png; mac entitlements)
  src/                 (renderer)
    app/  components/  screens/  game/  ai/  progression/  store/  config/  utils/
    net/               (ws client w/ reconnect, online store)
    shared/            (types, validators, protocol.ts — shared with server)
  server/              (game server: own package.json, src/, test/, Dockerfile)
  tests/  e2e/
  electron-builder.yml
  .github/workflows/release.yml   (app: win + mac)
  .github/workflows/server.yml    (server: test + deploy)
  CREDITS.md  LICENSES/  README.md  CHANGELOG.md
```

---

## 10. Build Phases

> Each phase fits one focused session. Finish and verify before moving on. One commit per phase.

### Phases 1–7 — ✅ Done (v0.7.0)
1. Electron scaffold & design system · 2. Board, pieces & rules · 3. Setup, clocks & local PvP · 4. AI opponent (native Stockfish + WASM/minimax fallbacks) · 5. Profiles, XP & levels · 6. Rewards, unlocks & achievements · 7. History, review, settings, tutorial & About.

### Phase 8 — Packaging, installers, updates & release (Windows + macOS)
**Goal:** downloadable builds for Windows and Mac that other people can install and play.
- **Repository:** public GitHub repo (needed for Releases, the update feed and GPL source availability); `package.json` `repository` + `build.publish` set to GitHub.
- **Windows:** NSIS installer (one-click off, choose install dir, desktop + Start Menu shortcuts, uninstaller) and portable exe; `.ico` icon; Stockfish Windows binary in `extraResources`.
- **macOS:** `.dmg` + `.zip` for `arm64` and `x64` (or `universal`); `.icns` icon; app category `public.app-category.board-games`; hardened runtime + entitlements file ready for signing; Stockfish macOS binary in `extraResources` and executable after install. Unsigned builds are ad-hoc signed so they launch on Apple Silicon.
- **Engine per platform:** `npm run dist:win` / `npm run dist:mac` fetch the right Stockfish (checksum-verified) before building; the engine path resolver picks the binary for `process.platform`.
- **Window chrome on macOS:** hidden-inset title bar with native traffic lights; custom window buttons only on Windows; app menu with About / Settings / Quit (Cmd+Q).
- **Auto-update** with `electron-updater` from GitHub Releases: check on startup (if enabled) and from Settings; download in background; "Restart to update" prompt. macOS unsigned → no silent install; show "Version x.y.z available → Download" opening the Releases page.
- **Code signing (optional, via CI secrets):** Windows `CSC_LINK`/`CSC_KEY_PASSWORD` (or Azure Trusted Signing); macOS `CSC_LINK`/`CSC_KEY_PASSWORD` + notarization (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`). Builds succeed without them.
- **GitHub Actions `release.yml`:** matrix `windows-latest` + `macos-latest`: install, lint, typecheck, test, fetch engine, build, upload installers and update metadata (`latest.yml`, `latest-mac.yml`) to a GitHub Release on `v*` tags (draft first).
- Production hardening pass (§7), DevTools disabled, performance check (startup < 3s, idle memory reasonable).
- End-to-end tests (run on both OSes in CI, against the **packaged** app): (1) PvP game to checkmate → XP; (2) vs-AI resign; (3) level-up flow; (4) quit/relaunch resume. Implemented in the existing smoke harness (`scripts/smoke.mjs`, `SMOKE_APP=<packaged executable>`) rather than Playwright, which would duplicate it.
- Docs: `README.md` (download links, install steps per OS including the SmartScreen / Gatekeeper first-run steps, uninstall, system requirements, build-from-source), `CHANGELOG.md`, `CREDITS.md`, `LICENSES/`.
- **Clean-machine test:** fresh Windows 10/11 VM and a Mac without dev tools: install, launch, offline play, AI works (native engine, not fallback), update check, uninstall leaves no stray processes.

**Acceptance:** a `v*` tag produces a GitHub Release with the Windows installer + portable exe and Mac dmg/zip for both architectures; each installs and runs on a clean machine without extra dependencies; Stockfish (native) works after install on both OSes; saves persist; an older installed build detects the newer release; e2e green on both OSes.

### Phase 9 — Online game server
**Goal:** a deployed, tested server that runs fair real-time games between two clients.
- `server/` package: Node 20+, TypeScript strict, `ws`, `chess.js`, shared `protocol.ts` validators; one process, in-memory state (§13).
- Connection lifecycle: `hello` with protocol/app version (reject too-old apps with `UPGRADE_REQUIRED`), heartbeats (ping/pong every 15 s, drop after 45 s silence), per-connection rate limits, message size cap.
- **Rooms:** create → 6-char code (alphabet without `0 O 1 I L`), join, cancel, 10-minute expiry, color assignment.
- **Quick match:** FIFO queue per time-control pool; pair the two oldest waiting players; a player can be in only one queue/room/game at a time; leaving or disconnecting removes them.
- **Authoritative game:** validate every move with chess.js (turn, legality, `seq` for idempotency); server clocks with increment and lag credit; flag timer scheduled at each turn start; all end conditions (mate, stalemate, repetition, fifty-move, insufficient material, resign, agreement, timeout incl. insufficient-material draw, abandonment, abort).
- Draw offers (rate-limited), rematch (colors swapped), abort rule, **disconnect grace** 60 s with `game.opponentStatus` updates; `game.rejoin` with the per-player reconnect token restores the full state.
- Finished games kept in memory for 10 minutes (for rejoin/game-over display), then dropped. No database in v1.
- `GET /health` (status, uptime, connected clients, live games) and graceful shutdown (stop accepting, notify clients `BUSY`, wait for games up to a limit).
- Tests: unit tests for clocks/rooms/queue; integration tests with bot WebSocket clients playing scripted games (castling, en passant, promotion, every end reason, timeout, disconnect/rejoin, illegal / out-of-turn / replayed moves rejected); a soak test of 100 concurrent bot games.
- Deploy: Dockerfile; Render web service (or equivalent) with TLS (`wss://`), health check, and `server.yml` workflow (test on push, deploy on `server-v*` tag or main).

**Acceptance:** all server tests green; 100 concurrent bot games with zero illegal positions and correct results; cheating clients (illegal, out-of-turn, replayed, oversized, spammy) are rejected without affecting the game; a deployed staging URL accepts `wss://` connections and passes `/health`.

### Phase 10 — Online play in the app
**Goal:** two people on two computers can find each other and play a complete game.
- `src/net/`: WebSocket client in the renderer (allowed by CSP), auto-reconnect with exponential backoff + jitter, `hello` on connect, automatic `game.rejoin` after reconnect, clock-offset estimation from `pong.serverTs`, message validation with the shared validators.
- Online store (Zustand): connection state, queue/room state, live game state driven only by server messages; optimistic local move with rollback on `error`.
- **Play Online screen** (§3.10): Quick Match with pools, Create private game (code + Copy), Join with code, server status, errors.
- Game screen online variant (§3.3): connection indicator, opponent-disconnected countdown, abort/resign/draw/rematch, no undo/hint/pause; leave-confirm on window close; the board reuses the existing `Board` with input disabled when it's not your turn.
- Rejoin after crash/relaunch (`OnlineRejoin` in userData) via Home "Rejoin online game".
- Game over: XP computed per §5.3 from the server's final result; game recorded in History (mode `online`); online stats on Profile; achievements still trigger.
- Settings: online display name.
- Production server URL baked in at build time; dev builds can point to `ws://localhost`.

**Acceptance:** two installed builds on different machines/networks complete games via invite code and via quick match, including castling, en passant, promotion, draw by agreement, resign, timeout; pulling the network cable mid-game reconnects and resumes with correct clocks; closing and reopening the app within 60 s rejoins; past 60 s the opponent wins by abandonment; clocks agree within 500 ms between the two apps; XP and history are correct on both sides.

### Phase 11 — Release 1.0
**Goal:** a polished public v1.0.
- e2e additions (smoke harness): (5) two Electron instances play an online game against a locally started server; (6) quick match pairs two instances; (7) disconnect + rejoin.
- Server: production deploy, basic monitoring (uptime check on `/health`, error logs), documented runbook (`server/README.md`: deploy, rollback, what happens to live games on restart).
- Maintenance mode: server can reply `BUSY` with a message the app shows; minimum app version raised when the protocol changes.
- Final pass: version 1.0.0, CHANGELOG, README screenshots, About/credits, license review, clean-machine test on both OSes with online play.

**Acceptance:** v1.0.0 Release published with Windows and Mac builds; a fresh install on each OS can play AI, local and online games; server has been up 72 h with no crashes under light real use.

---

## 11. Global Acceptance Criteria (definition of done)

- All chess rules verified by tests; no illegal move possible by human, AI or a modified online client.
- XP/level math unit-tested; level never exceeds 50; XP never negative.
- Game, profiles, settings and history survive quitting and relaunching, and survive app updates (schema migrations).
- Offline modes work fully offline after install; online features degrade gracefully ("Can't reach server") and never block the rest of the app.
- Installers run on clean Windows 10/11 x64 and macOS 12+ (Apple Silicon and Intel) machines.
- Online games are server-authoritative; results and clocks agree on both clients; disconnections resolve within the grace period.
- No console errors in normal play; no orphan engine processes after exit.

## 12. Future Ideas (after v1)
Accounts + cloud saves, Elo ratings and leaderboards, friends list and direct challenges, preset quick-chat emotes, spectating, persistent server state (Redis/Postgres) so games survive server restarts, Linux AppImage, Microsoft Store / Mac App Store, puzzles, opening explorer, engine analysis/eval bar, daily challenges, 3D board, mobile app (see the shelved Android draft).

## 13. Online Play — Server Design

### 13.1 Architecture
```
Chess Arena app (Electron renderer)  --wss://-->  Game server (Node + ws + chess.js)
                                                    ├─ rooms   (code → waiting host)
                                                    ├─ queues  (time control → waiting players)
                                                    └─ games   (id → authoritative state + timers)
```
- One server process holding all state in memory; enough for hundreds of concurrent games on a small instance. Restarting the server ends live games (clients see "Server restarted — game ended, no result"); acceptable for v1 and documented.
- `src/shared/protocol.ts` (types + validators) and the chess rules library are shared so client and server never diverge.

### 13.2 Identity
- No accounts. Each install generates a random `guestId` (uuid) stored in userData; the display name comes from the profile (1–20 chars, trimmed, control characters stripped, basic profanity filter on the server; offending names replaced with "Player").
- Per game, the server issues each player a random `reconnectToken`; only that token can rejoin that seat.

### 13.3 Rooms & quick match
- Room code: 6 chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`; unique among live rooms; expires 10 min after creation or when the host disconnects for > 60 s.
- Quick-match pools: 3+2, 5+3, 10+0, 15+10. A player is paired the moment someone else is waiting in the same pool (so a pool never holds more than one player). Colors random.
- A guest can hold at most one of: room, queue entry, live game.

### 13.4 Game rules on the server
- Moves arrive as UCI (`e2e4`, `e7e8q`) with a `seq` equal to the current ply; duplicates are ignored, stale/out-of-turn/illegal moves get `error` + a fresh `game.state`.
- Clock: on each move, `elapsed = now − turnStartedAt − min(lagCredit, 500ms)` deducted from the mover, then increment added; a timer fires at the mover's flag time. Before White's first move the clocks don't run (but a 30 s "first move" timeout aborts the game).
- Disconnect: grace 60 s per player per disconnection; both players disconnected for 60 s → aborted.
- Results are final once `game.over` is sent; the server keeps the final state 10 min for rejoin.

### 13.5 Server hardening
- TLS terminated by the host; only `wss://` exposed. Origin check is not relied upon (desktop app); protection comes from validation and limits.
- Limits: max 4 KB per message, 20 messages/s per connection (burst 40), 5 room creations/min per connection, max connections per IP (e.g. 10); violators get `RATE_LIMIT` then disconnect.
- All messages validated against `protocol.ts`; unknown fields dropped; never `eval`, never log full messages with user strings at info level.
- No personal data stored: guest ids and display names live only in memory; logs keep ids, not names, for ≤ 7 days.
- Dependencies pinned and audited in CI.

### 13.6 Hosting & cost
- Render (or Fly.io / Railway) single small instance with health check and auto-deploy from `main`/tags. Note that free tiers may sleep when idle (first connection can take ~30–60 s); use the cheapest always-on plan for real use (~$7/month).
- Environment: `PORT`, `MIN_APP_VERSION`, `MAINTENANCE_MESSAGE` (optional), `LOG_LEVEL`.
- **Self-hosting is a first-class option** (no database, one Node process, one Docker image): the server must run with `npm start` or `docker run` on any always-on machine. Documented paths in `server/README.md`:
  1. **Own computer / Raspberry Pi + Cloudflare Tunnel** (free): `cloudflared` gives a public `wss://` URL without opening router ports or exposing the home IP. The machine must stay on.
  2. **Own computer + router port forwarding**: dynamic DNS + Caddy for automatic HTTPS. Exposes the home IP; more setup.
  3. **Rented VPS** (~$4–6/month): Docker + Caddy for TLS.
- The app's server URL is a build-time setting, so switching hosts means shipping an app update (or, later, a small remote config file).

### 13.7 Effort (solo developer + AI assistant)
Phase 8 ≈ 1 week (plus waiting for the first CI runs); Phase 9 ≈ 1–1.5 weeks; Phase 10 ≈ 1–1.5 weeks; Phase 11 ≈ 3–5 days.

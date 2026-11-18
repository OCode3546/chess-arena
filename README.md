# Chess Arena

A modern 2D chess game for **Windows** and **macOS**. Play a friend on the same computer or take on Stockfish at six difficulty levels, earn XP, level up to 50 and unlock boards, piece sets, avatars and titles. Everything works offline.

## Download

Get the latest version from the **[Releases page](https://github.com/OCode3546/chess-arena/releases/latest)**.

| Your computer | Download |
|---|---|
| Windows 10 or 11 (64-bit) | `ChessArena-Setup-x.y.z.exe` — installer, updates itself |
| | `ChessArena-x.y.z-portable.exe` — runs without installing |
| Mac with Apple Silicon (M1 or newer) | `ChessArena-x.y.z-arm64.dmg` |
| Mac with Intel | `ChessArena-x.y.z-x64.dmg` |

Not sure which Mac you have? Apple menu → **About This Mac**: "Chip: Apple M…" means Apple Silicon; "Processor: Intel" means Intel.

### Install on Windows

1. Run `ChessArena-Setup-x.y.z.exe`.
2. Chess Arena isn't code-signed yet, so Windows may show **"Windows protected your PC"**. Click **More info → Run anyway**. You only need to do this once.
3. Choose where to install. Shortcuts go on the desktop and in the Start menu.

**Uninstall:** Settings → Apps → Installed apps → Chess Arena → Uninstall. Your profiles and games stay in `%APPDATA%\Chess Arena` unless you delete that folder.

### Install on macOS (12 Monterey or newer)

1. Open the `.dmg` and drag **Chess Arena** into **Applications**.
2. Open Chess Arena from Applications. Because the app isn't notarized by Apple yet, macOS says it can't verify it. Click **Done**.
3. Open **System Settings → Privacy & Security**, scroll down to the message about Chess Arena and click **Open Anyway**, then confirm. You only need to do this once.

If macOS instead says the app "is damaged", run this once in Terminal and open it again:

```sh
xattr -dr com.apple.quarantine "/Applications/Chess Arena.app"
```

**Uninstall:** drag Chess Arena from Applications to the Trash. Your profiles and games stay in `~/Library/Application Support/Chess Arena` unless you delete that folder.

### Updates

- **Windows installer:** new versions download in the background and install when you restart the app (Settings → App → *Update automatically*).
- **Mac and the portable exe:** the app tells you when a new version is out and opens the download page.

### System requirements

Windows 10/11 x64 or macOS 12+, 4 GB RAM, about 400 MB of disk space. No internet connection needed to play.

## Build from source

You need [Node.js](https://nodejs.org/) 20 or newer and Git.

```sh
git clone https://github.com/OCode3546/chess-arena.git
cd chess-arena
npm install
npm run fetch:engine   # downloads the pinned, checksum-verified Stockfish for your OS
npm run dev            # run the app with hot reload
```

| Command | What it does |
|---|---|
| `npm run dev` | Start the app in development mode |
| `npm test` | Unit tests (Vitest) |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript checks |
| `npm run verify:sandbox` | End-to-end smoke suite: launches the built app and plays through every screen. Set `SMOKE_APP=<packaged executable>` to run it against a packaged build |
| `npm run dist:mac` | Build the Mac `.dmg` and `.zip` (Apple Silicon and Intel) into `release/<version>/` |
| `npm run dist:win` | Build the Windows installer and portable exe (on Windows; from a Mac use the GitHub workflow) |

### Releasing a new version

1. Bump `version` in `package.json`, add the notes to `CHANGELOG.md` and `src/config/changelog.ts`.
2. Commit, then tag and push: `git tag v0.9.0 && git push origin main v0.9.0`.
3. The **Release** workflow builds both platforms, runs the smoke suite on the packaged apps and creates a **draft** GitHub Release with all files.
4. Check the draft and click **Publish release**. Installed apps see the update only after that.

### Code signing (optional)

Unsigned builds work but show the warnings above. To sign, add these repository secrets; the release workflow picks them up automatically:

- **Windows:** `WIN_CSC_LINK` (base64 `.pfx` or URL) and `WIN_CSC_KEY_PASSWORD`. An OV/EV certificate or Azure Trusted Signing removes SmartScreen warnings.
- **macOS:** `MAC_CSC_LINK` and `MAC_CSC_KEY_PASSWORD` (a *Developer ID Application* certificate, Apple Developer Program, $99/year), plus `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` for notarization. Signed Mac builds also get automatic updates.

## Project layout

```
electron/        main process: window, storage, Stockfish process, updater
src/             React renderer: screens, board, AI, progression, stores
src/shared/      types, IPC channel names and validators shared by both sides
scripts/         Stockfish download and the end-to-end smoke suite
tests/           unit tests
spec.md          product spec and build phases
```

## Credits and licenses

Chess Arena bundles [Stockfish](https://stockfishchess.org/) (GPL-3.0, [source](https://github.com/official-stockfish/Stockfish)), [chess.js](https://github.com/jhlywa/chess.js) (BSD-2-Clause), the Cburnett and Merida piece sets, and the Inter and Space Grotesk fonts (OFL-1.1). See [CREDITS.md](CREDITS.md) and the [LICENSES](LICENSES/) folder; the license texts are also viewable in the app under **About**.

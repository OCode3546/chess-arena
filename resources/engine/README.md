# Engine binaries

Native Stockfish builds are not committed. Download the pinned, checksum-verified release with:

```sh
npm run fetch:engine                      # this machine's platform
node scripts/fetch-engine.mjs win32 x64   # the Windows build packaged into the installer
```

Stockfish is GPLv3 — see `LICENSES/Stockfish-GPL-3.0.txt` and `CREDITS.md`.

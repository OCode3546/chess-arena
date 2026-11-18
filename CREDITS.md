# Credits

## Developer

Chess Arena is designed and developed by **Orville Arrindell** (CodeGorilla) —
[github.com/OCode3546](https://github.com/OCode3546).

Chess Arena itself is free software, licensed under the **GNU General Public License v3.0**
(see [`LICENSE`](LICENSE)). Its source code is at https://github.com/OCode3546/chess-arena.

## Assets and libraries

| Asset                         | Author                            | License                                             | Source                                                                |
| ----------------------------- | --------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------- |
| "Modern" piece set (cburnett) | Colin M.L. Burnett                | GPLv2+ (`LICENSES/GPL-2.0.txt`)                     | https://github.com/lichess-org/lila/tree/master/public/piece/cburnett |
| "Classic" piece set (merida)  | Armando Hernández Marroquín       | GPLv2+ (`LICENSES/GPL-2.0.txt`)                     | https://github.com/lichess-org/lila/tree/master/public/piece/merida   |
| App icon knight               | Derived from the cburnett knight  | GPLv2+                                              | as above                                                              |
| chess.js                      | Jeff Hlywa                        | BSD-2-Clause (`LICENSES/chess.js-BSD-2-Clause.txt`) | https://github.com/jhlywa/chess.js                                    |
| Inter                         | The Inter Project Authors         | SIL OFL 1.1 (`LICENSES/Inter-OFL-1.1.txt`)          | https://github.com/rsms/inter                                         |
| Space Grotesk                 | The Space Grotesk Project Authors | SIL OFL 1.1 (`LICENSES/SpaceGrotesk-OFL-1.1.txt`)   | https://github.com/floriankarsten/space-grotesk                       |
| Sound effects                 | Orville Arrindell                 | Part of the app                                     | Synthesised at runtime with Web Audio (`src/audio/sfx.ts`)            |

## Chess engine

| Component                                   | Author                                     | License                                    | Source                                           |
| ------------------------------------------- | ------------------------------------------ | ------------------------------------------ | ------------------------------------------------ |
| Stockfish 19 (native binary, `engine/`)     | The Stockfish developers (see its AUTHORS) | GPLv3 (`LICENSES/Stockfish-GPL-3.0.txt`)   | https://github.com/official-stockfish/Stockfish  |
| stockfish.js 19 (WebAssembly fallback)      | Nathan Rugg, Chess.com, Stockfish authors  | GPLv3 (`LICENSES/Stockfish-GPL-3.0.txt`)   | https://github.com/nmrugg/stockfish.js           |

The native binaries are the unmodified official `sf_19` release builds, downloaded and
SHA-256-verified by `scripts/fetch-engine.mjs`. Their corresponding source code is the `sf_19`
tag of the Stockfish repository: https://github.com/official-stockfish/Stockfish/tree/sf_19

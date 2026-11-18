/** Release notes shown in About, newest first. */
export const CHANGELOG: { version: string; notes: string[] }[] = [
  {
    version: '0.8.0',
    notes: [
      'Downloadable installers for Windows and macOS (Apple Silicon and Intel)',
      'Automatic updates on Windows; an "update available" banner with a download link elsewhere',
      'Native macOS window buttons and app menu',
    ],
  },
  {
    version: '0.7.0',
    notes: [
      'Game history with move-by-move review and PGN export',
      'Sound effects for moves, captures, checks, castling, promotion, results and level-ups',
      'Settings: sound and volume, launch at startup, data export/import, reset progress, data folder',
      'How to Play guide with rules, diagrams and XP explained',
      'About: credits, bundled license texts and source links',
    ],
  },
  {
    version: '0.6.0',
    notes: [
      'Rewards roadmap for levels 1–50 with equippable boards, pieces, avatars, titles, frames and effects',
      'Achievements with unlock toasts',
    ],
  },
  {
    version: '0.5.0',
    notes: ['Local profiles, XP and levels up to 50 with a full XP breakdown after each game'],
  },
  {
    version: '0.4.0',
    notes: [
      'Play against Stockfish at six difficulties, with WebAssembly and built-in fallback engines',
      'Hints, takebacks and draw offers against the computer',
    ],
  },
  {
    version: '0.3.0',
    notes: [
      'Local two-player games with clocks, pause, resign and draw offers',
      'Auto-save and Continue Game',
    ],
  },
];

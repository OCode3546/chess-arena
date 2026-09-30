/** Web pages linked from the app. Only these open (in the system browser). */
export const LINKS = {
  stockfish: 'https://stockfishchess.org/',
  stockfishSource: 'https://github.com/official-stockfish/Stockfish/tree/sf_19',
  stockfishJs: 'https://github.com/nmrugg/stockfish.js',
  chessJs: 'https://github.com/jhlywa/chess.js',
  cburnett: 'https://github.com/lichess-org/lila/tree/master/public/piece/cburnett',
  merida: 'https://github.com/lichess-org/lila/tree/master/public/piece/merida',
  inter: 'https://github.com/rsms/inter',
  spaceGrotesk: 'https://github.com/floriankarsten/space-grotesk',
} as const;

/** The project's own pages. Fill in before a public release; empty links are hidden in About. */
export const PROJECT_LINKS = {
  website: '',
  support: '',
};

/** The developer credited in About. */
export const DEVELOPER = {
  name: 'Orville Arrindell',
  github: 'https://github.com/OCode3546',
} as const;

const ALLOWED = [
  'https://stockfishchess.org/',
  'https://github.com/official-stockfish/',
  'https://github.com/lichess-org/',
  LINKS.stockfishJs,
  LINKS.chessJs,
  LINKS.inter,
  LINKS.spaceGrotesk,
  DEVELOPER.github,
  ...Object.values(PROJECT_LINKS).filter(Boolean),
];

/** A URL on the allow-list: an exact entry, or a path below one. */
export function isAllowedExternal(url: string): boolean {
  return ALLOWED.some(
    (prefix) => url === prefix || url.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`),
  );
}

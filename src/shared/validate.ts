import {
  ACCENTS,
  DEFAULT_SETTINGS,
  type GameSettings,
  type SavedGame,
  type Settings,
  type TimeControl,
} from './types';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max = 256): v is string => typeof v === 'string' && v.length <= max;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

const SLUG = /^[a-z0-9-]{1,40}$/;
const FEN = /^[pnbrqkPNBRQK1-8/]{15,90} [wb] (-|[KQkq]{1,4}) (-|[a-h][36]) \d{1,4} \d{1,5}$/;

/**
 * Merge an untrusted partial settings object onto a base, keeping only known keys
 * with values of the right type. Unknown or malformed fields are dropped.
 */
export function sanitizeSettings(input: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const out: Settings = { ...base };
  if (!isObj(input)) return out;
  if (input.theme === 'dark' || input.theme === 'light') out.theme = input.theme;
  if (typeof input.accent === 'string' && (ACCENTS as readonly string[]).includes(input.accent)) {
    out.accent = input.accent as Settings['accent'];
  }
  if (isNum(input.volume)) out.volume = Math.min(1, Math.max(0, input.volume));
  for (const key of [
    'sound',
    'animations',
    'legalMoves',
    'coordinates',
    'autoQueen',
    'colorBlindHighlights',
    'autoUpdate',
    'launchAtStartup',
  ] as const) {
    const v = input[key];
    if (isBool(v)) out[key] = v;
  }
  if (isStr(input.board) && SLUG.test(input.board)) out.board = input.board;
  if (isStr(input.pieceSet) && SLUG.test(input.pieceSet)) out.pieceSet = input.pieceSet;
  return out;
}

export function isValidFen(fen: unknown): fen is string {
  return isStr(fen, 100) && FEN.test(fen);
}

function isTimeControl(v: unknown): v is TimeControl {
  return (
    isObj(v) &&
    isStr(v.id, 40) &&
    isNum(v.initialMs) &&
    v.initialMs >= 0 &&
    v.initialMs <= 6 * 60 * 60 * 1000 &&
    isNum(v.incrementMs) &&
    v.incrementMs >= 0 &&
    v.incrementMs <= 5 * 60 * 1000
  );
}

function isPlayer(v: unknown): boolean {
  return isObj(v) && isStr(v.name, 40);
}

export function isGameSettings(v: unknown): v is GameSettings {
  if (!isObj(v)) return false;
  if (v.mode !== 'pvp' && v.mode !== 'pvai') return false;
  if (!isTimeControl(v.timeControl)) return false;
  if (!isObj(v.players) || !isPlayer(v.players.w) || !isPlayer(v.players.b)) return false;
  if (!isBool(v.autoFlip)) return false;
  if (
    v.difficulty !== undefined &&
    !['beginner', 'easy', 'medium', 'hard', 'expert', 'grandmaster'].includes(
      v.difficulty as string,
    )
  ) {
    return false;
  }
  return true;
}

/** Structural validation of a saved game coming from disk or from the renderer. */
export function isSavedGame(v: unknown): v is SavedGame {
  if (!isObj(v)) return false;
  if (!isValidFen(v.fen)) return false;
  if (!isStr(v.pgn, 50_000)) return false;
  if (!isObj(v.clocks) || !isNum(v.clocks.w) || !isNum(v.clocks.b)) return false;
  if (v.clocks.w < 0 || v.clocks.b < 0) return false;
  if (v.turn !== 'w' && v.turn !== 'b') return false;
  if (!isStr(v.startedAt, 40) || Number.isNaN(Date.parse(v.startedAt))) return false;
  if (!isBool(v.clockStarted)) return false;
  return isGameSettings(v.settings);
}

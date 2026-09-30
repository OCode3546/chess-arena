import {
  ACCENTS,
  DEFAULT_EQUIPPED,
  DEFAULT_SETTINGS,
  type Difficulty,
  type Equipped,
  type GameRecord,
  type GameSettings,
  type Profile,
  type ProfilesDoc,
  type ProfileStats,
  type SavedGame,
  type Settings,
  type TimeControl,
} from './types';
import { UCI_MOVE, type SearchRequest } from './uci';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max = 256): v is string => typeof v === 'string' && v.length <= max;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isInt = (v: unknown, min: number, max: number): v is number =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

const SLUG = /^[a-z0-9-]{1,40}$/;
const isId = (v: unknown): v is string => typeof v === 'string' && SLUG.test(v);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (v: unknown): v is string => typeof v === 'string' && DATE.test(v);
const isIso = (v: unknown): v is string => isStr(v, 40) && !Number.isNaN(Date.parse(v));
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
  return isObj(v) && isStr(v.name, 40) && (v.profileId === undefined || isId(v.profileId));
}

const DIFFICULTIES: Difficulty[] = ['beginner', 'easy', 'medium', 'hard', 'expert', 'grandmaster'];

export function isGameSettings(v: unknown): v is GameSettings {
  if (!isObj(v)) return false;
  if (v.mode !== 'pvp' && v.mode !== 'pvai') return false;
  if (!isTimeControl(v.timeControl)) return false;
  if (!isObj(v.players) || !isPlayer(v.players.w) || !isPlayer(v.players.b)) return false;
  if (!isBool(v.autoFlip)) return false;
  if (v.difficulty !== undefined && !DIFFICULTIES.includes(v.difficulty as Difficulty))
    return false;
  if (v.humanColor !== undefined && v.humanColor !== 'w' && v.humanColor !== 'b') return false;
  if (v.assists !== undefined && !isBool(v.assists)) return false;
  if (v.mode === 'pvai' && (v.difficulty === undefined || v.humanColor === undefined)) return false;
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
  if (
    v.assists !== undefined &&
    !(isObj(v.assists) && isInt(v.assists.hints, 0, 10_000) && isInt(v.assists.undos, 0, 10_000))
  ) {
    return false;
  }
  return isGameSettings(v.settings);
}

/** Validation of an engine search coming from the renderer. */
export function isSearchRequest(v: unknown): v is SearchRequest {
  if (!isObj(v)) return false;
  if (!isValidFen(v.fen)) return false;
  if (!Array.isArray(v.moves) || v.moves.length > 2_000) return false;
  if (!v.moves.every((m) => typeof m === 'string' && UCI_MOVE.test(m))) return false;
  if (!isInt(v.skill, 0, 20)) return false;
  if (v.depth !== undefined && !isInt(v.depth, 1, 30)) return false;
  if (v.movetime !== undefined && !isInt(v.movetime, 10, 10_000)) return false;
  return true;
}

export const MAX_PROFILES = 8;
export const MAX_HISTORY = 500;
const MAX_LEVEL = 50;
const MAX_XP = 100_000_000;
const count = (v: unknown): number => (isInt(v, 0, 1e9) ? v : 0);

function sanitizeStats(v: unknown): ProfileStats {
  const s = isObj(v) ? v : {};
  const wbd = isObj(s.winsByDifficulty) ? s.winsByDifficulty : {};
  const stats: ProfileStats = {
    played: count(s.played),
    wins: count(s.wins),
    draws: count(s.draws),
    losses: count(s.losses),
    streak: count(s.streak),
    bestStreak: count(s.bestStreak),
    winsByDifficulty: Object.fromEntries(DIFFICULTIES.map((d) => [d, count(wbd[d])])) as Record<
      Difficulty,
      number
    >,
  };
  if (isDay(s.lastWinDate)) stats.lastWinDate = s.lastWinDate;
  if (isInt(s.fastestMate, 1, 10_000)) stats.fastestMate = s.fastestMate;
  return stats;
}

/** Structural check only: whether an item is unlocked is decided by the renderer from the level. */
export function sanitizeEquipped(v: unknown): Equipped {
  const e = isObj(v) ? v : {};
  const out: Equipped = {
    board: isId(e.board) ? e.board : DEFAULT_EQUIPPED.board,
    pieceSet: isId(e.pieceSet) ? e.pieceSet : DEFAULT_EQUIPPED.pieceSet,
    frame: isId(e.frame) ? e.frame : DEFAULT_EQUIPPED.frame,
    effects: Array.isArray(e.effects) ? [...new Set(e.effects.filter(isId))].slice(0, 10) : [],
  };
  if (isId(e.title)) out.title = e.title;
  return out;
}

function sanitizeAchievements(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isObj(v)) return out;
  for (const [id, at] of Object.entries(v).slice(0, 100)) if (isId(id) && isIso(at)) out[id] = at;
  return out;
}

/** A profile from disk or the renderer with every field checked; null if unusable. */
export function sanitizeProfile(v: unknown): Profile | null {
  if (!isObj(v) || !isId(v.id) || v.id === 'guest') return null;
  const name = isStr(v.name, 40) ? v.name.trim() : '';
  if (!name) return null;
  const pvpToday: Profile['pvpToday'] = {};
  if (isObj(v.pvpToday)) {
    for (const [key, entry] of Object.entries(v.pvpToday).slice(0, 50)) {
      if (isId(key) && isObj(entry) && isDay(entry.date) && isInt(entry.count, 0, 1e6)) {
        pvpToday[key] = { date: entry.date, count: entry.count };
      }
    }
  }
  return {
    id: v.id,
    name,
    avatarId: isId(v.avatarId) ? v.avatarId : 'knight-indigo',
    level: isInt(v.level, 1, MAX_LEVEL) ? v.level : 1,
    xp: isInt(v.xp, 0, MAX_XP) ? v.xp : 0,
    createdAt: isIso(v.createdAt) ? v.createdAt : new Date(0).toISOString(),
    stats: sanitizeStats(v.stats),
    pvpToday,
    equipped: sanitizeEquipped(v.equipped),
    achievements: sanitizeAchievements(v.achievements),
  };
}

/** Keep valid, uniquely-identified profiles; the active id falls back to the first profile. */
export function sanitizeProfilesDoc(v: unknown): ProfilesDoc {
  const list = isObj(v) && Array.isArray(v.profiles) ? v.profiles : [];
  const seen = new Set<string>();
  const profiles: Profile[] = [];
  for (const raw of list) {
    const p = sanitizeProfile(raw);
    if (!p || seen.has(p.id)) continue;
    seen.add(p.id);
    profiles.push(p);
    if (profiles.length === MAX_PROFILES) break;
  }
  const wanted = isObj(v) ? v.activeId : null;
  const activeId =
    typeof wanted === 'string' && seen.has(wanted) ? wanted : (profiles[0]?.id ?? null);
  return { activeId, profiles };
}

const PLAYER_REF = /^(guest|ai:[a-z]{1,20}|[a-z0-9-]{1,40})$/;

export function isGameRecord(v: unknown): v is GameRecord {
  if (!isObj(v)) return false;
  if (!isId(v.id) || !isIso(v.date)) return false;
  if (v.mode !== 'pvp' && v.mode !== 'pvai') return false;
  if (!isStr(v.white, 60) || !PLAYER_REF.test(v.white)) return false;
  if (!isStr(v.black, 60) || !PLAYER_REF.test(v.black)) return false;
  if (!isStr(v.whiteName, 40) || !isStr(v.blackName, 40)) return false;
  if (!isStr(v.pgn, 50_000)) return false;
  if (v.result !== '1-0' && v.result !== '0-1' && v.result !== '1/2-1/2') return false;
  if (!isStr(v.reason, 40) || !isInt(v.moves, 0, 10_000)) return false;
  if (!isObj(v.xpAwarded)) return false;
  return Object.entries(v.xpAwarded).every(([k, xp]) => isId(k) && isInt(xp, 0, 1_000_000));
}

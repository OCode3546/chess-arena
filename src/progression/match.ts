import type {
  AssistsUsed,
  Color,
  Difficulty,
  GameRecord,
  GameSettings,
  Profile,
  ProfileStats,
} from '@shared/types';
import { PVP_RULES, type Outcome } from '@/config/progression';
import { other, type GameResult } from '@/game/rules';
import { aiAward, pvpAward, type XpAward } from './awards';
import { applyXp, type XpState } from './levels';

export const GUEST = 'guest';

/** Local calendar day as YYYY-MM-DD. */
export function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function emptyStats(): ProfileStats {
  return {
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    streak: 0,
    bestStreak: 0,
    winsByDifficulty: { beginner: 0, easy: 0, medium: 0, hard: 0, expert: 0, grandmaster: 0 },
  };
}

export function newProfile(name: string, avatarId: string, now = new Date()): Profile {
  return {
    id: crypto.randomUUID(),
    name,
    avatarId,
    level: 1,
    xp: 0,
    createdAt: now.toISOString(),
    stats: emptyStats(),
    pvpToday: {},
  };
}

export interface FinishedGame {
  settings: GameSettings;
  result: GameResult;
  /** Verbose moves (only colour and captures are read). */
  history: { color: Color; captured?: string }[];
  pgn: string;
  assists: AssistsUsed;
}

export interface PlayerAward {
  profileId: string;
  color: Color;
  name: string;
  award: XpAward;
  before: XpState;
  after: XpState;
  levelsGained: number;
}

export interface Settlement {
  profiles: Profile[];
  record: GameRecord;
  awards: PlayerAward[];
}

const outcomeFor = (result: GameResult, color: Color): Outcome =>
  result.winner === null ? 'draw' : result.winner === color ? 'win' : 'loss';

function withResult(
  stats: ProfileStats,
  outcome: Outcome,
  opts: { difficulty?: Difficulty; mateIn?: number; day?: string },
): ProfileStats {
  const next: ProfileStats = {
    ...stats,
    winsByDifficulty: { ...stats.winsByDifficulty },
    played: stats.played + 1,
  };
  if (outcome === 'win') {
    next.wins++;
    next.streak = stats.streak + 1;
    next.bestStreak = Math.max(stats.bestStreak, next.streak);
    if (opts.difficulty) next.winsByDifficulty[opts.difficulty]++;
    if (opts.day) next.lastWinDate = opts.day;
    if (opts.mateIn !== undefined) {
      next.fastestMate = Math.min(stats.fastestMate ?? Infinity, opts.mateIn);
    }
  } else {
    if (outcome === 'draw') next.draws++;
    else next.losses++;
    next.streak = 0;
  }
  return next;
}

/**
 * Settle a finished game: work out each local profile's XP, update levels, stats and the
 * daily local-play counters, and build the history record. Pure — the caller persists.
 */
export function settleMatch(profiles: Profile[], game: FinishedGame, now = new Date()): Settlement {
  const { settings, result } = game;
  const moves = Math.ceil(game.history.length / 2);
  const day = localDay(now);
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const updated = new Map<string, Profile>();
  const awards: PlayerAward[] = [];

  const profileOn = (color: Color): Profile | undefined => {
    const id = settings.players[color].profileId;
    return id ? byId.get(id) : undefined;
  };
  const credit = (p: Profile, color: Color, award: XpAward, stats: ProfileStats, extra = {}) => {
    const before = { level: p.level, xp: p.xp };
    const { levelsGained, ...after } = applyXp(before, award.total);
    updated.set(p.id, { ...p, ...after, stats, ...extra });
    awards.push({ profileId: p.id, color, name: p.name, award, before, after, levelsGained });
  };

  if (settings.mode === 'pvai' && settings.humanColor && settings.difficulty) {
    const human = settings.humanColor;
    const p = profileOn(human);
    if (p) {
      const outcome = outcomeFor(result, human);
      const award = aiAward({
        difficulty: settings.difficulty,
        outcome,
        reason: result.reason,
        moves,
        queenLost: game.history.some((m) => m.color === other(human) && m.captured === 'q'),
        priorStreak: p.stats.streak,
        firstWinToday: p.stats.lastWinDate !== day,
        assistsUsed: game.assists.hints + game.assists.undos,
      });
      const stats = withResult(p.stats, outcome, {
        difficulty: settings.difficulty,
        day,
        mateIn: result.reason === 'checkmate' ? moves : undefined,
      });
      credit(p, human, award, stats);
    }
  } else if (settings.mode === 'pvp') {
    const sides = { w: profileOn('w'), b: profileOn('b') };
    const sameProfile = !!sides.w && sides.w.id === sides.b?.id;
    for (const color of ['w', 'b'] as const) {
      const p = sides[color];
      if (!p || (sameProfile && color === 'b')) continue;
      const opp = sides[other(color)];
      const key = opp?.id ?? GUEST;
      const entry = p.pvpToday[key];
      const before = entry?.date === day ? entry.count : 0;
      const outcome = outcomeFor(result, color);
      const award = pvpAward({
        outcome,
        reason: result.reason,
        moves,
        sameProfile,
        gamesTodayBefore: before,
        levelGap: opp ? p.level - opp.level : null,
      });
      if (sameProfile) {
        awards.push({
          profileId: p.id,
          color,
          name: p.name,
          award,
          before: { level: p.level, xp: p.xp },
          after: { level: p.level, xp: p.xp },
          levelsGained: 0,
        });
        continue;
      }
      // Only today's counters are kept.
      const pvpToday = Object.fromEntries(
        Object.entries(p.pvpToday).filter(([, e]) => e.date === day),
      );
      if (moves >= PVP_RULES.minMoves) pvpToday[key] = { date: day, count: before + 1 };
      const stats = withResult(p.stats, outcome, {
        mateIn: result.reason === 'checkmate' ? moves : undefined,
      });
      credit(p, color, award, stats, { pvpToday });
    }
  }

  const ref = (color: Color): string =>
    settings.players[color].profileId && byId.has(settings.players[color].profileId!)
      ? settings.players[color].profileId!
      : settings.mode === 'pvai' && color !== settings.humanColor
        ? `ai:${settings.difficulty}`
        : GUEST;

  const record: GameRecord = {
    id: crypto.randomUUID(),
    date: now.toISOString(),
    mode: settings.mode,
    white: ref('w'),
    black: ref('b'),
    whiteName: settings.players.w.name,
    blackName: settings.players.b.name,
    pgn: game.pgn,
    result: result.result,
    reason: result.reason,
    moves,
    xpAwarded: Object.fromEntries(awards.map((a) => [a.profileId, a.award.total])),
  };

  return {
    profiles: profiles.map((p) => updated.get(p.id) ?? p),
    record,
    awards,
  };
}

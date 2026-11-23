import {
  DEFAULT_EQUIPPED,
  type AssistsUsed,
  type Color,
  type Difficulty,
  type GameRecord,
  type GameSettings,
  type PlayerInfo,
  type Profile,
  type ProfileStats,
  type ResultCode,
} from '@shared/types';
import type { AchievementId } from '@/config/achievements';
import { ONLINE_RULES, PVP_RULES, type Outcome } from '@/config/progression';
import { unlocksBetween, type Reward } from '@/config/rewards';
import { other, type GameResult } from '@/game/rules';
import { newAchievements } from './achievements';
import { aiAward, isAbandoned, onlineAward, pvpAward, type XpAward } from './awards';
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
    online: { played: 0, wins: 0, draws: 0, losses: 0 },
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
    onlineToday: {},
    equipped: { ...DEFAULT_EQUIPPED, effects: [] },
    achievements: {},
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
  /** Rewards from every level gained. */
  unlocks: Reward[];
  achievements: AchievementId[];
}

export interface Settlement {
  profiles: Profile[];
  record: GameRecord;
  awards: PlayerAward[];
}

const outcomeFor = (result: GameResult, color: Color): Outcome =>
  result.winner === null ? 'draw' : result.winner === color ? 'win' : 'loss';

/** Apply an award to a profile: XP, level, the given stats and any achievements earned. */
function creditProfile(
  p: Profile,
  color: Color,
  award: XpAward,
  stats: ProfileStats,
  ctx: { outcome: Outcome; moves: number; abandoned: boolean; now: Date },
  extra: Partial<Profile> = {},
): { profile: Profile; award: PlayerAward } {
  const before = { level: p.level, xp: p.xp };
  const { levelsGained, ...after } = applyXp(before, award.total);
  const earned = newAchievements(p.achievements, {
    stats,
    outcome: ctx.outcome,
    moves: ctx.moves,
    abandoned: ctx.abandoned,
  });
  const achievements = { ...p.achievements };
  for (const id of earned) achievements[id] = ctx.now.toISOString();
  return {
    profile: { ...p, ...after, stats, achievements, ...extra },
    award: {
      profileId: p.id,
      color,
      name: p.name,
      award,
      before,
      after,
      levelsGained,
      unlocks: unlocksBetween(before.level, after.level),
      achievements: earned,
    },
  };
}

/** Keep only today's entries of a per-opponent daily counter. */
const todayOnly = (counts: Profile['pvpToday'], day: string) =>
  Object.fromEntries(Object.entries(counts).filter(([, e]) => e.date === day));

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
  const credit = (
    p: Profile,
    color: Color,
    award: XpAward,
    stats: ProfileStats,
    outcome: Outcome,
    extra: Partial<Profile> = {},
  ) => {
    const abandoned = isAbandoned(result.reason, moves);
    const c = creditProfile(p, color, award, stats, { outcome, moves, abandoned, now }, extra);
    updated.set(p.id, c.profile);
    awards.push(c.award);
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
      credit(p, human, award, stats, outcome);
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
          unlocks: [],
          achievements: [],
        });
        continue;
      }
      // Only today's counters are kept.
      const pvpToday = todayOnly(p.pvpToday, day);
      if (moves >= PVP_RULES.minMoves) pvpToday[key] = { date: day, count: before + 1 };
      const stats = withResult(p.stats, outcome, {
        mateIn: result.reason === 'checkmate' ? moves : undefined,
      });
      credit(p, color, award, stats, outcome, { pvpToday });
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
    // Local games always end with a result.
    result: result.result as ResultCode,
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

export interface FinishedOnlineGame {
  gameId: string;
  /** Local profile that played (the active one when the game started), if any. */
  profileId: string | null;
  color: Color;
  players: { w: PlayerInfo; b: PlayerInfo };
  /** The opponent's public id from the server (anti-farming key). */
  opponentId: string;
  /** The server's final result. */
  result: GameResult;
  plies: number;
  pgn: string;
}

/**
 * Settle an online game from the server's result (spec §5.3). Aborted games (no result)
 * are not recorded. A win by abandonment before move 10 is recorded but not counted.
 * Pure — the caller persists. Null when there is nothing to record.
 */
export function settleOnlineMatch(
  profiles: Profile[],
  game: FinishedOnlineGame,
  now = new Date(),
): Settlement | null {
  const { result, color } = game;
  if (result.result === '*') return null;
  const moves = Math.ceil(game.plies / 2);
  const day = localDay(now);
  const p = game.profileId ? profiles.find((x) => x.id === game.profileId) : undefined;
  const awards: PlayerAward[] = [];
  let updated: Profile | null = null;

  const counts = !(result.reason === 'abandonment' && moves < ONLINE_RULES.minMoves);
  if (p && counts) {
    const outcome = outcomeFor(result, color);
    const entry = p.onlineToday[game.opponentId];
    const before = entry?.date === day ? entry.count : 0;
    const award = onlineAward({
      outcome,
      reason: result.reason,
      moves,
      priorStreak: p.stats.streak,
      firstWinToday: p.stats.online.lastWinDate !== day,
      gamesTodayBefore: before,
    });
    const stats = withResult(p.stats, outcome, {
      mateIn: result.reason === 'checkmate' ? moves : undefined,
    });
    const o = p.stats.online;
    stats.online = {
      ...o,
      played: o.played + 1,
      wins: o.wins + (outcome === 'win' ? 1 : 0),
      draws: o.draws + (outcome === 'draw' ? 1 : 0),
      losses: o.losses + (outcome === 'loss' ? 1 : 0),
      ...(outcome === 'win' && { lastWinDate: day }),
    };
    const onlineToday = todayOnly(p.onlineToday, day);
    if (moves >= ONLINE_RULES.minMoves) {
      onlineToday[game.opponentId] = { date: day, count: before + 1 };
    }
    const c = creditProfile(
      p,
      color,
      award,
      stats,
      { outcome, moves, abandoned: moves < ONLINE_RULES.minMoves, now },
      { onlineToday },
    );
    updated = c.profile;
    awards.push(c.award);
  }

  const ref = (side: Color) => (side === color ? (p ? p.id : GUEST) : `online:${game.opponentId}`);
  const record: GameRecord = {
    id: crypto.randomUUID(),
    date: now.toISOString(),
    mode: 'online',
    white: ref('w'),
    black: ref('b'),
    whiteName: game.players.w.name.slice(0, 40),
    blackName: game.players.b.name.slice(0, 40),
    pgn: game.pgn,
    result: result.result,
    reason: result.reason,
    moves,
    xpAwarded: Object.fromEntries(awards.map((a) => [a.profileId, a.award.total])),
    onlineGameId: game.gameId,
  };
  return {
    profiles: profiles.map((x) => (updated && x.id === updated.id ? updated : x)),
    record,
    awards,
  };
}

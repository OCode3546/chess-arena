import type { ProfileStats } from '@shared/types';
import {
  ACHIEVEMENTS,
  GAMES_TARGET,
  QUICK_WIN_MOVES,
  STREAK_TARGET,
  type AchievementId,
} from '@/config/achievements';
import type { Outcome } from '@/config/progression';

export interface AchievementContext {
  /** Stats after the game was counted. */
  stats: ProfileStats;
  outcome: Outcome;
  /** Full moves played. */
  moves: number;
  /** Ended before it counted for XP (resigned/agreed/flagged too early). */
  abandoned: boolean;
}

const EARNED: Record<AchievementId, (c: AchievementContext) => boolean> = {
  'first-win': (c) => c.stats.wins >= 1,
  'streak-5': (c) => c.stats.bestStreak >= STREAK_TARGET,
  'beat-grandmaster': (c) => c.stats.winsByDifficulty.grandmaster >= 1,
  'quick-win': (c) => c.outcome === 'win' && !c.abandoned && c.moves <= QUICK_WIN_MOVES,
  'games-100': (c) => c.stats.played >= GAMES_TARGET,
};

/** Achievements this game earns that the profile does not have yet (stat ones catch up too). */
export function newAchievements(
  have: Record<string, string>,
  ctx: AchievementContext,
): AchievementId[] {
  return ACHIEVEMENTS.map((a) => a.id).filter((id) => !(id in have) && EARNED[id](ctx));
}

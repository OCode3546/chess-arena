export type AchievementId =
  'first-win' | 'streak-5' | 'beat-grandmaster' | 'quick-win' | 'games-100';

export interface Achievement {
  id: AchievementId;
  name: string;
  description: string;
  icon: string;
}

/** A win in at most this many moves earns "Lightning". */
export const QUICK_WIN_MOVES = 20;
export const STREAK_TARGET = 5;
export const GAMES_TARGET = 100;

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-win', name: 'First Victory', description: 'Win your first game', icon: '🏆' },
  {
    id: 'streak-5',
    name: 'On Fire',
    description: `Win ${STREAK_TARGET} games in a row`,
    icon: '🔥',
  },
  {
    id: 'beat-grandmaster',
    name: 'Giant Slayer',
    description: 'Beat the Grandmaster computer',
    icon: '👑',
  },
  {
    id: 'quick-win',
    name: 'Lightning',
    description: `Win a game in ${QUICK_WIN_MOVES} moves or fewer`,
    icon: '⚡',
  },
  { id: 'games-100', name: 'Centurion', description: `Play ${GAMES_TARGET} games`, icon: '💯' },
];

export const achievementById = (id: string): Achievement | undefined =>
  ACHIEVEMENTS.find((a) => a.id === id);

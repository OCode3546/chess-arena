import { DEFAULT_EQUIPPED, type Equipped, type Profile } from '@shared/types';
import { AVATARS, type AvatarPack } from './avatars';
import { BOARD_THEMES } from './boards';
import { PIECE_SETS } from './pieces';
import { MAX_LEVEL } from './progression';

/** Level rewards (spec §5.4). Unlocks are always derived from a profile's level. */

export type RewardKind = 'board' | 'pieceSet' | 'avatar' | 'title' | 'frame' | 'effect';

export interface Reward {
  kind: RewardKind;
  id: string;
  name: string;
  level: number;
}

export const TITLES: Record<string, string> = {
  'pawn-pusher': 'Pawn Pusher',
  'knight-errant': 'Knight Errant',
  'bishops-gambit': 'Bishop’s Gambit',
  'rook-commander': 'Rook Commander',
  'queens-guard': 'Queen’s Guard',
  'grandmaster-candidate': 'Grandmaster Candidate',
  'chess-legend': 'Chess Legend',
};

/** Avatar frames; 'none' is always available. */
export const FRAMES: Record<string, string> = {
  none: 'No frame',
  hard: 'Hard badge frame',
  gold: 'Gold avatar frame',
  animated: 'Animated frame',
  rainbow: 'Rainbow frame',
};

export const EFFECTS: Record<string, { name: string; description: string }> = {
  'move-trail': { name: 'Move trail', description: 'Moves leave a glowing streak' },
  'capture-particles': { name: 'Capture particles', description: 'Captures burst into sparks' },
};

const board = (id: string): Omit<Reward, 'level'> => ({
  kind: 'board',
  id,
  name: BOARD_THEMES.find((b) => b.id === id)!.name,
});
const pieces = (id: string): Omit<Reward, 'level'> => ({
  kind: 'pieceSet',
  id,
  name: `${PIECE_SETS.find((p) => p.id === id)!.name} pieces`,
});
const avatars = (pack: AvatarPack): Omit<Reward, 'level'>[] =>
  AVATARS.filter((a) => a.pack === pack).map((a) => ({ kind: 'avatar', id: a.id, name: a.name }));
const title = (id: string): Omit<Reward, 'level'> => ({ kind: 'title', id, name: TITLES[id]! });
const frame = (id: string): Omit<Reward, 'level'> => ({ kind: 'frame', id, name: FRAMES[id]! });
const effect = (id: string): Omit<Reward, 'level'> => ({
  kind: 'effect',
  id,
  name: EFFECTS[id]!.name,
});

const TABLE: Record<number, Omit<Reward, 'level'>[]> = {
  1: [board('classic-wood'), pieces('modern'), pieces('classic'), ...avatars('starter')],
  3: [board('slate')],
  5: [title('pawn-pusher'), ...avatars('pack-1')],
  8: [board('emerald')],
  10: [title('knight-errant'), frame('hard')],
  15: [board('midnight')],
  20: [title('bishops-gambit'), ...avatars('pack-2'), effect('move-trail')],
  25: [board('neon')],
  30: [title('rook-commander'), frame('gold')],
  35: [board('marble')],
  40: [title('queens-guard'), effect('capture-particles')],
  45: [title('grandmaster-candidate'), frame('animated')],
  50: [title('chess-legend'), ...avatars('legendary'), frame('rainbow')],
};

export const REWARDS: Reward[] = Object.entries(TABLE).flatMap(([level, items]) =>
  items.map((r) => ({ ...r, level: Number(level) })),
);

export const rewardKey = (r: Pick<Reward, 'kind' | 'id'>) => `${r.kind}:${r.id}`;

const BY_KEY = new Map(REWARDS.map((r) => [rewardKey(r), r]));

export function rewardsAt(level: number): Reward[] {
  return REWARDS.filter((r) => r.level === level);
}

/** Everything gained going from `from` to `to` (every level in between for multi-level jumps). */
export function unlocksBetween(from: number, to: number): Reward[] {
  return REWARDS.filter((r) => r.level > from && r.level <= Math.min(to, MAX_LEVEL));
}

export function unlockedAt(level: number): Reward[] {
  return REWARDS.filter((r) => r.level <= level);
}

/** The level that unlocks an item, or null if it is not a reward. */
export function unlockLevel(kind: RewardKind, id: string): number | null {
  if (kind === 'frame' && id === 'none') return 1;
  return BY_KEY.get(`${kind}:${id}`)?.level ?? null;
}

export function isUnlocked(kind: RewardKind, id: string, level: number): boolean {
  const needed = unlockLevel(kind, id);
  return needed !== null && needed <= level;
}

/** Level badge tiers; every level without another reward grants its badge only. */
export const BADGE_TIERS = [
  { from: 1, id: 'rookie', name: 'Rookie' },
  { from: 10, id: 'bronze', name: 'Bronze' },
  { from: 20, id: 'silver', name: 'Silver' },
  { from: 30, id: 'gold', name: 'Gold' },
  { from: 40, id: 'platinum', name: 'Platinum' },
  { from: 50, id: 'legend', name: 'Legend' },
] as const;

export type BadgeTier = (typeof BADGE_TIERS)[number];

export function badgeTier(level: number): BadgeTier {
  return [...BADGE_TIERS].reverse().find((t) => level >= t.from) ?? BADGE_TIERS[0];
}

export interface Cosmetics extends Equipped {
  avatarId: string;
}

/** What a profile actually shows: anything not (or no longer) unlocked falls back to the default. */
export function cosmeticsFor(profile: Profile | null): Cosmetics {
  if (!profile) return { ...DEFAULT_EQUIPPED, avatarId: AVATARS[0]!.id };
  const { level, equipped: e } = profile;
  const ok = (kind: RewardKind, id: string) => isUnlocked(kind, id, level);
  const out: Cosmetics = {
    board: ok('board', e.board) ? e.board : DEFAULT_EQUIPPED.board,
    pieceSet: ok('pieceSet', e.pieceSet) ? e.pieceSet : DEFAULT_EQUIPPED.pieceSet,
    frame: ok('frame', e.frame) ? e.frame : DEFAULT_EQUIPPED.frame,
    effects: e.effects.filter((id) => ok('effect', id)),
    avatarId: ok('avatar', profile.avatarId) ? profile.avatarId : AVATARS[0]!.id,
  };
  if (e.title && ok('title', e.title)) out.title = e.title;
  return out;
}

import { LEVEL_CURVE, MAX_LEVEL } from '@/config/progression';

/** XP needed to go from `level` to `level + 1`; 0 at the level cap. */
export function xpToNext(level: number): number {
  if (!Number.isInteger(level) || level < 1) throw new RangeError(`Invalid level ${level}`);
  if (level >= MAX_LEVEL) return 0;
  const n = level - 1;
  return Math.round(LEVEL_CURVE.base + LEVEL_CURVE.linear * n + LEVEL_CURVE.quadratic * n * n);
}

/** THRESHOLDS[L] = cumulative XP at which level L is reached (index 0 unused). */
const THRESHOLDS: number[] = [0, 0];
for (let level = 2; level <= MAX_LEVEL; level++) {
  THRESHOLDS[level] = THRESHOLDS[level - 1]! + xpToNext(level - 1);
}

/** Cumulative XP needed to reach `level`. */
export function xpForLevel(level: number): number {
  const clamped = Math.min(MAX_LEVEL, Math.max(1, Math.floor(level)));
  return THRESHOLDS[clamped]!;
}

export function levelForXp(xp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && xp >= THRESHOLDS[level + 1]!) level++;
  return level;
}

export interface LevelProgress {
  level: number;
  /** XP earned inside the current level. */
  into: number;
  /** XP the current level needs in total (0 at max). */
  needed: number;
  /** 0..1 (1 at max). */
  fraction: number;
  max: boolean;
}

export function levelProgress(xp: number): LevelProgress {
  const total = Math.max(0, xp);
  const level = levelForXp(total);
  if (level >= MAX_LEVEL) return { level, into: 0, needed: 0, fraction: 1, max: true };
  const needed = xpToNext(level);
  const into = total - xpForLevel(level);
  return { level, into, needed, fraction: into / needed, max: false };
}

export interface XpState {
  level: number;
  xp: number;
}

/**
 * Add XP (negative or fractional amounts are ignored/rounded) and derive the new level,
 * jumping several levels if needed and stopping at the cap. Total XP keeps counting at max.
 */
export function applyXp(state: XpState, amount: number): XpState & { levelsGained: number } {
  const gain = Math.max(0, Math.round(Number.isFinite(amount) ? amount : 0));
  const xp = Math.max(0, state.xp) + gain;
  const level = Math.min(MAX_LEVEL, Math.max(state.level, levelForXp(xp)));
  return { level, xp, levelsGained: level - state.level };
}

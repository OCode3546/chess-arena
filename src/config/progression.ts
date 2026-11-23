import type { Difficulty } from '@shared/types';

/** Level & XP tuning (spec §5). All progression maths reads from here. */

export const MAX_LEVEL = 50;

/** xpToNext(L) = round(BASE + LINEAR·(L−1) + QUADRATIC·(L−1)²) for L in 1..49. */
export const LEVEL_CURVE = { base: 100, linear: 25, quadratic: 2.5 };

export type Outcome = 'win' | 'draw' | 'loss';

/** vs AI base awards. */
export const AI_XP: Record<Difficulty, Record<Outcome, number>> = {
  beginner: { win: 40, draw: 15, loss: 5 },
  easy: { win: 70, draw: 25, loss: 8 },
  medium: { win: 110, draw: 40, loss: 12 },
  hard: { win: 170, draw: 65, loss: 18 },
  expert: { win: 250, draw: 95, loss: 25 },
  grandmaster: { win: 360, draw: 140, loss: 35 },
};

/** vs AI win bonuses; percentages are of the base award and add up. */
export const AI_BONUS = {
  checkmatePct: 10,
  shortWinPct: 10,
  /** A win in fewer than this many moves counts as short. */
  shortWinMoves: 40,
  queenIntactPct: 10,
  /** Per consecutive win before this one. */
  streakPctPerWin: 5,
  streakPctCap: 25,
  firstWinOfDay: 50,
};

/** Each hint or takeback removes this share of the game's XP… */
export const ASSIST_PENALTY_PCT = 25;
/** …but never below this share of the base award. */
export const ASSIST_FLOOR_PCT = 25;

/** Games ended by these reasons before this move give no XP. */
export const ABANDON_BEFORE_MOVE = 5;

export const PVP_XP: Record<Outcome, number> = { win: 60, draw: 30, loss: 15 };

export const PVP_RULES = {
  /** A local game must reach this move to award XP. */
  minMoves: 10,
  /** Games already played today by the same pairing: from `halfAfter` on XP halves, from `zeroAfter` on it stops. */
  halfAfter: 5,
  zeroAfter: 10,
  /** Level difference that triggers the winner's multiplier. */
  levelGap: 10,
  higherWinnerFactor: 0.5,
  lowerWinnerFactor: 1.5,
};

/** vs an online player (spec §5.3). */
export const ONLINE_XP: Record<Outcome, number> = { win: 80, draw: 35, loss: 12 };

export const ONLINE_RULES = {
  /** An online game must reach this move to award XP (and to count an abandonment win). */
  minMoves: 10,
  /** Games already played today vs the same opponent: from `halfAfter` on XP halves, from `zeroAfter` on it stops. */
  halfAfter: 3,
  zeroAfter: 6,
  firstWinOfDay: 50,
};

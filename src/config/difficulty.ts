import type { Difficulty } from '@shared/types';

export interface DifficultyPreset {
  id: Difficulty;
  label: string;
  blurb: string;
  /** Stockfish "Skill Level" 0–20. */
  skill: number;
  /** Search depth; a range picks randomly per move. */
  depth?: number | [number, number];
  movetime?: number;
  /** Chance of playing a random legal move instead of searching. */
  randomChance: number;
  /** Depth of the built-in minimax fallback. */
  minimaxDepth: number;
  /** Hints and takebacks may be enabled. */
  assistsAllowed: boolean;
  /** The AI resigns hopeless positions (off for the learner levels). */
  resigns: boolean;
}

export const DIFFICULTY_ORDER: Difficulty[] = [
  'beginner',
  'easy',
  'medium',
  'hard',
  'expert',
  'grandmaster',
];

export const DIFFICULTIES: Record<Difficulty, DifficultyPreset> = {
  beginner: {
    id: 'beginner',
    label: 'Beginner',
    blurb: 'Learning the moves',
    skill: 0,
    depth: [1, 2],
    randomChance: 0.25,
    minimaxDepth: 1,
    assistsAllowed: true,
    resigns: false,
  },
  easy: {
    id: 'easy',
    label: 'Easy',
    blurb: 'Casual club player',
    skill: 3,
    depth: 3,
    randomChance: 0,
    minimaxDepth: 2,
    assistsAllowed: true,
    resigns: false,
  },
  medium: {
    id: 'medium',
    label: 'Medium',
    blurb: 'Solid and patient',
    skill: 7,
    depth: 6,
    randomChance: 0,
    minimaxDepth: 3,
    assistsAllowed: true,
    resigns: true,
  },
  hard: {
    id: 'hard',
    label: 'Hard',
    blurb: 'Punishes mistakes',
    skill: 12,
    movetime: 400,
    randomChance: 0,
    minimaxDepth: 3,
    assistsAllowed: true,
    resigns: true,
  },
  expert: {
    id: 'expert',
    label: 'Expert',
    blurb: 'Master strength',
    skill: 17,
    movetime: 1000,
    randomChance: 0,
    minimaxDepth: 3,
    assistsAllowed: false,
    resigns: true,
  },
  grandmaster: {
    id: 'grandmaster',
    label: 'Grandmaster',
    blurb: 'Full-strength Stockfish',
    skill: 20,
    movetime: 2000,
    randomChance: 0,
    minimaxDepth: 3,
    assistsAllowed: false,
    resigns: true,
  },
};

/** Minimum time between the human's move and the AI's reply. */
export const AI_MIN_MOVE_DELAY_MS = 400;

/** Full-strength search used for hints and draw-offer evaluation. */
export const ANALYSIS = { skill: 20, depth: 14, movetime: 600 };

/** Draw offers: the AI accepts when it is not better, and only once the game is under way. */
export const DRAW_POLICY = { minPlies: 40, maxAiEval: 50 };

/** Resignation: AI eval at or below this for `moves` consecutive AI moves. */
export const RESIGN_POLICY = { threshold: -900, moves: 3, minPlies: 30 };

export function aiPlayerName(difficulty: Difficulty): string {
  return `Stockfish · ${DIFFICULTIES[difficulty].label}`;
}

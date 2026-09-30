import { Chess } from 'chess.js';
import { ANALYSIS, DIFFICULTIES, DRAW_POLICY, RESIGN_POLICY } from '@/config/difficulty';
import type { Difficulty } from '@shared/types';
import type { AiSearch } from './backends';
import { aiEngine, type AiEngine, type EngineResult } from './engine';

export interface EnginePosition {
  /** Start position of the game. */
  fen: string;
  /** Moves since `fen` in UCI notation. */
  moves: string[];
}

export interface AiMove {
  move: string;
  /** Eval in centipawns from the AI's side; null when unknown (random move). */
  score: number | null;
  random: boolean;
}

const pick = <T>(list: T[], random: () => number): T => list[Math.floor(random() * list.length)]!;

function legalMoves(pos: EnginePosition): string[] {
  const chess = new Chess(pos.fen);
  for (const m of pos.moves)
    chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
  return chess.moves({ verbose: true }).map((m) => m.lan);
}

/** Engine limits for a difficulty; in timed games the AI never thinks longer than its clock allows. */
export function searchFor(
  difficulty: Difficulty,
  pos: EnginePosition,
  remainingMs: number | null,
  random: () => number = Math.random,
): AiSearch {
  const preset = DIFFICULTIES[difficulty];
  const req: AiSearch = {
    fen: pos.fen,
    moves: pos.moves,
    skill: preset.skill,
    minimaxDepth: preset.minimaxDepth,
    jitter: difficulty === 'beginner' ? 120 : difficulty === 'easy' ? 40 : 0,
  };
  if (Array.isArray(preset.depth)) {
    const [lo, hi] = preset.depth;
    req.depth = lo + Math.floor(random() * (hi - lo + 1));
  } else if (preset.depth !== undefined) {
    req.depth = preset.depth;
  }
  if (preset.movetime !== undefined) req.movetime = preset.movetime;
  if (remainingMs !== null) {
    const budget = Math.max(50, Math.min(Math.floor(remainingMs / 30), 10_000));
    req.movetime = Math.min(req.movetime ?? budget, budget);
  }
  return req;
}

/** Choose the AI's move for the side to move in `pos`. */
export async function chooseAiMove(
  pos: EnginePosition,
  difficulty: Difficulty,
  opts: {
    remainingMs?: number | null;
    signal?: AbortSignal;
    engine?: AiEngine;
    random?: () => number;
  } = {},
): Promise<AiMove> {
  const random = opts.random ?? Math.random;
  const preset = DIFFICULTIES[difficulty];
  if (preset.randomChance > 0 && random() < preset.randomChance) {
    return { move: pick(legalMoves(pos), random), score: null, random: true };
  }
  const engine = opts.engine ?? aiEngine;
  const res = await engine.search(
    searchFor(difficulty, pos, opts.remainingMs ?? null, random),
    opts.signal,
  );
  return { move: res.bestmove, score: res.score, random: false };
}

/** Full-strength best move for the side to move (hints). */
export function analyse(
  pos: EnginePosition,
  opts: { signal?: AbortSignal; engine?: AiEngine; movetime?: number } = {},
): Promise<EngineResult> {
  const engine = opts.engine ?? aiEngine;
  return engine.search(
    {
      ...pos,
      skill: ANALYSIS.skill,
      depth: ANALYSIS.depth,
      movetime: opts.movetime ?? ANALYSIS.movetime,
      minimaxDepth: 3,
    },
    opts.signal,
  );
}

/** Whether the AI accepts a draw, given its eval (centipawns, AI's point of view). */
export function acceptsDraw(aiEval: number | null, plies: number): boolean {
  if (aiEval === null) return false;
  return plies >= DRAW_POLICY.minPlies && aiEval <= DRAW_POLICY.maxAiEval;
}

/** Tracks consecutive hopeless evals and decides when the AI resigns. */
export class ResignTracker {
  private streak = 0;

  constructor(private readonly difficulty: Difficulty) {}

  /** Record the AI's eval for its move; true = resign instead of playing it. */
  record(aiEval: number | null, plies: number): boolean {
    if (!DIFFICULTIES[this.difficulty].resigns || aiEval === null) {
      if (aiEval !== null && aiEval > RESIGN_POLICY.threshold) this.streak = 0;
      return false;
    }
    this.streak = aiEval <= RESIGN_POLICY.threshold ? this.streak + 1 : 0;
    return plies >= RESIGN_POLICY.minPlies && this.streak >= RESIGN_POLICY.moves;
  }

  reset(): void {
    this.streak = 0;
  }
}

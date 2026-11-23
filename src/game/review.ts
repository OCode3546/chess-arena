import { Chess, type Move } from 'chess.js';
import type { Color, GameRecord } from '@shared/types';
import type { Outcome } from '@/config/progression';
import { REASON_LABEL, type EndReason } from './rules';

/** Verbose moves of a stored game; null if its PGN cannot be read. */
export function movesFromPgn(pgn: string): Move[] | null {
  const chess = new Chess();
  try {
    chess.loadPgn(pgn);
  } catch {
    return null;
  }
  return chess.history({ verbose: true });
}

/** Normalise a requested ply as the live game does: past the end means the final position. */
export function clampPly(ply: number | null, length: number): number | null {
  if (ply === null || ply >= length) return null;
  return Math.max(0, ply);
}

/** The side a profile played in a recorded game, if it played. */
export function sideOf(record: GameRecord, profileId: string | null): Color | null {
  if (!profileId) return null;
  if (record.white === profileId) return 'w';
  if (record.black === profileId) return 'b';
  return null;
}

/** The result for one side of a recorded game. */
export function outcomeOf(record: GameRecord, side: Color): Outcome {
  if (record.result === '1/2-1/2') return 'draw';
  return (record.result === '1-0') === (side === 'w') ? 'win' : 'loss';
}

export function reasonLabel(reason: string): string {
  return REASON_LABEL[reason as EndReason] ?? reason;
}

const MODE_LABEL: Record<GameRecord['mode'], string> = {
  pvai: 'vs computer',
  pvp: 'Local game',
  online: 'Online game',
};

export function modeLabel(mode: GameRecord['mode']): string {
  return MODE_LABEL[mode];
}

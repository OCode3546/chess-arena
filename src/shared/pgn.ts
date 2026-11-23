import { Chess } from 'chess.js';
import type { GameRecord } from './types';

/** PGN `Termination` tag for how the game ended. */
const TERMINATION: Record<string, string> = {
  timeout: 'Time forfeit',
  'timeout-insufficient': 'Time forfeit',
  abandonment: 'Abandoned',
};

const EVENT: Record<GameRecord['mode'], string> = {
  pvp: 'Chess Arena local game',
  pvai: 'Chess Arena game vs computer',
  online: 'Chess Arena online game',
};

/**
 * A finished game as a standard PGN file: the Seven Tag Roster in order, a
 * `Termination` tag, movetext wrapped to at most 80 columns and ending in the result.
 * Null when the stored moves cannot be read.
 */
export function exportPgn(record: GameRecord): string | null {
  const chess = new Chess();
  try {
    chess.loadPgn(record.pgn);
  } catch {
    return null;
  }
  const date = chess.getHeaders()['Date'];
  chess.setHeader('Event', EVENT[record.mode]);
  chess.setHeader('Site', 'Chess Arena');
  if (!date || date.includes('?'))
    chess.setHeader('Date', record.date.slice(0, 10).replace(/-/g, '.'));
  chess.setHeader('Round', '-');
  chess.setHeader('White', record.whiteName);
  chess.setHeader('Black', record.blackName);
  chess.setHeader('Result', record.result);
  chess.setHeader('Termination', TERMINATION[record.reason] ?? 'Normal');
  // chess.js can run one column past `maxWidth`.
  return `${chess.pgn({ maxWidth: 79 })}\n`;
}

/** A safe default file name such as `2026-09-30 Ana vs Stockfish Easy.pgn`. */
export function pgnFileName(record: GameRecord): string {
  const clean = (name: string) =>
    name
      .replace(/[^\p{L}\p{N} _-]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 30) || 'Player';
  return `${record.date.slice(0, 10)} ${clean(record.whiteName)} vs ${clean(record.blackName)}.pgn`;
}

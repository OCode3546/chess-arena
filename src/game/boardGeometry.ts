import type { Square } from 'chess.js';
import type { Color } from '@shared/types';

const FILES = 'abcdefgh';

/** Square shown at display row/col (row 0 = top) for the given orientation. */
export function squareAt(row: number, col: number, orientation: Color): Square {
  const file = orientation === 'w' ? col : 7 - col;
  const rank = orientation === 'w' ? 8 - row : row + 1;
  return `${FILES[file]}${rank}` as Square;
}

/** Display row/col of a square for the given orientation. */
export function displayPos(square: Square, orientation: Color): { row: number; col: number } {
  const file = FILES.indexOf(square[0]!);
  const rank = Number(square[1]);
  return orientation === 'w' ? { row: 8 - rank, col: file } : { row: rank - 1, col: 7 - file };
}

export const isLightSquare = (square: Square) =>
  (FILES.indexOf(square[0]!) + Number(square[1])) % 2 === 0;

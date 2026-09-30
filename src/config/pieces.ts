import type { PieceSymbol } from 'chess.js';
import type { Color } from '@shared/types';

const modern = import.meta.glob<string>('../assets/pieces/modern/*.svg', {
  eager: true,
  import: 'default',
});
const classic = import.meta.glob<string>('../assets/pieces/classic/*.svg', {
  eager: true,
  import: 'default',
});

export interface PieceSet {
  id: string;
  name: string;
  files: Record<string, string>;
}

export const PIECE_SETS: PieceSet[] = [
  { id: 'modern', name: 'Modern', files: modern },
  { id: 'classic', name: 'Classic', files: classic },
];

export function pieceUrl(setId: string, color: Color, type: PieceSymbol): string {
  const set = PIECE_SETS.find((s) => s.id === setId) ?? PIECE_SETS[0]!;
  const key = Object.keys(set.files).find((k) => k.endsWith(`/${color}${type.toUpperCase()}.svg`));
  return key ? set.files[key]! : '';
}

export const PIECE_NAME: Record<PieceSymbol, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

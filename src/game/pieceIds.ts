import { Chess, type Move, type PieceSymbol, type Square } from 'chess.js';
import type { Color } from '@shared/types';

export interface TrackedPiece {
  id: string;
  type: PieceSymbol;
  color: Color;
  square: Square;
}

/**
 * Replays `moves` from `startFen` and returns every piece on the board with a
 * stable id, so the UI can animate the same element from square to square.
 */
export function trackPieces(startFen: string, moves: readonly Move[]): TrackedPiece[] {
  const bySquare = new Map<Square, TrackedPiece>();
  for (const row of new Chess(startFen).board()) {
    for (const p of row) {
      if (p)
        bySquare.set(p.square, {
          id: `${p.color}${p.type}-${p.square}`,
          type: p.type,
          color: p.color,
          square: p.square,
        });
    }
  }
  for (const m of moves) {
    const piece = bySquare.get(m.from);
    if (!piece) continue;
    if (m.isEnPassant()) {
      bySquare.delete(`${m.to[0]}${m.from[1]}` as Square);
    }
    bySquare.delete(m.from);
    bySquare.set(m.to, { ...piece, square: m.to, type: m.promotion ?? piece.type });
    if (m.isKingsideCastle() || m.isQueensideCastle()) {
      const rank = m.from[1];
      const [rf, rt] = m.isKingsideCastle() ? ['h', 'f'] : ['a', 'd'];
      const rook = bySquare.get(`${rf}${rank}` as Square);
      if (rook) {
        bySquare.delete(rook.square);
        const square = `${rt}${rank}` as Square;
        bySquare.set(square, { ...rook, square });
      }
    }
  }
  return [...bySquare.values()];
}

/** Pieces each side has captured, in capture order. */
export function capturedPieces(moves: readonly Move[]): Record<Color, PieceSymbol[]> {
  const out: Record<Color, PieceSymbol[]> = { w: [], b: [] };
  for (const m of moves) if (m.captured) out[m.color].push(m.captured);
  return out;
}

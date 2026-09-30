import { Chess, type Square } from 'chess.js';
import { DRAW_POLICY } from './difficulty';

/** A small position for the How to Play screen. */
export interface Diagram {
  fen: string;
  /** Pieces whose legal moves are drawn (dots, or rings for captures). */
  from?: Square[];
  /** A king shown in check. */
  check?: Square;
  /** Squares tinted like a last move. */
  highlight?: Square[];
  caption: string;
}

/** Legal-move markers for a diagram's `from` pieces: target square → is it a capture? */
export function diagramTargets(d: Diagram): Map<Square, boolean> {
  const out = new Map<Square, boolean>();
  if (!d.from) return out;
  const chess = new Chess(d.fen);
  for (const square of d.from) {
    for (const m of chess.moves({ square, verbose: true })) {
      out.set(m.to, !!out.get(m.to) || m.isCapture() || m.isEnPassant());
    }
  }
  return out;
}

export const START_POSITION: Diagram = {
  fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  caption: 'The starting position. White always moves first.',
};

export interface PieceLesson {
  name: string;
  text: string;
  diagram: Diagram;
}

export const PIECE_LESSONS: PieceLesson[] = [
  {
    name: 'King',
    text: 'Moves one square in any direction. It may never move onto a square the opponent attacks.',
    diagram: { fen: 'k7/8/8/8/4K3/8/8/8 w - - 0 1', from: ['e4'], caption: 'King on e4' },
  },
  {
    name: 'Queen',
    text: 'Moves any number of squares in a straight line: along ranks, files and diagonals.',
    diagram: { fen: 'k7/8/8/8/3Q4/8/8/7K w - - 0 1', from: ['d4'], caption: 'Queen on d4' },
  },
  {
    name: 'Rook',
    text: 'Moves any number of squares along ranks and files.',
    diagram: { fen: 'k7/8/8/8/3R4/8/8/7K w - - 0 1', from: ['d4'], caption: 'Rook on d4' },
  },
  {
    name: 'Bishop',
    text: 'Moves any number of squares diagonally, so it always stays on squares of one colour.',
    diagram: { fen: 'k7/8/8/8/3B4/8/8/7K w - - 0 1', from: ['d4'], caption: 'Bishop on d4' },
  },
  {
    name: 'Knight',
    text: 'Jumps in an L: two squares one way, then one square to the side. It is the only piece that can jump over others.',
    diagram: { fen: 'k7/8/8/8/3N4/8/8/7K w - - 0 1', from: ['d4'], caption: 'Knight on d4' },
  },
  {
    name: 'Pawn',
    text: 'Moves straight forward one square, or two from its starting square, but captures one square diagonally forward.',
    diagram: {
      fen: 'k7/8/8/1p1p4/2P5/8/4P3/7K w - - 0 1',
      from: ['e2', 'c4'],
      caption: 'e2 can advance one or two squares; c4 can advance or capture on b5 or d5',
    },
  },
];

export const SPECIAL_MOVES: PieceLesson[] = [
  {
    name: 'Castling',
    text: 'The king moves two squares towards a rook, and that rook jumps to the square the king crossed. Allowed only if neither piece has moved yet, every square between them is empty, and the king is not in check and does not pass through or land on an attacked square. To castle, move the king two squares.',
    diagram: {
      fen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1',
      from: ['e1'],
      caption: 'The king can castle to g1 (kingside) or c1 (queenside)',
    },
  },
  {
    name: 'En passant',
    text: 'When a pawn advances two squares and lands beside an enemy pawn, that pawn may capture it as if it had moved only one square. The chance lasts for the very next move only.',
    diagram: {
      fen: '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1',
      from: ['e5'],
      highlight: ['d7', 'd5'],
      caption: 'Black just played d7–d5: White can capture en passant on d6',
    },
  },
  {
    name: 'Promotion',
    text: 'A pawn that reaches the far rank becomes a queen, rook, bishop or knight of the same colour. Chess Arena asks which piece you want, unless Auto-queen is on in Settings.',
    diagram: {
      fen: 'k7/4P3/8/8/8/8/8/4K3 w - - 0 1',
      from: ['e7'],
      caption: 'The pawn on e7 promotes on e8',
    },
  },
];

export const ENDINGS: PieceLesson[] = [
  {
    name: 'Check',
    text: 'A king that is attacked is in check. The player must get out of check at once: move the king, block the attack, or capture the attacking piece.',
    diagram: {
      fen: '4k3/8/8/8/8/8/8/4R1K1 b - - 0 1',
      check: 'e8',
      caption: 'The rook on e1 gives check',
    },
  },
  {
    name: 'Checkmate',
    text: 'In check with no legal way out. The game ends and the side giving checkmate wins.',
    diagram: {
      fen: '3R2k1/5ppp/8/8/8/8/8/6K1 b - - 0 1',
      check: 'g8',
      highlight: ['d1', 'd8'],
      caption: 'A back-rank mate: the pawns trap their own king',
    },
  },
  {
    name: 'Stalemate',
    text: 'The player to move is not in check but has no legal move. The game is a draw — even if one side is far ahead.',
    diagram: {
      fen: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1',
      caption: 'Black to move has no legal move: stalemate',
    },
  },
];

export const DRAW_RULES: { name: string; text: string }[] = [
  { name: 'Stalemate', text: 'The player to move has no legal move and is not in check.' },
  {
    name: 'Threefold repetition',
    text: 'The same position appears three times, with the same player to move and the same castling and en passant rights.',
  },
  {
    name: 'Fifty-move rule',
    text: 'Fifty moves by each player pass with no capture and no pawn move.',
  },
  {
    name: 'Insufficient material',
    text: 'Neither side can possibly checkmate — for example king against king, or king and bishop against king.',
  },
  {
    name: 'Agreement',
    text: `One player offers a draw and the other accepts. The computer accepts only when the position is level, and not before move ${DRAW_POLICY.minPlies / 2}.`,
  },
  {
    name: 'Timeout vs insufficient material',
    text: 'A player runs out of time but the opponent has no way to ever checkmate: the game is drawn rather than lost.',
  },
];

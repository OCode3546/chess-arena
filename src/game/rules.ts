import { Chess, type PieceSymbol, type Square } from 'chess.js';
import type { Color, ResultCode } from '@shared/types';

export type { ResultCode };

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export type EndReason =
  | 'checkmate'
  | 'stalemate'
  | 'threefold'
  | 'fifty-move'
  | 'insufficient'
  | 'resignation'
  | 'agreement'
  | 'timeout'
  | 'timeout-insufficient';

export interface GameResult {
  result: ResultCode;
  winner: Color | null;
  reason: EndReason;
}

export const REASON_LABEL: Record<EndReason, string> = {
  checkmate: 'by checkmate',
  stalemate: 'by stalemate',
  threefold: 'by threefold repetition',
  'fifty-move': 'by the fifty-move rule',
  insufficient: 'by insufficient material',
  resignation: 'by resignation',
  agreement: 'by agreement',
  timeout: 'on time',
  'timeout-insufficient': 'timeout vs insufficient material',
};

export const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');

export function win(winner: Color, reason: EndReason): GameResult {
  return { result: winner === 'w' ? '1-0' : '0-1', winner, reason };
}

export function draw(reason: EndReason): GameResult {
  return { result: '1/2-1/2', winner: null, reason };
}

/** Board-determined end of game (after the last move), or null if play continues. */
export function detectGameEnd(chess: Chess): GameResult | null {
  if (chess.isCheckmate()) return win(other(chess.turn()), 'checkmate');
  if (chess.isStalemate()) return draw('stalemate');
  if (chess.isInsufficientMaterial()) return draw('insufficient');
  if (chess.isThreefoldRepetition()) return draw('threefold');
  if (chess.isDrawByFiftyMoves()) return draw('fifty-move');
  return null;
}

const squareColor = (sq: Square): 0 | 1 => ((sq.charCodeAt(0) - 97 + Number(sq[1])) % 2) as 0 | 1;

/**
 * Whether `color` could ever deliver mate by any legal sequence of moves
 * (the test used when the opponent's flag falls). Mirrors the widely used
 * lichess/scalachess rule set.
 */
export function hasMatingMaterial(chess: Chess, color: Color): boolean {
  const own: { type: PieceSymbol; square: Square }[] = [];
  const opp: { type: PieceSymbol; square: Square }[] = [];
  for (const row of chess.board()) {
    for (const p of row) {
      if (!p || p.type === 'k') continue;
      (p.color === color ? own : opp).push({ type: p.type, square: p.square });
    }
  }
  if (own.some((p) => p.type === 'p' || p.type === 'r' || p.type === 'q')) return true;
  if (own.length === 0) return false;

  const knights = own.filter((p) => p.type === 'n').length;
  if (knights > 0) {
    // A lone knight can only mate if the opponent has something that can block its own king.
    if (own.length === 1) return opp.some((p) => p.type !== 'q');
    return true;
  }

  // Only bishops: mate needs bishops on both colours, or opposing material to self-block.
  const bishopColors = new Set(
    [...own, ...opp].filter((p) => p.type === 'b').map((p) => squareColor(p.square)),
  );
  if (bishopColors.size > 1) return true;
  return opp.some((p) => p.type === 'n' || p.type === 'p');
}

/** Result when `flagged` runs out of time. */
export function timeoutResult(chess: Chess, flagged: Color): GameResult {
  const opponent = other(flagged);
  return hasMatingMaterial(chess, opponent)
    ? win(opponent, 'timeout')
    : draw('timeout-insufficient');
}

export const PIECE_VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** Material balance from White's point of view. */
export function materialBalance(chess: Chess): number {
  let score = 0;
  for (const row of chess.board()) {
    for (const p of row) {
      if (p) score += (p.color === 'w' ? 1 : -1) * PIECE_VALUE[p.type];
    }
  }
  return score;
}

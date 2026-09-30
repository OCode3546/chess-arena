import { Chess, type PieceSymbol } from 'chess.js';
import type { Color } from '@shared/types';
import { MATE_SCORE, type SearchResult } from '@shared/uci';

/**
 * Built-in last-resort engine: negamax + alpha-beta with iterative deepening,
 * capture-only quiescence and a piece-square-table evaluation. Weak, but it
 * always answers, so a game is never blocked.
 */

interface Cell {
  type: PieceSymbol;
  color: Color;
}

interface Move {
  /** 0 = a8 … 63 = h1. */
  from: number;
  to: number;
  piece: PieceSymbol;
  captured?: PieceSymbol;
  promotion?: PieceSymbol;
  raw: unknown;
}

/** Minimal position interface so the search can use chess.js' fast internals when present. */
interface Position {
  moves(): Move[];
  make(m: Move): void;
  undo(): void;
  /** 64 cells, index 0 = a8. */
  cells(): (Cell | undefined)[];
  turn(): Color;
  inCheck(): boolean;
}

interface ChessInternals {
  _moves(opts: { legal: boolean }): {
    from: number;
    to: number;
    piece: PieceSymbol;
    captured?: PieceSymbol;
    promotion?: PieceSymbol;
  }[];
  _makeMove(move: unknown): void;
  _undoMove(): unknown;
  _board: (Cell | undefined)[];
}

const from0x88 = (sq: number) => (sq >> 4) * 8 + (sq & 7);

function hasInternals(c: Chess): boolean {
  const i = c as unknown as Partial<ChessInternals>;
  return (
    typeof i._moves === 'function' &&
    typeof i._makeMove === 'function' &&
    typeof i._undoMove === 'function' &&
    Array.isArray(i._board)
  );
}

function fastPosition(chess: Chess): Position {
  const i = chess as unknown as ChessInternals;
  return {
    moves: () =>
      i._moves({ legal: true }).map((m) => ({
        from: from0x88(m.from),
        to: from0x88(m.to),
        piece: m.piece,
        captured: m.captured,
        promotion: m.promotion,
        raw: m,
      })),
    make: (m) => i._makeMove(m.raw),
    undo: () => void i._undoMove(),
    cells: () => {
      const out: (Cell | undefined)[] = new Array(64);
      for (let sq = 0; sq < 128; sq++) {
        if (sq & 0x88) {
          sq += 7;
          continue;
        }
        out[from0x88(sq)] = i._board[sq];
      }
      return out;
    },
    turn: () => chess.turn(),
    inCheck: () => chess.inCheck(),
  };
}

const sqIndex = (sq: string) => (8 - Number(sq[1])) * 8 + (sq.charCodeAt(0) - 97);

function publicPosition(chess: Chess): Position {
  return {
    moves: () =>
      chess.moves({ verbose: true }).map((m) => ({
        from: sqIndex(m.from),
        to: sqIndex(m.to),
        piece: m.piece,
        captured: m.captured,
        promotion: m.promotion,
        raw: { from: m.from, to: m.to, promotion: m.promotion },
      })),
    make: (m) => void chess.move(m.raw as { from: string; to: string }),
    undo: () => void chess.undo(),
    cells: () =>
      chess
        .board()
        .flat()
        .map((c) => c ?? undefined),
    turn: () => chess.turn(),
    inCheck: () => chess.inCheck(),
  };
}

export function positionFor(chess: Chess): Position {
  return hasInternals(chess) ? fastPosition(chess) : publicPosition(chess);
}

export const usesFastPath = (chess: Chess) => hasInternals(chess);

// Simplified evaluation function (Tomasz Michniewski), tables from White's side, a8 first.
const VALUE: Record<PieceSymbol, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
// prettier-ignore
const PST: Record<PieceSymbol, number[]> = {
  p: [
     0,  0,  0,  0,  0,  0,  0,  0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
     5,  5, 10, 25, 25, 10,  5,  5,
     0,  0,  0, 20, 20,  0,  0,  0,
     5, -5,-10,  0,  0,-10, -5,  5,
     5, 10, 10,-20,-20, 10, 10,  5,
     0,  0,  0,  0,  0,  0,  0,  0],
  n: [
   -50,-40,-30,-30,-30,-30,-40,-50,
   -40,-20,  0,  0,  0,  0,-20,-40,
   -30,  0, 10, 15, 15, 10,  0,-30,
   -30,  5, 15, 20, 20, 15,  5,-30,
   -30,  0, 15, 20, 20, 15,  0,-30,
   -30,  5, 10, 15, 15, 10,  5,-30,
   -40,-20,  0,  5,  5,  0,-20,-40,
   -50,-40,-30,-30,-30,-30,-40,-50],
  b: [
   -20,-10,-10,-10,-10,-10,-10,-20,
   -10,  0,  0,  0,  0,  0,  0,-10,
   -10,  0,  5, 10, 10,  5,  0,-10,
   -10,  5,  5, 10, 10,  5,  5,-10,
   -10,  0, 10, 10, 10, 10,  0,-10,
   -10, 10, 10, 10, 10, 10, 10,-10,
   -10,  5,  0,  0,  0,  0,  5,-10,
   -20,-10,-10,-10,-10,-10,-10,-20],
  r: [
     0,  0,  0,  0,  0,  0,  0,  0,
     5, 10, 10, 10, 10, 10, 10,  5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
     0,  0,  0,  5,  5,  0,  0,  0],
  q: [
   -20,-10,-10, -5, -5,-10,-10,-20,
   -10,  0,  0,  0,  0,  0,  0,-10,
   -10,  0,  5,  5,  5,  5,  0,-10,
    -5,  0,  5,  5,  5,  5,  0, -5,
     0,  0,  5,  5,  5,  5,  0, -5,
   -10,  5,  5,  5,  5,  5,  0,-10,
   -10,  0,  5,  0,  0,  0,  0,-10,
   -20,-10,-10, -5, -5,-10,-10,-20],
  k: [
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -20,-30,-30,-40,-40,-30,-30,-20,
   -10,-20,-20,-20,-20,-20,-20,-10,
    20, 20,  0,  0,  0,  0, 20, 20,
    20, 30, 10,  0,  0, 10, 30, 20],
};

/** Static evaluation in centipawns from the side to move. */
export function evaluate(pos: Position): number {
  let score = 0;
  const cells = pos.cells();
  for (let i = 0; i < 64; i++) {
    const c = cells[i];
    if (!c) continue;
    const idx = c.color === 'w' ? i : (7 - (i >> 3)) * 8 + (i & 7);
    const v = VALUE[c.type] + PST[c.type][idx]!;
    score += c.color === 'w' ? v : -v;
  }
  return pos.turn() === 'w' ? score : -score;
}

const orderScore = (m: Move) =>
  (m.captured ? 10 * VALUE[m.captured] - VALUE[m.piece] / 10 + 10_000 : 0) +
  (m.promotion ? VALUE[m.promotion] + 5_000 : 0);

const sameMove = (a: Move, b: Move | null) =>
  !!b && a.from === b.from && a.to === b.to && a.promotion === b.promotion;

class Timeout extends Error {}

export interface MinimaxOptions {
  depth: number;
  /** Stop deepening after this long and return the best completed iteration. */
  timeLimitMs?: number;
  /** Random jitter (centipawns) on root moves, for variety at low levels. */
  jitter?: number;
  random?: () => number;
  now?: () => number;
}

const QUIESCENCE_DEPTH = 4;

export function toUci(m: Move): string {
  const sq = (i: number) => String.fromCharCode(97 + (i & 7)) + String(8 - (i >> 3));
  return sq(m.from) + sq(m.to) + (m.promotion ?? '');
}

/** Search from `fen` after `moves` (UCI); returns the best move for the side to move. */
export function minimaxSearch(fen: string, moves: string[], opts: MinimaxOptions): SearchResult {
  const chess = new Chess(fen);
  for (const uci of moves) {
    chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  }
  const pos = positionFor(chess);
  const now = opts.now ?? (() => performance.now());
  const random = opts.random ?? Math.random;
  const deadline = now() + (opts.timeLimitMs ?? 5_000);
  let nodes = 0;

  const checkTime = () => {
    if (++nodes % 512 === 0 && now() > deadline) throw new Timeout();
  };

  const quiesce = (alpha: number, beta: number, qdepth: number, list?: Move[]): number => {
    checkTime();
    const stand = evaluate(pos);
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    if (qdepth === 0) return alpha;
    const caps = (list ?? pos.moves())
      .filter((m) => m.captured || m.promotion)
      .sort((a, b) => orderScore(b) - orderScore(a));
    for (const m of caps) {
      pos.make(m);
      const score = -quiesce(-beta, -alpha, qdepth - 1);
      pos.undo();
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  };

  const negamax = (depth: number, alpha: number, beta: number, ply: number): number => {
    checkTime();
    const list = pos.moves();
    if (list.length === 0) return pos.inCheck() ? -MATE_SCORE + ply : 0;
    if (depth === 0) return quiesce(alpha, beta, QUIESCENCE_DEPTH, list);
    list.sort((a, b) => orderScore(b) - orderScore(a));
    for (const m of list) {
      pos.make(m);
      const score = -negamax(depth - 1, -beta, -alpha, ply + 1);
      pos.undo();
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  };

  const rootMoves = pos.moves();
  if (rootMoves.length === 0) throw new Error('No legal moves');
  let best: Move = rootMoves[0]!;
  let bestScore = evaluate(pos);
  const jitter = opts.jitter ?? 0;

  for (let depth = 1; depth <= Math.max(1, opts.depth); depth++) {
    const ordered = [...rootMoves].sort(
      (a, b) =>
        (sameMove(b, best) ? 1e6 : orderScore(b)) - (sameMove(a, best) ? 1e6 : orderScore(a)),
    );
    let iterBest: Move | null = null;
    let iterScore = -Infinity;
    try {
      for (const m of ordered) {
        pos.make(m);
        let score = -negamax(depth - 1, -MATE_SCORE - 1, -iterScore + jitter, 1);
        pos.undo();
        if (jitter) score += Math.round((random() - 0.5) * 2 * jitter);
        if (score > iterScore) {
          iterScore = score;
          iterBest = m;
        }
      }
    } catch (err) {
      if (err instanceof Timeout) break;
      throw err;
    }
    if (iterBest) {
      best = iterBest;
      bestScore = iterScore;
    }
    if (Math.abs(bestScore) > MATE_SCORE - 1000) break;
  }

  return { bestmove: toUci(best), score: bestScore };
}

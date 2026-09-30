import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { minimaxSearch, positionFor, usesFastPath } from '@/ai/minimax';
import { isLegalUci } from '@/ai/engine';
import { MATE_SCORE } from '@shared/uci';

const START = new Chess().fen();

describe('minimax fallback', () => {
  it('uses chess.js internals, and they agree with the public API (perft 3)', () => {
    const chess = new Chess();
    expect(usesFastPath(chess)).toBe(true);
    const pos = positionFor(chess);
    const perft = (d: number): number => {
      if (d === 0) return 1;
      let n = 0;
      for (const m of pos.moves()) {
        pos.make(m);
        n += perft(d - 1);
        pos.undo();
      }
      return n;
    };
    expect(perft(3)).toBe(8902);
    expect(chess.fen()).toBe(START);
  });

  it('finds mate in one', () => {
    // Scholar's mate pattern: Qxf7#.
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 2 4';
    const res = minimaxSearch(fen, [], { depth: 2 });
    expect(res.bestmove).toBe('h5f7');
    expect(res.score).toBeGreaterThan(MATE_SCORE - 10);
  });

  it('takes a hanging queen', () => {
    const fen = 'rnb1kbnr/pppp1ppp/8/4p1q1/3P4/2N5/PPP1PPPP/R1BQKBNR w KQkq - 0 3';
    expect(minimaxSearch(fen, [], { depth: 3 }).bestmove).toBe('c1g5');
  });

  it('promotes when it wins', () => {
    const res = minimaxSearch('8/P7/8/8/8/8/k7/7K w - - 0 1', [], { depth: 2 });
    expect(res.bestmove).toBe('a7a8q');
  });

  it('plays from a move list and always returns a legal move', () => {
    const moves = ['e2e4', 'e7e5', 'g1f3', 'b8c6'];
    for (let d = 1; d <= 3; d++) {
      const res = minimaxSearch(START, moves, { depth: d, jitter: 100 });
      expect(isLegalUci(START, moves, res.bestmove)).toBe(true);
    }
  });

  it('respects its time limit', () => {
    let t = 0;
    const res = minimaxSearch(START, [], { depth: 12, timeLimitMs: 50, now: () => (t += 1) });
    expect(isLegalUci(START, [], res.bestmove)).toBe(true);
  });
});

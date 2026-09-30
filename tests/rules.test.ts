import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { detectGameEnd, hasMatingMaterial, materialBalance, timeoutResult } from '@/game/rules';

const play = (chess: Chess, ...moves: string[]) => moves.forEach((m) => chess.move(m));

describe('special moves', () => {
  it('allows castling on both sides and moves the rook', () => {
    const c = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    c.move('O-O');
    expect(c.get('g1')).toMatchObject({ type: 'k', color: 'w' });
    expect(c.get('f1')).toMatchObject({ type: 'r', color: 'w' });
    c.move('O-O-O');
    expect(c.get('c8')).toMatchObject({ type: 'k', color: 'b' });
    expect(c.get('d8')).toMatchObject({ type: 'r', color: 'b' });
  });

  it('forbids castling through an attacked square or out of check', () => {
    const through = new Chess('r3k2r/8/8/8/8/8/5r2/R3K2R w KQkq - 0 1');
    expect(through.moves()).not.toContain('O-O');
    expect(through.moves()).toContain('O-O-O');
    const inCheck = new Chess('r3k2r/8/8/8/8/8/4r3/R3K2R w KQkq - 0 1');
    expect(inCheck.moves().some((m) => m.startsWith('O-O'))).toBe(false);
  });

  it('loses castling rights after the king moves', () => {
    const c = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    play(c, 'Ke2', 'Ke7', 'Ke1', 'Ke8');
    expect(c.moves().some((m) => m.startsWith('O-O'))).toBe(false);
  });

  it('supports en passant only immediately after the double push', () => {
    const c = new Chess('rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3');
    const ep = c.move('exf6');
    expect(ep.isEnPassant()).toBe(true);
    expect(c.get('f5')).toBeUndefined();
    const late = new Chess('rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3');
    play(late, 'Nf3', 'Nh6', 'Nc3', 'Nc6');
    expect(late.moves()).not.toContain('exf6');
  });

  it('promotes to any piece', () => {
    for (const p of ['q', 'r', 'b', 'n'] as const) {
      const c = new Chess('8/P7/8/8/8/8/8/k6K w - - 0 1');
      c.move({ from: 'a7', to: 'a8', promotion: p });
      expect(c.get('a8')).toMatchObject({ type: p, color: 'w' });
    }
  });
});

describe('game end detection', () => {
  it("detects fool's mate", () => {
    const c = new Chess();
    play(c, 'f3', 'e5', 'g4', 'Qh4#');
    expect(detectGameEnd(c)).toEqual({ result: '0-1', winner: 'b', reason: 'checkmate' });
  });

  it('detects stalemate', () => {
    expect(detectGameEnd(new Chess('k7/8/1Q6/8/8/8/8/7K b - - 0 1'))).toMatchObject({
      result: '1/2-1/2',
      reason: 'stalemate',
    });
  });

  it('detects threefold repetition', () => {
    const c = new Chess();
    play(c, 'Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1');
    expect(detectGameEnd(c)).toBeNull();
    c.move('Ng8');
    expect(detectGameEnd(c)).toMatchObject({ reason: 'threefold', winner: null });
  });

  it('detects the fifty-move rule', () => {
    const c = new Chess('k7/8/8/8/8/8/8/K6R w - - 99 80');
    expect(detectGameEnd(c)).toBeNull();
    c.move('Rh2');
    expect(detectGameEnd(c)).toMatchObject({ reason: 'fifty-move' });
  });

  it('prefers checkmate over the fifty-move rule', () => {
    const c = new Chess('k7/8/1K6/8/8/8/8/7R w - - 99 80');
    c.move('Rh8#');
    expect(detectGameEnd(c)).toMatchObject({ reason: 'checkmate', winner: 'w' });
  });

  it.each([
    ['K vs K', '8/8/8/4k3/8/8/8/4K3 w - - 0 1'],
    ['K+B vs K', '8/8/8/4k3/8/8/8/2B1K3 w - - 0 1'],
    ['K+N vs K', '8/8/8/4k3/8/8/8/1N2K3 w - - 0 1'],
    ['K+B vs K+B same colour', '8/8/1b6/4k3/8/8/8/2B1K3 w - - 0 1'],
  ])('detects insufficient material: %s', (_name, fen) => {
    expect(detectGameEnd(new Chess(fen))).toMatchObject({ reason: 'insufficient' });
  });

  it('detects insufficient material after a capture', () => {
    const c = new Chess('k7/8/8/8/8/8/1q6/K7 w - - 0 1');
    c.move('Kxb2');
    expect(detectGameEnd(c)).toMatchObject({ reason: 'insufficient' });
  });

  it('does not end a normal position', () => {
    expect(detectGameEnd(new Chess())).toBeNull();
  });
});

describe('timeout', () => {
  it('awards the win when the opponent can mate', () => {
    expect(timeoutResult(new Chess('k7/8/8/8/8/8/8/K6R w - - 0 1'), 'b')).toEqual({
      result: '1-0',
      winner: 'w',
      reason: 'timeout',
    });
  });

  it('is a draw when the opponent has insufficient mating material', () => {
    expect(timeoutResult(new Chess('k7/8/8/8/8/8/8/KN4r1 w - - 0 1'), 'w')).toMatchObject({
      winner: 'b',
    });
    expect(timeoutResult(new Chess('k7/8/8/8/8/8/8/KN6 b - - 0 1'), 'b')).toEqual({
      result: '1/2-1/2',
      winner: null,
      reason: 'timeout-insufficient',
    });
    expect(timeoutResult(new Chess('k7/8/8/8/8/8/p7/K7 w - - 0 1'), 'b')).toMatchObject({
      reason: 'timeout-insufficient',
    });
  });

  it.each([
    ['lone king', '7k/8/8/8/8/8/8/K7 w - - 0 1', 'w', false],
    ['single knight vs bare king', '7k/8/8/8/8/8/8/KN6 w - - 0 1', 'w', false],
    [
      'single knight vs king + rook (helpmate possible)',
      '6rk/8/8/8/8/8/8/KN6 w - - 0 1',
      'w',
      true,
    ],
    ['single knight vs king + queen', '6qk/8/8/8/8/8/8/KN6 w - - 0 1', 'w', false],
    ['two knights', '7k/8/8/8/8/8/8/KNN5 w - - 0 1', 'w', true],
    ['same-colour bishops', '7k/8/8/8/8/8/1B6/K1B5 w - - 0 1', 'w', false],
    ['opposite-colour bishops', '7k/8/8/8/8/8/8/KBB5 w - - 0 1', 'w', true],
    ['bishop vs king + pawn', '7k/7p/8/8/8/8/8/KB6 w - - 0 1', 'w', true],
    ['a single pawn', '7k/8/8/8/8/8/P7/K7 w - - 0 1', 'w', true],
  ])('mating material: %s', (_name, fen, color, expected) => {
    expect(hasMatingMaterial(new Chess(fen), color as 'w' | 'b')).toBe(expected);
  });
});

describe('material', () => {
  it('computes the balance from White’s view', () => {
    expect(materialBalance(new Chess())).toBe(0);
    expect(materialBalance(new Chess('k7/8/8/8/8/8/8/KQ6 w - - 0 1'))).toBe(9);
    expect(materialBalance(new Chess('kr6/8/8/8/8/8/8/KN6 w - - 0 1'))).toBe(-2);
  });
});

import { Chess, type Move } from 'chess.js';
import { describe, expect, it } from 'vitest';
import type { GameRecord } from '@shared/types';
import { endSound, moveSound } from '@/audio/cues';
import {
  diagramTargets,
  ENDINGS,
  PIECE_LESSONS,
  SPECIAL_MOVES,
  START_POSITION,
} from '@/config/tutorial';
import { clampPly, movesFromPgn, outcomeOf, reasonLabel, sideOf } from '@/game/review';
import { draw, win } from '@/game/rules';

const played = (fen: string | undefined, sans: string[]): Move => {
  const c = new Chess(fen);
  let last: Move | undefined;
  for (const s of sans) last = c.move(s);
  return last!;
};

describe('move sounds', () => {
  it('classifies moves', () => {
    expect(moveSound(played(undefined, ['e4']))).toBe('move');
    expect(moveSound(played(undefined, ['e4', 'd5', 'exd5']))).toBe('capture');
    expect(moveSound(played('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', ['exd6']))).toBe('capture');
    expect(moveSound(played('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', ['O-O']))).toBe('castle');
    expect(moveSound(played('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', ['O-O-O']))).toBe('castle');
    expect(moveSound(played('k7/4P3/8/8/8/8/8/4K3 w - - 0 1', ['e8=N']))).toBe('promote');
    expect(moveSound(played(undefined, ['e4', 'f5', 'Qh5+']))).toBe('check');
    // Check wins over promotion.
    expect(moveSound(played('4k3/1P6/8/8/8/8/8/4K3 w - - 0 1', ['b8=Q+']))).toBe('check');
    // Mate plays the plain sound; the result sound follows.
    expect(moveSound(played(undefined, ['f3', 'e5', 'g4', 'Qh4#']))).toBe('move');
  });

  it('picks the game-over sound from the human side', () => {
    expect(endSound(win('w', 'checkmate'), 'w')).toBe('win');
    expect(endSound(win('w', 'checkmate'), 'b')).toBe('lose');
    expect(endSound(win('b', 'resignation'), null)).toBe('win');
    expect(endSound(draw('stalemate'), 'w')).toBe('draw');
  });
});

const rec = (patch: Partial<GameRecord>): GameRecord => ({
  id: 'g',
  date: '2026-09-30T12:00:00.000Z',
  mode: 'pvp',
  white: 'p1',
  black: 'p2',
  whiteName: 'A',
  blackName: 'B',
  pgn: '1. f3 e5 2. g4 Qh4# 0-1',
  result: '0-1',
  reason: 'checkmate',
  moves: 2,
  xpAwarded: {},
  ...patch,
});

describe('history review helpers', () => {
  it('reads the moves of a stored game', () => {
    const moves = movesFromPgn(rec({}).pgn)!;
    expect(moves.map((m) => m.san)).toEqual(['f3', 'e5', 'g4', 'Qh4#']);
    expect(moves[0]!.before).toBe(START_POSITION.fen);
    expect(movesFromPgn('1. e4 e5 2. Ke7')).toBeNull();
  });

  it('clamps plies like the live game (past the end = final position)', () => {
    expect(clampPly(-3, 4)).toBe(0);
    expect(clampPly(2, 4)).toBe(2);
    expect(clampPly(4, 4)).toBeNull();
    expect(clampPly(9, 4)).toBeNull();
    expect(clampPly(null, 4)).toBeNull();
  });

  it('reports results from a profile’s side', () => {
    const g = rec({});
    expect(sideOf(g, 'p1')).toBe('w');
    expect(sideOf(g, 'p2')).toBe('b');
    expect(sideOf(g, 'p3')).toBeNull();
    expect(sideOf(g, null)).toBeNull();
    expect(outcomeOf(g, 'w')).toBe('loss');
    expect(outcomeOf(g, 'b')).toBe('win');
    expect(outcomeOf(rec({ result: '1-0' }), 'w')).toBe('win');
    expect(outcomeOf(rec({ result: '1/2-1/2' }), 'b')).toBe('draw');
    expect(reasonLabel('checkmate')).toBe('by checkmate');
    expect(reasonLabel('something-new')).toBe('something-new');
  });
});

describe('How to Play diagrams', () => {
  const targets = (d: Parameters<typeof diagramTargets>[0]) =>
    [...diagramTargets(d).entries()].sort(([a], [b]) => a.localeCompare(b));

  it('are all legal positions', () => {
    for (const l of [
      START_POSITION,
      ...[...PIECE_LESSONS, ...SPECIAL_MOVES, ...ENDINGS].map((x) => x.diagram),
    ]) {
      expect(() => new Chess(l.fen)).not.toThrow();
    }
  });

  it('show the moves each piece really has', () => {
    const counts = Object.fromEntries(
      PIECE_LESSONS.map((l) => [l.name, diagramTargets(l.diagram).size]),
    );
    expect(counts).toEqual({ King: 8, Queen: 27, Rook: 14, Bishop: 13, Knight: 8, Pawn: 5 });
    const pawn = PIECE_LESSONS.find((l) => l.name === 'Pawn')!.diagram;
    expect(targets(pawn)).toEqual([
      ['b5', true],
      ['c5', false],
      ['d5', true],
      ['e3', false],
      ['e4', false],
    ]);
  });

  it('show castling, en passant and promotion', () => {
    const [castling, enPassant, promotion] = SPECIAL_MOVES.map((l) => diagramTargets(l.diagram));
    expect(castling!.has('g1') && castling!.has('c1')).toBe(true);
    expect(enPassant!.get('d6')).toBe(true);
    expect([...promotion!.keys()]).toEqual(['e8']);
  });

  it('show check, checkmate and stalemate', () => {
    const [check, mate, stalemate] = ENDINGS.map((l) => new Chess(l.diagram.fen));
    expect(check!.inCheck() && !check!.isCheckmate()).toBe(true);
    expect(mate!.isCheckmate()).toBe(true);
    expect(stalemate!.isStalemate()).toBe(true);
    for (const l of ENDINGS.slice(0, 2)) {
      const c = new Chess(l.diagram.fen);
      expect(c.findPiece({ type: 'k', color: c.turn() })[0]).toBe(l.diagram.check);
    }
  });
});

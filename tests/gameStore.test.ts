import { Chess } from 'chess.js';
import { beforeEach, describe, expect, it } from 'vitest';
import type { GameSettings, SavedGame } from '@shared/types';
import { setGamePersistence, undoablePlies, useGameStore } from '@/store/gameStore';

const store = () => useGameStore.getState();

const settings = (initialMin = 0, incSec = 0): GameSettings => ({
  mode: 'pvp',
  timeControl: { id: 'test', initialMs: initialMin * 60_000, incrementMs: incSec * 1000 },
  players: { w: { name: 'Alice' }, b: { name: 'Bob' } },
  autoFlip: false,
});

let saved: SavedGame | null = null;
let cleared = 0;

beforeEach(() => {
  saved = null;
  cleared = 0;
  setGamePersistence({
    save: (g) => (saved = structuredClone(g)),
    clear: () => {
      saved = null;
      cleared++;
    },
  });
  store().reset();
});

describe('moves', () => {
  it('plays legal moves, rejects illegal ones and auto-saves', () => {
    store().newGame(settings());
    expect(store().attemptMove('e2', 'e5')).toBe('illegal');
    expect(store().attemptMove('e2', 'e4')).toBe('moved');
    expect(store().history.map((m) => m.san)).toEqual(['e4']);
    expect(saved?.pgn).toContain('1. e4');
  });

  it('only lets the side to move select pieces', () => {
    store().newGame(settings());
    store().selectSquare('e7');
    expect(store().selected).toBeNull();
    store().selectSquare('g1');
    expect(store().legalTargets.sort()).toEqual(['f3', 'h3']);
  });

  it('opens the promotion picker and promotes to the chosen piece', () => {
    const c = new Chess('8/P7/8/8/8/8/8/k6K w - - 0 1');
    store().restore({
      fen: c.fen(),
      pgn: c.pgn(),
      clocks: { w: 0, b: 0 },
      settings: settings(),
      turn: 'w',
      startedAt: new Date().toISOString(),
      clockStarted: false,
    });
    expect(store().attemptMove('a7', 'a8')).toBe('promotion');
    expect(store().pendingPromotion).toEqual({ from: 'a7', to: 'a8' });
    store().choosePromotion('n');
    expect(store().fen.startsWith('N7/')).toBe(true);
  });

  it('auto-queens when enabled', () => {
    const c = new Chess('8/P7/8/8/8/8/8/k6K w - - 0 1');
    store().restore({
      fen: c.fen(),
      pgn: c.pgn(),
      clocks: { w: 0, b: 0 },
      settings: settings(),
      turn: 'w',
      startedAt: new Date().toISOString(),
      clockStarted: false,
    });
    expect(store().attemptMove('a7', 'a8', { autoQueen: true })).toBe('moved');
    expect(store().fen.startsWith('Q7/')).toBe(true);
  });

  it("ends the game on fool's mate and drops the save", () => {
    store().newGame(settings());
    for (const [f, t] of [
      ['f2', 'f3'],
      ['e7', 'e5'],
      ['g2', 'g4'],
      ['d8', 'h4'],
    ] as const) {
      store().attemptMove(f, t);
    }
    expect(store().status).toBe('over');
    expect(store().result).toMatchObject({ result: '0-1', reason: 'checkmate' });
    expect(saved).toBeNull();
    expect(cleared).toBe(1);
    expect(store().attemptMove('a2', 'a3')).toBe('illegal');
  });

  it('handles resignation and draw by agreement', () => {
    store().newGame(settings());
    store().resign('w');
    expect(store().result).toMatchObject({ result: '0-1', reason: 'resignation' });
    store().newGame(settings());
    store().agreeDraw();
    expect(store().result).toMatchObject({ result: '1/2-1/2', reason: 'agreement' });
  });

  it('auto-flips the board in PvP when enabled', () => {
    store().newGame({ ...settings(), autoFlip: true });
    store().attemptMove('e2', 'e4');
    expect(store().orientation).toBe('b');
    store().attemptMove('e7', 'e5');
    expect(store().orientation).toBe('w');
  });

  it('blocks moves while reviewing an earlier position', () => {
    store().newGame(settings());
    store().attemptMove('e2', 'e4');
    store().attemptMove('e7', 'e5');
    store().setViewPly(1);
    expect(store().attemptMove('g1', 'f3')).toBe('illegal');
    store().setViewPly(null);
    expect(store().attemptMove('g1', 'f3')).toBe('moved');
  });
});

describe('clocks', () => {
  it('does not run before White’s first move, then applies increments', () => {
    store().newGame(settings(5, 3), 0);
    store().tick(10_000);
    expect(store().clocks).toEqual({ w: 300_000, b: 300_000 });
    store().attemptMove('e2', 'e4', { now: 10_000 });
    expect(store().clockStarted).toBe(true);
    expect(store().clocks.w).toBe(300_000);
    store().tick(14_000);
    expect(store().clocks.b).toBe(296_000);
    store().attemptMove('e7', 'e5', { now: 15_000 });
    expect(store().clocks.b).toBe(295_000 + 3_000);
  });

  it('flags a player who runs out of time', () => {
    store().newGame(settings(1), 0);
    store().attemptMove('e2', 'e4', { now: 0 });
    store().tick(30_000);
    store().tick(61_000);
    expect(store().status).toBe('over');
    expect(store().clocks.b).toBe(0);
    expect(store().result).toEqual({ result: '1-0', winner: 'w', reason: 'timeout' });
  });

  it('flags a move made after time ran out', () => {
    store().newGame(settings(1), 0);
    store().attemptMove('e2', 'e4', { now: 0 });
    store().attemptMove('e7', 'e5', { now: 70_000 });
    expect(store().result).toMatchObject({ reason: 'timeout', winner: 'w' });
  });

  it('draws on timeout when the opponent cannot mate', () => {
    const c = new Chess('k7/1r6/8/8/8/8/8/7K w - - 0 1');
    c.move('Kg1');
    store().restore({
      fen: c.fen(),
      pgn: c.pgn(),
      clocks: { w: 5_000, b: 2_000 },
      settings: settings(1),
      turn: 'b',
      startedAt: new Date().toISOString(),
      clockStarted: true,
    });
    store().setPaused(false, 0);
    store().tick(3_000);
    expect(store().result).toEqual({
      result: '1/2-1/2',
      winner: null,
      reason: 'timeout-insufficient',
    });
  });

  it('stops the clock while paused', () => {
    store().newGame(settings(5), 0);
    store().attemptMove('e2', 'e4', { now: 0 });
    store().setPaused(true, 1_000);
    store().tick(50_000);
    store().setPaused(false, 60_000);
    store().tick(61_000);
    expect(store().clocks.b).toBe(298_000);
  });
});

describe('save / resume', () => {
  it('restores position, history and clocks from a save', () => {
    store().newGame(settings(10), 0);
    store().attemptMove('e2', 'e4', { now: 0 });
    store().attemptMove('e7', 'e5', { now: 4_000 });
    store().persist(9_000);
    const snapshot = structuredClone(saved!);
    expect(snapshot.clocks.w).toBeLessThan(600_000);
    store().reset();

    expect(store().restore(snapshot)).toBe(true);
    expect(store().fen).toBe(snapshot.fen);
    expect(store().history.map((m) => m.san)).toEqual(['e4', 'e5']);
    expect(store().clocks).toEqual(snapshot.clocks);
    expect(store().paused).toBe(true);
    expect(store().settings?.players.w.name).toBe('Alice');
  });

  it('keeps repetition history across a resume', () => {
    store().newGame(settings());
    for (const [f, t] of [
      ['g1', 'f3'],
      ['g8', 'f6'],
      ['f3', 'g1'],
      ['f6', 'g8'],
      ['g1', 'f3'],
      ['g8', 'f6'],
      ['f3', 'g1'],
    ] as const) {
      store().attemptMove(f, t);
    }
    const snapshot = structuredClone(saved!);
    store().reset();
    store().restore(snapshot);
    store().attemptMove('f6', 'g8');
    expect(store().result).toMatchObject({ reason: 'threefold' });
  });

  it('rejects a save whose PGN is garbage or does not match its FEN', () => {
    const base: SavedGame = {
      fen: new Chess().fen(),
      pgn: '1. e4 e5',
      clocks: { w: 0, b: 0 },
      settings: settings(),
      turn: 'w',
      startedAt: new Date().toISOString(),
      clockStarted: false,
    };
    expect(store().restore({ ...base, pgn: '1. e4 Kxz9 ???' })).toBe(false);
    expect(store().restore(base)).toBe(false);
    expect(store().status).toBe('idle');
  });
});

describe('vs AI', () => {
  const aiSettings = (humanColor: 'w' | 'b', assists = true, initialMin = 0): GameSettings => ({
    mode: 'pvai',
    timeControl: { id: 'test', initialMs: initialMin * 60_000, incrementMs: 0 },
    players:
      humanColor === 'w'
        ? { w: { name: 'Alice' }, b: { name: 'Stockfish · Medium' } }
        : { w: { name: 'Stockfish · Medium' }, b: { name: 'Alice' } },
    autoFlip: false,
    difficulty: 'medium',
    humanColor,
    assists,
  });

  it('faces the human side and blocks moves for the AI side', () => {
    store().newGame(aiSettings('b'));
    expect(store().orientation).toBe('b');
    expect(store().attemptMove('e2', 'e4')).toBe('illegal');
    expect(store().applyAiMove('e2e4')).toBe(true);
    expect(store().applyAiMove('e7e5')).toBe(false);
    expect(store().attemptMove('e7', 'e5')).toBe('moved');
  });

  it('rejects illegal or malformed engine moves', () => {
    store().newGame(aiSettings('b'));
    expect(store().applyAiMove('e2e5')).toBe(false);
    expect(store().applyAiMove('zz')).toBe(false);
    expect(store().history).toHaveLength(0);
  });

  it('plays engine promotions', () => {
    const c = new Chess('8/8/8/8/8/k7/7p/K7 b - - 0 1');
    store().restore({
      fen: c.fen(),
      pgn: c.pgn(),
      clocks: { w: 0, b: 0 },
      settings: aiSettings('w'),
      turn: 'b',
      startedAt: new Date().toISOString(),
      clockStarted: false,
    });
    expect(store().applyAiMove('h2h1q')).toBe(true);
    expect(store().history.at(-1)?.san).toBe('h1=Q#');
  });

  it('takes back the human move and the AI reply, counting each undo', () => {
    store().newGame(aiSettings('w'));
    store().attemptMove('e2', 'e4');
    store().applyAiMove('e7e5');
    store().attemptMove('g1', 'f3');
    store().applyAiMove('b8c6');
    expect(undoablePlies(store())).toBe(2);
    expect(store().undo()).toBe(true);
    expect(store().history.map((m) => m.san)).toEqual(['e4', 'e5']);
    expect(store().assists.undos).toBe(1);
    expect(saved?.assists).toEqual({ hints: 0, undos: 1 });
  });

  it('while the AI is to move, undo takes back just the human move', () => {
    store().newGame(aiSettings('w'));
    store().attemptMove('e2', 'e4');
    expect(undoablePlies(store())).toBe(1);
    store().undo();
    expect(store().history).toHaveLength(0);
    expect(store().clockStarted).toBe(false);
  });

  it('has nothing to undo before the human has moved (AI plays White)', () => {
    store().newGame(aiSettings('b'));
    store().applyAiMove('d2d4');
    expect(undoablePlies(store())).toBe(0);
    expect(store().undo()).toBe(false);
  });

  it('refuses undo and hints when assists are off', () => {
    store().newGame(aiSettings('w', false));
    store().attemptMove('e2', 'e4');
    store().applyAiMove('e7e5');
    expect(store().undo()).toBe(false);
    store().showHint('g1', 'f3');
    expect(store().hint).toBeNull();
    expect(store().assists).toEqual({ hints: 0, undos: 0 });
  });

  it('shows and clears hints, and persists the count across a resume', () => {
    store().newGame(aiSettings('w'));
    store().showHint('e2', 'e4');
    expect(store().hint).toEqual({ from: 'e2', to: 'e4' });
    store().attemptMove('e2', 'e4');
    expect(store().hint).toBeNull();
    const snapshot = structuredClone(saved!);
    store().reset();
    expect(store().restore(snapshot)).toBe(true);
    expect(store().assists).toEqual({ hints: 1, undos: 0 });
    expect(store().orientation).toBe('w');
  });

  it('the AI clock starts with its first move as White and times out like a human', () => {
    store().newGame(aiSettings('b', false, 1), 0);
    store().applyAiMove('e2e4', 500);
    expect(store().clockStarted).toBe(true);
    store().attemptMove('e7', 'e5', { now: 1_000 });
    store().tick(62_000);
    expect(store().result).toMatchObject({ winner: 'b', reason: 'timeout' });
  });

  it('the human resigns as their own colour', () => {
    store().newGame(aiSettings('b'));
    store().applyAiMove('e2e4');
    store().resign('b');
    expect(store().result).toMatchObject({ result: '1-0', reason: 'resignation' });
  });
});

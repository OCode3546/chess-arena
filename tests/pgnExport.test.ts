import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { exportPgn, pgnFileName } from '@shared/pgn';
import type { GameRecord } from '@shared/types';

/** A record as the app stores it: chess.js PGN with the game store's headers. */
function record(moves: string[], patch: Partial<GameRecord> = {}): GameRecord {
  const chess = new Chess();
  chess.setHeader('Event', 'Chess Arena — local game');
  chess.setHeader('Site', 'Chess Arena');
  chess.setHeader('Date', '2026.09.30');
  chess.setHeader('White', 'Ana');
  chess.setHeader('Black', 'Stockfish · Easy');
  chess.setHeader('TimeControl', '300+3');
  for (const m of moves) chess.move(m);
  chess.setHeader('Result', patch.result ?? '0-1');
  return {
    id: 'g1',
    date: '2026-09-30T12:00:00.000Z',
    mode: 'pvai',
    white: 'p1',
    black: 'ai:easy',
    whiteName: 'Ana',
    blackName: 'Stockfish · Easy',
    pgn: chess.pgn(),
    result: '0-1',
    reason: 'checkmate',
    moves: Math.ceil(moves.length / 2),
    xpAwarded: { p1: 5 },
    ...patch,
  };
}

const FOOLS_MATE = ['f3', 'e5', 'g4', 'Qh4#'];
const LONG_GAME = (
  'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Nb8 d4 Nbd7 ' +
  'c4 c6 cxb5 axb5 Nc3 Bb7 Bg5 b4 Nb1 h6 Bh4 c5 dxe5 Nxe4 Bxe7 Qxe7 exd6 Qf6'
).split(' ');

const tags = (pgn: string) => [...pgn.matchAll(/^\[(\w+) "/gm)].map((m) => m[1]);

describe('PGN export', () => {
  it('writes the Seven Tag Roster first, in order, plus Termination', () => {
    const pgn = exportPgn(record(FOOLS_MATE))!;
    expect(tags(pgn).slice(0, 7)).toEqual([
      'Event',
      'Site',
      'Date',
      'Round',
      'White',
      'Black',
      'Result',
    ]);
    expect(pgn).toContain('[Event "Chess Arena game vs computer"]');
    expect(pgn).toContain('[Round "-"]');
    expect(pgn).toContain('[Date "2026.09.30"]');
    expect(pgn).toContain('[Black "Stockfish · Easy"]');
    expect(pgn).toContain('[TimeControl "300+3"]');
    expect(pgn).toContain('[Termination "Normal"]');
  });

  it('ends the movetext with the result and keeps lines within 80 columns', () => {
    const pgn = exportPgn(record(LONG_GAME, { result: '1/2-1/2', reason: 'agreement' }))!;
    expect(pgn.endsWith(' 1/2-1/2\n')).toBe(true);
    for (const line of pgn.split('\n')) expect(line.length).toBeLessThanOrEqual(80);
    // Headers, one blank line, movetext.
    expect(pgn).toMatch(/"\]\n\n1\. e4 e5/);
  });

  it('re-imports to the same moves and headers', () => {
    const r = record(LONG_GAME, { result: '1-0', reason: 'resignation' });
    const c = new Chess();
    c.loadPgn(exportPgn(r)!);
    expect(c.history()).toEqual(LONG_GAME);
    expect(c.getHeaders()).toMatchObject({ White: 'Ana', Result: '1-0' });
  });

  it('marks games lost on time as a time forfeit', () => {
    const pgn = exportPgn(record(FOOLS_MATE.slice(0, 3), { result: '1-0', reason: 'timeout' }))!;
    expect(pgn).toContain('[Termination "Time forfeit"]');
    expect(pgn.trimEnd().endsWith('1-0')).toBe(true);
  });

  it('fills a missing date from the record and uses the record result', () => {
    const r = record(FOOLS_MATE);
    r.pgn = '1. f3 e5 2. g4 Qh4#';
    const pgn = exportPgn(r)!;
    expect(pgn).toContain('[Date "2026.09.30"]');
    expect(pgn).toContain('[Result "0-1"]');
    expect(pgn).toContain('[Event "Chess Arena game vs computer"]');
  });

  it('returns null for unreadable moves', () => {
    expect(exportPgn(record(FOOLS_MATE, { pgn: '1. e4 e5 2. Ke3 Kxe1' }))).toBeNull();
  });

  it('suggests a safe file name', () => {
    expect(pgnFileName(record(FOOLS_MATE))).toBe('2026-09-30 Ana vs Stockfish Easy.pgn');
    expect(pgnFileName(record(FOOLS_MATE, { whiteName: '../..\\evil:*?', blackName: 'Zoë' }))).toBe(
      '2026-09-30 evil vs Zoë.pgn',
    );
  });
});

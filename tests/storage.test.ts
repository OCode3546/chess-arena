import { describe, expect, it } from 'vitest';
import { migrate } from '@shared/migrate';
import { DEFAULT_SETTINGS } from '@shared/types';
import { isSavedGame, sanitizeSettings } from '@shared/validate';

const validSave = {
  fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
  pgn: '1. e4',
  clocks: { w: 1000, b: 1000 },
  settings: {
    mode: 'pvp',
    timeControl: { id: '5+3', initialMs: 300000, incrementMs: 3000 },
    players: { w: { name: 'A' }, b: { name: 'B' } },
    autoFlip: false,
  },
  turn: 'b',
  startedAt: '2026-09-29T10:00:00.000Z',
  clockStarted: true,
};

describe('saved game validation', () => {
  it('accepts a well-formed save', () => {
    expect(isSavedGame(validSave)).toBe(true);
  });

  it.each([
    ['null', null],
    ['string', 'garbage'],
    ['bad fen', { ...validSave, fen: 'not a fen' }],
    ['negative clock', { ...validSave, clocks: { w: -1, b: 0 } }],
    ['NaN clock', { ...validSave, clocks: { w: NaN, b: 0 } }],
    ['bad mode', { ...validSave, settings: { ...validSave.settings, mode: 'online' } }],
    ['missing players', { ...validSave, settings: { ...validSave.settings, players: {} } }],
    ['bad date', { ...validSave, startedAt: 'yesterday' }],
  ])('rejects %s', (_n, value) => {
    expect(isSavedGame(value)).toBe(false);
  });
});

describe('settings sanitising', () => {
  it('keeps valid fields and drops invalid ones', () => {
    const s = sanitizeSettings({
      theme: 'light',
      accent: 'rose',
      volume: 5,
      sound: 'yes',
      board: '../../etc',
      extra: 1,
    });
    expect(s.theme).toBe('light');
    expect(s.accent).toBe('rose');
    expect(s.volume).toBe(1);
    expect(s.sound).toBe(DEFAULT_SETTINGS.sound);
    expect(s.board).toBe(DEFAULT_SETTINGS.board);
    expect('extra' in s).toBe(false);
  });
});

describe('schema migrations', () => {
  it('runs pending migrations in order and stamps the version', () => {
    const steps: number[] = [];
    const { data, changed } = migrate(
      { value: 1 },
      {
        1: (d) => (steps.push(1), { ...d, a: true }),
        2: (d) => (steps.push(2), { ...d, b: true }),
      },
      2,
    );
    expect(changed).toBe(true);
    expect(steps).toEqual([1, 2]);
    expect(data).toMatchObject({ schemaVersion: 2, a: true, b: true, value: 1 });
  });

  it('leaves current or newer documents untouched', () => {
    expect(migrate({ schemaVersion: 3 }, { 1: () => ({}) }, 2).changed).toBe(false);
  });
});
